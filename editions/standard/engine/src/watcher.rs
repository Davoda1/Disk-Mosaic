use crate::protocol::Emitter;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MAX_COALESCED_DIRECTORIES: usize = 2048;

pub struct WatchService {
    watcher: Option<RecommendedWatcher>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    root: PathBuf,
}

impl WatchService {
    pub fn start(root: PathBuf, debounce: Duration, emitter: Emitter) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(move |result| {
            let _ = tx.send(result);
        }).map_err(|error| format!("Cannot initialize filesystem watcher: {error}"))?;
        watcher.watch(&root, RecursiveMode::Recursive)
            .map_err(|error| format!("Cannot watch {}: {error}", root.display()))?;

        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let thread_paused = paused.clone();
        let thread_root = root.clone();
        let debounce = debounce.clamp(Duration::from_millis(100), Duration::from_secs(60));
        let worker = thread::spawn(move || {
            let mut held_while_paused: BTreeSet<PathBuf> = BTreeSet::new();
            while !thread_stop.load(Ordering::Acquire) {
                match rx.recv_timeout(Duration::from_millis(150)) {
                    Ok(first) => {
                        let mut dirs = BTreeSet::new();
                        let mut stale = false;
                        collect_event(first, &thread_root, &mut dirs, &mut stale);
                        let deadline = Instant::now() + debounce;
                        loop {
                            let now = Instant::now();
                            if now >= deadline { break; }
                            match rx.recv_timeout(deadline.saturating_duration_since(now)) {
                                Ok(event) => collect_event(event, &thread_root, &mut dirs, &mut stale),
                                Err(mpsc::RecvTimeoutError::Timeout) => break,
                                Err(mpsc::RecvTimeoutError::Disconnected) => return,
                            }
                            if dirs.len() > MAX_COALESCED_DIRECTORIES {
                                stale = true;
                                dirs.clear();
                                break;
                            }
                        }

                        if stale {
                            emitter.emit_value(json!({
                                "event":"watcher_state", "state":"overflow_refresh_required",
                                "message":"Filesystem watcher reported an error or an event storm; an explicit refresh is required."
                            }));
                            continue;
                        }

                        if thread_paused.load(Ordering::Acquire) {
                            held_while_paused.extend(dirs);
                            if held_while_paused.len() > MAX_COALESCED_DIRECTORIES {
                                held_while_paused.clear();
                                emitter.emit_value(json!({"event":"watcher_state","state":"overflow_refresh_required"}));
                            }
                            continue;
                        }

                        held_while_paused.extend(dirs);
                        if !held_while_paused.is_empty() {
                            let compact = compact_directories(std::mem::take(&mut held_while_paused));
                            let paths: Vec<String> = compact.into_iter().map(|path| path.to_string_lossy().into_owned()).collect();
                            emitter.emit_value(json!({"event":"watcher_changes","paths":paths}));
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if !thread_paused.load(Ordering::Acquire) && !held_while_paused.is_empty() {
                            let compact = compact_directories(std::mem::take(&mut held_while_paused));
                            let paths: Vec<String> = compact.into_iter().map(|path| path.to_string_lossy().into_owned()).collect();
                            emitter.emit_value(json!({"event":"watcher_changes","paths":paths}));
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(Self { watcher: Some(watcher), stop, paused, worker: Some(worker), root })
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Release);
    }

    pub fn is_paused(&self) -> bool { self.paused.load(Ordering::Acquire) }
    pub fn root(&self) -> &Path { &self.root }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.watcher.take();
        if let Some(worker) = self.worker.take() { let _ = worker.join(); }
    }
}

impl Drop for WatchService {
    fn drop(&mut self) { self.stop(); }
}

fn collect_event(result: notify::Result<Event>, root: &Path, dirs: &mut BTreeSet<PathBuf>, stale: &mut bool) {
    match result {
        Ok(event) => {
            if matches!(event.kind, EventKind::Access(_)) { return; }
            for path in event.paths {
                let candidate = if path.is_dir() { path.clone() } else { path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.clone()) };
                if candidate.starts_with(root) { dirs.insert(candidate); }
            }
        }
        Err(_) => *stale = true,
    }
}

fn compact_directories(paths: BTreeSet<PathBuf>) -> Vec<PathBuf> {
    let mut ordered: Vec<PathBuf> = paths.into_iter().collect();
    ordered.sort_by_key(|path| path.components().count());
    let mut out: Vec<PathBuf> = Vec::new();
    'next: for path in ordered {
        for parent in &out {
            if path.starts_with(parent) { continue 'next; }
        }
        out.push(path);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_watcher_paths_are_coalesced() {
        let root = PathBuf::from("/root");
        let mut set = BTreeSet::new();
        set.insert(root.join("a"));
        set.insert(root.join("a/b"));
        set.insert(root.join("c"));
        let compact = compact_directories(set);
        assert_eq!(compact.len(), 2);
        assert!(compact.contains(&root.join("a")));
        assert!(compact.contains(&root.join("c")));
    }
}

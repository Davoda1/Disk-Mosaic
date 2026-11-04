use crate::filetype::type_hint_for_file;
use crate::model::{extension_for, modified_ms, Node, NodeId, NodeKind, ScanError, ScanModel, ScanStatistics};
use crate::platform::{allocated_size, file_identity, filesystem_space, is_hidden_entry, same_filesystem, FileIdentity};
use crate::protocol::Emitter;
use crossbeam_channel::{unbounded, Receiver, RecvTimeoutError, Sender};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScanOptions {
    pub workers: usize,
    pub follow_symlinks: bool,
    pub cross_filesystems: bool,
    pub deduplicate_hardlinks: bool,
    pub exclude_patterns: Vec<String>,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            workers: 0,
            follow_symlinks: false,
            cross_filesystems: true,
            deduplicate_hardlinks: true,
            exclude_patterns: Vec::new(),
        }
    }
}

#[derive(Clone)]
struct DirTask {
    path: PathBuf,
    node_id: NodeId,
    depth: u32,
}

struct EntryDraft {
    directory_path: Option<PathBuf>,
    name: String,
    kind: NodeKind,
    hidden: bool,
    size: u64,
    allocated_size: u64,
    raw_size: u64,
    raw_allocated_size: u64,
    identity_volume: Option<u64>,
    identity_index: Option<u64>,
    modified_ms: Option<u64>,
    extension: String,
    type_hint: String,
    enqueue_directory: bool,
    hardlink_duplicate: bool,
    link_count: u64,
}

struct Shared {
    root_path: PathBuf,
    options: ScanOptions,
    nodes: Mutex<Vec<Node>>,
    errors: Mutex<Vec<ScanError>>,
    error_count: AtomicU64,
    excluded: AtomicU64,
    hardlinks: Mutex<HashSet<FileIdentity>>,
    visited_dirs: Mutex<HashSet<FileIdentity>>,
    visited_fallback: Mutex<HashSet<PathBuf>>,
    files: AtomicU64,
    directories: AtomicU64,
    bytes: AtomicU64,
    allocated_bytes: AtomicU64,
    pending: AtomicUsize,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    current_path: Mutex<String>,
}

pub fn run_scan(
    path: PathBuf,
    options: ScanOptions,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    emitter: Emitter,
    scan_id: String,
) -> Result<(ScanModel, bool), String> {
    run_scan_internal(path, options, cancel, pause, emitter, scan_id, true)
}

pub fn run_scan_quiet(
    path: PathBuf,
    options: ScanOptions,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    emitter: Emitter,
    scan_id: String,
) -> Result<(ScanModel, bool), String> {
    run_scan_internal(path, options, cancel, pause, emitter, scan_id, false)
}

fn run_scan_internal(
    path: PathBuf,
    options: ScanOptions,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    emitter: Emitter,
    scan_id: String,
    emit_events: bool,
) -> Result<(ScanModel, bool), String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Cannot scan {}: {e}", path.display()))?;
    let filesystem_space = filesystem_space(&path);
    if !metadata.is_dir() {
        return Err("Scan root must be a directory".to_string());
    }
    let root_name = path.file_name().and_then(|s| s.to_str()).filter(|s| !s.is_empty())
        .unwrap_or_else(|| path.to_str().unwrap_or("/"))
        .to_string();
    let root_node = Node {
        id: 0,
        parent_id: None,
        active: true,
        hidden: false,
        name: root_name,
        kind: NodeKind::Directory,
        size: 0,
        allocated_size: 0,
        raw_size: 0,
        raw_allocated_size: 0,
        identity_volume: None,
        identity_index: None,
        modified_ms: modified_ms(&metadata),
        extension: String::new(),
        type_hint: String::new(),
        children: Vec::new(),
        file_count: 0,
        dir_count: 0,
        depth: 0,
        hardlink_duplicate: false,
        link_count: 1,
    };
    let shared = Arc::new(Shared {
        root_path: path.clone(),
        options: options.clone(),
        nodes: Mutex::new(vec![root_node]),
        errors: Mutex::new(Vec::new()),
        error_count: AtomicU64::new(0),
        excluded: AtomicU64::new(0),
        hardlinks: Mutex::new(HashSet::new()),
        visited_dirs: Mutex::new(HashSet::new()),
        visited_fallback: Mutex::new(HashSet::new()),
        files: AtomicU64::new(0),
        directories: AtomicU64::new(1),
        bytes: AtomicU64::new(0),
        allocated_bytes: AtomicU64::new(0),
        pending: AtomicUsize::new(1),
        cancel,
        pause,
        current_path: Mutex::new(path.to_string_lossy().into_owned()),
    });

    register_visited_dir(&shared, &path, &metadata);
    let started = Instant::now();
    if emit_events {
        emitter.emit_value(json!({
            "event":"scan_started", "scan_id":scan_id, "path":path.to_string_lossy(), "workers":worker_count(options.workers)
        }));
    }

    let progress = if emit_events {
        let progress_shared = shared.clone();
        let progress_emitter = emitter.clone();
        let progress_scan_id = scan_id.clone();
        Some(thread::spawn(move || {
            while progress_shared.pending.load(Ordering::Acquire) > 0 {
                thread::sleep(Duration::from_millis(250));
                progress_emitter.emit_value(json!({
                    "event":"scan_progress",
                    "scan_id":progress_scan_id,
                    "files":progress_shared.files.load(Ordering::Relaxed),
                    "directories":progress_shared.directories.load(Ordering::Relaxed),
                    "bytes":progress_shared.bytes.load(Ordering::Relaxed),
                    "allocated_bytes":progress_shared.allocated_bytes.load(Ordering::Relaxed),
                    "errors":progress_shared.error_count.load(Ordering::Relaxed),
                    "excluded":progress_shared.excluded.load(Ordering::Relaxed),
                    "elapsed_ms":started.elapsed().as_millis() as u64,
                    "current_path":progress_shared.current_path.lock().clone(),
                    "paused":progress_shared.pause.load(Ordering::Relaxed)
                }));
            }
        }))
    } else { None };

    let (tx, rx) = unbounded::<DirTask>();
    tx.send(DirTask { path: path.clone(), node_id: 0, depth: 0 }).map_err(|e| e.to_string())?;
    let mut workers = Vec::new();
    for _ in 0..worker_count(options.workers) {
        let worker_shared = shared.clone();
        let worker_rx = rx.clone();
        let worker_tx = tx.clone();
        workers.push(thread::spawn(move || worker_loop(worker_shared, worker_rx, worker_tx)));
    }
    drop(tx);
    let mut worker_panicked = false;
    for worker in workers {
        if worker.join().is_err() {
            worker_panicked = true;
            shared.cancel.store(true, Ordering::Relaxed);
            shared.pending.store(0, Ordering::Release);
        }
    }
    if let Some(progress) = progress { let _ = progress.join(); }
    if worker_panicked {
        return Err("A scanner worker panicked".to_string());
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let cancelled = shared.cancel.load(Ordering::Relaxed);
    let shared = Arc::try_unwrap(shared).map_err(|_| "Internal scanner ownership error".to_string())?;
    let error_count = shared.error_count.load(Ordering::Relaxed);
    let excluded_count = shared.excluded.load(Ordering::Relaxed);
    let errors = shared.errors.into_inner();
    let mut nodes = shared.nodes.into_inner();
    aggregate(&mut nodes);
    let scanned_bytes = nodes.first().map(|n| n.size).unwrap_or(0);
    let allocated_bytes = nodes.first().map(|n| n.allocated_size).unwrap_or(0);
    let mut model = ScanModel {
        root_path: path,
        nodes,
        errors,
        error_count,
        excluded_count,
        extension_stats: Vec::new(),
        statistics: ScanStatistics::default(),
        largest: Vec::new(),
        scanned_bytes,
        allocated_bytes,
        scan_elapsed_ms: elapsed_ms,
        filesystem_total_bytes: filesystem_space.map(|space| space.0),
        filesystem_available_bytes: filesystem_space.map(|space| space.1),
    };
    model.build_indexes();
    Ok((model, cancelled))
}

fn worker_loop(shared: Arc<Shared>, rx: Receiver<DirTask>, tx: Sender<DirTask>) {
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(task) => {
                wait_if_paused(&shared);
                if shared.cancel.load(Ordering::Relaxed) {
                    shared.pending.fetch_sub(1, Ordering::AcqRel);
                    continue;
                }
                scan_directory(&shared, task, &tx);
                shared.pending.fetch_sub(1, Ordering::AcqRel);
            }
            Err(RecvTimeoutError::Timeout) => {
                if shared.pending.load(Ordering::Acquire) == 0 { break; }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn wait_if_paused(shared: &Shared) {
    while shared.pause.load(Ordering::Acquire) && !shared.cancel.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(40));
    }
}

fn scan_directory(shared: &Arc<Shared>, task: DirTask, tx: &Sender<DirTask>) {
    *shared.current_path.lock() = task.path.to_string_lossy().into_owned();
    let read = match fs::read_dir(&task.path) {
        Ok(r) => r,
        Err(error) => {
            record_error(shared, &task.path, error.to_string());
            return;
        }
    };
    let mut drafts = Vec::new();
    for entry_result in read {
        wait_if_paused(shared);
        if shared.cancel.load(Ordering::Relaxed) { break; }
        let entry = match entry_result {
            Ok(e) => e,
            Err(error) => {
                record_error(shared, &task.path, error.to_string());
                continue;
            }
        };
        let path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        let relative_path = path.strip_prefix(&shared.root_path).unwrap_or(&path)
            .to_string_lossy().replace('\\', "/");
        if matches_exclude_patterns(&shared.options.exclude_patterns, &entry_name, &relative_path) {
            shared.excluded.fetch_add(1, Ordering::Relaxed);
            continue;
        }
        let link_meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(error) => {
                record_error(shared, &path, error.to_string());
                continue;
            }
        };
        let file_type = link_meta.file_type();
        let mut kind = if file_type.is_symlink() { NodeKind::Symlink }
            else if file_type.is_dir() { NodeKind::Directory }
            else if file_type.is_file() { NodeKind::File }
            else { NodeKind::Other };
        let mut metadata = link_meta;
        let mut enqueue_directory = kind == NodeKind::Directory;
        if kind == NodeKind::Symlink && shared.options.follow_symlinks {
            match fs::metadata(&path) {
                Ok(target) if target.is_dir() => {
                    metadata = target;
                    kind = NodeKind::Directory;
                    enqueue_directory = true;
                }
                Ok(target) if target.is_file() => {
                    metadata = target;
                    kind = NodeKind::File;
                }
                Ok(_) => {}
                Err(error) => record_error(shared, &path, format!("symlink target: {error}")),
            }
        }
        if enqueue_directory && !shared.options.cross_filesystems && !same_filesystem(&shared.root_path, &path) {
            enqueue_directory = false;
        }
        if enqueue_directory && already_visited_dir(shared, &path, &metadata) {
            enqueue_directory = false;
        }

        let mut size = if kind == NodeKind::File || kind == NodeKind::Symlink || kind == NodeKind::Other { metadata.len() } else { 0 };
        let mut allocated = if kind == NodeKind::File || kind == NodeKind::Symlink || kind == NodeKind::Other { allocated_size(&path, &metadata) } else { 0 };
        let raw_size = size;
        let raw_allocated_size = allocated;
        let identity = if kind == NodeKind::File { file_identity(&path, &metadata).ok() } else { None };
        let link_count = identity.as_ref().map(|identity| identity.links).unwrap_or(1);
        let identity_volume = identity.as_ref().map(|identity| identity.volume);
        let identity_index = identity.as_ref().map(|identity| identity.index);
        let mut hardlink_duplicate = false;
        if kind == NodeKind::File && shared.options.deduplicate_hardlinks {
            if let Some(identity) = identity {
                if identity.links > 1 {
                    let mut seen = shared.hardlinks.lock();
                    if !seen.insert(identity) {
                        size = 0;
                        allocated = 0;
                        hardlink_duplicate = true;
                    }
                }
            }
        }
        let name = entry_name;
        let extension = if kind == NodeKind::File { extension_for(&path) } else { String::new() };
        let type_hint = if kind == NodeKind::File { type_hint_for_file(&path, &metadata, &extension) } else { String::new() };
        drafts.push(EntryDraft {
            directory_path: if enqueue_directory { Some(path.clone()) } else { None },
            name,
            kind,
            hidden: is_hidden_entry(&path, &metadata),
            size,
            allocated_size: allocated,
            raw_size,
            raw_allocated_size,
            identity_volume,
            identity_index,
            modified_ms: modified_ms(&metadata),
            extension,
            type_hint,
            enqueue_directory,
            hardlink_duplicate,
            link_count,
        });
    }

    if drafts.is_empty() { return; }
    let mut new_dirs = Vec::new();
    {
        let mut nodes = shared.nodes.lock();
        let start = nodes.len();
        for (i, draft) in drafts.iter().enumerate() {
            let id = (start + i) as NodeId;
            nodes.push(Node {
                id,
                parent_id: Some(task.node_id),
                active: true,
                hidden: draft.hidden,
                name: draft.name.clone(),
                kind: draft.kind,
                size: draft.size,
                allocated_size: draft.allocated_size,
                raw_size: draft.raw_size,
                raw_allocated_size: draft.raw_allocated_size,
                identity_volume: draft.identity_volume,
                identity_index: draft.identity_index,
                modified_ms: draft.modified_ms,
                extension: draft.extension.clone(),
                type_hint: draft.type_hint.clone(),
                children: Vec::new(),
                file_count: if draft.kind == NodeKind::File { 1 } else { 0 },
                dir_count: 0,
                depth: task.depth + 1,
                hardlink_duplicate: draft.hardlink_duplicate,
                link_count: draft.link_count,
            });
            nodes[task.node_id as usize].children.push(id);
            if draft.enqueue_directory {
                if let Some(path) = draft.directory_path.as_ref() {
                    new_dirs.push((id, path.clone()));
                }
            }
        }
    }

    for draft in &drafts {
        match draft.kind {
            NodeKind::Directory => { shared.directories.fetch_add(1, Ordering::Relaxed); }
            NodeKind::File => {
                shared.files.fetch_add(1, Ordering::Relaxed);
                shared.bytes.fetch_add(draft.size, Ordering::Relaxed);
                shared.allocated_bytes.fetch_add(draft.allocated_size, Ordering::Relaxed);
            }
            _ => {
                shared.bytes.fetch_add(draft.size, Ordering::Relaxed);
                shared.allocated_bytes.fetch_add(draft.allocated_size, Ordering::Relaxed);
            }
        }
    }
    for (id, path) in new_dirs {
        shared.pending.fetch_add(1, Ordering::AcqRel);
        if tx.send(DirTask { path, node_id: id, depth: task.depth + 1 }).is_err() {
            shared.pending.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

fn matches_exclude_patterns(patterns: &[String], name: &str, relative_path: &str) -> bool {
    if patterns.is_empty() { return false; }
    let name_candidate = name.to_lowercase();
    let path_candidate = relative_path.replace('\\', "/").to_lowercase();
    patterns.iter().any(|raw_pattern| {
        let pattern = raw_pattern.trim();
        if pattern.is_empty() || pattern.starts_with('#') { return false; }
        let lower = pattern.to_lowercase();
        if let Some(path_pattern) = lower.strip_prefix("path:") {
            let normalized = path_pattern.trim().replace('\\', "/");
            !normalized.is_empty() && wildcard_match(&normalized, &path_candidate)
        } else if let Some(name_pattern) = lower.strip_prefix("name:") {
            let normalized = name_pattern.trim();
            !normalized.is_empty() && wildcard_match(normalized, &name_candidate)
        } else {
            wildcard_match(&lower, &name_candidate)
        }
    })
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let (mut p, mut t) = (0usize, 0usize);
    let (mut star, mut match_at) = (None, 0usize);
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            p += 1;
            match_at = t;
        } else if let Some(star_pos) = star {
            p = star_pos + 1;
            match_at += 1;
            t = match_at;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == '*' { p += 1; }
    p == pattern.len()
}

fn record_error(shared: &Shared, path: &Path, message: String) {
    shared.error_count.fetch_add(1, Ordering::Relaxed);
    let mut errors = shared.errors.lock();
    if errors.len() < 10_000 {
        errors.push(ScanError { path: path.to_string_lossy().into_owned(), message });
    }
}

fn register_visited_dir(shared: &Shared, path: &Path, metadata: &fs::Metadata) {
    if let Ok(identity) = file_identity(path, metadata) {
        shared.visited_dirs.lock().insert(identity);
    } else if let Ok(canonical) = fs::canonicalize(path) {
        shared.visited_fallback.lock().insert(canonical);
    }
}

fn already_visited_dir(shared: &Shared, path: &Path, metadata: &fs::Metadata) -> bool {
    if let Ok(identity) = file_identity(path, metadata) {
        !shared.visited_dirs.lock().insert(identity)
    } else if let Ok(canonical) = fs::canonicalize(path) {
        !shared.visited_fallback.lock().insert(canonical)
    } else {
        false
    }
}

fn aggregate(nodes: &mut [Node]) {
    for index in (0..nodes.len()).rev() {
        if nodes[index].kind != NodeKind::Directory { continue; }
        let children = nodes[index].children.clone();
        let mut size = 0u64;
        let mut allocated = 0u64;
        let mut files = 0u64;
        let mut dirs = 0u64;
        for child_id in children {
            let child = &nodes[child_id as usize];
            size = size.saturating_add(child.size);
            allocated = allocated.saturating_add(child.allocated_size);
            files = files.saturating_add(child.file_count);
            dirs = dirs.saturating_add(child.dir_count);
            if child.kind == NodeKind::Directory { dirs = dirs.saturating_add(1); }
        }
        nodes[index].size = size;
        nodes[index].allocated_size = allocated;
        nodes[index].file_count = files;
        nodes[index].dir_count = dirs;
    }
}

fn worker_count(configured: usize) -> usize {
    if configured > 0 { return configured.clamp(1, 64); }
    thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 12)
}



#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Node, NodeKind, SortField};
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("diskmosaic-test-{label}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn scan(path: PathBuf, mut options: ScanOptions) -> ScanModel {
        if options.workers == 0 { options.workers = 2; }
        let (model, cancelled) = run_scan(
            path,
            options,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            Emitter::new(),
            "test".into(),
        ).unwrap();
        assert!(!cancelled);
        model
    }

    #[test]
    fn deterministic_fixture_aggregates_correctly() {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixture");
        let fixture = temp_dir("deterministic-fixture");
        for relative in [
            "Documents/a.txt",
            "Documents/b.pdf",
            "Games/game.bin",
            "Games/assets/a.dat",
            "Games/assets/b.dat",
        ] {
            let destination = fixture.join(relative);
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            fs::copy(source.join(relative), destination).unwrap();
        }
        // Materialize the empty directory that Git does not track.
        fs::create_dir(fixture.join("Empty")).unwrap();
        let model = scan(fixture.clone(), ScanOptions::default());
        assert_eq!(model.scanned_bytes, 68);
        let root = model.node_summary(0).unwrap();
        assert_eq!(root.file_count, 5);
        assert_eq!(root.dir_count, 4);
        let dat = model.extension_stats.iter().find(|s| s.extension == ".dat").unwrap();
        assert_eq!(dat.files, 2);
        assert_eq!(dat.size, 20);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn scan_records_filesystem_capacity_context_when_available() {
        let root = temp_dir("filesystem-space");
        fs::write(root.join("a.bin"), vec![0u8; 128]).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        if let (Some(total), Some(available)) = (model.filesystem_total_bytes, model.filesystem_available_bytes) {
            assert!(total > 0);
            assert!(available <= total);
            assert!(model.scanned_bytes <= total);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_directory_and_extensionless_file() {
        let root = temp_dir("empty-extensionless");
        fs::create_dir(root.join("Empty")).unwrap();
        fs::write(root.join("README"), b"12345").unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        assert_eq!(model.scanned_bytes, 5);
        let none = model.extension_stats.iter().find(|s| s.extension.is_empty()).unwrap();
        assert_eq!(none.files, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unicode_names_round_trip() {
        let root = temp_dir("unicode");
        fs::create_dir(root.join("árvíztűrő-世界")).unwrap();
        fs::write(root.join("árvíztűrő-世界").join("файл.txt"), b"unicode").unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        let hit = model.search(Some("файл"), None, None, None, None, None, None, None, crate::model::SizeBasis::Logical, 10);
        assert_eq!(hit.len(), 1);
        assert!(hit[0].path.contains("árvíztűrő-世界"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn exclusion_patterns_skip_matching_names() {
        let root = temp_dir("exclude");
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules").join("big.bin"), vec![1u8; 8192]).unwrap();
        fs::write(root.join("keep.txt"), b"keep").unwrap();
        let model = scan(root.clone(), ScanOptions {
            exclude_patterns: vec!["node_*".into()],
            ..ScanOptions::default()
        });
        assert_eq!(model.scanned_bytes, 4);
        assert_eq!(model.excluded_count, 1);
        assert!(!model.nodes.iter().any(|n| n.name == "node_modules"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn statistics_capture_size_and_extensionless_counts() {
        let root = temp_dir("statistics");
        fs::write(root.join("empty.bin"), b"").unwrap();
        fs::write(root.join("README"), vec![0u8; 5000]).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        assert_eq!(model.statistics.extensionless_files, 1);
        assert_eq!(model.statistics.size_buckets.iter().map(|b| b.files).sum::<u64>(), 2);
        assert!(model.statistics.max_depth >= 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn wildcard_exclusions_support_star_question_and_case_insensitive_matching() {
        assert!(wildcard_match("*.tmp", "cache.tmp"));
        assert!(wildcard_match("file-??.bin", "file-01.bin"));
        assert!(matches_exclude_patterns(&["NODE_*".into()], "node_modules", "src/node_modules"));
        assert!(matches_exclude_patterns(&["path:cache/*".into()], "data.bin", "cache/data.bin"));
        assert!(matches_exclude_patterns(&["name:*.TMP".into()], "cache.tmp", "nested/cache.tmp"));
        assert!(!matches_exclude_patterns(&["path:cache/*".into()], "data.bin", "other/data.bin"));
        assert!(!wildcard_match("*.tmp", "cache.bin"));
    }

    #[test]
    fn bounded_search_returns_the_largest_matching_entries() {
        let root = temp_dir("search-top-k");
        fs::write(root.join("match-small.bin"), vec![0u8; 10]).unwrap();
        fs::write(root.join("match-large.bin"), vec![0u8; 1000]).unwrap();
        fs::write(root.join("match-medium.bin"), vec![0u8; 100]).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        let hits = model.search(Some("match-"), None, Some(".bin"), None, None, Some(NodeKind::File), None, None, crate::model::SizeBasis::Logical, 2);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].name, "match-large.bin");
        assert_eq!(hits[1].name, "match-medium.bin");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hard_links_are_counted_once() {
        let root = temp_dir("hardlink");
        let first = root.join("a.bin");
        let second = root.join("b.bin");
        fs::write(&first, vec![7u8; 4096]).unwrap();
        fs::hard_link(&first, &second).unwrap();
        let model = scan(root.clone(), ScanOptions { deduplicate_hardlinks: true, ..ScanOptions::default() });
        assert_eq!(model.scanned_bytes, 4096);
        assert_eq!(model.nodes.iter().filter(|n| n.hardlink_duplicate).count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_by_default() {
        use std::os::unix::fs::symlink;
        let root = temp_dir("symlink");
        let outside = temp_dir("symlink-target");
        fs::write(outside.join("big.bin"), vec![1u8; 8192]).unwrap();
        symlink(&outside, root.join("link")).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        assert!(model.scanned_bytes < 8192);
        assert!(model.nodes.iter().any(|n| n.kind == NodeKind::Symlink));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn cancellation_stops_work() {
        let root = temp_dir("cancel");
        for i in 0..100 {
            let dir = root.join(format!("d{i}"));
            fs::create_dir(&dir).unwrap();
            fs::write(dir.join("file.bin"), vec![0u8; 1024]).unwrap();
        }
        let cancel = Arc::new(AtomicBool::new(true));
        let (_model, cancelled) = run_scan(root.clone(), ScanOptions::default(), cancel, Arc::new(AtomicBool::new(false)), Emitter::new(), "cancel-test".into()).unwrap();
        assert!(cancelled);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn aggregation_handles_sizes_above_u32() {
        let huge = (u32::MAX as u64) + 10_000;
        let mut nodes = vec![
            Node { id:0,parent_id:None,active:true,hidden:false,name:"root".into(),kind:NodeKind::Directory,size:0,allocated_size:0,raw_size:0,raw_allocated_size:0,identity_volume:None,identity_index:None,modified_ms:None,extension:String::new(),type_hint:String::new(),children:vec![1,2],file_count:0,dir_count:0,depth:0,hardlink_duplicate:false,link_count:1 },
            Node { id:1,parent_id:Some(0),active:true,hidden:false,name:"a".into(),kind:NodeKind::File,size:huge,allocated_size:huge,raw_size:huge,raw_allocated_size:huge,identity_volume:None,identity_index:None,modified_ms:None,extension:".bin".into(),type_hint:String::new(),children:vec![],file_count:1,dir_count:0,depth:1,hardlink_duplicate:false,link_count:1 },
            Node { id:2,parent_id:Some(0),active:true,hidden:false,name:"b".into(),kind:NodeKind::File,size:huge,allocated_size:huge,raw_size:huge,raw_allocated_size:huge,identity_volume:None,identity_index:None,modified_ms:None,extension:".bin".into(),type_hint:String::new(),children:vec![],file_count:1,dir_count:0,depth:1,hardlink_duplicate:false,link_count:1 },
        ];
        aggregate(&mut nodes);
        assert_eq!(nodes[0].size, huge * 2);
        assert_eq!(nodes[0].file_count, 2);
    }

    #[test]
    fn treemap_preserves_directory_hierarchy_and_exact_partitions() {
        let root = temp_dir("treemap-hierarchy");
        fs::create_dir_all(root.join("nested").join("deeper")).unwrap();
        fs::write(root.join("root.bin"), vec![0u8; 5]).unwrap();
        fs::write(root.join("nested").join("a.dat"), vec![0u8; 7]).unwrap();
        fs::write(root.join("nested").join("deeper").join("b.iso"), vec![0u8; 11]).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        let items = model.treemap(0, 100, 0, crate::model::SizeBasis::Logical, &[]);

        let nested = items.iter().find(|item| item.name == "nested" && item.kind == "directory").unwrap();
        let nested_id = nested.id.unwrap();
        let deeper = items.iter().find(|item| item.name == "deeper" && item.kind == "directory").unwrap();
        let deeper_id = deeper.id.unwrap();
        assert_eq!(nested.parent_id, Some(0));
        assert_eq!(deeper.parent_id, Some(nested_id));
        assert!(items.iter().any(|item| item.name == "a.dat" && item.parent_id == Some(nested_id)));
        assert!(items.iter().any(|item| item.name == "b.iso" && item.parent_id == Some(deeper_id)));

        let root_partition: u64 = items.iter().filter(|item| item.parent_id == Some(0)).map(|item| item.size).sum();
        let nested_partition: u64 = items.iter().filter(|item| item.parent_id == Some(nested_id)).map(|item| item.size).sum();
        let deeper_partition: u64 = items.iter().filter(|item| item.parent_id == Some(deeper_id)).map(|item| item.size).sum();
        assert_eq!(root_partition, model.nodes[0].size);
        assert_eq!(nested_partition, model.nodes[nested_id as usize].size);
        assert_eq!(deeper_partition, model.nodes[deeper_id as usize].size);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn treemap_budget_uses_exact_remainder_rectangle() {
        let root = temp_dir("treemap-remainder");
        for i in 0..120u64 {
            fs::write(root.join(format!("file-{i:03}.bin")), vec![0u8; (i + 1) as usize]).unwrap();
        }
        let model = scan(root.clone(), ScanOptions::default());
        let items = model.treemap(0, 20, 0, crate::model::SizeBasis::Logical, &[]);
        assert_eq!(items.len(), 20);
        let aggregate = items.iter().find(|item| item.kind == "aggregate").unwrap();
        assert_eq!(aggregate.parent_id, Some(0));
        assert!(aggregate.aggregated_items > 0);
        assert!(aggregate.size > 0);
        let root_partition: u64 = items.iter().filter(|item| item.parent_id == Some(0)).map(|item| item.size).sum();
        assert_eq!(root_partition, model.nodes[0].size);
        let _ = fs::remove_dir_all(root);
    }


    #[test]
    fn treemap_type_filter_marks_matching_directory_subtrees_and_remainders() {
        let root = temp_dir("treemap-type-filter");
        fs::create_dir_all(root.join("media").join("nested")).unwrap();
        fs::write(root.join("media").join("movie.mkv"), vec![0u8; 64]).unwrap();
        fs::write(root.join("media").join("nested").join("notes.txt"), vec![0u8; 32]).unwrap();
        fs::write(root.join("plain.txt"), vec![0u8; 48]).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        let filter = vec![".mkv".to_string()];
        let items = model.treemap(0, 100, 0, crate::model::SizeBasis::Logical, &filter);
        let media = items.iter().find(|item| item.name == "media" && item.kind == "directory").unwrap();
        let plain = items.iter().find(|item| item.name == "plain.txt").unwrap();
        let movie = items.iter().find(|item| item.name == "movie.mkv").unwrap();
        let notes = items.iter().find(|item| item.name == "notes.txt").unwrap();
        assert!(media.matches_filter);
        assert!(movie.matches_filter);
        assert!(!plain.matches_filter);
        assert!(!notes.matches_filter);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn child_sorting_is_correct() {
        let root = temp_dir("sorting");
        fs::write(root.join("small.txt"), vec![0u8; 1]).unwrap();
        fs::write(root.join("large.txt"), vec![0u8; 10]).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        let (_total, items) = model.children(0, 0, 10, SortField::Size, true);
        assert_eq!(items[0].name, "large.txt");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn permission_failures_are_collected_when_effective() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_dir("permissions");
        let blocked = root.join("blocked");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("secret"), b"x").unwrap();
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0o000)).unwrap();
        let model = scan(root.clone(), ScanOptions::default());
        // Root-capable test environments can still read mode-000 directories.
        if model.error_count > 0 {
            assert!(model.errors.iter().any(|e| e.path.contains("blocked")));
        }
        let _ = fs::set_permissions(&blocked, fs::Permissions::from_mode(0o700));
        let _ = fs::remove_dir_all(root);
    }
}

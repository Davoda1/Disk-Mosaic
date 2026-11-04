mod duplicates;
mod filetype;
mod filesystem_ops;
mod history;
mod metadata;
mod model;
mod platform;
mod protocol;
mod scanner;
mod snapshot;
mod watcher;

use model::{HiddenMode, NodeId, NodeKind, SizeBasis, SortField};
use parking_lot::{Mutex, RwLock};
use protocol::Emitter;
use scanner::{run_scan, run_scan_quiet, ScanOptions};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

struct EngineState {
    model: RwLock<Option<Arc<model::ScanModel>>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    pause: Mutex<Option<Arc<AtomicBool>>>,
    scanning: AtomicBool,
    analysis_cancel: Mutex<Option<Arc<AtomicBool>>>,
    analyzing: AtomicBool,
    selection: Mutex<HashSet<NodeId>>,
    last_scan_options: Mutex<ScanOptions>,
    live_model: AtomicBool,
    watcher: Mutex<Option<watcher::WatchService>>,
    history_path: Option<PathBuf>,
}

impl EngineState {
    fn new() -> Self {
        Self {
            model: RwLock::new(None),
            cancel: Mutex::new(None),
            pause: Mutex::new(None),
            scanning: AtomicBool::new(false),
            analysis_cancel: Mutex::new(None),
            analyzing: AtomicBool::new(false),
            selection: Mutex::new(HashSet::new()),
            last_scan_options: Mutex::new(ScanOptions::default()),
            live_model: AtomicBool::new(false),
            watcher: Mutex::new(None),
            history_path: history::default_database_path(),
        }
    }
}

fn main() {
    let emitter = Emitter::new();
    let state = Arc::new(EngineState::new());
    emitter.emit_value(json!({
        "event":"engine_ready","protocol":4,"version":env!("CARGO_PKG_VERSION"),
        "history_available":state.history_path.is_some()
    }));

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("stdin read error: {error}");
                break;
            }
        };
        if line.trim().is_empty() { continue; }
        let value: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(error) => {
                emitter.emit_value(json!({"event":"protocol_error","message":format!("Malformed command JSON: {error}")}));
                continue;
            }
        };
        handle_command(value, &state, &emitter);
    }

    request_scan_cancel(&state);
    request_analysis_cancel(&state);
    stop_watcher(&state, &emitter, false);
}

fn handle_command(command: Value, state: &Arc<EngineState>, emitter: &Emitter) {
    let request_id = command.get("request_id").and_then(Value::as_str).unwrap_or("").to_string();
    let cmd = command.get("cmd").and_then(Value::as_str).unwrap_or("");
    match cmd {
        "list_roots" => emitter.emit_value(json!({
            "event":"roots", "request_id":request_id, "roots":platform::list_roots()
        })),
        "scan" => start_scan(command, request_id, state.clone(), emitter.clone()),
        "cancel" => {
            if request_scan_cancel(state) {
                emitter.emit_value(json!({"event":"cancel_requested","request_id":request_id}));
            } else {
                emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"cancel","message":"No scan is active"}));
            }
        }
        "pause" => {
            if set_scan_pause(state, true) {
                emitter.emit_value(json!({"event":"scan_pause_changed","request_id":request_id,"paused":true}));
            } else {
                emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"pause","message":"No scan is active"}));
            }
        }
        "resume" => {
            if set_scan_pause(state, false) {
                emitter.emit_value(json!({"event":"scan_pause_changed","request_id":request_id,"paused":false}));
            } else {
                emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"resume","message":"No scan is active"}));
            }
        }
        "get_root" => with_model(state, emitter, request_id, |model| {
            json!({"event":"root","root":model.node_summary(0)})
        }),
        "children" => {
            let parent_id = u32_arg(&command, "parent_id", 0);
            let offset = usize_arg(&command, "offset", 0);
            let limit = usize_arg(&command, "limit", 2000).clamp(1, 10_000);
            let sort = SortField::parse(command.get("sort").and_then(Value::as_str));
            let descending = command.get("descending").and_then(Value::as_bool).unwrap_or(true);
            let hidden_mode = HiddenMode::parse(command.get("hidden_mode").and_then(Value::as_str));
            with_model(state, emitter, request_id, move |model| {
                let (total, items) = model.children_visible(parent_id, offset, limit, sort, descending, hidden_mode);
                json!({"event":"children","parent_id":parent_id,"offset":offset,"total":total,"items":items})
            });
        }
        "get_node" => {
            let id = u32_arg(&command, "node_id", 0);
            with_model(state, emitter, request_id, move |model| {
                json!({"event":"node","node":model.node_summary(id)})
            });
        }
        "ancestors" => {
            let id = u32_arg(&command, "node_id", 0);
            with_model(state, emitter, request_id, move |model| {
                json!({"event":"ancestors","items":model.ancestors(id)})
            });
        }
        "largest" => {
            let limit = usize_arg(&command, "limit", 100).clamp(1, 1000);
            let basis = SizeBasis::parse(command.get("size_basis").and_then(Value::as_str));
            let hidden_mode = HiddenMode::parse(command.get("hidden_mode").and_then(Value::as_str));
            with_model(state, emitter, request_id, move |model| {
                json!({"event":"largest","limit":limit,"size_basis":command_basis_name(basis),"items":model.largest_files_visible(limit, basis, hidden_mode)})
            });
        }
        "search" => {
            let name = string_arg(&command, "name_contains");
            let path = string_arg(&command, "path_contains");
            let extension = string_arg(&command, "extension");
            let min_size = command.get("min_size").and_then(Value::as_u64);
            let max_size = command.get("max_size").and_then(Value::as_u64);
            let kind = command.get("kind").and_then(Value::as_str).and_then(parse_node_kind);
            let modified_before_ms = command.get("modified_before_ms").and_then(Value::as_u64);
            let modified_after_ms = command.get("modified_after_ms").and_then(Value::as_u64);
            let basis = SizeBasis::parse(command.get("size_basis").and_then(Value::as_str));
            let limit = usize_arg(&command, "limit", 1000).clamp(1, 5000);
            let hidden_mode = HiddenMode::parse(command.get("hidden_mode").and_then(Value::as_str));
            with_model(state, emitter, request_id, move |model| {
                json!({
                    "event":"search_results",
                    "items":model.search_visible(
                        name.as_deref(), path.as_deref(), extension.as_deref(),
                        min_size, max_size, kind, modified_before_ms, modified_after_ms, basis, limit, hidden_mode
                    )
                })
            });
        }
        "statistics" => with_model(state, emitter, request_id, |model| {
            json!({"event":"statistics","statistics":&model.statistics})
        }),
        "treemap" => {
            let parent_id = u32_arg(&command, "parent_id", 0);
            let max_items = usize_arg(&command, "max_items", 3000).clamp(50, 10_000);
            let min_bytes = command.get("min_bytes").and_then(Value::as_u64).unwrap_or(0);
            let basis = SizeBasis::parse(command.get("size_basis").and_then(Value::as_str));
            let filter_extensions: Vec<String> = command.get("filter_extensions")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_str).map(|value| value.to_string()).collect())
                .unwrap_or_default();
            let hidden_mode = HiddenMode::parse(command.get("hidden_mode").and_then(Value::as_str));
            with_model(state, emitter, request_id, move |model| {
                json!({
                    "event":"treemap", "parent_id":parent_id,
                    "parent":model.node_summary(parent_id), "size_basis":basis,
                    "root_basis_bytes":model.root_size(basis),
                    "items":model.treemap_visible(parent_id, max_items, min_bytes, basis, &filter_extensions, hidden_mode)
                })
            });
        }
        "get_errors" => {
            let offset = usize_arg(&command, "offset", 0);
            let limit = usize_arg(&command, "limit", 500).clamp(1, 2000);
            with_model(state, emitter, request_id, move |model| {
                let items: Vec<_> = model.errors.iter().skip(offset).take(limit).cloned().collect();
                json!({"event":"errors","offset":offset,"total":model.error_count,"stored":model.errors.len(),"items":items})
            });
        }
        "get_metadata" => {
            let id = u32_arg(&command, "node_id", 0);
            with_model(state, emitter, request_id, move |model| {
                match metadata::inspect(model, id) {
                    Ok(metadata) => json!({"event":"metadata","metadata":metadata}),
                    Err(message) => json!({"event":"operation_failed","operation":"get_metadata","message":message}),
                }
            });
        }
        "selection_replace" => selection_replace(command, request_id, state, emitter),
        "selection_add" => selection_add(command, request_id, state, emitter),
        "selection_toggle" => selection_toggle(command, request_id, state, emitter),
        "selection_clear" => {
            state.selection.lock().clear();
            emit_selection(state, emitter, request_id);
        }
        "selection_summary" => emit_selection(state, emitter, request_id),
        "selection_page" => selection_page(command, request_id, state, emitter),
        "refresh_selected" => start_refresh_selected(command, request_id, state.clone(), emitter.clone()),
        "refresh_paths" => start_refresh_paths(command, request_id, state.clone(), emitter.clone()),
        "watch_start" => start_watcher(command, request_id, state, emitter),
        "watch_stop" => {
            stop_watcher(state, emitter, true);
            emitter.emit_value(json!({"event":"watcher_state","request_id":request_id,"state":"not_watching"}));
        }
        "watch_pause" => set_watcher_pause(state, emitter, request_id, true),
        "watch_resume" => set_watcher_pause(state, emitter, request_id, false),
        "watch_status" => emit_watcher_status(state, emitter, request_id),
        "history_status" => history_status(request_id, state, emitter),
        "history_store_current" => start_history_store(request_id, state.clone(), emitter.clone()),
        "history_list" => start_history_list(command, request_id, state.clone(), emitter.clone()),
        "history_load" => start_history_load(command, request_id, state.clone(), emitter.clone()),
        "history_delete" => start_history_delete(command, request_id, state.clone(), emitter.clone()),
        "compare_history" => start_compare_history(command, request_id, state.clone(), emitter.clone()),
        "duplicate_scan" => start_duplicate_scan(command, request_id, state.clone(), emitter.clone()),
        "cancel_analysis" => {
            if request_analysis_cancel(state) {
                emitter.emit_value(json!({"event":"analysis_cancel_requested","request_id":request_id}));
            } else {
                emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"cancel_analysis","message":"No background analysis is active"}));
            }
        }
        "save_snapshot" => start_save_snapshot(command, request_id, state.clone(), emitter.clone()),
        "load_snapshot" => start_load_snapshot(command, request_id, state.clone(), emitter.clone()),
        "compare_snapshot" => start_compare_snapshot(command, request_id, state.clone(), emitter.clone()),
        "trash" => trash_node(command, request_id, state, emitter),
        "batch_trash" => start_batch_trash(command, request_id, state.clone(), emitter.clone()),
        "hash_selection" => start_hash_selection(command, request_id, state.clone(), emitter.clone()),
        "shutdown" => {
            request_scan_cancel(state);
            request_analysis_cancel(state);
            stop_watcher(state, emitter, false);
            emitter.emit_value(json!({"event":"shutdown_ack","request_id":request_id}));
        }
        _ => emitter.emit_value(json!({"event":"protocol_error","request_id":request_id,"message":format!("Unknown command: {cmd}")})),
    }
}

fn request_scan_cancel(state: &EngineState) -> bool {
    let cancel = state.cancel.lock().clone();
    if let Some(cancel) = cancel {
        cancel.store(true, Ordering::Relaxed);
        if let Some(pause) = state.pause.lock().clone() { pause.store(false, Ordering::Release); }
        true
    } else { false }
}

fn set_scan_pause(state: &EngineState, paused: bool) -> bool {
    let pause = state.pause.lock().clone();
    if let Some(pause) = pause {
        pause.store(paused, Ordering::Release);
        true
    } else { false }
}

fn request_analysis_cancel(state: &EngineState) -> bool {
    let cancel = state.analysis_cancel.lock().clone();
    if let Some(cancel) = cancel {
        cancel.store(true, Ordering::Relaxed);
        true
    } else { false }
}

fn start_scan(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"scan_error","request_id":request_id,"message":"A scan is already running"}));
        return;
    }
    if state.analyzing.load(Ordering::Acquire) {
        state.scanning.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"scan_error","request_id":request_id,"message":"A background analysis is active"}));
        return;
    }
    let Some(path) = command.get("path").and_then(Value::as_str).map(PathBuf::from) else {
        state.scanning.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"scan_error","request_id":request_id,"message":"Missing scan path"}));
        return;
    };
    let options: ScanOptions = command.get("options")
        .cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    stop_watcher(&state, &emitter, false);
    *state.last_scan_options.lock() = options.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let pause = Arc::new(AtomicBool::new(false));
    *state.cancel.lock() = Some(cancel.clone());
    *state.pause.lock() = Some(pause.clone());
    let scan_id = if request_id.is_empty() { format!("scan-{}", std::process::id()) } else { request_id.clone() };

    thread::spawn(move || {
        let completion = match run_scan(path, options, cancel, pause, emitter.clone(), scan_id.clone()) {
            Ok((model, cancelled)) => {
                let root = model.node_summary(0);
                let summary = summary_json(&model);
                if cancelled {
                    json!({"event":"scan_cancelled","scan_id":scan_id,"summary":summary})
                } else {
                    let extension_stats = model.extension_stats.clone();
                    let statistics = model.statistics.clone();
                    *state.model.write() = Some(Arc::new(model));
                    state.selection.lock().clear();
                    state.live_model.store(true, Ordering::Release);
                    json!({
                        "event":"scan_completed", "scan_id":scan_id, "root":root,
                        "summary":summary, "extension_stats":extension_stats, "statistics":statistics
                    })
                }
            }
            Err(message) => json!({"event":"scan_error","scan_id":scan_id,"message":message}),
        };
        *state.cancel.lock() = None;
        *state.pause.lock() = None;
        state.scanning.store(false, Ordering::Release);
        emitter.emit_value(completion);
    });
}

fn start_duplicate_scan(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"duplicate_scan","message":"Another scan or analysis is active"}));
        return;
    }
    let model = state.model.read().clone();
    let Some(model) = model else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"duplicate_scan","message":"No completed scan is loaded"}));
        return;
    };
    let min_size = command.get("min_size").and_then(Value::as_u64).unwrap_or(1024 * 1024);
    let max_groups = usize_arg(&command, "max_groups", 1000);
    let cancel = Arc::new(AtomicBool::new(false));
    *state.analysis_cancel.lock() = Some(cancel.clone());
    let history_path = state.history_path.clone();
    thread::spawn(move || {
        let result = duplicates::find_duplicates(&model, &cancel, &emitter, &request_id, min_size, max_groups, history_path.as_deref());
        *state.analysis_cancel.lock() = None;
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"duplicate_completed","request_id":request_id,"result":result}));
    });
}

fn start_save_snapshot(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"save_snapshot","message":"Another scan or analysis is active"}));
        return;
    }
    let Some(path) = string_arg(&command, "path").map(PathBuf::from) else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"save_snapshot","message":"Missing snapshot path"}));
        return;
    };
    let model = state.model.read().clone();
    let Some(model) = model else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"save_snapshot","message":"No completed scan is loaded"}));
        return;
    };
    thread::spawn(move || {
        let result = snapshot::save_snapshot(&path, &model);
        state.analyzing.store(false, Ordering::Release);
        match result {
            Ok(info) => emitter.emit_value(json!({"event":"snapshot_saved","request_id":request_id,"path":path.to_string_lossy(),"info":info})),
            Err(message) => emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"save_snapshot","message":message})),
        }
    });
}

fn start_load_snapshot(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"load_snapshot","message":"Another scan or analysis is active"}));
        return;
    }
    let Some(path) = string_arg(&command, "path").map(PathBuf::from) else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"load_snapshot","message":"Missing snapshot path"}));
        return;
    };
    stop_watcher(&state, &emitter, false);
    thread::spawn(move || {
        let completion = match snapshot::load_snapshot(&path) {
            Ok((model, info)) => {
                let root = model.node_summary(0);
                let extension_stats = model.extension_stats.clone();
                let statistics = model.statistics.clone();
                let summary = summary_json(&model);
                *state.model.write() = Some(Arc::new(model));
                state.selection.lock().clear();
                state.live_model.store(false, Ordering::Release);
                json!({
                    "event":"snapshot_loaded","request_id":request_id,"path":path.to_string_lossy(),
                    "info":info,"root":root,"summary":summary,"extension_stats":extension_stats,"statistics":statistics
                })
            }
            Err(message) => json!({"event":"operation_failed","request_id":request_id,"operation":"load_snapshot","message":message}),
        };
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(completion);
    });
}

fn start_compare_snapshot(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"compare_snapshot","message":"Another scan or analysis is active"}));
        return;
    }
    let Some(path) = string_arg(&command, "path").map(PathBuf::from) else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"compare_snapshot","message":"Missing snapshot path"}));
        return;
    };
    let limit = usize_arg(&command, "limit", 2000);
    let model = state.model.read().clone();
    let Some(model) = model else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"compare_snapshot","message":"No completed scan is loaded"}));
        return;
    };
    thread::spawn(move || {
        let completion = match snapshot::compare_snapshot(&path, &model, limit) {
            Ok(result) => { json!({"event":"comparison_completed","request_id":request_id,"path":path.to_string_lossy(),"result":result}) },
            Err(message) => json!({"event":"operation_failed","request_id":request_id,"operation":"compare_snapshot","message":message}),
        };
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(completion);
    });
}

fn selection_replace(command: Value, request_id: String, state: &Arc<EngineState>, emitter: &Emitter) {
    let ids = node_ids_arg(&command, "node_ids", 100_000);
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"selection_replace","message":"No completed scan is loaded"}));
        return;
    };
    let valid: HashSet<NodeId> = ids.into_iter().filter(|id| model.node_summary(*id).is_some()).collect();
    *state.selection.lock() = valid;
    emit_selection(state, emitter, request_id);
}

fn selection_add(command: Value, request_id: String, state: &Arc<EngineState>, emitter: &Emitter) {
    let ids = node_ids_arg(&command, "node_ids", 100_000);
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"selection_add","message":"No completed scan is loaded"}));
        return;
    };
    let mut selection = state.selection.lock();
    for id in ids { if model.node_summary(id).is_some() { selection.insert(id); } }
    drop(selection);
    emit_selection(state, emitter, request_id);
}

fn selection_toggle(command: Value, request_id: String, state: &Arc<EngineState>, emitter: &Emitter) {
    let id = u32_arg(&command, "node_id", u32::MAX);
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"selection_toggle","message":"No completed scan is loaded"}));
        return;
    };
    if model.node_summary(id).is_none() {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"selection_toggle","message":"Unknown node"}));
        return;
    }
    let mut selection = state.selection.lock();
    if !selection.remove(&id) { selection.insert(id); }
    drop(selection);
    emit_selection(state, emitter, request_id);
}

fn emit_selection(state: &Arc<EngineState>, emitter: &Emitter, request_id: String) {
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"selection_changed","request_id":request_id,"summary":model::SelectionSummary::default(),"selected_ids":[],"truncated":false}));
        return;
    };
    let mut ids: Vec<NodeId> = state.selection.lock().iter().copied()
        .filter(|id| model.node_summary(*id).is_some()).collect();
    ids.sort_unstable();
    let summary = model.selection_summary(&ids);
    let truncated = ids.len() > 5000;
    if truncated { ids.truncate(5000); }
    emitter.emit_value(json!({
        "event":"selection_changed","request_id":request_id,
        "summary":summary,"selected_ids":ids,"truncated":truncated
    }));
}

fn selection_page(command: Value, request_id: String, state: &Arc<EngineState>, emitter: &Emitter) {
    let offset = usize_arg(&command, "offset", 0);
    let limit = usize_arg(&command, "limit", 1000).clamp(1, 5000);
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"selection_page","message":"No completed scan is loaded"}));
        return;
    };
    let mut ids: Vec<NodeId> = state.selection.lock().iter().copied()
        .filter(|id| model.node_summary(*id).is_some()).collect();
    ids.sort_unstable();
    let total = ids.len();
    let items: Vec<_> = ids.into_iter().skip(offset).take(limit).filter_map(|id| model.node_summary(id)).collect();
    emitter.emit_value(json!({"event":"selection_page","request_id":request_id,"offset":offset,"total":total,"items":items}));
}

fn start_refresh_selected(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    let requested = {
        let explicit = node_ids_arg(&command, "node_ids", 10_000);
        if explicit.is_empty() { state.selection.lock().iter().copied().collect() } else { explicit }
    };
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"refresh_selected","message":"No completed scan is loaded"}));
        return;
    };
    let mut targets = Vec::new();
    for id in model.normalized_selection(&requested) {
        let node = &model.nodes[id as usize];
        let directory = if node.kind == NodeKind::Directory { Some(id) } else { node.parent_id };
        if let Some(id) = directory { if !targets.contains(&id) { targets.push(id); } }
    }
    drop(model);
    start_refresh_ids(targets, request_id, state, emitter, "refresh_selected");
}

fn start_refresh_paths(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    let paths: Vec<PathBuf> = command.get("paths").and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).take(2048).map(PathBuf::from).collect())
        .unwrap_or_default();
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"refresh_paths","message":"No completed scan is loaded"}));
        return;
    };
    let mut targets = Vec::new();
    for path in paths {
        if let Some(id) = refresh_target_for_path(&model, &path) {
            if !targets.contains(&id) { targets.push(id); }
        }
    }
    drop(model);
    start_refresh_ids(targets, request_id, state, emitter, "refresh_paths");
}

fn start_refresh_ids(targets: Vec<NodeId>, request_id: String, state: Arc<EngineState>, emitter: Emitter, operation: &'static str) {
    if !state.live_model.load(Ordering::Acquire) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":operation,"message":"Incremental refresh is available only for a completed live scan"}));
        return;
    }
    if targets.is_empty() {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":operation,"message":"No refreshable directory was selected"}));
        return;
    }
    if state.scanning.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":operation,"message":"Another scan or refresh is active"}));
        return;
    }
    if state.analyzing.load(Ordering::Acquire) {
        state.scanning.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":operation,"message":"Another scan or analysis is active"}));
        return;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let pause = Arc::new(AtomicBool::new(false));
    *state.cancel.lock() = Some(cancel.clone());
    *state.pause.lock() = Some(pause.clone());
    let options = state.last_scan_options.lock().clone();
    emitter.emit_value(json!({"event":"refresh_started","request_id":request_id,"targets":targets.len()}));

    thread::spawn(move || {
        let mut reports = Vec::new();
        let mut errors = Vec::new();
        for (index, original_id) in targets.into_iter().enumerate() {
            if cancel.load(Ordering::Relaxed) { break; }
            let target = {
                let current = state.model.read().clone();
                current.as_deref().and_then(|model| resolve_existing_refresh_target(model, original_id))
            };
            let Some((target_id, path)) = target else {
                errors.push(format!("Refresh target {original_id} no longer has an existing ancestor inside the scan root"));
                continue;
            };
            emitter.emit_value(json!({
                "event":"refresh_progress","request_id":request_id,"index":index,
                "target_id":target_id,"path":path.to_string_lossy()
            }));
            match run_scan_quiet(path.clone(), options.clone(), cancel.clone(), pause.clone(), emitter.clone(), format!("refresh-{target_id}")) {
                Ok((fresh, cancelled)) if !cancelled => {
                    let mut guard = state.model.write();
                    if let Some(model_arc) = guard.as_mut() {
                        let model = Arc::make_mut(model_arc);
                        match model.reconcile_subtree(target_id, &fresh, options.deduplicate_hardlinks) {
                            Ok(report) => reports.push(report),
                            Err(message) => errors.push(format!("{}: {message}", path.display())),
                        }
                    }
                }
                Ok((_fresh, _)) => break,
                Err(message) => errors.push(format!("{}: {message}", path.display())),
            }
        }

        let cancelled = cancel.load(Ordering::Relaxed);
        let completion = if let Some(model) = state.model.read().clone() {
            state.selection.lock().retain(|id| model.node_summary(*id).is_some());
            let root = model.node_summary(0);
            let summary = summary_json(&model);
            let extension_stats = model.extension_stats.clone();
            let statistics = model.statistics.clone();
            Some(json!({
                "event":if cancelled { "refresh_cancelled" } else { "refresh_completed" },
                "request_id":request_id,"root":root,"summary":summary,
                "extension_stats":extension_stats,"statistics":statistics,
                "reports":reports,"errors":errors
            }))
        } else { None };
        *state.cancel.lock() = None;
        *state.pause.lock() = None;
        state.scanning.store(false, Ordering::Release);
        if let Some(completion) = completion { emitter.emit_value(completion); }
    });
}

fn resolve_existing_refresh_target(model: &model::ScanModel, id: NodeId) -> Option<(NodeId, PathBuf)> {
    let mut current = Some(id);
    while let Some(node_id) = current {
        let node = model.nodes.get(node_id as usize)?;
        if node.active && node.kind == NodeKind::Directory {
            let path = PathBuf::from(model.path_for(node_id));
            if path.is_dir() { return Some((node_id, path)); }
        }
        current = node.parent_id;
    }
    None
}

fn refresh_target_for_path(model: &model::ScanModel, path: &Path) -> Option<NodeId> {
    let root = &model.root_path;
    if !path.starts_with(root) { return None; }
    let mut candidate = path.to_path_buf();
    loop {
        if let Some(id) = model.find_by_path(&candidate) {
            let node = &model.nodes[id as usize];
            return if node.kind == NodeKind::Directory { Some(id) } else { node.parent_id };
        }
        if candidate == *root { return Some(0); }
        if !candidate.pop() { break; }
    }
    None
}

fn start_watcher(command: Value, request_id: String, state: &Arc<EngineState>, emitter: &Emitter) {
    if !state.live_model.load(Ordering::Acquire) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"watch_start","message":"Filesystem watching is available only for a completed live scan"}));
        return;
    }
    if state.scanning.load(Ordering::Acquire) || state.analyzing.load(Ordering::Acquire) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"watch_start","message":"Cannot start watching while a scan or analysis is active"}));
        return;
    }
    let root = state.model.read().clone().map(|model| model.root_path.clone());
    let Some(root) = root else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"watch_start","message":"No completed scan is loaded"}));
        return;
    };
    stop_watcher(state, emitter, false);
    let debounce_ms = command.get("debounce_ms").and_then(Value::as_u64).unwrap_or(750).clamp(100, 60_000);
    match watcher::WatchService::start(root.clone(), Duration::from_millis(debounce_ms), emitter.clone()) {
        Ok(service) => {
            *state.watcher.lock() = Some(service);
            emitter.emit_value(json!({"event":"watcher_state","request_id":request_id,"state":"watching","root":root.to_string_lossy(),"debounce_ms":debounce_ms}));
        }
        Err(message) => emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"watch_start","message":message})),
    }
}

fn stop_watcher(state: &Arc<EngineState>, emitter: &Emitter, announce: bool) {
    let mut service = state.watcher.lock().take();
    if let Some(service) = service.as_mut() { service.stop(); }
    if announce && service.is_some() { emitter.emit_value(json!({"event":"watcher_state","state":"not_watching"})); }
}

fn set_watcher_pause(state: &Arc<EngineState>, emitter: &Emitter, request_id: String, paused: bool) {
    let watcher = state.watcher.lock();
    let Some(service) = watcher.as_ref() else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":if paused {"watch_pause"} else {"watch_resume"},"message":"Filesystem watching is not active"}));
        return;
    };
    service.set_paused(paused);
    emitter.emit_value(json!({"event":"watcher_state","request_id":request_id,"state":if paused {"paused"} else {"watching"}}));
}

fn emit_watcher_status(state: &Arc<EngineState>, emitter: &Emitter, request_id: String) {
    let watcher = state.watcher.lock();
    if let Some(service) = watcher.as_ref() {
        emitter.emit_value(json!({
            "event":"watcher_state","request_id":request_id,
            "state":if service.is_paused() {"paused"} else {"watching"},
            "root":service.root().to_string_lossy()
        }));
    } else {
        emitter.emit_value(json!({"event":"watcher_state","request_id":request_id,"state":"not_watching"}));
    }
}

fn history_status(request_id: String, state: &Arc<EngineState>, emitter: &Emitter) {
    let Some(path) = state.history_path.as_deref() else {
        emitter.emit_value(json!({"event":"history_status","request_id":request_id,"available":false,"message":"Application data path is unavailable"}));
        return;
    };
    match history::database_status(path) {
        Ok((schema_version, scans)) => emitter.emit_value(json!({"event":"history_status","request_id":request_id,"available":true,"schema_version":schema_version,"scans":scans})),
        Err(message) => emitter.emit_value(json!({"event":"history_status","request_id":request_id,"available":false,"message":message})),
    }
}

fn start_history_store(request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_store_current","message":"Another scan or analysis is active"}));
        return;
    }
    let Some(path) = state.history_path.clone() else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_store_current","message":"Application data path is unavailable"}));
        return;
    };
    let model = state.model.read().clone();
    let Some(model) = model else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_store_current","message":"No completed scan is loaded"}));
        return;
    };
    thread::spawn(move || {
        let result = history::store_scan(&path, &model);
        state.analyzing.store(false, Ordering::Release);
        match result {
            Ok(entry) => emitter.emit_value(json!({"event":"history_stored","request_id":request_id,"entry":entry})),
            Err(message) => emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_store_current","message":message})),
        }
    });
}

fn start_history_list(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    let Some(path) = state.history_path.clone() else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_list","message":"Application data path is unavailable"}));
        return;
    };
    let offset = usize_arg(&command, "offset", 0);
    let limit = usize_arg(&command, "limit", 100).clamp(1, 500);
    thread::spawn(move || match history::list_scans(&path, offset, limit) {
        Ok((total, items)) => emitter.emit_value(json!({"event":"history_list","request_id":request_id,"offset":offset,"total":total,"items":items})),
        Err(message) => emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_list","message":message})),
    });
}

fn start_history_load(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_load","message":"Another scan or analysis is active"}));
        return;
    }
    let Some(path) = state.history_path.clone() else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_load","message":"Application data path is unavailable"}));
        return;
    };
    let scan_id = command.get("scan_id").and_then(Value::as_i64).unwrap_or(-1);
    stop_watcher(&state, &emitter, false);
    thread::spawn(move || {
        let completion = match history::load_scan(&path, scan_id) {
            Ok((model, entry)) => {
                let root = model.node_summary(0);
                let summary = summary_json(&model);
                let extension_stats = model.extension_stats.clone();
                let statistics = model.statistics.clone();
                *state.model.write() = Some(Arc::new(model));
                state.selection.lock().clear();
                state.live_model.store(false, Ordering::Release);
                json!({
                    "event":"history_loaded","request_id":request_id,"entry":entry,"root":root,
                    "summary":summary,"extension_stats":extension_stats,"statistics":statistics
                })
            }
            Err(message) => json!({"event":"operation_failed","request_id":request_id,"operation":"history_load","message":message}),
        };
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(completion);
    });
}

fn start_history_delete(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    let Some(path) = state.history_path.clone() else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_delete","message":"Application data path is unavailable"}));
        return;
    };
    let scan_id = command.get("scan_id").and_then(Value::as_i64).unwrap_or(-1);
    thread::spawn(move || match history::delete_scan(&path, scan_id) {
        Ok(deleted) => emitter.emit_value(json!({"event":"history_deleted","request_id":request_id,"scan_id":scan_id,"deleted":deleted})),
        Err(message) => emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"history_delete","message":message})),
    });
}

fn start_compare_history(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"compare_history","message":"Another scan or analysis is active"}));
        return;
    }
    let Some(path) = state.history_path.clone() else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"compare_history","message":"Application data path is unavailable"}));
        return;
    };
    let scan_id = command.get("scan_id").and_then(Value::as_i64).unwrap_or(-1);
    let limit = usize_arg(&command, "limit", 2000);
    let current = state.model.read().clone();
    let Some(current) = current else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"compare_history","message":"No completed scan is loaded"}));
        return;
    };
    thread::spawn(move || {
        let completion = match history::load_scan(&path, scan_id) {
            Ok((before, entry)) => {
                let result = snapshot::compare_models(&before, &current, limit);
                json!({"event":"comparison_completed","request_id":request_id,"history_entry":entry,"result":result})
            }
            Err(message) => json!({"event":"operation_failed","request_id":request_id,"operation":"compare_history","message":message}),
        };
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(completion);
    });
}

fn start_batch_trash(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"batch_trash","message":"Another scan or analysis is active"}));
        return;
    }
    if !state.live_model.load(Ordering::Acquire) {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"batch_trash","message":"Filesystem actions are disabled for saved/history scans"}));
        return;
    }
    let explicit = node_ids_arg(&command, "node_ids", 100_000);
    let selected: Vec<NodeId> = if explicit.is_empty() { state.selection.lock().iter().copied().collect() } else { explicit };
    let model = state.model.read().clone();
    let Some(model) = model else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"batch_trash","message":"No completed scan is loaded"}));
        return;
    };
    let targets = model.normalized_selection(&selected);
    thread::spawn(move || {
        let mut succeeded_ids = Vec::new();
        let mut errors = Vec::new();
        let mut refresh_paths: HashSet<String> = HashSet::new();
        let attempted = targets.len();
        for id in targets {
            if id == 0 {
                if errors.len() < 200 { errors.push(json!({"node_id":id,"message":"Refusing to trash the scan root"})); }
                continue;
            }
            let Some(node) = model.node_summary(id) else { continue; };
            let path = match filesystem_ops::validated_trash_path(&model, id) {
                Ok(path) => path,
                Err(message) => {
                    if errors.len() < 200 { errors.push(json!({"node_id":id,"path":node.path,"message":message})); }
                    continue;
                }
            };
            if let Some(parent) = path.parent() { if refresh_paths.len() < 2048 { refresh_paths.insert(parent.to_string_lossy().into_owned()); } }
            match trash::delete(&path) {
                Ok(()) => succeeded_ids.push(id),
                Err(error) => if errors.len() < 200 { errors.push(json!({"node_id":id,"path":node.path,"message":error.to_string()})); },
            }
        }
        let succeeded = succeeded_ids.len();
        let failed = attempted.saturating_sub(succeeded);
        {
            let success_set: HashSet<NodeId> = succeeded_ids.into_iter().collect();
            state.selection.lock().retain(|id| !success_set.contains(id));
        }
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({
            "event":"batch_trash_completed","request_id":request_id,"attempted":attempted,
            "succeeded":succeeded,"failed":failed,"errors":errors,
            "refresh_paths":refresh_paths.into_iter().collect::<Vec<_>>()
        }));
    });
}

fn start_hash_selection(command: Value, request_id: String, state: Arc<EngineState>, emitter: Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.swap(true, Ordering::AcqRel) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"hash_selection","message":"Another scan or analysis is active"}));
        return;
    }
    if !state.live_model.load(Ordering::Acquire) {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"hash_selection","message":"Hash calculation is disabled for saved/history scans because filesystem contents may have changed"}));
        return;
    }
    let max_files = usize_arg(&command, "max_files", 5000).clamp(1, 5000);
    let explicit = node_ids_arg(&command, "node_ids", 100_000);
    let selected: Vec<NodeId> = if explicit.is_empty() { state.selection.lock().iter().copied().collect() } else { explicit };
    let model = state.model.read().clone();
    let Some(model) = model else {
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"hash_selection","message":"No completed scan is loaded"}));
        return;
    };
    let files = selected_files(&model, &selected, max_files);
    let cancel = Arc::new(AtomicBool::new(false));
    *state.analysis_cancel.lock() = Some(cancel.clone());
    thread::spawn(move || {
        let mut results = Vec::new();
        let mut errors = Vec::new();
        for id in files {
            if cancel.load(Ordering::Relaxed) { break; }
            let Some(node) = model.node_summary(id) else { continue; };
            match duplicates::hash_file_blake3(&node.path, &cancel) {
                Ok(Some(hash)) => results.push(json!({"node_id":id,"path":node.path,"size":node.size,"blake3":hash})),
                Ok(None) => break,
                Err(error) => if errors.len() < 200 { errors.push(json!({"node_id":id,"path":node.path,"message":error.to_string()})); },
            }
        }
        *state.analysis_cancel.lock() = None;
        state.analyzing.store(false, Ordering::Release);
        emitter.emit_value(json!({"event":"hash_selection_completed","request_id":request_id,"results":results,"errors":errors,"cancelled":cancel.load(Ordering::Relaxed)}));
    });
}

fn selected_files(model: &model::ScanModel, selected: &[NodeId], max_files: usize) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack = model.normalized_selection(selected);
    while let Some(id) = stack.pop() {
        let Some(node) = model.nodes.get(id as usize) else { continue; };
        if !node.active { continue; }
        match node.kind {
            NodeKind::File if !node.hardlink_duplicate => {
                out.push(id);
                if out.len() >= max_files { break; }
            }
            NodeKind::Directory => {
                for child in node.children.iter().rev().copied() { stack.push(child); }
            }
            _ => {}
        }
    }
    out
}

fn trash_node(command: Value, request_id: String, state: &Arc<EngineState>, emitter: &Emitter) {
    if state.scanning.load(Ordering::Acquire) || state.analyzing.load(Ordering::Acquire) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"trash","message":"Another scan or analysis is active"}));
        return;
    }
    if !state.live_model.load(Ordering::Acquire) {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"trash","message":"Filesystem actions are disabled for saved/history scans"}));
        return;
    }
    let node_id = u32_arg(&command, "node_id", 0);
    if node_id == 0 {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"trash","message":"Refusing to trash the scan root"}));
        return;
    }
    let model = state.model.read().clone();
    let Some(model) = model else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"trash","message":"No completed scan is loaded"}));
        return;
    };
    let Some(node) = model.node_summary(node_id) else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"trash","message":"Unknown node"}));
        return;
    };
    let path = match filesystem_ops::validated_trash_path(&model, node_id) {
        Ok(path) => path,
        Err(message) => {
            emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"trash","node_id":node_id,"message":message}));
            return;
        }
    };
    match trash::delete(&path) {
        Ok(()) => emitter.emit_value(json!({"event":"operation_completed","request_id":request_id,"operation":"trash","node_id":node_id,"path":node.path})),
        Err(error) => emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"operation":"trash","node_id":node_id,"path":node.path,"message":error.to_string()})),
    }
}

fn summary_json(model: &model::ScanModel) -> Value {
    let root = model.node_summary(0);
    json!({
        "files": root.as_ref().map(|n| n.file_count).unwrap_or(0),
        "directories": root.as_ref().map(|n| n.dir_count).unwrap_or(0) + 1,
        "bytes": model.scanned_bytes,
        "allocated_bytes": model.allocated_bytes,
        "errors": model.error_count,
        "excluded": model.excluded_count,
        "elapsed_ms": model.scan_elapsed_ms,
        "filesystem_total_bytes": model.filesystem_total_bytes,
        "filesystem_available_bytes": model.filesystem_available_bytes,
        "filesystem_used_bytes": model.filesystem_total_bytes.zip(model.filesystem_available_bytes)
            .map(|(total, available)| total.saturating_sub(available))
    })
}

fn with_model<F>(state: &Arc<EngineState>, emitter: &Emitter, request_id: String, f: F)
where F: FnOnce(&model::ScanModel) -> Value {
    let model = state.model.read().clone();
    if let Some(model) = model {
        let mut value = f(&model);
        if let Some(object) = value.as_object_mut() {
            object.insert("request_id".into(), Value::String(request_id));
        }
        emitter.emit_value(value);
    } else {
        emitter.emit_value(json!({"event":"operation_failed","request_id":request_id,"message":"No completed scan is loaded"}));
    }
}

fn command_basis_name(basis: SizeBasis) -> &'static str {
    match basis { SizeBasis::Logical => "logical", SizeBasis::Allocated => "allocated" }
}

fn parse_node_kind(value: &str) -> Option<NodeKind> {
    match value {
        "directory" => Some(NodeKind::Directory), "file" => Some(NodeKind::File),
        "symlink" => Some(NodeKind::Symlink), "other" => Some(NodeKind::Other), _ => None,
    }
}

fn u32_arg(value: &Value, key: &str, default: u32) -> NodeId {
    value.get(key).and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok()).unwrap_or(default)
}
fn usize_arg(value: &Value, key: &str, default: usize) -> usize {
    value.get(key).and_then(Value::as_u64).and_then(|v| usize::try_from(v).ok()).unwrap_or(default)
}
fn string_arg(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(ToOwned::to_owned)
}

fn node_ids_arg(value: &Value, key: &str, max_items: usize) -> Vec<NodeId> {
    value.get(key).and_then(Value::as_array).map(|values| {
        values.iter().take(max_items).filter_map(Value::as_u64)
            .filter_map(|id| u32::try_from(id).ok()).collect()
    }).unwrap_or_default()
}

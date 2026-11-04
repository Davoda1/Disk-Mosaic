use crate::model::{NodeKind, ScanModel};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SNAPSHOT_FORMAT: u32 = 1;

#[derive(Debug, Deserialize)]
struct SnapshotFile {
    format: u32,
    application: String,
    #[serde(rename = "version")]
    _version: String,
    saved_ms: u64,
    model: ScanModel,
}

#[derive(Serialize)]
struct SnapshotFileRef<'a> {
    format: u32,
    application: &'static str,
    version: &'static str,
    saved_ms: u64,
    model: &'a ScanModel,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfo {
    pub root_path: String,
    pub saved_ms: u64,
    pub logical_bytes: u64,
    pub allocated_bytes: u64,
    pub files: u64,
    pub directories: u64,
    pub nodes: usize,
    pub errors: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComparisonChange {
    pub relative_path: String,
    pub name: String,
    pub kind: NodeKind,
    pub current_id: Option<u32>,
    pub status: String,
    pub before_size: u64,
    pub after_size: u64,
    pub before_allocated: u64,
    pub after_allocated: u64,
    pub delta_abs: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComparisonDeltaNode {
    pub relative_path: String,
    pub parent_path: String,
    pub name: String,
    pub current_id: Option<u32>,
    pub status: String,
    pub logical_delta: i64,
    pub allocated_delta: i64,
    pub magnitude: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComparisonResult {
    pub snapshot_root: String,
    pub current_root: String,
    pub compatible_root: bool,
    pub before_logical: u64,
    pub after_logical: u64,
    pub before_allocated: u64,
    pub after_allocated: u64,
    pub logical_delta: i64,
    pub allocated_delta: i64,
    pub before_files: u64,
    pub after_files: u64,
    pub files_added: u64,
    pub files_removed: u64,
    pub files_changed: u64,
    pub allocation_only: u64,
    pub created: u64,
    pub deleted: u64,
    pub grown: u64,
    pub shrunk: u64,
    pub changed: u64,
    pub unchanged: u64,
    pub changes: Vec<ComparisonChange>,
    pub hierarchy: Vec<ComparisonDeltaNode>,
}

pub fn save_snapshot(path: &Path, model: &ScanModel) -> Result<SnapshotInfo, String> {
    let saved_ms = now_ms();
    // Serialize by reference: a multi-million-node scan can already occupy substantial
    // memory, so saving must not clone the entire arena merely to wrap it in metadata.
    let snapshot = SnapshotFileRef {
        format: SNAPSHOT_FORMAT,
        application: "DiskMosaic",
        version: env!("CARGO_PKG_VERSION"),
        saved_ms,
        model,
    };

    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create snapshot directory {}: {e}", parent.display()))?;
    }
    let tmp = temporary_path(path);
    let file = File::create(&tmp).map_err(|e| format!("Cannot create snapshot {}: {e}", tmp.display()))?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, &snapshot).map_err(|e| format!("Cannot serialize snapshot: {e}"))?;
    writer.flush().map_err(|e| format!("Cannot flush snapshot: {e}"))?;
    writer.get_ref().sync_all().map_err(|e| format!("Cannot sync snapshot: {e}"))?;
    replace_snapshot_file(&tmp, path)?;
    Ok(info_from_model(model, saved_ms))
}

pub fn load_snapshot(path: &Path) -> Result<(ScanModel, SnapshotInfo), String> {
    let file = File::open(path).map_err(|e| format!("Cannot open snapshot {}: {e}", path.display()))?;
    let reader = BufReader::new(file);
    let mut snapshot: SnapshotFile = serde_json::from_reader(reader).map_err(|e| format!("Cannot parse snapshot: {e}"))?;
    if snapshot.format != SNAPSHOT_FORMAT {
        return Err(format!("Unsupported DiskMosaic snapshot format {}", snapshot.format));
    }
    if snapshot.application != "DiskMosaic" {
        return Err("The selected file is not a DiskMosaic snapshot".to_string());
    }
    snapshot.model.validate_structure().map_err(|error| format!("Invalid snapshot: {error}"))?;
    snapshot.model.build_indexes();
    let info = info_from_model(&snapshot.model, snapshot.saved_ms);
    Ok((snapshot.model, info))
}

pub fn compare_snapshot(path: &Path, current: &ScanModel, limit: usize) -> Result<ComparisonResult, String> {
    let (before, _) = load_snapshot(path)?;
    Ok(compare_models(&before, current, limit))
}

pub fn compare_models(before: &ScanModel, current: &ScanModel, limit: usize) -> ComparisonResult {
    let limit = limit.clamp(1, 5000);

    #[derive(Clone, Copy)]
    struct Entry { kind: NodeKind, logical: u64, allocated: u64 }

    let mut previous: HashMap<String, Entry> = HashMap::with_capacity(before.nodes.len().saturating_mul(4) / 3);
    for node in before.nodes.iter().skip(1).filter(|node| node.active) {
        previous.insert(before.relative_path_for(node.id), Entry {
            kind: node.kind,
            logical: node.size,
            allocated: node.allocated_size,
        });
    }

    let mut created = 0u64;
    let mut deleted = 0u64;
    let mut grown = 0u64;
    let mut shrunk = 0u64;
    let mut changed = 0u64;
    let mut unchanged = 0u64;
    let mut files_added = 0u64;
    let mut files_removed = 0u64;
    let mut files_changed = 0u64;
    let mut allocation_only = 0u64;
    // Min-heap encoded with Reverse(delta), then a stable serial so we only retain
    // the most significant changes without materializing/sorting every change.
    let mut heap: BinaryHeap<(Reverse<u64>, u64, String, NodeKind, Option<u32>, String, u64, u64, u64, u64)> =
        BinaryHeap::with_capacity(limit.saturating_add(1));
    let mut serial = 0u64;
    let mut hierarchy_heap: BinaryHeap<(Reverse<u64>, u64, String, Option<u32>, String, i64, i64)> =
        BinaryHeap::with_capacity(limit.saturating_add(1));
    let mut hierarchy_serial = 0u64;

    let mut push_hierarchy = |relative_path: String, current_id: Option<u32>, status: &str,
                              before_size: u64, after_size: u64,
                              before_allocated: u64, after_allocated: u64| {
        let magnitude = before_size.abs_diff(after_size).max(before_allocated.abs_diff(after_allocated));
        if magnitude == 0 { return; }
        hierarchy_serial = hierarchy_serial.saturating_add(1);
        let logical_delta = signed_delta(after_size, before_size);
        let allocated_delta = signed_delta(after_allocated, before_allocated);
        let entry = (Reverse(magnitude), hierarchy_serial, relative_path, current_id, status.to_string(), logical_delta, allocated_delta);
        if hierarchy_heap.len() < limit {
            hierarchy_heap.push(entry);
        } else if hierarchy_heap.peek().map(|smallest| magnitude > (smallest.0).0).unwrap_or(false) {
            hierarchy_heap.pop();
            hierarchy_heap.push(entry);
        }
    };

    let mut push_change = |relative_path: String, kind: NodeKind, current_id: Option<u32>, status: &str,
                           before_size: u64, after_size: u64,
                           before_allocated: u64, after_allocated: u64| {
        let delta = before_size.abs_diff(after_size).max(before_allocated.abs_diff(after_allocated));
        serial = serial.saturating_add(1);
        let entry = (Reverse(delta), serial, relative_path, kind, current_id, status.to_string(), before_size, after_size, before_allocated, after_allocated);
        if heap.len() < limit {
            heap.push(entry);
        } else if heap.peek().map(|smallest| delta > (smallest.0).0).unwrap_or(false) {
            heap.pop();
            heap.push(entry);
        }
    };

    for node in current.nodes.iter().skip(1).filter(|node| node.active) {
        let relative = current.relative_path_for(node.id);
        match previous.remove(&relative) {
            None => {
                created = created.saturating_add(1);
                if node.kind == NodeKind::File { files_added = files_added.saturating_add(1); }
                push_change(relative.clone(), node.kind, Some(node.id), "created", 0, node.size, 0, node.allocated_size);
                if node.kind == NodeKind::Directory { push_hierarchy(relative, Some(node.id), "created", 0, node.size, 0, node.allocated_size); }
            }
            Some(old) => {
                if old.logical == node.size && old.allocated == node.allocated_size && old.kind == node.kind {
                    unchanged = unchanged.saturating_add(1);
                } else if old.logical == node.size && old.allocated == node.allocated_size {
                    changed = changed.saturating_add(1);
                    if old.kind == NodeKind::File || node.kind == NodeKind::File { files_changed = files_changed.saturating_add(1); }
                    push_change(relative.clone(), node.kind, Some(node.id), "type_changed",
                                old.logical, node.size, old.allocated, node.allocated_size);
                    if node.kind == NodeKind::Directory { push_hierarchy(relative, Some(node.id), "type_changed", old.logical, node.size, old.allocated, node.allocated_size); }
                } else {
                    let (is_growth, status) = if node.size != old.logical {
                        (node.size > old.logical, if node.size > old.logical { "grown" } else { "shrunk" })
                    } else {
                        (node.allocated_size > old.allocated, if node.allocated_size > old.allocated { "allocation_grown" } else { "allocation_shrunk" })
                    };
                    if node.size == old.logical && node.allocated_size != old.allocated { allocation_only = allocation_only.saturating_add(1); }
                    if node.kind == NodeKind::File { files_changed = files_changed.saturating_add(1); }
                    if is_growth { grown = grown.saturating_add(1); }
                    else { shrunk = shrunk.saturating_add(1); }
                    push_change(relative.clone(), node.kind, Some(node.id), status,
                                old.logical, node.size, old.allocated, node.allocated_size);
                    if node.kind == NodeKind::Directory { push_hierarchy(relative, Some(node.id), status, old.logical, node.size, old.allocated, node.allocated_size); }
                }
            }
        }
    }

    for (relative, old) in previous {
        deleted = deleted.saturating_add(1);
        if old.kind == NodeKind::File { files_removed = files_removed.saturating_add(1); }
        push_change(relative.clone(), old.kind, None, "deleted", old.logical, 0, old.allocated, 0);
        if old.kind == NodeKind::Directory { push_hierarchy(relative, None, "deleted", old.logical, 0, old.allocated, 0); }
    }

    let mut changes: Vec<ComparisonChange> = heap.into_iter().map(|entry| {
        let (Reverse(delta_abs), _serial, relative_path, kind, current_id, status, before_size, after_size, before_allocated, after_allocated) = entry;
        let name = relative_path.rsplit('/').next().unwrap_or(&relative_path).to_string();
        ComparisonChange { relative_path, name, kind, current_id, status, before_size, after_size, before_allocated, after_allocated, delta_abs }
    }).collect();
    changes.sort_by(|a, b| b.delta_abs.cmp(&a.delta_abs).then_with(|| a.relative_path.cmp(&b.relative_path)));

    let mut hierarchy: Vec<ComparisonDeltaNode> = hierarchy_heap.into_iter().map(|entry| {
        let (Reverse(magnitude), _serial, relative_path, current_id, status, logical_delta, allocated_delta) = entry;
        let name = relative_path.rsplit('/').next().unwrap_or(&relative_path).to_string();
        let parent_path = relative_path.rsplit_once('/').map(|(parent, _)| parent.to_string()).unwrap_or_default();
        ComparisonDeltaNode { relative_path, parent_path, name, current_id, status, logical_delta, allocated_delta, magnitude }
    }).collect();
    hierarchy.sort_by(|a, b| b.magnitude.cmp(&a.magnitude).then_with(|| a.relative_path.cmp(&b.relative_path)));

    let before_files = before.nodes.first().filter(|node| node.active).map(|node| node.file_count).unwrap_or(0);
    let after_files = current.nodes.first().filter(|node| node.active).map(|node| node.file_count).unwrap_or(0);

    ComparisonResult {
        snapshot_root: before.root_path.to_string_lossy().into_owned(),
        current_root: current.root_path.to_string_lossy().into_owned(),
        compatible_root: canonical_root_key(&before.root_path) == canonical_root_key(&current.root_path),
        before_logical: before.scanned_bytes,
        after_logical: current.scanned_bytes,
        before_allocated: before.allocated_bytes,
        after_allocated: current.allocated_bytes,
        logical_delta: signed_delta(current.scanned_bytes, before.scanned_bytes),
        allocated_delta: signed_delta(current.allocated_bytes, before.allocated_bytes),
        before_files,
        after_files,
        files_added,
        files_removed,
        files_changed,
        allocation_only,
        created,
        deleted,
        grown,
        shrunk,
        changed,
        unchanged,
        changes,
        hierarchy,
    }
}

fn signed_delta(after: u64, before: u64) -> i64 {
    if after >= before {
        i64::try_from(after - before).unwrap_or(i64::MAX)
    } else {
        -i64::try_from(before - after).unwrap_or(i64::MAX)
    }
}

fn info_from_model(model: &ScanModel, saved_ms: u64) -> SnapshotInfo {
    let root = model.nodes.first();
    SnapshotInfo {
        root_path: model.root_path.to_string_lossy().into_owned(),
        saved_ms,
        logical_bytes: model.scanned_bytes,
        allocated_bytes: model.allocated_bytes,
        files: root.map(|n| n.file_count).unwrap_or(0),
        directories: root.map(|n| n.dir_count.saturating_add(1)).unwrap_or(0),
        nodes: model.nodes.len(),
        errors: model.error_count,
    }
}

fn replace_snapshot_file(tmp: &Path, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return fs::rename(tmp, path).map_err(|e| format!("Cannot finalize snapshot {}: {e}", path.display()));
    }

    // Windows rename does not replace an existing destination. Preserve the old file
    // until the new one is safely in place so a final rename failure does not destroy
    // the user's previous snapshot.
    let mut backup = path.as_os_str().to_os_string();
    backup.push(format!(".backup-{}", std::process::id()));
    let backup = PathBuf::from(backup);
    let _ = fs::remove_file(&backup);
    fs::rename(path, &backup).map_err(|e| format!("Cannot prepare snapshot replacement {}: {e}", path.display()))?;
    match fs::rename(tmp, path) {
        Ok(()) => { let _ = fs::remove_file(&backup); Ok(()) }
        Err(error) => {
            let _ = fs::rename(&backup, path);
            let _ = fs::remove_file(tmp);
            Err(format!("Cannot finalize snapshot {}: {error}", path.display()))
        }
    }
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().map(|s| s.to_os_string()).unwrap_or_else(|| "snapshot".into());
    name.push(format!(".tmp-{}", std::process::id()));
    path.with_file_name(name)
}

fn canonical_root_key(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    { text.to_lowercase().trim_end_matches('/').to_string() }
    #[cfg(not(windows))]
    { text.trim_end_matches('/').to_string() }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Node, ScanStatistics};

    fn minimal(root: &str, size: u64) -> ScanModel {
        ScanModel {
            root_path: PathBuf::from(root),
            nodes: vec![Node {
                id: 0, parent_id: None, active: true, hidden: false, name: root.to_string(), kind: NodeKind::Directory,
                size, allocated_size: size, raw_size: 0, raw_allocated_size: 0,
                identity_volume: None, identity_index: None, modified_ms: None, extension: String::new(),
                type_hint: String::new(),
                children: vec![], file_count: 0, dir_count: 0, depth: 0,
                hardlink_duplicate: false, link_count: 1,
            }],
            errors: vec![], error_count: 0, excluded_count: 0, extension_stats: vec![],
            statistics: ScanStatistics::default(), largest: vec![], scanned_bytes: size,
            allocated_bytes: size, scan_elapsed_ms: 1, filesystem_total_bytes: None,
            filesystem_available_bytes: None,
        }
    }

    #[test]
    fn snapshot_round_trip() {
        let path = std::env::temp_dir().join(format!("diskmosaic-snapshot-test-{}.dmscan", std::process::id()));
        let model = minimal("/tmp/test", 42);
        save_snapshot(&path, &model).unwrap();
        let (loaded, info) = load_snapshot(&path).unwrap();
        assert_eq!(loaded.scanned_bytes, 42);
        assert_eq!(info.logical_bytes, 42);
        let _ = fs::remove_file(path);
    }
    fn with_child(name: &str) -> ScanModel {
        let mut model = minimal("/snapshot/root", 42);
        let mut child = model.nodes[0].clone();
        child.id = 1;
        child.parent_id = Some(0);
        child.depth = 1;
        child.name = name.to_string();
        child.kind = NodeKind::File;
        child.file_count = 1;
        model.nodes[0].children.push(1);
        model.nodes.push(child);
        model
    }

    #[test]
    fn snapshots_reject_invalid_graphs_and_path_components() {
        let path = std::env::temp_dir().join(format!("diskmosaic-invalid-snapshot-{}.dmscan", std::process::id()));
        let mut cases = Vec::new();
        let mut model = with_child("file.bin");
        model.nodes[0].children.push(99);
        cases.push(model);
        let mut model = with_child("file.bin");
        model.nodes[1].parent_id = Some(1);
        cases.push(model);
        let mut model = with_child("file.bin");
        model.nodes[1].id = 99;
        cases.push(model);
        let mut model = with_child("file.bin");
        model.nodes[0].children.push(1);
        cases.push(model);
        let mut model = with_child("file.bin");
        model.nodes[0].children.clear();
        cases.push(model);
        cases.push(with_child("../escape"));
        cases.push(with_child("/outside"));
        cases.push(with_child(".."));
        cases.push(with_child("file/"));
        cases.push(with_child("file/."));
        for (index, model) in cases.iter().enumerate() {
            save_snapshot(&path, model).unwrap();
            assert!(load_snapshot(&path).is_err(), "invalid snapshot case {index} was accepted");
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn snapshot_load_rebuilds_untrusted_derived_indexes() {
        let path = std::env::temp_dir().join(format!("diskmosaic-reindex-snapshot-{}.dmscan", std::process::id()));
        let mut model = with_child("file.bin");
        model.largest = vec![u32::MAX];
        save_snapshot(&path, &model).unwrap();
        let (loaded, _) = load_snapshot(&path).unwrap();
        assert_eq!(loaded.largest, vec![1]);
        assert_eq!(loaded.path_for(1), PathBuf::from("/snapshot/root").join("file.bin").to_string_lossy());
        let _ = fs::remove_file(path);
    }
}

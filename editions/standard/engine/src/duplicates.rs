use crate::history;
use crate::model::{Node, NodeId, NodeKind, ScanModel};
use crate::protocol::Emitter;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

const SAMPLE_BYTES: usize = 64 * 1024;
const HASH_BUFFER: usize = 512 * 1024;
const COMPARE_BUFFER: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateItem {
    pub id: NodeId,
    pub path: String,
    pub directory: String,
    pub size: u64,
    pub allocated_size: u64,
    pub modified_ms: Option<u64>,
    pub device: Option<u64>,
    pub file_id: Option<u64>,
    pub hard_link_count: u64,
    pub hard_linked: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub content_hash: String,
    pub size: u64,
    pub files: usize,
    pub allocated_size: u64,
    pub recoverable_logical: u64,
    pub recoverable_allocated: u64,
    pub items: Vec<DuplicateItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateResult {
    pub groups: Vec<DuplicateGroup>,
    pub candidate_files: u64,
    pub sample_hashed_files: u64,
    pub full_hashed_files: u64,
    pub cache_hits: u64,
    pub compared_files: u64,
    pub errors: u64,
    pub recoverable_logical: u64,
    pub recoverable_allocated: u64,
    pub cancelled: bool,
}

pub fn find_duplicates(
    model: &ScanModel,
    cancel: &AtomicBool,
    emitter: &Emitter,
    analysis_id: &str,
    min_size: u64,
    max_groups: usize,
    history_db: Option<&Path>,
) -> DuplicateResult {
    let min_size = min_size.max(1);
    let max_groups = max_groups.clamp(1, 5000);
    let mut by_size: HashMap<u64, Vec<NodeId>> = HashMap::new();
    for node in &model.nodes {
        if node.active && node.kind == NodeKind::File && !node.hardlink_duplicate && node.size >= min_size {
            by_size.entry(node.size).or_default().push(node.id);
        }
    }
    by_size.retain(|_, ids| ids.len() > 1);
    let candidate_files = by_size.values().map(|ids| ids.len() as u64).sum::<u64>();
    emitter.emit_value(json!({
        "event":"duplicate_started", "analysis_id":analysis_id,
        "candidate_files":candidate_files, "size_groups":by_size.len(), "min_size":min_size
    }));

    let mut sample_hashed_files = 0u64;
    let mut full_hashed_files = 0u64;
    let mut cache_hits = 0u64;
    let mut compared_files = 0u64;
    let mut errors = 0u64;
    let mut verified: Vec<DuplicateGroup> = Vec::new();

    let mut size_groups: Vec<(u64, Vec<NodeId>)> = by_size.into_iter().collect();
    size_groups.sort_by(|a, b| b.0.cmp(&a.0));

    for (group_index, (size, ids)) in size_groups.into_iter().enumerate() {
        if cancel.load(Ordering::Relaxed) { break; }
        let mut samples: HashMap<String, Vec<(NodeId, Option<String>)>> = HashMap::new();
        for id in ids {
            if cancel.load(Ordering::Relaxed) { break; }
            let node = &model.nodes[id as usize];
            let path = model.path_for(id);
            // Cache validity is checked against the current file, not only the
            // older scan. A changed/replaced entry needs a fresh scan first.
            if !matches_scanned_file(node, &path) {
                errors = errors.saturating_add(1);
                continue;
            }
            let key = cache_key(node, &path);
            let cached = history_db.and_then(|db| history::get_fingerprint(db, &key, size, node.modified_ms).ok().flatten());
            let (sample, full) = if let Some(cached) = cached {
                cache_hits = cache_hits.saturating_add(1);
                (cached.sample_hash, cached.full_hash)
            } else {
                match sample_hash(&path, size) {
                    Ok(hash) => {
                        sample_hashed_files = sample_hashed_files.saturating_add(1);
                        if let Some(db) = history_db { let _ = history::put_fingerprint(db, &key, size, node.modified_ms, &hash, None); }
                        (hash, None)
                    }
                    Err(_) => { errors = errors.saturating_add(1); continue; }
                }
            };
            samples.entry(sample).or_default().push((id, full));
        }

        for sample_ids in samples.into_values().filter(|ids| ids.len() > 1) {
            if cancel.load(Ordering::Relaxed) { break; }
            let mut by_full: HashMap<String, Vec<NodeId>> = HashMap::new();
            for (id, cached_full) in sample_ids {
                if cancel.load(Ordering::Relaxed) { break; }
                let node = &model.nodes[id as usize];
                let path = model.path_for(id);
                let key = cache_key(node, &path);
                let full = if let Some(hash) = cached_full {
                    hash
                } else {
                    match hash_file_blake3(&path, cancel) {
                        Ok(Some(hash)) => {
                            full_hashed_files = full_hashed_files.saturating_add(1);
                            // Preserve/recompute the sample alongside the full hash so
                            // the cache row remains self-contained and metadata-valid.
                            let sample = sample_hash(&path, size).unwrap_or_else(|_| hash.clone());
                            if let Some(db) = history_db { let _ = history::put_fingerprint(db, &key, size, node.modified_ms, &sample, Some(&hash)); }
                            hash
                        }
                        Ok(None) => break,
                        Err(_) => { errors = errors.saturating_add(1); continue; }
                    }
                };
                by_full.entry(full).or_default().push(id);
            }

            for (content_hash, hash_ids) in by_full.into_iter().filter(|(_, ids)| ids.len() > 1) {
                if cancel.load(Ordering::Relaxed) { break; }
                // BLAKE3 is used for fast grouping, but exact byte comparison still
                // confirms every candidate against a representative so the duplicate
                // result does not depend on cryptographic collision assumptions.
                let mut exact_groups: Vec<Vec<NodeId>> = Vec::new();
                'candidate: for id in hash_ids {
                    for exact in &mut exact_groups {
                        let representative = exact[0];
                        compared_files = compared_files.saturating_add(1);
                        match files_equal(&model.path_for(representative), &model.path_for(id), size, cancel) {
                            Ok(true) => { exact.push(id); continue 'candidate; }
                            Ok(false) => {}
                            Err(_) => { errors = errors.saturating_add(1); continue 'candidate; }
                        }
                    }
                    exact_groups.push(vec![id]);
                }

                for ids in exact_groups.into_iter().filter(|ids| ids.len() > 1) {
                    let mut items = Vec::with_capacity(ids.len());
                    let mut total_allocated = 0u64;
                    let mut smallest_allocated = u64::MAX;
                    for id in ids {
                        let node = &model.nodes[id as usize];
                        let path = model.path_for(id);
                        if !matches_scanned_file(node, &path) {
                            errors = errors.saturating_add(1);
                            continue;
                        }
                        total_allocated = total_allocated.saturating_add(node.allocated_size);
                        smallest_allocated = smallest_allocated.min(node.allocated_size);
                        let directory = PathBuf::from(&path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
                        items.push(DuplicateItem {
                            id, path, directory, size: node.size, allocated_size: node.allocated_size,
                            modified_ms: node.modified_ms, device: node.identity_volume, file_id: node.identity_index,
                            hard_link_count: node.link_count, hard_linked: node.link_count > 1,
                        });
                    }
                    if items.len() < 2 { continue; }
                    items.sort_by(|a, b| a.path.cmp(&b.path));
                    let files = items.len();
                    verified.push(DuplicateGroup {
                        content_hash: content_hash.clone(),
                        size, files, allocated_size: total_allocated,
                        recoverable_logical: size.saturating_mul((files.saturating_sub(1)) as u64),
                        recoverable_allocated: total_allocated.saturating_sub(smallest_allocated.min(total_allocated)),
                        items,
                    });
                }
            }
        }

        if group_index % 16 == 0 {
            emitter.emit_value(json!({
                "event":"duplicate_progress", "analysis_id":analysis_id,
                "candidate_files":candidate_files, "sample_hashed_files":sample_hashed_files,
                "full_hashed_files":full_hashed_files, "cache_hits":cache_hits,
                "compared_files":compared_files, "groups_found":verified.len(), "errors":errors
            }));
        }
    }

    verified.sort_by(|a, b| {
        b.recoverable_allocated.cmp(&a.recoverable_allocated)
            .then_with(|| b.recoverable_logical.cmp(&a.recoverable_logical))
            .then_with(|| b.size.cmp(&a.size))
    });
    if verified.len() > max_groups { verified.truncate(max_groups); }
    let recoverable_logical = verified.iter().fold(0u64, |sum, g| sum.saturating_add(g.recoverable_logical));
    let recoverable_allocated = verified.iter().fold(0u64, |sum, g| sum.saturating_add(g.recoverable_allocated));
    DuplicateResult {
        groups: verified, candidate_files, sample_hashed_files, full_hashed_files, cache_hits,
        compared_files, errors, recoverable_logical, recoverable_allocated,
        cancelled: cancel.load(Ordering::Relaxed),
    }
}

fn cache_key(node: &Node, path: &str) -> String {
    match (node.identity_volume, node.identity_index) {
        (Some(volume), Some(index)) => format!("id:{volume:016x}:{index:016x}"),
        _ => format!("path:{path}"),
    }
}

fn matches_scanned_file(node: &Node, path: &str) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else { return false; };
    if !metadata.is_file() || metadata.len() != node.size { return false; }
    if node.modified_ms.is_some() && crate::model::modified_ms(&metadata) != node.modified_ms {
        return false;
    }
    if let (Some(volume), Some(index)) = (node.identity_volume, node.identity_index) {
        let Ok(identity) = crate::platform::file_identity(Path::new(path), &metadata) else { return false; };
        if identity.volume != volume || identity.index != index { return false; }
    }
    true
}

fn sample_hash(path: &str, size: u64) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(&size.to_le_bytes());
    let first_len = SAMPLE_BYTES.min(usize::try_from(size).unwrap_or(SAMPLE_BYTES));
    let mut first = vec![0u8; first_len];
    file.read_exact(&mut first)?;
    hasher.update(&first);
    if size > SAMPLE_BYTES as u64 {
        let tail_len = SAMPLE_BYTES.min(usize::try_from(size).unwrap_or(SAMPLE_BYTES));
        file.seek(SeekFrom::End(-(tail_len as i64)))?;
        let mut tail = vec![0u8; tail_len];
        file.read_exact(&mut tail)?;
        hasher.update(&tail);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

pub fn hash_file_blake3(path: &str, cancel: &AtomicBool) -> std::io::Result<Option<String>> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; HASH_BUFFER];
    loop {
        if cancel.load(Ordering::Relaxed) { return Ok(None); }
        let read = file.read(&mut buffer)?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(Some(hasher.finalize().to_hex().to_string()))
}

fn files_equal(a: &str, b: &str, size: u64, cancel: &AtomicBool) -> std::io::Result<bool> {
    let mut left = File::open(a)?;
    let mut right = File::open(b)?;
    let left_before = left.metadata()?;
    let right_before = right.metadata()?;
    if !left_before.is_file() || !right_before.is_file()
        || left_before.len() != size || right_before.len() != size
    {
        return Ok(false);
    }
    let mut remaining = size;
    let mut a_buf = vec![0u8; COMPARE_BUFFER];
    let mut b_buf = vec![0u8; COMPARE_BUFFER];
    while remaining > 0 {
        if cancel.load(Ordering::Relaxed) { return Ok(false); }
        let take = usize::try_from(remaining.min(COMPARE_BUFFER as u64)).unwrap_or(COMPARE_BUFFER);
        left.read_exact(&mut a_buf[..take])?;
        right.read_exact(&mut b_buf[..take])?;
        if a_buf[..take] != b_buf[..take] { return Ok(false); }
        remaining -= take as u64;
    }
    // Matching prefixes are not enough: the files may have grown since the
    // scan, or while they were compared. Check EOF and stable handle metadata.
    let mut tail = [0u8; 1];
    if left.read(&mut tail)? != 0 || right.read(&mut tail)? != 0 { return Ok(false); }
    let left_after = left.metadata()?;
    let right_after = right.metadata()?;
    Ok(!cancel.load(Ordering::Relaxed)
        && left_after.len() == size && right_after.len() == size
        && left_before.modified().ok() == left_after.modified().ok()
        && right_before.modified().ok() == right_after.modified().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Node, ScanStatistics};
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (PathBuf, ScanModel) {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("diskmosaic-dupes-{}-{n}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.bin"), b"same-data").unwrap();
        fs::write(root.join("b.bin"), b"same-data").unwrap();
        fs::write(root.join("c.bin"), b"different").unwrap();
        let make = |id, name: &str, size| Node { id, parent_id: Some(0), active:true, hidden:false, name:name.into(), kind:NodeKind::File,
            size, allocated_size:size, raw_size:size, raw_allocated_size:size, identity_volume:None, identity_index:None,
            modified_ms:None, created_ms:None, owner_hint:String::new(), permissions_hint:String::new(), sparse:None, compressed:None, extension:".bin".into(), type_hint:String::new(), children:vec![], file_count:1,
            dir_count:0, depth:1, hardlink_duplicate:false, link_count:1 };
        let nodes = vec![
            Node { id:0,parent_id:None,active:true,hidden:false,name:"root".into(),kind:NodeKind::Directory,size:28,allocated_size:28,
                raw_size:0,raw_allocated_size:0,identity_volume:None,identity_index:None,modified_ms:None,created_ms:None,owner_hint:String::new(),permissions_hint:String::new(),sparse:None,compressed:None,
                extension:String::new(),type_hint:String::new(),children:vec![1,2,3],file_count:3,dir_count:0,depth:0,hardlink_duplicate:false,link_count:1 },
            make(1,"a.bin",9), make(2,"b.bin",9), make(3,"c.bin",9),
        ];
        let model = ScanModel { root_path:root.clone(), nodes, errors:vec![], error_count:0, excluded_count:0,
            extension_stats:vec![], statistics:ScanStatistics::default(), largest:vec![], scanned_bytes:27,
            allocated_bytes:27, scan_elapsed_ms:1, filesystem_total_bytes:None, filesystem_available_bytes:None };
        (root, model)
    }

    #[test]
    fn duplicate_analysis_is_exact_after_blake3_grouping() {
        let (root, model) = fixture();
        let cancel = AtomicBool::new(false);
        let result = find_duplicates(&model, &cancel, &Emitter::new(), "test", 1, 10, None);
        assert_eq!(result.groups.len(), 1);
        assert_eq!(result.groups[0].files, 2);
        assert_eq!(result.groups[0].recoverable_logical, 9);
        assert_eq!(result.groups[0].content_hash.len(), 64);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn exact_verification_rejects_matching_prefixes_of_changed_files() {
        let (root, _) = fixture();
        let a = root.join("a.bin").to_string_lossy().into_owned();
        let b = root.join("b.bin").to_string_lossy().into_owned();
        fs::write(&a, b"same-data-left").unwrap();
        fs::write(&b, b"same-data-right").unwrap();
        assert!(!files_equal(&a, &b, 9, &AtomicBool::new(false)).unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_analysis_rejects_files_changed_since_the_scan() {
        let (root, model) = fixture();
        fs::write(root.join("a.bin"), b"same-data-but-now-longer").unwrap();
        fs::write(root.join("b.bin"), b"same-data-but-now-longer").unwrap();
        let result = find_duplicates(&model, &AtomicBool::new(false), &Emitter::new(), "changed", 1, 10, None);
        assert!(result.groups.is_empty());
        assert_eq!(result.errors, 2);
        let _ = fs::remove_dir_all(root);
    }
}

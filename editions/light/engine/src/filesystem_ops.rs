use crate::model::{modified_ms, NodeId, NodeKind, ScanModel};
use crate::platform::file_identity;
use std::fs;
use std::path::PathBuf;

/// Resolve a destructive action only while the current entry still matches the
/// reviewed scan. This is a freshness check, not a filesystem transaction: other
/// processes can still change entries after the operating-system calls return.
pub fn validated_trash_path(model: &ScanModel, id: NodeId) -> Result<PathBuf, String> {
    if id == 0 { return Err("Refusing to trash the scan root".to_string()); }
    let node = model.nodes.get(id as usize).filter(|node| node.active)
        .ok_or_else(|| "Selected entry is no longer in the scan".to_string())?;
    let path = PathBuf::from(model.path_for(id));
    if !path.starts_with(&model.root_path) {
        return Err("Selected entry is outside the scan root".to_string());
    }

    // Following a parent link can act on a different directory from the one
    // displayed when the scan completed. Scan that target directly instead.
    let mut parent = path.parent();
    while let Some(directory) = parent {
        if directory == model.root_path { break; }
        let metadata = fs::symlink_metadata(directory).map_err(|error| error.to_string())?;
        if redirects_path(&metadata) {
            return Err("Refusing to trash through a symbolic link or reparse point; scan the target directory directly".to_string());
        }
        parent = directory.parent();
    }

    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    let file_type = metadata.file_type();
    let current_kind = if file_type.is_symlink() { NodeKind::Symlink }
        else if file_type.is_dir() { NodeKind::Directory }
        else if file_type.is_file() { NodeKind::File }
        else { NodeKind::Other };
    if current_kind != node.kind || (redirects_path(&metadata) && node.kind != NodeKind::Symlink) {
        return Err("The entry type changed or was followed through a link; refresh without following symbolic links before moving it to Trash".to_string());
    }
    if let (Some(volume), Some(index)) = (node.identity_volume, node.identity_index) {
        let identity = file_identity(&path, &metadata).map_err(|error| error.to_string())?;
        if identity.volume != volume || identity.index != index {
            return Err("The entry was replaced since the scan; refresh before moving it to Trash".to_string());
        }
    }
    if (node.kind != NodeKind::Directory && metadata.len() != node.raw_size)
        || (node.modified_ms.is_some() && modified_ms(&metadata) != node.modified_ms)
    {
        return Err("The entry changed since the scan; refresh before moving it to Trash".to_string());
    }
    Ok(path)
}

fn redirects_path(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x0000_0400 != 0
    }
    #[cfg(not(windows))]
    { metadata.file_type().is_symlink() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{protocol::Emitter, scanner::{run_scan_quiet, ScanOptions}};
    use std::sync::{Arc, atomic::{AtomicBool, AtomicU64, Ordering}};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn fixture() -> (PathBuf, ScanModel) {
        let root = std::env::temp_dir().join(format!("diskmosaic-trash-check-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(root.join("folder")).unwrap();
        fs::write(root.join("folder/file.bin"), b"original").unwrap();
        let (model, cancelled) = run_scan_quiet(root.clone(), ScanOptions::default(),
            Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)), Emitter::new(), "trash-fixture".into()).unwrap();
        assert!(!cancelled);
        (root, model)
    }

    #[test]
    fn trash_target_accepts_unchanged_entries_but_rejects_root_and_replacements() {
        let (root, model) = fixture();
        let path = root.join("folder/file.bin");
        let id = model.find_by_path(&path).unwrap();
        assert_eq!(validated_trash_path(&model, id).unwrap(), path);
        assert!(validated_trash_path(&model, 0).is_err());
        // Keep the original inode alive so replacement identity cannot be reused.
        fs::rename(&path, root.join("original.bin")).unwrap();
        fs::write(&path, b"replaced").unwrap();
        assert!(validated_trash_path(&model, id).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"replaced");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trash_target_rejects_files_modified_since_scan() {
        let (root, model) = fixture();
        let path = root.join("folder/file.bin");
        let id = model.find_by_path(&path).unwrap();
        fs::write(&path, b"now a longer file").unwrap();
        assert!(validated_trash_path(&model, id).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn trash_target_rejects_a_parent_redirected_to_another_directory() {
        let (root, model) = fixture();
        let path = root.join("folder/file.bin");
        let id = model.find_by_path(&path).unwrap();
        fs::rename(root.join("folder"), root.join("moved")).unwrap();
        std::os::unix::fs::symlink(root.join("moved"), root.join("folder")).unwrap();
        assert!(validated_trash_path(&model, id).is_err());
        assert_eq!(fs::read(root.join("moved/file.bin")).unwrap(), b"original");
        let _ = fs::remove_dir_all(root);
    }
}

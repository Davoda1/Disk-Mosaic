use crate::model::{NodeKind, ScanModel};
use crate::platform::file_identity;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
pub struct RichMetadata {
    pub node_id: u32,
    pub path: String,
    pub name: String,
    pub kind: NodeKind,
    pub extension: String,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub percent_root: f64,
    pub percent_parent: f64,
    pub modified_ms: Option<u64>,
    pub created_ms: Option<u64>,
    pub accessed_ms: Option<u64>,
    pub link_count: u64,
    pub identity_volume: Option<u64>,
    pub identity_index: Option<u64>,
    pub symlink_target: Option<String>,
    pub windows: Option<WindowsMetadata>,
    pub unix: Option<UnixMetadata>,
    pub optional_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowsMetadata {
    pub attributes: u32,
    pub compressed: bool,
    pub sparse: bool,
    pub reparse_point: bool,
    pub hard_link_count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UnixMetadata {
    pub inode: u64,
    pub device: u64,
    pub mode: u32,
    pub permissions: String,
    pub uid: u32,
    pub gid: u32,
    pub blocks: u64,
    pub sparse: bool,
}

pub fn inspect(model: &ScanModel, node_id: u32) -> Result<RichMetadata, String> {
    let node = model.nodes.get(node_id as usize)
        .filter(|node| node.active)
        .ok_or_else(|| "Selected entry is no longer present in the model".to_string())?;
    let path_text = model.path_for(node_id);
    let path = PathBuf::from(&path_text);
    let root_size = model.nodes.first().map(|root| root.size).unwrap_or(0);
    let parent_size = node.parent_id.and_then(|id| model.nodes.get(id as usize)).map(|parent| parent.size).unwrap_or(root_size);
    let percent_root = if root_size > 0 { (node.size as f64 / root_size as f64) * 100.0 } else { 0.0 };
    let percent_parent = if parent_size > 0 { (node.size as f64 / parent_size as f64) * 100.0 } else { 0.0 };

    let symlink_target = if node.kind == NodeKind::Symlink {
        fs::read_link(&path).ok().map(|target| target.to_string_lossy().into_owned())
    } else { None };

    let mut created_ms = None;
    let mut accessed_ms = None;
    let mut identity_volume = node.identity_volume;
    let mut identity_index = node.identity_index;
    let mut link_count = node.link_count;
    #[cfg_attr(unix, allow(unused_mut))]
    let mut windows = None;
    #[cfg_attr(windows, allow(unused_mut))]
    let mut unix = None;
    let mut optional_error = None;

    match fs::symlink_metadata(&path) {
        Ok(meta) => {
            created_ms = meta.created().ok().and_then(system_time_ms);
            accessed_ms = meta.accessed().ok().and_then(system_time_ms);
            if let Ok(identity) = file_identity(&path, &meta) {
                identity_volume = Some(identity.volume);
                identity_index = Some(identity.index);
                link_count = identity.links;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                let blocks = meta.blocks();
                let mode = meta.mode();
                unix = Some(UnixMetadata {
                    inode: meta.ino(), device: meta.dev(), mode,
                    permissions: format!("{:04o}", mode & 0o7777),
                    uid: meta.uid(), gid: meta.gid(), blocks,
                    sparse: meta.is_file() && blocks.saturating_mul(512) < meta.len(),
                });
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                const FILE_ATTRIBUTE_SPARSE_FILE: u32 = 0x0000_0200;
                const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
                const FILE_ATTRIBUTE_COMPRESSED: u32 = 0x0000_0800;
                let attributes = meta.file_attributes();
                windows = Some(WindowsMetadata {
                    attributes,
                    compressed: attributes & FILE_ATTRIBUTE_COMPRESSED != 0,
                    sparse: attributes & FILE_ATTRIBUTE_SPARSE_FILE != 0,
                    reparse_point: attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
                    hard_link_count: link_count,
                });
            }
        }
        Err(error) => optional_error = Some(error.to_string()),
    }

    Ok(RichMetadata {
        node_id, path: path_text, name: node.name.clone(), kind: node.kind,
        extension: node.extension.clone(), logical_size: node.size, allocated_size: node.allocated_size,
        percent_root, percent_parent, modified_ms: node.modified_ms, created_ms, accessed_ms,
        link_count, identity_volume, identity_index, symlink_target, windows, unix, optional_error,
    })
}

fn system_time_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH).ok().map(|duration| duration.as_millis() as u64)
}

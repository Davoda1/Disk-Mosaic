use serde::Serialize;
use std::fs::Metadata;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
pub struct FileIdentity {
    pub volume: u64,
    pub index: u64,
    pub links: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RootInfo {
    pub path: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Default)]
pub struct LightweightMetadata {
    pub created_ms: Option<u64>,
    pub owner_hint: String,
    pub permissions_hint: String,
    pub sparse: Option<bool>,
    pub compressed: Option<bool>,
}

pub fn is_hidden_entry(path: &Path, metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        let _ = path;
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
        return metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0;
    }

    #[cfg(unix)]
    {
        return path.file_name()
            .map(|name| name.to_string_lossy().starts_with('.'))
            .unwrap_or(false);
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = metadata;
        path.file_name()
            .map(|name| name.to_string_lossy().starts_with('.'))
            .unwrap_or(false)
    }
}

pub fn lightweight_metadata(metadata: &Metadata) -> LightweightMetadata {
    let created_ms = metadata.created().ok().and_then(|time| {
        time.duration_since(std::time::UNIX_EPOCH).ok().map(|duration| duration.as_millis() as u64)
    });

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let mode = metadata.mode();
        // st_blocks reveals allocation, but a low block count can be caused by sparse
        // extents, transparent compression, delayed allocation, or filesystem semantics.
        // Do not label it "sparse" without an explicit attribute.
        let sparse = None;
        return LightweightMetadata {
            created_ms,
            owner_hint: format!("uid:{} gid:{}", metadata.uid(), metadata.gid()),
            permissions_hint: format!("{:04o}", mode & 0o7777),
            sparse,
            compressed: None,
        };
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_SPARSE_FILE: u32 = 0x0000_0200;
        const FILE_ATTRIBUTE_COMPRESSED: u32 = 0x0000_0800;
        let attributes = metadata.file_attributes();
        return LightweightMetadata {
            created_ms,
            owner_hint: String::new(),
            permissions_hint: String::new(),
            sparse: Some(attributes & FILE_ATTRIBUTE_SPARSE_FILE != 0),
            compressed: Some(attributes & FILE_ATTRIBUTE_COMPRESSED != 0),
        };
    }

    #[cfg(not(any(unix, windows)))]
    LightweightMetadata { created_ms, ..LightweightMetadata::default() }
}

#[derive(Debug, Clone, Serialize)]
pub struct FilesystemContext {
    pub filesystem: Option<String>,
    pub volume: Option<String>,
    pub total_bytes: Option<u64>,
    pub available_bytes: Option<u64>,
}

pub fn filesystem_context(path: &Path) -> FilesystemContext {
    let (total_bytes, available_bytes) = filesystem_space(path)
        .map(|(total, available)| (Some(total), Some(available)))
        .unwrap_or((None, None));

    #[cfg(unix)]
    {
        let mut best: Option<(usize, String, String)> = None;
        if let Ok(text) = std::fs::read_to_string("/proc/self/mountinfo") {
            for line in text.lines() {
                let Some((left, right)) = line.split_once(" - ") else { continue; };
                let left_fields: Vec<&str> = left.split_whitespace().collect();
                let right_fields: Vec<&str> = right.split_whitespace().collect();
                if left_fields.len() <= 4 || right_fields.len() < 2 { continue; }
                let mount = left_fields[4]
                    .replace("\\040", " ")
                    .replace("\\011", "\t")
                    .replace("\\012", "\n")
                    .replace("\\134", "\\");
                let mount_path = PathBuf::from(&mount);
                if !path.starts_with(&mount_path) { continue; }
                let score = mount_path.as_os_str().len();
                if best.as_ref().map_or(true, |(best_score, _, _)| score > *best_score) {
                    best = Some((score, right_fields[0].to_string(), right_fields[1].to_string()));
                }
            }
        }
        return FilesystemContext {
            filesystem: best.as_ref().map(|(_, fs, _)| fs.clone()),
            volume: best.map(|(_, _, source)| source),
            total_bytes,
            available_bytes,
        };
    }

    #[cfg(not(unix))]
    FilesystemContext { filesystem: None, volume: None, total_bytes, available_bytes }
}

#[cfg(unix)]
pub fn allocated_size(_path: &Path, metadata: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.blocks().saturating_mul(512)
}

#[cfg(windows)]
pub fn allocated_size(path: &Path, metadata: &Metadata) -> u64 {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Storage::FileSystem::GetCompressedFileSizeW;

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    let mut high = 0u32;
    // SAFETY: `wide` is a NUL-terminated UTF-16 path and `high` is a valid
    // writable pointer for the duration of the call. GetCompressedFileSizeW
    // works for ordinary, sparse, and NTFS-compressed files and reports the
    // on-disk allocation where the filesystem supports it.
    let low = unsafe { GetCompressedFileSizeW(wide.as_ptr(), &mut high) };
    if low == u32::MAX {
        // 0xFFFFFFFF can also be a legitimate low DWORD. A non-zero last error
        // distinguishes a failure; on failure, logical size is the safe fallback.
        let error = unsafe { GetLastError() };
        if error != 0 { return metadata.len(); }
    }
    ((high as u64) << 32) | low as u64
}

#[cfg(unix)]
pub fn file_identity(_path: &Path, metadata: &Metadata) -> io::Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    Ok(FileIdentity {
        volume: metadata.dev(),
        index: metadata.ino(),
        links: metadata.nlink(),
    })
}

#[cfg(windows)]
pub fn file_identity(path: &Path, _metadata: &Metadata) -> io::Result<FileIdentity> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);

    // SAFETY: the UTF-16 path is NUL-terminated and lives for the duration of the calls.
    // The returned handle is checked against INVALID_HANDLE_VALUE and closed exactly once.
    unsafe {
        let handle = CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        let ok = GetFileInformationByHandle(handle, &mut info);
        let close_ok = CloseHandle(handle);
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        if close_ok == 0 {
            eprintln!("warning: CloseHandle failed for {}", path.display());
        }
        Ok(FileIdentity {
            volume: info.dwVolumeSerialNumber as u64,
            index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
            links: info.nNumberOfLinks as u64,
        })
    }
}

pub fn same_filesystem(root: &Path, candidate: &Path) -> bool {
    match (std::fs::metadata(root), std::fs::metadata(candidate)) {
        (Ok(root_meta), Ok(candidate_meta)) => {
            match (file_identity(root, &root_meta), file_identity(candidate, &candidate_meta)) {
                (Ok(a), Ok(b)) => a.volume == b.volume,
                _ => true,
            }
        }
        _ => true,
    }
}

pub fn filesystem_space(path: &Path) -> Option<(u64, u64)> {
    let total = fs2::total_space(path).ok()?;
    let available = fs2::available_space(path).ok()?;
    Some((total, available))
}

pub fn list_roots() -> Vec<RootInfo> {
    let mut paths: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let p = PathBuf::from(format!("{}:\\", letter as char));
            if p.exists() {
                paths.push(p);
            }
        }
    }

    #[cfg(unix)]
    {
        paths.push(PathBuf::from("/"));
        if let Ok(text) = std::fs::read_to_string("/proc/self/mountinfo") {
            const VIRTUAL_FS: &[&str] = &[
                "proc", "sysfs", "devtmpfs", "devpts", "cgroup", "cgroup2",
                "securityfs", "pstore", "debugfs", "tracefs", "configfs",
                "mqueue", "hugetlbfs", "fusectl", "autofs",
            ];
            for line in text.lines() {
                let Some((left, right)) = line.split_once(" - ") else { continue; };
                let fs_type = right.split_whitespace().next().unwrap_or_default();
                if VIRTUAL_FS.contains(&fs_type) {
                    continue;
                }
                let fields: Vec<&str> = left.split_whitespace().collect();
                if fields.len() > 4 {
                    let mount = fields[4]
                        .replace("\\040", " ")
                        .replace("\\011", "\t")
                        .replace("\\012", "\n")
                        .replace("\\134", "\\");
                    let p = PathBuf::from(mount);
                    if !paths.contains(&p) {
                        paths.push(p);
                    }
                }
            }
        }
    }

    paths.sort();
    paths.dedup();
    paths.into_iter().filter_map(root_info_for_path).collect()
}

fn root_info_for_path(path: PathBuf) -> Option<RootInfo> {
    // Linux mount tables may contain bind mounts whose mountpoint is a regular
    // file (for example container-managed /etc/hosts). DiskMosaic only accepts
    // directory scan roots, so never advertise a root that the scanner will
    // immediately reject.
    if !path.is_dir() {
        return None;
    }
    let total = fs2::total_space(&path).ok()?;
    let available = fs2::available_space(&path).ok()?;
    Some(RootInfo {
        path: path.to_string_lossy().into_owned(),
        total_bytes: total,
        available_bytes: available,
    })
}

#[cfg(test)]
mod tests {
    use super::root_info_for_path;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_root() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("diskmosaic-platform-{unique}"))
    }

    #[test]
    fn root_discovery_accepts_directories_and_rejects_file_mountpoints() {
        let root = fixture_root();
        fs::create_dir_all(&root).expect("create root fixture");
        let file = root.join("mounted-file");
        fs::write(&file, b"fixture").expect("create file fixture");

        let directory = root_info_for_path(root.clone());
        assert!(directory.is_some(), "directory roots must remain discoverable");
        assert!(root_info_for_path(file).is_none(), "regular-file mountpoints must not be advertised as scan roots");

        fs::remove_dir_all(root).expect("remove root fixture");
    }
}

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
        let _ = metadata;
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
    paths
        .into_iter()
        .filter_map(|path| {
            let total = fs2::total_space(&path).ok()?;
            let available = fs2::available_space(&path).ok()?;
            Some(RootInfo {
                path: path.to_string_lossy().into_owned(),
                total_bytes: total,
                available_bytes: available,
            })
        })
        .collect()
}

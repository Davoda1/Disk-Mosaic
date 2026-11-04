use std::fs::{File, Metadata};
use std::io::Read;
use std::path::Path;

const PROBE_BYTES: usize = 4096;

/// Return a small, stable local classification hint for files whose filename is
/// insufficient for useful presentation (primarily extensionless Unix files).
/// The probe is intentionally bounded and never launches external programs.
pub fn type_hint_for_file(path: &Path, metadata: &Metadata, extension: &str) -> String {
    if let Some(hint) = special_name_hint(path) {
        return hint.to_string();
    }

    // Ordinary extension-bearing files are classified from the comprehensive
    // renderer table without extra filesystem I/O. This keeps normal scans fast.
    if !extension.is_empty() {
        return String::new();
    }

    let executable = is_executable(metadata);
    let mut buffer = [0u8; PROBE_BYTES];
    let read = match File::open(path).and_then(|mut file| file.read(&mut buffer)) {
        Ok(read) => read,
        Err(_) => return if executable { "executable".into() } else { String::new() },
    };
    let bytes = &buffer[..read];
    if bytes.is_empty() {
        return if executable { "executable".into() } else { "text".into() };
    }

    if let Some(hint) = magic_hint(bytes) {
        return hint.to_string();
    }
    if let Some(hint) = shebang_hint(bytes) {
        return hint.to_string();
    }
    if looks_text(bytes) {
        return "text".into();
    }
    if executable {
        "executable".into()
    } else {
        "binary".into()
    }
}

fn special_name_hint(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    match name.as_str() {
        "makefile" | "gnumakefile" => Some("makefile"),
        "dockerfile" | "containerfile" => Some("dockerfile"),
        "cmakelists.txt" => Some("cmake"),
        _ => None,
    }
}

fn magic_hint(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x7fELF") { return Some("elf"); }
    if bytes.starts_with(b"MZ") { return Some("pe-executable"); }
    if matches_magic4(bytes, [0xfe, 0xed, 0xfa, 0xce])
        || matches_magic4(bytes, [0xce, 0xfa, 0xed, 0xfe])
        || matches_magic4(bytes, [0xfe, 0xed, 0xfa, 0xcf])
        || matches_magic4(bytes, [0xcf, 0xfa, 0xed, 0xfe])
        || matches_magic4(bytes, [0xca, 0xfe, 0xba, 0xbe])
    { return Some("mach-o"); }
    if bytes.starts_with(b"%PDF-") { return Some("pdf"); }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { return Some("image-png"); }
    if bytes.starts_with(b"\xff\xd8\xff") { return Some("image-jpeg"); }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { return Some("image-gif"); }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { return Some("image-webp"); }
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || bytes.starts_with(b"PK\x07\x08") { return Some("archive-zip"); }
    if bytes.starts_with(b"7z\xbc\xaf\x27\x1c") { return Some("archive-7z"); }
    if bytes.starts_with(b"Rar!\x1a\x07\x00") || bytes.starts_with(b"Rar!\x1a\x07\x01\x00") { return Some("archive-rar"); }
    if bytes.starts_with(b"\x1f\x8b") { return Some("archive-gzip"); }
    if bytes.starts_with(b"BZh") { return Some("archive-bzip2"); }
    if bytes.starts_with(b"\xfd7zXZ\x00") { return Some("archive-xz"); }
    if bytes.starts_with(b"\x28\xb5\x2f\xfd") { return Some("archive-zstd"); }
    if bytes.starts_with(b"fLaC") { return Some("audio-flac"); }
    if bytes.starts_with(b"OggS") { return Some("audio-ogg"); }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" { return Some("audio-wave"); }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"AVI " { return Some("video-avi"); }
    if bytes.starts_with(b"\x1a\x45\xdf\xa3") { return Some("video-matroska"); }
    if bytes.starts_with(b"SQLite format 3\x00") { return Some("sqlite"); }
    None
}

fn matches_magic4(bytes: &[u8], magic: [u8; 4]) -> bool {
    bytes.len() >= 4 && bytes[..4] == magic
}

fn shebang_hint(bytes: &[u8]) -> Option<&'static str> {
    if !bytes.starts_with(b"#!") { return None; }
    let line_end = bytes.iter().position(|&b| b == b'\n').unwrap_or(bytes.len()).min(512);
    let line = String::from_utf8_lossy(&bytes[..line_end]).to_ascii_lowercase();
    if line.contains("python") { return Some("code-python"); }
    if line.contains("ts-node") || line.contains("deno") { return Some("code-typescript"); }
    if line.contains("node") || line.contains("bun") { return Some("code-javascript"); }
    if line.contains("ruby") { return Some("code-ruby"); }
    if line.contains("perl") { return Some("code-perl"); }
    if line.contains("php") { return Some("code-php"); }
    if line.contains("lua") { return Some("code-lua"); }
    if line.contains("pwsh") || line.contains("powershell") { return Some("code-powershell"); }
    if line.contains("awk") { return Some("code-awk"); }
    if ["bash", "zsh", "fish", "ksh", "csh", "tcsh", "/sh", " env sh"]
        .iter().any(|needle| line.contains(needle))
    { return Some("script-shell"); }
    Some("executable")
}

fn looks_text(bytes: &[u8]) -> bool {
    if bytes.iter().any(|&byte| byte == 0) { return false; }
    let sample = bytes.len().min(PROBE_BYTES);
    let acceptable = bytes[..sample].iter().filter(|&&byte| {
        byte == b'\n' || byte == b'\r' || byte == b'\t' || byte == 0x0c || (0x20..=0x7e).contains(&byte) || byte >= 0x80
    }).count();
    acceptable.saturating_mul(100) >= sample.saturating_mul(92)
}

#[cfg(unix)]
fn is_executable(metadata: &Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &Metadata) -> bool { false }

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(name: &str, contents: &[u8]) -> std::path::PathBuf {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("diskmosaic-filetype-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join(name);
        fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn extensionless_magic_and_shebangs_are_recognized() {
        let elf = fixture("binary", b"\x7fELF\x02\x01\x01\x00");
        assert_eq!(type_hint_for_file(&elf, &fs::metadata(&elf).unwrap(), ""), "elf");
        let py = fixture("script", b"#!/usr/bin/env python3\nprint('ok')\n");
        assert_eq!(type_hint_for_file(&py, &fs::metadata(&py).unwrap(), ""), "code-python");
        let text = fixture("README", b"plain extensionless text\n");
        assert_eq!(type_hint_for_file(&text, &fs::metadata(&text).unwrap(), ""), "text");
        let _ = fs::remove_dir_all(elf.parent().unwrap());
        let _ = fs::remove_dir_all(py.parent().unwrap());
        let _ = fs::remove_dir_all(text.parent().unwrap());
    }

    #[test]
    fn extension_bearing_files_do_not_trigger_content_probe() {
        let path = fixture("thing.dat", b"\x7fELF\x02\x01\x01\x00");
        assert_eq!(type_hint_for_file(&path, &fs::metadata(&path).unwrap(), ".dat"), "");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}

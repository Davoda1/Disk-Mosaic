#!/usr/bin/env python3
"""Build deterministic, standalone source archives from tracked edition files."""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "source"
EXCLUDED = {"node_modules", "dependencies", "toolings", "dist", "target", ".git"}


def main() -> None:
    tracked = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", "-z"], text=True
    ).split("\0")
    if not any(name.endswith("engine/Cargo.lock") for name in tracked):
        raise SystemExit("Stage the complete source tree and lockfiles before packaging.")
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    products = []
    for edition, prefix in [("standard", "DiskMosaic"), ("light", "DiskMosaic-Light")]:
        source_prefix = f"editions/{edition}/"
        archive_root = f"{prefix}-1.0.0-Source"
        selected: dict[str, Path] = {}
        for name in tracked:
            if not name.startswith(source_prefix):
                continue
            relative = name[len(source_prefix):]
            parts = Path(relative).parts
            if "IMPROVEMENT-ANALYSIS" in relative or "IMPLEMENTATION-NOTES" in relative or "gui-validation" in parts:
                raise SystemExit(f"Obsolete development evidence must not be archived: {name}")
            if any(part in EXCLUDED for part in parts) and Path(relative).name != ".gitkeep":
                continue
            selected[relative] = ROOT / name
        for name in ["USER-GUIDE.md", "BUILDING.md", "DEPENDENCY-REVIEW.md"]:
            selected[f"docs/{name}"] = ROOT / "docs" / name
        selected["SECURITY.md"] = ROOT / "SECURITY.md"
        for required in ["LICENSE", "engine/Cargo.lock", "gui/package-lock.json", "gui/package.json"]:
            if required not in selected:
                raise SystemExit(f"{edition}: required source file missing: {required}")
        destination = OUTPUT / f"{archive_root}.tar.xz"
        with tarfile.open(destination, "w:xz", preset=6, format=tarfile.PAX_FORMAT) as archive:
            for relative, source in sorted(selected.items()):
                if source.is_symlink() or not source.is_file():
                    raise SystemExit(f"Unsafe source entry: {source}")
                data = source.read_bytes()
                info = tarfile.TarInfo(f"{archive_root}/{relative}")
                info.size = len(data)
                info.mode = 0o755 if relative.endswith(".sh") else 0o644
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                info.mtime = epoch
                archive.addfile(info, io.BytesIO(data))
        with tarfile.open(destination) as archive:
            for member in archive.getmembers():
                if not member.isfile() or member.name.startswith("/") or ".." in Path(member.name).parts:
                    raise SystemExit(f"Unsafe packaged entry: {member.name}")
        products.append(destination)
        print(f"{destination.name}: {len(selected)} files, {destination.stat().st_size:,} bytes")
    manifest = "".join(
        f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in products
    )
    (OUTPUT / "SHA256SUM.txt").write_text(manifest, encoding="utf-8")


if __name__ == "__main__":
    main()

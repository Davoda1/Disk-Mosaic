# DiskMosaic 1.0.0 — Standard and Light

DiskMosaic 1.0.0 brings local disk analysis to Windows and Linux in two editions: the full **DiskMosaic** workspace and the compact **DiskMosaic Light** interface. Both operate offline and include a native Rust scanning engine, interactive treemaps, exact duplicate verification, and local scan history.

## Highlights

- Explore storage with cushioned 2D and optional extruded 3D treemaps, searchable file tables, and file-type colors.
- Compare logical file sizes with allocated disk usage, including filesystem-dependent sparse-file and hard-link accounting.
- Find duplicates using staged BLAKE3 hashing followed by exact byte comparison, then review files before sending them to Trash or the Recycle Bin.
- Save `.dmscan` snapshots, compare scans, and optionally keep a local SQLite history.
- Refresh selected subtrees or enable filesystem watching to revisit changing storage.
- Choose light or dark appearance and an English, German, Hungarian, French, Italian, or Spanish interface.

## Choose an edition

| Edition | Best suited to | Additional tools |
| --- | --- | --- |
| DiskMosaic | Detailed storage investigation and reporting | History timeline, advanced faceted filters, Smart Collections, dedicated age/cleanup/allocation analysis, and HTML/JSON/CSV/Markdown summary reports |
| DiskMosaic Light | A compact scanning and analysis workflow | Core treemaps, search, duplicates, saved-scan comparison, basic history, and JSON reports |

Both editions can be installed together. They use separate application identities, settings, and history folders. Light describes the interface; both packages include a complete desktop runtime. Keep their history databases separate because the internal schemas differ.

## Downloads

Choose the package for the target operating system. All application packages are for **x86-64 / amd64**.

| Package | DiskMosaic | DiskMosaic Light |
| --- | --- | --- |
| Windows portable ZIP | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-1.0.0-Windows-x86_64.zip) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-Light-1.0.0-Windows-x86_64.zip) |
| Linux portable TAR.GZ | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-1.0.0-Linux-x86_64.tar.gz) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-Light-1.0.0-Linux-x86_64.tar.gz) |
| Debian / Ubuntu DEB | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-1.0.0-Linux-x86_64.deb) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-Light-1.0.0-Linux-x86_64.deb) |
| Standalone source TAR.XZ | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-1.0.0-Source.tar.xz) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/DiskMosaic-Light-1.0.0-Source.tar.xz) |

One [SHA256SUM.txt](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.0/SHA256SUM.txt) manifest covers the release assets. Use it to verify downloads. Standalone source archives include the edition's code, assets, lockfiles, build scripts, tests, and documentation.

## Compatibility and installation

**Windows:** Windows 10 or 11, x64. Extract the complete ZIP and launch the application executable from the extracted directory.

**Linux:** amd64 with a graphical desktop and the required Electron system libraries. Extract the complete portable TAR.GZ before launching, or install the DEB on a compatible Debian/Ubuntu system. The DEB installs a native entry executable in `/usr/bin` and keeps the bundled application under `/opt`. It also installs the Chromium sandbox helper with its required permissions; use this package where unprivileged user namespaces are restricted.

Application packages include the Rust engine and Electron runtime. End users do not need Node.js or Rust. Development uses **Node.js 26.13.0 LTS** with **npm 11.20.0**, committed dependency locks, and the native toolchains documented in the [build guide](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.0/docs/BUILDING.md).

## Privacy and file actions

Scan data, settings, history, and cached fingerprints stay on the local machine. The applications have no accounts, telemetry, or runtime network requests. The renderer uses context isolation and sandboxing with Node integration disabled.

File cleanup requires an explicit user action. Single-item Trash confirmation is enabled by default and configurable; batch actions always require confirmation. Saved and historical scans cannot perform live destructive actions. Reports and snapshots may contain filenames and full paths, so review exported files before sharing them.

## Validation

The release workflow validates both editions on Windows and Linux with source checks, Node regression tests, Rust engine tests, real-engine smoke checks, dependency license checks, and package-layout checks. Renderer layout suites run the actual interface with controlled bridge fixtures; they complement the native checks and do not perform real filesystem mutations.

Full npm audits of both committed lockfiles reported **zero vulnerabilities** on 4 November 2026, including development and packaging dependencies. The [dependency review](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.0/docs/DEPENDENCY-REVIEW.md) records the resolved versions, audit scope, and security update policy.

Filesystem behavior, desktop integration, and available metadata can vary by operating system; a scan of an actively changing filesystem is not an atomic snapshot.

## Documentation and license

[User guide](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.0/docs/USER-GUIDE.md) · [Build and packaging guide](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.0/docs/BUILDING.md) · [Security policy](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.0/SECURITY.md)

DiskMosaic application code and original assets are licensed under **AGPL-3.0-only**, which permits commercial use under its terms. Third-party components retain their own licenses; binary packages include the required Electron/Chromium and Rust dependency notices. See the complete [license](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.0/LICENSE).

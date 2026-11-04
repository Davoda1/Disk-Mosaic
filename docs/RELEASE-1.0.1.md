# DiskMosaic 1.0.1 — Standard and Light

DiskMosaic 1.0.1 improves dependency-license report generation in both **DiskMosaic** and **DiskMosaic Light**. It corrects incomplete Markdown escaping identified by code scanning and adds regression coverage for the report-generation command.

## Fixes

- Encode dependency names, versions, SPDX expressions, and source identifiers as literal table-cell text.
- Handle backslashes, pipe characters, line breaks, and inline markup without allowing metadata to introduce additional table columns or rows.
- Preserve literal HTML and entity text in the generated dependency report.
- Apply the same correction to both editions and regenerate the license reports included in application packages.

The affected scripts run during the build and produce the bundled `RUST_DEPENDENCIES.md` report. The correction addresses the six `js/incomplete-sanitization` findings across the two editions' copies of the script.

## Validation coverage

New command-line regression tests exercise normal dependency metadata, backslash and pipe combinations, injected row breaks, inline markup, and rejected license expressions. The existing Windows and Linux build checks also cover source metadata, dependency audits, Node regression tests, Rust engine tests, the packaged engine protocol, and package layouts.

Development and release builds use **Node.js 26.13.0 LTS**, **npm 11.20.0**, and **Rust 1.99.1** with the committed dependency locks. See the [build guide](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.1/docs/BUILDING.md) and [dependency review](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.1/docs/DEPENDENCY-REVIEW.md).

## Downloads

All application packages target **x86-64 / amd64**. Windows packages support Windows 10 and 11. Linux packages require a graphical desktop and the system libraries described in the user guide.

| Package | DiskMosaic | DiskMosaic Light |
| --- | --- | --- |
| Windows portable ZIP | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-1.0.1-Windows-x86_64.zip) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-Light-1.0.1-Windows-x86_64.zip) |
| Linux portable TAR.GZ | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-1.0.1-Linux-x86_64.tar.gz) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-Light-1.0.1-Linux-x86_64.tar.gz) |
| Debian / Ubuntu DEB | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-1.0.1-Linux-x86_64.deb) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-Light-1.0.1-Linux-x86_64.deb) |
| Standalone source TAR.XZ | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-1.0.1-Source.tar.xz) | [Download](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/DiskMosaic-Light-1.0.1-Source.tar.xz) |

One [SHA256SUM.txt](https://github.com/Davoda1/Disk-Mosaic/releases/download/v1.0.1/SHA256SUM.txt) manifest covers all eight packages. Extract portable archives completely before launching the application. Binary packages include the Electron runtime and native Rust engine; end users do not need Node.js or Rust.

## Upgrading

Replace the extracted portable application directory, or install the new Debian package. Version 1.0.1 uses the same application identities, settings locations, snapshot format, and history formats as 1.0.0. Existing data requires no migration. Keep Standard and Light history databases separate, as described in the [user guide](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.1/docs/USER-GUIDE.md).

## Documentation and license

[User guide](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.1/docs/USER-GUIDE.md) · [Build and packaging guide](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.1/docs/BUILDING.md) · [Security policy](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.1/SECURITY.md)

DiskMosaic application code and original assets are licensed under **AGPL-3.0-only**. Third-party components retain their own licenses and notices. See the complete [license](https://github.com/Davoda1/Disk-Mosaic/blob/v1.0.1/LICENSE).

# Changelog

## 1.0.1

- Encode dependency metadata as literal Markdown table text in the Rust license-audit reports, including backslashes, table separators, line breaks, and inline markup.
- Apply the same report encoding to both editions and all dependency metadata columns.
- Add command-line regression coverage for report structure, literal metadata, and license-policy enforcement.
- Update application, engine, package, and documentation versions to 1.0.1.

## 1.0.0

Initial repository release of DiskMosaic, the full analysis edition.

- Local disk scanning, logical and allocated sizes, and 2D/3D treemaps.
- Search, exact duplicate analysis, saved scans, comparison, optional filesystem watching, and local history.
- Separate settings and history storage for each edition.
- AGPL-3.0-only application licensing with retained dependency notices.
- Validated snapshot input and duplicate verification against current file contents.
- Restricted local navigation and validated Electron IPC boundaries.
- Reproducible dependency locks and platform packaging checks.

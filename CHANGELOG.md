# Changelog

## 1.0.1

- Encode dependency metadata as literal Markdown table text in the Rust license-audit reports, including backslashes, table separators, line breaks, and inline markup.
- Apply the same report encoding to both editions and all dependency metadata columns.
- Add command-line regression coverage for report structure, literal metadata, and license-policy enforcement.
- Update application, engine, package, and documentation versions to 1.0.1.

## 1.0.0

Initial repository release containing **DiskMosaic** and **DiskMosaic Light**.

Both editions provide local disk analysis, logical and allocated sizes, 2D and 3D treemaps, search, exact duplicate verification, saved scans, comparison, optional watching and local history. The Standard edition adds extended history analysis, faceted filters, Smart Collections, cleanup review, age analysis, allocation analysis and report formats.

This release introduces separate edition identities and data folders, AGPL-3.0-only licensing, committed dependency locks, hardened saved-scan and IPC validation, safer duplicate verification, and Windows/Linux packaging validation.

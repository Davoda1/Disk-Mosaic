# DiskMosaic Light 1.0.1 architecture



## Rust engine

The scanner uses a fixed worker pool and an iterative directory task queue; filesystem
recursion is not performed on the Rust call stack. Each directory is enumerated into a
temporary batch and appended to the shared node arena under one short lock. Descendants
receive IDs after ancestors, so reverse arena order provides linear-time bottom-up size and
child-count aggregation.

The node model stores basenames, parent IDs and compact metadata rather than duplicating
full absolute paths. Paths are reconstructed on demand. Errors are counted without limit,
while the first 10,000 error records are retained for inspection/export.

Symlinks are not followed by default. When following is enabled, stable directory identity
tracking prevents loops. Hard-linked regular files are counted once by default where the
platform exposes a stable physical identity. Windows identity handling is isolated in the
platform module; Unix uses device/inode identity.

### Analysis indexes and storage semantics

After traversal, one linear index pass produces:

- extension totals;
- a bounded top-1000 largest-file index;
- file-size distribution buckets;
- last-modified age distribution buckets;
- maximum scan depth;
- hard-link duplicate and extensionless-file counts.

Search supports name/path/extension, min/max size, entry type and modification-date
constraints. It scans the compact in-memory arena and keeps only a bounded top-K heap of
the largest matches. Exclusion rules are applied before metadata work and support
case-insensitive `*` / `?` globs against either basenames or scan-relative paths.

The completed model also records filesystem total/available capacity through ordinary
filesystem APIs. Each node carries logical/apparent and allocated/on-disk byte counts. Linux
uses `st_blocks * 512`; Windows uses `GetCompressedFileSizeW` with logical size as a fallback.
The active size basis controls treemap geometry, share bars, Largest Files and size-filtered
search, while filesystem capacity remains contextual rather than part of treemap area.

A separate exact duplicate-analysis path groups equal-size files, fingerprints first/last chunks,
and then byte-compares surviving candidates. Scan workers support an atomic pause state in addition
to cancellation.

Versioned `.dmscan` snapshots persist the Rust model without routing it through renderer IPC. Save
serialization borrows the existing model rather than cloning the arena. Snapshot comparison maps
scan-relative paths and retains only bounded top changes.


### Live model, history and advanced operations

Subtree reconciliation connects incremental scans to the Rust-owned model. Incremental refresh scans only the requested subtree and reconciles active nodes, reusing node IDs where possible and marking removed entries inactive so renderer references are not invalidated by wholesale model replacement. Ancestor totals and analysis indexes are then recomputed from the authoritative model.

Optional filesystem watching is implemented through a native-backed watcher abstraction and is disabled by default. Events are debounced/coalesced and converted into bounded affected-path refresh work. Overflow or watcher uncertainty produces an explicit stale/refresh-required state rather than silently claiming the model is current.

Selection is also engine-owned as compact node IDs. Replace/toggle/range-style selection commands return aggregate `SelectionSummary` data and bounded selection pages. Explicit batch actions operate on the normalized selection; destructive actions use Trash/Recycle Bin and remain disabled for saved/history models. Rich metadata is fetched lazily for the selected item.

A schema-versioned SQLite history database stores local snapshots and duplicate fingerprint cache data under the application's per-user data directory. Electron supplies that directory through `DISKMOSAIC_DATA_DIR`; Rust owns the database schema, parameterized queries and transactions. Existing `.dmscan` files remain an interchange/archive format.

Duplicate analysis uses staged candidate reduction and exact verification with BLAKE3 fingerprint/full-hash caching keyed by validating metadata. Comparison data now includes hierarchical deltas and current-node IDs so changed entries can navigate back into the live model.

## Electron main process

The main process launches and supervises the Rust engine, parses JSONL, owns native dialogs,
OS open/reveal/clipboard integration, report-save dialogs and persistent window geometry.
Development and packaged engine paths are resolved independently. Unexpected engine exit,
malformed protocol data and write failures are surfaced to the renderer.

The BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
and `webSecurity: true`. HTTP(S) and WebSocket requests are blocked at the session layer.
The preload exposes only explicit application operations. Offline JSON report export is
bounded to 64 MiB at the main-process IPC boundary.

## Renderer

The renderer has no Node.js access. Fixed-row virtualization is used for directory,
largest-file, search and type-statistics tables.

The treemap uses a hierarchical squarified layout on a high-DPI canvas. Rust returns a
bounded directory hierarchy; each expanded directory contains its largest direct children
and, when necessary, one exact-size remainder node. Recursive layout preserves full-root
area ratios. Directory grouping is drawn as an overlay border rather than padding, so it
does not distort size geometry. File/category coloring, configurable 3D cushion shading,
minimum interactive tile size, zoom/focus navigation and synchronized selection remain
renderer-only concerns.

DiskMosaic supports saved-scan open/save, comparison and duplicate workspaces; a global
logical/allocated basis selector; allocated-size tree/details; scan pause/resume; deterministic
Storage Insights; and a compact scan-overview ribbon. It retains category statistics, user
category/color overrides, actionable size/age analysis, advanced search, bookmarks/recents,
exclusions, filesystem-capacity context and offline JSON scan reports. Bookmarks, recents, UI
settings and splitter geometry remain local-only browser storage. They never leave the machine.

## Build and packaging isolation

Builds use installed compatible Node.js and Rust toolchains. They do not edit global toolchain configuration or shell profiles. Committed dependency lockfiles drive reproducible resolution. Build products and caches are kept under the edition's `dependencies`, `toolings` and `dist` directories and excluded from source archives.

The Standard and Light products have distinct application IDs, executable names and user-data directories. Each carries its own engine and resource files. Runtime protocol and database schema identifiers are independent of the application release version and are retained for format compatibility.

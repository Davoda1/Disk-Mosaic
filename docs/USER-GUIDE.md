# DiskMosaic user guide

## Choose an edition

DiskMosaic provides the full analysis workspace, including history timelines, advanced filters, Smart Collections, age and allocation analysis, cleanup review and report formats. DiskMosaic Light keeps the compact scanner, treemap, search, duplicate, comparison and basic history workflow. Both editions operate offline and use separate settings and history directories.

## Scan a folder or volume

Select **Scan** and choose the folder or volume to inspect. The Rust engine enumerates entries and reports progress, elapsed time, byte totals and access errors. Pause and resume are available during a scan. Cancelling a full scan stops it without loading its partial model; any previously loaded model can remain visible. Completed scans with inaccessible entries can still give incomplete accounting of the disk.

A normal scan reads metadata. Optional classification may inspect a bounded file prefix. Duplicate analysis is a separate operation that reads candidate contents. Administrative access is not required for ordinary folders; inaccessible entries are reported instead of being silently included.

By default, symlinks/reparse points are not followed. The scanning settings control filesystem-boundary traversal and exclusions. Following links can enlarge a scan; DiskMosaic uses file identities to avoid directory cycles. Exclusion patterns support `*` and `?`; `name:` matches names and `path:` matches paths relative to the scan root.

## Understand sizes

**Logical size** is the apparent content length. **Allocated size** is the storage reported by the filesystem, where available. Sparse files, compression, allocation units and hard links can make those numbers differ. Hard-link de-duplication avoids treating several names for the same physical file as independent storage.

The treemap's rectangle areas follow the selected size basis. Its 3D effect is decorative and does not encode another measurement. File categories and age colors help identify entries; they do not alter the recorded size. Capacity/used/free figures describe the filesystem and can differ from a selected folder's totals because of metadata, inaccessible content, reservations, snapshots or other unscanned data.

## Explore and search

Select a directory in the tree or treemap to inspect it. Double-click a directory to focus it, and use breadcrumbs or navigation history to return. Sort table columns to compare size, counts or modification time. Category and extension filters highlight matching entries while preserving the underlying model.

Search supports names, paths, extensions, entry type, size ranges and modification time. Standard also supports advanced AND/OR filter groups and named Smart Collections. These are local view definitions, not rules that move or delete files.

Hidden-entry settings are display controls: **Show All**, **Only Directories** and **Hide All**. Scans still account for hidden entries. On Windows, hidden state comes from the native attribute; on Linux it follows dot-prefixed names. Light's saved history does not persist all newer hidden-entry metadata; a fresh scan provides the most complete visibility information.

## Verify duplicates

Run duplicate analysis after scanning. DiskMosaic reduces candidates using equal sizes, sampled BLAKE3 fingerprints and full hashes, then verifies file contents exactly before reporting identical groups. Hard links to the same physical file are not treated as independently recoverable duplicates.

Review paths and metadata before selecting files. Standard's keep/proposal helpers change selection only. Single-item Trash/Recycle Bin confirmation is enabled by default and is configurable in Settings. Batch Trash actions require confirmation. No cleanup runs automatically. Concurrent changes by other applications can invalidate results, so refresh and recheck files that are actively changing. The platform Trash service can reject an operation, and a failed move is reported.

## Saved scans and comparison

Save a `.dmscan` snapshot to retain a point-in-time model. Opening a saved scan does not rescan the original path. Saved and history models cannot perform live destructive actions. Comparison highlights changes between models; it is not a backup or recovery feature.

Snapshots and exports contain filesystem names and paths. Review files before attaching them to an issue or sharing them. Imported snapshots are checked for structural validity, and saved models cannot perform live destructive file actions.

## Local history and watching

History is optional SQLite storage in the edition's user-data directory. Standard has a timeline and indexed analyses; Light has basic history listing, loading and comparison. Do not share a history database between editions. History deletion removes stored records, not the scanned filesystem content. Standard retention and database maintenance actions are explicit; automatic retention is off unless enabled.

Optional watching uses native filesystem notifications with debounce/batching. Notifications can overflow or become incomplete; DiskMosaic marks uncertainty and may request a refresh. Incremental refresh reconciles affected subtrees. Watch mode is a convenience for analysis, not a transactional filesystem monitor.

## Reports

Standard exports self-contained HTML and JSON, CSV or Markdown summaries. Light exports JSON. Exported HTML embeds its styling and does not load network content. A report describes the model currently loaded. Cancelling a new full scan does not load its partial results, so a previous model may remain the export source. Completed scans with access errors can still give incomplete accounting. Use a fresh completed scan and review its errors before exporting.

## Settings and storage

The default interface language is English. German, Hungarian, French, Italian and Spanish are also available. Appearance follows the operating system unless another theme is selected. The Settings dialog also contains the About view with version and license information.

User data stays under the operating system's application-data directory, normally `%APPDATA%` on Windows and `$XDG_CONFIG_HOME` or `~/.config` on Linux. Each edition uses its own subdirectory. Settings, history and cached fingerprints are local and are not encrypted by DiskMosaic.

## Troubleshooting

- **Empty or partial results:** review access errors, exclusions and cancellation status. Check that the selected directory is accessible to the current user.
- **Allocated size differs from file size:** review the size-basis explanation above; availability depends on the filesystem.
- **History differs between editions:** separate databases and schema capabilities are intentional. Exchange snapshots rather than sharing a database path.
- **Watcher says results are stale:** refresh the selected subtree or run a new scan.
- **Linux portable application does not start:** confirm a graphical session, required desktop runtime libraries and supported Chromium sandbox configuration. Prefer the Debian package when namespace restrictions require an installed sandbox helper. Do not disable the sandbox as a workaround.
- **Build failure:** use the committed lockfiles and the toolchain versions recorded in CI. See the [build guide](BUILDING.md) for local commands.

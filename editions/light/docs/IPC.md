# DiskMosaic engine protocol — version 4

DiskMosaic uses one long-lived Rust child process. Commands are UTF-8 JSON objects, one
object per line on stdin. Events are UTF-8 JSON objects, one object per line on stdout.
`stderr` is diagnostic-only and never carries protocol data.

`engine_ready` reports protocol `4`, the engine version, and whether local SQLite history is available. Every request can include a
`request_id`; query responses echo it. A scan uses its initiating request ID as the scan
identifier when one is supplied.

## Commands

- `list_roots`
- `scan { path, options }`
  - `workers`
  - `follow_symlinks`
  - `cross_filesystems`
  - `deduplicate_hardlinks`
  - `exclude_patterns`: case-insensitive wildcard patterns supporting `*` and `?`; unprefixed or `name:` rules match basenames, while `path:` rules match scan-relative paths
- `pause`
- `resume`
- `cancel`
- `get_root`
- `children { parent_id, offset, limit, sort, descending, hidden_mode? }`
  - `sort` may include `name`, `size`, `allocated`, `files`, `directories`, `modified`
- `get_node { node_id }`
- `ancestors { node_id }`
- `treemap { parent_id, max_items, min_bytes, size_basis, filter_extensions, hidden_mode? }`
  - `filter_extensions` is optional; when present, each returned tile carries `matches_filter` so file, directory-subtree, and aggregate-remainder highlighting is exact
- `largest { limit, size_basis, hidden_mode? }`
- `search { name_contains, path_contains, extension, min_size, max_size, kind,
  modified_before_ms, modified_after_ms, size_basis, limit, hidden_mode? }`
- `statistics`
- `get_errors { offset, limit }`
- `get_metadata { node_id }` — lazy platform metadata for one selected entry
- selection: `selection_replace`, `selection_add`, `selection_toggle`, `selection_clear`, `selection_summary`, `selection_page`
- incremental refresh: `refresh_selected`, `refresh_paths`
- filesystem watching: `watch_start`, `watch_stop`, `watch_pause`, `watch_resume`, `watch_status`
- SQLite history: `history_status`, `history_store_current`, `history_list`, `history_load`, `history_delete`
- `compare_history { scan_id, limit }`
- `duplicate_scan { min_size, max_groups }`
- `cancel_analysis`
- `save_snapshot { path }`
- `load_snapshot { path }`
- `compare_snapshot { path, limit }`
- `trash { node_id }`
- `batch_trash`
- `hash_selection`
- `shutdown`

`size_basis` is `logical` or `allocated`; omitted/invalid values default to `logical`.

`hidden_mode` is an optional display policy: `show_all`, `directories_only`, or `hide_all`. It changes which entries are returned for browsing/query views but never changes scan totals or filesystem accounting. Windows hidden state comes from the native Hidden attribute; Linux/Unix uses dot-prefixed names. Omitting the field uses the default policy (`show_all`).


## Events

- `engine_ready`
- `scan_started`
- `scan_progress`
  - live files/directories/logical bytes/allocated bytes/errors/excluded counters
  - elapsed time, current path, and paused state
- `scan_pause_changed`
- `scan_completed`
  - root summary
  - scan summary with logical + allocated totals
  - extension statistics with logical + allocated totals
  - size/age/depth/hard-link statistics
  - filesystem capacity context: `filesystem_total_bytes`, `filesystem_available_bytes`, `filesystem_used_bytes` when available
- `scan_cancelled`
- `scan_error`
- `duplicate_started`, `duplicate_progress`, `duplicate_completed`
- `analysis_cancel_requested`
- `snapshot_saved`, `snapshot_loaded`
- `comparison_completed`
- selection responses: `selection_changed`, `selection_page`
- incremental refresh: `refresh_started`, `refresh_progress`, `refresh_completed`, `refresh_cancelled`
- watcher state/change events: `watcher_state`, `watcher_changed`
- history responses: `history_status`, `history_stored`, `history_list`, `history_loaded`, `history_deleted`
- lazy metadata: `metadata`
- batch/hash completion events
- query responses: `roots`, `children`, `node`, `ancestors`, `treemap`, `largest`,
  `search_results`, `statistics`, `errors`
- `operation_completed`, `operation_failed`
- `protocol_error`

## Memory and throughput design

The engine does not transmit a complete multi-million-node filesystem tree to Electron.
It retains a compact node arena using numeric IDs and parent IDs. During traversal the GUI
receives small progress events. After completion, views query only what they need.

Directory children are paged. Logical Largest Files uses the precomputed top-1000 index;
allocated Largest Files computes a separate bounded top-K because sparse/compressed files
can rank differently. Search scans the compact arena but retains only bounded top-K matches
using the requested size basis. An ancestor query lets treemap/search selections open only
the required tree branches.

A `treemap` response is a bounded serialization of a pruned hierarchy. Real directory and
file nodes retain `parent_id`; each expanded directory exposes its largest direct children,
and omitted children become one synthetic remainder node carrying exact logical, allocated,
and active-basis totals. Directory expansion is best-first and globally/per-directory bounded.
When `filter_extensions` is supplied, the engine performs one bottom-up in-memory match pass so
`matches_filter` remains correct for directory subtrees and synthetic remainder nodes without
sending the complete filesystem tree to Electron.

Saved scans are serialized/deserialized entirely in the Rust process. Saving serializes the
existing model by reference rather than cloning the node arena. Duplicate analysis is also
engine-side and sends only progress plus bounded verified result groups. Snapshot comparison
keeps only a bounded heap of the most significant changes rather than returning every changed
entry.

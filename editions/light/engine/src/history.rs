use crate::model::{Node, NodeKind, ScanError, ScanModel, ScanStatistics};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: i64 = 2;

const CREATE_SCHEMA_META_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value INTEGER NOT NULL
);
"#;

const CREATE_SCHEMA_V1_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_path TEXT NOT NULL,
    saved_ms INTEGER NOT NULL,
    logical_bytes INTEGER NOT NULL,
    allocated_bytes INTEGER NOT NULL,
    files INTEGER NOT NULL,
    directories INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    excluded_count INTEGER NOT NULL,
    scan_elapsed_ms INTEGER NOT NULL,
    filesystem_total_bytes INTEGER,
    filesystem_available_bytes INTEGER,
    node_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_root_saved ON scans(root_path, saved_ms DESC);

CREATE TABLE IF NOT EXISTS nodes (
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    node_id INTEGER NOT NULL,
    parent_id INTEGER,
    active INTEGER NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    logical_size INTEGER NOT NULL,
    allocated_size INTEGER NOT NULL,
    raw_size INTEGER NOT NULL,
    raw_allocated_size INTEGER NOT NULL,
    identity_volume INTEGER,
    identity_index INTEGER,
    modified_ms INTEGER,
    extension TEXT NOT NULL,
    type_hint TEXT NOT NULL DEFAULT '',
    file_count INTEGER NOT NULL,
    dir_count INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    hardlink_duplicate INTEGER NOT NULL,
    link_count INTEGER NOT NULL,
    PRIMARY KEY(scan_id,node_id)
);
CREATE INDEX IF NOT EXISTS nodes_scan_parent ON nodes(scan_id,parent_id,node_id);
CREATE INDEX IF NOT EXISTS nodes_scan_size ON nodes(scan_id,logical_size DESC);
CREATE INDEX IF NOT EXISTS nodes_scan_extension ON nodes(scan_id,extension);

CREATE TABLE IF NOT EXISTS scan_errors (
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    path TEXT NOT NULL,
    message TEXT NOT NULL,
    PRIMARY KEY(scan_id,ordinal)
);

CREATE TABLE IF NOT EXISTS fingerprint_cache (
    cache_key TEXT PRIMARY KEY NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER,
    sample_hash TEXT NOT NULL,
    full_hash TEXT,
    updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fingerprint_cache_updated ON fingerprint_cache(updated_ms);
"#;

const INSERT_SCAN_SQL: &str = r#"
INSERT INTO scans(
    root_path,saved_ms,logical_bytes,allocated_bytes,files,directories,
    error_count,excluded_count,scan_elapsed_ms,filesystem_total_bytes,
    filesystem_available_bytes,node_count
)
VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
"#;

const INSERT_NODE_SQL: &str = r#"
INSERT INTO nodes(
    scan_id,node_id,parent_id,active,name,kind,logical_size,allocated_size,
    raw_size,raw_allocated_size,identity_volume,identity_index,modified_ms,
    extension,type_hint,file_count,dir_count,depth,hardlink_duplicate,link_count
)
VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
"#;

const LIST_SCANS_SQL: &str = r#"
SELECT id,root_path,saved_ms,logical_bytes,allocated_bytes,files,directories,error_count,node_count
FROM scans
ORDER BY saved_ms DESC,id DESC
LIMIT ?1 OFFSET ?2
"#;

const LOAD_SCAN_SQL: &str = r#"
SELECT root_path,saved_ms,logical_bytes,allocated_bytes,files,directories,
       error_count,excluded_count,scan_elapsed_ms,filesystem_total_bytes,
       filesystem_available_bytes,node_count
FROM scans
WHERE id=?1
"#;

const LOAD_NODES_SQL: &str = r#"
SELECT node_id,parent_id,active,name,kind,logical_size,allocated_size,raw_size,
       raw_allocated_size,identity_volume,identity_index,modified_ms,extension,type_hint,
       file_count,dir_count,depth,hardlink_duplicate,link_count
FROM nodes
WHERE scan_id=?1
ORDER BY node_id ASC
"#;

const UPSERT_FINGERPRINT_SQL: &str = r#"
INSERT INTO fingerprint_cache(cache_key,size,modified_ms,sample_hash,full_hash,updated_ms)
VALUES(?1,?2,?3,?4,?5,?6)
ON CONFLICT(cache_key) DO UPDATE SET
    size=excluded.size,
    modified_ms=excluded.modified_ms,
    sample_hash=excluded.sample_hash,
    full_hash=excluded.full_hash,
    updated_ms=excluded.updated_ms
"#;

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub root_path: String,
    pub saved_ms: u64,
    pub logical_bytes: u64,
    pub allocated_bytes: u64,
    pub files: u64,
    pub directories: u64,
    pub errors: u64,
    pub nodes: u64,
}

#[derive(Debug, Clone)]
pub struct FingerprintCacheEntry {
    pub sample_hash: String,
    pub full_hash: Option<String>,
}

pub fn default_database_path() -> Option<PathBuf> {
    std::env::var_os("DISKMOSAIC_DATA_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|dir| dir.join("history-v1.sqlite3"))
}

fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create DiskMosaic data directory {}: {e}", parent.display()))?;
    }
    let mut conn = Connection::open(path).map_err(|e| format!("Cannot open history database {}: {e}", path.display()))?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(db_error)?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(db_error)?;
    conn.pragma_update(None, "synchronous", "NORMAL").map_err(db_error)?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch(CREATE_SCHEMA_META_SQL).map_err(db_error)?;
    let version: Option<i64> = conn.query_row(
        "SELECT value FROM schema_meta WHERE key='schema_version'", [], |row| row.get(0)
    ).optional().map_err(db_error)?;
    match version {
        None => {
            let tx = conn.transaction().map_err(db_error)?;
            create_schema_v1(&tx)?;
            tx.execute("INSERT INTO schema_meta(key,value) VALUES('schema_version',?1)", params![SCHEMA_VERSION]).map_err(db_error)?;
            tx.commit().map_err(db_error)?;
        }
        Some(v) if v == SCHEMA_VERSION => create_schema_v1(conn)?,
        Some(1) => {
            let tx = conn.transaction().map_err(db_error)?;
            tx.execute_batch("ALTER TABLE nodes ADD COLUMN type_hint TEXT NOT NULL DEFAULT '';").map_err(db_error)?;
            tx.execute("UPDATE schema_meta SET value=?1 WHERE key='schema_version'", params![SCHEMA_VERSION]).map_err(db_error)?;
            tx.commit().map_err(db_error)?;
            create_schema_v1(conn)?;
        }
        Some(v) if v > SCHEMA_VERSION => return Err(format!("History database schema {v} is newer than this DiskMosaic version supports")),
        Some(v) => return Err(format!("Unsupported history database schema {v}; migration path is unavailable")),
    }
    Ok(())
}

fn create_schema_v1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(CREATE_SCHEMA_V1_SQL).map_err(db_error)
}

pub fn database_status(path: &Path) -> Result<(i64, u64), String> {
    let conn = open(path)?;
    let scans: i64 = conn.query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0)).map_err(db_error)?;
    Ok((SCHEMA_VERSION, scans.max(0) as u64))
}

pub fn store_scan(path: &Path, model: &ScanModel) -> Result<HistoryEntry, String> {
    let mut conn = open(path)?;
    let tx = conn.transaction().map_err(db_error)?;
    let saved_ms = now_ms();
    let root = model.nodes.first();
    let files = root.map(|n| n.file_count).unwrap_or(0);
    let directories = root.map(|n| n.dir_count.saturating_add(1)).unwrap_or(0);
    tx.execute(
        INSERT_SCAN_SQL,
        params![
            model.root_path.to_string_lossy(), i64u(saved_ms)?, i64u(model.scanned_bytes)?, i64u(model.allocated_bytes)?,
            i64u(files)?, i64u(directories)?, i64u(model.error_count)?, i64u(model.excluded_count)?, i64u(model.scan_elapsed_ms)?,
            opt_i64u(model.filesystem_total_bytes)?, opt_i64u(model.filesystem_available_bytes)?, i64usize(model.nodes.len())?
        ],
    ).map_err(db_error)?;
    let scan_id = tx.last_insert_rowid();
    insert_nodes(&tx, scan_id, model)?;
    {
        let mut stmt = tx.prepare("INSERT INTO scan_errors(scan_id,ordinal,path,message) VALUES(?1,?2,?3,?4)").map_err(db_error)?;
        for (ordinal, error) in model.errors.iter().enumerate() {
            stmt.execute(params![scan_id, i64usize(ordinal)?, error.path, error.message]).map_err(db_error)?;
        }
    }
    tx.commit().map_err(db_error)?;
    Ok(HistoryEntry {
        id: scan_id,
        root_path: model.root_path.to_string_lossy().into_owned(),
        saved_ms,
        logical_bytes: model.scanned_bytes,
        allocated_bytes: model.allocated_bytes,
        files,
        directories,
        errors: model.error_count,
        nodes: model.active_node_count() as u64,
    })
}

fn insert_nodes(tx: &Transaction<'_>, scan_id: i64, model: &ScanModel) -> Result<(), String> {
    let mut stmt = tx.prepare(
        INSERT_NODE_SQL
    ).map_err(db_error)?;
    for node in &model.nodes {
        stmt.execute(params![
            scan_id, i64::from(node.id), node.parent_id.map(i64::from), bool_i64(node.active), node.name, kind_name(node.kind),
            i64u(node.size)?, i64u(node.allocated_size)?, i64u(node.raw_size)?, i64u(node.raw_allocated_size)?,
            opt_i64u(node.identity_volume)?, opt_i64u(node.identity_index)?, opt_i64u(node.modified_ms)?, node.extension, node.type_hint,
            i64u(node.file_count)?, i64u(node.dir_count)?, i64::from(node.depth), bool_i64(node.hardlink_duplicate), i64u(node.link_count)?
        ]).map_err(db_error)?;
    }
    Ok(())
}

pub fn list_scans(path: &Path, offset: usize, limit: usize) -> Result<(u64, Vec<HistoryEntry>), String> {
    let conn = open(path)?;
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0)).map_err(db_error)?;
    let mut stmt = conn.prepare(
        LIST_SCANS_SQL
    ).map_err(db_error)?;
    let rows = stmt.query_map(params![i64usize(limit.clamp(1, 500))?, i64usize(offset)?], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?, root_path: row.get(1)?, saved_ms: i64_to_u64(row.get(2)?),
            logical_bytes: i64_to_u64(row.get(3)?), allocated_bytes: i64_to_u64(row.get(4)?),
            files: i64_to_u64(row.get(5)?), directories: i64_to_u64(row.get(6)?),
            errors: i64_to_u64(row.get(7)?), nodes: i64_to_u64(row.get(8)?),
        })
    }).map_err(db_error)?;
    let mut entries = Vec::new();
    for row in rows { entries.push(row.map_err(db_error)?); }
    Ok((total.max(0) as u64, entries))
}

pub fn delete_scan(path: &Path, scan_id: i64) -> Result<bool, String> {
    let conn = open(path)?;
    let changed = conn.execute("DELETE FROM scans WHERE id=?1", params![scan_id]).map_err(db_error)?;
    Ok(changed > 0)
}

pub fn load_scan(path: &Path, scan_id: i64) -> Result<(ScanModel, HistoryEntry), String> {
    let conn = open(path)?;
    let row = conn.query_row(
        LOAD_SCAN_SQL,
        params![scan_id],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?, row.get::<_, i64>(5)?, row.get::<_, i64>(6)?, row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?, row.get::<_, Option<i64>>(9)?, row.get::<_, Option<i64>>(10)?, row.get::<_, i64>(11)?,
        )),
    ).optional().map_err(db_error)?.ok_or_else(|| format!("History scan {scan_id} does not exist"))?;

    let (root_path, saved_ms_i, logical_i, allocated_i, files_i, dirs_i, errors_i, excluded_i, elapsed_i, fs_total_i, fs_avail_i, node_count_i) = row;
    let expected_nodes = i64_to_u64(node_count_i) as usize;
    let mut stmt = conn.prepare(
        LOAD_NODES_SQL
    ).map_err(db_error)?;
    let node_rows = stmt.query_map(params![scan_id], |row| {
        let kind_text: String = row.get(4)?;
        Ok(Node {
            id: i64_to_u64(row.get(0)?) as u32,
            parent_id: row.get::<_, Option<i64>>(1)?.map(|v| i64_to_u64(v) as u32),
            active: row.get::<_, i64>(2)? != 0,
            hidden: false,
            name: row.get(3)?,
            kind: parse_kind(&kind_text),
            size: i64_to_u64(row.get(5)?),
            allocated_size: i64_to_u64(row.get(6)?),
            raw_size: i64_to_u64(row.get(7)?),
            raw_allocated_size: i64_to_u64(row.get(8)?),
            identity_volume: row.get::<_, Option<i64>>(9)?.map(i64_to_u64),
            identity_index: row.get::<_, Option<i64>>(10)?.map(i64_to_u64),
            modified_ms: row.get::<_, Option<i64>>(11)?.map(i64_to_u64),
            extension: row.get(12)?,
            type_hint: row.get(13)?,
            file_count: i64_to_u64(row.get(14)?),
            dir_count: i64_to_u64(row.get(15)?),
            depth: i64_to_u64(row.get(16)?) as u32,
            hardlink_duplicate: row.get::<_, i64>(17)? != 0,
            link_count: i64_to_u64(row.get(18)?),
            children: Vec::new(),
        })
    }).map_err(db_error)?;
    // Persisted counts may be corrupt; grow from rows rather than trusting an allocation request.
    let mut nodes = Vec::with_capacity(expected_nodes.min(65_536));
    for row in node_rows {
        let node = row.map_err(db_error)?;
        if node.id as usize != nodes.len() {
            return Err(format!("History scan {scan_id} has a non-contiguous node arena at ID {}", node.id));
        }
        nodes.push(node);
    }
    if nodes.len() != expected_nodes {
        return Err(format!("History scan {scan_id} node count mismatch: expected {expected_nodes}, found {}", nodes.len()));
    }
    // Rebuild child vectors from parent IDs; storing only parent IDs avoids an
    // unbounded JSON/text column for directories with huge child counts.
    for id in 1..nodes.len() {
        if let Some(parent_id) = nodes[id].parent_id {
            if let Some(parent) = nodes.get_mut(parent_id as usize) { parent.children.push(id as u32); }
            else { return Err(format!("History scan {scan_id} references missing parent {parent_id}")); }
        }
    }

    let mut error_stmt = conn.prepare("SELECT path,message FROM scan_errors WHERE scan_id=?1 ORDER BY ordinal ASC").map_err(db_error)?;
    let error_rows = error_stmt.query_map(params![scan_id], |row| Ok(ScanError { path: row.get(0)?, message: row.get(1)? })).map_err(db_error)?;
    let mut errors = Vec::new();
    for row in error_rows { errors.push(row.map_err(db_error)?); }

    let mut model = ScanModel {
        root_path: PathBuf::from(&root_path), nodes, errors,
        error_count: i64_to_u64(errors_i), excluded_count: i64_to_u64(excluded_i),
        extension_stats: Vec::new(), statistics: ScanStatistics::default(), largest: Vec::new(),
        scanned_bytes: i64_to_u64(logical_i), allocated_bytes: i64_to_u64(allocated_i),
        scan_elapsed_ms: i64_to_u64(elapsed_i),
        filesystem_total_bytes: fs_total_i.map(i64_to_u64), filesystem_available_bytes: fs_avail_i.map(i64_to_u64),
    };
    model.validate_structure().map_err(|error| format!("Invalid history scan: {error}"))?;
    model.build_indexes();
    let info = HistoryEntry {
        id: scan_id, root_path, saved_ms: i64_to_u64(saved_ms_i), logical_bytes: i64_to_u64(logical_i),
        allocated_bytes: i64_to_u64(allocated_i), files: i64_to_u64(files_i), directories: i64_to_u64(dirs_i),
        errors: i64_to_u64(errors_i), nodes: model.active_node_count() as u64,
    };
    Ok((model, info))
}

pub fn get_fingerprint(path: &Path, cache_key: &str, size: u64, modified_ms: Option<u64>) -> Result<Option<FingerprintCacheEntry>, String> {
    let conn = open(path)?;
    conn.query_row(
        "SELECT sample_hash,full_hash FROM fingerprint_cache WHERE cache_key=?1 AND size=?2 AND ((modified_ms IS NULL AND ?3 IS NULL) OR modified_ms=?3)",
        params![cache_key, i64u(size)?, opt_i64u(modified_ms)?],
        |row| Ok(FingerprintCacheEntry { sample_hash: row.get(0)?, full_hash: row.get(1)? }),
    ).optional().map_err(db_error)
}

pub fn put_fingerprint(path: &Path, cache_key: &str, size: u64, modified_ms: Option<u64>, sample_hash: &str, full_hash: Option<&str>) -> Result<(), String> {
    let conn = open(path)?;
    conn.execute(
        UPSERT_FINGERPRINT_SQL,
        params![cache_key, i64u(size)?, opt_i64u(modified_ms)?, sample_hash, full_hash, i64u(now_ms())?],
    ).map_err(db_error)?;
    Ok(())
}

fn kind_name(kind: NodeKind) -> &'static str {
    match kind { NodeKind::Directory => "directory", NodeKind::File => "file", NodeKind::Symlink => "symlink", NodeKind::Other => "other" }
}
fn parse_kind(value: &str) -> NodeKind {
    match value { "directory" => NodeKind::Directory, "file" => NodeKind::File, "symlink" => NodeKind::Symlink, _ => NodeKind::Other }
}
fn bool_i64(value: bool) -> i64 { if value { 1 } else { 0 } }
fn i64_to_u64(value: i64) -> u64 { value.max(0) as u64 }
fn i64u(value: u64) -> Result<i64, String> { i64::try_from(value).map_err(|_| format!("Value {value} exceeds SQLite signed-integer range")) }
fn i64usize(value: usize) -> Result<i64, String> { i64::try_from(value).map_err(|_| format!("Value {value} exceeds SQLite signed-integer range")) }
fn opt_i64u(value: Option<u64>) -> Result<Option<i64>, String> { value.map(i64u).transpose() }
fn db_error(error: rusqlite::Error) -> String { format!("SQLite error: {error}") }
fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DB: AtomicU64 = AtomicU64::new(0);

    fn test_db(label: &str) -> PathBuf {
        let ordinal = NEXT_TEST_DB.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "diskmosaic-{label}-{}-{ordinal}.sqlite3",
            std::process::id()
        ))
    }

    fn cleanup_db(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    fn minimal(root: &Path, size: u64) -> ScanModel {
        ScanModel {
            root_path: root.to_path_buf(),
            nodes: vec![Node {
                id: 0,
                parent_id: None,
                active: true,
                hidden: false,
                name: "root".into(),
                kind: NodeKind::Directory,
                size,
                allocated_size: size,
                raw_size: 0,
                raw_allocated_size: 0,
                identity_volume: None,
                identity_index: None,
                modified_ms: None,
                extension: String::new(),
                type_hint: String::new(),
                children: vec![],
                file_count: 0,
                dir_count: 0,
                depth: 0,
                hardlink_duplicate: false,
                link_count: 1,
            }],
            errors: vec![],
            error_count: 0,
            excluded_count: 0,
            extension_stats: vec![],
            statistics: ScanStatistics::default(),
            largest: vec![],
            scanned_bytes: size,
            allocated_bytes: size,
            scan_elapsed_ms: 1,
            filesystem_total_bytes: None,
            filesystem_available_bytes: None,
        }
    }

    fn model_with_file_and_error(root: &Path, size: u64) -> ScanModel {
        let mut model = minimal(root, size);
        model.nodes[0].children = vec![1];
        model.nodes[0].file_count = 1;
        model.nodes.push(Node {
            id: 1,
            parent_id: Some(0),
            active: true,
            hidden: false,
            name: "árvíztűrő-世界.bin".into(),
            kind: NodeKind::File,
            size,
            allocated_size: size.saturating_add(4096),
            raw_size: size,
            raw_allocated_size: size.saturating_add(4096),
            identity_volume: Some(7),
            identity_index: Some(9),
            modified_ms: Some(123_456),
            extension: "bin".into(),
            type_hint: "binary".into(),
            children: vec![],
            file_count: 1,
            dir_count: 0,
            depth: 1,
            hardlink_duplicate: false,
            link_count: 1,
        });
        model.errors.push(ScanError {
            path: root.join("unreadable").to_string_lossy().into_owned(),
            message: "fixture error".into(),
        });
        model.error_count = 1;
        model.allocated_bytes = size.saturating_add(4096);
        model
    }

    #[test]
    fn history_sql_statements_prepare_against_schema() {
        let db = test_db("history-sql-prepare");
        cleanup_db(&db);
        let conn = open(&db).expect("history database should initialize before SQL preparation tests");

        for (name, sql) in [
            ("insert scan", INSERT_SCAN_SQL),
            ("insert node", INSERT_NODE_SQL),
            ("list scans", LIST_SCANS_SQL),
            ("load scan", LOAD_SCAN_SQL),
            ("load nodes", LOAD_NODES_SQL),
            ("upsert fingerprint", UPSERT_FINGERPRINT_SQL),
        ] {
            conn.prepare(sql)
                .unwrap_or_else(|error| panic!("history SQL statement `{name}` failed to prepare: {error}\nSQL:\n{sql}"));
        }
        drop(conn);
        cleanup_db(&db);
    }

    #[test]
    fn history_schema_contains_required_tables_columns_and_indexes() {
        let db = test_db("history-schema");
        cleanup_db(&db);
        let conn = open(&db).expect("history database should initialize");

        let mut stmt = conn.prepare("PRAGMA table_info(scans)").expect("scans schema should be queryable");
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get(1))
            .expect("scans PRAGMA should execute")
            .collect::<Result<Vec<_>, _>>()
            .expect("scans PRAGMA rows should decode");
        for required in [
            "id", "root_path", "saved_ms", "logical_bytes", "allocated_bytes",
            "files", "directories", "error_count", "excluded_count", "scan_elapsed_ms",
            "filesystem_total_bytes", "filesystem_available_bytes", "node_count",
        ] {
            assert!(columns.iter().any(|column| column == required), "missing scans column: {required}; got {columns:?}");
        }

        let mut node_stmt = conn.prepare("PRAGMA table_info(nodes)").expect("nodes schema should be queryable");
        let node_columns: Vec<String> = node_stmt
            .query_map([], |row| row.get(1))
            .expect("nodes PRAGMA should execute")
            .collect::<Result<Vec<_>, _>>()
            .expect("nodes PRAGMA rows should decode");
        assert!(node_columns.iter().any(|column| column == "type_hint"), "nodes.type_hint is required; got {node_columns:?}");
        drop(node_stmt);

        for table in ["schema_meta", "scans", "nodes", "scan_errors", "fingerprint_cache"] {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                params![table],
                |row| row.get(0),
            ).expect("sqlite_master query should succeed");
            assert_eq!(exists, 1, "required history table is missing: {table}");
        }

        let version: i64 = conn.query_row(
            "SELECT value FROM schema_meta WHERE key='schema_version'",
            [],
            |row| row.get(0),
        ).expect("schema version should be recorded");
        assert_eq!(version, SCHEMA_VERSION);
        drop(stmt);
        drop(conn);
        cleanup_db(&db);
    }

    #[test]
    fn history_migrates_schema_v1_type_hints_without_losing_rows() {
        let db = test_db("history-v1-migration");
        cleanup_db(&db);
        {
            let conn = Connection::open(&db).expect("create v1 fixture");
            conn.execute_batch(CREATE_SCHEMA_META_SQL).unwrap();
            // Recreate the schema 1 nodes table without type_hint.
            conn.execute_batch(r#"
                CREATE TABLE scans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, root_path TEXT NOT NULL, saved_ms INTEGER NOT NULL,
                    logical_bytes INTEGER NOT NULL, allocated_bytes INTEGER NOT NULL, files INTEGER NOT NULL,
                    directories INTEGER NOT NULL, error_count INTEGER NOT NULL, excluded_count INTEGER NOT NULL,
                    scan_elapsed_ms INTEGER NOT NULL, filesystem_total_bytes INTEGER, filesystem_available_bytes INTEGER,
                    node_count INTEGER NOT NULL
                );
                CREATE TABLE nodes (
                    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE, node_id INTEGER NOT NULL,
                    parent_id INTEGER, active INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
                    logical_size INTEGER NOT NULL, allocated_size INTEGER NOT NULL, raw_size INTEGER NOT NULL,
                    raw_allocated_size INTEGER NOT NULL, identity_volume INTEGER, identity_index INTEGER,
                    modified_ms INTEGER, extension TEXT NOT NULL, file_count INTEGER NOT NULL, dir_count INTEGER NOT NULL,
                    depth INTEGER NOT NULL, hardlink_duplicate INTEGER NOT NULL, link_count INTEGER NOT NULL,
                    PRIMARY KEY(scan_id,node_id)
                );
                CREATE TABLE scan_errors (
                    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL,
                    path TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY(scan_id,ordinal)
                );
                CREATE TABLE fingerprint_cache (
                    cache_key TEXT PRIMARY KEY NOT NULL, size INTEGER NOT NULL, modified_ms INTEGER,
                    sample_hash TEXT NOT NULL, full_hash TEXT, updated_ms INTEGER NOT NULL
                );
                INSERT INTO schema_meta(key,value) VALUES('schema_version',1);
            "#).unwrap();
        }
        let conn = open(&db).expect("schema v1 should migrate to current");
        let version: i64 = conn.query_row(
            "SELECT value FROM schema_meta WHERE key='schema_version'", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let type_hint_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('nodes') WHERE name='type_hint'", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(type_hint_count, 1);
        drop(conn);
        cleanup_db(&db);
    }

    #[test]
    fn history_round_trip_and_multiple_same_root() {
        let root = std::env::temp_dir().join(format!("diskmosaic-history-root-{}", std::process::id()));
        let db = test_db("history-round-trip");
        cleanup_db(&db);
        let first = store_scan(&db, &model_with_file_and_error(&root, 42))
            .expect("first history store should succeed");
        let second = store_scan(&db, &minimal(&root, 84))
            .expect("second history store should succeed");
        assert_ne!(first.id, second.id);

        let (total, entries) = list_scans(&db, 0, 10)
            .expect("history list query should parse and execute");
        assert_eq!(total, 2);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].logical_bytes, 84);

        let (loaded, info) = load_scan(&db, first.id)
            .expect("stored history scan should load");
        assert_eq!(loaded.scanned_bytes, 42);
        assert_eq!(loaded.nodes.len(), 2);
        assert_eq!(loaded.nodes[1].name, "árvíztűrő-世界.bin");
        assert_eq!(loaded.nodes[1].type_hint, "binary");
        assert_eq!(loaded.errors.len(), 1);
        assert_eq!(info.errors, 1);

        assert!(delete_scan(&db, first.id).expect("history deletion should succeed"));
        assert_eq!(list_scans(&db, 0, 10).expect("history list after deletion should succeed").0, 1);
        cleanup_db(&db);
    }

    #[test]
    fn history_list_paginates_and_orders_newest_id_first() {
        let root = std::env::temp_dir().join("diskmosaic-history-pagination-root");
        let db = test_db("history-pagination");
        cleanup_db(&db);
        let first = store_scan(&db, &minimal(&root, 10)).expect("store 1");
        let second = store_scan(&db, &minimal(&root, 20)).expect("store 2");
        let third = store_scan(&db, &minimal(&root, 30)).expect("store 3");

        let (total, page1) = list_scans(&db, 0, 2).expect("page 1");
        let (_, page2) = list_scans(&db, 2, 2).expect("page 2");
        assert_eq!(total, 3);
        assert_eq!(page1.len(), 2);
        assert_eq!(page2.len(), 1);
        assert_eq!(page1[0].id, third.id);
        assert_eq!(page1[1].id, second.id);
        assert_eq!(page2[0].id, first.id);
        cleanup_db(&db);
    }

    #[test]
    fn history_delete_cascades_nodes_and_errors() {
        let root = std::env::temp_dir().join("diskmosaic-history-cascade-root");
        let db = test_db("history-cascade");
        cleanup_db(&db);
        let entry = store_scan(&db, &model_with_file_and_error(&root, 123)).expect("history store");
        assert!(delete_scan(&db, entry.id).expect("history delete"));

        let conn = open(&db).expect("history database should reopen after delete");
        let node_count: i64 = conn.query_row("SELECT COUNT(*) FROM nodes WHERE scan_id=?1", params![entry.id], |row| row.get(0)).unwrap();
        let error_count: i64 = conn.query_row("SELECT COUNT(*) FROM scan_errors WHERE scan_id=?1", params![entry.id], |row| row.get(0)).unwrap();
        assert_eq!(node_count, 0, "ON DELETE CASCADE must remove stored nodes");
        assert_eq!(error_count, 0, "ON DELETE CASCADE must remove stored errors");
        drop(conn);
        cleanup_db(&db);
    }

    #[test]
    fn history_store_rolls_back_when_integer_exceeds_sqlite_range() {
        let root = std::env::temp_dir().join("diskmosaic-history-overflow-root");
        let db = test_db("history-overflow");
        cleanup_db(&db);
        let model = minimal(&root, u64::MAX);
        let error = store_scan(&db, &model).expect_err("u64::MAX must not be silently truncated into SQLite INTEGER");
        assert!(error.contains("exceeds SQLite signed-integer range"), "unexpected error: {error}");
        assert_eq!(list_scans(&db, 0, 10).expect("history should remain queryable after rollback").0, 0);
        cleanup_db(&db);
    }

    #[test]
    fn history_rejects_newer_schema_without_overwriting_version() {
        let db = test_db("history-newer-schema");
        cleanup_db(&db);
        {
            let conn = Connection::open(&db).expect("raw SQLite open");
            conn.execute_batch(CREATE_SCHEMA_META_SQL).expect("schema_meta creation");
            conn.execute(
                "INSERT INTO schema_meta(key,value) VALUES('schema_version',?1)",
                params![SCHEMA_VERSION + 100],
            ).expect("newer schema marker insertion");
        }

        let error = database_status(&db).expect_err("newer history schema must be rejected");
        assert!(error.contains("newer than this DiskMosaic version supports"), "unexpected error: {error}");

        let conn = Connection::open(&db).expect("raw SQLite reopen");
        let retained: i64 = conn.query_row(
            "SELECT value FROM schema_meta WHERE key='schema_version'",
            [],
            |row| row.get(0),
        ).expect("newer schema marker should remain intact");
        assert_eq!(retained, SCHEMA_VERSION + 100, "migration failure must not rewrite a newer database");
        drop(conn);
        cleanup_db(&db);
    }

    #[test]
    fn history_missing_scan_reports_requested_id() {
        let db = test_db("history-missing-scan");
        cleanup_db(&db);
        database_status(&db).expect("history database should initialize");
        let error = load_scan(&db, 424242).expect_err("missing history scan should fail clearly");
        assert!(error.contains("424242"), "missing-scan error should include requested ID: {error}");
        cleanup_db(&db);
    }

    #[test]
    fn history_rejects_a_cyclic_persisted_node_graph() {
        let db = test_db("history-invalid-tree");
        cleanup_db(&db);
        let root = std::env::temp_dir().join("diskmosaic-history-test-root");
        let entry = store_scan(&db, &model_with_file_and_error(&root, 42)).unwrap();
        {
            let conn = open(&db).unwrap();
            conn.execute("UPDATE nodes SET parent_id=node_id WHERE scan_id=?1 AND node_id=1", params![entry.id]).unwrap();
        }
        assert!(load_scan(&db, entry.id).is_err());
        cleanup_db(&db);
    }

    #[test]
    fn fingerprint_cache_invalidates_on_metadata_change() {
        let db = test_db("fingerprint-invalidation");
        cleanup_db(&db);
        put_fingerprint(&db, "k", 10, Some(100), "sample", Some("full")).expect("fingerprint insert");
        assert!(get_fingerprint(&db, "k", 10, Some(100)).expect("matching fingerprint lookup").is_some());
        assert!(get_fingerprint(&db, "k", 11, Some(100)).expect("size mismatch lookup").is_none());
        assert!(get_fingerprint(&db, "k", 10, Some(101)).expect("mtime mismatch lookup").is_none());
        cleanup_db(&db);
    }

    #[test]
    fn fingerprint_cache_supports_null_mtime_and_upsert() {
        let db = test_db("fingerprint-null-mtime");
        cleanup_db(&db);
        put_fingerprint(&db, "k", 10, None, "sample-a", None).expect("initial fingerprint insert");
        let first = get_fingerprint(&db, "k", 10, None).expect("initial lookup").expect("initial cache hit");
        assert_eq!(first.sample_hash, "sample-a");
        assert!(first.full_hash.is_none());

        put_fingerprint(&db, "k", 10, None, "sample-b", Some("full-b")).expect("fingerprint upsert");
        let second = get_fingerprint(&db, "k", 10, None).expect("updated lookup").expect("updated cache hit");
        assert_eq!(second.sample_hash, "sample-b");
        assert_eq!(second.full_hash.as_deref(), Some("full-b"));
        cleanup_db(&db);
    }
}

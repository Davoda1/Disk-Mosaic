use crate::analysis::category_for;
use crate::model::{Node, NodeKind, ScanError, ScanModel, ScanStatistics};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEMA_VERSION: i64 = 4;

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
    hidden INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    logical_size INTEGER NOT NULL,
    allocated_size INTEGER NOT NULL,
    raw_size INTEGER NOT NULL,
    raw_allocated_size INTEGER NOT NULL,
    identity_volume INTEGER,
    identity_index INTEGER,
    modified_ms INTEGER,
    created_ms INTEGER,
    owner_hint TEXT NOT NULL DEFAULT '',
    permissions_hint TEXT NOT NULL DEFAULT '',
    sparse INTEGER,
    compressed INTEGER,
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
CREATE INDEX IF NOT EXISTS nodes_scan_modified ON nodes(scan_id,modified_ms);

CREATE TABLE IF NOT EXISTS scan_extensions (
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    extension TEXT NOT NULL,
    files INTEGER NOT NULL,
    logical_bytes INTEGER NOT NULL,
    allocated_bytes INTEGER NOT NULL,
    PRIMARY KEY(scan_id,extension)
);
CREATE INDEX IF NOT EXISTS scan_extensions_extension_scan ON scan_extensions(extension,scan_id);

CREATE TABLE IF NOT EXISTS scan_categories (
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    files INTEGER NOT NULL,
    logical_bytes INTEGER NOT NULL,
    allocated_bytes INTEGER NOT NULL,
    PRIMARY KEY(scan_id,category)
);
CREATE INDEX IF NOT EXISTS scan_categories_category_scan ON scan_categories(category,scan_id);

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
    scan_id,node_id,parent_id,active,hidden,name,kind,logical_size,allocated_size,
    raw_size,raw_allocated_size,identity_volume,identity_index,modified_ms,
    created_ms,owner_hint,permissions_hint,sparse,compressed,
    extension,type_hint,file_count,dir_count,depth,hardlink_duplicate,link_count
)
VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26)
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
SELECT node_id,parent_id,active,hidden,name,kind,logical_size,allocated_size,raw_size,
       raw_allocated_size,identity_volume,identity_index,modified_ms,created_ms,owner_hint,
       permissions_hint,sparse,compressed,extension,type_hint,file_count,dir_count,depth,
       hardlink_duplicate,link_count
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
            tx.execute_batch("ALTER TABLE nodes ADD COLUMN type_hint TEXT NOT NULL DEFAULT ''; ").map_err(db_error)?;
            tx.execute("UPDATE schema_meta SET value=2 WHERE key='schema_version'", []).map_err(db_error)?;
            tx.commit().map_err(db_error)?;
            migrate(conn)?;
        }
        Some(2) => {
            let tx = conn.transaction().map_err(db_error)?;
            tx.execute_batch(r#"
                ALTER TABLE nodes ADD COLUMN created_ms INTEGER;
                ALTER TABLE nodes ADD COLUMN owner_hint TEXT NOT NULL DEFAULT '';
                ALTER TABLE nodes ADD COLUMN permissions_hint TEXT NOT NULL DEFAULT '';
                ALTER TABLE nodes ADD COLUMN sparse INTEGER;
                ALTER TABLE nodes ADD COLUMN compressed INTEGER;
                CREATE INDEX IF NOT EXISTS nodes_scan_modified ON nodes(scan_id,modified_ms);
                CREATE TABLE IF NOT EXISTS scan_extensions (
                    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
                    extension TEXT NOT NULL,
                    files INTEGER NOT NULL,
                    logical_bytes INTEGER NOT NULL,
                    allocated_bytes INTEGER NOT NULL,
                    PRIMARY KEY(scan_id,extension)
                );
                CREATE INDEX IF NOT EXISTS scan_extensions_extension_scan ON scan_extensions(extension,scan_id);
                CREATE TABLE IF NOT EXISTS scan_categories (
                    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE, category TEXT NOT NULL, files INTEGER NOT NULL, logical_bytes INTEGER NOT NULL, allocated_bytes INTEGER NOT NULL, PRIMARY KEY(scan_id,category)
                );
                CREATE INDEX IF NOT EXISTS scan_categories_category_scan ON scan_categories(category,scan_id);
                INSERT OR REPLACE INTO scan_extensions(scan_id,extension,files,logical_bytes,allocated_bytes)
                    SELECT scan_id,extension,COUNT(*),SUM(logical_size),SUM(allocated_size)
                    FROM nodes WHERE active=1 AND kind='file' AND hardlink_duplicate=0
                    GROUP BY scan_id,extension;
                INSERT OR REPLACE INTO scan_categories(scan_id,category,files,logical_bytes,allocated_bytes)
                    SELECT scan_id,
                      CASE
                        WHEN extension IN ('.mp4','.mkv','.avi','.mov','.webm','.ts','.m2ts','.mts') THEN 'Video'
                        WHEN extension IN ('.mp3','.flac','.wav','.m4a','.aac','.ogg','.opus','.wma') THEN 'Audio'
                        WHEN extension IN ('.png','.jpg','.jpeg','.gif','.webp','.bmp','.tif','.tiff','.svg','.heic','.avif','.raw') THEN 'Images'
                        WHEN extension IN ('.zip','.7z','.rar','.tar','.gz','.bz2','.xz','.zst') THEN 'Archives'
                        WHEN extension IN ('.iso','.vhd','.vhdx','.vmdk','.qcow','.qcow2','.img','.dmg','.wim','.vdi') THEN 'Disk images'
                        WHEN extension IN ('.pdf','.doc','.docx','.odt','.rtf','.txt','.md','.epub','.xlsx','.ods','.ppt','.pptx','.csv') THEN 'Documents'
                        WHEN extension IN ('.rs','.c','.h','.cc','.cpp','.cxx','.hpp','.m','.mm','.cs','.java','.go','.swift','.kt','.py','.js','.ts','.tsx','.php','.rb','.lua','.sql') THEN 'Development'
                        WHEN extension IN ('.exe','.msi','.com','.bat','.cmd','.ps1','.sh','.appimage') THEN 'Executables'
                        ELSE 'Other' END,
                      SUM(files),SUM(logical_bytes),SUM(allocated_bytes)
                    FROM scan_extensions GROUP BY scan_id,2;
            "#).map_err(db_error)?;
            tx.execute("UPDATE schema_meta SET value=3 WHERE key='schema_version'", []).map_err(db_error)?;
            tx.commit().map_err(db_error)?;
            migrate(conn)?;
        }
        Some(3) => {
            let tx = conn.transaction().map_err(db_error)?;
            tx.execute_batch("ALTER TABLE nodes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;").map_err(db_error)?;
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
        let mut stmt = tx.prepare("INSERT INTO scan_extensions(scan_id,extension,files,logical_bytes,allocated_bytes) VALUES(?1,?2,?3,?4,?5)").map_err(db_error)?;
        for stat in &model.extension_stats {
            stmt.execute(params![scan_id, stat.extension, i64u(stat.files)?, i64u(stat.size)?, i64u(stat.allocated_size)?]).map_err(db_error)?;
        }
    }
    {
        use std::collections::HashMap;
        let mut categories: HashMap<&'static str, (u64,u64,u64)> = HashMap::new();
        for node in model.nodes.iter().filter(|node| node.active && node.kind == NodeKind::File && !node.hardlink_duplicate) {
            let entry = categories.entry(category_for(node)).or_insert((0,0,0));
            entry.0 = entry.0.saturating_add(1);
            entry.1 = entry.1.saturating_add(node.size);
            entry.2 = entry.2.saturating_add(node.allocated_size);
        }
        let mut stmt = tx.prepare("INSERT INTO scan_categories(scan_id,category,files,logical_bytes,allocated_bytes) VALUES(?1,?2,?3,?4,?5)").map_err(db_error)?;
        for (category,(count,logical,allocated)) in categories {
            stmt.execute(params![scan_id, category, i64u(count)?, i64u(logical)?, i64u(allocated)?]).map_err(db_error)?;
        }
    }
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
            scan_id, i64::from(node.id), node.parent_id.map(i64::from), bool_i64(node.active), bool_i64(node.hidden), node.name, kind_name(node.kind),
            i64u(node.size)?, i64u(node.allocated_size)?, i64u(node.raw_size)?, i64u(node.raw_allocated_size)?,
            opt_i64u(node.identity_volume)?, opt_i64u(node.identity_index)?, opt_i64u(node.modified_ms)?, opt_i64u(node.created_ms)?,
            node.owner_hint, node.permissions_hint, node.sparse.map(bool_i64), node.compressed.map(bool_i64), node.extension, node.type_hint,
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
        let kind_text: String = row.get(5)?;
        Ok(Node {
            id: i64_to_u64(row.get(0)?) as u32,
            parent_id: row.get::<_, Option<i64>>(1)?.map(|v| i64_to_u64(v) as u32),
            active: row.get::<_, i64>(2)? != 0,
            hidden: row.get::<_, i64>(3)? != 0,
            name: row.get(4)?,
            kind: parse_kind(&kind_text),
            size: i64_to_u64(row.get(6)?),
            allocated_size: i64_to_u64(row.get(7)?),
            raw_size: i64_to_u64(row.get(8)?),
            raw_allocated_size: i64_to_u64(row.get(9)?),
            identity_volume: row.get::<_, Option<i64>>(10)?.map(i64_to_u64),
            identity_index: row.get::<_, Option<i64>>(11)?.map(i64_to_u64),
            modified_ms: row.get::<_, Option<i64>>(12)?.map(i64_to_u64),
            created_ms: row.get::<_, Option<i64>>(13)?.map(i64_to_u64),
            owner_hint: row.get(14)?,
            permissions_hint: row.get(15)?,
            sparse: row.get::<_, Option<i64>>(16)?.map(|value| value != 0),
            compressed: row.get::<_, Option<i64>>(17)?.map(|value| value != 0),
            extension: row.get(18)?,
            type_hint: row.get(19)?,
            file_count: i64_to_u64(row.get(20)?),
            dir_count: i64_to_u64(row.get(21)?),
            depth: i64_to_u64(row.get(22)?) as u32,
            hardlink_duplicate: row.get::<_, i64>(23)? != 0,
            link_count: i64_to_u64(row.get(24)?),
            children: Vec::new(),
        })
    }).map_err(db_error)?;
    // The persisted count may be corrupt. Grow from actual rows instead of
    // trusting it as an unchecked allocation request.
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

#[derive(Debug, Clone, Serialize)]
pub struct HistoryRoot {
    pub root_path: String,
    pub scans: u64,
    pub first_saved_ms: u64,
    pub last_saved_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryExtensionPoint {
    pub scan_id: i64,
    pub saved_ms: u64,
    pub logical_bytes: u64,
    pub allocated_bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryExtensionSeries {
    pub extension: String,
    pub points: Vec<HistoryExtensionPoint>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryCategorySeries {
    pub category: String,
    pub points: Vec<HistoryExtensionPoint>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryTimeline {
    pub root_path: String,
    pub total_points: u64,
    pub points: Vec<HistoryEntry>,
    pub extensions: Vec<HistoryExtensionSeries>,
    pub categories: Vec<HistoryCategorySeries>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryMaintenanceStatus {
    pub schema_version: i64,
    pub scans: u64,
    pub database_bytes: u64,
    pub fingerprint_entries: u64,
    pub integrity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionResult {
    pub before: u64,
    pub after: u64,
    pub deleted: u64,
}

pub fn history_roots(path: &Path) -> Result<Vec<HistoryRoot>, String> {
    let conn = open(path)?;
    let mut stmt = conn.prepare(
        "SELECT root_path,COUNT(*),MIN(saved_ms),MAX(saved_ms) FROM scans GROUP BY root_path ORDER BY MAX(saved_ms) DESC"
    ).map_err(db_error)?;
    let rows = stmt.query_map([], |row| Ok(HistoryRoot {
        root_path: row.get(0)?,
        scans: i64_to_u64(row.get(1)?),
        first_saved_ms: i64_to_u64(row.get(2)?),
        last_saved_ms: i64_to_u64(row.get(3)?),
    })).map_err(db_error)?;
    let mut out = Vec::new();
    for row in rows { out.push(row.map_err(db_error)?); }
    Ok(out)
}

pub fn history_timeline(
    path: &Path,
    root_path: &str,
    start_ms: Option<u64>,
    end_ms: Option<u64>,
    max_points: usize,
    top_extensions: usize,
) -> Result<HistoryTimeline, String> {
    use std::collections::{HashMap, HashSet};
    let conn = open(path)?;
    let start = i64u(start_ms.unwrap_or(0))?;
    let end = i64u(end_ms.unwrap_or(i64::MAX as u64))?;
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM scans WHERE root_path=?1 AND saved_ms>=?2 AND saved_ms<=?3",
        params![root_path, start, end], |row| row.get(0)
    ).map_err(db_error)?;
    let mut stmt = conn.prepare(
        "SELECT id,root_path,saved_ms,logical_bytes,allocated_bytes,files,directories,error_count,node_count \
         FROM scans WHERE root_path=?1 AND saved_ms>=?2 AND saved_ms<=?3 ORDER BY saved_ms ASC,id ASC LIMIT 50000"
    ).map_err(db_error)?;
    let rows = stmt.query_map(params![root_path, start, end], |row| Ok(HistoryEntry {
        id: row.get(0)?, root_path: row.get(1)?, saved_ms: i64_to_u64(row.get(2)?),
        logical_bytes: i64_to_u64(row.get(3)?), allocated_bytes: i64_to_u64(row.get(4)?),
        files: i64_to_u64(row.get(5)?), directories: i64_to_u64(row.get(6)?),
        errors: i64_to_u64(row.get(7)?), nodes: i64_to_u64(row.get(8)?),
    })).map_err(db_error)?;
    let mut all = Vec::new();
    for row in rows { all.push(row.map_err(db_error)?); }
    let cap = max_points.clamp(2, 2000);
    let points = if all.len() <= cap {
        all
    } else {
        let last = all.len() - 1;
        let mut sampled = Vec::with_capacity(cap);
        for index in 0..cap {
            let source = index.saturating_mul(last) / (cap - 1);
            if sampled.last().map_or(true, |entry: &HistoryEntry| entry.id != all[source].id) {
                sampled.push(all[source].clone());
            }
        }
        sampled
    };
    let sampled_ids: HashSet<i64> = points.iter().map(|point| point.id).collect();
    let saved_by_id: HashMap<i64, u64> = points.iter().map(|point| (point.id, point.saved_ms)).collect();
    let top_extensions = top_extensions.clamp(1, 32);
    let sql = r#"
        WITH top_ext AS (
            SELECT se.extension AS extension, SUM(se.logical_bytes) AS aggregate_bytes
            FROM scan_extensions se JOIN scans s ON s.id=se.scan_id
            WHERE s.root_path=?1 AND s.saved_ms>=?2 AND s.saved_ms<=?3
            GROUP BY se.extension ORDER BY aggregate_bytes DESC LIMIT ?4
        )
        SELECT se.scan_id,se.extension,se.files,se.logical_bytes,se.allocated_bytes
        FROM scan_extensions se JOIN scans s ON s.id=se.scan_id
        WHERE s.root_path=?1 AND s.saved_ms>=?2 AND s.saved_ms<=?3
          AND se.extension IN (SELECT extension FROM top_ext)
        ORDER BY se.extension,s.saved_ms,s.id
    "#;
    let mut ext_stmt = conn.prepare(sql).map_err(db_error)?;
    let ext_rows = ext_stmt.query_map(params![root_path, start, end, i64usize(top_extensions)?], |row| Ok((
        row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?,
        row.get::<_, i64>(3)?, row.get::<_, i64>(4)?,
    ))).map_err(db_error)?;
    let mut by_extension: HashMap<String, HashMap<i64, (u64,u64,u64)>> = HashMap::new();
    for row in ext_rows {
        let (scan_id, extension, files, logical, allocated) = row.map_err(db_error)?;
        if sampled_ids.contains(&scan_id) {
            by_extension.entry(extension).or_default().insert(scan_id, (
                i64_to_u64(files), i64_to_u64(logical), i64_to_u64(allocated)
            ));
        }
    }
    let mut extensions: Vec<HistoryExtensionSeries> = by_extension.into_iter().map(|(extension, values)| {
        let points_for_extension = points.iter().map(|point| {
            let (files, logical_bytes, allocated_bytes) = values.get(&point.id).copied().unwrap_or((0,0,0));
            HistoryExtensionPoint {
                scan_id: point.id,
                saved_ms: saved_by_id.get(&point.id).copied().unwrap_or(point.saved_ms),
                logical_bytes,
                allocated_bytes,
                files,
            }
        }).collect();
        HistoryExtensionSeries { extension, points: points_for_extension }
    }).collect();
    extensions.sort_by(|a,b| {
        let av = a.points.last().map(|point| point.logical_bytes).unwrap_or(0);
        let bv = b.points.last().map(|point| point.logical_bytes).unwrap_or(0);
        bv.cmp(&av).then_with(|| a.extension.cmp(&b.extension))
    });
    let mut cat_stmt = conn.prepare(
        "SELECT sc.scan_id,sc.category,sc.files,sc.logical_bytes,sc.allocated_bytes FROM scan_categories sc JOIN scans s ON s.id=sc.scan_id WHERE s.root_path=?1 AND s.saved_ms>=?2 AND s.saved_ms<=?3 ORDER BY sc.category,s.saved_ms,s.id"
    ).map_err(db_error)?;
    let cat_rows = cat_stmt.query_map(params![root_path,start,end], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?,row.get::<_,i64>(2)?,row.get::<_,i64>(3)?,row.get::<_,i64>(4)?))).map_err(db_error)?;
    let mut by_category: HashMap<String, HashMap<i64,(u64,u64,u64)>> = HashMap::new();
    for row in cat_rows { let (scan_id,category,files,logical,allocated)=row.map_err(db_error)?; if sampled_ids.contains(&scan_id) { by_category.entry(category).or_default().insert(scan_id,(i64_to_u64(files),i64_to_u64(logical),i64_to_u64(allocated))); } }
    let mut categories:Vec<HistoryCategorySeries>=by_category.into_iter().map(|(category,values)| HistoryCategorySeries { category, points: points.iter().map(|point| { let (files,logical_bytes,allocated_bytes)=values.get(&point.id).copied().unwrap_or((0,0,0)); HistoryExtensionPoint{scan_id:point.id,saved_ms:point.saved_ms,logical_bytes,allocated_bytes,files} }).collect() }).collect();
    categories.sort_by(|a,b| b.points.last().map(|p|p.logical_bytes).unwrap_or(0).cmp(&a.points.last().map(|p|p.logical_bytes).unwrap_or(0)).then_with(||a.category.cmp(&b.category)));
    Ok(HistoryTimeline { root_path: root_path.to_string(), total_points: total.max(0) as u64, points, extensions, categories })
}

fn database_bytes(path: &Path) -> u64 {
    let mut total = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix));
        total = total.saturating_add(fs::metadata(sidecar).map(|meta| meta.len()).unwrap_or(0));
    }
    total
}

pub fn integrity_check(path: &Path) -> Result<String, String> {
    let conn = open(path)?;
    let mut stmt = conn.prepare("PRAGMA integrity_check").map_err(db_error)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(db_error)?;
    let mut messages = Vec::new();
    for row in rows { messages.push(row.map_err(db_error)?); }
    if messages.is_empty() { Ok("unknown".to_string()) } else { Ok(messages.join("; ")) }
}

pub fn maintenance_status(path: &Path) -> Result<HistoryMaintenanceStatus, String> {
    let conn = open(path)?;
    let scans: i64 = conn.query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0)).map_err(db_error)?;
    let fingerprints: i64 = conn.query_row("SELECT COUNT(*) FROM fingerprint_cache", [], |row| row.get(0)).map_err(db_error)?;
    drop(conn);
    Ok(HistoryMaintenanceStatus {
        schema_version: SCHEMA_VERSION,
        scans: scans.max(0) as u64,
        database_bytes: database_bytes(path),
        fingerprint_entries: fingerprints.max(0) as u64,
        integrity: "Not checked (run Integrity Check)".to_string(),
    })
}

pub fn optimize_database(path: &Path) -> Result<u64, String> {
    let conn = open(path)?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA optimize;").map_err(db_error)?;
    Ok(database_bytes(path))
}

pub fn backup_database(path: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() { return Err("Backup destination already exists".to_string()); }
    if let Some(parent) = destination.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|error| format!("Cannot create backup directory {}: {error}", parent.display()))?;
    }
    let conn = open(path)?;
    conn.execute("VACUUM INTO ?1", params![destination.to_string_lossy().to_string()]).map_err(db_error)?;
    Ok(())
}

pub fn prune_fingerprints(path: &Path, older_than_ms: u64) -> Result<u64, String> {
    let conn = open(path)?;
    let changed = conn.execute(
        "DELETE FROM fingerprint_cache WHERE updated_ms < ?1",
        params![i64u(older_than_ms)?]
    ).map_err(db_error)?;
    Ok(changed as u64)
}

pub fn apply_retention(
    path: &Path,
    keep_last_per_root: Option<usize>,
    keep_months: Option<u64>,
) -> Result<RetentionResult, String> {
    let mut conn = open(path)?;
    let before: i64 = conn.query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0)).map_err(db_error)?;
    let tx = conn.transaction().map_err(db_error)?;
    if let Some(months) = keep_months.filter(|months| *months > 0) {
        let cutoff = now_ms().saturating_sub(months.saturating_mul(30).saturating_mul(86_400_000));
        tx.execute("DELETE FROM scans WHERE saved_ms < ?1", params![i64u(cutoff)?]).map_err(db_error)?;
    }
    if let Some(keep) = keep_last_per_root {
        let keep = keep.max(1).min(100_000);
        tx.execute(r#"
            DELETE FROM scans WHERE id IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER(PARTITION BY root_path ORDER BY saved_ms DESC,id DESC) AS rn
                    FROM scans
                ) WHERE rn > ?1
            )
        "#, params![i64usize(keep)?]).map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    let after: i64 = conn.query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0)).map_err(db_error)?;
    let before_u = before.max(0) as u64;
    let after_u = after.max(0) as u64;
    Ok(RetentionResult { before: before_u, after: after_u, deleted: before_u.saturating_sub(after_u) })
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
    use crate::model::ExtensionStat;
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
                created_ms: None,
                owner_hint: String::new(),
                permissions_hint: String::new(),
                sparse: None,
                compressed: None,
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
            hidden: true,
            name: "árvíztűrő-世界.bin".into(),
            kind: NodeKind::File,
            size,
            allocated_size: size.saturating_add(4096),
            raw_size: size,
            raw_allocated_size: size.saturating_add(4096),
            identity_volume: Some(7),
            identity_index: Some(9),
            modified_ms: Some(123_456),
            created_ms: Some(120_000),
            owner_hint: "uid:1000 gid:1000".into(),
            permissions_hint: "0644".into(),
            sparse: Some(false),
            compressed: None,
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
        assert!(node_columns.iter().any(|column| column == "hidden"), "nodes.hidden is required; got {node_columns:?}");
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
            // Recreate the initial nodes schema without type_hint.
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
    fn history_migrates_schema_v3_hidden_flag_without_discarding_database() {
        let db = test_db("history-v3-hidden-migration");
        cleanup_db(&db);
        {
            let conn = Connection::open(&db).expect("create v3 fixture");
            conn.execute_batch(CREATE_SCHEMA_META_SQL).unwrap();
            conn.execute_batch(r#"
                CREATE TABLE nodes (
                    scan_id INTEGER NOT NULL, node_id INTEGER NOT NULL, parent_id INTEGER, active INTEGER NOT NULL,
                    name TEXT NOT NULL, kind TEXT NOT NULL, logical_size INTEGER NOT NULL, allocated_size INTEGER NOT NULL,
                    raw_size INTEGER NOT NULL, raw_allocated_size INTEGER NOT NULL, identity_volume INTEGER, identity_index INTEGER,
                    modified_ms INTEGER, created_ms INTEGER, owner_hint TEXT NOT NULL DEFAULT '', permissions_hint TEXT NOT NULL DEFAULT '',
                    sparse INTEGER, compressed INTEGER, extension TEXT NOT NULL, type_hint TEXT NOT NULL DEFAULT '', file_count INTEGER NOT NULL,
                    dir_count INTEGER NOT NULL, depth INTEGER NOT NULL, hardlink_duplicate INTEGER NOT NULL, link_count INTEGER NOT NULL,
                    PRIMARY KEY(scan_id,node_id)
                );
                INSERT INTO schema_meta(key,value) VALUES('schema_version',3);
            "#).unwrap();
        }
        let conn = open(&db).expect("schema v3 should migrate to current");
        let version: i64 = conn.query_row("SELECT value FROM schema_meta WHERE key='schema_version'", [], |row| row.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let hidden_count: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_table_info('nodes') WHERE name='hidden'", [], |row| row.get(0)).unwrap();
        assert_eq!(hidden_count, 1);
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
        assert!(loaded.nodes[1].hidden, "hidden metadata must survive history round-trip");
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
    fn history_timeline_orders_filters_and_aggregates_without_loading_node_rows() {
        let root = std::env::temp_dir().join("diskmosaic-history-timeline-root");
        let db = test_db("history-timeline");
        cleanup_db(&db);
        let mut a = model_with_file_and_error(&root, 100);
        a.extension_stats = vec![ExtensionStat { extension: ".bin".into(), files: 1, size: 100, allocated_size: 104 }];
        let mut b = model_with_file_and_error(&root, 250);
        b.extension_stats = vec![ExtensionStat { extension: ".bin".into(), files: 1, size: 250, allocated_size: 254 }];
        let first = store_scan(&db, &a).expect("store first timeline scan");
        let second = store_scan(&db, &b).expect("store second timeline scan");
        {
            let conn = open(&db).unwrap();
            conn.execute("UPDATE scans SET saved_ms=?1 WHERE id=?2", params![1_000_i64, first.id]).unwrap();
            conn.execute("UPDATE scans SET saved_ms=?1 WHERE id=?2", params![2_000_i64, second.id]).unwrap();
        }
        let timeline = history_timeline(&db, &root.to_string_lossy(), Some(500), Some(2_500), 100, 8).expect("timeline");
        assert_eq!(timeline.total_points, 2);
        assert_eq!(timeline.points.len(), 2);
        assert_eq!(timeline.points[0].id, first.id);
        assert_eq!(timeline.points[1].id, second.id);
        assert_eq!(timeline.points[0].logical_bytes, 100);
        assert_eq!(timeline.points[1].logical_bytes, 250);
        let ext = timeline.extensions.iter().find(|series| series.extension == ".bin").expect("bin extension series");
        assert_eq!(ext.points.len(), 2);
        assert_eq!(ext.points[0].logical_bytes, 100);
        assert_eq!(ext.points[1].logical_bytes, 250);
        assert!(!timeline.categories.is_empty());
        cleanup_db(&db);
    }

    #[test]
    fn history_timeline_empty_range_is_well_formed() {
        let root = std::env::temp_dir().join("diskmosaic-history-empty-range-root");
        let db = test_db("history-empty-range");
        cleanup_db(&db);
        store_scan(&db, &minimal(&root, 10)).unwrap();
        let timeline = history_timeline(&db, &root.to_string_lossy(), Some(1), Some(2), 50, 10).expect("empty timeline query");
        assert_eq!(timeline.total_points, 0);
        assert!(timeline.points.is_empty());
        assert!(timeline.extensions.is_empty());
        assert!(timeline.categories.is_empty());
        cleanup_db(&db);
    }

    #[test]
    fn history_retention_keeps_last_n_per_root_and_never_touches_filesystem_content() {
        let root_a = std::env::temp_dir().join("diskmosaic-retention-a");
        let root_b = std::env::temp_dir().join("diskmosaic-retention-b");
        let sentinel = std::env::temp_dir().join(format!("diskmosaic-retention-sentinel-{}", std::process::id()));
        let db = test_db("history-retention");
        cleanup_db(&db);
        fs::write(&sentinel, b"must survive").unwrap();
        for size in [1,2,3] { store_scan(&db, &minimal(&root_a, size)).unwrap(); }
        for size in [4,5] { store_scan(&db, &minimal(&root_b, size)).unwrap(); }
        let result = apply_retention(&db, Some(1), None).expect("retention");
        assert_eq!(result.before, 5);
        assert_eq!(result.after, 2);
        assert_eq!(result.deleted, 3);
        assert_eq!(fs::read(&sentinel).unwrap(), b"must survive");
        let roots = history_roots(&db).unwrap();
        assert_eq!(roots.len(), 2);
        assert!(roots.iter().all(|r| r.scans == 1));
        let _ = fs::remove_file(&sentinel);
        cleanup_db(&db);
    }

    #[test]
    fn history_backup_integrity_and_fingerprint_pruning_are_explicit_and_safe() {
        let db = test_db("history-maintenance");
        let backup = test_db("history-maintenance-backup");
        cleanup_db(&db);
        cleanup_db(&backup);
        let root = std::env::temp_dir().join("diskmosaic-maintenance-root");
        store_scan(&db, &minimal(&root, 10)).unwrap();
        put_fingerprint(&db, "old", 10, Some(1), "sample", None).unwrap();
        {
            let conn = open(&db).unwrap();
            conn.execute("UPDATE fingerprint_cache SET updated_ms=1 WHERE cache_key='old'", []).unwrap();
        }
        assert_eq!(integrity_check(&db).unwrap(), "ok");
        let status = maintenance_status(&db).unwrap();
        assert_eq!(status.schema_version, SCHEMA_VERSION);
        assert_eq!(status.scans, 1);
        assert_eq!(status.integrity, "Not checked (run Integrity Check)");
        assert_eq!(prune_fingerprints(&db, 2).unwrap(), 1);
        backup_database(&db, &backup).unwrap();
        assert!(backup.exists());
        assert_eq!(database_status(&backup).unwrap().0, SCHEMA_VERSION);
        cleanup_db(&backup);
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

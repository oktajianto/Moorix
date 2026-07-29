//! Database manager backend (Fase 20). Connections always ride the existing SSH
//! connection: we open a short-lived local TCP forward (an ephemeral
//! `127.0.0.1:0` listener that tunnels to the DB port on the server via a
//! `direct-tcpip` channel, exactly like the -L port forward in `forward.rs`),
//! then point the driver at that local port. Nothing is exposed off-box.
//!
//! Stage 20A-1 is a connectivity spike: `db_test_connect` proves the tunnel +
//! driver path end to end by fetching the server version and database list.
//! Later stages build the real driver abstraction, profiles, and UI on top.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::io::copy_bidirectional;
use tokio::net::TcpListener;

use crate::ssh::SshHandle;
use crate::state::AppState;

/// Result of the 20A-1 spike: enough to prove we really reached the DB server.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTestResult {
    /// `SELECT VERSION()` — e.g. "8.0.36" or "10.11.6-MariaDB".
    pub version: String,
    /// `SHOW DATABASES` — proves an authenticated, queryable connection.
    pub databases: Vec<String>,
}

/// A live local→SSH forward for a DB connection. Dropping/aborting the task
/// tears the tunnel down; the caller keeps it alive for the connection's life.
pub struct DbTunnel {
    local_port: u16,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl Drop for DbTunnel {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Bind an ephemeral local listener and forward every accepted connection to
/// `dest_host:dest_port` as seen from the SSH server. Returns the chosen local
/// port so the driver can connect to `127.0.0.1:<port>`.
async fn open_tunnel(
    handle: SshHandle,
    dest_host: String,
    dest_port: u16,
) -> Result<DbTunnel, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("bind local db tunnel: {e}"))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let task = tauri::async_runtime::spawn(async move {
        loop {
            let (mut socket, peer) = match listener.accept().await {
                Ok(x) => x,
                Err(_) => break,
            };
            let handle = handle.clone();
            let dest_host = dest_host.clone();
            tauri::async_runtime::spawn(async move {
                let channel = {
                    let h = handle.lock().await;
                    h.channel_open_direct_tcpip(
                        dest_host,
                        dest_port as u32,
                        peer.ip().to_string(),
                        peer.port() as u32,
                    )
                    .await
                };
                if let Ok(channel) = channel {
                    let mut stream = channel.into_stream();
                    let _ = copy_bidirectional(&mut socket, &mut stream).await;
                }
            });
        }
    });

    Ok(DbTunnel { local_port, task })
}

/// Open a MySQL/MariaDB connection through an already-open tunnel port and run
/// the two probe queries.
async fn probe_mysql(
    local_port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<DbTestResult, String> {
    use mysql_async::prelude::Queryable;

    let opts = mysql_async::OptsBuilder::default()
        .ip_or_hostname("127.0.0.1")
        .tcp_port(local_port)
        // Force TCP: without this, mysql_async may try a local Unix socket for a
        // "localhost" host and bypass our tunnel entirely.
        .prefer_socket(false)
        .user(Some(user))
        .pass(Some(password))
        .db_name(database);

    let mut conn = mysql_async::Conn::new(opts)
        .await
        .map_err(|e| format!("connect: {e}"))?;

    let version: Option<String> = conn
        .query_first("SELECT VERSION()")
        .await
        .map_err(|e| format!("version query: {e}"))?;
    let databases: Vec<String> = conn
        .query("SHOW DATABASES")
        .await
        .map_err(|e| format!("show databases: {e}"))?;

    conn.disconnect().await.map_err(|e| e.to_string())?;

    Ok(DbTestResult {
        version: version.unwrap_or_default(),
        databases,
    })
}

/// 20A-1 spike: tunnel to the DB over `session_id`'s SSH connection, connect as
/// `user`/`password`, and return the server version + database list. `host` is
/// the DB address as seen from the server (usually `127.0.0.1`).
#[tauri::command]
pub async fn db_test_connect(
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<DbTestResult, String> {
    let handle = state
        .ssh_handle(&session_id)
        .ok_or_else(|| "not an SSH session".to_string())?;

    // The tunnel stays alive until this binding drops at the end of the fn.
    let tunnel = open_tunnel(handle, host, port).await?;
    probe_mysql(tunnel.local_port, user, password, database).await
}

/* -------------------------------------------------------------------------- */
/* Persistent DB session (20A-3): tunnel + connection pool, kept in AppState.  */
/* -------------------------------------------------------------------------- */

/// A live database session: a connection pool bound to a private tunnel. Both
/// are torn down when this is dropped (pool closes its connections lazily; the
/// tunnel task aborts). `parent_ssh` ties its lifetime to the SSH session — when
/// that closes, `AppState` drops this too (no orphan tunnel).
pub struct DbSession {
    /// SSH session id this DB session rides on.
    pub parent_ssh: String,
    pool: mysql_async::Pool,
    /// Kept alive for the session's lifetime; aborts on drop.
    _tunnel: DbTunnel,
    /// DB credentials (as seen from the server) — reused by mysqldump/mysql for
    /// export/import so the frontend never re-sends the password.
    db_user: String,
    db_password: String,
    db_host: String,
    db_port: u16,
}

/// A table or view in a database (for the schema tree).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    /// "table" or "view".
    pub kind: String,
}

/// Open a persistent MySQL/MariaDB session over `session_id`'s SSH connection
/// and return its id. Validates the credentials with a probe query before
/// registering, so a bad login fails here rather than on first browse.
#[tauri::command]
pub async fn db_open(
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<String, String> {
    use mysql_async::prelude::Queryable;

    let handle = state
        .ssh_handle(&session_id)
        .ok_or_else(|| "not an SSH session".to_string())?;
    let tunnel = open_tunnel(handle, host.clone(), port).await?;

    let opts = mysql_async::OptsBuilder::default()
        .ip_or_hostname("127.0.0.1")
        .tcp_port(tunnel.local_port)
        .prefer_socket(false)
        .user(Some(user.clone()))
        .pass(Some(password.clone()))
        .db_name(database);
    let pool = mysql_async::Pool::new(opts);

    // Probe once so authentication errors surface immediately.
    let mut conn = pool.get_conn().await.map_err(|e| format!("connect: {e}"))?;
    let _: Option<String> = conn
        .query_first("SELECT 1")
        .await
        .map_err(|e| format!("connect: {e}"))?;
    drop(conn);

    let id = state.next_id();
    state.insert_db(
        id.clone(),
        Arc::new(DbSession {
            parent_ssh: session_id,
            pool,
            _tunnel: tunnel,
            db_user: user,
            db_password: password,
            db_host: host,
            db_port: port,
        }),
    );
    Ok(id)
}

/// `SHOW DATABASES` on a live session.
#[tauri::command]
pub async fn db_list_databases(
    state: State<'_, AppState>,
    db_session_id: String,
) -> Result<Vec<String>, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    conn.query("SHOW DATABASES").await.map_err(|e| e.to_string())
}

/// Tables + views in `database`, via information_schema (doesn't disturb the
/// connection's current database).
#[tauri::command]
pub async fn db_list_tables(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = conn
        .exec(
            "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            (database,),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(name, ty)| TableInfo {
            name,
            kind: if ty.eq_ignore_ascii_case("VIEW") {
                "view".to_string()
            } else {
                "table".to_string()
            },
        })
        .collect())
}

/// Close a live DB session: disconnect the pool (best effort) and drop the
/// tunnel. Idempotent — closing an unknown id is a no-op.
#[tauri::command]
pub async fn db_close(state: State<'_, AppState>, db_session_id: String) -> Result<(), String> {
    if let Some(sess) = state.remove_db(&db_session_id) {
        // Disconnect while the tunnel is still alive (sess holds it), then drop.
        let _ = sess.pool.clone().disconnect().await;
    }
    Ok(())
}

/* -------------------------------------------------------------------------- */
/* Query execution + browse (20A-4): SQL editor and paginated table browse.    */
/* -------------------------------------------------------------------------- */

/// Hard cap on rows returned to the webview from a single SQL run, so a stray
/// `SELECT *` on a huge table can't freeze the UI. Browse uses LIMIT instead.
const MAX_ROWS: usize = 2000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    /// Server column type, e.g. "LONGLONG", "VAR_STRING", "NEWDECIMAL".
    pub db_type: String,
}

/// A query's result set. Cells are `string | null` — every value is stringified
/// on the Rust side so JS never loses precision on BIGINT/DECIMAL (they come off
/// the text protocol as strings already). `null` is distinct from empty string.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: u64,
    /// True when the result was capped at `MAX_ROWS`.
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseResult {
    pub result: QueryResult,
    /// Total row count of the table (for pagination), independent of LIMIT.
    pub total: u64,
}

/// Friendly SQL type name for a result column (e.g. "varchar", "int unsigned",
/// "bigint", "text", "datetime") derived from the protocol type + charset +
/// flags — the wire type alone can't tell TEXT from BLOB or ENUM from CHAR.
fn friendly_type(col: &mysql_async::Column) -> String {
    use mysql_async::consts::{ColumnFlags, ColumnType};
    let flags = col.flags();
    if flags.contains(ColumnFlags::ENUM_FLAG) {
        return "enum".to_string();
    }
    if flags.contains(ColumnFlags::SET_FLAG) {
        return "set".to_string();
    }
    let binary = col.character_set() == 63; // 63 = the `binary` collation
    let u = if flags.contains(ColumnFlags::UNSIGNED_FLAG) {
        " unsigned"
    } else {
        ""
    };
    match col.column_type() {
        ColumnType::MYSQL_TYPE_TINY => format!("tinyint{u}"),
        ColumnType::MYSQL_TYPE_SHORT => format!("smallint{u}"),
        ColumnType::MYSQL_TYPE_INT24 => format!("mediumint{u}"),
        ColumnType::MYSQL_TYPE_LONG => format!("int{u}"),
        ColumnType::MYSQL_TYPE_LONGLONG => format!("bigint{u}"),
        ColumnType::MYSQL_TYPE_FLOAT => "float".into(),
        ColumnType::MYSQL_TYPE_DOUBLE => "double".into(),
        ColumnType::MYSQL_TYPE_NEWDECIMAL | ColumnType::MYSQL_TYPE_DECIMAL => "decimal".into(),
        ColumnType::MYSQL_TYPE_BIT => "bit".into(),
        ColumnType::MYSQL_TYPE_YEAR => "year".into(),
        ColumnType::MYSQL_TYPE_DATE | ColumnType::MYSQL_TYPE_NEWDATE => "date".into(),
        ColumnType::MYSQL_TYPE_TIME | ColumnType::MYSQL_TYPE_TIME2 => "time".into(),
        ColumnType::MYSQL_TYPE_DATETIME | ColumnType::MYSQL_TYPE_DATETIME2 => "datetime".into(),
        ColumnType::MYSQL_TYPE_TIMESTAMP | ColumnType::MYSQL_TYPE_TIMESTAMP2 => "timestamp".into(),
        ColumnType::MYSQL_TYPE_JSON => "json".into(),
        ColumnType::MYSQL_TYPE_GEOMETRY => "geometry".into(),
        ColumnType::MYSQL_TYPE_VARCHAR | ColumnType::MYSQL_TYPE_VAR_STRING => {
            if binary { "varbinary".into() } else { "varchar".into() }
        }
        ColumnType::MYSQL_TYPE_STRING => {
            if binary { "binary".into() } else { "char".into() }
        }
        ColumnType::MYSQL_TYPE_TINY_BLOB => {
            if binary { "tinyblob".into() } else { "tinytext".into() }
        }
        ColumnType::MYSQL_TYPE_BLOB => {
            if binary { "blob".into() } else { "text".into() }
        }
        ColumnType::MYSQL_TYPE_MEDIUM_BLOB => {
            if binary { "mediumblob".into() } else { "mediumtext".into() }
        }
        ColumnType::MYSQL_TYPE_LONG_BLOB => {
            if binary { "longblob".into() } else { "longtext".into() }
        }
        other => format!("{other:?}")
            .trim_start_matches("MYSQL_TYPE_")
            .to_lowercase(),
    }
}

/// Convert a single MySQL value to a display string. NULL → None (rendered as a
/// distinct badge in the UI); non-UTF-8 bytes → a "(binary, N bytes)" marker
/// rather than mojibake.
fn value_to_cell(v: &mysql_async::Value) -> Option<String> {
    use mysql_async::Value;
    match v {
        Value::NULL => None,
        Value::Bytes(b) => Some(match std::str::from_utf8(b) {
            Ok(s) => s.to_string(),
            Err(_) => format!("(binary, {} bytes)", b.len()),
        }),
        Value::Int(i) => Some(i.to_string()),
        Value::UInt(u) => Some(u.to_string()),
        Value::Float(f) => Some(f.to_string()),
        Value::Double(d) => Some(d.to_string()),
        Value::Date(y, mo, d, h, mi, s, us) => Some(if *us == 0 {
            format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}")
        } else {
            format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}")
        }),
        Value::Time(neg, days, h, mi, s, us) => {
            let sign = if *neg { "-" } else { "" };
            let hours = *days * 24 + *h as u32;
            Some(if *us == 0 {
                format!("{sign}{hours:02}:{mi:02}:{s:02}")
            } else {
                format!("{sign}{hours:02}:{mi:02}:{s:02}.{us:06}")
            })
        }
    }
}

/// Run one SQL statement and collect its first result set (columns + rows,
/// capped at `MAX_ROWS`). For statements without a result set (INSERT/UPDATE/…)
/// `rows` is empty and `rows_affected` carries the count.
async fn run_query(conn: &mut mysql_async::Conn, sql: &str) -> Result<QueryResult, String> {
    use mysql_async::prelude::Queryable;

    let mut qr = conn.query_iter(sql).await.map_err(|e| e.to_string())?;
    let columns: Vec<ColumnInfo> = qr
        .columns_ref()
        .iter()
        .map(|c| ColumnInfo {
            name: c.name_str().into_owned(),
            db_type: friendly_type(c),
        })
        .collect();
    let ncols = columns.len();

    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut truncated = false;
    qr.for_each(|row| {
        if rows.len() >= MAX_ROWS {
            truncated = true;
            return;
        }
        let mut cells = Vec::with_capacity(ncols);
        for i in 0..ncols {
            cells.push(row.as_ref(i).and_then(value_to_cell));
        }
        rows.push(cells);
    })
    .await
    .map_err(|e| e.to_string())?;

    let rows_affected = qr.affected_rows();
    Ok(QueryResult { columns, rows, rows_affected, truncated })
}

/// Escape a MySQL identifier for use inside backticks.
fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// Result of the SQL editor: the (possibly paginated) result set plus, when the
/// query was a paginable SELECT, the total row count so the UI can page like
/// phpMyAdmin.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlResult {
    pub result: QueryResult,
    /// Total rows of the underlying SELECT (None if not counted / not paginated).
    pub total: Option<u64>,
    /// True when the backend appended LIMIT/OFFSET (single SELECT without LIMIT).
    pub paginated: bool,
}

/// Whether we can safely append `LIMIT/OFFSET` to a query: a single statement
/// (no inner `;`) that is a plain SELECT and has no LIMIT of its own. Conservative
/// on purpose — anything else runs verbatim.
fn is_paginable_select(sql: &str) -> bool {
    let s = sql.trim();
    if s.contains(';') {
        return false; // multi-statement
    }
    let lower = s.to_ascii_lowercase();
    lower.starts_with("select ") && !lower.contains(" limit ")
}

/// Run arbitrary SQL from the editor. `database`, when set, selects the schema
/// (`USE`) first. For a plain SELECT, appends `LIMIT/OFFSET` for `page`/`page_size`
/// and returns the total row count; otherwise runs verbatim (capped at MAX_ROWS).
#[tauri::command]
pub async fn db_run_sql(
    state: State<'_, AppState>,
    db_session_id: String,
    sql: String,
    database: Option<String>,
    page: u64,
    page_size: u32,
) -> Result<SqlResult, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;

    if let Some(db) = database.filter(|d| !d.is_empty()) {
        conn.query_drop(format!("USE {}", quote_ident(&db)))
            .await
            .map_err(|e| e.to_string())?;
    }

    let trimmed = sql.trim().trim_end_matches(';').trim().to_string();

    if page_size > 0 && is_paginable_select(&trimmed) {
        let offset = page.saturating_mul(page_size as u64);
        let result = run_query(
            &mut conn,
            &format!("{trimmed} LIMIT {page_size} OFFSET {offset}"),
        )
        .await?;
        // Best-effort total; a failure just disables exact paging (None).
        let total: Option<u64> = conn
            .query_first(format!("SELECT COUNT(*) FROM ({trimmed}) AS _moorix_count"))
            .await
            .ok()
            .flatten();
        Ok(SqlResult { result, total, paginated: true })
    } else {
        let result = run_query(&mut conn, &sql).await?;
        Ok(SqlResult { result, total: None, paginated: false })
    }
}

/// Paginated browse of a single table: a `SELECT *` window plus the total row
/// count. Identifiers are quoted; limit/offset are numeric so interpolation is
/// safe.
#[tauri::command]
pub async fn db_browse(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
    limit: u32,
    offset: u64,
) -> Result<BrowseResult, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let result = run_query(
        &mut conn,
        &format!("SELECT * FROM {qualified} LIMIT {limit} OFFSET {offset}"),
    )
    .await?;

    let total: Option<u64> = conn
        .query_first(format!("SELECT COUNT(*) FROM {qualified}"))
        .await
        .map_err(|e| e.to_string())?;

    Ok(BrowseResult { result, total: total.unwrap_or(0) })
}

/* -------------------------------------------------------------------------- */
/* Table structure (20B): columns, indexes, foreign keys, primary key.         */
/* -------------------------------------------------------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    /// Full SQL type, e.g. "varchar(255)", "bigint(20) unsigned".
    pub data_type: String,
    pub nullable: bool,
    /// "PRI" | "UNI" | "MUL" | "".
    pub key: String,
    pub default: Option<String>,
    /// e.g. "auto_increment", "on update CURRENT_TIMESTAMP".
    pub extra: String,
    pub comment: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDef {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyDef {
    pub name: String,
    pub column: String,
    pub ref_table: String,
    pub ref_column: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    pub columns: Vec<ColumnDef>,
    pub indexes: Vec<IndexDef>,
    pub foreign_keys: Vec<ForeignKeyDef>,
    /// PK column names in order (empty if none) — gates inline edit/delete (20B).
    pub primary_key: Vec<String>,
}

/// Full structure of one table: columns (+ PK/nullable/default/extra), indexes,
/// and foreign keys — all from information_schema.
#[tauri::command]
pub async fn db_table_structure(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
) -> Result<TableStructure, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;

    // Columns
    let col_rows: Vec<(String, String, String, String, Option<String>, String, String)> = conn
        .exec(
            "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT \
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            (database.as_str(), table.as_str()),
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut primary_key = Vec::new();
    let columns: Vec<ColumnDef> = col_rows
        .into_iter()
        .map(|(name, data_type, is_nullable, key, default, extra, comment)| {
            if key == "PRI" {
                primary_key.push(name.clone());
            }
            ColumnDef {
                name,
                data_type,
                nullable: is_nullable.eq_ignore_ascii_case("YES"),
                key,
                default,
                extra,
                comment,
            }
        })
        .collect();

    // Indexes (grouped by name, ordered by SEQ_IN_INDEX)
    let idx_rows: Vec<(String, String, i64)> = conn
        .exec(
            "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
            (database.as_str(), table.as_str()),
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut indexes: Vec<IndexDef> = Vec::new();
    for (iname, col, non_unique) in idx_rows {
        match indexes.last_mut() {
            Some(last) if last.name == iname => last.columns.push(col),
            _ => indexes.push(IndexDef {
                name: iname,
                columns: vec![col],
                unique: non_unique == 0,
            }),
        }
    }

    // Foreign keys
    let fk_rows: Vec<(String, String, Option<String>, Option<String>)> = conn
        .exec(
            "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
             FROM information_schema.KEY_COLUMN_USAGE \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
            (database.as_str(), table.as_str()),
        )
        .await
        .map_err(|e| e.to_string())?;
    let foreign_keys: Vec<ForeignKeyDef> = fk_rows
        .into_iter()
        .filter_map(|(name, column, rt, rc)| {
            Some(ForeignKeyDef {
                name,
                column,
                ref_table: rt?,
                ref_column: rc?,
            })
        })
        .collect();

    Ok(TableStructure { columns, indexes, foreign_keys, primary_key })
}

/* -------------------------------------------------------------------------- */
/* Row mutations (20B): insert / update / delete — always parameterized.        */
/* -------------------------------------------------------------------------- */

/// A column/value pair from the frontend. `value` = null means SQL NULL; any
/// string is bound as a parameter (never concatenated into SQL).
#[derive(Deserialize)]
pub struct CellValue {
    pub column: String,
    pub value: Option<String>,
}

/// Bind a cell to a MySQL value. Strings are passed as-is (the server coerces to
/// the target column type); null → SQL NULL.
fn to_value(v: &Option<String>) -> mysql_async::Value {
    match v {
        None => mysql_async::Value::NULL,
        Some(s) => mysql_async::Value::from(s.as_str()),
    }
}

/// UPDATE one row identified by its primary key. `changes` are the columns to
/// set; `pk` are the primary-key column/value pairs for the WHERE. Returns the
/// affected row count.
#[tauri::command]
pub async fn db_update_row(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
    pk: Vec<CellValue>,
    changes: Vec<CellValue>,
) -> Result<u64, String> {
    use mysql_async::prelude::Queryable;

    if pk.is_empty() {
        return Err("cannot update a row without a primary key".to_string());
    }
    if changes.is_empty() {
        return Ok(0);
    }

    let set_clause = changes
        .iter()
        .map(|c| format!("{} = ?", quote_ident(&c.column)))
        .collect::<Vec<_>>()
        .join(", ");
    let where_clause = pk
        .iter()
        .map(|c| format!("{} = ?", quote_ident(&c.column)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!(
        "UPDATE {}.{} SET {set_clause} WHERE {where_clause} LIMIT 1",
        quote_ident(&database),
        quote_ident(&table)
    );

    let mut params: Vec<mysql_async::Value> = Vec::with_capacity(changes.len() + pk.len());
    params.extend(changes.iter().map(|c| to_value(&c.value)));
    params.extend(pk.iter().map(|c| to_value(&c.value)));

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    conn.exec_drop(&sql, params).await.map_err(|e| e.to_string())?;
    Ok(conn.affected_rows())
}

/// DELETE one row identified by its primary key.
#[tauri::command]
pub async fn db_delete_row(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
    pk: Vec<CellValue>,
) -> Result<u64, String> {
    use mysql_async::prelude::Queryable;

    if pk.is_empty() {
        return Err("cannot delete a row without a primary key".to_string());
    }
    let where_clause = pk
        .iter()
        .map(|c| format!("{} = ?", quote_ident(&c.column)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!(
        "DELETE FROM {}.{} WHERE {where_clause} LIMIT 1",
        quote_ident(&database),
        quote_ident(&table)
    );
    let params: Vec<mysql_async::Value> = pk.iter().map(|c| to_value(&c.value)).collect();

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    conn.exec_drop(&sql, params).await.map_err(|e| e.to_string())?;
    Ok(conn.affected_rows())
}

/// INSERT a row. Only the provided columns are set (others take their DB default
/// / auto_increment). Returns the affected row count.
#[tauri::command]
pub async fn db_insert_row(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
    values: Vec<CellValue>,
) -> Result<u64, String> {
    use mysql_async::prelude::Queryable;

    if values.is_empty() {
        return Err("no values to insert".to_string());
    }
    let cols = values
        .iter()
        .map(|c| quote_ident(&c.column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "INSERT INTO {}.{} ({cols}) VALUES ({placeholders})",
        quote_ident(&database),
        quote_ident(&table)
    );
    let params: Vec<mysql_async::Value> = values.iter().map(|c| to_value(&c.value)).collect();

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    conn.exec_drop(&sql, params).await.map_err(|e| e.to_string())?;
    Ok(conn.affected_rows())
}

/// One column of a database's schema, for SQL editor autocomplete.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumn {
    pub table: String,
    pub name: String,
    /// Friendly type straight from information_schema, e.g. "varchar(255)", "bigint(20)".
    pub data_type: String,
}

/// All tables + columns of a database (from information_schema), used to power
/// keyword/table/column autocomplete in the SQL editor.
#[tauri::command]
pub async fn db_schema(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
) -> Result<Vec<SchemaColumn>, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, String)> = conn
        .exec(
            "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION",
            (database,),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(table, name, data_type)| SchemaColumn { table, name, data_type })
        .collect())
}

/* -------------------------------------------------------------------------- */
/* Export / Import .sql (20C): mysqldump / mysql over SSH exec.                 */
/* -------------------------------------------------------------------------- */

/// Single-quote a value for safe use in a server shell command (user-supplied
/// db/table names go through the login shell that runs the exec).
fn shq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\''"))
}

/// Run a command on the server over a fresh exec channel. Optional `stdin` is
/// written then EOF'd. `on_stdout` receives stdout chunks (sync — for streaming
/// to a file use an mpsc). Returns (stderr, exit_code). The connection handle is
/// only locked briefly to open the channel.
async fn run_exec(
    handle: &SshHandle,
    command: &str,
    stdin: Option<Vec<u8>>,
    mut on_stdout: impl FnMut(&[u8]),
) -> Result<(Vec<u8>, u32), String> {
    let mut channel = {
        let h = handle.lock().await;
        h.channel_open_session()
            .await
            .map_err(|e| format!("open channel: {e}"))?
    };
    channel
        .exec(false, command.as_bytes().to_vec())
        .await
        .map_err(|e| format!("exec: {e}"))?;
    if let Some(data) = stdin {
        // Chunk stdin so a large payload (e.g. a .sql import) stays within SSH
        // packet limits.
        for chunk in data.chunks(32 * 1024) {
            channel
                .data_bytes(chunk.to_vec())
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    channel.eof().await.map_err(|e| e.to_string())?;

    let mut stderr = Vec::new();
    let mut code = 0u32;
    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Data { data }) => on_stdout(&data),
            Some(russh::ChannelMsg::ExtendedData { data, ext }) => {
                if ext == 1 {
                    stderr.extend_from_slice(&data);
                }
            }
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => code = exit_status,
            Some(russh::ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    Ok((stderr, code))
}

/// Write a small file on the server via stdin with a restrictive umask, so its
/// contents (here: DB credentials) are never visible in `ps`/argv and the file
/// lands as mode 600. `remote_path` must be shell-safe (we generate it).
async fn write_secure_remote(
    handle: &SshHandle,
    remote_path: &str,
    content: &[u8],
) -> Result<(), String> {
    let (stderr, code) = run_exec(
        handle,
        &format!("umask 077; cat > {}", shq(remote_path)),
        Some(content.to_vec()),
        |_| {},
    )
    .await?;
    if code != 0 {
        return Err(format!(
            "write remote config failed: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    Ok(())
}

/// Stream a command's stdout straight to a local file (for large dumps, so the
/// whole thing never sits in memory). Returns (bytes_written, stderr, exit_code).
async fn exec_to_file(
    handle: &SshHandle,
    command: &str,
    local_path: &std::path::Path,
) -> Result<(u64, Vec<u8>, u32), String> {
    use tokio::io::AsyncWriteExt;

    let file = tokio::fs::File::create(local_path)
        .await
        .map_err(|e| format!("create local file: {e}"))?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let writer = tokio::spawn(async move {
        let mut w = tokio::io::BufWriter::new(file);
        let mut total = 0u64;
        while let Some(chunk) = rx.recv().await {
            if w.write_all(&chunk).await.is_err() {
                break;
            }
            total += chunk.len() as u64;
        }
        let _ = w.flush().await;
        total
    });

    // The closure owns `tx`; dropping it at the end of run_exec closes the channel.
    let (stderr, code) = run_exec(handle, command, None, move |chunk| {
        let _ = tx.send(chunk.to_vec());
    })
    .await?;
    let total = writer.await.map_err(|e| e.to_string())?;
    Ok((total, stderr, code))
}

/// Export a database (or selected tables) to a local `.sql` file using
/// server-side `mysqldump`. Saves into the OS Downloads folder and returns the
/// full local path. Credentials go through a mode-600 defaults file (never argv).
#[tauri::command]
pub async fn db_export_sql(
    app: AppHandle,
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    tables: Vec<String>,
    structure_only: bool,
    data_only: bool,
) -> Result<String, String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let handle = state
        .ssh_handle(&sess.parent_ssh)
        .ok_or_else(|| "SSH session for this database is closed".to_string())?;

    // Unique, shell-safe temp path for the credentials file.
    let cnf = format!("/tmp/.moorix-dump-{}.cnf", state.next_id());
    let cnf_body = format!(
        "[client]\nuser={}\npassword={}\nhost={}\nport={}\n",
        sess.db_user, sess.db_password, sess.db_host, sess.db_port
    );
    write_secure_remote(&handle, &cnf, cnf_body.as_bytes()).await?;

    // Build the mysqldump command (identifiers quoted; flags are fixed literals).
    let mut cmd = format!(
        "mysqldump --defaults-extra-file={} --single-transaction --quick",
        shq(&cnf)
    );
    if structure_only {
        cmd.push_str(" --no-data");
    }
    if data_only {
        cmd.push_str(" --no-create-info");
    }
    cmd.push(' ');
    cmd.push_str(&shq(&database));
    for t in &tables {
        cmd.push(' ');
        cmd.push_str(&shq(t));
    }

    // Destination: Downloads/<db>[_<table>]_<epoch>.sql
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("no downloads dir: {e}"))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let base = if tables.len() == 1 {
        format!("{database}_{}", tables[0])
    } else {
        database.clone()
    };
    let safe: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let local_path = dir.join(format!("{safe}_{ts}.sql"));

    let result = exec_to_file(&handle, &cmd, &local_path).await;

    // Always remove the credentials file, whatever happened.
    let _ = run_exec(&handle, &format!("rm -f {}", shq(&cnf)), None, |_| {}).await;

    let (bytes, stderr, code) = result?;
    if code != 0 {
        let _ = tokio::fs::remove_file(&local_path).await;
        return Err(format!(
            "mysqldump exited {code}: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    let _ = bytes;
    Ok(local_path.to_string_lossy().to_string())
}

/// Import a `.sql` script into `database` via server-side `mysql`, streaming the
/// script to its stdin. Credentials go through a mode-600 defaults file (never
/// argv). Returns Ok(()) on success; the mysql error on failure.
#[tauri::command]
pub async fn db_import_sql(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    sql: String,
) -> Result<(), String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let handle = state
        .ssh_handle(&sess.parent_ssh)
        .ok_or_else(|| "SSH session for this database is closed".to_string())?;

    let cnf = format!("/tmp/.moorix-import-{}.cnf", state.next_id());
    let cnf_body = format!(
        "[client]\nuser={}\npassword={}\nhost={}\nport={}\n",
        sess.db_user, sess.db_password, sess.db_host, sess.db_port
    );
    write_secure_remote(&handle, &cnf, cnf_body.as_bytes()).await?;

    let cmd = format!(
        "mysql --defaults-extra-file={} {}",
        shq(&cnf),
        shq(&database)
    );
    let result = run_exec(&handle, &cmd, Some(sql.into_bytes()), |_| {}).await;

    // Always remove the credentials file.
    let _ = run_exec(&handle, &format!("rm -f {}", shq(&cnf)), None, |_| {}).await;

    let (stderr, code) = result?;
    if code != 0 {
        return Err(String::from_utf8_lossy(&stderr).trim().to_string());
    }
    Ok(())
}

/* -------------------------------------------------------------------------- */
/* DDL: drop / rename table & database.                                        */
/* -------------------------------------------------------------------------- */

/// DROP a table (or view via DROP TABLE works only for tables; views use DROP VIEW).
#[tauri::command]
pub async fn db_drop_table(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
) -> Result<(), String> {
    use mysql_async::prelude::Queryable;
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    conn.query_drop(format!(
        "DROP TABLE {}.{}",
        quote_ident(&database),
        quote_ident(&table)
    ))
    .await
    .map_err(|e| e.to_string())
}

/// RENAME a table within the same database.
#[tauri::command]
pub async fn db_rename_table(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    use mysql_async::prelude::Queryable;
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    conn.query_drop(format!(
        "RENAME TABLE {}.{} TO {}.{}",
        quote_ident(&database),
        quote_ident(&old_name),
        quote_ident(&database),
        quote_ident(&new_name)
    ))
    .await
    .map_err(|e| e.to_string())
}

/// DROP an entire database.
#[tauri::command]
pub async fn db_drop_database(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
) -> Result<(), String> {
    use mysql_async::prelude::Queryable;
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;
    conn.query_drop(format!("DROP DATABASE {}", quote_ident(&database)))
        .await
        .map_err(|e| e.to_string())
}

/// "Rename" a database: MySQL has no RENAME DATABASE, so create the target,
/// move every base table across with RENAME TABLE, then drop the source. Note:
/// views and stored routines are not carried over.
#[tauri::command]
pub async fn db_rename_database(
    state: State<'_, AppState>,
    db_session_id: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    use mysql_async::prelude::Queryable;
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let mut conn = sess.pool.get_conn().await.map_err(|e| e.to_string())?;

    conn.query_drop(format!("CREATE DATABASE {}", quote_ident(&new_name)))
        .await
        .map_err(|e| format!("create target database: {e}"))?;

    let tables: Vec<String> = conn
        .exec(
            "SELECT TABLE_NAME FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
            (old_name.as_str(),),
        )
        .await
        .map_err(|e| e.to_string())?;
    for t in &tables {
        conn.query_drop(format!(
            "RENAME TABLE {}.{} TO {}.{}",
            quote_ident(&old_name),
            quote_ident(t),
            quote_ident(&new_name),
            quote_ident(t)
        ))
        .await
        .map_err(|e| format!("move table {t}: {e}"))?;
    }

    conn.query_drop(format!("DROP DATABASE {}", quote_ident(&old_name)))
        .await
        .map_err(|e| format!("drop old database: {e}"))
}

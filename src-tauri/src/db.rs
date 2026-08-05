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

/// Lazily-connected PostgreSQL clients, one per database, over a shared tunnel.
/// Postgres connections are per-database, so browsing another database opens a
/// new (cached) client to `127.0.0.1:<local_port>` with dbname set.
pub struct PgBackend {
    local_port: u16,
    user: String,
    password: String,
    /// Database to use for server-wide queries (e.g. listing databases).
    default_db: String,
    clients: tokio::sync::Mutex<std::collections::HashMap<String, Arc<tokio_postgres::Client>>>,
}

impl PgBackend {
    /// Get (or open + cache) a client connected to `dbname`.
    async fn client(&self, dbname: &str) -> Result<Arc<tokio_postgres::Client>, String> {
        let mut map = self.clients.lock().await;
        if let Some(c) = map.get(dbname) {
            return Ok(c.clone());
        }
        let mut cfg = tokio_postgres::Config::new();
        cfg.host("127.0.0.1")
            .port(self.local_port)
            .user(&self.user)
            .password(&self.password)
            .dbname(dbname);
        let (client, connection) = cfg
            .connect(tokio_postgres::NoTls)
            .await
            .map_err(|e| format!("connect: {e}"))?;
        // Drive the connection in the background for the client's lifetime.
        tauri::async_runtime::spawn(async move {
            let _ = connection.await;
        });
        let arc = Arc::new(client);
        map.insert(dbname.to_string(), arc.clone());
        Ok(arc)
    }

    /// Drop the cached client for `dbname` (closing that connection once the last
    /// reference goes away), so the database can be dropped/renamed — Postgres
    /// refuses those while a session is connected to it.
    async fn close_db(&self, dbname: &str) {
        self.clients.lock().await.remove(dbname);
    }
}

/// The live driver behind a session: MySQL pool, or per-database Postgres clients.
pub enum DbBackend {
    Mysql(mysql_async::Pool),
    Postgres(PgBackend),
}

/// A live database session bound to a private tunnel. Torn down on drop (MySQL
/// pool closes lazily / Postgres clients drop; the tunnel task aborts).
/// `parent_ssh` ties its lifetime to the SSH session.
pub struct DbSession {
    /// SSH session id this DB session rides on.
    pub parent_ssh: String,
    backend: DbBackend,
    /// Kept alive for the session's lifetime; aborts on drop.
    _tunnel: DbTunnel,
    /// "mysql" | "mariadb" | "postgres" — drives quoting + dump tool choice.
    pub engine: String,
    /// DB credentials (as seen from the server) — reused by mysqldump/pg_dump
    /// for export/import so the frontend never re-sends the password.
    db_user: String,
    db_password: String,
    db_host: String,
    db_port: u16,
}

impl DbSession {
    fn mysql(&self) -> Result<&mysql_async::Pool, String> {
        match &self.backend {
            DbBackend::Mysql(p) => Ok(p),
            _ => Err("not a MySQL/MariaDB session".to_string()),
        }
    }
    fn pg(&self) -> Result<&PgBackend, String> {
        match &self.backend {
            DbBackend::Postgres(p) => Ok(p),
            _ => Err("not a PostgreSQL session".to_string()),
        }
    }
    fn is_pg(&self) -> bool {
        matches!(self.backend, DbBackend::Postgres(_))
    }
}

/// A table or view in a database (for the schema tree).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    /// "table" or "view".
    pub kind: String,
}

/// Open a persistent DB session over `session_id`'s SSH connection and return
/// its id. Validates the connection before registering so a bad login fails
/// here. `engine` selects the driver ("postgres" vs mysql/mariadb).
#[tauri::command]
pub async fn db_open(
    state: State<'_, AppState>,
    session_id: String,
    engine: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<String, String> {
    let handle = state
        .ssh_handle(&session_id)
        .ok_or_else(|| "not an SSH session".to_string())?;
    let tunnel = open_tunnel(handle, host.clone(), port).await?;

    let backend = if engine == "postgres" {
        let default_db = database.clone().unwrap_or_else(|| "postgres".to_string());
        let pg = PgBackend {
            local_port: tunnel.local_port,
            user: user.clone(),
            password: password.clone(),
            default_db: default_db.clone(),
            clients: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        };
        // Probe: connect to the target database (or the default "postgres").
        pg.client(&default_db).await?;
        DbBackend::Postgres(pg)
    } else {
        use mysql_async::prelude::Queryable;
        let opts = mysql_async::OptsBuilder::default()
            .ip_or_hostname("127.0.0.1")
            .tcp_port(tunnel.local_port)
            .prefer_socket(false)
            .user(Some(user.clone()))
            .pass(Some(password.clone()))
            .db_name(database);
        let pool = mysql_async::Pool::new(opts);
        let mut conn = pool.get_conn().await.map_err(|e| format!("connect: {e}"))?;
        let _: Option<String> = conn
            .query_first("SELECT 1")
            .await
            .map_err(|e| format!("connect: {e}"))?;
        drop(conn);
        DbBackend::Mysql(pool)
    };

    let id = state.next_id();
    state.insert_db(
        id.clone(),
        Arc::new(DbSession {
            parent_ssh: session_id,
            backend,
            _tunnel: tunnel,
            engine,
            db_user: user,
            db_password: password,
            db_host: host,
            db_port: port,
        }),
    );
    Ok(id)
}

/// List databases. MySQL: `SHOW DATABASES`. Postgres: `pg_database`.
#[tauri::command]
pub async fn db_list_databases(
    state: State<'_, AppState>,
    db_session_id: String,
) -> Result<Vec<String>, String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    if sess.is_pg() {
        let pg = sess.pg()?;
        let client = pg.client(&pg.default_db).await?;
        let rows = client
            .query(
                "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn ORDER BY datname",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;
        return Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect());
    }

    use mysql_async::prelude::Queryable;
    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
    conn.query("SHOW DATABASES").await.map_err(|e| e.to_string())
}

/// List schemas in a Postgres database (MySQL has no schema layer — returns []).
#[tauri::command]
pub async fn db_list_schemas(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
) -> Result<Vec<String>, String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    if !sess.is_pg() {
        return Ok(vec![]);
    }
    let client = sess.pg()?.client(&database).await?;
    let rows = client
        .query(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name <> 'information_schema' AND schema_name !~ '^pg_' \
             ORDER BY schema_name",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}

/// Tables + views. MySQL: information_schema by database. Postgres: by database
/// + schema (schema is None/ignored for MySQL).
#[tauri::command]
pub async fn db_list_tables(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;
        let rows = client
            .query(
                "SELECT table_name, table_type FROM information_schema.tables \
                 WHERE table_schema = $1 ORDER BY table_name",
                &[&sch],
            )
            .await
            .map_err(|e| e.to_string())?;
        return Ok(rows
            .iter()
            .map(|r| {
                let ty: String = r.get(1);
                TableInfo {
                    name: r.get(0),
                    kind: if ty.eq_ignore_ascii_case("VIEW") { "view".into() } else { "table".into() },
                }
            })
            .collect());
    }

    use mysql_async::prelude::Queryable;
    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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

/// Close a live DB session: disconnect the MySQL pool (best effort) and drop the
/// tunnel + any Postgres clients. Idempotent.
#[tauri::command]
pub async fn db_close(state: State<'_, AppState>, db_session_id: String) -> Result<(), String> {
    if let Some(sess) = state.remove_db(&db_session_id) {
        if let DbBackend::Mysql(pool) = &sess.backend {
            let _ = pool.clone().disconnect().await;
        }
        // Postgres clients + tunnel drop with `sess`.
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

/// Run a query on Postgres via the simple-query protocol (values come back as
/// text — same stringify model as MySQL's text protocol). Column types aren't
/// available here, so `db_type` is left blank (enriched in a later stage).
async fn run_query_pg(
    client: &tokio_postgres::Client,
    sql: &str,
) -> Result<QueryResult, String> {
    let msgs = client.simple_query(sql).await.map_err(|e| e.to_string())?;
    let mut columns: Vec<ColumnInfo> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut rows_affected = 0u64;
    let mut truncated = false;
    for m in msgs {
        match m {
            tokio_postgres::SimpleQueryMessage::RowDescription(cols) => {
                columns = cols
                    .iter()
                    .map(|c| ColumnInfo { name: c.name().to_string(), db_type: String::new() })
                    .collect();
            }
            tokio_postgres::SimpleQueryMessage::Row(row) => {
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|c| ColumnInfo { name: c.name().to_string(), db_type: String::new() })
                        .collect();
                }
                if rows.len() >= MAX_ROWS {
                    truncated = true;
                    continue;
                }
                let cells = (0..row.len()).map(|i| row.get(i).map(|s| s.to_string())).collect();
                rows.push(cells);
            }
            tokio_postgres::SimpleQueryMessage::CommandComplete(n) => rows_affected = n,
            _ => {}
        }
    }
    Ok(QueryResult { columns, rows, rows_affected, truncated })
}

/// Best-effort total row count for a Postgres SELECT (wrapped in a subquery).
async fn pg_count(client: &tokio_postgres::Client, sql: &str) -> Option<u64> {
    let msgs = client
        .simple_query(&format!("SELECT COUNT(*) FROM ({sql}) AS _moorix_count"))
        .await
        .ok()?;
    for m in msgs {
        if let tokio_postgres::SimpleQueryMessage::Row(row) = m {
            return row.get(0).and_then(|s| s.parse::<u64>().ok());
        }
    }
    None
}

/// Double-quote a Postgres identifier.
fn pg_quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Friendly Postgres type label from information_schema metadata (udt_name plus
/// length/precision), e.g. "varchar(255)", "numeric(12,2)", "integer", "bool" →
/// "boolean", "timestamptz". Unknown types pass through as their udt_name.
fn pg_friendly_type(
    udt: &str,
    char_len: Option<i32>,
    prec: Option<i32>,
    scale: Option<i32>,
) -> String {
    match udt {
        "int2" => "smallint".into(),
        "int4" => "integer".into(),
        "int8" => "bigint".into(),
        "float4" => "real".into(),
        "float8" => "double precision".into(),
        "bool" => "boolean".into(),
        "varchar" => match char_len {
            Some(n) => format!("varchar({n})"),
            None => "varchar".into(),
        },
        "bpchar" => match char_len {
            Some(n) => format!("char({n})"),
            None => "char".into(),
        },
        "numeric" => match (prec, scale) {
            (Some(p), Some(s)) => format!("numeric({p},{s})"),
            (Some(p), None) => format!("numeric({p})"),
            _ => "numeric".into(),
        },
        other => other.to_string(),
    }
}

/// Map of column name → friendly type for a Postgres table (used to enrich a
/// browse result grid, since the simple-query protocol carries no type info).
async fn pg_column_types(
    client: &tokio_postgres::Client,
    schema: &str,
    table: &str,
) -> Result<Vec<(String, String)>, String> {
    let rows = client
        .query(
            "SELECT c.column_name::text, c.udt_name::text, \
             c.character_maximum_length::int, c.numeric_precision::int, c.numeric_scale::int, \
             COALESCE(t.typtype = 'e', false) AS is_enum \
             FROM information_schema.columns c \
             LEFT JOIN pg_namespace n ON n.nspname::text = c.udt_schema::text \
             LEFT JOIN pg_type t ON t.typname::text = c.udt_name::text AND t.typnamespace = n.oid \
             WHERE c.table_schema::text = $1 AND c.table_name::text = $2 \
             ORDER BY c.ordinal_position",
            &[&schema, &table],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let udt: String = r.get(1);
            let is_enum: bool = r.get(5);
            let ty = if is_enum {
                "enum".to_string()
            } else {
                pg_friendly_type(&udt, r.get(2), r.get(3), r.get(4))
            };
            (name, ty)
        })
        .collect())
}

/// Single-quote a Postgres string literal (doubling embedded quotes). Safe with
/// standard_conforming_strings (default since PG 9.1): backslashes are literal,
/// so a doubled `''` is the only way to embed a quote and there's no escape-out.
fn pg_quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Render a cell value as a Postgres literal: NULL keyword or a quoted string.
/// Unknown-type string literals are coerced to the target column type by the
/// server (same model as MySQL's text protocol), so `'123'` fills an int column.
fn pg_cell_literal(v: &Option<String>) -> String {
    match v {
        None => "NULL".to_string(),
        Some(s) => pg_quote_literal(s),
    }
}

/// Run a Postgres statement (simple protocol) and return its affected-row count.
/// Used for DML/DDL where values are inlined as literals (see `pg_cell_literal`).
async fn pg_exec_count(client: &tokio_postgres::Client, sql: &str) -> Result<u64, String> {
    let msgs = client.simple_query(sql).await.map_err(|e| e.to_string())?;
    let mut affected = 0u64;
    for m in msgs {
        if let tokio_postgres::SimpleQueryMessage::CommandComplete(n) = m {
            affected = n;
        }
    }
    Ok(affected)
}

/// Exact row count for a Postgres table (for pagination).
async fn pg_count_table(client: &tokio_postgres::Client, qualified: &str) -> Option<u64> {
    let msgs = client
        .simple_query(&format!("SELECT COUNT(*) FROM {qualified}"))
        .await
        .ok()?;
    for m in msgs {
        if let tokio_postgres::SimpleQueryMessage::Row(row) = m {
            return row.get(0).and_then(|s| s.parse::<u64>().ok());
        }
    }
    None
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

    // Postgres: run against the client bound to `database` (no USE in PG).
    if sess.is_pg() {
        let pg = sess.pg()?;
        let dbname = database.filter(|d| !d.is_empty()).unwrap_or_else(|| pg.default_db.clone());
        let client = pg.client(&dbname).await?;
        let trimmed = sql.trim().trim_end_matches(';').trim().to_string();
        if page_size > 0 && is_paginable_select(&trimmed) {
            let offset = page.saturating_mul(page_size as u64);
            let result = run_query_pg(&client, &format!("{trimmed} LIMIT {page_size} OFFSET {offset}")).await?;
            let total = pg_count(&client, &trimmed).await;
            return Ok(SqlResult { result, total, paginated: true });
        }
        let result = run_query_pg(&client, &sql).await?;
        return Ok(SqlResult { result, total: None, paginated: false });
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;

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
    schema: Option<String>,
) -> Result<BrowseResult, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    // Postgres: connect to `database`, window `schema.table` with quoting, and
    // enrich column types from information_schema (the simple protocol has none).
    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;
        let qualified = format!("{}.{}", pg_quote_ident(&sch), pg_quote_ident(&table));
        let mut result = run_query_pg(
            &client,
            &format!("SELECT * FROM {qualified} LIMIT {limit} OFFSET {offset}"),
        )
        .await?;
        if let Ok(types) = pg_column_types(&client, &sch, &table).await {
            let map: std::collections::HashMap<String, String> = types.into_iter().collect();
            for c in &mut result.columns {
                if let Some(t) = map.get(&c.name) {
                    c.db_type = t.clone();
                }
            }
        }
        let total = pg_count_table(&client, &qualified).await.unwrap_or(0);
        return Ok(BrowseResult { result, total });
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;

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
    /// For a Postgres column whose type is an ENUM: the enum's values (so the UI
    /// can edit it as a guided enum). None for non-enum columns and for MySQL
    /// (whose enum values already live inline in `data_type`).
    pub enum_values: Option<Vec<String>>,
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
    schema: Option<String>,
) -> Result<TableStructure, String> {
    use mysql_async::prelude::Queryable;

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;

        // Primary-key columns (used to flag columns below).
        let pk_rows = client
            .query(
                "SELECT att.attname::text FROM pg_constraint con \
                 JOIN pg_class t ON t.oid = con.conrelid \
                 JOIN pg_namespace n ON n.oid = t.relnamespace \
                 JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true \
                 JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ck.attnum \
                 WHERE con.contype = 'p' AND n.nspname::text = $1 AND t.relname::text = $2 \
                 ORDER BY ck.ord",
                &[&sch, &table],
            )
            .await
            .map_err(|e| e.to_string())?;
        let primary_key: Vec<String> = pk_rows.iter().map(|r| r.get::<_, String>(0)).collect();

        // Columns
        let col_rows = client
            .query(
                "SELECT column_name::text, udt_name::text, is_nullable::text, column_default::text, \
                 character_maximum_length::int, numeric_precision::int, numeric_scale::int, is_identity::text \
                 FROM information_schema.columns \
                 WHERE table_schema::text = $1 AND table_name::text = $2 ORDER BY ordinal_position",
                &[&sch, &table],
            )
            .await
            .map_err(|e| e.to_string())?;

        // Enum columns → their values (so the UI can edit them as a guided enum).
        let enum_rows = client
            .query(
                "SELECT a.attname::text, e.enumlabel::text FROM pg_attribute a \
                 JOIN pg_type ty ON ty.oid = a.atttypid AND ty.typtype = 'e' \
                 JOIN pg_enum e ON e.enumtypid = ty.oid \
                 JOIN pg_class c ON c.oid = a.attrelid \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE n.nspname::text = $1 AND c.relname::text = $2 \
                 AND a.attnum > 0 AND NOT a.attisdropped \
                 ORDER BY a.attnum, e.enumsortorder",
                &[&sch, &table],
            )
            .await
            .map_err(|e| e.to_string())?;
        let mut enum_map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for r in &enum_rows {
            enum_map
                .entry(r.get::<_, String>(0))
                .or_default()
                .push(r.get::<_, String>(1));
        }

        let columns: Vec<ColumnDef> = col_rows
            .iter()
            .map(|r| {
                let name: String = r.get(0);
                let udt: String = r.get(1);
                let is_nullable: String = r.get(2);
                let default: Option<String> = r.get(3);
                let is_identity: String = r.get(7);
                let key = if primary_key.contains(&name) {
                    "PRI".to_string()
                } else {
                    String::new()
                };
                let extra = if is_identity.eq_ignore_ascii_case("YES") {
                    "identity".to_string()
                } else if default.as_deref().map(|d| d.starts_with("nextval(")).unwrap_or(false) {
                    "serial".to_string()
                } else {
                    String::new()
                };
                let enum_values = enum_map.get(&name).cloned();
                ColumnDef {
                    name,
                    data_type: pg_friendly_type(&udt, r.get(4), r.get(5), r.get(6)),
                    nullable: is_nullable.eq_ignore_ascii_case("YES"),
                    key,
                    default,
                    extra,
                    comment: String::new(),
                    enum_values,
                }
            })
            .collect();

        // Indexes (columns via `= ANY(indkey)`; ordered by their position in it).
        let idx_rows = client
            .query(
                "SELECT i.relname::text, ix.indisunique, a.attname::text, \
                 array_position(string_to_array(ix.indkey::text, ' ')::int[], a.attnum::int) AS ord \
                 FROM pg_index ix \
                 JOIN pg_class i ON i.oid = ix.indexrelid \
                 JOIN pg_class t ON t.oid = ix.indrelid \
                 JOIN pg_namespace n ON n.oid = t.relnamespace \
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) \
                 WHERE n.nspname::text = $1 AND t.relname::text = $2 \
                 ORDER BY i.relname, ord",
                &[&sch, &table],
            )
            .await
            .map_err(|e| e.to_string())?;
        let mut indexes: Vec<IndexDef> = Vec::new();
        for r in &idx_rows {
            let iname: String = r.get(0);
            let unique: bool = r.get(1);
            let col: String = r.get(2);
            match indexes.last_mut() {
                Some(last) if last.name == iname => last.columns.push(col),
                _ => indexes.push(IndexDef { name: iname, columns: vec![col], unique }),
            }
        }

        // Foreign keys (each local column paired with its referenced column by ordinal).
        let fk_rows = client
            .query(
                "SELECT con.conname::text, att.attname::text, ft.relname::text, fatt.attname::text \
                 FROM pg_constraint con \
                 JOIN pg_class t ON t.oid = con.conrelid \
                 JOIN pg_namespace n ON n.oid = t.relnamespace \
                 JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true \
                 JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ck.attnum \
                 JOIN pg_class ft ON ft.oid = con.confrelid \
                 JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord \
                 JOIN pg_attribute fatt ON fatt.attrelid = ft.oid AND fatt.attnum = fk.attnum \
                 WHERE con.contype = 'f' AND n.nspname::text = $1 AND t.relname::text = $2 \
                 ORDER BY con.conname, ck.ord",
                &[&sch, &table],
            )
            .await
            .map_err(|e| e.to_string())?;
        let foreign_keys: Vec<ForeignKeyDef> = fk_rows
            .iter()
            .map(|r| ForeignKeyDef {
                name: r.get(0),
                column: r.get(1),
                ref_table: r.get(2),
                ref_column: r.get(3),
            })
            .collect();

        return Ok(TableStructure { columns, indexes, foreign_keys, primary_key });
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;

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
                enum_values: None,
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
    schema: Option<String>,
) -> Result<u64, String> {
    use mysql_async::prelude::Queryable;

    if pk.is_empty() {
        return Err("cannot update a row without a primary key".to_string());
    }
    if changes.is_empty() {
        return Ok(0);
    }

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    // Postgres: schema-qualified, values inlined as coerced literals (no LIMIT).
    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;
        let set_clause = changes
            .iter()
            .map(|c| format!("{} = {}", pg_quote_ident(&c.column), pg_cell_literal(&c.value)))
            .collect::<Vec<_>>()
            .join(", ");
        let where_clause = pk
            .iter()
            .map(|c| format!("{} = {}", pg_quote_ident(&c.column), pg_cell_literal(&c.value)))
            .collect::<Vec<_>>()
            .join(" AND ");
        let sql = format!(
            "UPDATE {}.{} SET {set_clause} WHERE {where_clause}",
            pg_quote_ident(&sch),
            pg_quote_ident(&table)
        );
        return pg_exec_count(&client, &sql).await;
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

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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
    schema: Option<String>,
) -> Result<u64, String> {
    use mysql_async::prelude::Queryable;

    if pk.is_empty() {
        return Err("cannot delete a row without a primary key".to_string());
    }

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;
        let where_clause = pk
            .iter()
            .map(|c| format!("{} = {}", pg_quote_ident(&c.column), pg_cell_literal(&c.value)))
            .collect::<Vec<_>>()
            .join(" AND ");
        let sql = format!(
            "DELETE FROM {}.{} WHERE {where_clause}",
            pg_quote_ident(&sch),
            pg_quote_ident(&table)
        );
        return pg_exec_count(&client, &sql).await;
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

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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
    schema: Option<String>,
) -> Result<u64, String> {
    use mysql_async::prelude::Queryable;

    if values.is_empty() {
        return Err("no values to insert".to_string());
    }

    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;
        let cols = values
            .iter()
            .map(|c| pg_quote_ident(&c.column))
            .collect::<Vec<_>>()
            .join(", ");
        let vals = values
            .iter()
            .map(|c| pg_cell_literal(&c.value))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {}.{} ({cols}) VALUES ({vals})",
            pg_quote_ident(&sch),
            pg_quote_ident(&table)
        );
        return pg_exec_count(&client, &sql).await;
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

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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

    if sess.is_pg() {
        let client = sess.pg()?.client(&database).await?;
        let rows = client
            .query(
                "SELECT table_name::text, column_name::text, udt_name::text, \
                 character_maximum_length::int, numeric_precision::int, numeric_scale::int \
                 FROM information_schema.columns \
                 WHERE table_schema::text NOT IN ('information_schema', 'pg_catalog') \
                 AND table_schema::text !~ '^pg_' ORDER BY table_name, ordinal_position",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;
        return Ok(rows
            .iter()
            .map(|r| {
                let table: String = r.get(0);
                let name: String = r.get(1);
                let udt: String = r.get(2);
                SchemaColumn {
                    table,
                    name,
                    data_type: pg_friendly_type(&udt, r.get(3), r.get(4), r.get(5)),
                }
            })
            .collect());
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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

/// Escape a value for a Postgres `.pgpass` field (`\` and `:` are the only
/// specials; everything else is literal). Used for the user/password fields.
fn pg_pgpass_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace(':', "\\:")
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
/// server-side `mysqldump` (MySQL) or `pg_dump` (Postgres). Saves into the OS
/// Downloads folder and returns the full local path. Credentials go through a
/// mode-600 file (defaults-extra-file / .pgpass), never argv.
#[tauri::command]
pub async fn db_export_sql(
    app: AppHandle,
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    tables: Vec<String>,
    structure_only: bool,
    data_only: bool,
    schema: Option<String>,
) -> Result<String, String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let handle = state
        .ssh_handle(&sess.parent_ssh)
        .ok_or_else(|| "SSH session for this database is closed".to_string())?;

    // Destination (engine-independent): Downloads/<db>[_<table>]_<epoch>.sql
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

    // Postgres: pg_dump, credentials via a mode-600 .pgpass (PGPASSFILE).
    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let pgpass = format!("/tmp/.moorix-dump-{}.pgpass", state.next_id());
        let body = format!(
            "*:*:*:{}:{}\n",
            pg_pgpass_escape(&sess.db_user),
            pg_pgpass_escape(&sess.db_password)
        );
        write_secure_remote(&handle, &pgpass, body.as_bytes()).await?;

        let mut cmd = format!(
            "PGPASSFILE={} pg_dump -h {} -p {} -U {} -d {} --no-owner --no-privileges",
            shq(&pgpass),
            shq(&sess.db_host),
            sess.db_port,
            shq(&sess.db_user),
            shq(&database)
        );
        if structure_only {
            cmd.push_str(" --schema-only");
        }
        if data_only {
            cmd.push_str(" --data-only");
        }
        for t in &tables {
            cmd.push_str(" -t ");
            cmd.push_str(&shq(&format!("{sch}.{t}")));
        }

        let result = exec_to_file(&handle, &cmd, &local_path).await;
        let _ = run_exec(&handle, &format!("rm -f {}", shq(&pgpass)), None, |_| {}).await;

        let (_bytes, stderr, code) = result?;
        if code != 0 {
            let _ = tokio::fs::remove_file(&local_path).await;
            return Err(format!(
                "pg_dump exited {code}: {}",
                String::from_utf8_lossy(&stderr).trim()
            ));
        }
        return Ok(local_path.to_string_lossy().to_string());
    }

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

/// Import a `.sql` script into `database` via server-side `mysql` (MySQL) or
/// `psql` (Postgres), streaming the script to its stdin. Credentials go through a
/// mode-600 file (never argv). Returns Ok(()) on success; the tool's error otherwise.
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

    // Postgres: psql reads the script from stdin; ON_ERROR_STOP makes it fail hard.
    if sess.is_pg() {
        let pgpass = format!("/tmp/.moorix-import-{}.pgpass", state.next_id());
        let body = format!(
            "*:*:*:{}:{}\n",
            pg_pgpass_escape(&sess.db_user),
            pg_pgpass_escape(&sess.db_password)
        );
        write_secure_remote(&handle, &pgpass, body.as_bytes()).await?;
        let cmd = format!(
            "PGPASSFILE={} psql -h {} -p {} -U {} -d {} -v ON_ERROR_STOP=1 -q",
            shq(&pgpass),
            shq(&sess.db_host),
            sess.db_port,
            shq(&sess.db_user),
            shq(&database)
        );
        let result = run_exec(&handle, &cmd, Some(sql.into_bytes()), |_| {}).await;
        let _ = run_exec(&handle, &format!("rm -f {}", shq(&pgpass)), None, |_| {}).await;
        let (stderr, code) = result?;
        if code != 0 {
            return Err(String::from_utf8_lossy(&stderr).trim().to_string());
        }
        return Ok(());
    }

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
    schema: Option<String>,
) -> Result<(), String> {
    use mysql_async::prelude::Queryable;
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;
        return client
            .batch_execute(&format!(
                "DROP TABLE {}.{}",
                pg_quote_ident(&sch),
                pg_quote_ident(&table)
            ))
            .await
            .map_err(|e| e.to_string());
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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
    schema: Option<String>,
) -> Result<(), String> {
    use mysql_async::prelude::Queryable;
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    if sess.is_pg() {
        let sch = schema.unwrap_or_else(|| "public".to_string());
        let client = sess.pg()?.client(&database).await?;
        // Postgres: the new name is bare (rename is within the same schema).
        return client
            .batch_execute(&format!(
                "ALTER TABLE {}.{} RENAME TO {}",
                pg_quote_ident(&sch),
                pg_quote_ident(&old_name),
                pg_quote_ident(&new_name)
            ))
            .await
            .map_err(|e| e.to_string());
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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

    if sess.is_pg() {
        let pg = sess.pg()?;
        // Can't drop a database we're connected to — evict its cached client, then
        // run the DROP from the default database's connection.
        pg.close_db(&database).await;
        let client = pg.client(&pg.default_db).await?;
        return client
            .batch_execute(&format!("DROP DATABASE {}", pg_quote_ident(&database)))
            .await
            .map_err(|e| e.to_string());
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
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

    if sess.is_pg() {
        let pg = sess.pg()?;
        // Postgres has a native rename, but refuses it while a session is connected
        // to the database — evict its cached client, then rename from the default db.
        pg.close_db(&old_name).await;
        let client = pg.client(&pg.default_db).await?;
        return client
            .batch_execute(&format!(
                "ALTER DATABASE {} RENAME TO {}",
                pg_quote_ident(&old_name),
                pg_quote_ident(&new_name)
            ))
            .await
            .map_err(|e| e.to_string());
    }

    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;

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

/* -------------------------------------------------------------------------- */
/* DDL: create database & table (MySQL/MariaDB + PostgreSQL).                   */
/* -------------------------------------------------------------------------- */

/// A column definition for `db_create_table`. `data_type` is the raw SQL type
/// the user chose (e.g. "varchar(255)", "int", "serial", "numeric(12,2)").
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    /// Raw default expression (e.g. "0", "'x'", "now()") or None.
    pub default: Option<String>,
    pub primary_key: bool,
    /// MySQL AUTO_INCREMENT (ignored for Postgres — use a serial type there).
    pub auto_increment: bool,
}

/// Create a database. Engine-aware quoting; Postgres runs it outside a
/// transaction via the simple protocol. `charset`/`collation` are optional:
/// MySQL maps them to `CHARACTER SET`/`COLLATE`, Postgres maps `charset` to
/// `ENCODING` (and `collation` to `LC_COLLATE`/`LC_CTYPE`), building from
/// `template0` so a non-default locale/encoding is allowed.
#[tauri::command]
pub async fn db_create_database(
    state: State<'_, AppState>,
    db_session_id: String,
    name: String,
    charset: Option<String>,
    collation: Option<String>,
) -> Result<(), String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;

    // charset/collation are interpolated into DDL (identifiers in MySQL, string
    // literals in PG) — restrict to a safe alphabet to prevent injection.
    fn clean(v: Option<String>) -> Result<Option<String>, String> {
        match v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => Ok(None),
            Some(s) if s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') => {
                Ok(Some(s.to_string()))
            }
            Some(s) => Err(format!("invalid charset/collation name: {s}")),
        }
    }
    let charset = clean(charset)?;
    let collation = clean(collation)?;

    if sess.is_pg() {
        let pg = sess.pg()?;
        let client = pg.client(&pg.default_db).await?;
        let mut sql = format!("CREATE DATABASE {}", pg_quote_ident(&name));
        // A non-default encoding/locale must be cloned from template0.
        if charset.is_some() || collation.is_some() {
            sql.push_str(" TEMPLATE template0");
        }
        if let Some(enc) = &charset {
            sql.push_str(&format!(" ENCODING {}", pg_quote_literal(enc)));
        }
        if let Some(col) = &collation {
            let lit = pg_quote_literal(col);
            sql.push_str(&format!(" LC_COLLATE {lit} LC_CTYPE {lit}"));
        }
        return client
            .batch_execute(&sql)
            .await
            .map_err(|e| e.to_string());
    }

    use mysql_async::prelude::Queryable;
    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
    let mut sql = format!("CREATE DATABASE {}", quote_ident(&name));
    if let Some(cs) = &charset {
        sql.push_str(&format!(" CHARACTER SET {cs}"));
    }
    if let Some(col) = &collation {
        sql.push_str(&format!(" COLLATE {col}"));
    }
    conn.query_drop(sql).await.map_err(|e| e.to_string())
}

/// Create a table from a column spec. `schema` is used for Postgres (defaults to
/// "public"); MySQL uses `database`.
#[tauri::command]
pub async fn db_create_table(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    schema: Option<String>,
    table: String,
    columns: Vec<NewColumn>,
) -> Result<(), String> {
    if columns.is_empty() {
        return Err("a table needs at least one column".to_string());
    }
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let pg = sess.is_pg();
    let q: fn(&str) -> String = if pg { pg_quote_ident } else { quote_ident };

    let mut defs: Vec<String> = Vec::new();
    let mut pks: Vec<String> = Vec::new();
    for c in &columns {
        defs.push(build_column_def(c, pg)?);
        if c.primary_key {
            pks.push(q(&c.name));
        }
    }
    if !pks.is_empty() {
        defs.push(format!("PRIMARY KEY ({})", pks.join(", ")));
    }

    let qualified = if pg {
        format!("{}.{}", q(&schema.clone().unwrap_or_else(|| "public".to_string())), q(&table))
    } else {
        format!("{}.{}", q(&database), q(&table))
    };
    let sql = format!("CREATE TABLE {qualified} (\n  {}\n)", defs.join(",\n  "));

    if pg {
        let client = sess.pg()?.client(&database).await?;
        return client.batch_execute(&sql).await.map_err(|e| e.to_string());
    }
    use mysql_async::prelude::Queryable;
    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
    conn.query_drop(sql).await.map_err(|e| e.to_string())
}

/// Build a single column definition (`"name" type [NOT NULL] [DEFAULT x]
/// [AUTO_INCREMENT]`) — shared by create-table and add/modify-column. `pg`
/// selects the quoting and drops AUTO_INCREMENT (Postgres uses serial types).
fn build_column_def(c: &NewColumn, pg: bool) -> Result<String, String> {
    if c.name.trim().is_empty() || c.data_type.trim().is_empty() {
        return Err("every column needs a name and a type".to_string());
    }
    let q: fn(&str) -> String = if pg { pg_quote_ident } else { quote_ident };
    let mut def = format!("{} {}", q(&c.name), c.data_type.trim());
    if !c.nullable {
        def.push_str(" NOT NULL");
    }
    if let Some(d) = c.default.as_ref().filter(|d| !d.trim().is_empty()) {
        def.push_str(&format!(" DEFAULT {}", d.trim()));
    }
    if !pg && c.auto_increment {
        def.push_str(" AUTO_INCREMENT");
    }
    Ok(def)
}

/* -------------------------------------------------------------------------- */
/* DDL: edit columns (add / modify / drop) — MySQL/MariaDB + PostgreSQL.        */
/* -------------------------------------------------------------------------- */

/// Qualified table name for a DDL statement (schema.table for PG, db.table for MySQL).
fn ddl_qualified(pg: bool, database: &str, schema: &Option<String>, table: &str) -> String {
    if pg {
        let sch = schema.clone().unwrap_or_else(|| "public".to_string());
        format!("{}.{}", pg_quote_ident(&sch), pg_quote_ident(table))
    } else {
        format!("{}.{}", quote_ident(database), quote_ident(table))
    }
}

/// ADD a column to an existing table. `first`/`after` position the new column
/// (MySQL/MariaDB only — Postgres always appends and ignores both).
#[tauri::command]
pub async fn db_add_column(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
    column: NewColumn,
    schema: Option<String>,
    first: Option<bool>,
    after: Option<String>,
) -> Result<(), String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let pg = sess.is_pg();
    let def = build_column_def(&column, pg)?;
    let qualified = ddl_qualified(pg, &database, &schema, &table);

    if pg {
        // Postgres has no ADD COLUMN FIRST/AFTER — the column always lands last.
        let sql = format!("ALTER TABLE {qualified} ADD COLUMN {def}");
        let client = sess.pg()?.client(&database).await?;
        return client.batch_execute(&sql).await.map_err(|e| e.to_string());
    }

    let mut sql = format!("ALTER TABLE {qualified} ADD COLUMN {def}");
    if first.unwrap_or(false) {
        sql.push_str(" FIRST");
    } else if let Some(col) = after.as_ref().filter(|c| !c.trim().is_empty()) {
        sql.push_str(&format!(" AFTER {}", quote_ident(col)));
    }
    use mysql_async::prelude::Queryable;
    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
    conn.query_drop(sql).await.map_err(|e| e.to_string())
}

/// MODIFY a column (rename + redefine). MySQL uses one `CHANGE COLUMN`; Postgres
/// needs separate RENAME / TYPE / NOT NULL / DEFAULT statements (run as one
/// atomic batch). `old_name` is the current column name; `column` the new spec.
#[tauri::command]
pub async fn db_modify_column(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
    old_name: String,
    column: NewColumn,
    schema: Option<String>,
) -> Result<(), String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let pg = sess.is_pg();
    let qualified = ddl_qualified(pg, &database, &schema, &table);

    if pg {
        if column.name.trim().is_empty() || column.data_type.trim().is_empty() {
            return Err("column needs a name and a type".to_string());
        }
        let client = sess.pg()?.client(&database).await?;
        let mut stmts: Vec<String> = Vec::new();
        if old_name != column.name {
            stmts.push(format!(
                "ALTER TABLE {qualified} RENAME COLUMN {} TO {}",
                pg_quote_ident(&old_name),
                pg_quote_ident(&column.name)
            ));
        }
        let col = pg_quote_ident(&column.name);
        let ty = column.data_type.trim();
        // USING clause casts existing values so most type changes succeed.
        stmts.push(format!(
            "ALTER TABLE {qualified} ALTER COLUMN {col} TYPE {ty} USING {col}::{ty}"
        ));
        stmts.push(format!(
            "ALTER TABLE {qualified} ALTER COLUMN {col} {}",
            if column.nullable { "DROP NOT NULL" } else { "SET NOT NULL" }
        ));
        match column.default.as_ref().filter(|d| !d.trim().is_empty()) {
            Some(d) => stmts.push(format!(
                "ALTER TABLE {qualified} ALTER COLUMN {col} SET DEFAULT {}",
                d.trim()
            )),
            None => stmts.push(format!("ALTER TABLE {qualified} ALTER COLUMN {col} DROP DEFAULT")),
        }
        return client.batch_execute(&stmts.join(";\n")).await.map_err(|e| e.to_string());
    }

    let def = build_column_def(&column, false)?;
    let sql = format!("ALTER TABLE {qualified} CHANGE COLUMN {} {def}", quote_ident(&old_name));
    use mysql_async::prelude::Queryable;
    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
    conn.query_drop(sql).await.map_err(|e| e.to_string())
}

/// DROP a column from a table.
#[tauri::command]
pub async fn db_drop_column(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    table: String,
    column: String,
    schema: Option<String>,
) -> Result<(), String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    let pg = sess.is_pg();
    let qualified = ddl_qualified(pg, &database, &schema, &table);
    let col = if pg { pg_quote_ident(&column) } else { quote_ident(&column) };
    let sql = format!("ALTER TABLE {qualified} DROP COLUMN {col}");

    if pg {
        let client = sess.pg()?.client(&database).await?;
        return client.batch_execute(&sql).await.map_err(|e| e.to_string());
    }
    use mysql_async::prelude::Queryable;
    let mut conn = sess.mysql()?.get_conn().await.map_err(|e| e.to_string())?;
    conn.query_drop(sql).await.map_err(|e| e.to_string())
}

/// Create or extend a PostgreSQL ENUM type. If the type doesn't exist it's
/// created (`CREATE TYPE schema.name AS ENUM (...)`); if it does, any values not
/// already present are appended (`ALTER TYPE … ADD VALUE IF NOT EXISTS`, each as
/// its own statement so it isn't wrapped in a transaction block). Postgres can't
/// remove/rename enum values, so removals in the UI are ignored. Postgres-only —
/// MySQL/MariaDB use inline `enum(...)` column types instead.
#[tauri::command]
pub async fn db_apply_enum(
    state: State<'_, AppState>,
    db_session_id: String,
    database: String,
    schema: Option<String>,
    name: String,
    values: Vec<String>,
) -> Result<(), String> {
    let sess = state
        .db_session(&db_session_id)
        .ok_or_else(|| "db session not found".to_string())?;
    if !sess.is_pg() {
        return Err("enum types are PostgreSQL-only here".to_string());
    }
    if name.trim().is_empty() {
        return Err("enum type needs a name".to_string());
    }
    // Keep empty members (e.g. enum('a','')) — only require one non-empty value.
    let vals: Vec<String> = values.iter().map(|v| v.trim().to_string()).collect();
    if !vals.iter().any(|v| !v.is_empty()) {
        return Err("an enum needs at least one non-empty value".to_string());
    }
    let sch = schema.unwrap_or_else(|| "public".to_string());
    let client = sess.pg()?.client(&database).await?;

    let exists = !client
        .query(
            "SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace \
             WHERE t.typname::text = $1 AND n.nspname::text = $2 AND t.typtype = 'e'",
            &[&name, &sch],
        )
        .await
        .map_err(|e| e.to_string())?
        .is_empty();

    if !exists {
        let lits = vals.iter().map(|v| pg_quote_literal(v)).collect::<Vec<_>>().join(", ");
        let sql = format!(
            "CREATE TYPE {}.{} AS ENUM ({lits})",
            pg_quote_ident(&sch),
            pg_quote_ident(&name)
        );
        return client.batch_execute(&sql).await.map_err(|e| e.to_string());
    }

    // Existing type: append any missing values (one statement each).
    for v in &vals {
        let sql = format!(
            "ALTER TYPE {}.{} ADD VALUE IF NOT EXISTS {}",
            pg_quote_ident(&sch),
            pg_quote_ident(&name),
            pg_quote_literal(v)
        );
        client.simple_query(&sql).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

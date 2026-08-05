import { invoke } from "@tauri-apps/api/core";
import { secretGet } from "./secrets";

/** Database engines. MySQL/MariaDB share the mysql_async driver; Postgres is a
 *  separate driver added in Fase 20D. */
export type DbEngine = "mysql" | "mariadb" | "postgres";

/**
 * A database connection, stored as a child of an SSH profile (`UserProfile.databases`).
 * The SSH half is inherited from the parent profile — a DBProfile only holds the
 * DB-side address (as seen from the server, through the tunnel) and account.
 * `password` is transient: it's persisted to the vault keyed by `id` and stripped
 * to "" in the store (same pattern as the SSH password).
 */
export type DBProfile = {
  id: string;
  name: string;
  engine: DbEngine;
  /** DB host as seen from the SSH server (through the tunnel). Usually 127.0.0.1. */
  host: string;
  port: number;
  dbUser: string;
  /** Transient — vault-backed by `id`; never persisted in the profile store. */
  password: string;
  /** Optional default database to open. */
  defaultDatabase: string;
};

/** Result of `db_test_connect` (Fase 20A). */
export type DbTestResult = { version: string; databases: string[] };

/** A table or view inside a database (schema tree). */
export type TableInfo = { name: string; kind: "table" | "view" };

export type ColumnInfo = { name: string; dbType: string };

/** A query result set. Cells are `string | null` (null = SQL NULL). */
export type QueryResult = {
  columns: ColumnInfo[];
  rows: (string | null)[][];
  rowsAffected: number;
  truncated: boolean;
};

export type BrowseResult = { result: QueryResult; total: number };

/** SQL editor result. `total` is set only for paginated SELECTs. */
export type SqlResult = {
  result: QueryResult;
  total: number | null;
  paginated: boolean;
};

/** Page sizes offered in the DB grid (phpMyAdmin-style). */
export const PAGE_SIZES = [25, 50, 100, 500] as const;

/** One column of a database's schema (for SQL editor autocomplete). */
export type SchemaColumn = { table: string; name: string; dataType: string };

export type ColumnDef = {
  name: string;
  dataType: string;
  nullable: boolean;
  key: string; // "PRI" | "UNI" | "MUL" | ""
  default: string | null;
  extra: string;
  comment: string;
  /** Postgres enum columns: the enum type's values (so the UI can edit it as a
   *  guided enum). Null for non-enum columns and for MySQL (values are inline in
   *  dataType). */
  enumValues?: string[] | null;
};
export type IndexDef = { name: string; columns: string[]; unique: boolean };
export type ForeignKeyDef = {
  name: string;
  column: string;
  refTable: string;
  refColumn: string;
};
export type TableStructure = {
  columns: ColumnDef[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  primaryKey: string[];
};

export const DB_ENGINES: { id: DbEngine; label: string }[] = [
  { id: "mysql", label: "MySQL" },
  { id: "mariadb", label: "MariaDB" },
  { id: "postgres", label: "PostgreSQL" },
];

export function engineLabel(engine: DbEngine): string {
  return DB_ENGINES.find((e) => e.id === engine)?.label ?? engine;
}

export function defaultPortFor(engine: DbEngine): number {
  return engine === "postgres" ? 5432 : 3306;
}

/** All engines are supported (MySQL/MariaDB + PostgreSQL). */
export function engineSupported(_engine: DbEngine): boolean {
  return true;
}

/** True for the PostgreSQL engine (schema layer, "..." quoting). */
export function isPostgres(engine: DbEngine): boolean {
  return engine === "postgres";
}

export function createDbProfile(): DBProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    engine: "mysql",
    host: "127.0.0.1",
    port: 3306,
    dbUser: "root",
    password: "",
    defaultDatabase: "",
  };
}

/**
 * Connect a saved DB profile through the SSH session `sessionId` and return the
 * server version + database list. The password comes from the vault (keyed by
 * the profile id), falling back to any transient password on the object (freshly
 * typed and not yet saved).
 */
export async function dbConnect(
  sessionId: string,
  db: DBProfile,
): Promise<DbTestResult> {
  const password = db.password || (await secretGet(db.id).catch(() => null)) || "";
  return invoke<DbTestResult>("db_test_connect", {
    sessionId,
    host: db.host || "127.0.0.1",
    port: db.port || defaultPortFor(db.engine),
    user: db.dbUser,
    password,
    database: db.defaultDatabase || null,
  });
}

/**
 * Open a persistent DB session over the SSH session `sessionId` and return the
 * backend db-session id. The password is resolved from the vault (keyed by the
 * profile id), falling back to any transient password on the object.
 */
export async function dbOpen(sessionId: string, db: DBProfile): Promise<string> {
  const password = db.password || (await secretGet(db.id).catch(() => null)) || "";
  return invoke<string>("db_open", {
    sessionId,
    engine: db.engine,
    host: db.host || "127.0.0.1",
    port: db.port || defaultPortFor(db.engine),
    user: db.dbUser,
    password,
    database: db.defaultDatabase || null,
  });
}

/** `SHOW DATABASES` on a live DB session. */
export function dbListDatabases(dbSessionId: string): Promise<string[]> {
  return invoke<string[]>("db_list_databases", { dbSessionId });
}

/** Schemas in a Postgres database (empty for MySQL). */
export function dbListSchemas(dbSessionId: string, database: string): Promise<string[]> {
  return invoke<string[]>("db_list_schemas", { dbSessionId, database });
}

/** Tables + views in a database (Postgres also needs `schema`). */
export function dbListTables(
  dbSessionId: string,
  database: string,
  schema?: string,
): Promise<TableInfo[]> {
  return invoke<TableInfo[]>("db_list_tables", { dbSessionId, database, schema: schema ?? null });
}

/** All tables + columns of a database (for SQL editor autocomplete). */
export function dbSchema(dbSessionId: string, database: string): Promise<SchemaColumn[]> {
  return invoke<SchemaColumn[]>("db_schema", { dbSessionId, database });
}

/** Full structure of one table (columns, indexes, FKs, primary key). Postgres
 *  also needs `schema` (defaults to "public"); ignored for MySQL. */
export function dbTableStructure(
  dbSessionId: string,
  database: string,
  table: string,
  schema?: string,
): Promise<TableStructure> {
  return invoke<TableStructure>("db_table_structure", {
    dbSessionId,
    database,
    table,
    schema: schema ?? null,
  });
}

/** A column/value pair for a row mutation (value null = SQL NULL). */
export type CellValue = { column: string; value: string | null };

/** UPDATE one row (identified by `pk`) setting `changes`. Returns affected rows.
 *  Postgres also needs `schema` (defaults to "public"); ignored for MySQL. */
export function dbUpdateRow(
  dbSessionId: string,
  database: string,
  table: string,
  pk: CellValue[],
  changes: CellValue[],
  schema?: string,
): Promise<number> {
  return invoke<number>("db_update_row", { dbSessionId, database, table, pk, changes, schema: schema ?? null });
}

/** DELETE one row identified by `pk`. Returns affected rows. */
export function dbDeleteRow(
  dbSessionId: string,
  database: string,
  table: string,
  pk: CellValue[],
  schema?: string,
): Promise<number> {
  return invoke<number>("db_delete_row", { dbSessionId, database, table, pk, schema: schema ?? null });
}

/** INSERT a row with the given column values (others use DB defaults). */
export function dbInsertRow(
  dbSessionId: string,
  database: string,
  table: string,
  values: CellValue[],
  schema?: string,
): Promise<number> {
  return invoke<number>("db_insert_row", { dbSessionId, database, table, values, schema: schema ?? null });
}

/**
 * Export a database (or specific tables) to a local `.sql` via server-side
 * mysqldump (MySQL) or pg_dump (Postgres). Saves into the OS Downloads folder;
 * resolves to the saved path. `schema` qualifies table exports for Postgres.
 */
export function dbExportSql(
  dbSessionId: string,
  database: string,
  tables: string[],
  structureOnly: boolean,
  dataOnly: boolean,
  schema?: string,
): Promise<string> {
  return invoke<string>("db_export_sql", {
    dbSessionId,
    database,
    tables,
    structureOnly,
    dataOnly,
    schema: schema ?? null,
  });
}

/**
 * Import a `.sql` script into `database` via server-side `mysql` (streamed to
 * its stdin). Resolves on success; rejects with the mysql error otherwise.
 */
export function dbImportSql(
  dbSessionId: string,
  database: string,
  sql: string,
): Promise<void> {
  return invoke<void>("db_import_sql", { dbSessionId, database, sql });
}

/** DROP a table. Postgres also needs `schema` (defaults to "public"). */
export function dbDropTable(
  dbSessionId: string,
  database: string,
  table: string,
  schema?: string,
): Promise<void> {
  return invoke<void>("db_drop_table", { dbSessionId, database, table, schema: schema ?? null });
}

/** RENAME a table within its database. Postgres also needs `schema`. */
export function dbRenameTable(
  dbSessionId: string,
  database: string,
  oldName: string,
  newName: string,
  schema?: string,
): Promise<void> {
  return invoke<void>("db_rename_table", { dbSessionId, database, oldName, newName, schema: schema ?? null });
}

/** DROP an entire database. */
export function dbDropDatabase(dbSessionId: string, database: string): Promise<void> {
  return invoke<void>("db_drop_database", { dbSessionId, database });
}

/** "Rename" a database (create new, move tables, drop old). */
export function dbRenameDatabase(
  dbSessionId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  return invoke<void>("db_rename_database", { dbSessionId, oldName, newName });
}

/** Create a database. `charset`/`collation` are optional (MySQL: CHARACTER
 *  SET/COLLATE; PostgreSQL: `charset` = ENCODING). */
export function dbCreateDatabase(
  dbSessionId: string,
  name: string,
  charset?: string,
  collation?: string,
): Promise<void> {
  return invoke<void>("db_create_database", {
    dbSessionId,
    name,
    charset: charset || null,
    collation: collation || null,
  });
}

/** A column spec for creating a table. */
export type NewColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
  primaryKey: boolean;
  autoIncrement: boolean;
};

/** ADD a column to an existing table. Postgres also needs `schema`. `first`/
 *  `after` position the new column (MySQL/MariaDB only; Postgres appends). */
export function dbAddColumn(
  dbSessionId: string,
  database: string,
  table: string,
  column: NewColumn,
  schema?: string,
  first?: boolean,
  after?: string,
): Promise<void> {
  return invoke<void>("db_add_column", {
    dbSessionId,
    database,
    table,
    column,
    schema: schema ?? null,
    first: first ?? false,
    after: after ?? null,
  });
}

/** MODIFY a column (rename + redefine). `oldName` is the current name. */
export function dbModifyColumn(
  dbSessionId: string,
  database: string,
  table: string,
  oldName: string,
  column: NewColumn,
  schema?: string,
): Promise<void> {
  return invoke<void>("db_modify_column", {
    dbSessionId,
    database,
    table,
    oldName,
    column,
    schema: schema ?? null,
  });
}

/** DROP a column from a table. */
export function dbDropColumn(
  dbSessionId: string,
  database: string,
  table: string,
  column: string,
  schema?: string,
): Promise<void> {
  return invoke<void>("db_drop_column", { dbSessionId, database, table, column, schema: schema ?? null });
}

/** Create or extend a PostgreSQL ENUM type: creates `schema.name` if missing,
 *  else appends any new values (Postgres can't remove/rename values). Postgres-
 *  only; MySQL uses inline enum column types. */
export function dbApplyEnum(
  dbSessionId: string,
  database: string,
  schema: string | null,
  name: string,
  values: string[],
): Promise<void> {
  return invoke<void>("db_apply_enum", { dbSessionId, database, schema, name, values });
}

/** Create a table (schema used for Postgres, ignored for MySQL). */
export function dbCreateTable(
  dbSessionId: string,
  database: string,
  schema: string | null,
  table: string,
  columns: NewColumn[],
): Promise<void> {
  return invoke<void>("db_create_table", { dbSessionId, database, schema, table, columns });
}

/** Close a live DB session (disconnect pool + drop tunnel). Best-effort. */
export function dbClose(dbSessionId: string): Promise<void> {
  return invoke<void>("db_close", { dbSessionId }).catch(() => {});
}

/** Run arbitrary SQL (editor). `database` selects the schema (USE) first. Plain
 *  SELECTs are paginated by `page`/`pageSize` (pass pageSize 0 to run verbatim). */
export function dbRunSql(
  dbSessionId: string,
  sql: string,
  database: string | undefined,
  page: number,
  pageSize: number,
): Promise<SqlResult> {
  return invoke<SqlResult>("db_run_sql", {
    dbSessionId,
    sql,
    database: database || null,
    page,
    pageSize,
  });
}

/** Paginated browse of a single table (SELECT * window + total count). Postgres
 *  also needs `schema` (defaults to "public"); ignored for MySQL. */
export function dbBrowse(
  dbSessionId: string,
  database: string,
  table: string,
  limit: number,
  offset: number,
  schema?: string,
): Promise<BrowseResult> {
  return invoke<BrowseResult>("db_browse", {
    dbSessionId,
    database,
    table,
    limit,
    offset,
    schema: schema ?? null,
  });
}

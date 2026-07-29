// SQL autocomplete for the database SQL editor (phpMyAdmin-style).
//
// Monaco ships syntax highlighting for SQL but no completion provider, so we
// register one that suggests keywords + the active database's tables and
// columns. The "active schema" is set by the focused SQL editor via
// `setSqlSchema`, so switching DB tabs updates suggestions.

import type * as Monaco from "monaco-editor";
import type { SchemaColumn } from "./db";

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE",
  "BETWEEN", "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET", "AS", "ON",
  "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "UNION", "DISTINCT",
  "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "REPLACE INTO",
  "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW", "PRIMARY KEY",
  "FOREIGN KEY", "REFERENCES", "AUTO_INCREMENT", "DEFAULT", "UNSIGNED",
  "COUNT", "SUM", "AVG", "MIN", "MAX", "ASC", "DESC", "CASE", "WHEN", "THEN",
  "ELSE", "END", "EXISTS", "BINARY", "USE", "SHOW", "DESCRIBE", "EXPLAIN",
];

type Schema = { tables: string[]; columns: { name: string; detail: string }[] };

let current: Schema = { tables: [], columns: [] };
let registered = false;

/** Set the schema the completion provider suggests from (deduping columns by
 *  name across tables). Called by the focused SQL editor. */
export function setSqlSchema(cols: SchemaColumn[]): void {
  const tables = new Set<string>();
  const byName = new Map<string, { type: string; tables: Set<string> }>();
  for (const c of cols) {
    tables.add(c.table);
    const e = byName.get(c.name) ?? { type: c.dataType, tables: new Set<string>() };
    e.tables.add(c.table);
    byName.set(c.name, e);
  }
  current = {
    tables: [...tables],
    columns: [...byName].map(([name, { type, tables: ts }]) => ({
      name,
      detail: `${type} · ${ts.size > 1 ? `${ts.size} tables` : [...ts][0]}`,
    })),
  };
}

/** Register the SQL completion provider once on the given Monaco instance. */
export function registerSqlCompletion(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [" ", ".", "`"],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      const suggestions: Monaco.languages.CompletionItem[] = [];

      for (const kw of KEYWORDS) {
        suggestions.push({ label: kw, kind: K.Keyword, insertText: kw, range });
      }
      for (const t of current.tables) {
        suggestions.push({
          label: t,
          kind: K.Struct,
          insertText: t,
          range,
          detail: "table",
          sortText: `1_${t}`,
        });
      }
      for (const c of current.columns) {
        suggestions.push({
          label: c.name,
          kind: K.Field,
          insertText: c.name,
          range,
          detail: c.detail,
          sortText: `0_${c.name}`, // columns rank above tables/keywords
        });
      }
      return { suggestions };
    },
  });
}

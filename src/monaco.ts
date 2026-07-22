// Offline-safe Monaco setup for the Tauri app.
//
// `@monaco-editor/react` defaults to loading Monaco from a CDN (jsdelivr),
// which fails when the desktop app is offline. Here we bundle Monaco locally
// (`loader.config({ monaco })`) and wire its Web Workers through Vite's
// `?worker` imports so everything ships inside the app. Import this module
// once, at startup, before any `<Editor>` renders.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// NOTE: monaco-editor's `exports` map rewrites "./*" → "./esm/vs/*.js", so the
// worker paths must omit the "esm/vs/" prefix (adding it double-nests and fails
// to resolve). Vite strips the `?worker` query before this resolution runs.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

// Monaco reads workers off this global.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// Use the bundled Monaco instead of fetching from a CDN.
loader.config({ monaco });

/// Map a filename to a Monaco language id (best-effort; falls back to plaintext).
export function languageForFile(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    markdown: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    ini: "ini",
    conf: "ini",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    ps1: "powershell",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    java: "java",
    php: "php",
    sql: "sql",
    dockerfile: "dockerfile",
    env: "ini",
    log: "plaintext",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

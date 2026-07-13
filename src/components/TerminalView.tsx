import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "../settings";
import { getTheme } from "../themes";

/**
 * Opens a backend session and returns its id. The channel streams raw PTY/SSH
 * output bytes; `cols`/`rows` are the initial terminal size.
 */
export type OpenSession = (
  channel: Channel<number[]>,
  cols: number,
  rows: number,
) => Promise<string>;

/**
 * A single terminal pane: renders xterm.js and wires it to a backend session.
 * Keystrokes go out via `session_write`; output comes back over a Channel.
 * Reacts to live settings changes (font, theme) without tearing the session.
 */
export function TerminalView({ open }: { open: OpenSession }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const s = settingsRef.current;
    const term = new Terminal({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      cursorBlink: s.cursorBlink,
      theme: getTheme(s.themeName),
    });
    termRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(container);

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — xterm falls back to its canvas/DOM renderer.
    }

    fit.fit();

    let disposed = false;

    const channel = new Channel<number[]>();
    channel.onmessage = (bytes) => term.write(new Uint8Array(bytes));

    open(channel, term.cols, term.rows)
      .then((id) => {
        if (disposed) {
          void invoke("session_close", { id });
          return;
        }
        sessionIdRef.current = id;
        term.focus();
      })
      .catch((err) => term.writeln(`\r\n[moorix] failed to open session: ${err}`));

    const dataSub = term.onData((data) => {
      const id = sessionIdRef.current;
      if (!id) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      void invoke("session_write", { id, data: bytes });
    });

    const resizeObserver = new ResizeObserver(() => {
      // Skip while hidden (e.g. background tab) — the container has zero size.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fit.fit();
      const id = sessionIdRef.current;
      if (id) {
        void invoke("session_resize", { id, cols: term.cols, rows: term.rows });
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      dataSub.dispose();
      resizeObserver.disconnect();
      const id = sessionIdRef.current;
      if (id) void invoke("session_close", { id });
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionIdRef.current = null;
    };
  }, [open]);

  // Apply live settings changes to the running terminal.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = settings.fontSize;
    term.options.fontFamily = settings.fontFamily;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.theme = getTheme(settings.themeName);

    const container = containerRef.current;
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      fitRef.current?.fit();
      const id = sessionIdRef.current;
      if (id) {
        void invoke("session_resize", { id, cols: term.cols, rows: term.rows });
      }
    }
  }, [settings]);

  return <div ref={containerRef} className="h-full w-full" />;
}

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

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
 * The `open` prop decides whether it's a local shell or an SSH connection.
 */
export function TerminalView({ open }: { open: OpenSession }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#22d3ee",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — xterm falls back to its canvas/DOM renderer.
    }

    fit.fit();

    let sessionId: string | null = null;
    let disposed = false;

    const channel = new Channel<number[]>();
    channel.onmessage = (bytes) => term.write(new Uint8Array(bytes));

    open(channel, term.cols, term.rows)
      .then((id) => {
        if (disposed) {
          void invoke("session_close", { id });
          return;
        }
        sessionId = id;
        term.focus();
      })
      .catch((err) => term.writeln(`\r\n[moorix] failed to open session: ${err}`));

    const dataSub = term.onData((data) => {
      if (!sessionId) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      void invoke("session_write", { id: sessionId, data: bytes });
    });

    const resizeObserver = new ResizeObserver(() => {
      // Skip while hidden (e.g. background tab) — the container has zero size.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fit.fit();
      if (sessionId) {
        void invoke("session_resize", {
          id: sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      dataSub.dispose();
      resizeObserver.disconnect();
      if (sessionId) void invoke("session_close", { id: sessionId });
      term.dispose();
    };
  }, [open]);

  return <div ref={containerRef} className="h-full w-full" />;
}

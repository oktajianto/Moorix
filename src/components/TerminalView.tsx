import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "../settings";
import { getTheme } from "../themes";
import type { BackspaceMode, LoginScript } from "../profiles";

/**
 * Opens a backend session and returns its id. The channel streams raw PTY/SSH
 * output bytes; `cols`/`rows` are the initial terminal size.
 */
export type OpenSession = (
  channel: Channel<number[]>,
  cols: number,
  rows: number,
) => Promise<string>;

/** Per-session behaviour derived from an SSH profile. All optional — a local
 *  shell tab passes none and gets the global theme + default key handling. */
export type TermOptions = {
  /** Theme name that overrides the global theme for this session ("" = global). */
  colorScheme?: string;
  /** How the Backspace key is encoded (INPUT tab). */
  backspaceMode?: BackspaceMode;
  /** expect/send automation run against the output stream (LOGIN SCRIPTS tab). */
  loginScripts?: LoginScript[];
};

/** The byte sequence a given backspace mode should send, or null to keep
 *  xterm's default (DEL, 0x7f). */
function backspaceSeq(mode: BackspaceMode | undefined): string | null {
  switch (mode) {
    case "ctrl-h":
      return "\x08";
    case "delete":
      return "\x1b[3~";
    // "ctrl-?" is 0x7f, which is already xterm's default → keep default.
    case "ctrl-?":
    case "passthrough":
    default:
      return null;
  }
}

/** Strip the common ANSI/OSC escape sequences so expect-matching sees plain text. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function matchExpect(buffer: string, s: LoginScript): boolean {
  if (!s.expect) return false;
  if (s.mode === "regex") {
    try {
      return new RegExp(s.expect).test(buffer);
    } catch {
      return false;
    }
  }
  return buffer.includes(s.expect); // exact & optional both substring-match
}

/**
 * A single terminal pane: renders xterm.js and wires it to a backend session.
 * Keystrokes go out via `session_write`; output comes back over a Channel.
 * Reacts to live settings changes (font, theme) without tearing the session.
 * `options` applies per-profile color scheme, backspace mode, and login scripts.
 */
export function TerminalView({
  open,
  options,
}: {
  open: OpenSession;
  options?: TermOptions;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Per-profile options are fixed for the session; read via ref so live setting
  // changes don't re-run the setup effect and tear the session down.
  const optionsRef = useRef<TermOptions>(options ?? {});
  optionsRef.current = options ?? {};

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const s = settingsRef.current;
    const term = new Terminal({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      cursorBlink: s.cursorBlink,
      theme: getTheme(optionsRef.current.colorScheme || s.themeName),
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

    const sendData = (data: string) => {
      const id = sessionIdRef.current;
      if (!id) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      void invoke("session_write", { id, data: bytes });
    };

    // LOGIN SCRIPTS — expect/send automation over the output stream.
    const decoder = new TextDecoder();
    let loginBuf = "";
    let scriptIdx = 0;
    const runLoginScripts = (chunk: string) => {
      const scripts = optionsRef.current.loginScripts ?? [];
      if (scriptIdx >= scripts.length) return;
      loginBuf = stripAnsi(loginBuf + chunk).slice(-4096);
      for (let j = scriptIdx; j < scripts.length; j++) {
        const script = scripts[j];
        if (matchExpect(loginBuf, script)) {
          sendData(script.send + "\r");
          loginBuf = "";
          scriptIdx = j + 1;
          break;
        }
        // Optional steps may be skipped if a later step matches first; a
        // required step blocks until its prompt appears.
        if (script.mode !== "optional") break;
      }
    };

    const channel = new Channel<number[]>();
    channel.onmessage = (bytes) => {
      const arr = new Uint8Array(bytes);
      term.write(arr);
      if ((optionsRef.current.loginScripts?.length ?? 0) > 0) {
        runLoginScripts(decoder.decode(arr, { stream: true }));
      }
    };

    // INPUT — remap the Backspace key when the profile asks for it.
    term.attachCustomKeyEventHandler((e) => {
      if (
        e.type === "keydown" &&
        e.key === "Backspace" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        const seq = backspaceSeq(optionsRef.current.backspaceMode);
        if (seq !== null) {
          sendData(seq);
          return false; // handled — don't let xterm send the default
        }
      }
      return true;
    });

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

  // Apply live settings changes to the running terminal. A per-profile color
  // scheme keeps overriding the global theme.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = settings.fontSize;
    term.options.fontFamily = settings.fontFamily;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.theme = getTheme(optionsRef.current.colorScheme || settings.themeName);

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

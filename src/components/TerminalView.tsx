import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { useSettings, type Settings } from "../settings";
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
  /** Reopen the session automatically if it drops unexpectedly (SSH). */
  reconnect?: boolean;
};

type Ref<T> = { current: T };

/** The live xterm + backend session for one pane. It lives in the pool below,
 *  independent of React mount/unmount, so a pane survives being moved around
 *  the split tree (splitting re-parents its DOM instead of tearing it down). */
type PaneEntry = {
  term: Terminal;
  fit: FitAddon;
  sessionId: Ref<string | null>;
  options: Ref<TermOptions>;
  settings: Ref<Settings>;
  /** Full teardown: close session, stop the reconnect listener, dispose xterm. */
  dispose: () => void;
};

const POOL = new Map<string, PaneEntry>();

/**
 * Tear down a pane for good: close its backend session and dispose the
 * terminal. Called by App when a pane (or the tab holding it) is closed — never
 * on a plain React unmount, which may just be a re-parent during a split.
 */
export function disposePane(paneId: string): void {
  const entry = POOL.get(paneId);
  if (!entry) return;
  POOL.delete(paneId);
  entry.dispose();
}

/** Max auto-reconnect attempts before giving up on a dropped SSH session. */
const MAX_RECONNECT = 5;

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

/** Build the xterm + backend session for a brand-new pane and register it. */
function createEntry(
  paneId: string,
  open: OpenSession,
  options: TermOptions,
  settings: Settings,
  container: HTMLDivElement,
): PaneEntry {
  const sessionId: Ref<string | null> = { current: null };
  const optionsRef: Ref<TermOptions> = { current: options };
  const settingsRef: Ref<Settings> = { current: settings };

  const term = new Terminal({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    cursorBlink: settings.cursorBlink,
    theme: getTheme(optionsRef.current.colorScheme || settings.themeName),
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

  const sendData = (data: string) => {
    const id = sessionId.current;
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

  const dataSub = term.onData(sendData);

  // --- session lifecycle + auto-reconnect ---------------------------------
  let closedByUser = false;
  let attempts = 0;

  const startSession = () => {
    open(channel, term.cols, term.rows)
      .then((id) => {
        // The pane may have been closed while the session was opening.
        if (closedByUser || POOL.get(paneId) === undefined) {
          void invoke("session_close", { id });
          return;
        }
        sessionId.current = id;
        attempts = 0; // a successful connect resets the backoff
        // Login scripts re-run against the fresh session's output.
        loginBuf = "";
        scriptIdx = 0;
      })
      .catch((err) => {
        term.writeln(`\r\n[moorix] failed to open session: ${err}`);
        // Keep retrying only if we're already mid-reconnect (a dropped session).
        // An initial connect failure (bad host/credentials) is not auto-retried.
        if (attempts > 0 && optionsRef.current.reconnect && !closedByUser) {
          scheduleReconnect();
        }
      });
  };

  const scheduleReconnect = () => {
    if (closedByUser) return;
    if (attempts >= MAX_RECONNECT) {
      term.writeln(`\r\n[moorix] reconnect failed after ${MAX_RECONNECT} attempts.`);
      return;
    }
    attempts += 1;
    sessionId.current = null; // stop routing input to the dead session
    const delay = Math.min(1000 * 2 ** (attempts - 1), 15000);
    term.writeln(
      `\r\n[moorix] connection lost — reconnecting (${attempts}/${MAX_RECONNECT})…`,
    );
    setTimeout(() => {
      if (!closedByUser) startSession();
    }, delay);
  };

  // Backend fires `session-ended` when a session drops unexpectedly (not on a
  // user close). Reconnect only the pane whose current session id matches.
  let unlisten: (() => void) | null = null;
  void listen<{ id: string }>("session-ended", (e) => {
    if (e.payload.id !== sessionId.current) return;
    if (optionsRef.current.reconnect && !closedByUser) scheduleReconnect();
  }).then((un) => {
    if (closedByUser) un();
    else unlisten = un;
  });

  const dispose = () => {
    closedByUser = true;
    unlisten?.();
    dataSub.dispose();
    const id = sessionId.current;
    if (id) void invoke("session_close", { id });
    try {
      term.dispose();
    } catch {
      // already gone
    }
  };

  startSession();

  return {
    term,
    fit,
    sessionId,
    options: optionsRef,
    settings: settingsRef,
    dispose,
  };
}

/**
 * A single terminal pane: renders xterm.js and wires it to a backend session.
 * The heavy state (terminal + session) lives in the module pool keyed by
 * `paneId`, so re-parenting the pane within the split tree keeps the session
 * alive — only `disposePane` tears it down. Reacts to live settings changes.
 */
export function TerminalView({
  paneId,
  open,
  options,
}: {
  paneId: string;
  open: OpenSession;
  options?: TermOptions;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<PaneEntry | null>(null);

  const { settings } = useSettings();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let entry = POOL.get(paneId);
    if (!entry) {
      entry = createEntry(paneId, open, options ?? {}, settings, container);
      POOL.set(paneId, entry);
    } else if (entry.term.element && entry.term.element.parentElement !== container) {
      // Re-parent the existing terminal into the new container (e.g. after a
      // split moved this pane to a different spot in the tree).
      container.appendChild(entry.term.element);
    }
    entryRef.current = entry;

    const doFit = () => {
      // Skip while hidden (background tab / collapsed) — the container is 0-sized.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      entry!.fit.fit();
      const id = entry!.sessionId.current;
      if (id) {
        void invoke("session_resize", {
          id,
          cols: entry!.term.cols,
          rows: entry!.term.rows,
        });
      }
    };
    doFit();
    entry.term.focus();

    const resizeObserver = new ResizeObserver(doFit);
    resizeObserver.observe(container);

    // Only the observer is torn down here — the terminal/session stay alive in
    // the pool. Real teardown happens via disposePane() when the pane closes.
    return () => resizeObserver.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Apply live settings changes to the running terminal. A per-profile color
  // scheme keeps overriding the global theme.
  useEffect(() => {
    const entry = entryRef.current;
    if (!entry) return;
    entry.settings.current = settings;
    entry.options.current = options ?? {};

    const term = entry.term;
    term.options.fontSize = settings.fontSize;
    term.options.fontFamily = settings.fontFamily;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.theme = getTheme(
      entry.options.current.colorScheme || settings.themeName,
    );

    const container = containerRef.current;
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      entry.fit.fit();
      const id = entry.sessionId.current;
      if (id) {
        void invoke("session_resize", { id, cols: term.cols, rows: term.rows });
      }
    }
  }, [settings, options]);

  return <div ref={containerRef} className="h-full w-full" />;
}

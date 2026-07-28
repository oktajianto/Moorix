import { useEffect, useRef, useState } from "react";
import { Terminal, type FontWeight } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { TerminalSearch } from "./TerminalSearch";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import {
  useSettings,
  effectiveFontFamily,
  lineHeightOf,
  type Settings,
} from "../settings";
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
  serialize: SerializeAddon;
  search: SearchAddon;
  webgl: Ref<WebglAddon | null>;
  sessionId: Ref<string | null>;
  options: Ref<TermOptions>;
  settings: Ref<Settings>;
  /** Open the pane's Find bar. Registered by the mounted React component; null
   *  while the pane isn't mounted. Called via `openPaneSearch`. */
  openSearch: Ref<(() => void) | null>;
  /** Send text to the backend session (used by paste hotkeys). */
  write: (data: string) => void;
  /** Full teardown: close session, stop the reconnect listener, dispose xterm. */
  dispose: () => void;
};

const POOL = new Map<string, PaneEntry>();

/** Hotkey helpers acting on a specific pane's live terminal (from the pool). */
export function copyPane(paneId: string): void {
  const e = POOL.get(paneId);
  if (!e) return;
  const sel = e.term.getSelection();
  if (!sel) return;
  const text = e.settings.current.trimWhitespace ? sel.trim() : sel;
  if (!text) return;

  if (e.settings.current.copyFormatting) {
    const html = e.serialize.serializeAsHTML({ onlySelection: true });
    void navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]).catch(() => {});
  } else {
    void navigator.clipboard.writeText(text).catch(() => {});
  }
}
export function pastePane(paneId: string): void {
  const e = POOL.get(paneId);
  if (!e) return;
  void navigator.clipboard
    .readText()
    .then((t) => {
      if (t) e.write(t);
    })
    .catch(() => {});
}
export function clearPane(paneId: string): void {
  POOL.get(paneId)?.term.clear();
}
export function selectAllPane(paneId: string): void {
  POOL.get(paneId)?.term.selectAll();
}
/** Open the Find bar on a pane (Ctrl+F). No-op if the pane isn't mounted. */
export function openPaneSearch(paneId: string): void {
  POOL.get(paneId)?.openSearch.current?.();
}
/** The backend session id currently bound to a pane (null if not connected). */
export function paneSessionId(paneId: string): string | null {
  return POOL.get(paneId)?.sessionId.current ?? null;
}

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

/** Toggle ligatures on a terminal's DOM via font-feature-settings. Only the DOM
 *  renderer honours this; the WebGL renderer (used when ligatures are off) can't. */
function applyLigatures(term: Terminal, on: boolean): void {
  const el = term.element;
  if (el) el.style.fontFeatureSettings = on ? '"liga" 1, "calt" 1' : "normal";
}

/** Short beep via the Web Audio API for the "audible" terminal bell. */
function audibleBell(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 750;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {
    // No audio device / blocked — silently ignore.
  }
}

/** Wire mouse selection, right/middle-click paste, and the terminal bell.
 *  Behaviour is read live from `settingsRef` on each event so toggling a
 *  setting takes effect on already-open terminals. */
function attachTerminalBehaviors(
  term: Terminal,
  container: HTMLDivElement,
  settingsRef: Ref<Settings>,
  sendData: (data: string) => void,
): void {
  const copySelection = () => {
    const raw = term.getSelection();
    if (!raw) return;
    const text = settingsRef.current.trimWhitespace ? raw.trim() : raw;
    if (!text) return;

    if (settingsRef.current.copyFormatting) {
      // Find the serialize addon from POOL (since attachTerminalBehaviors doesn't have it).
      // Wait, we can pass serializeAddon to attachTerminalBehaviors or just find it.
      // Better yet, just find the pane entry from POOL. But we don't have paneId.
      // Let's find it by term.
      const entry = Array.from(POOL.values()).find((e) => e.term === term);
      if (entry) {
        const html = entry.serialize.serializeAsHTML({ onlySelection: true });
        void navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]).catch(() => {});
        return;
      }
    }
    void navigator.clipboard.writeText(text).catch(() => {});
  };

  const paste = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return; // clipboard read blocked
    }
    if (!text) return;
    if (settingsRef.current.replaceLineBreaks) text = text.replace(/\r?\n/g, " ");
    if (
      settingsRef.current.warnMultilinePaste &&
      /\r?\n/.test(text.replace(/\r?\n$/, "")) &&
      !window.confirm("Paste multiple lines into the terminal?")
    ) {
      return;
    }
    sendData(text);
  };

  // Copy on select.
  term.onSelectionChange(() => {
    if (settingsRef.current.copyOnSelect) copySelection();
  });

  // Right-click paste: when off, let the native context menu (copy/paste/…)
  // show; when on, paste — or copy if there's a selection.
  container.addEventListener("contextmenu", (e) => {
    if (!settingsRef.current.rightClickPaste) return; // native menu
    e.preventDefault();
    if (term.hasSelection()) copySelection();
    else void paste();
  });

  // Middle-click paste.
  container.addEventListener("mousedown", (e) => {
    if (e.button === 1 && settingsRef.current.pasteOnMiddleClick) {
      e.preventDefault();
      void paste();
    }
  });

  // Terminal bell: visual flash or audible beep.
  term.onBell(() => {
    const bell = settingsRef.current.bell;
    if (bell === "audible") {
      audibleBell();
    } else if (bell === "visual") {
      const el = term.element;
      if (el) {
        el.style.transition = "filter 60ms";
        el.style.filter = "invert(100%)";
        setTimeout(() => (el.style.filter = ""), 100);
      }
    }
  });
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
    // Search-match highlighting uses registerMarker/registerDecoration, which are
    // xterm "proposed API" — without this the SearchAddon throws on every search
    // (crashing the whole React tree → blank/black window).
    allowProposedApi: true,
    fontFamily: effectiveFontFamily(settings),
    fontSize: settings.fontSize,
    fontWeight: settings.normalFontWeight as FontWeight,
    fontWeightBold: settings.boldFontWeight as FontWeight,
    cursorBlink: settings.cursorBlink,
    cursorStyle: settings.cursorShape,
    minimumContrastRatio: settings.minimumContrastRatio,
    lineHeight: lineHeightOf(settings),
    scrollback: settings.scrollback,
    drawBoldTextInBrightColors: settings.boldBright,
    scrollOnUserInput: settings.scrollOnInput,
    macOptionIsMeta: settings.altIsMeta,
    wordSeparator: settings.wordSeparators,
    ignoreBracketedPasteMode: !settings.bracketedPaste,
    theme: getTheme(optionsRef.current.colorScheme || settings.themeName),
  });

  const fit = new FitAddon();
  const serialize = new SerializeAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(serialize);
  term.loadAddon(search);
  term.loadAddon(
    new WebLinksAddon((event: MouseEvent, uri: string) => {
      if (settingsRef.current.requireKeyToClickLinks && !event.ctrlKey && !event.metaKey) return;
      window.open(uri, "_blank");
    })
  );

  if (settings.sixel) {
    import("@xterm/addon-image").then(({ ImageAddon }) => {
      try {
        term.loadAddon(new ImageAddon());
      } catch {}
    }).catch(() => {});
  }
  term.open(container);

  // Renderer: WebGL is fast but rasterises glyphs individually, so it can't
  // shape ligatures — fall back to the DOM renderer when ligatures are on or the
  // user picked "dom". Renderer choice applies to newly opened terminals.
  const webglRef: Ref<WebglAddon | null> = { current: null };
  if (settings.rendererType === "webgl" && !settings.fontLigatures) {
    try {
      const w = new WebglAddon();
      term.loadAddon(w);
      webglRef.current = w;
    } catch {
      // WebGL unavailable — xterm falls back to its canvas/DOM renderer.
    }
  }
  applyLigatures(term, settings.fontLigatures);
  fit.fit();

  const sendData = (data: string) => {
    const id = sessionId.current;
    if (!id) return;
    const bytes = Array.from(new TextEncoder().encode(data));
    void invoke("session_write", { id, data: bytes });
  };

  // Mouse/clipboard/bell behaviours (copy-on-select, right/middle-click paste,
  // terminal bell). Reads live settings from settingsRef on each event.
  attachTerminalBehaviors(term, container, settingsRef, sendData);

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

  const entry: PaneEntry = {
    term,
    fit,
    serialize,
    search,
    webgl: webglRef,
    sessionId,
    options: optionsRef,
    settings: settingsRef,
    openSearch: { current: null },
    write: sendData,
    dispose,
  };

  return entry;
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
  const [searchOpen, setSearchOpen] = useState(false);
  // Bumped on every Ctrl+F so re-pressing while open re-focuses the Find input.
  const [searchSignal, setSearchSignal] = useState(0);

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

    // Expose "open Find bar" to the global hotkey dispatcher for this pane.
    // Re-opening while already open re-focuses the input (via the bumped signal).
    entry.openSearch.current = () => {
      setSearchOpen(true);
      setSearchSignal((n) => n + 1);
    };

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
    return () => {
      resizeObserver.disconnect();
      entry!.openSearch.current = null;
    };
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
    term.options.fontFamily = effectiveFontFamily(settings);
    term.options.fontWeight = settings.normalFontWeight as FontWeight;
    term.options.fontWeightBold = settings.boldFontWeight as FontWeight;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.cursorStyle = settings.cursorShape;
    term.options.minimumContrastRatio = settings.minimumContrastRatio;
    term.options.lineHeight = lineHeightOf(settings);
    term.options.scrollback = settings.scrollback;
    term.options.drawBoldTextInBrightColors = settings.boldBright;
    term.options.scrollOnUserInput = settings.scrollOnInput;
    term.options.macOptionIsMeta = settings.altIsMeta;
    applyLigatures(term, settings.fontLigatures);
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
    // 3. Renderer Switch
    const wantWebgl = settings.rendererType === "webgl" && !settings.fontLigatures;
    for (const entry of Array.from(POOL.values())) {
      const hasWebgl = entry.webgl.current !== null;
      if (wantWebgl && !hasWebgl) {
        try {
          const w = new WebglAddon();
          entry.term.loadAddon(w);
          entry.webgl.current = w;
        } catch {}
      } else if (!wantWebgl && hasWebgl) {
        entry.webgl.current?.dispose();
        entry.webgl.current = null;
      }
    }
  }, [settings, options]);

  const entry = entryRef.current;
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {searchOpen && entry && (
        <TerminalSearch
          key={paneId}
          term={entry.term}
          search={entry.search}
          openSignal={searchSignal}
          accent={accentColor()}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}

/** Current theme accent (`--m-accent`) for search-match highlighting. */
function accentColor(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--m-accent")
    .trim();
  return v || "#3b82f6";
}

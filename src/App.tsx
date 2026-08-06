import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/TitleBar";
import { HostKeyPrompt, type HostKeyReq } from "./components/HostKeyPrompt";
import {
  type OpenSession,
  type TermOptions,
  disposePane,
  copyPane,
  pastePane,
  clearPane,
  selectAllPane,
  openPaneSearch,
  paneSessionId,
} from "./components/TerminalView";
import { SftpPanel } from "./components/SftpPanel";
import { DbConnectTest } from "./components/DbConnectTest";
import { DbPicker } from "./components/DbPicker";
import { DatabasePanel } from "./components/DatabasePanel";
import { dbOpen, dbClose, type DBProfile } from "./db";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { eventToCombo, buildComboMap, isCapturingHotkey } from "./hotkeys";
import { Panes } from "./components/SplitPane";
import {
  makeLeaf,
  splitLeaf,
  closeLeaf,
  setSizesAtPath,
  firstLeaf,
  findLeaf,
  allLeaves,
  type PaneNode,
} from "./paneTree";
import { Launcher } from "./components/Launcher";
import { SettingsPage, type SectionId } from "./components/SettingsPage";
import { ProfileEditor } from "./components/ProfileEditor";
import { Welcome } from "./components/Welcome";
import { VaultUnlockModal } from "./components/VaultUnlockModal";
import { secretSet, secretDelete, setVaultUnlockHandler } from "./secrets";
import { unlock as vaultUnlock } from "./vault";
import { useSettings, DEFAULT_SETTINGS } from "./settings";
import { useToast } from "./components/Toast";
import { checkForUpdates } from "./updater";
import { runAutoBackups, syncTrayMode } from "./backupDb";
import { getTheme, isLightTheme } from "./themes";
import {
  AVAILABLE_BUILTINS,
  createNewProfile,
  cloneProfile,
  localOpen,
  serialOpen,
  telnetOpen,
  sshOpenFromProfile,
  termOptionsOf,
  setLocalShellDefaults,
  type Profile,
  type TabDesc,
  type UserProfile,
} from "./profiles";
import { IS_MOBILE } from "./platform";

type EditorIntent =
  | { mode: "save"; initial: UserProfile; initialTab?: "databases" }
  | { mode: "connect-tab"; initial: UserProfile; tabId: string }
  | { mode: "connect-new"; initial: UserProfile };

const profileLabel = (p: UserProfile) => {
  if (p.name) return p.name;
  if (p.type === "ssh" && p.ssh) return `${p.ssh.username}@${p.ssh.host}`;
  if (p.type === "telnet" && p.telnet) return p.telnet.host;
  if (p.type === "serial" && p.serial) return p.serial.path;
  return "Unknown Profile";
};
import { getStore, setValue } from "./store";
import { scheduleAutoPush } from "./cloudSync";

type Tab =
  | { id: string; kind: "launcher" }
  | { id: string; kind: "terminal"; root: PaneNode; desc?: TabDesc }
  | { id: string; kind: "settings" }
  | { id: string; kind: "db"; dbSessionId: string; sshSessionId: string; title: string; engine: string };

/** Rebuild an OpenSession + label from a persisted tab descriptor. Returns null
 *  if the referenced SSH profile no longer exists. */
function openFromDesc(
  d: TabDesc,
  profiles: UserProfile[],
): { open: OpenSession; label: string; options?: TermOptions } | null {
  switch (d.t) {
    case "local":
      return { open: localOpen(d.command), label: d.label };
    case "serial":
      return { open: serialOpen(d.path, d.baud), label: `serial ${d.path}` };
    case "telnet":
      return { open: telnetOpen(d.host, d.port), label: `${d.host}:${d.port}` };
    case "ssh": {
      const p = profiles.find((x) => x.id === d.profileId);
      if (!p) return null;
      return {
        open: sshOpenFromProfile(p),
        label: p.name || `${p.ssh.username}@${p.ssh.host}`,
        options: termOptionsOf(p),
      };
    }
  }
}

let counter = 1;
const nextId = () => `tab-${counter++}`;

const FIRST_ID = "tab-0";
const WELCOME_KEY = "moorix.welcomed";

function App() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const [tabs, setTabs] = useState<Tab[]>([{ id: FIRST_ID, kind: "launcher" }]);
  const [activeId, setActiveId] = useState(FIRST_ID);
  const [activePaneId, setActivePaneId] = useState("");
  const [defaultProfileId, setDefaultProfileId] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [editor, setEditor] = useState<EditorIntent | null>(null);
  const [settingsReq, setSettingsReq] = useState<{ section: SectionId; token: number }>({
    section: "application",
    token: 0,
  });
  const [sftpTabs, setSftpTabs] = useState<Record<string, string>>({});
  const [sftpWidths, setSftpWidths] = useState<Record<string, number>>({});
  // Fase 20A-1: pane whose manual DB quick-connect dialog is open (null = none).
  const [dbTestPane, setDbTestPane] = useState<string | null>(null);
  // Fase 20A-2: pane whose DB picker is open, with its SSH profile id (if saved).
  const [dbPicker, setDbPicker] = useState<{ paneId: string; profileId: string | null } | null>(null);
  const [hostKeyReqs, setHostKeyReqs] = useState<HostKeyReq[]>([]);
  const [mismatch, setMismatch] = useState<{ host: string; fingerprint: string } | null>(null);
  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem(WELCOME_KEY),
  );

  // Vault unlock gate: `secretGet/Set` call the registered handler when a secret
  // is needed while the vault is locked. Pending callers queue on resolvers and
  // are settled together when the modal is submitted or cancelled.
  const [showVaultUnlock, setShowVaultUnlock] = useState(false);
  const vaultResolvers = useRef<((ok: boolean) => void)[]>([]);
  useEffect(() => {
    setVaultUnlockHandler(
      () =>
        new Promise<boolean>((resolve) => {
          vaultResolvers.current.push(resolve);
          setShowVaultUnlock(true);
        }),
    );
    return () => setVaultUnlockHandler(null);
  }, []);
  const settleVaultUnlock = (ok: boolean) => {
    const rs = vaultResolvers.current;
    vaultResolvers.current = [];
    setShowVaultUnlock(false);
    rs.forEach((r) => r(ok));
  };

  useEffect(() => {
    document.documentElement.classList.toggle(
      "light",
      isLightTheme(settings.themeName),
    );
  }, [settings.themeName]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-animations", !settings.animations);
  }, [settings.animations]);

  // Window → frame: "custom" uses the frameless title bar (decorations off);
  // "native" hands the frame back to the OS.
  useEffect(() => {
    void getCurrentWindow()
      .setDecorations(settings.windowFrame === "native")
      .catch(() => {});
  }, [settings.windowFrame]);

  // Window → always on top.
  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(settings.alwaysOnTop).catch(() => {});
  }, [settings.alwaysOnTop]);

  // Shell → default shell + working directory applied to every local terminal.
  useEffect(() => {
    setLocalShellDefaults({ shell: settings.defaultShell, cwd: settings.shellWorkingDir });
  }, [settings.defaultShell, settings.shellWorkingDir]);

  // Track recently-launched profiles (most recent first, capped) for the
  // quick-launch palette's "Recent" section.
  const recordRecent = (id: string) =>
    update({
      recentProfiles: [id, ...settings.recentProfiles.filter((x) => x !== id)].slice(0, 20),
    });

  // Appearance → Custom CSS: inject/update a single global <style> element.
  useEffect(() => {
    const id = "moorix-custom-css";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = settings.customCSS;
  }, [settings.customCSS]);

  // Startup auto-update: silently check GitHub Releases; only surfaces a toast
  // if an update is actually found (then downloads + installs quietly).
  useEffect(() => {
    if (settings.autoUpdate) void checkForUpdates(toast, { silent: true });
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const p1 = listen<HostKeyReq>("host-key-prompt", (e) =>
      setHostKeyReqs((prev) =>
        prev.some((r) => r.id === e.payload.id) ? prev : [...prev, e.payload],
      ),
    );
    const p2 = listen<{ host: string; fingerprint: string }>(
      "host-key-mismatch",
      (e) => setMismatch(e.payload),
    );
    const p3 = listen<{ kind: string; bind: string; message: string }>(
      "forward-error",
      (e) =>
        toast.show({
          variant: "error",
          title: `Port forward failed (${e.payload.kind})`,
          message: `${e.payload.bind}: ${e.payload.message}`,
          duration: 6000,
        }),
    );
    return () => {
      void p1.then((un) => un());
      void p2.then((un) => un());
      void p3.then((un) => un());
    };
  }, []);

  const decideHostKey = (accept: boolean) => {
    const req = hostKeyReqs[0];
    if (req) void invoke("host_key_decision", { id: req.id, accept }).catch(() => {});
    setHostKeyReqs((prev) => prev.slice(1));
  };

  const bootedRef = useRef(false);

  useEffect(() => {
    getStore()
      .then(async (s) => {
        const def = await s.get<string>("defaultProfileId");
        if (typeof def === "string") setDefaultProfileId(def);
        const g = await s.get<string[]>("profileGroups");
        if (Array.isArray(g)) setGroups(g);
        const up = await s.get<UserProfile[]>("userProfiles");
        const profiles = Array.isArray(up) ? up : [];
        if (Array.isArray(up)) setUserProfiles(up);

        // Startup: restore saved terminal tabs, else optionally auto-open a
        // local shell. Both replace the initial launcher tab.
        const saved = await s.get<TabDesc[]>("openTabs");
        if (settings.restoreTabs && Array.isArray(saved) && saved.length > 0) {
          const restored: Tab[] = [];
          let firstPaneId = "";
          for (const d of saved) {
            const built = openFromDesc(d, profiles);
            if (!built) continue;
            const leaf = makeLeaf(built.label, built.open, built.options);
            if (!firstPaneId) firstPaneId = leaf.paneId;
            restored.push({ id: nextId(), kind: "terminal", root: leaf, desc: d });
          }
          if (restored.length > 0) {
            localStorage.setItem(WELCOME_KEY, "1");
            setShowWelcome(false);
            setTabs(restored);
            setActiveId(restored[0].id);
            setActivePaneId(firstPaneId);
          }
        } else if (settings.autoOpenTerminal && !IS_MOBILE) {
          localStorage.setItem(WELCOME_KEY, "1");
          setShowWelcome(false);
          const id = nextId();
          const leaf = makeLeaf("local shell", localOpen(""));
          setTabs([
            { id, kind: "terminal", root: leaf, desc: { t: "local", command: "", label: "local shell" } },
          ]);
          setActiveId(id);
          setActivePaneId(leaf.paneId);
        }

        // Auto-Backup DB (Fase 23C): start the runner once, fire-and-forget. It
        // prunes stale markers, then (if enabled) waits an initial delay and runs
        // due jobs sequentially with progress toasts.
        void runAutoBackups(profiles, toast);
        // Tray mode (Fase 23D-2): close/minimize → hide-to-tray when auto-backup
        // or autostart is on.
        void syncTrayMode();
      })
      .catch(() => {})
      .finally(() => {
        bootedRef.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the set of open terminal tabs so "Restore terminal tabs" can reopen
  // them next launch. Held back until startup finishes so we don't clobber the
  // saved list with the initial (empty) tab set.
  useEffect(() => {
    if (!bootedRef.current) return;
    const descs = tabs.flatMap((t) =>
      t.kind === "terminal" && t.desc ? [t.desc] : [],
    );
    void setValue("openTabs", descs).catch(() => {});
  }, [tabs]);

  const persistProfiles = (list: UserProfile[]) => {
    setUserProfiles(list);
    void setValue("userProfiles", list).catch(() => {});
    scheduleAutoPush();
  };

  const saveProfile = (p: UserProfile) => {
    // Never persist the plaintext password in the store — put it in the OS keychain.
    const password = p.ssh.password;
    // DB child passwords are vault-backed too (keyed by each DB profile id) and
    // stripped from the stored profile, same as the SSH password.
    const dbs = p.databases ?? [];
    const storedDbs = dbs.map((d) => ({ ...d, password: "" }));
    const stored: UserProfile = {
      ...p,
      ssh: { ...p.ssh, password: "" },
      databases: storedDbs,
    };
    const exists = userProfiles.some((x) => x.id === p.id);
    persistProfiles(
      exists
        ? userProfiles.map((x) => (x.id === p.id ? stored : x))
        : [...userProfiles, stored],
    );
    if (password) {
      void secretSet(p.id, password).catch(() => {});
    }
    for (const d of dbs) {
      // Only write when a new password was typed; blank keeps the vault entry.
      if (d.password) void secretSet(d.id, d.password).catch(() => {});
    }
  };

  const deleteProfile = (id: string) => {
    const gone = userProfiles.find((x) => x.id === id);
    persistProfiles(userProfiles.filter((x) => x.id !== id));
    void secretDelete(id).catch(() => {});
    for (const d of gone?.databases ?? []) {
      void secretDelete(d.id).catch(() => {});
    }
  };

  const setDefaultProfile = (id: string) => {
    setDefaultProfileId(id);
    void setValue("defaultProfileId", id).catch(() => {});
    scheduleAutoPush();
  };

  const addGroup = (name: string) => {
    if (groups.includes(name)) return;
    const next = [...groups, name];
    setGroups(next);
    void setValue("profileGroups", next).catch(() => {});
    scheduleAutoPush();
  };

  const deleteGroup = (name: string) => {
    const next = groups.filter((g) => g !== name);
    setGroups(next);
    void setValue("profileGroups", next).catch(() => {});
    scheduleAutoPush();
    // Move any profiles in that group back to Ungrouped (don't delete them).
    if (userProfiles.some((p) => p.group === name)) {
      persistProfiles(
        userProfiles.map((p) =>
          p.group === name ? { ...p, group: "Ungrouped" } : p,
        ),
      );
    }
  };

  const dismissWelcome = () => {
    localStorage.setItem(WELCOME_KEY, "1");
    setShowWelcome(false);
  };

  const openTerminalTab = (
    open: OpenSession,
    label: string,
    options?: TermOptions,
    desc?: TabDesc,
  ) => {
    dismissWelcome();
    const id = nextId();
    const leaf = makeLeaf(label, open, options);
    setTabs((prev) => [...prev, { id, kind: "terminal", root: leaf, desc }]);
    setActiveId(id);
    setActivePaneId(leaf.paneId);
  };

  const launchProfile = (p: Profile) => {
    if (p.type === "local" && p.command) {
      recordRecent(p.id);
      openTerminalTab(localOpen(p.command), p.name, undefined, {
        t: "local",
        command: p.command,
        label: p.name,
      });
    } else {
      // Built-in "SSH connection" → open the SSH editor, connect on save.
      dismissWelcome();
      setEditor({ mode: "connect-new", initial: createNewProfile("Ungrouped", "ssh") });
    }
  };

  const launchUserProfile = (p: UserProfile) => {
    recordRecent(p.id);
    let opener;
    let desc: TabDesc;
    if (p.type === "serial" && p.serial) {
      opener = serialOpen(p.serial.path, p.serial.baud);
      desc = { t: "serial", path: p.serial.path, baud: p.serial.baud };
    } else if (p.type === "telnet" && p.telnet) {
      opener = telnetOpen(p.telnet.host, p.telnet.port);
      desc = { t: "telnet", host: p.telnet.host, port: p.telnet.port };
    } else {
      opener = sshOpenFromProfile(p);
      desc = { t: "ssh", profileId: p.id };
    }
    openTerminalTab(opener, profileLabel(p), termOptionsOf(p), desc);
  };

  const newTab = () => {
    const def = AVAILABLE_BUILTINS.find((p) => p.id === defaultProfileId);
    if (def) {
      launchProfile(def);
      return;
    }
    dismissWelcome();
    const id = nextId();
    setTabs((prev) => [...prev, { id, kind: "launcher" }]);
    setActiveId(id);
  };

  const openSettings = (section: SectionId = "application") => {
    dismissWelcome();
    // Bump the token so SettingsPage always jumps to the requested section,
    // even when the Settings tab is already open.
    setSettingsReq((r) => ({ section, token: r.token + 1 }));
    const existing = tabs.find((t) => t.kind === "settings");
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const id = nextId();
    setTabs((prev) => [...prev, { id, kind: "settings" }]);
    setActiveId(id);
  };

  const launchInTab =
    (tabId: string) =>
    (open: OpenSession, label: string, options?: TermOptions, desc?: TabDesc) => {
      dismissWelcome();
      const leaf = makeLeaf(label, open, options);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId ? { id: tabId, kind: "terminal", root: leaf, desc } : tab,
        ),
      );
      setActivePaneId(leaf.paneId);
    };

  // --- Split-pane operations (within a terminal tab) ---------------------------

  const splitPane = (tabId: string, paneId: string, dir: "row" | "col") => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "terminal") return;
    const leaf = findLeaf(tab.root, paneId);
    if (!leaf) return;
    // A split duplicates the pane's profile: reuse its open closure + options,
    // spawning a fresh independent backend session.
    const clone = makeLeaf(leaf.label, leaf.open, leaf.options);
    const root = splitLeaf(tab.root, paneId, dir, clone);
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...tab, root } : t)));
    setActivePaneId(clone.paneId);
  };

  const closePane = (tabId: string, paneId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "terminal") return;
    const root = closeLeaf(tab.root, paneId);
    if (!root) {
      closeTab(tabId); // last pane closed → close the whole tab (disposes it)
      return;
    }
    disposePane(paneId); // free the removed pane's session/terminal
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...tab, root } : t)));
    if (activePaneId === paneId) setActivePaneId(firstLeaf(root).paneId);
  };

  const resizePane = (tabId: string, path: number[], sizes: number[]) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId && t.kind === "terminal"
          ? { ...t, root: setSizesAtPath(t.root, path, sizes) }
          : t,
      ),
    );
  };

  // --- SFTP file manager panel (per SSH tab) ----------------------------------

  const openSftpForPane = (tabId: string, paneId: string) => {
    const sid = paneSessionId(paneId);
    if (!sid) return; // session not connected yet
    setSftpTabs((m) => ({ ...m, [tabId]: sid }));
  };

  const closeSftp = (tabId: string) =>
    setSftpTabs((m) => {
      if (!(tabId in m)) return m;
      const next = { ...m };
      delete next[tabId];
      return next;
    });

  // --- Database manager (Fase 20A-3) -----------------------------------------

  /** Open a persistent DB session on the pane's SSH connection and add a
   *  Database tab bound to it. Throws (surfaced by the picker) on failure. */
  const openDbTab = async (paneId: string, db: DBProfile) => {
    const sid = paneSessionId(paneId);
    if (!sid) throw new Error("No active SSH session on this pane.");
    const dbSessionId = await dbOpen(sid, db);
    const id = nextId();
    setTabs((prev) => [
      ...prev,
      { id, kind: "db", dbSessionId, sshSessionId: sid, title: db.name || "Database", engine: db.engine },
    ]);
    setActiveId(id);
  };

  // Drag the divider between the terminal and the SFTP panel (panel is on the
  // right, so dragging left widens it). Width is kept per tab.
  const startSftpResize = (e: React.PointerEvent, tabId: string) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sftpWidths[tabId] ?? settings.sftpWidth ?? 440;
    let lastW = startW;
    const move = (ev: PointerEvent) => {
      lastW = Math.max(300, Math.min(900, startW - (ev.clientX - startX)));
      setSftpWidths((m) => ({ ...m, [tabId]: lastW }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      // Remember the last width as the default for future SFTP panels / restarts.
      update({ sftpWidth: Math.round(lastW) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const selectTab = (id: string) => {
    setActiveId(id);
    const tab = tabs.find((t) => t.id === id);
    if (tab?.kind === "terminal" && !findLeaf(tab.root, activePaneId)) {
      setActivePaneId(firstLeaf(tab.root).paneId);
    }
  };

  const onEditorSave = (p: UserProfile) => {
    saveProfile(p);
    if (editor?.mode === "connect-tab") {
      launchInTab(editor.tabId)(sshOpenFromProfile(p), profileLabel(p), termOptionsOf(p), {
        t: "ssh",
        profileId: p.id,
      });
    } else if (editor?.mode === "connect-new") {
      openTerminalTab(sshOpenFromProfile(p), profileLabel(p), termOptionsOf(p), {
        t: "ssh",
        profileId: p.id,
      });
    }
    setEditor(null);
  };

  const closeTab = (id: string) => {
    const closing = tabs.find((t) => t.id === id);
    if (closing?.kind === "terminal") {
      for (const leaf of allLeaves(closing.root)) disposePane(leaf.paneId);
    }
    if (closing?.kind === "db") {
      void dbClose(closing.dbSessionId);
    }
    closeSftp(id);
    const idx = tabs.findIndex((t) => t.id === id);
    let next = tabs.filter((t) => t.id !== id);
    if (next.length === 0) {
      // Window → "Close the window after closing the last tab".
      if (settings.closeOnLastTab) {
        void getCurrentWindow().close();
        return;
      }
      next = [{ id: nextId(), kind: "launcher" }];
    }
    setTabs(next);
    if (id === activeId) {
      const fallback = next[Math.min(idx, next.length - 1)];
      setActiveId(fallback.id);
    }
  };

  const labelOf = (t: Tab) =>
    t.kind === "terminal"
      ? (findLeaf(t.root, activePaneId) ?? firstLeaf(t.root)).label
      : t.kind === "settings"
        ? "Settings"
        : t.kind === "db"
          ? t.title
          : "New tab";

  // --- Global hotkeys -------------------------------------------------------
  // `runAction` is rebuilt every render so it closes over fresh state; the
  // keydown listener reads it through a ref and only re-attaches when bindings
  // change.
  const runAction = (id: string) => {
    const activeTab = tabs.find((t) => t.id === activeId);
    const inTerminal = activeTab?.kind === "terminal";
    const clampFont = (n: number) => Math.min(48, Math.max(6, n));
    switch (id) {
      case "copy": copyPane(activePaneId); break;
      case "paste": pastePane(activePaneId); break;
      case "select-all": selectAllPane(activePaneId); break;
      case "clear": clearPane(activePaneId); break;
      case "find": openPaneSearch(activePaneId); break;
      case "zoom-in": update({ fontSize: clampFont(settings.fontSize + 1) }); break;
      case "zoom-out": update({ fontSize: clampFont(settings.fontSize - 1) }); break;
      case "reset-zoom": update({ fontSize: DEFAULT_SETTINGS.fontSize }); break;
      case "new-tab": newTab(); break;
      case "close-tab": closeTab(activeId); break;
      case "next-tab":
      case "previous-tab": {
        if (tabs.length < 2) break;
        const idx = tabs.findIndex((t) => t.id === activeId);
        const delta = id === "next-tab" ? 1 : -1;
        const next = tabs[(idx + delta + tabs.length) % tabs.length];
        selectTab(next.id);
        break;
      }
      case "settings": openSettings(); break;
      case "toggle-fullscreen": {
        const w = getCurrentWindow();
        void w.isFullscreen().then((f) => w.setFullscreen(!f)).catch(() => {});
        break;
      }
      case "split-right": if (inTerminal) splitPane(activeId, activePaneId, "row"); break;
      case "split-bottom": if (inTerminal) splitPane(activeId, activePaneId, "col"); break;
      case "close-pane": if (inTerminal) closePane(activeId, activePaneId); break;
      default: {
        const m = /^tab-([1-9])$/.exec(id);
        if (m) {
          const t = tabs[Number(m[1]) - 1];
          if (t) selectTab(t.id);
        }
      }
    }
  };
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;

  useEffect(() => {
    const map = buildComboMap(settings.hotkeys);
    const onKey = (e: KeyboardEvent) => {
      if (isCapturingHotkey()) return;
      // Let real form fields type normally, but keep hotkeys live in the
      // terminal (xterm's own input is a `.xterm-helper-textarea`).
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
      if (editable && !el?.classList.contains("xterm-helper-textarea")) return;

      const combo = eventToCombo(e);
      if (!combo) return;
      const action = map.get(combo);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      runActionRef.current(action);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [settings.hotkeys]);

  const bg = getTheme(settings.themeName).background ?? "#0a0a0a";

  return (
    <div
      className="flex h-screen flex-col"
      style={{ background: "var(--m-bg)", color: "var(--m-text)" }}
    >
      <TitleBar
        tabs={tabs.map((t) => ({ id: t.id, label: labelOf(t) }))}
        activeId={activeId}
        onSelect={selectTab}
        onClose={closeTab}
        onNewTab={newTab}
        onOpenSettings={() => openSettings("application")}
        onLaunchProfile={launchProfile}
        onManageProfiles={() => openSettings("profiles")}
        userProfiles={userProfiles}
        onLaunchUserProfile={launchUserProfile}
        onOpenAccount={() => openSettings("account")}
      />

      <main className="relative min-h-0 flex-1" style={{ background: bg }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${tab.kind === "terminal" ? "p-1.5" : ""}`}
            style={{
              display:
                tab.id === activeId
                  ? tab.kind === "terminal"
                    ? "flex"
                    : "block"
                  : "none",
            }}
          >
            {tab.kind === "launcher" ? (
              <Launcher
                onLaunch={launchInTab(tab.id)}
                onSshConnection={() =>
                  setEditor({
                    mode: "connect-tab",
                    initial: createNewProfile("Ungrouped", "ssh"),
                    tabId: tab.id,
                  })
                }
              />
            ) : tab.kind === "db" ? (
              <DatabasePanel dbSessionId={tab.dbSessionId} title={tab.title} engine={tab.engine} />
            ) : tab.kind === "settings" ? (
              <SettingsPage
                sectionRequest={settingsReq}
                onLaunchProfile={launchProfile}
                defaultProfileId={defaultProfileId}
                onSetDefaultProfile={setDefaultProfile}
                groups={groups}
                onAddGroup={addGroup}
                onDeleteGroup={deleteGroup}
                userProfiles={userProfiles}
                onLaunchUserProfile={launchUserProfile}
                onNewProfile={(type) =>
                  setEditor({ mode: "save", initial: createNewProfile("Ungrouped", type || "ssh") })
                }
                onEditProfile={(p) => setEditor({ mode: "save", initial: p })}
                onDuplicateProfile={(p) =>
                  setEditor({ mode: "save", initial: cloneProfile(p) })
                }
                onDeleteProfile={deleteProfile}
              />
            ) : (
              <div className="flex h-full w-full min-h-0">
                <div className="flex min-w-0 flex-1">
                  <Panes
                    node={tab.root}
                    activePaneId={activePaneId}
                    onFocusPane={setActivePaneId}
                    onSplit={(paneId, dir) => splitPane(tab.id, paneId, dir)}
                    onClosePane={(paneId) => closePane(tab.id, paneId)}
                    onResize={(path, sizes) => resizePane(tab.id, path, sizes)}
                    focusFollowsMouse={settings.focusFollowsMouse}
                    isSsh={tab.desc?.t === "ssh"}
                    onOpenSftp={(paneId) => openSftpForPane(tab.id, paneId)}
                    onOpenDb={(paneId) =>
                      setDbPicker({
                        paneId,
                        profileId: tab.desc?.t === "ssh" ? tab.desc.profileId : null,
                      })
                    }
                  />
                </div>
                {sftpTabs[tab.id] && (
                  <>
                    <div
                      onPointerDown={(e) => startSftpResize(e, tab.id)}
                      className="w-1.5 shrink-0 cursor-col-resize"
                      style={{ background: "var(--m-border)" }}
                    />
                    <div className="shrink-0" style={{ width: sftpWidths[tab.id] ?? settings.sftpWidth ?? 440 }}>
                      <SftpPanel
                        sessionId={sftpTabs[tab.id]}
                        onClose={() => closeSftp(tab.id)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {showWelcome && <Welcome onClose={dismissWelcome} />}
        {dbPicker && (
          <DbPicker
            paneId={dbPicker.paneId}
            profile={userProfiles.find((u) => u.id === dbPicker.profileId) ?? null}
            onClose={() => setDbPicker(null)}
            onConnect={async (db) => {
              await openDbTab(dbPicker.paneId, db);
              setDbPicker(null);
            }}
            onQuickConnect={() => {
              setDbTestPane(dbPicker.paneId);
              setDbPicker(null);
            }}
            onManage={
              dbPicker.profileId
                ? () => {
                    const prof = userProfiles.find((u) => u.id === dbPicker.profileId);
                    if (prof) setEditor({ mode: "save", initial: prof, initialTab: "databases" });
                    setDbPicker(null);
                  }
                : null
            }
          />
        )}
        {dbTestPane && (
          <DbConnectTest paneId={dbTestPane} onClose={() => setDbTestPane(null)} />
        )}
      </main>

      {editor && (
        <ProfileEditor
          initial={editor.initial}
          initialTab={editor.mode === "save" ? editor.initialTab : undefined}
          groups={groups}
          userProfiles={userProfiles}
          onSave={onEditorSave}
          onCancel={() => setEditor(null)}
        />
      )}

      {hostKeyReqs[0] && (
        <HostKeyPrompt req={hostKeyReqs[0]} onDecision={decideHostKey} />
      )}

      {showVaultUnlock && (
        <VaultUnlockModal
          onSubmit={async (master) => {
            const ok = await vaultUnlock(master);
            if (ok) settleVaultUnlock(true);
            return ok;
          }}
          onCancel={() => settleVaultUnlock(false)}
        />
      )}

      {mismatch && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-md rounded-xl border p-6"
            style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
          >
            <h2 className="mb-2 text-lg font-semibold text-red-400">
              ⚠ Host key changed
            </h2>
            <p className="text-sm" style={{ color: "var(--m-text)" }}>
              The host key for <b>{mismatch.host}</b> does not match the one saved
              earlier. The connection was rejected — this may indicate a
              man-in-the-middle attack.
            </p>
            <p className="mt-2 break-all text-xs" style={{ color: "var(--m-muted)" }}>
              New fingerprint: {mismatch.fingerprint}
            </p>
            <p className="mt-3 text-xs" style={{ color: "var(--m-muted)" }}>
              If you rebuilt this server or its IP was reassigned, this is
              expected — choose <b>Trust new key</b>, then reconnect. Only do this
              if you recognise the server.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setMismatch(null)}
                className="rounded-md bg-neutral-700 px-4 py-2 text-sm text-white transition hover:bg-neutral-600"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  await invoke("trust_host_key", {
                    host: mismatch.host,
                    fingerprint: mismatch.fingerprint,
                  }).catch(() => {});
                  setMismatch(null);
                  window.alert("New host key saved. Reconnect to continue.");
                }}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white transition hover:bg-blue-500"
              >
                Trust new key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

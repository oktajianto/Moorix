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
  paneSessionId,
} from "./components/TerminalView";
import { SftpPanel } from "./components/SftpPanel";
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
import { useSettings, DEFAULT_SETTINGS } from "./settings";
import { useToast } from "./components/Toast";
import { checkForUpdates } from "./updater";
import { getTheme, isLightTheme } from "./themes";
import {
  AVAILABLE_BUILTINS,
  localOpen,
  serialOpen,
  telnetOpen,
  sshOpenFromProfile,
  newSshProfile,
  cloneProfile,
  termOptionsOf,
  type Profile,
  type UserProfile,
  type TabDesc,
} from "./profiles";
import { IS_MOBILE } from "./platform";

type EditorIntent =
  | { mode: "save"; initial: UserProfile }
  | { mode: "connect-tab"; initial: UserProfile; tabId: string }
  | { mode: "connect-new"; initial: UserProfile };

const profileLabel = (p: UserProfile) =>
  p.name || `${p.ssh.username}@${p.ssh.host}`;
import { getStore, setValue } from "./store";

type Tab =
  | { id: string; kind: "launcher" }
  | { id: string; kind: "terminal"; root: PaneNode; desc?: TabDesc }
  | { id: string; kind: "settings" };

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
  const [hostKeyReqs, setHostKeyReqs] = useState<HostKeyReq[]>([]);
  const [mismatch, setMismatch] = useState<{ host: string; fingerprint: string } | null>(null);
  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem(WELCOME_KEY),
  );

  useEffect(() => {
    document.documentElement.classList.toggle(
      "light",
      isLightTheme(settings.themeName),
    );
  }, [settings.themeName]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-animations", !settings.animations);
  }, [settings.animations]);

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
    return () => {
      void p1.then((un) => un());
      void p2.then((un) => un());
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
  };

  const saveProfile = (p: UserProfile) => {
    // Never persist the plaintext password in the store — put it in the OS keychain.
    const password = p.ssh.password;
    const stored: UserProfile = { ...p, ssh: { ...p.ssh, password: "" } };
    const exists = userProfiles.some((x) => x.id === p.id);
    persistProfiles(
      exists
        ? userProfiles.map((x) => (x.id === p.id ? stored : x))
        : [...userProfiles, stored],
    );
    if (password) {
      void invoke("secret_set", { id: p.id, password }).catch(() => {});
    }
  };

  const deleteProfile = (id: string) => {
    persistProfiles(userProfiles.filter((x) => x.id !== id));
    void invoke("secret_delete", { id }).catch(() => {});
  };

  const setDefaultProfile = (id: string) => {
    setDefaultProfileId(id);
    void setValue("defaultProfileId", id).catch(() => {});
  };

  const addGroup = (name: string) => {
    if (groups.includes(name)) return;
    const next = [...groups, name];
    setGroups(next);
    void setValue("profileGroups", next).catch(() => {});
  };

  const deleteGroup = (name: string) => {
    const next = groups.filter((g) => g !== name);
    setGroups(next);
    void setValue("profileGroups", next).catch(() => {});
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
      openTerminalTab(localOpen(p.command), p.name, undefined, {
        t: "local",
        command: p.command,
        label: p.name,
      });
    } else {
      // Built-in "SSH connection" → open the SSH editor, connect on save.
      dismissWelcome();
      setEditor({ mode: "connect-new", initial: newSshProfile("Ungrouped") });
    }
  };

  const launchUserProfile = (p: UserProfile) =>
    openTerminalTab(sshOpenFromProfile(p), profileLabel(p), termOptionsOf(p), {
      t: "ssh",
      profileId: p.id,
    });

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

  // Drag the divider between the terminal and the SFTP panel (panel is on the
  // right, so dragging left widens it). Width is kept per tab.
  const startSftpResize = (e: React.PointerEvent, tabId: string) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sftpWidths[tabId] ?? 440;
    const move = (ev: PointerEvent) =>
      setSftpWidths((m) => ({
        ...m,
        [tabId]: Math.max(300, Math.min(900, startW - (ev.clientX - startX))),
      }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
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
    closeSftp(id);
    const idx = tabs.findIndex((t) => t.id === id);
    let next = tabs.filter((t) => t.id !== id);
    if (next.length === 0) {
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
                    initial: newSshProfile("Ungrouped"),
                    tabId: tab.id,
                  })
                }
              />
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
                onNewProfile={() =>
                  setEditor({ mode: "save", initial: newSshProfile("Ungrouped") })
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
                    isSsh={tab.desc?.t === "ssh"}
                    onOpenSftp={(paneId) => openSftpForPane(tab.id, paneId)}
                  />
                </div>
                {sftpTabs[tab.id] && (
                  <>
                    <div
                      onPointerDown={(e) => startSftpResize(e, tab.id)}
                      className="w-1.5 shrink-0 cursor-col-resize"
                      style={{ background: "var(--m-border)" }}
                    />
                    <div className="shrink-0" style={{ width: sftpWidths[tab.id] ?? 440 }}>
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
      </main>

      {editor && (
        <ProfileEditor
          initial={editor.initial}
          groups={groups}
          onSave={onEditorSave}
          onCancel={() => setEditor(null)}
        />
      )}

      {hostKeyReqs[0] && (
        <HostKeyPrompt req={hostKeyReqs[0]} onDecision={decideHostKey} />
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
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setMismatch(null)}
                className="rounded-md bg-neutral-700 px-4 py-2 text-sm text-white transition hover:bg-neutral-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

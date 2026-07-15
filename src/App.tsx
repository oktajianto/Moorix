import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/TitleBar";
import { HostKeyPrompt, type HostKeyReq } from "./components/HostKeyPrompt";
import {
  type OpenSession,
  type TermOptions,
  disposePane,
} from "./components/TerminalView";
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
import { SettingsPage } from "./components/SettingsPage";
import { ProfileEditor } from "./components/ProfileEditor";
import { Welcome } from "./components/Welcome";
import { useSettings } from "./settings";
import { useToast } from "./components/Toast";
import { checkForUpdates } from "./updater";
import { getTheme, isLightTheme } from "./themes";
import {
  AVAILABLE_BUILTINS,
  localOpen,
  sshOpenFromProfile,
  newSshProfile,
  cloneProfile,
  termOptionsOf,
  type Profile,
  type UserProfile,
} from "./profiles";

type EditorIntent =
  | { mode: "save"; initial: UserProfile }
  | { mode: "connect-tab"; initial: UserProfile; tabId: string }
  | { mode: "connect-new"; initial: UserProfile };

const profileLabel = (p: UserProfile) =>
  p.name || `${p.ssh.username}@${p.ssh.host}`;
import { getStore, setValue } from "./store";

type Tab =
  | { id: string; kind: "launcher" }
  | { id: string; kind: "terminal"; root: PaneNode }
  | { id: string; kind: "settings" };

let counter = 1;
const nextId = () => `tab-${counter++}`;

const FIRST_ID = "tab-0";
const WELCOME_KEY = "moorix.welcomed";

function App() {
  const { settings } = useSettings();
  const toast = useToast();
  const [tabs, setTabs] = useState<Tab[]>([{ id: FIRST_ID, kind: "launcher" }]);
  const [activeId, setActiveId] = useState(FIRST_ID);
  const [activePaneId, setActivePaneId] = useState("");
  const [defaultProfileId, setDefaultProfileId] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [editor, setEditor] = useState<EditorIntent | null>(null);
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

  useEffect(() => {
    getStore()
      .then(async (s) => {
        const def = await s.get<string>("defaultProfileId");
        if (typeof def === "string") setDefaultProfileId(def);
        const g = await s.get<string[]>("profileGroups");
        if (Array.isArray(g)) setGroups(g);
        const up = await s.get<UserProfile[]>("userProfiles");
        if (Array.isArray(up)) setUserProfiles(up);
      })
      .catch(() => {});
  }, []);

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

  const openTerminalTab = (open: OpenSession, label: string, options?: TermOptions) => {
    dismissWelcome();
    const id = nextId();
    const leaf = makeLeaf(label, open, options);
    setTabs((prev) => [...prev, { id, kind: "terminal", root: leaf }]);
    setActiveId(id);
    setActivePaneId(leaf.paneId);
  };

  const launchProfile = (p: Profile) => {
    if (p.type === "local" && p.command) {
      openTerminalTab(localOpen(p.command), p.name);
    } else {
      // Built-in "SSH connection" → open the SSH editor, connect on save.
      dismissWelcome();
      setEditor({ mode: "connect-new", initial: newSshProfile("Ungrouped") });
    }
  };

  const launchUserProfile = (p: UserProfile) =>
    openTerminalTab(sshOpenFromProfile(p), profileLabel(p), termOptionsOf(p));

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

  const openSettings = () => {
    dismissWelcome();
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
    (tabId: string) => (open: OpenSession, label: string, options?: TermOptions) => {
      dismissWelcome();
      const leaf = makeLeaf(label, open, options);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId ? { id: tabId, kind: "terminal", root: leaf } : tab,
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
      launchInTab(editor.tabId)(sshOpenFromProfile(p), profileLabel(p), termOptionsOf(p));
    } else if (editor?.mode === "connect-new") {
      openTerminalTab(sshOpenFromProfile(p), profileLabel(p), termOptionsOf(p));
    }
    setEditor(null);
  };

  const closeTab = (id: string) => {
    const closing = tabs.find((t) => t.id === id);
    if (closing?.kind === "terminal") {
      for (const leaf of allLeaves(closing.root)) disposePane(leaf.paneId);
    }
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
        onOpenSettings={openSettings}
        onLaunchProfile={launchProfile}
        onManageProfiles={openSettings}
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
              <Panes
                node={tab.root}
                activePaneId={activePaneId}
                onFocusPane={setActivePaneId}
                onSplit={(paneId, dir) => splitPane(tab.id, paneId, dir)}
                onClosePane={(paneId) => closePane(tab.id, paneId)}
                onResize={(path, sizes) => resizePane(tab.id, path, sizes)}
              />
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

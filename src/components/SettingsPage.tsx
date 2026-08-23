import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Paintbrush,
  Plug,
  SquareTerminal,
  Palette,
  Cloud,
  Keyboard,
  SquareChevronRight,
  Lock,
  AppWindow,
  FileCode2,
  Plus,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Bug,
  Code2,
  Newspaper,
  RefreshCw,
  Wrench,
  Search,
  X,
  RotateCcw,
  UserCircle,
  DatabaseBackup,
  ChevronUp,
  Check,
  GripVertical,
  FolderOpen,
  LoaderCircle,
  Play,
  type LucideIcon,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  HOTKEY_ACTIONS,
  bindingsFor,
  eventToCombo,
  setHotkeyCapture,
} from "../hotkeys";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { getStore, setValue } from "../store";
import { setSyncPassword, seedPush, pullOnLogin } from "../cloudSync";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import logo from "../assets/moorix-logo.png";
import { useToast } from "./Toast";
import { checkForUpdates } from "../updater";
import { isStoreBuild } from "../appFlavor";
import {
  useSettings,
  effectiveFontFamily,
  lineHeightOf,
  type CursorShape,
  type RendererType,
} from "../settings";
import { THEME_NAMES, getTheme } from "../themes";
import {
  AVAILABLE_BUILTINS,
  subtitleOf,
  badgeOf,
  iconByName,
  type Profile,
  type UserProfile,
} from "../profiles";
import { NewProfilePicker } from "./NewProfilePicker";
import {
  type BackupConfig,
  type BackupJob,
  loadBackupConfig,
  saveBackupConfig,
  createBackupJob,
  datedFolderName,
  fetchDatabaseList,
  userDatabases,
  runBackupJob,
  markJobRanToday,
  syncTrayMode,
} from "../backupDb";
import {
  vaultConfigured,
  isUnlocked,
  createVault,
  unlock as vaultUnlock,
  lock as vaultLock,
  changeMaster,
  destroyVault,
} from "../vault";

type Props = {
  onLaunchProfile: (profile: Profile) => void;
  defaultProfileId: string;
  onSetDefaultProfile: (id: string) => void;
  groups: string[];
  onAddGroup: (name: string) => void;
  onDeleteGroup: (name: string) => void;
  userProfiles: UserProfile[];
  onLaunchUserProfile: (p: UserProfile) => void;
  onNewProfile: (type?: "ssh" | "serial" | "telnet") => void;
  onEditProfile: (p: UserProfile) => void;
  onDuplicateProfile: (p: UserProfile) => void;
  onDeleteProfile: (id: string) => void;
  /** Which section to show; `token` changes on every open to force a reset. */
  sectionRequest: { section: SectionId; token: number };
};

export type SectionId =
  | "application" | "appearance" | "profiles" | "terminal" | "colorscheme"
  | "configsync" | "hotkeys" | "shell" | "vault" | "window" | "configfile"
  | "account" | "backupdb";

const SIDEBAR: { id: SectionId; name: string; Icon: LucideIcon; gapAfter?: boolean }[] = [
  { id: "application", name: "Application", Icon: LayoutGrid },
  { id: "appearance", name: "Appearance", Icon: Paintbrush },
  { id: "profiles", name: "Profiles & connections", Icon: Plug },
  { id: "backupdb", name: "Backup DB", Icon: DatabaseBackup },
  { id: "terminal", name: "Terminal", Icon: SquareTerminal, gapAfter: true },
  { id: "colorscheme", name: "Color scheme", Icon: Palette },
  { id: "configsync", name: "Config sync", Icon: Cloud },
  { id: "hotkeys", name: "Hotkeys", Icon: Keyboard },
  { id: "shell", name: "Shell", Icon: SquareChevronRight },
  { id: "vault", name: "Vault", Icon: Lock },
  { id: "window", name: "Window", Icon: AppWindow },
  { id: "account", name: "Account", Icon: UserCircle },
  { id: "configfile", name: "Config file", Icon: FileCode2 },
];

export function SettingsPage(props: Props) {
  const [section, setSection] = useState<SectionId>(props.sectionRequest.section);

  // Re-open the requested section whenever the Settings tab is (re)opened.
  useEffect(() => {
    setSection(props.sectionRequest.section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sectionRequest.token]);

  return (
    <div className="flex h-full">
      <aside
        className="w-56 shrink-0 overflow-y-auto border-r py-3"
        style={{ borderColor: "var(--m-border)", background: "var(--m-chrome)" }}
      >
        {SIDEBAR.map((item) => {
          const active = section === item.id;
          return (
            <div key={item.id}>
              <button
                onClick={() => setSection(item.id)}
                className="mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md px-3 py-2 text-left text-sm"
                style={{
                  background: active ? "#2563eb" : "transparent",
                  color: active ? "#ffffff" : "var(--m-text)",
                }}
              >
                <item.Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.name}</span>
              </button>
              {item.gapAfter && <div className="my-2" />}
            </div>
          );
        })}
      </aside>

      <div className="flex-1 overflow-y-auto p-8">
        {section === "application" ? (
          <ApplicationSection />
        ) : section === "appearance" ? (
          <AppearanceSection />
        ) : section === "hotkeys" ? (
          <HotkeysSection />
        ) : section === "configsync" ? (
          <ConfigSyncSection />
        ) : section === "profiles" ? (
          <ProfilesSection {...props} />
        ) : section === "colorscheme" ? (
          <ColorSchemeSection />
        ) : section === "terminal" ? (
          <TerminalSection />
        ) : section === "vault" ? (
          <VaultSection />
        ) : section === "window" ? (
          <WindowSection />
        ) : section === "shell" ? (
          <ShellSection />
        ) : section === "account" ? (
          <AccountSection />
        ) : section === "backupdb" ? (
          <BackupDbSection userProfiles={props.userProfiles} />
        ) : (
          <Placeholder title={SIDEBAR.find((s) => s.id === section)?.name ?? ""} />
        )}
      </div>
    </div>
  );
}

function ProfilesSection({
  onLaunchProfile,
  defaultProfileId,
  onSetDefaultProfile,
  groups,
  onAddGroup,
  onDeleteGroup,
  userProfiles,
  onLaunchUserProfile,
  onNewProfile,
  onEditProfile,
  onDuplicateProfile,
  onDeleteProfile,
}: Props) {
  const [tab, setTab] = useState<"profiles" | "advanced">("profiles");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupPromptOpen, setGroupPromptOpen] = useState(false);
  const [groupName, setGroupName] = useState("");

  const toggle = (g: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });

  const q = filter.trim().toLowerCase();
  const matchUser = (u: UserProfile) =>
    !q ||
    (u.name || "").toLowerCase().includes(q) ||
    `${u.ssh.username}@${u.ssh.host}`.toLowerCase().includes(q);
  const builtin = q
    ? AVAILABLE_BUILTINS.filter(
        (p) => p.name.toLowerCase().includes(q) || subtitleOf(p).toLowerCase().includes(q),
      )
    : AVAILABLE_BUILTINS;

  const inGroup = (g: string) => userProfiles.filter((u) => u.group === g && matchUser(u));
  const ungrouped = userProfiles.filter(
    (u) => (!u.group || u.group === "Ungrouped") && matchUser(u),
  );

  const submitGroup = () => {
    const name = groupName.trim();
    if (name) onAddGroup(name);
    setGroupName("");
    setGroupPromptOpen(false);
  };

  const startNewSsh = (type: "ssh" | "serial" | "telnet") => {
    setPickerOpen(false);
    onNewProfile(type);
  };

  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Profiles</h1>
      <div className="mt-3 mb-6 flex gap-6 border-b text-sm" style={{ borderColor: "var(--m-border)" }}>
        {(["profiles", "advanced"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="pb-2 font-medium uppercase"
            style={{
              color: tab === t ? "var(--m-text)" : "var(--m-muted)",
              borderBottom: tab === t ? "2px solid #06b6d4" : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "advanced" ? (
        <ProfilesAdvancedTab />
      ) : (
       <>
      {/* Default profile */}
      <div className="mb-5 flex items-center justify-between">
        <label className="text-sm" style={{ color: "var(--m-text)" }}>Default profile for new tabs</label>
        <select
          value={defaultProfileId}
          onChange={(e) => onSetDefaultProfile(e.target.value)}
          className="w-64 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        >
          <option value="">Ask every time</option>
          {AVAILABLE_BUILTINS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Filter + New */}
      <div className="mb-4 flex gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter"
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        />
        <div className="relative">
          <button
            onClick={() => setNewMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
          >
            <Plus className="h-4 w-4" /> New <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
          {newMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNewMenuOpen(false)} />
              <div
                className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-md border shadow-lg"
                style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
              >
                <button
                  onClick={() => { setNewMenuOpen(false); setPickerOpen(true); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/10"
                  style={{ color: "var(--m-text)" }}
                >
                  <Plus className="h-4 w-4" /> New profile
                </button>
                <button
                  onClick={() => { setNewMenuOpen(false); setGroupPromptOpen(true); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/10"
                  style={{ color: "var(--m-text)" }}
                >
                  <FolderPlus className="h-4 w-4" /> New profile Group
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--m-border)" }}>
        <div className="px-4 py-2 text-xs font-medium" style={{ background: "var(--m-chrome)", color: "var(--m-muted)" }}>
          Ungrouped
        </div>
        {ungrouped.map((u) => (
          <UserRow key={u.id} p={u} onLaunch={() => onLaunchUserProfile(u)} onEdit={() => onEditProfile(u)} onDelete={() => onDeleteProfile(u.id)} />
        ))}

        {groups.map((g) => (
          <div key={g} className="border-t" style={{ borderColor: "var(--m-border)" }}>
            <GroupHeader name={g} collapsed={collapsed.has(g)} onToggle={() => toggle(g)} onDelete={() => onDeleteGroup(g)} />
            {!collapsed.has(g) &&
              inGroup(g).map((u) => (
                <UserRow key={u.id} p={u} onLaunch={() => onLaunchUserProfile(u)} onEdit={() => onEditProfile(u)} onDelete={() => onDeleteProfile(u.id)} />
              ))}
          </div>
        ))}

        <div className="border-t" style={{ borderColor: "var(--m-border)" }}>
          <GroupHeader name="Built-in" collapsed={collapsed.has("Built-in")} onToggle={() => toggle("Built-in")} />
          {!collapsed.has("Built-in") &&
            builtin.map((p) => {
              const badge = badgeOf(p);
              return (
                <button
                  key={p.id}
                  onClick={() => onLaunchProfile(p)}
                  className="flex w-full items-center gap-3 border-t px-4 py-2.5 text-left hover:bg-black/10"
                  style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
                >
                  <p.Icon className="h-4 w-4 shrink-0" style={{ color: p.color }} />
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="flex-1 truncate text-xs" style={{ color: "var(--m-muted)" }}>{subtitleOf(p)}</span>
                  {badge && <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300">{badge}</span>}
                </button>
              );
            })}
        </div>
      </div>
      </>
      )}

      {/* New group prompt */}
      {groupPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16" onClick={() => setGroupPromptOpen(false)}>
          <div
            className="w-[520px] max-w-[calc(100vw-2rem)] rounded-lg border p-4 shadow-2xl"
            style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitGroup();
                else if (e.key === "Escape") setGroupPromptOpen(false);
              }}
              placeholder="New group name"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
              style={inputStyle}
            />
            <div className="mt-3 flex justify-end">
              <button onClick={submitGroup} className="rounded-md bg-cyan-600 px-5 py-1.5 text-sm font-medium text-white transition hover:bg-cyan-500">OK</button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <NewProfilePicker
          onClose={() => setPickerOpen(false)}
          onNewSsh={startNewSsh}
          userProfiles={userProfiles}
          onDuplicate={(p) => {
            setPickerOpen(false);
            onDuplicateProfile(p);
          }}
        />
      )}
    </div>
  );
}

function GroupHeader({
  name,
  collapsed,
  onToggle,
  onDelete,
}: {
  name: string;
  collapsed: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="group flex w-full items-center gap-2 px-4 py-2 text-xs font-medium"
      style={{ background: "var(--m-chrome)", color: "var(--m-muted)" }}
    >
      <button onClick={onToggle} className="flex flex-1 items-center gap-2 text-left">
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {name}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          className="opacity-0 transition group-hover:opacity-100"
          title="Delete group"
        >
          <Trash2 className="h-3.5 w-3.5" style={{ color: "#ef4444" }} />
        </button>
      )}
    </div>
  );
}

function UserRow({ p, onLaunch, onEdit, onDelete }: { p: UserProfile; onLaunch: () => void; onEdit: () => void; onDelete: () => void }) {
  const Icon = iconByName(p.iconName);
  const color = !p.color || p.color === "#000000" ? "var(--m-text)" : p.color;
  return (
    <div
      onClick={onLaunch}
      className="group flex w-full cursor-pointer items-center gap-3 border-t px-4 py-2.5 text-left hover:bg-black/10"
      style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      <span className="text-sm font-medium">{p.name || `${p.ssh.username}@${p.ssh.host}`}</span>
      <span className="flex-1 truncate text-xs" style={{ color: "var(--m-muted)" }}>
        {p.ssh.username}@{p.ssh.host}
      </span>
      <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300">SSH</span>
      <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="opacity-0 transition group-hover:opacity-100" title="Edit">
        <Pencil className="h-4 w-4" style={{ color: "var(--m-muted)" }} />
      </button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="opacity-0 transition group-hover:opacity-100" title="Delete">
        <Trash2 className="h-4 w-4" style={{ color: "#ef4444" }} />
      </button>
    </div>
  );
}

const REPO_URL = "https://github.com/oktajianto/Moorix";

function ApplicationSection() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  // Store (MSIX) builds have no in-app updater and manage startup via the OS.
  const [storeBuild, setStoreBuild] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
    isStoreBuild()
      .then(setStoreBuild)
      .catch(() => setStoreBuild(false));
    isAutostartEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

  const toggleAutostart = async (v: boolean) => {
    try {
      if (v) await enableAutostart();
      else await disableAutostart();
      setAutostart(v);
      void syncTrayMode();
    } catch (e) {
      toast.show({ variant: "error", title: `Failed to change autostart: ${e}`, duration: 3000 });
    }
  };

  const onCheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await checkForUpdates(toast, { silent: false });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-3xl">
      {/* Header: brand + version + external links */}
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div>
          <div className="flex items-center gap-3">
            <img src={logo} alt="Moorix" className="h-12 w-12 rounded" />
            <div>
              <div className="text-3xl font-semibold leading-none" style={{ color: "var(--m-text)" }}>
                Moorix
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--m-muted)" }}>
                {version ? `v${version}` : " "}
              </div>
            </div>
          </div>
          {storeBuild ? (
            <div className="mt-4 text-xs" style={{ color: "var(--m-muted)" }}>
              Updates are delivered through the Microsoft Store.
            </div>
          ) : (
            <button
              onClick={onCheck}
              disabled={checking}
              className="mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition hover:bg-black/10 disabled:opacity-50"
              style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
            >
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              Check for updates
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <LinkRow Icon={Bug} title="Report a problem" subtitle="Open a GitHub issue" onClick={() => void openUrl(`${REPO_URL}/issues/new`)} />
          <LinkRow Icon={Code2} title="GitHub" subtitle="Source code" onClick={() => void openUrl(REPO_URL)} />
          <LinkRow Icon={Newspaper} title="What's new" subtitle="Show release notes" onClick={() => void openUrl(`${REPO_URL}/releases`)} />
        </div>
      </div>

      <h2 className="mt-10 mb-2 text-lg font-semibold" style={{ color: "var(--m-text)" }}>
        Application settings
      </h2>
      <div className="divide-y" style={{ borderColor: "var(--m-border)" }}>
        {!storeBuild && (
          <ToggleRow
            title="Automatic Updates"
            subtitle="Silently download and install updates from GitHub when available."
            checked={settings.autoUpdate}
            onChange={(v) => update({ autoUpdate: v })}
          />
        )}
        {!storeBuild && (
          <ToggleRow
            title="Run at startup"
            subtitle="Launch Moorix automatically at Windows login — so auto-backup can run on its own."
            checked={autostart ?? false}
            onChange={(v) => void toggleAutostart(v)}
          />
        )}
        {storeBuild && (
          <div className="py-4">
            <div className="text-sm font-medium" style={{ color: "var(--m-text)" }}>Run at startup</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--m-muted)" }}>
              Manage this under Windows Settings → Apps → Startup for now. In-app control is coming.
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-6 py-4">
          <div className="min-w-0">
            <div className="text-sm font-medium" style={{ color: "var(--m-text)" }}>Debugging</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--m-muted)" }}>Open the developer tools for the app window.</div>
          </div>
          <button
            onClick={() => void invoke("open_devtools").catch(() => {})}
            className="flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm transition hover:bg-black/10"
            style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
          >
            <Wrench className="h-4 w-4" />
            Open DevTools
          </button>
        </div>
      </div>

      <h2 className="mt-10 mb-2 text-lg font-semibold" style={{ color: "var(--m-text)" }}>
        Accessibility
      </h2>
      <ToggleRow
        title="Enable animations"
        subtitle="Turn off to reduce motion across the app."
        checked={settings.animations}
        onChange={(v) => update({ animations: v })}
      />
    </div>
  );
}

function LinkRow({
  Icon,
  title,
  subtitle,
  onClick,
}: {
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="group flex items-start gap-3 text-left">
      <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--m-muted)" }} />
      <div>
        <div className="text-sm font-medium leading-tight group-hover:underline" style={{ color: "var(--m-text)" }}>
          {title}
        </div>
        <div className="text-xs" style={{ color: "var(--m-muted)" }}>{subtitle}</div>
      </div>
    </button>
  );
}

function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium" style={{ color: "var(--m-text)" }}>{title}</div>
        {subtitle && <div className="mt-0.5 text-xs" style={{ color: "var(--m-muted)" }}>{subtitle}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? "#2563eb" : "var(--m-input-border)" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: checked ? "1.125rem" : "0.125rem" }}
      />
    </button>
  );
}

function AppearanceSection() {
  const { settings, update } = useSettings();
  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
  };

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>
        Appearance
      </h1>

      {/* Font family + size */}
      <FieldRow label="Font">
        <div className="flex gap-2">
          <select
            value={settings.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value })}
            className="w-64 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
            style={inputStyle}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <NumField
            value={settings.fontSize}
            onChange={(v) => update({ fontSize: clamp(v, 6, 48) })}
            min={6}
            max={48}
            className="w-20"
            style={inputStyle}
          />
        </div>
      </FieldRow>

      {/* Ligatures + weights on the left, live preview on the right */}
      <div className="mt-2 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-6 py-3">
            <span className="text-sm font-medium" style={{ color: "var(--m-text)" }}>
              Enable font ligatures
            </span>
            <Switch
              checked={settings.fontLigatures}
              onChange={(v) => update({ fontLigatures: v })}
            />
          </div>
          <FieldRow label="Normal font weight">
            <NumField
              value={settings.normalFontWeight}
              onChange={(v) => update({ normalFontWeight: clamp(v, 100, 900) })}
              min={100}
              max={900}
              step={100}
              className="w-28"
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Bold font weight">
            <NumField
              value={settings.boldFontWeight}
              onChange={(v) => update({ boldFontWeight: clamp(v, 100, 900) })}
              min={100}
              max={900}
              step={100}
              className="w-28"
              style={inputStyle}
            />
          </FieldRow>
        </div>

        <TerminalPreview />
      </div>

      {/* Cursor shape */}
      <FieldRow label="Cursor shape">
        <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "var(--m-input-border)" }}>
          {(["block", "bar", "underline"] as CursorShape[]).map((shape) => {
            const active = settings.cursorShape === shape;
            return (
              <button
                key={shape}
                onClick={() => update({ cursorShape: shape })}
                className="flex h-9 w-12 items-center justify-center border-l text-xs first:border-l-0"
                style={{
                  borderColor: "var(--m-input-border)",
                  background: active ? "#2563eb" : "var(--m-input)",
                  color: active ? "#fff" : "var(--m-text)",
                }}
                title={shape}
              >
                <CursorGlyph shape={shape} />
              </button>
            );
          })}
        </div>
      </FieldRow>

      <div className="flex items-center justify-between gap-6 py-3">
        <span className="text-sm font-medium" style={{ color: "var(--m-text)" }}>Blink cursor</span>
        <Switch checked={settings.cursorBlink} onChange={(v) => update({ cursorBlink: v })} />
      </div>

      <FieldRow label="Minimum contrast ratio">
        <NumField
          value={settings.minimumContrastRatio}
          onChange={(v) => update({ minimumContrastRatio: clamp(v, 1, 21) })}
          min={1}
          max={21}
          step={1}
          className="w-28"
          style={inputStyle}
        />
      </FieldRow>

      <FieldRow
        label="Fallback font"
        sublabel="A second font family used to display characters missing in the main font"
      >
        <select
          value={settings.fallbackFont}
          onChange={(e) => update({ fallbackFont: e.target.value })}
          className="w-64 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        >
          {FALLBACK_FONTS.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Line padding" sublabel="Additional space between lines">
        <NumField
          value={settings.linePadding}
          onChange={(v) => update({ linePadding: clamp(v, 0, 40) })}
          min={0}
          max={40}
          className="w-28"
          style={inputStyle}
        />
      </FieldRow>

      {/* Custom CSS */}
      <div className="mt-6">
        <div className="mb-2 text-sm font-medium" style={{ color: "var(--m-text)" }}>Custom CSS</div>
        <textarea
          value={settings.customCSS}
          onChange={(e) => update({ customCSS: e.target.value })}
          spellCheck={false}
          rows={5}
          placeholder="/* * { color: blue !important; } */"
          className="w-full rounded-md border px-3 py-2 font-mono text-xs outline-none focus:border-cyan-500"
          style={inputStyle}
        />
      </div>
    </div>
  );
}

/** Live terminal mock reflecting the current font/weight/ligature/spacing settings. */
function TerminalPreview() {
  const { settings } = useSettings();
  const t = getTheme(settings.themeName);
  const fg = t.foreground ?? "#e5e5e5";
  const dim = t.brightBlack ?? "#808080";
  const green = t.green ?? "#4ec9b0";
  const blue = t.blue ?? "#569cd6";
  const cyan = t.cyan ?? "#4dd0e1";
  const red = t.red ?? "#f44747";
  const bold = { fontWeight: settings.boldFontWeight } as const;

  const meta = <span style={{ color: dim }}>-rwxr-xr-x 1 root </span>;

  return (
    <div
      className="overflow-hidden rounded-md border p-3"
      style={{
        borderColor: "var(--m-border)",
        background: t.background,
        color: fg,
        fontFamily: effectiveFontFamily(settings),
        fontSize: settings.fontSize,
        lineHeight: lineHeightOf(settings),
        fontWeight: settings.normalFontWeight,
        fontFeatureSettings: settings.fontLigatures ? '"liga" 1, "calt" 1' : "normal",
      }}
    >
      <div>
        <span style={{ ...bold, color: green }}>john@doe-pc</span>
        <span style={{ color: dim }}>$</span> ls
        <span
          className="ml-0.5 inline-block align-middle"
          style={{ width: "0.55em", height: "1em", background: t.cursor ?? cyan }}
        />
      </div>
      <div>{meta}<span style={{ color: blue }}>Documents</span></div>
      <div>{meta}<span style={{ background: green, color: t.background }}>Downloads</span></div>
      <div>{meta}<span style={{ color: blue }}>Pictures</span></div>
      <div>{meta}<span style={{ ...bold }}>Music</span></div>
      <div>{meta}<span style={{ color: green }}>実行可能ファイル</span></div>
      <div>{meta}<span style={{ color: blue }}>sym</span> -&gt; <span style={{ color: cyan, textDecoration: "underline" }}>link</span></div>
      <div>
        <span style={{ color: dim }}>Icons: </span>📁 🐚 ⌨{" "}
        <span style={{ background: red, color: t.background, padding: "0 0.4em" }}>Powerline</span>
        <span
          className="inline-block align-middle"
          style={{
            width: 0,
            height: 0,
            borderTop: "0.6em solid transparent",
            borderBottom: "0.6em solid transparent",
            borderLeft: `0.5em solid ${red}`,
          }}
        />
      </div>
    </div>
  );
}

function CursorGlyph({ shape }: { shape: CursorShape }) {
  if (shape === "block") return <span className="inline-block h-3.5 w-2" style={{ background: "currentColor" }} />;
  if (shape === "bar") return <span className="inline-block h-3.5 w-0.5" style={{ background: "currentColor" }} />;
  return <span className="inline-block h-0.5 w-2.5" style={{ background: "currentColor" }} />;
}

function FieldRow({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium" style={{ color: "var(--m-text)" }}>{label}</div>
        {sublabel && <div className="mt-0.5 text-xs" style={{ color: "var(--m-muted)" }}>{sublabel}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumField({
  value,
  onChange,
  min,
  max,
  step,
  className,
  style,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className={`rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500 ${className ?? ""}`}
      style={style}
    />
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const FONT_FAMILIES = [
  { label: "Cascadia Code", value: '"Cascadia Code", "JetBrains Mono", Consolas, monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", "Cascadia Code", Consolas, monospace' },
  { label: "Consolas", value: "Consolas, monospace" },
  { label: "Courier New", value: '"Courier New", monospace' },
];

/** Optional second family appended after the main font, for glyphs it lacks
 *  (emoji, CJK, box-drawing/Powerline). "None" = no fallback. */
const FALLBACK_FONTS = [
  { label: "None", value: "" },
  { label: "Segoe UI Emoji", value: '"Segoe UI Emoji"' },
  { label: "Segoe UI Symbol", value: '"Segoe UI Symbol"' },
  { label: "Noto Sans Mono", value: '"Noto Sans Mono"' },
  { label: "Yu Gothic (CJK)", value: '"Yu Gothic"' },
  { label: "MS Gothic (CJK)", value: '"MS Gothic"' },
  { label: "Consolas", value: "Consolas" },
];

function TerminalSection() {
  const { settings, update } = useSettings();
  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
  };

  return (
    <div className="max-w-3xl">
      <SectionTitle first>Rendering</SectionTitle>
      <FieldRow label="Frontend" sublabel="Switches terminal frontend implementation (experimental)">
        <SelectBox
          value={settings.rendererType}
          onChange={(v) => update({ rendererType: v as RendererType })}
          style={inputStyle}
          options={[
            { value: "webgl", label: "xterm (WebGL)" },
            { value: "dom", label: "xterm (DOM)" },
          ]}
        />
      </FieldRow>
      <FieldRow label="Scrollback" sublabel="Number of lines kept in the buffer">
        <NumField
          value={settings.scrollback}
          onChange={(v) => update({ scrollback: clamp(v, 0, 500000) })}
          min={0}
          max={500000}
          step={500}
          className="w-40"
          style={inputStyle}
        />
      </FieldRow>
      <ToggleRow
        title="Draw bold text in bright colors"
        checked={settings.boldBright}
        onChange={(v) => update({ boldBright: v })}
      />
      <ToggleRow
        title="Sixel graphics support (experimental)"
        subtitle="Display images via Sixel escape sequences"
        checked={settings.sixel}
        onChange={(v) => update({ sixel: v })}
      />

      <SectionTitle>Keyboard</SectionTitle>
      <ToggleRow
        title="Use Alt as the Meta key"
        subtitle="Lets the shell handle Meta key instead of OS"
        checked={settings.altIsMeta}
        onChange={(v) => update({ altIsMeta: v })}
      />
      <ToggleRow
        title="Scroll on input"
        subtitle="Scrolls the terminal to the bottom on user input"
        checked={settings.scrollOnInput}
        onChange={(v) => update({ scrollOnInput: v })}
      />

      <SectionTitle>Mouse</SectionTitle>
      <ToggleRow
        title="Right-click paste"
        subtitle="Right-click pastes (copies if text is selected). Turn off to show the native context menu (copy / paste / …)."
        checked={settings.rightClickPaste}
        onChange={(v) => update({ rightClickPaste: v })}
      />
      <ToggleRow
        title="Paste on middle-click"
        checked={settings.pasteOnMiddleClick}
        onChange={(v) => update({ pasteOnMiddleClick: v })}
      />
      <ToggleRow
        title="Require key to click links"
        subtitle="Hold Ctrl/Cmd to click links"
        checked={settings.requireKeyToClickLinks}
        onChange={(v) => update({ requireKeyToClickLinks: v })}
      />
      <FieldRow label="Word separators" sublabel="Double-click selection will stop at these characters">
        <input
          value={settings.wordSeparators}
          onChange={(e) => update({ wordSeparators: e.target.value })}
          className="w-56 rounded-md border px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        />
      </FieldRow>

      <SectionTitle>Clipboard</SectionTitle>
      <ToggleRow
        title="Copy on select"
        checked={settings.copyOnSelect}
        onChange={(v) => update({ copyOnSelect: v })}
      />
      <ToggleRow
        title="Copy with formatting"
        subtitle="Copy text with colors and formatting (rich clipboard)"
        checked={settings.copyFormatting}
        onChange={(v) => update({ copyFormatting: v })}
      />
      <ToggleRow
        title="Bracketed paste"
        subtitle="Wrap pasted text in bracketed paste mode (helps avoid accidental execution)"
        checked={settings.bracketedPaste}
        onChange={(v) => update({ bracketedPaste: v })}
      />
      <ToggleRow
        title="Warn on multi-line paste"
        subtitle="Show a confirmation box when pasting multiple lines"
        checked={settings.warnMultilinePaste}
        onChange={(v) => update({ warnMultilinePaste: v })}
      />
      <ToggleRow
        title="Replace line breaks with spaces"
        subtitle="Flatten pasted text into a single line for terminals that do not support multiline paste"
        checked={settings.replaceLineBreaks}
        onChange={(v) => update({ replaceLineBreaks: v })}
      />
      <ToggleRow
        title="Trim whitespace and newlines"
        subtitle="Remove whitespace and newlines around the copied text"
        checked={settings.trimWhitespace}
        onChange={(v) => update({ trimWhitespace: v })}
      />

      <SectionTitle>Sound</SectionTitle>
      <FieldRow label="Terminal bell">
        <Segmented
          value={settings.bell}
          onChange={(v) => update({ bell: v })}
          options={[
            { value: "off", label: "Off" },
            { value: "visual", label: "Visual" },
            { value: "audible", label: "Audible" },
          ]}
        />
      </FieldRow>

      <SectionTitle>Startup</SectionTitle>
      <ToggleRow
        title="Auto-open a terminal on app start"
        checked={settings.autoOpenTerminal}
        onChange={(v) => update({ autoOpenTerminal: v })}
      />
      <ToggleRow
        title="Restore terminal tabs on app start"
        checked={settings.restoreTabs}
        onChange={(v) => update({ restoreTabs: v })}
      />
    </div>
  );
}

function SectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <h2
      className={`${first ? "" : "mt-10"} mb-2 text-lg font-semibold`}
      style={{ color: "var(--m-text)" }}
    >
      {children}
    </h2>
  );
}

function SelectBox<T extends string>({
  value,
  onChange,
  options,
  style,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  style?: React.CSSProperties;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-64 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
      style={style}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "var(--m-input-border)" }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="border-l px-4 py-2 text-xs first:border-l-0"
            style={{
              borderColor: "var(--m-input-border)",
              background: active ? "#2563eb" : "var(--m-input)",
              color: active ? "#fff" : "var(--m-text)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function HotkeysSection() {
  const { settings, update } = useSettings();
  const [query, setQuery] = useState("");
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const setBindings = (id: string, combos: string[]) =>
    update({ hotkeys: { ...settings.hotkeys, [id]: combos } });

  const resetBindings = (id: string) => {
    const next = { ...settings.hotkeys };
    delete next[id];
    update({ hotkeys: next });
  };

  // Capture the next keypress into the action being edited.
  useEffect(() => {
    if (!capturingId) return;
    setHotkeyCapture(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturingId(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // lone modifier — keep listening
      const action = HOTKEY_ACTIONS.find((a) => a.id === capturingId);
      if (action) {
        const cur = bindingsFor(action, settings.hotkeys);
        if (!cur.includes(combo)) setBindings(capturingId, [...cur, combo]);
      }
      setCapturingId(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setHotkeyCapture(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturingId]);

  const q = query.trim().toLowerCase();
  const list = HOTKEY_ACTIONS.filter(
    (a) => !q || a.label.toLowerCase().includes(q) || a.id.includes(q),
  );

  return (
    <div className="max-w-3xl">
      <h1 className="mb-5 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Hotkeys</h1>

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--m-muted)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search hotkeys"
          className="w-full rounded-md border py-2.5 pl-9 pr-3 text-sm outline-none focus:border-cyan-500"
          style={{ background: "var(--m-input)", borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
        />
      </div>

      <div className="flex flex-col">
        {list.map((action) => {
          const combos = bindingsFor(action, settings.hotkeys);
          const capturing = capturingId === action.id;
          const overridden = settings.hotkeys[action.id] !== undefined;
          return (
            <div key={action.id} className="flex items-center justify-between gap-6 py-2.5">
              <div className="min-w-0">
                <span className="text-sm font-medium" style={{ color: "var(--m-text)" }}>{action.label}</span>
                <span className="ml-2 text-xs" style={{ color: "var(--m-muted)" }}>({action.id})</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {combos.map((combo) => (
                  <span
                    key={combo}
                    className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
                    style={{ borderColor: "#3b82f6", color: "var(--m-text)", background: "var(--m-input)" }}
                  >
                    {combo}
                    <button
                      onClick={() => setBindings(action.id, combos.filter((c) => c !== combo))}
                      className="opacity-60 transition hover:opacity-100"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {capturing ? (
                  <span className="rounded border border-dashed px-2 py-1 text-xs" style={{ borderColor: "#3b82f6", color: "var(--m-muted)" }}>
                    Press keys… (Esc)
                  </span>
                ) : (
                  <button
                    onClick={() => setCapturingId(action.id)}
                    className="rounded px-2 py-1 text-xs transition hover:bg-black/10"
                    style={{ color: "var(--m-muted)" }}
                  >
                    Add…
                  </button>
                )}
                {overridden && (
                  <button
                    onClick={() => resetBindings(action.id)}
                    className="rounded p-1 opacity-60 transition hover:opacity-100"
                    style={{ color: "var(--m-muted)" }}
                    title="Reset to default"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfigSyncSection() {
  const { settings, update } = useSettings();
  const [tab, setTab] = useState<"sync" | "advanced">("sync");
  const [syncBusy, setSyncBusy] = useState<"push" | "pull" | null>(null);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doPush = async () => {
    if (syncBusy) return;
    const pass = window.prompt("Enter/Create a Master Password for encryption:");
    if (!pass) return;
    setSyncBusy("push");
    setSyncMsg(null);
    try {
      const payload = await invoke<number[]>("export_sync_data", { password: pass });
      const token = await getGoogleAccessToken();
      await invoke<string>("drive_upload_appdata", {
        accessToken: token,
        name: SYNC_DRIVE_FILE,
        data: payload,
      });
      setSyncMsg({ ok: true, text: `Encrypted backup (${payload.length.toLocaleString()} bytes) saved to Google Drive.` });
    } catch (err) {
      setSyncMsg({ ok: false, text: `Push failed: ${err}` });
    } finally {
      setSyncBusy(null);
    }
  };

  const doPull = async () => {
    if (syncBusy) return;
    const pass = window.prompt("Enter your Master Password to decrypt:");
    if (!pass) return;
    if (!window.confirm("The configuration & Vault secrets on this device will be OVERWRITTEN with the backup from Google Drive. Continue?")) return;
    setSyncBusy("pull");
    setSyncMsg(null);
    try {
      const token = await getGoogleAccessToken();
      const data = await invoke<number[]>("drive_download_appdata", {
        accessToken: token,
        name: SYNC_DRIVE_FILE,
      });
      await invoke("import_sync_data", { password: pass, data });
      window.alert("Restored from Google Drive successfully. The app will reload.");
      await relaunch();
    } catch (err) {
      setSyncMsg({ ok: false, text: `Pull failed: ${err}` });
      setSyncBusy(null);
    }
  };

  const enableAutoSync = async () => {
    const pass = window.prompt("Create a sync Master Password (to encrypt the backup):");
    if (!pass) return;
    const confirm = window.prompt("Repeat the Master Password:");
    if (confirm !== pass) {
      setSyncMsg({ ok: false, text: "Passwords don't match." });
      return;
    }
    setSyncBusy("push");
    setSyncMsg(null);
    try {
      await setSyncPassword(pass);
      update({ autoSync: true });
      // Persist the flag to the store now (the provider's write is debounced) so
      // the seeded backup actually contains autoSync=true.
      await setValue("settings", { ...settings, autoSync: true });
      // Seed the backup now so other devices have something to pull.
      await seedPush(pass);
      setSyncMsg({ ok: true, text: "Auto-sync enabled. Setup uploaded to Google Drive — sign in with the same account on another device to pull it automatically." });
    } catch (err) {
      setSyncMsg({ ok: false, text: `Auto-sync enabled, but the initial upload failed: ${err}. Make sure you're signed in to Google.` });
    } finally {
      setSyncBusy(null);
    }
  };

  const disableAutoSync = () => {
    update({ autoSync: false });
    setSyncMsg({ ok: true, text: "Auto-sync disabled. Manual sync (Push/Pull) is still available." });
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Config sync</h1>
      <div className="mt-3 mb-6 flex gap-6 border-b text-sm" style={{ borderColor: "var(--m-border)" }}>
        {(["sync", "advanced"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="pb-2 font-medium uppercase"
            style={{
              color: tab === t ? "var(--m-text)" : "var(--m-muted)",
              borderBottom: tab === t ? "2px solid #06b6d4" : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "sync" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm" style={{ color: "var(--m-muted)" }}>
            Securely sync your configuration (Store JSON) and Vault secrets (Keychain) via Google Drive (End-to-End encrypted).
          </p>

          <div
            className="flex items-start justify-between gap-4 rounded-md border p-4"
            style={{ borderColor: "var(--m-border)", background: "var(--m-panel)" }}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium" style={{ color: "var(--m-text)" }}>
                Auto-sync
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--m-muted)" }}>
                Automatically <b>pull</b> the setup when you sign in / open the app on another device, and
                automatically <b>upload</b> on every change. Requires Google sign-in + a Master Password
                (stored securely in this device's keychain).
              </p>
            </div>
            <button
              onClick={() => (settings.autoSync ? disableAutoSync() : void enableAutoSync())}
              disabled={syncBusy !== null}
              className="mt-0.5 shrink-0 rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-60"
              style={{
                background: settings.autoSync ? "#22c55e" : "var(--m-input)",
                color: settings.autoSync ? "#fff" : "var(--m-text)",
              }}
            >
              {settings.autoSync ? "Enabled — turn off" : "Enable"}
            </button>
          </div>

          <div className="flex gap-4">
            <button
              onClick={doPush}
              disabled={syncBusy !== null}
              className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncBusy === "push" ? "Uploading…" : "Push to Google Drive"}
            </button>
            <button
              onClick={doPull}
              disabled={syncBusy !== null}
              className="rounded border px-4 py-2 text-sm font-medium transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
            >
              {syncBusy === "pull" ? "Downloading…" : "Pull from Google Drive"}
            </button>
          </div>
          {syncMsg && (
            <p className="text-sm" style={{ color: syncMsg.ok ? "#22c55e" : "#ef4444" }}>
              {syncMsg.text}
            </p>
          )}
        </div>
      ) : (
        <div>
          <ToggleRow
            title="Sync hotkeys"
            checked={settings.syncHotkeys}
            onChange={(v) => update({ syncHotkeys: v })}
          />
          <ToggleRow
            title="Sync window settings"
            checked={settings.syncWindow}
            onChange={(v) => update({ syncWindow: v })}
          />
          <ToggleRow
            title="Sync Vault"
            checked={settings.syncVault}
            onChange={(v) => update({ syncVault: v })}
          />
        </div>
      )}
    </div>
  );
}

function ColorSchemeSection() {
  const { settings, update } = useSettings();
  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Color scheme</h1>
      <div className="grid grid-cols-2 gap-3">
        {THEME_NAMES.map((name) => {
          const t = getTheme(name);
          const active = settings.themeName === name;
          return (
            <button
              key={name}
              onClick={() => update({ themeName: name })}
              className="flex items-center gap-3 rounded-md border px-4 py-3 text-left"
              style={{ borderColor: active ? "#06b6d4" : "var(--m-input-border)", background: active ? "var(--m-hover)" : "transparent", color: "var(--m-text)" }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded" style={{ background: t.background }}>
                <span className="h-3 w-3 rounded-full" style={{ background: t.blue }} />
              </span>
              <span className="text-sm">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


/** Vault — master-password credential store. Setup / unlock / lock / change /
 *  remove. When a vault exists, profile passwords are encrypted with the master
 *  password instead of the OS keychain (and it works on mobile too). */
function VaultSection() {
  const toast = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [, forceTick] = useState(0);
  const refresh = () => forceTick((n) => n + 1);

  useEffect(() => {
    vaultConfigured().then(setConfigured);
  }, []);

  // Create
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  // Unlock
  const [unlockPw, setUnlockPw] = useState("");
  // Change
  const [oldPw, setOldPw] = useState("");
  const [chgPw, setChgPw] = useState("");
  const [chgPw2, setChgPw2] = useState("");

  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
  };
  const inputCls = "w-72 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500";

  const doCreate = async () => {
    if (newPw.length < 4) return toast.show({ variant: "error", title: "Choose a longer master password.", duration: 3000 });
    if (newPw !== newPw2) return toast.show({ variant: "error", title: "Passwords don't match.", duration: 3000 });
    await createVault(newPw);
    setNewPw(""); setNewPw2("");
    setConfigured(true);
    toast.show({ variant: "success", title: "Vault created & unlocked.", duration: 3000 });
    refresh();
  };

  const doUnlock = async () => {
    const ok = await vaultUnlock(unlockPw);
    setUnlockPw("");
    toast.show(ok ? { variant: "success", title: "Vault unlocked.", duration: 3000 } : { variant: "error", title: "Wrong master password.", duration: 3000 });
    refresh();
  };

  const doChange = async () => {
    if (chgPw.length < 4) return toast.show({ variant: "error", title: "Choose a longer master password.", duration: 3000 });
    if (chgPw !== chgPw2) return toast.show({ variant: "error", title: "New passwords don't match.", duration: 3000 });
    const ok = await changeMaster(oldPw, chgPw);
    setOldPw(""); setChgPw(""); setChgPw2("");
    toast.show(ok ? { variant: "success", title: "Master password changed.", duration: 3000 } : { variant: "error", title: "Current password is wrong.", duration: 3000 });
    refresh();
  };

  const doRemove = async () => {
    if (!window.confirm("Remove the vault? All secrets stored in it will be permanently lost.")) return;
    await destroyVault();
    setConfigured(false);
    toast.show({ variant: "success", title: "Vault removed.", duration: 3000 });
    refresh();
  };

  const unlocked = isUnlocked();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Vault</h1>
      <p className="mt-2 mb-6 text-sm" style={{ color: "var(--m-muted)" }}>
        Encrypt saved credentials with a master password (AES-GCM, PBKDF2). Unlike the OS
        keychain, the vault works on every platform — including mobile. The master password
        is never stored; if you lose it, the secrets can't be recovered.
      </p>

      {configured === null ? (
        <p className="text-sm" style={{ color: "var(--m-muted)" }}>Loading…</p>
      ) : !configured ? (
        <>
          <SectionTitle first>Create a vault</SectionTitle>
          <div className="flex flex-col gap-2">
            <input type="password" className={inputCls} style={inputStyle} placeholder="Master password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <input type="password" className={inputCls} style={inputStyle} placeholder="Confirm master password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void doCreate()} />
            <button onClick={() => void doCreate()} className="w-40 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
              Create vault
            </button>
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--m-muted)" }}>
            Note: existing passwords already in the OS keychain aren't migrated — re-enter them
            in each profile after creating the vault.
          </p>
        </>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-2 text-sm">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: unlocked ? "#22c55e" : "#f59e0b" }}
            />
            <span style={{ color: "var(--m-text)" }}>
              Vault is {unlocked ? "unlocked" : "locked"}.
            </span>
            {unlocked && (
              <button onClick={() => { vaultLock(); refresh(); }} className="ml-2 rounded-md border px-3 py-1 text-xs" style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}>
                Lock now
              </button>
            )}
          </div>

          {!unlocked && (
            <>
              <SectionTitle first>Unlock</SectionTitle>
              <div className="flex items-center gap-2">
                <input type="password" className={inputCls} style={inputStyle} placeholder="Master password" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void doUnlock()} />
                <button onClick={() => void doUnlock()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">Unlock</button>
              </div>
            </>
          )}

          {unlocked && (
            <>
              <SectionTitle first>Change master password</SectionTitle>
              <div className="flex flex-col gap-2">
                <input type="password" className={inputCls} style={inputStyle} placeholder="Current password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
                <input type="password" className={inputCls} style={inputStyle} placeholder="New password" value={chgPw} onChange={(e) => setChgPw(e.target.value)} />
                <input type="password" className={inputCls} style={inputStyle} placeholder="Confirm new password" value={chgPw2} onChange={(e) => setChgPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void doChange()} />
                <button onClick={() => void doChange()} className="w-48 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">Change password</button>
              </div>
            </>
          )}

          <SectionTitle>Danger zone</SectionTitle>
          <button onClick={() => void doRemove()} className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-400">
            Remove vault
          </button>
        </>
      )}
    </div>
  );
}

/** Window — frame, tab-strip chrome, pane focus, and rendering hacks. Only the
 *  controls that map to real Moorix behaviour are exposed (the Tabby reference
 *  has extra cosmetic rows that don't apply here). */
function WindowSection() {
  const { settings, update } = useSettings();
  const disableGpu = settings.rendererType === "dom";
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Window</h1>

      <SectionTitle first>Window</SectionTitle>
      <FieldRow label="Window frame" sublabel="Custom uses Moorix's title bar; Native hands the frame to the OS">
        <Segmented
          value={settings.windowFrame}
          onChange={(v) => update({ windowFrame: v })}
          options={[
            { value: "custom", label: "Custom" },
            { value: "native", label: "Native" },
          ]}
        />
      </FieldRow>
      <ToggleRow
        title="Always on top"
        subtitle="Keep the window above other windows"
        checked={settings.alwaysOnTop}
        onChange={(v) => update({ alwaysOnTop: v })}
      />

      <SectionTitle>Tabs</SectionTitle>
      <ToggleRow title="Hide tab index" checked={settings.hideTabIndex} onChange={(v) => update({ hideTabIndex: v })} />
      <ToggleRow title="Hide tab close button" checked={settings.hideTabCloseButton} onChange={(v) => update({ hideTabCloseButton: v })} />
      <ToggleRow
        title="Close the window after closing the last tab"
        checked={settings.closeOnLastTab}
        onChange={(v) => update({ closeOnLastTab: v })}
      />

      <SectionTitle>Panes</SectionTitle>
      <ToggleRow
        title="Focus follows mouse"
        subtitle="Moving the mouse over an inactive pane activates it"
        checked={settings.focusFollowsMouse}
        onChange={(v) => update({ focusFollowsMouse: v })}
      />

      <SectionTitle>Hacks</SectionTitle>
      <ToggleRow
        title="Disable GPU acceleration"
        subtitle="Use the DOM renderer instead of WebGL — tick if you see aliasing or ghosting (applies to newly opened terminals)"
        checked={disableGpu}
        onChange={(v) => update({ rendererType: v ? "dom" : "webgl" })}
      />
    </div>
  );
}

/** Profiles → ADVANCED sub-tab. Only the options that map to real Moorix
 *  behaviour (quick-launch palette) are exposed. */
function ProfilesAdvancedTab() {
  const { settings, update } = useSettings();
  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
  };
  return (
    <div>
      <FieldRow
        label="Show recent profiles in selector"
        sublabel="Number of recently-used profiles shown at the top of the palette. 0 disables it."
      >
        <input
          type="number"
          min={0}
          max={20}
          value={settings.recentProfilesCount}
          onChange={(e) =>
            update({ recentProfilesCount: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })
          }
          className="w-24 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        />
      </FieldRow>
      <ToggleRow
        title="Show built-in profiles in selector"
        subtitle="If disabled, only your custom profiles appear in the quick-launch palette"
        checked={settings.showBuiltinProfiles}
        onChange={(v) => update({ showBuiltinProfiles: v })}
      />
    </div>
  );
}

/** Shell — defaults for local terminals (desktop). Applies to every local
 *  shell tab; SSH/Serial/Telnet are configured per-profile. */
function ShellSection() {
  const { settings, update } = useSettings();
  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
  };
  const KNOWN_SHELLS = [
    "powershell.exe",
    "pwsh.exe",
    "cmd.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "wsl.exe",
    "/bin/bash",
    "/bin/zsh",
  ];
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Shell</h1>
      <p className="mt-2 mb-4 text-sm" style={{ color: "var(--m-muted)" }}>
        Defaults for local terminal sessions. SSH, Serial, and Telnet are configured per profile.
      </p>

      <FieldRow label="Default shell" sublabel="Used for the Launcher's Local shell. Empty = OS default.">
        <input
          list="moorix-shells"
          value={settings.defaultShell}
          onChange={(e) => update({ defaultShell: e.target.value })}
          placeholder="System default"
          className="w-72 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        />
        <datalist id="moorix-shells">
          {KNOWN_SHELLS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </FieldRow>

      <FieldRow label="Working directory" sublabel="Starting directory for new local shells. Empty = home.">
        <input
          value={settings.shellWorkingDir}
          onChange={(e) => update({ shellWorkingDir: e.target.value })}
          placeholder="~ (home)"
          className="w-72 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        />
      </FieldRow>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-3 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>{title}</h1>
      <p className="text-sm" style={{ color: "var(--m-muted)" }}>This section is being designed.</p>
    </div>
  );
}

/* --------------------------- Backup DB (Fase 23) -------------------------- */

const inputStyle: React.CSSProperties = {
  background: "var(--m-input)",
  borderColor: "var(--m-input-border)",
  color: "var(--m-text)",
};

function BackupDbSection({ userProfiles }: { userProfiles: UserProfile[] }) {
  const toast = useToast();
  const [cfg, setCfg] = useState<BackupConfig | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    void loadBackupConfig().then(setCfg);
  }, []);

  // Persist on every mutation (store.set + save; cheap, and keeps disk in sync).
  const persist = (next: BackupConfig) => {
    setCfg(next);
    void saveBackupConfig(next).catch((e) =>
      toast.show({ variant: "error", title: `Failed to save backup settings: ${e}`, duration: 3000 }),
    );
  };

  // SSH profiles that actually have DB connections configured under them.
  const sshWithDbs = userProfiles.filter(
    (p) => p.type === "ssh" && (p.databases?.length ?? 0) > 0,
  );

  if (!cfg) {
    return (
      <div className="max-w-3xl">
        <h1 className="mb-6 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Backup DB</h1>
        <p className="text-sm" style={{ color: "var(--m-muted)" }}>Loading…</p>
      </div>
    );
  }

  const setJob = (id: string, patch: Partial<BackupJob>) =>
    persist({ ...cfg, jobs: cfg.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) });

  const addJob = () => persist({ ...cfg, jobs: [...cfg.jobs, createBackupJob()] });

  const deleteJob = (id: string) =>
    persist({ ...cfg, jobs: cfg.jobs.filter((j) => j.id !== id) });

  const moveJob = (index: number, dir: -1 | 1) => reorder(index, index + dir);

  // Move job from → to (used by both arrows and drag-and-drop).
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= cfg.jobs.length || to >= cfg.jobs.length) return;
    const jobs = [...cfg.jobs];
    const [moved] = jobs.splice(from, 1);
    jobs.splice(to, 0, moved);
    persist({ ...cfg, jobs });
  };

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Backup DB</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--m-muted)" }}>
        Automatically back up databases when the app/computer starts. Jobs run sequentially with a
        delay between them. This feature is off by default.
      </p>

      <div className="rounded-lg border px-4" style={{ borderColor: "var(--m-border)" }}>
        <ToggleRow
          title="Enable auto-backup"
          subtitle="Master switch. When off, no jobs run at startup."
          checked={cfg.enabled}
          onChange={(v) => {
            persist({ ...cfg, enabled: v });
            void syncTrayMode();
          }}
        />
      </div>

      {sshWithDbs.length === 0 && (
        <div
          className="mt-4 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
        >
          No SSH profile has a database connection yet. Add a DB connection under
          <span style={{ color: "var(--m-text)" }}> Profiles &amp; connections → Databases</span> first,
          then create a backup job here.
        </div>
      )}

      <div className="mt-6 mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: "var(--m-text)" }}>
          Backup jobs ({cfg.jobs.length})
        </h2>
        <button
          onClick={addJob}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: "#2563eb" }}
        >
          <Plus className="h-4 w-4" /> Add job
        </button>
      </div>

      {cfg.jobs.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--m-muted)" }}>
          No jobs yet. Click “Add job” to create your first backup setup.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {cfg.jobs.map((job, i) => (
            <BackupJobCard
              key={job.id}
              job={job}
              index={i}
              total={cfg.jobs.length}
              sshProfiles={sshWithDbs}
              dragging={dragIndex === i}
              dropTarget={dragIndex !== null && dragIndex !== i}
              onChange={(patch) => setJob(job.id, patch)}
              onDelete={() => deleteJob(job.id)}
              onMove={(dir) => moveJob(i, dir)}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
              onDropOn={() => {
                if (dragIndex !== null) reorder(dragIndex, i);
                setDragIndex(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BackupJobCard({
  job,
  index,
  total,
  sshProfiles,
  dragging,
  dropTarget,
  onChange,
  onDelete,
  onMove,
  onDragStart,
  onDragEnd,
  onDropOn,
}: {
  job: BackupJob;
  index: number;
  total: number;
  sshProfiles: UserProfile[];
  dragging: boolean;
  dropTarget: boolean;
  onChange: (patch: Partial<BackupJob>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
}) {
  const ssh = sshProfiles.find((p) => p.id === job.sshProfileId);
  const dbProfiles = ssh?.databases ?? [];
  const dbProfile = dbProfiles.find((d) => d.id === job.dbProfileId);
  const [dragOver, setDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [running, setRunning] = useState(false);
  const toast = useToast();

  const runNow = async () => {
    if (running) return;
    const jobLabel = job.name.trim() || "(unnamed)";
    if (!ssh) return toast.show({ variant: "error", title: "Select an SSH profile first", duration: 3000 });
    if (!dbProfile) return toast.show({ variant: "error", title: "Select a User DB first", duration: 3000 });
    if (!job.destDir.trim()) return toast.show({ variant: "error", title: "Destination folder is empty", duration: 3000 });
    if (!job.allDatabases && job.databases.length === 0)
      return toast.show({ variant: "error", title: "Select at least one database", duration: 3000 });

    setRunning(true);
    const id = toast.show({
      variant: "info",
      title: `Backup "${jobLabel}" running…`,
      message: "Connecting & exporting databases",
      progress: null,
    });
    try {
      const res = await runBackupJob(job, ssh);
      const failed = res.files.filter((f) => !f.ok);
      if (failed.length > 0) {
        toast.update(id, {
          variant: "error",
          title: `Backup "${jobLabel}" finished — ${failed.length} failed`,
          message: failed.map((f) => `${f.database}: ${f.error}`).join(" · "),
          progress: undefined,
          duration: 8000,
        });
      } else {
        // A successful manual run counts as "ran today" (§20.1 point 12).
        await markJobRanToday(job.name);
        const prunedNote = res.pruned.length ? ` · ${res.pruned.length} old folders removed` : "";
        toast.update(id, {
          variant: "success",
          title: `Backup "${jobLabel}" succeeded — ${res.files.length} databases`,
          message: `${res.folder}${prunedNote}`,
          progress: undefined,
          duration: 6000,
        });
      }
    } catch (e) {
      toast.update(id, {
        variant: "error",
        title: `Backup "${jobLabel}" failed`,
        message: String(e),
        progress: undefined,
        duration: 8000,
      });
    } finally {
      setRunning(false);
    }
  };

  const pickFolder = async () => {
    const dir = await openDialog({
      directory: true,
      title: "Choose backup destination folder",
      defaultPath: job.destDir || undefined,
    });
    if (typeof dir === "string") onChange({ destDir: dir });
  };

  return (
    <div
      onDragOver={(e) => {
        if (!dropTarget) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDropOn();
      }}
      className="rounded-lg border transition-shadow"
      style={{
        borderColor: dragOver ? "#2563eb" : "var(--m-border)",
        background: "var(--m-chrome)",
        opacity: dragging ? 0.4 : job.enabled ? 1 : 0.7,
        boxShadow: dragOver ? "0 0 0 1px #2563eb inset" : undefined,
      }}
    >
      {/* Header: drag handle + order controls + name + enable + delete */}
      <div
        className="flex items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "var(--m-border)" }}
      >
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" style={{ color: "var(--m-muted)" }} />
        </div>
        <span className="text-xs tabular-nums" style={{ color: "var(--m-muted)" }}>#{index + 1}</span>
        <div className="flex flex-col">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="disabled:opacity-30"
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" style={{ color: "var(--m-muted)" }} />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="disabled:opacity-30"
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--m-muted)" }} />
          </button>
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Show details" : "Hide details"}
          className="p-1"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" style={{ color: "var(--m-muted)" }} />
          ) : (
            <ChevronDown className="h-4 w-4" style={{ color: "var(--m-muted)" }} />
          )}
        </button>
        <input
          value={job.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Backup name (e.g. prod-daily)"
          className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:border-cyan-500"
          style={inputStyle}
        />
        <button
          onClick={runNow}
          disabled={running}
          title="Run backup now"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
          style={{ background: "#059669" }}
        >
          {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          <span>Run</span>
        </button>
        <Switch checked={job.enabled} onChange={(v) => onChange({ enabled: v })} />
        <button onClick={onDelete} title="Delete job" className="p-1">
          <Trash2 className="h-4 w-4" style={{ color: "#ef4444" }} />
        </button>
      </div>

      {/* Body: fields (hidden when collapsed — keeps cards short for easy reorder) */}
      {!collapsed && (
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 px-4 py-2 sm:grid-cols-2">
        {/* SSH profile */}
        <FieldRow label="SSH profile">
          <select
            value={job.sshProfileId}
            onChange={(e) => onChange({ sshProfileId: e.target.value, dbProfileId: "" })}
            className="w-52 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
            style={inputStyle}
          >
            <option value="">— select —</option>
            {sshProfiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name || "(unnamed)"}</option>
            ))}
          </select>
        </FieldRow>

        {/* UserDB (DB profile) */}
        <FieldRow label="User DB">
          <select
            value={job.dbProfileId}
            onChange={(e) => onChange({ dbProfileId: e.target.value })}
            disabled={!ssh}
            className="w-52 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500 disabled:opacity-50"
            style={inputStyle}
          >
            <option value="">— select —</option>
            {dbProfiles.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name || d.dbUser} ({d.dbUser})
              </option>
            ))}
          </select>
        </FieldRow>

        {/* All databases toggle */}
        <FieldRow label="All databases" sublabel="Back up every database on the server">
          <Switch
            checked={job.allDatabases}
            onChange={(v) => onChange({ allDatabases: v })}
          />
        </FieldRow>

        {/* Explicit database checklist (auto-loaded from the server) */}
        <FieldRow label="Databases" sublabel="Pick one or more">
          <MultiDbSelect
            ssh={ssh}
            dbProfile={dbProfile}
            selected={job.databases}
            disabled={job.allDatabases}
            onChange={(databases) => onChange({ databases })}
          />
        </FieldRow>

        {/* Destination folder */}
        <FieldRow label="Destination folder">
          <div className="flex w-52">
            <input
              value={job.destDir}
              onChange={(e) => onChange({ destDir: e.target.value })}
              placeholder="C:/backups"
              className="min-w-0 flex-1 rounded-l-md border border-r-0 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              style={inputStyle}
            />
            <button
              onClick={pickFolder}
              title="Choose folder…"
              className="flex items-center justify-center rounded-r-md border px-2.5"
              style={inputStyle}
            >
              <FolderOpen className="h-4 w-4" style={{ color: "var(--m-muted)" }} />
            </button>
          </div>
        </FieldRow>

        {/* Folder base name */}
        <FieldRow label="Folder name" sublabel={`Example: ${datedFolderName(job.folderBase)}`}>
          <input
            value={job.folderBase}
            onChange={(e) => onChange({ folderBase: e.target.value })}
            placeholder="dbbackup"
            className="w-52 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
            style={inputStyle}
          />
        </FieldRow>

        {/* Delay */}
        <FieldRow label="Delay (minutes)" sublabel="After the previous job finishes">
          <NumField
            value={job.delayMinutes}
            onChange={(v) => onChange({ delayMinutes: clamp(v, 0, 1440) })}
            min={0}
            max={1440}
            className="w-24"
            style={inputStyle}
          />
        </FieldRow>

        {/* Retention */}
        <FieldRow label="Retention (days)" sublabel="0 = keep all old folders">
          <NumField
            value={job.retentionDays}
            onChange={(v) => onChange({ retentionDays: clamp(v, 0, 3650) })}
            min={0}
            max={3650}
            className="w-24"
            style={inputStyle}
          />
        </FieldRow>
      </div>
      )}
    </div>
  );
}

/** Database checklist that auto-connects (via the chosen SSH + DB profile) to
 *  load the server's database list, with search + select-all. */
function MultiDbSelect({
  ssh,
  dbProfile,
  selected,
  disabled,
  onChange,
}: {
  ssh: UserProfile | undefined;
  dbProfile: import("../db").DBProfile | undefined;
  selected: string[];
  disabled: boolean;
  onChange: (dbs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Where to render the panel + how tall it can be, based on room around the
  // trigger — so the list always fits on-screen and scrolls *inside* itself.
  const [placement, setPlacement] = useState<{ dir: "down" | "up"; maxH: number }>({
    dir: "down",
    maxH: 320,
  });

  const openDropdown = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const margin = 12;
      const below = window.innerHeight - r.bottom - margin;
      const above = r.top - margin;
      if (below < 240 && above > below) {
        setPlacement({ dir: "up", maxH: Math.min(360, above) });
      } else {
        setPlacement({ dir: "down", maxH: Math.min(360, below) });
      }
    }
    setOpen(true);
  };

  // Auto-load the database list whenever the SSH/DB selection changes.
  useEffect(() => {
    let cancelled = false;
    if (!ssh || !dbProfile) {
      setList([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchDatabaseList(ssh, dbProfile)
      .then((dbs) => { if (!cancelled) setList(dbs); })
      .catch((e) => { if (!cancelled) { setError(String(e)); setList([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssh?.id, dbProfile?.id, reloadToken]);

  // System schemas (information_schema, performance_schema, …) are never shown.
  const userDbs = userDatabases(list);
  const options = Array.from(new Set([...userDbs, ...userDatabases(selected)]))
    .filter((db) => db.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const toggle = (db: string) =>
    onChange(selected.includes(db) ? selected.filter((x) => x !== db) : [...selected, db]);

  const label = disabled
    ? "All databases"
    : selected.length > 0
      ? `${selected.length} selected`
      : "Select databases";

  return (
    <div className="relative w-52">
      <button
        ref={btnRef}
        onClick={() => !disabled && (open ? setOpen(false) : openDropdown())}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500 disabled:opacity-50"
        style={inputStyle}
      >
        <span className="truncate" style={{ color: selected.length ? "var(--m-text)" : "var(--m-muted)" }}>
          {label}
        </span>
        <ChevronDown className="ml-1 h-4 w-4 shrink-0" style={{ color: "var(--m-muted)" }} />
      </button>

      {open && !disabled && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 right-0 z-50 flex flex-col rounded-md border shadow-lg ${
              placement.dir === "up" ? "bottom-full mb-1" : "top-full mt-1"
            }`}
            style={{ borderColor: "var(--m-border)", background: "var(--m-chrome)", maxHeight: placement.maxH }}
          >
            {/* search + refresh */}
            <div className="flex shrink-0 items-center gap-1 border-b p-1.5" style={{ borderColor: "var(--m-border)" }}>
              <div className="flex flex-1 items-center gap-1.5 rounded border px-2 py-1" style={{ borderColor: "var(--m-input-border)", background: "var(--m-input)" }}>
                <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--m-muted)" }} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  style={{ color: "var(--m-text)" }}
                />
              </div>
              <button
                onClick={() => setReloadToken((t) => t + 1)}
                title="Reload database list"
                className="p-1"
              >
                <RefreshCw className="h-3.5 w-3.5" style={{ color: "var(--m-muted)" }} />
              </button>
            </div>

            {/* select all / clear */}
            <div className="flex shrink-0 items-center justify-between px-2 py-1 text-xs" style={{ color: "var(--m-muted)" }}>
              <button onClick={() => onChange(Array.from(new Set([...selected, ...userDbs])))} className="hover:underline">
                Select all
              </button>
              <button onClick={() => onChange([])} className="hover:underline">
                Clear
              </button>
            </div>

            {/* list — takes remaining panel height and scrolls inside itself */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {loading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm" style={{ color: "var(--m-muted)" }}>
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Connecting…
                </div>
              ) : error ? (
                <div className="px-3 py-2 text-xs" style={{ color: "#ef4444" }}>
                  Failed to load: {error}
                </div>
              ) : options.length === 0 ? (
                <div className="px-3 py-2 text-sm" style={{ color: "var(--m-muted)" }}>
                  {ssh && dbProfile ? "No databases." : "Select SSH + User DB first."}
                </div>
              ) : (
                options.map((db) => {
                  const on = selected.includes(db);
                  return (
                    <button
                      key={db}
                      onClick={() => toggle(db)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--m-input)]"
                      style={{ color: "var(--m-text)" }}
                    >
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                        style={{
                          borderColor: on ? "#2563eb" : "var(--m-input-border)",
                          background: on ? "#2563eb" : "transparent",
                        }}
                      >
                        {on && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="truncate">{db}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type GoogleAccount = {
  email: string;
  name?: string;
  picture?: string;
  accessToken: string;
  refreshToken?: string;
  signedInAt: number;
};

const GOOGLE_ACCOUNT_KEY = "googleAccount";

/** Full interactive Google sign-in; persists the account and returns it. */
async function googleInteractiveLogin(): Promise<GoogleAccount> {
  const code = await invoke<string>("start_google_login");
  const token = await invoke<{ access_token: string; refresh_token?: string }>(
    "exchange_google_token",
    { code },
  );
  const user = await invoke<{ email: string; name?: string; picture?: string }>(
    "google_user_info",
    { accessToken: token.access_token },
  );
  const acc: GoogleAccount = {
    ...user,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    signedInAt: Date.now(),
  };
  await setValue(GOOGLE_ACCOUNT_KEY, acc);
  return acc;
}

/** Access token for Drive sync: silently refresh the stored session when
 *  possible, fall back to the interactive browser login otherwise. */
async function getGoogleAccessToken(): Promise<string> {
  let acc: GoogleAccount | null = null;
  try {
    const store = await getStore();
    acc = (await store.get<GoogleAccount>(GOOGLE_ACCOUNT_KEY)) ?? null;
  } catch {
    // no store (plain browser) — fall through to interactive login
  }
  if (acc?.refreshToken) {
    try {
      const token = await invoke<{ access_token: string; refresh_token?: string }>(
        "google_refresh_token",
        { refreshToken: acc.refreshToken },
      );
      const updated: GoogleAccount = {
        ...acc,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? acc.refreshToken,
      };
      await setValue(GOOGLE_ACCOUNT_KEY, updated);
      return updated.accessToken;
    } catch {
      // refresh token revoked/expired — fall back to interactive login
    }
  }
  return (await googleInteractiveLogin()).accessToken;
}

const SYNC_DRIVE_FILE = "moorix-sync.bin";

function AccountSection() {
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [busy, setBusy] = useState<"login" | "logout" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore the signed-in account persisted in the store (moorix.json).
  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const saved = await store.get<GoogleAccount>(GOOGLE_ACCOUNT_KEY);
        if (saved && saved.email) setAccount(saved);
      } catch {
        // Not in a Tauri runtime — stay signed out.
      }
    })();
  }, []);

  const doGoogleLogin = async () => {
    if (busy) return;
    setBusy("login");
    setError(null);
    try {
      const code = await invoke<string>("start_google_login");
      const token = await invoke<{ access_token: string; refresh_token?: string }>(
        "exchange_google_token",
        { code },
      );
      const user = await invoke<{ email: string; name?: string; picture?: string }>(
        "google_user_info",
        { accessToken: token.access_token },
      );
      const acc: GoogleAccount = {
        ...user,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        signedInAt: Date.now(),
      };
      await setValue(GOOGLE_ACCOUNT_KEY, acc);
      setAccount(acc);
      // If this account already has a backup (e.g. from another computer), offer
      // to pull it now. On success the app imports it and relaunches.
      await pullOnLogin(
        () =>
          window.confirm(
            "A Moorix backup was found in this Google account. Pull the setup (SSH profiles, configuration) to this device now? Local configuration will be overwritten.",
          ),
        () => window.prompt("Enter your sync Master Password:"),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const doLogout = async () => {
    if (!account || busy) return;
    setBusy("logout");
    try {
      // Best-effort revoke (revoking the refresh token also kills its access tokens).
      await invoke("google_logout", { token: account.refreshToken ?? account.accessToken }).catch(() => {});
      await setValue(GOOGLE_ACCOUNT_KEY, null).catch(() => {});
    } finally {
      setAccount(null);
      setBusy(null);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>
        Account & Sync
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--m-muted)" }}>
        Login to sync your settings across devices.
      </p>

      {account ? (
        <div className="flex flex-col gap-4 max-w-sm">
          <div
            className="flex items-center gap-3 rounded-md border p-4"
            style={{ borderColor: "var(--m-border)", background: "var(--m-panel)" }}
          >
            {account.picture ? (
              <img
                src={account.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="h-12 w-12 shrink-0 rounded-full"
              />
            ) : (
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
                style={{ background: "#06b6d4" }}
              >
                {(account.name ?? account.email).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" style={{ color: "var(--m-text)" }}>
                {account.name ?? account.email}
              </div>
              <div className="truncate text-xs" style={{ color: "var(--m-muted)" }}>
                {account.email}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: "#22c55e" }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} />
                Signed in with Google
              </div>
            </div>
          </div>
          <button
            className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderColor: "var(--m-border)", color: "#ef4444" }}
            disabled={busy !== null}
            onClick={doLogout}
          >
            {busy === "logout" ? "Logging out…" : "Log out"}
          </button>
        </div>
      ) : (
      <div className="flex flex-col gap-4 max-w-sm">
        <button
          className="flex items-center justify-center gap-3 rounded-md bg-white border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy !== null}
          onClick={doGoogleLogin}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {busy === "login" ? "Menunggu login di browser…" : "Sign in with Google"}
        </button>

        {error && (
          <p className="text-sm" style={{ color: "#ef4444" }}>
            Gagal login: {error}
          </p>
        )}

        {/* Sign in with Apple — disembunyikan sementara sampai flow-nya siap.
        <button
          className="flex items-center justify-center gap-3 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
          onClick={() => console.log("Apple Login Clicked")}
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.74.887-1.99 1.57-2.96 1.57-.14 0-.28-.01-.41-.03 0-1.15.54-2.34 1.18-3.1.76-.92 2-1.57 2.96-1.57.14 0 .28.02.407.05zM20.25 14.12c-.02 3.16 2.58 4.22 2.61 4.24-.02.16-1.28 4.41-4.22 4.41-1.4 0-2.67-.84-4.04-.84-1.39 0-2.82.86-4.07.86-2.4 0-5.83-2.59-5.83-7.55 0-3.34 1.77-5.59 4.22-5.59 1.48 0 2.59.88 3.82.88 1.16 0 2.7-.93 4.47-.93 1.94 0 3.23.86 4 2.14-3.36 1.95-2.92 5.59-.96 6.38z"/>
          </svg>
          Sign in with Apple
        </button>
        */}
      </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  LayoutGrid,
  Paintbrush,
  Plug,
  SquareTerminal,
  Palette,
  Cloud,
  Keyboard,
  SquareChevronRight,
  Globe,
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
  type LucideIcon,
} from "lucide-react";
import {
  HOTKEY_ACTIONS,
  bindingsFor,
  eventToCombo,
  setHotkeyCapture,
} from "../hotkeys";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import logo from "../assets/moorix-logo.png";
import { useToast } from "./Toast";
import { checkForUpdates } from "../updater";
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

type Props = {
  onLaunchProfile: (profile: Profile) => void;
  defaultProfileId: string;
  onSetDefaultProfile: (id: string) => void;
  groups: string[];
  onAddGroup: (name: string) => void;
  onDeleteGroup: (name: string) => void;
  userProfiles: UserProfile[];
  onLaunchUserProfile: (p: UserProfile) => void;
  onNewProfile: () => void;
  onEditProfile: (p: UserProfile) => void;
  onDuplicateProfile: (p: UserProfile) => void;
  onDeleteProfile: (id: string) => void;
  /** Which section to show; `token` changes on every open to force a reset. */
  sectionRequest: { section: SectionId; token: number };
};

export type SectionId =
  | "application" | "appearance" | "profiles" | "terminal" | "colorscheme"
  | "configsync" | "hotkeys" | "shell" | "ssh" | "vault" | "window" | "configfile";

const SIDEBAR: { id: SectionId; name: string; Icon: LucideIcon; gapAfter?: boolean }[] = [
  { id: "application", name: "Application", Icon: LayoutGrid },
  { id: "appearance", name: "Appearance", Icon: Paintbrush },
  { id: "profiles", name: "Profiles & connections", Icon: Plug },
  { id: "terminal", name: "Terminal", Icon: SquareTerminal, gapAfter: true },
  { id: "colorscheme", name: "Color scheme", Icon: Palette },
  { id: "configsync", name: "Config sync", Icon: Cloud },
  { id: "hotkeys", name: "Hotkeys", Icon: Keyboard },
  { id: "shell", name: "Shell", Icon: SquareChevronRight },
  { id: "ssh", name: "SSH", Icon: Globe },
  { id: "vault", name: "Vault", Icon: Lock },
  { id: "window", name: "Window", Icon: AppWindow },
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

  const startNewSsh = () => {
    setPickerOpen(false);
    onNewProfile();
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
        <span className="border-b-2 border-cyan-500 pb-2 font-medium" style={{ color: "var(--m-text)" }}>PROFILES</span>
        <span className="pb-2" style={{ color: "var(--m-muted)" }}>ADVANCED</span>
      </div>

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

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

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
          <button
            onClick={onCheck}
            disabled={checking}
            className="mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition hover:bg-black/10 disabled:opacity-50"
            style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
          >
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
            Check for updates
          </button>
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
        <ToggleRow
          title="Automatic Updates"
          subtitle="Silently download and install updates from GitHub when available."
          checked={settings.autoUpdate}
          onChange={(v) => update({ autoUpdate: v })}
        />
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
  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
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
        <>
          <FieldRow label="Sync host">
            <input
              value={settings.syncHost}
              onChange={(e) => update({ syncHost: e.target.value })}
              placeholder="https://sync.example.com"
              className="w-72 rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
              style={inputStyle}
            />
          </FieldRow>
          <div
            className="mt-4 rounded-md border p-4 text-sm"
            style={{ borderColor: "#2563eb", background: "rgba(37,99,235,0.08)", color: "var(--m-text)" }}
          >
            Config sync requires a compatible sync server (self-hosted). Enter its URL above
            to sync settings across your devices.{" "}
            <span style={{ color: "var(--m-muted)" }}>
              Moorix belum menyediakan server resmi — endpoint bisa kamu sediakan sendiri.
            </span>
          </div>
        </>
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


function Placeholder({ title }: { title: string }) {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-3 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>{title}</h1>
      <p className="text-sm" style={{ color: "var(--m-muted)" }}>Bagian ini sedang dirancang.</p>
    </div>
  );
}

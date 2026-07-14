import { useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { useSettings } from "../settings";
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
};

type SectionId =
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
  const [section, setSection] = useState<SectionId>("profiles");

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
        {section === "profiles" ? (
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

const FONT_FAMILIES = [
  { label: "Cascadia Code", value: '"Cascadia Code", "JetBrains Mono", Consolas, monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", "Cascadia Code", Consolas, monospace' },
  { label: "Consolas", value: "Consolas, monospace" },
  { label: "Courier New", value: '"Courier New", monospace' },
];

function TerminalSection() {
  const { settings, update } = useSettings();
  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold" style={{ color: "var(--m-text)" }}>Terminal</h1>
      <div className="flex flex-col gap-5 text-sm">
        <Row label="Font">
          <select
            value={settings.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value })}
            className="w-64 rounded-md border px-3 py-2 outline-none focus:border-cyan-500"
            style={{ background: "var(--m-input)", borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
          >
            {FONT_FAMILIES.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
          </select>
        </Row>
        <Row label={`Font size (${settings.fontSize}px)`}>
          <input type="range" min={10} max={24} value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} className="w-64 accent-cyan-500" />
        </Row>
        <Row label="Cursor blink">
          <input type="checkbox" checked={settings.cursorBlink} onChange={(e) => update({ cursorBlink: e.target.checked })} className="h-4 w-4 accent-cyan-500" />
        </Row>
      </div>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--m-text)" }}>{label}</span>
      {children}
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

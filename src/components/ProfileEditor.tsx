import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Lightbulb,
  AtSign,
  KeyRound,
  Shield,
  MessageSquare,
  Trash2,
  Plus,
  ArrowRight,
  Database,
  Pencil,
  FolderOpen,
} from "lucide-react";
import {
  CIPHER_OPTIONS,
  PROFILE_ICONS,
  iconByName,
  type UserProfile,
  type SshOptions,
  type SshAuthMethod,
  type PortForwardType,
  type LoginMatchMode,
  type BackspaceMode,
  type SerialOptions,
  type TelnetOptions,
} from "../profiles";
import {
  DB_ENGINES,
  createDbProfile,
  defaultPortFor,
  engineLabel,
  type DBProfile,
  type DbEngine,
} from "../db";
import { getTheme, THEME_NAMES } from "../themes";
import { GenerateKeyModal } from "./GenerateKeyModal";

type TabId = "general" | "ports" | "databases" | "advanced" | "ciphers" | "colors" | "login" | "input";

const TABS: { id: TabId; label: string }[] = [
  { id: "general", label: "GENERAL" },
  { id: "ports", label: "PORTS" },
  { id: "databases", label: "DATABASES" },
  { id: "advanced", label: "ADVANCED" },
  { id: "ciphers", label: "CIPHERS" },
  { id: "colors", label: "COLORS" },
  { id: "login", label: "LOGIN SCRIPTS" },
  { id: "input", label: "INPUT" },
];

const inputStyle = {
  background: "var(--m-input)",
  borderColor: "var(--m-input-border)",
  color: "var(--m-text)",
} as const;
const inputCls =
  "rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500";

export function ProfileEditor({
  initial,
  initialTab,
  groups,
  userProfiles,
  onSave,
  onCancel,
}: {
  initial: UserProfile;
  initialTab?: TabId;
  groups: string[];
  userProfiles: UserProfile[];
  onSave: (p: UserProfile) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<UserProfile>(initial);
  const [tab, setTab] = useState<TabId>(initialTab ?? "general");

  const set = (patch: Partial<UserProfile>) => setP((v) => ({ ...v, ...patch }));
  const setSsh = (patch: Partial<SshOptions>) =>
    setP((v) => ({ ...v, ssh: { ...v.ssh, ...patch } }));
  const setAdv = (patch: Partial<SshOptions["advanced"]>) =>
    setSsh({ advanced: { ...p.ssh.advanced, ...patch } });

  const toggleCipher = (cat: keyof SshOptions["ciphers"], value: string) => {
    if (!p.ssh) return;
    const cur = p.ssh.ciphers[cat];
    const next = cur.includes(value)
      ? cur.filter((v) => v !== value)
      : [...cur, value];
    setSsh({ ciphers: { ...p.ssh.ciphers, [cat]: next } });
  };

  const setSerial = (patch: Partial<SerialOptions>) =>
    setP((v) => ({ ...v, serial: { ...v.serial!, ...patch } }));

  const setTelnet = (patch: Partial<TelnetOptions>) =>
    setP((v) => ({ ...v, telnet: { ...v.telnet!, ...patch } }));

  const setDatabases = (databases: UserProfile["databases"]) => set({ databases });

  const availableTabs = TABS.filter((t) => {
    if (p.type === "serial") return ["general", "colors", "input"].includes(t.id);
    if (p.type === "telnet") return ["general", "colors", "login", "input"].includes(t.id);
    return true; // SSH shows all
  });

  const IconPreview = iconByName(p.iconName);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--m-bg)" }}>
      <div className="flex flex-1 overflow-hidden">
        {/* Left column */}
        <aside
          className="w-72 shrink-0 overflow-y-auto border-r p-6"
          style={{ borderColor: "var(--m-border)" }}
        >
          <Label>Name</Label>
          <input
            className={`${inputCls} mb-4 w-full`}
            style={inputStyle}
            value={p.name}
            onChange={(e) => set({ name: e.target.value })}
          />

          <Label>Group</Label>
          <select
            className={`${inputCls} mb-4 w-full`}
            style={inputStyle}
            value={p.group}
            onChange={(e) => set({ group: e.target.value })}
          >
            <option value="Ungrouped">Ungrouped</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <Label>Icon</Label>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {PROFILE_ICONS.map(({ name, Icon }) => (
              <button
                key={name}
                onClick={() => set({ iconName: name })}
                className="flex h-9 w-9 items-center justify-center rounded-md border"
                style={{
                  borderColor: p.iconName === name ? "#06b6d4" : "var(--m-input-border)",
                  color: "var(--m-text)",
                }}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          <Label>Color</Label>
          <div className="mb-5 flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#000000"}
              onChange={(e) => set({ color: e.target.value })}
              className="h-8 w-10 rounded border"
              style={{ borderColor: "var(--m-input-border)" }}
            />
            <input
              className={`${inputCls} flex-1`}
              style={inputStyle}
              value={p.color}
              onChange={(e) => set({ color: e.target.value })}
            />
          </div>

          <ToggleRow
            label="Disable dynamic tab title"
            hint="Connection name will be used instead"
            checked={p.disableDynamicTitle}
            onChange={(v) => set({ disableDynamicTitle: v })}
          />

          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm" style={{ color: "var(--m-text)" }}>
                When a session ends
              </div>
              <div className="text-xs" style={{ color: "var(--m-muted)" }}>
                Only close the tab when session is explicitly terminated
              </div>
            </div>
            <select
              className={`${inputCls}`}
              style={inputStyle}
              value={p.whenSessionEnds}
              onChange={(e) => set({ whenSessionEnds: e.target.value })}
            >
              <option>Auto</option>
              <option>Keep open</option>
              <option>Close</option>
            </select>
          </div>

          <ToggleRow
            label="Clear terminal after connection"
            checked={p.clearTerminal}
            onChange={(v) => set({ clearTerminal: v })}
          />

          <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: "var(--m-muted)" }}>
            <IconPreview className="h-4 w-4" style={{ color: p.color }} />
            Preview
          </div>
        </aside>

        {/* Right column */}
        <div className="flex-1 overflow-y-auto">
          <div
            className="sticky top-0 z-10 flex flex-wrap gap-4 border-b px-6 py-3 text-xs font-medium"
            style={{ background: "var(--m-bg)", borderColor: "var(--m-border)" }}
          >
            {availableTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="pb-1"
                style={{
                  color: tab === t.id ? "var(--m-text)" : "var(--m-muted)",
                  borderBottom: tab === t.id ? "2px solid #06b6d4" : "2px solid transparent",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === "general" && p.type === "serial" && (
              <SerialGeneralTab p={p} setSerial={setSerial} />
            )}
            {tab === "general" && p.type === "telnet" && (
              <TelnetGeneralTab p={p} setTelnet={setTelnet} />
            )}
            {tab === "general" && p.type === "ssh" && (
              <GeneralTab p={p} setSsh={setSsh} />
            )}
            {tab === "ports" && p.type === "ssh" && <PortsTab p={p} setSsh={setSsh} />}
            {tab === "databases" && p.type === "ssh" && (
              <DatabasesTab p={p} setDatabases={setDatabases} />
            )}
            {tab === "advanced" && p.type === "ssh" && (
              <AdvancedTab p={p} setAdv={setAdv} userProfiles={userProfiles} />
            )}
            {tab === "ciphers" && p.type === "ssh" && (
              <CiphersTab p={p} toggleCipher={toggleCipher} />
            )}
            {tab === "colors" && <ColorsTab p={p} setSsh={setSsh} />}
            {tab === "login" && <LoginScriptsTab p={p} setSsh={setSsh} />}
            {tab === "input" && <InputTab p={p} setSsh={setSsh} />}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex justify-end gap-2 border-t px-6 py-4"
        style={{ borderColor: "var(--m-border)" }}
      >
        <button
          onClick={() => onSave(p)}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-md bg-red-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- Tabs ---------------------------------- */

const AUTH_METHODS: { id: SshAuthMethod; label: string; Icon: typeof Lightbulb }[] = [
  { id: "auto", label: "Auto", Icon: Lightbulb },
  { id: "password", label: "Password", Icon: AtSign },
  { id: "key", label: "Key", Icon: KeyRound },
  { id: "agent", label: "Agent", Icon: Shield },
  { id: "interactive", label: "Interactive", Icon: MessageSquare },
];

function GeneralTab({
  p,
  setSsh,
}: {
  p: UserProfile;
  setSsh: (patch: Partial<SshOptions>) => void;
}) {
  const s = p.ssh;
  const [showGenKey, setShowGenKey] = useState(false);
  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex gap-3">
        <div className="flex-1">
          <Label>Host</Label>
          <input
            className={`${inputCls} w-full`}
            style={inputStyle}
            value={s.host}
            onChange={(e) => setSsh({ host: e.target.value })}
            placeholder="example.com"
          />
        </div>
        <div className="w-24">
          <Label>Port</Label>
          <input
            className={`${inputCls} w-full`}
            style={inputStyle}
            value={s.port}
            onChange={(e) => setSsh({ port: Number(e.target.value) || 22 })}
          />
        </div>
      </div>

      <Label>Username</Label>
      <input
        className={`${inputCls} mb-5 w-full max-w-md`}
        style={inputStyle}
        value={s.username}
        onChange={(e) => setSsh({ username: e.target.value })}
      />

      <Label>Authentication method</Label>
      <div className="mb-5 grid grid-cols-5 gap-2">
        {AUTH_METHODS.map((a) => {
          const active = s.authMethod === a.id;
          return (
            <button
              key={a.id}
              onClick={() => setSsh({ authMethod: a.id })}
              className="flex flex-col items-center gap-1 rounded-md border py-3 text-xs"
              style={{
                borderColor: active ? "#06b6d4" : "var(--m-input-border)",
                background: active ? "var(--m-hover)" : "transparent",
                color: "var(--m-text)",
              }}
            >
              <a.Icon className="h-4 w-4" />
              {a.label}
            </button>
          );
        })}
      </div>

      {(s.authMethod === "password" || s.authMethod === "auto") && (
        <div className="mb-4 max-w-md">
          <Label>Password</Label>
          <input
            type="password"
            className={`${inputCls} w-full`}
            style={inputStyle}
            value={s.password}
            onChange={(e) => setSsh({ password: e.target.value })}
          />
          <p className="mt-1 text-[11px]" style={{ color: "var(--m-muted)" }}>
            🔒 Stored in the OS keychain (encrypted). Leave blank to keep it unchanged.
          </p>
        </div>
      )}

      {(s.authMethod === "key" || s.authMethod === "auto") && (
        <div className="max-w-md">
          <Label>Private key path</Label>
          <div className="flex gap-2">
            <input
              className={`${inputCls} w-full`}
              style={inputStyle}
              value={s.keyPath}
              onChange={(e) => setSsh({ keyPath: e.target.value })}
              placeholder="C:\\Users\\you\\.ssh\\id_ed25519"
            />
            <button
              type="button"
              onClick={pickKeyFile}
              className="flex shrink-0 items-center gap-1 rounded px-2 text-xs"
              style={{
                border: "1px solid var(--m-border)",
                color: "var(--m-text)",
              }}
              title="Browse for a private key file"
            >
              <FolderOpen size={14} /> Browse
            </button>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--m-muted)" }}>
            🔒 The key stays on this device — only the profile syncs, so you set
            the key up again on other computers.
          </p>

          <div className="mt-3">
            <Label>Key passphrase (if encrypted)</Label>
            <input
              type="password"
              className={`${inputCls} w-full`}
              style={inputStyle}
              value={s.keyPassphrase ?? ""}
              onChange={(e) => setSsh({ keyPassphrase: e.target.value })}
              placeholder="Leave blank for a key without a passphrase"
            />
            <p className="mt-1 text-[11px]" style={{ color: "var(--m-muted)" }}>
              🔒 Stored in the OS keychain (encrypted), never synced. Leave blank
              to keep it unchanged.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowGenKey(true)}
            className="mt-3 flex items-center gap-1 rounded px-2 py-1 text-xs"
            style={{ border: "1px solid var(--m-border)", color: "var(--m-text)" }}
          >
            <KeyRound size={14} /> Generate key…
          </button>
        </div>
      )}

      {showGenKey && (
        <GenerateKeyModal
          defaultComment={`${s.username || "user"}@${s.host || "host"}`}
          onCancel={() => setShowGenKey(false)}
          onGenerated={(keyPath, passphrase) =>
            setSsh({ keyPath, authMethod: "key", keyPassphrase: passphrase })
          }
        />
      )}
    </div>
  );

  async function pickKeyFile() {
    const picked = await openDialog({
      multiple: false,
      directory: false,
      title: "Select private key",
      defaultPath: s.keyPath || undefined,
    });
    if (typeof picked === "string") setSsh({ keyPath: picked });
  }
}

function PortsTab({
  p,
  setSsh,
}: {
  p: UserProfile;
  setSsh: (patch: Partial<SshOptions>) => void;
}) {
  const [draft, setDraft] = useState({
    type: "local" as PortForwardType,
    bindHost: "127.0.0.1",
    bindPort: "8000",
    host: "127.0.0.1",
    port: "80",
    description: "",
  });
  const add = () => {
    setSsh({ ports: [...p.ssh.ports, { ...draft }] });
  };
  return (
    <div className="max-w-2xl">
      <h3 className="mb-4 text-lg" style={{ color: "var(--m-text)" }}>
        Add a port forward
      </h3>
      <div className="mb-2 flex items-center gap-1">
        <input className={`${inputCls} w-28`} style={inputStyle} value={draft.bindHost} onChange={(e) => setDraft({ ...draft, bindHost: e.target.value })} />
        <span style={{ color: "var(--m-muted)" }}>:</span>
        <input className={`${inputCls} w-20`} style={inputStyle} value={draft.bindPort} onChange={(e) => setDraft({ ...draft, bindPort: e.target.value })} />
        <ArrowRight className="mx-1 h-4 w-4" style={{ color: "var(--m-muted)" }} />
        <input className={`${inputCls} w-28`} style={inputStyle} value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
        <span style={{ color: "var(--m-muted)" }}>:</span>
        <input className={`${inputCls} w-20`} style={inputStyle} value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value })} />
      </div>
      <input className={`${inputCls} mb-2 w-full`} style={inputStyle} placeholder="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <div className="flex items-center justify-between">
        <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "var(--m-input-border)" }}>
          {(["local", "remote", "dynamic"] as PortForwardType[]).map((t) => (
            <button key={t} onClick={() => setDraft({ ...draft, type: t })} className="px-3 py-1.5 text-xs capitalize" style={{ background: draft.type === t ? "var(--m-hover)" : "transparent", color: "var(--m-text)" }}>
              {t}
            </button>
          ))}
        </div>
        <button onClick={add} className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500">
          Forward port
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-1">
        {p.ssh.ports.map((f, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}>
            <span className="capitalize" style={{ color: "var(--m-muted)" }}>{f.type}</span>
            <span>{f.bindHost}:{f.bindPort} → {f.host}:{f.port}</span>
            {f.description && <span style={{ color: "var(--m-muted)" }}>({f.description})</span>}
            <button onClick={() => setSsh({ ports: p.ssh.ports.filter((_, j) => j !== i) })} className="ml-auto">
              <Trash2 className="h-4 w-4" style={{ color: "#ef4444" }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DatabasesTab({
  p,
  setDatabases,
}: {
  p: UserProfile;
  setDatabases: (dbs: DBProfile[]) => void;
}) {
  const dbs = p.databases ?? [];
  const [editing, setEditing] = useState<DBProfile | null>(null);
  const [isNew, setIsNew] = useState(false);

  const startAdd = () => {
    setEditing(createDbProfile());
    setIsNew(true);
  };
  const startEdit = (d: DBProfile) => {
    setEditing({ ...d });
    setIsNew(false);
  };
  const remove = (id: string) => setDatabases(dbs.filter((d) => d.id !== id));

  const save = () => {
    if (!editing) return;
    const clean: DBProfile = { ...editing, name: editing.name.trim() || "Untitled DB" };
    setDatabases(
      dbs.some((d) => d.id === clean.id)
        ? dbs.map((d) => (d.id === clean.id ? clean : d))
        : [...dbs, clean],
    );
    setEditing(null);
  };

  const setE = (patch: Partial<DBProfile>) =>
    setEditing((v) => (v ? { ...v, ...patch } : v));

  const onEngine = (engine: DbEngine) => {
    // Snap the port to the engine default unless the user set a custom one.
    setEditing((v) => {
      if (!v) return v;
      const wasDefault = v.port === defaultPortFor(v.engine);
      return { ...v, engine, port: wasDefault ? defaultPortFor(engine) : v.port };
    });
  };

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm" style={{ color: "var(--m-muted)" }}>
        Database connections that ride this SSH tunnel. Credentials are stored in
        the vault; the SSH half is inherited from this profile.
      </p>

      {editing ? (
        <div
          className="mb-4 rounded-md border p-4"
          style={{ borderColor: "var(--m-input-border)" }}
        >
          <Label>Name</Label>
          <input
            className={`${inputCls} mb-3 w-full`}
            style={inputStyle}
            value={editing.name}
            onChange={(e) => setE({ name: e.target.value })}
            placeholder="app-prod (root)"
          />

          <Label>Engine</Label>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {DB_ENGINES.map((eng) => {
              const active = editing.engine === eng.id;
              return (
                <button
                  key={eng.id}
                  onClick={() => onEngine(eng.id)}
                  className="rounded-md border py-2 text-xs"
                  style={{
                    borderColor: active ? "#06b6d4" : "var(--m-input-border)",
                    background: active ? "var(--m-hover)" : "transparent",
                    color: "var(--m-text)",
                  }}
                >
                  {eng.label}
                </button>
              );
            })}
          </div>

          <div className="mb-3 flex gap-3">
            <div className="flex-1">
              <Label>Host (from server)</Label>
              <input
                className={`${inputCls} w-full`}
                style={inputStyle}
                value={editing.host}
                onChange={(e) => setE({ host: e.target.value })}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="w-24">
              <Label>Port</Label>
              <input
                className={`${inputCls} w-full`}
                style={inputStyle}
                value={editing.port}
                onChange={(e) => setE({ port: Number(e.target.value) || defaultPortFor(editing.engine) })}
              />
            </div>
          </div>

          <div className="mb-3 flex gap-3">
            <div className="flex-1">
              <Label>DB user</Label>
              <input
                className={`${inputCls} w-full`}
                style={inputStyle}
                value={editing.dbUser}
                onChange={(e) => setE({ dbUser: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <Label>DB password</Label>
              <input
                type="password"
                className={`${inputCls} w-full`}
                style={inputStyle}
                value={editing.password}
                onChange={(e) => setE({ password: e.target.value })}
                placeholder={isNew ? "" : "•••••• (leave blank to keep)"}
              />
            </div>
          </div>

          <Label>Default database (optional)</Label>
          <input
            className={`${inputCls} mb-4 w-full`}
            style={inputStyle}
            value={editing.defaultDatabase}
            onChange={(e) => setE({ defaultDatabase: e.target.value })}
          />

          <div className="flex gap-2">
            <button
              onClick={save}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500"
            >
              {isNew ? "Add" : "Save"}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="rounded-md border px-4 py-1.5 text-sm"
              style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={startAdd}
          className="mb-4 flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
        >
          <Plus className="h-4 w-4" /> Add database connection
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        {dbs.length === 0 && !editing && (
          <div className="text-xs" style={{ color: "var(--m-muted)" }}>
            No database connections yet.
          </div>
        )}
        {dbs.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
          >
            <Database className="h-4 w-4" style={{ color: "var(--m-accent)" }} />
            <span className="font-medium">{d.name}</span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] uppercase"
              style={{ background: "var(--m-hover)", color: "var(--m-muted)" }}
            >
              {engineLabel(d.engine)}
            </span>
            <span className="text-xs" style={{ color: "var(--m-muted)" }}>
              {d.dbUser}@{d.host}:{d.port}
            </span>
            <button onClick={() => startEdit(d)} className="ml-auto" title="Edit">
              <Pencil className="h-4 w-4" style={{ color: "var(--m-muted)" }} />
            </button>
            <button onClick={() => remove(d.id)} title="Delete">
              <Trash2 className="h-4 w-4" style={{ color: "#ef4444" }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvancedTab({
  p,
  setAdv,
  userProfiles,
}: {
  p: UserProfile;
  setAdv: (patch: Partial<SshOptions["advanced"]>) => void;
  userProfiles: UserProfile[];
}) {
  const a = p.ssh.advanced;
  return (
    <div className="max-w-2xl">
      <ToggleRow label="X11 forwarding" checked={a.x11} onChange={(v) => setAdv({ x11: v })} />
      <ToggleRow label="Agent forwarding" checked={a.agentForward} onChange={(v) => setAdv({ agentForward: v })} />
      <ToggleRow label="Skip MoTD/banner" hint="Will prevent the SSH greeting from showing up" checked={a.skipBanner} onChange={(v) => setAdv({ skipBanner: v })} />
      <ToggleRow label="Reuse session for multiple tabs" hint="Multiplex multiple shells through the same connection" checked={a.reuseSession} onChange={(v) => setAdv({ reuseSession: v })} />
      <NumberRow label="Keep Alive Interval (Milliseconds)" value={a.keepAliveInterval} onChange={(v) => setAdv({ keepAliveInterval: v })} />
      <NumberRow label="Max Keep Alive Count" value={a.maxKeepAliveCount} onChange={(v) => setAdv({ maxKeepAliveCount: v })} />
      <NumberRow label="Ready Timeout (Milliseconds)" value={a.readyTimeout} onChange={(v) => setAdv({ readyTimeout: v })} />

      <div className="mt-4 mb-1.5 text-sm" style={{ color: "var(--m-text)" }}>
        Jump Host Proxy
      </div>
      <select
        className={`${inputCls} w-full`}
        style={inputStyle}
        value={a.jumpHostProfileId || ""}
        onChange={(e) => setAdv({ jumpHostProfileId: e.target.value })}
      >
        <option value="">None (Direct connection)</option>
        {userProfiles
          .filter((u) => u.type === "ssh" && u.id !== p.id)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || `${u.ssh.username}@${u.ssh.host}`}
            </option>
          ))}
      </select>
    </div>
  );
}

function CiphersTab({
  p,
  toggleCipher,
}: {
  p: UserProfile;
  toggleCipher: (cat: keyof SshOptions["ciphers"], value: string) => void;
}) {
  const cats: { key: keyof SshOptions["ciphers"]; label: string }[] = [
    { key: "ciphers", label: "Ciphers" },
    { key: "kex", label: "Key exchange" },
    { key: "hmac", label: "HMAC" },
    { key: "hostKey", label: "Host key" },
    { key: "compression", label: "Compression" },
  ];
  return (
    <div className="max-w-3xl">
      {cats.map(({ key, label }) => (
        <div key={key} className="mb-6 grid grid-cols-[140px_1fr] gap-4">
          <div className="text-sm" style={{ color: "var(--m-text)" }}>{label}</div>
          <div className="flex flex-col gap-1.5">
            {CIPHER_OPTIONS[key].map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--m-text)" }}>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-blue-500"
                  checked={p.ssh.ciphers[key].includes(opt)}
                  onChange={() => toggleCipher(key, opt)}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorsTab({
  p,
  setSsh,
}: {
  p: UserProfile;
  setSsh: (patch: Partial<SshOptions>) => void;
}) {
  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm" style={{ color: "var(--m-muted)" }}>
        Override the color scheme for this profile (or keep the global theme).
      </p>
      <div className="flex flex-col gap-3">
        <SchemePreview name="" title="Use global theme" selected={p.ssh.colorScheme === ""} onSelect={() => setSsh({ colorScheme: "" })} />
        {THEME_NAMES.map((name) => (
          <SchemePreview key={name} name={name} title={name} selected={p.ssh.colorScheme === name} onSelect={() => setSsh({ colorScheme: name })} />
        ))}
      </div>
    </div>
  );
}

function SchemePreview({ name, title, selected, onSelect }: { name: string; title: string; selected: boolean; onSelect: () => void }) {
  const t = getTheme(name || "Moorix Dark");
  return (
    <button onClick={onSelect} className="text-left">
      <div className="mb-1 text-sm" style={{ color: "var(--m-text)" }}>
        {title} {selected && <span className="text-cyan-400">✓</span>}
      </div>
      <div
        className="rounded-md border p-3 font-mono text-xs leading-relaxed"
        style={{
          background: t.background,
          color: t.foreground,
          borderColor: selected ? "#06b6d4" : "var(--m-border)",
        }}
      >
        <div>
          <span style={{ color: t.green }}>john@doe-pc$</span> ls
        </div>
        <div>
          -rwxr-xr-x 1 root <span style={{ color: t.blue }}>Documents</span>{" "}
          <span style={{ color: t.yellow }}>Downloads</span>{" "}
          <span style={{ color: t.magenta }}>Pictures</span>
        </div>
      </div>
    </button>
  );
}

function LoginScriptsTab({
  p,
  setSsh,
}: {
  p: UserProfile;
  setSsh: (patch: Partial<SshOptions>) => void;
}) {
  const scripts = p.ssh.loginScripts;
  const update = (i: number, patch: Partial<(typeof scripts)[number]>) =>
    setSsh({ loginScripts: scripts.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="max-w-2xl">
      <div className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2 text-xs" style={{ color: "var(--m-muted)" }}>
        <span>Expect</span>
        <span>Send</span>
        <span />
      </div>
      {scripts.map((s, i) => (
        <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <input className={inputCls} style={inputStyle} value={s.expect} onChange={(e) => update(i, { expect: e.target.value })} placeholder="Expect" />
          <input className={inputCls} style={inputStyle} value={s.send} onChange={(e) => update(i, { send: e.target.value })} placeholder="Send" />
          <div className="flex items-center gap-1">
            <select className={`${inputCls} text-xs`} style={inputStyle} value={s.mode} onChange={(e) => update(i, { mode: e.target.value as LoginMatchMode })}>
              <option value="exact">Exact match</option>
              <option value="regex">Regex</option>
              <option value="optional">Optional</option>
            </select>
            <button onClick={() => setSsh({ loginScripts: scripts.filter((_, j) => j !== i) })}>
              <Trash2 className="h-4 w-4" style={{ color: "#ef4444" }} />
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => setSsh({ loginScripts: [...scripts, { expect: "", send: "", mode: "exact" }] })}
        className="mt-2 flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
        style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
      >
        <Plus className="h-4 w-4" /> New item
      </button>
    </div>
  );
}

function InputTab({
  p,
  setSsh,
}: {
  p: UserProfile;
  setSsh: (patch: Partial<SshOptions>) => void;
}) {
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: "var(--m-text)" }}>
          Backspace key mode
        </span>
        <select
          className={`${inputCls} w-56`}
          style={inputStyle}
          value={p.ssh.backspaceMode}
          onChange={(e) => setSsh({ backspaceMode: e.target.value as BackspaceMode })}
        >
          <option value="passthrough">Pass-through</option>
          <option value="ctrl-h">Ctrl-H</option>
          <option value="ctrl-?">Ctrl-?</option>
          <option value="delete">Delete (CSI 3~)</option>
        </select>
      </div>
    </div>
  );
}

/* ------------------------------- Primitives ------------------------------- */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-sm" style={{ color: "var(--m-text)" }}>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full transition"
      style={{ background: checked ? "#3b82f6" : "var(--m-input-border)" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: checked ? "1.125rem" : "0.125rem" }}
      />
    </button>
  );
}

function SerialGeneralTab({ p, setSerial }: { p: UserProfile; setSerial: (patch: Partial<SerialOptions>) => void; }) {
  const [ports, setPorts] = useState<string[]>([]);
  useEffect(() => {
    invoke<string[]>("serial_ports").then(setPorts).catch(console.error);
  }, []);

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex gap-3">
        <div className="flex-1">
          <Label>Port</Label>
          {ports.length > 0 ? (
            <select
              className={`${inputCls} w-full`}
              style={inputStyle}
              value={p.serial?.path || ""}
              onChange={(e) => setSerial({ path: e.target.value })}
            >
              <option value="">Select a port...</option>
              {ports.map((port) => (
                <option key={port} value={port}>{port}</option>
              ))}
            </select>
          ) : (
            <input
              className={`${inputCls} w-full`}
              style={inputStyle}
              value={p.serial?.path || ""}
              onChange={(e) => setSerial({ path: e.target.value })}
              placeholder="COM1 or /dev/ttyUSB0"
            />
          )}
        </div>
        <div className="w-32">
          <Label>Baud Rate</Label>
          <input
            className={`${inputCls} w-full`}
            style={inputStyle}
            value={p.serial?.baud || 115200}
            onChange={(e) => setSerial({ baud: Number(e.target.value) || 115200 })}
            type="number"
          />
        </div>
      </div>
    </div>
  );
}

function TelnetGeneralTab({ p, setTelnet }: { p: UserProfile; setTelnet: (patch: Partial<TelnetOptions>) => void; }) {
  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex gap-3">
        <div className="flex-1">
          <Label>Host</Label>
          <input
            className={`${inputCls} w-full`}
            style={inputStyle}
            value={p.telnet?.host || ""}
            onChange={(e) => setTelnet({ host: e.target.value })}
            placeholder="example.com"
          />
        </div>
        <div className="w-24">
          <Label>Port</Label>
          <input
            className={`${inputCls} w-full`}
            style={inputStyle}
            value={p.telnet?.port || 23}
            onChange={(e) => setTelnet({ port: Number(e.target.value) || 23 })}
            type="number"
          />
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-sm" style={{ color: "var(--m-text)" }}>{label}</div>
        {hint && <div className="text-xs" style={{ color: "var(--m-muted)" }}>{hint}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function NumberRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <span className="text-sm" style={{ color: "var(--m-text)" }}>{label}</span>
      <input
        className={`${inputCls} w-40`}
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

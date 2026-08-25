import { invoke, Channel } from "@tauri-apps/api/core";
import {
  Terminal,
  SquareTerminal,
  GitBranch,
  Plug,
  Server,
  Monitor,
  Globe,
  Cloud,
  Database,
  HardDrive,
  type LucideIcon,
} from "lucide-react";
import type { OpenSession, TermOptions } from "./components/TerminalView";
import { IS_MOBILE } from "./platform";
import { getStore } from "./store";
import { secretGet } from "./secrets";
import type { DBProfile } from "./db";

export type ProfileType = "local" | "ssh";

/** Serialisable descriptor of how a terminal tab was opened, persisted so tabs
 *  can be reopened on the next launch ("Restore terminal tabs"). Backend
 *  sessions themselves can't be restored — a fresh session is opened. */
export type TabDesc =
  | { t: "local"; command: string; label: string }
  | { t: "ssh"; profileId: string }
  | { t: "serial"; path: string; baud: number }
  | { t: "telnet"; host: string; port: number };

/** Built-in profile (not editable/deletable). */
export type Profile = {
  id: string;
  name: string;
  type: ProfileType;
  group: string;
  Icon: LucideIcon;
  color: string;
  command?: string;
};

export const BUILTIN_PROFILES: Profile[] = [
  { id: "powershell", name: "PowerShell", type: "local", group: "Built-in", Icon: Terminal, color: "#3b82f6", command: "powershell.exe" },
  { id: "cmd", name: "Command Prompt", type: "local", group: "Built-in", Icon: SquareTerminal, color: "#a3a3a3", command: "cmd.exe" },
  { id: "gitbash", name: "Git Bash", type: "local", group: "Built-in", Icon: GitBranch, color: "#f97316", command: "C:\\Program Files\\Git\\bin\\bash.exe" },
  { id: "ssh", name: "SSH connection", type: "ssh", group: "Built-in", Icon: Plug, color: "#22d3ee" },
];

/** Built-in profiles available on the current platform. Mobile is SSH-only, so
 *  local shells (PowerShell/CMD/Git Bash) are hidden there. */
export const AVAILABLE_BUILTINS: Profile[] = IS_MOBILE
  ? BUILTIN_PROFILES.filter((p) => p.type !== "local")
  : BUILTIN_PROFILES;

export function subtitleOf(p: Profile): string {
  return p.command ?? "New SSH session";
}

export function badgeOf(p: Profile): string | null {
  return p.type === "ssh" ? "SSH" : null;
}

/** Shell defaults from the Settings → Shell page, applied to every local
 *  terminal. Kept module-level so `localOpen` (not a React hook) can read them;
 *  App mirrors settings here via `setLocalShellDefaults`. */
let localShellDefaults = { shell: "", cwd: "" };
export function setLocalShellDefaults(d: { shell: string; cwd: string }): void {
  localShellDefaults = d;
}

export function localOpen(command: string): OpenSession {
  // An empty command falls back to the configured default shell, then the OS
  // default (backend picks it). cwd falls back to home on the backend.
  return (channel: Channel<number[]>, cols, rows) =>
    invoke<string>("session_open", {
      onData: channel,
      cols,
      rows,
      shell: command || localShellDefaults.shell || null,
      cwd: localShellDefaults.cwd || null,
    });
}

/** Open a local serial port (desktop only). Serial has no cols/rows. */
export function serialOpen(path: string, baud: number): OpenSession {
  return (channel: Channel<number[]>) =>
    invoke<string>("serial_open", { onData: channel, path, baud });
}

/** Open a Telnet connection over TCP. */
export function telnetOpen(host: string, port: number): OpenSession {
  return (channel: Channel<number[]>) =>
    invoke<string>("telnet_open", { onData: channel, config: { host, port } });
}

/* -------------------------------------------------------------------------- */
/* User profiles (SSH)                                                        */
/* -------------------------------------------------------------------------- */

export type SshAuthMethod = "auto" | "password" | "key" | "agent" | "interactive";
export type PortForwardType = "local" | "remote" | "dynamic";
export type LoginMatchMode = "exact" | "regex" | "optional";
export type BackspaceMode = "passthrough" | "ctrl-h" | "ctrl-?" | "delete";

export type PortForward = {
  type: PortForwardType;
  bindHost: string;
  bindPort: string;
  host: string;
  port: string;
  description: string;
};

export type LoginScript = { expect: string; send: string; mode: LoginMatchMode };

export type SshAdvanced = {
  x11: boolean;
  agentForward: boolean;
  skipBanner: boolean;
  reuseSession: boolean;
  jumpHostProfileId: string;
  keepAliveInterval: number;
  maxKeepAliveCount: number;
  readyTimeout: number;
};

export type SshCiphers = {
  ciphers: string[];
  kex: string[];
  hmac: string[];
  hostKey: string[];
  compression: string[];
};

export type SshOptions = {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password: string;
  keyPath: string;
  /** Passphrase for an encrypted private key. Like `password`, this is moved to
   *  the OS keychain on save (kept blank in the store) and never synced. */
  keyPassphrase: string;
  ports: PortForward[];
  advanced: SshAdvanced;
  ciphers: SshCiphers;
  colorScheme: string;
  loginScripts: LoginScript[];
  backspaceMode: BackspaceMode;
};

export type SerialOptions = {
  path: string;
  baud: number;
};

export type TelnetOptions = {
  host: string;
  port: number;
};

export type UserProfile = {
  id: string;
  type: "ssh" | "serial" | "telnet";
  name: string;
  group: string;
  iconName: string;
  color: string;
  disableDynamicTitle: boolean;
  whenSessionEnds: string;
  clearTerminal: boolean;
  ssh: SshOptions;
  serial?: SerialOptions;
  telnet?: TelnetOptions;
  /** Database connections riding this profile's SSH tunnel (Fase 20). Passwords
   *  live in the vault (keyed by each DBProfile id), stripped from the store. */
  databases?: DBProfile[];
};

/** Algorithm options for the CIPHERS tab. */
export const CIPHER_OPTIONS = {
  ciphers: [
    "none", "aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-gcm@openssh.com",
    "aes256-gcm@openssh.com", "aes128-cbc", "aes192-cbc", "aes256-cbc",
    "chacha20-poly1305@openssh.com",
  ],
  kex: [
    "mlkem768x25519-sha256", "curve25519-sha256", "curve25519-sha256@libssh.org",
    "diffie-hellman-group-exchange-sha1", "diffie-hellman-group-exchange-sha256",
    "diffie-hellman-group1-sha1", "diffie-hellman-group14-sha1",
    "diffie-hellman-group14-sha256", "diffie-hellman-group15-sha512",
    "diffie-hellman-group16-sha512", "diffie-hellman-group17-sha512",
    "diffie-hellman-group18-sha512", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384",
    "ecdh-sha2-nistp521",
  ],
  hmac: [
    "hmac-sha1", "hmac-sha2-256", "hmac-sha2-512", "hmac-sha1-etm@openssh.com",
    "hmac-sha2-256-etm@openssh.com", "hmac-sha2-512-etm@openssh.com",
  ],
  hostKey: [
    "ssh-dss", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
    "ssh-ed25519", "ssh-rsa", "rsa-sha2-256", "rsa-sha2-512",
    "sk-ecdsa-sha2-nistp256@openssh.com", "sk-ssh-ed25519@openssh.com",
  ],
  compression: ["zlib@openssh.com", "zlib", "none"],
} as const;

const CIPHER_DEFAULTS: SshCiphers = {
  ciphers: ["aes128-ctr", "aes192-ctr", "aes256-ctr", "aes256-gcm@openssh.com", "chacha20-poly1305@openssh.com"],
  kex: ["mlkem768x25519-sha256", "curve25519-sha256", "curve25519-sha256@libssh.org", "diffie-hellman-group14-sha256", "diffie-hellman-group16-sha512"],
  hmac: ["hmac-sha1", "hmac-sha2-256", "hmac-sha2-512", "hmac-sha1-etm@openssh.com", "hmac-sha2-256-etm@openssh.com", "hmac-sha2-512-etm@openssh.com"],
  hostKey: ["ecdsa-sha2-nistp256", "ecdsa-sha2-nistp521", "ssh-ed25519", "ssh-rsa", "rsa-sha2-256", "rsa-sha2-512"],
  compression: ["none"],
};

export function defaultSshOptions(): SshOptions {
  return {
    host: "",
    port: 22,
    username: "root",
    authMethod: "auto",
    password: "",
    keyPath: "",
    keyPassphrase: "",
    ports: [],
    advanced: {
      x11: false,
      agentForward: false,
      skipBanner: false,
      reuseSession: true,
      jumpHostProfileId: "",
      keepAliveInterval: 5000,
      maxKeepAliveCount: 10,
      readyTimeout: 15000,
    },
    ciphers: {
      ciphers: [...CIPHER_DEFAULTS.ciphers],
      kex: [...CIPHER_DEFAULTS.kex],
      hmac: [...CIPHER_DEFAULTS.hmac],
      hostKey: [...CIPHER_DEFAULTS.hostKey],
      compression: [...CIPHER_DEFAULTS.compression],
    },
    colorScheme: "",
    loginScripts: [],
    backspaceMode: "passthrough",
  };
}

export function createNewProfile(group: string, type: "ssh" | "serial" | "telnet" = "ssh"): UserProfile {
  let name = "New Session";
  let iconName = "MonitorSmartphone";
  if (type === "serial") {
    name = "New Serial Profile";
    iconName = "Cpu";
  } else if (type === "telnet") {
    name = "New Telnet Profile";
    iconName = "Network";
  }

  const p: UserProfile = {
    id: crypto.randomUUID(),
    type,
    name,
    group: group || "My Profiles",
    iconName,
    color: "#ffffff",
    disableDynamicTitle: false,
    whenSessionEnds: "close",
    clearTerminal: false,
    ssh: structuredClone(defaultSshOptions()),
    databases: [],
  };

  if (type === "serial") {
    p.serial = { path: "", baud: 115200 };
  } else if (type === "telnet") {
    p.telnet = { host: "", port: 23 };
  }

  return p;
}

/** Deep-clone a user profile as a new, independent profile (fresh id, "(copy)"
 *  name). The password lives in the OS keychain keyed by profile id, so the
 *  clone starts without one — the user re-enters it in the editor if needed. */
export function cloneProfile(p: UserProfile): UserProfile {
  const clone = {
    ...p,
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: p.name ? `${p.name} (copy)` : "Untitled (copy)",
    // DB children get fresh ids and drop their vault-backed passwords (the copy
    // starts without them, like the SSH password).
    databases: (p.databases ?? []).map((d) => ({
      ...d,
      id: crypto.randomUUID(),
      password: "",
    })),
  };

  if (p.type === "ssh" && p.ssh) {
    clone.ssh = {
      ...p.ssh,
      password: "",
      ports: p.ssh.ports.map((f) => ({ ...f })),
      loginScripts: p.ssh.loginScripts.map((s) => ({ ...s })),
      advanced: { ...p.ssh.advanced },
      ciphers: {
        ciphers: [...p.ssh.ciphers.ciphers],
        kex: [...p.ssh.ciphers.kex],
        hmac: [...p.ssh.ciphers.hmac],
        hostKey: [...p.ssh.ciphers.hostKey],
        compression: [...p.ssh.ciphers.compression],
      },
    };
  } else if (p.type === "serial" && p.serial) {
    clone.serial = { ...p.serial };
  } else if (p.type === "telnet" && p.telnet) {
    clone.telnet = { ...p.telnet };
  }

  return clone as UserProfile;
}

/** Lucide icons selectable for a profile. */
export const PROFILE_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: "server", Icon: Server },
  { name: "monitor", Icon: Monitor },
  { name: "terminal", Icon: Terminal },
  { name: "plug", Icon: Plug },
  { name: "globe", Icon: Globe },
  { name: "cloud", Icon: Cloud },
  { name: "database", Icon: Database },
  { name: "harddrive", Icon: HardDrive },
];

export function iconByName(name: string): LucideIcon {
  return PROFILE_ICONS.find((i) => i.name === name)?.Icon ?? Server;
}

/** Keychain id under which a profile's key passphrase is stored. Distinct from
 *  the profile id (which holds the login password) so the two never collide. */
export const keyPassphraseId = (profileId: string): string =>
  `${profileId}#keyPassphrase`;

/** Build an OpenSession that connects an SSH user profile. The password is
 *  fetched from the OS keychain at connect time (never persisted in the store). */
export function sshOpenFromProfile(p: UserProfile): OpenSession {
  const s = p.ssh;
  return async (channel: Channel<number[]>, cols, rows) => {
    let auth: Record<string, unknown>;
    if (s.authMethod === "key" && s.keyPath) {
      const passphrase =
        (await secretGet(keyPassphraseId(p.id)).catch(() => null)) || null;
      auth = { type: "key", path: s.keyPath, passphrase };
    } else {
      const stored = await secretGet(p.id).catch(() => null);
      auth = { type: "password", password: stored ?? s.password ?? "" };
    }

    let jumpHostConfig: any = null;
    if (s.advanced.jumpHostProfileId) {
      // Find the jump host profile (this assumes userProfiles is available globally, 
      // but in profiles.ts we don't have it. It's better to pass it in `UserProfile` or fetch it from store).
      const store = await getStore();
      const profiles = await store.get<UserProfile[]>("userProfiles");
      const jhProfile = profiles?.find((p) => p.id === s.advanced.jumpHostProfileId);
      if (jhProfile) {
        jumpHostConfig = {
          host: jhProfile.ssh.host,
          port: jhProfile.ssh.port,
          username: jhProfile.ssh.username,
          // simplify auth for jump host for now
          auth: jhProfile.ssh.authMethod === "key"
            ? {
                type: "key",
                path: jhProfile.ssh.keyPath,
                passphrase:
                  (await secretGet(keyPassphraseId(jhProfile.id)).catch(() => null)) || null,
              }
            : { type: "password", password: (await secretGet(jhProfile.id).catch(() => null)) ?? jhProfile.ssh.password ?? "" },
        };
      }
    }

    const config = {
      profileId: p.id,
      jumpHostConfig,
      host: s.host,
      port: s.port,
      username: s.username,
      auth,
      keepAliveInterval: s.advanced.keepAliveInterval,
      keepAliveMax: s.advanced.maxKeepAliveCount,
      readyTimeout: s.advanced.readyTimeout,
      jumpHostProfileId: s.advanced.jumpHostProfileId,
      x11: s.advanced.x11,
      agentForward: s.advanced.agentForward,
      skipBanner: s.advanced.skipBanner,
      reuseSession: s.advanced.reuseSession,
      ciphers: {
        ciphers: s.ciphers.ciphers,
        kex: s.ciphers.kex,
        hmac: s.ciphers.hmac,
        hostKey: s.ciphers.hostKey,
        compression: s.ciphers.compression,
      },
      // Port forwards (PORTS tab). Local/Dynamic are applied; Remote is ignored
      // by the backend for now.
      forwards: s.ports.map((f) => ({
        type: f.type,
        bindHost: f.bindHost,
        bindPort: f.bindPort,
        host: f.host,
        port: f.port,
      })),
    };
    return invoke<string>("ssh_open", { onData: channel, config, cols, rows });
  };
}

/** Per-session terminal behaviour (COLORS / INPUT / LOGIN SCRIPTS tabs). */
export function termOptionsOf(p: UserProfile): TermOptions {
  return {
    colorScheme: p.ssh?.colorScheme || "",
    backspaceMode: p.ssh?.backspaceMode || "passthrough",
    loginScripts: p.ssh?.loginScripts || [],
    reconnect: p.type === "ssh", // SSH sessions auto-reconnect on an unexpected drop
  };
}

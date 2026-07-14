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

export type ProfileType = "local" | "ssh";

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

export function localOpen(command: string): OpenSession {
  // An empty command means "use the OS default shell" (backend picks it).
  return (channel: Channel<number[]>, cols, rows) =>
    invoke<string>("session_open", { onData: channel, cols, rows, shell: command || null });
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
  ports: PortForward[];
  advanced: SshAdvanced;
  ciphers: SshCiphers;
  colorScheme: string;
  loginScripts: LoginScript[];
  backspaceMode: BackspaceMode;
};

export type UserProfile = {
  id: string;
  type: "ssh";
  name: string;
  group: string;
  iconName: string;
  color: string;
  disableDynamicTitle: boolean;
  whenSessionEnds: string;
  clearTerminal: boolean;
  ssh: SshOptions;
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
    ports: [],
    advanced: {
      x11: false,
      agentForward: false,
      skipBanner: false,
      reuseSession: true,
      keepAliveInterval: 5000,
      maxKeepAliveCount: 10,
      readyTimeout: 20000,
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

export function newSshProfile(group = "Ungrouped"): UserProfile {
  return {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "ssh",
    name: "",
    group,
    iconName: "server",
    color: "#000000",
    disableDynamicTitle: true,
    whenSessionEnds: "Auto",
    clearTerminal: true,
    ssh: defaultSshOptions(),
  };
}

/** Deep-clone a user profile as a new, independent profile (fresh id, "(copy)"
 *  name). The password lives in the OS keychain keyed by profile id, so the
 *  clone starts without one — the user re-enters it in the editor if needed. */
export function cloneProfile(p: UserProfile): UserProfile {
  return {
    ...p,
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: p.name ? `${p.name} (copy)` : "Untitled (copy)",
    ssh: {
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
    },
  };
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

/** Build an OpenSession that connects an SSH user profile. The password is
 *  fetched from the OS keychain at connect time (never persisted in the store). */
export function sshOpenFromProfile(p: UserProfile): OpenSession {
  const s = p.ssh;
  return async (channel: Channel<number[]>, cols, rows) => {
    let auth: Record<string, unknown>;
    if (s.authMethod === "key" && s.keyPath) {
      auth = { type: "key", path: s.keyPath, passphrase: null };
    } else {
      const stored = await invoke<string | null>("secret_get", { id: p.id }).catch(
        () => null,
      );
      auth = { type: "password", password: stored ?? s.password ?? "" };
    }
    const config = {
      host: s.host,
      port: s.port,
      username: s.username,
      auth,
      keepAliveInterval: s.advanced.keepAliveInterval,
      keepAliveMax: s.advanced.maxKeepAliveCount,
      readyTimeout: s.advanced.readyTimeout,
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
    colorScheme: p.ssh.colorScheme,
    backspaceMode: p.ssh.backspaceMode,
    loginScripts: p.ssh.loginScripts,
    reconnect: true, // SSH sessions auto-reconnect on an unexpected drop
  };
}

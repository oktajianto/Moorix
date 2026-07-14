import { useEffect, useMemo, useState } from "react";
import { FolderCog, type LucideIcon } from "lucide-react";
import {
  AVAILABLE_BUILTINS,
  subtitleOf,
  badgeOf,
  iconByName,
  type Profile,
  type UserProfile,
} from "../profiles";

type Props = {
  onClose: () => void;
  onLaunchProfile: (profile: Profile) => void;
  onManageProfiles: () => void;
  userProfiles: UserProfile[];
  onLaunchUserProfile: (profile: UserProfile) => void;
};

type Entry = {
  id: string;
  name: string;
  subtitle: string;
  Icon: LucideIcon;
  color: string;
  badge: string | null;
  run: () => void;
};

const usable = (c: string) => (!c || c === "#000000" ? "" : c);

/** Quick-launch palette. Lists user profiles + built-in profiles. */
export function ProfileMenu({
  onClose,
  onLaunchProfile,
  onManageProfiles,
  userProfiles,
  onLaunchUserProfile,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    const users: Entry[] = userProfiles.map((up) => ({
      id: up.id,
      name: up.name || `${up.ssh.username}@${up.ssh.host}`,
      subtitle: `${up.ssh.username}@${up.ssh.host}`,
      Icon: iconByName(up.iconName),
      color: up.color,
      badge: "SSH",
      run: () => onLaunchUserProfile(up),
    }));
    const builtins: Entry[] = AVAILABLE_BUILTINS.map((p) => ({
      id: p.id,
      name: p.name,
      subtitle: subtitleOf(p),
      Icon: p.Icon,
      color: p.color,
      badge: badgeOf(p),
      run: () => onLaunchProfile(p),
    }));
    const all = [...users, ...builtins];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.subtitle.toLowerCase().includes(q),
    );
  }, [query, userProfiles, onLaunchProfile, onLaunchUserProfile]);

  const total = entries.length + 1;
  const manageIndex = entries.length;
  useEffect(() => setSelected(0), [query]);

  const run = (idx: number) => {
    if (idx < entries.length) entries[idx].run();
    else onManageProfiles();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(selected);
    }
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute left-1/2 top-10 w-[460px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Select profile or enter an address"
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
        />

        <div className="max-h-80 overflow-y-auto py-1">
          {entries.map((e, i) => {
            const active = selected === i;
            return (
              <button
                key={e.id}
                onClick={() => run(i)}
                onMouseEnter={() => setSelected(i)}
                className="flex w-full items-center gap-3 px-4 py-2 text-left"
                style={{
                  background: active ? "#2563eb" : "transparent",
                  color: active ? "#ffffff" : "var(--m-text)",
                }}
              >
                <e.Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: active ? "#ffffff" : usable(e.color) || "var(--m-text)" }}
                />
                <span className="shrink-0 text-sm font-medium">{e.name}</span>
                <span
                  className="flex-1 truncate text-xs"
                  style={{ opacity: active ? 0.8 : 0.5 }}
                >
                  {e.subtitle}
                </span>
                {e.badge && (
                  <span className="shrink-0 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300">
                    {e.badge}
                  </span>
                )}
                {active && (
                  <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px]">
                    ENTER →
                  </span>
                )}
              </button>
            );
          })}

          {entries.length === 0 && (
            <div className="px-4 py-3 text-xs" style={{ color: "var(--m-muted)" }}>
              No matching profile.
            </div>
          )}

          <div className="my-1 border-t" style={{ borderColor: "var(--m-border)" }} />

          <button
            onClick={() => run(manageIndex)}
            onMouseEnter={() => setSelected(manageIndex)}
            className="flex w-full items-center gap-3 px-4 py-2 text-left"
            style={{
              background: selected === manageIndex ? "#2563eb" : "transparent",
              color: selected === manageIndex ? "#ffffff" : "var(--m-muted)",
            }}
          >
            <FolderCog className="h-4 w-4 shrink-0" />
            <span className="text-sm">Manage profiles</span>
          </button>
        </div>
      </div>
    </div>
  );
}

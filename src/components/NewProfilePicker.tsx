import { useEffect, useMemo, useRef, useState } from "react";
import { Network, MonitorSmartphone, Cpu, CornerDownLeft } from "lucide-react";
import { iconByName, type UserProfile } from "../profiles";

type Props = {
  onClose: () => void;
  onNewSsh: (type: "ssh" | "serial" | "telnet") => void;
  userProfiles: UserProfile[];
  onDuplicate: (p: UserProfile) => void;
};

type Row =
  | { kind: "template"; id: string; name: string; badge: string; Icon: typeof Network }
  | { kind: "duplicate"; profile: UserProfile };

/**
 * "New profile" — pick a base profile template, or duplicate an existing
 * profile. Focus: SSH. Serial/Telnet/Raw socket need backend support (coming
 * later) and are shown disabled. Keyboard: ↑/↓ to move, Enter to pick, Esc to
 * close.
 */
export function NewProfilePicker({ onClose, onNewSsh, userProfiles, onDuplicate }: Props) {
  const disabledTemplates = [
    { id: "raw", name: "Raw socket connection", badge: "Raw", Icon: Network },
  ];

  // Only enabled rows are keyboard-navigable.
  const rows = useMemo<Row[]>(
    () => [
      { kind: "template", id: "ssh", name: "SSH connection", badge: "SSH", Icon: MonitorSmartphone },
      { kind: "template", id: "serial", name: "Serial connection", badge: "Serial", Icon: Cpu },
      { kind: "template", id: "telnet", name: "Telnet session", badge: "Telnet", Icon: Network },
      ...userProfiles.map((profile) => ({ kind: "duplicate", profile }) as Row),
    ],
    [userProfiles],
  );

  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);

  const pick = (row: Row) => {
    if (row.kind === "template") {
      onNewSsh(row.id as "ssh" | "serial" | "telnet");
    } else onDuplicate(row.profile);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, rows.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (rows[active]) pick(rows[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, active]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const rowIndex = (predicate: (r: Row) => boolean) => rows.findIndex(predicate);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute left-1/2 top-10 flex max-h-[80vh] w-[520px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="border-b px-4 py-3 text-sm"
          style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
        >
          Select a base profile to use as a template
        </div>

        <div className="overflow-y-auto py-1">
          {/* Templates */}
          <div className="px-4 py-1.5 text-xs font-semibold" style={{ color: "var(--m-muted)" }}>
            Template
          </div>
          {(() => {
            const i = rowIndex((r) => r.kind === "template" && r.id === "ssh");
            const isActive = active === i;
            return (
              <RowButton
                ref={isActive ? activeRef : null}
                isActive={isActive}
                onActivate={() => setActive(i)}
                onClick={() => pick(rows[i])}
              >
                <MonitorSmartphone className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">SSH connection</span>
                <Badge>SSH</Badge>
                {isActive && <EnterHint />}
              </RowButton>
            );
          })()}
          {disabledTemplates.map((t) => (
            <div
              key={t.id}
              className="flex w-full cursor-not-allowed items-center gap-3 px-4 py-2 opacity-40"
              style={{ color: "var(--m-text)" }}
            >
              <t.Icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">{t.name}</span>
              <Badge>{t.badge}</Badge>
              <span className="text-[10px]" style={{ color: "var(--m-muted)" }}>
                soon
              </span>
            </div>
          ))}

          {/* Duplicate an existing profile */}
          <div
            className="mt-1 border-t px-4 pb-1 pt-2 text-xs font-semibold"
            style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
          >
            Duplicate an existing profile
          </div>
          {userProfiles.length === 0 ? (
            <div className="px-4 pb-2 pt-1 text-xs" style={{ color: "var(--m-muted)" }}>
              No saved profiles yet.
            </div>
          ) : (
            userProfiles.map((profile) => {
              const i = rowIndex((r) => r.kind === "duplicate" && r.profile.id === profile.id);
              const isActive = active === i;
              const Icon = iconByName(profile.iconName);
              const subtitle = profile.ssh.host
                ? `${profile.ssh.username}@${profile.ssh.host}:${profile.ssh.port}`
                : "SSH";
              return (
                <RowButton
                  key={profile.id}
                  ref={isActive ? activeRef : null}
                  isActive={isActive}
                  onActivate={() => setActive(i)}
                  onClick={() => pick(rows[i])}
                >
                  <Icon className="h-4 w-4 shrink-0" style={{ color: profile.color }} />
                  <span className="shrink-0 text-sm font-medium">
                    {profile.name || "Untitled"}
                  </span>
                  <span
                    className="flex-1 truncate text-xs"
                    style={{ color: isActive ? "rgba(255,255,255,0.7)" : "var(--m-muted)" }}
                  >
                    {subtitle}
                  </span>
                  {isActive && <EnterHint />}
                </RowButton>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

const RowButton = ({
  ref,
  isActive,
  onActivate,
  onClick,
  children,
}: {
  ref: React.Ref<HTMLButtonElement> | null;
  isActive: boolean;
  onActivate: () => void;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    ref={ref}
    onMouseMove={onActivate}
    onClick={onClick}
    className="flex w-full items-center gap-3 px-4 py-2 text-left"
    style={{
      background: isActive ? "#2563eb" : "transparent",
      color: isActive ? "#ffffff" : "var(--m-text)",
    }}
  >
    {children}
  </button>
);

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300">
      {children}
    </span>
  );
}

function EnterHint() {
  return (
    <span className="flex items-center gap-1 text-[10px] opacity-80">
      ENTER <CornerDownLeft className="h-3 w-3" />
    </span>
  );
}

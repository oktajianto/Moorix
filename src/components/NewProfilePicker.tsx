import { Network, MonitorSmartphone, Cpu, Plug } from "lucide-react";

type Props = {
  onClose: () => void;
  onNewSsh: () => void;
};

/**
 * "New profile" — pick a base profile template. Focus: SSH. Serial/Telnet/Raw
 * socket need backend support (coming later) and are shown disabled.
 */
export function NewProfilePicker({ onClose, onNewSsh }: Props) {
  const templates = [
    { id: "raw", name: "Raw socket connection", badge: "Telnet", Icon: Network, enabled: false },
    { id: "ssh", name: "SSH connection", badge: "SSH", Icon: MonitorSmartphone, enabled: true },
    { id: "serial", name: "Serial connection", badge: "Serial", Icon: Cpu, enabled: false },
    { id: "telnet", name: "Telnet session", badge: "Telnet", Icon: Network, enabled: false },
  ];

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute left-1/2 top-10 w-[520px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="border-b px-4 py-3 text-sm"
          style={{ borderColor: "var(--m-border)", color: "var(--m-muted)" }}
        >
          Select a base profile to use as a template
        </div>

        <div className="py-1">
          <div className="px-4 py-1.5 text-xs font-semibold" style={{ color: "var(--m-muted)" }}>
            Template
          </div>
          {templates.map((t) => (
            <button
              key={t.id}
              disabled={!t.enabled}
              onClick={() => {
                if (t.id === "ssh") onNewSsh();
                onClose();
              }}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                t.enabled ? "hover:bg-blue-600 hover:text-white" : "cursor-not-allowed opacity-40"
              }`}
              style={{ color: "var(--m-text)" }}
            >
              <t.Icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">{t.name}</span>
              <span className="ml-auto rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300">
                {t.badge}
              </span>
              {!t.enabled && (
                <span className="text-[10px]" style={{ color: "var(--m-muted)" }}>
                  soon
                </span>
              )}
            </button>
          ))}

          <div className="mt-1 border-t px-4 pb-2 pt-2" style={{ borderColor: "var(--m-border)" }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--m-muted)" }}>
              <Plug className="h-3.5 w-3.5" />
              Duplicate an existing profile — coming soon
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

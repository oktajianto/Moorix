import { ShieldQuestion } from "lucide-react";

export type HostKeyReq = { id: number; host: string; fingerprint: string };

export function HostKeyPrompt({
  req,
  onDecision,
}: {
  req: HostKeyReq;
  onDecision: (accept: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-md rounded-xl border p-6"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
      >
        <div className="mb-3 flex items-center gap-2">
          <ShieldQuestion className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-semibold" style={{ color: "var(--m-text)" }}>
            Verify host key
          </h2>
        </div>
        <p className="text-sm" style={{ color: "var(--m-text)" }}>
          The authenticity of host <b>{req.host}</b> can't be established. This is the
          first time you connect.
        </p>
        <p className="mt-3 text-xs" style={{ color: "var(--m-muted)" }}>
          SHA256 fingerprint:
        </p>
        <code
          className="mt-1 block break-all rounded-md border px-3 py-2 text-xs"
          style={{ background: "var(--m-input)", borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
        >
          {req.fingerprint}
        </code>
        <p className="mt-3 text-xs" style={{ color: "var(--m-muted)" }}>
          Only accept if this fingerprint matches your server. It will be remembered.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => onDecision(false)}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-400"
          >
            Reject
          </button>
          <button
            onClick={() => onDecision(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Accept &amp; continue
          </button>
        </div>
      </div>
    </div>
  );
}

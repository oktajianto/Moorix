import { useState } from "react";
import { Lock } from "lucide-react";

/**
 * Prompt for the vault master password. Shown when a secret is requested while
 * the vault is locked. `onSubmit` returns true if the password unlocked the
 * vault; false shows an inline error and keeps the modal open.
 */
export function VaultUnlockModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (master: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [master, setMaster] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!master || busy) return;
    setBusy(true);
    const ok = await onSubmit(master);
    setBusy(false);
    if (!ok) {
      setError(true);
      setMaster("");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-sm rounded-xl border p-6"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Lock className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-semibold" style={{ color: "var(--m-text)" }}>
            Unlock vault
          </h2>
        </div>
        <p className="text-sm" style={{ color: "var(--m-muted)" }}>
          Enter your master password to access saved credentials.
        </p>
        <input
          autoFocus
          type="password"
          value={master}
          onChange={(e) => {
            setMaster(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") onCancel();
          }}
          className="mt-4 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500"
          style={{
            background: "var(--m-input)",
            borderColor: error ? "#ef4444" : "var(--m-input-border)",
            color: "var(--m-text)",
          }}
          placeholder="Master password"
        />
        {error && (
          <p className="mt-1 text-xs text-red-400">Wrong master password.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium transition"
            style={{ background: "var(--m-input)", color: "var(--m-text)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!master || busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}

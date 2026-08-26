import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { homeDir, join } from "@tauri-apps/api/path";
import { KeyRound, Copy, Check } from "lucide-react";

type Algo = "ed25519" | "rsa";

type GeneratedKey = {
  privatePath: string;
  publicPath: string;
  publicOpenssh: string;
};

/**
 * Generate an SSH keypair on this device (Fase 26B). On success the caller gets
 * the private key path + passphrase so it can point the profile at the new key;
 * the public key is shown here to copy into the server's authorized_keys.
 */
export function GenerateKeyModal({
  defaultComment,
  onCancel,
  onGenerated,
}: {
  defaultComment: string;
  onCancel: () => void;
  onGenerated: (keyPath: string, passphrase: string) => void;
}) {
  const [algo, setAlgo] = useState<Algo>("ed25519");
  const [bits, setBits] = useState(3072);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [comment, setComment] = useState(defaultComment);
  const [outPath, setOutPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const suggestedName = algo === "rsa" ? "id_rsa" : "id_ed25519";

  // Default the path to ~/.ssh/id_<algo> until the user picks their own.
  useEffect(() => {
    if (pathEdited) return;
    let alive = true;
    void (async () => {
      try {
        const p = await join(await homeDir(), ".ssh", suggestedName);
        if (alive) setOutPath(p);
      } catch {
        /* ignore — user can type or browse */
      }
    })();
    return () => {
      alive = false;
    };
  }, [suggestedName, pathEdited]);

  const pickPath = async () => {
    const picked = await saveDialog({
      title: "Save private key as",
      defaultPath: outPath || suggestedName,
    });
    if (typeof picked === "string") {
      setOutPath(picked);
      setPathEdited(true);
    }
  };

  const generate = async () => {
    setError(null);
    if (!outPath.trim()) {
      setError("Choose where to save the key.");
      return;
    }
    if (passphrase !== confirm) {
      setError("Passphrases don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await invoke<GeneratedKey>("ssh_generate_keypair", {
        algo,
        bits: algo === "rsa" ? bits : null,
        passphrase: passphrase || null,
        comment,
        outPath,
        overwrite,
      });
      setResult(res);
      onGenerated(res.privatePath, passphrase);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      if (msg.includes("already exists")) setOverwrite(false);
    } finally {
      setBusy(false);
    }
  };

  const copyPublic = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.publicOpenssh);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — select the text and copy manually.");
    }
  };

  const inputCls =
    "w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-cyan-500";
  const inputStyle = {
    background: "var(--m-input)",
    borderColor: "var(--m-input-border)",
    color: "var(--m-text)",
  } as const;
  const labelCls = "mb-1 block text-xs font-medium";
  const labelStyle = { color: "var(--m-muted)" } as const;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-lg rounded-xl border p-6"
        style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
      >
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-semibold" style={{ color: "var(--m-text)" }}>
            Generate SSH key
          </h2>
        </div>

        {!result ? (
          <>
            <div className="mb-3">
              <label className={labelCls} style={labelStyle}>
                Type
              </label>
              <div className="flex gap-2">
                {(["ed25519", "rsa"] as Algo[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAlgo(a)}
                    className="flex-1 rounded-md border px-3 py-2 text-sm"
                    style={{
                      background: algo === a ? "var(--m-accent, #2563eb)" : "var(--m-input)",
                      borderColor: "var(--m-input-border)",
                      color: algo === a ? "#fff" : "var(--m-text)",
                    }}
                  >
                    {a === "ed25519" ? "Ed25519 (recommended)" : "RSA"}
                  </button>
                ))}
              </div>
            </div>

            {algo === "rsa" && (
              <div className="mb-3">
                <label className={labelCls} style={labelStyle}>
                  Key size
                </label>
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={bits}
                  onChange={(e) => setBits(Number(e.target.value))}
                >
                  <option value={2048}>2048 bits</option>
                  <option value={3072}>3072 bits</option>
                  <option value={4096}>4096 bits</option>
                </select>
              </div>
            )}

            <div className="mb-3">
              <label className={labelCls} style={labelStyle}>
                Comment
              </label>
              <input
                className={inputCls}
                style={inputStyle}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="you@host"
              />
            </div>

            <div className="mb-3 flex gap-2">
              <div className="flex-1">
                <label className={labelCls} style={labelStyle}>
                  Passphrase (optional)
                </label>
                <input
                  type="password"
                  className={inputCls}
                  style={inputStyle}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className={labelCls} style={labelStyle}>
                  Confirm
                </label>
                <input
                  type="password"
                  className={inputCls}
                  style={inputStyle}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className={labelCls} style={labelStyle}>
                Save to
              </label>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  style={inputStyle}
                  value={outPath}
                  onChange={(e) => {
                    setOutPath(e.target.value);
                    setPathEdited(true);
                  }}
                  placeholder="C:\\Users\\you\\.ssh\\id_ed25519"
                />
                <button
                  type="button"
                  onClick={() => void pickPath()}
                  className="shrink-0 rounded-md border px-3 text-xs"
                  style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
                >
                  Browse
                </button>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--m-muted)" }}>
                🔒 The key stays on this device — only the profile syncs.
              </p>
            </div>

            {error && (
              <div className="mb-3 text-xs text-red-400">
                {error}
                {error.includes("already exists") && (
                  <label className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: "var(--m-muted)" }}>
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    Overwrite the existing file
                  </label>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="rounded-md px-4 py-2 text-sm font-medium"
                style={{ background: "var(--m-input)", color: "var(--m-text)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void generate()}
                disabled={busy}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? "Generating…" : "Generate"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: "var(--m-muted)" }}>
              Key created. Add the public key below to the server's{" "}
              <code>~/.ssh/authorized_keys</code>, then connect with this profile.
            </p>
            <div className="mt-3">
              <label className={labelCls} style={labelStyle}>
                Public key
              </label>
              <textarea
                readOnly
                rows={3}
                className={`${inputCls} font-mono text-[11px]`}
                style={inputStyle}
                value={result.publicOpenssh}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => void copyPublic()}
                className="mt-2 flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs"
                style={{ borderColor: "var(--m-input-border)", color: "var(--m-text)" }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy public key"}
              </button>
            </div>
            <div className="mt-3 text-[11px]" style={{ color: "var(--m-muted)" }}>
              <div>Private key: <code>{result.privatePath}</code></div>
              <div>Public key: <code>{result.publicPath}</code></div>
              <div className="mt-1">
                This profile now uses key authentication with the new key.
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end">
              <button
                onClick={onCancel}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

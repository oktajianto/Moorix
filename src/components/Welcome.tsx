import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../settings";
import { DEFAULT_THEME } from "../themes";
import logo from "../assets/moorix-logo.png";

export function Welcome({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const isLight = settings.themeName === "Light";

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center p-6"
      style={{ background: "var(--m-bg)" }}
    >
      <div className="w-full max-w-md text-center">
        <img
          src={logo}
          alt="Moorix"
          width={96}
          height={96}
          className="mx-auto rounded-2xl"
        />
        <h1 className="mt-4 text-3xl font-bold" style={{ color: "var(--m-text)" }}>
          Moorix
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--m-muted)" }}>
          Cross-platform terminal &amp; SSH client
        </p>

        <div className="mt-8 flex flex-col gap-4 text-left">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ color: "var(--m-text)" }}>
                Color scheme
              </p>
              <p className="text-xs" style={{ color: "var(--m-muted)" }}>
                Pick a starting look
              </p>
            </div>
            <div
              className="flex overflow-hidden rounded-md border"
              style={{ borderColor: "var(--m-input-border)" }}
            >
              <button
                onClick={() => update({ themeName: DEFAULT_THEME })}
                className="px-3 py-1.5 text-xs"
                style={
                  !isLight
                    ? { background: "#0891b2", color: "#fff" }
                    : { background: "var(--m-input)", color: "var(--m-muted)" }
                }
              >
                Dark
              </button>
              <button
                onClick={() => update({ themeName: "Light" })}
                className="px-3 py-1.5 text-xs"
                style={
                  isLight
                    ? { background: "#0891b2", color: "#fff" }
                    : { background: "var(--m-input)", color: "var(--m-muted)" }
                }
              >
                Light
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={onClose}
            className="rounded-md bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500"
          >
            Get started
          </button>
          <button
            onClick={async () => {
              try {
                const code = await invoke<string>("start_google_login");
                const token = await invoke<{ access_token: string }>("exchange_google_token", { code });
                alert("Login sukses! Access token: " + token.access_token.substring(0, 10) + "...");
                // Note: The rest of the download & import logic would continue here
              } catch (err: any) {
                alert("Gagal login: " + err);
              }
            }}
            className="rounded-md border px-5 py-2.5 text-sm font-medium transition hover:bg-black/20"
            style={{ borderColor: "var(--m-border)", color: "var(--m-text)" }}
          >
            Pulihkan dari Google Drive
          </button>
        </div>
      </div>
    </div>
  );
}

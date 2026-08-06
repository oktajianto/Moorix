import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./settings";
import { ToastProvider } from "./components/Toast";
import { EditorProvider } from "./editorStore";
import { EditorOverlay } from "./components/EditorOverlay";
import { maybeAutoPull } from "./cloudSync";
import "./monaco"; // configure Monaco to load locally (offline-safe) before any editor mounts
import "./index.css";

function mount() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <SettingsProvider>
        <ToastProvider>
          <EditorProvider>
            <App />
            <EditorOverlay />
          </EditorProvider>
        </ToastProvider>
      </SettingsProvider>
    </React.StrictMode>,
  );
}

// Before mounting, give auto-sync a chance to pull a newer backup from Google
// Drive and relaunch. If it does, we skip rendering this (about-to-restart)
// instance so the store plugin never writes its stale cache over the import.
maybeAutoPull(() =>
  window.prompt(
    "Sync Master Password (to pull the setup from another device):",
  ),
)
  .then((relaunching) => {
    if (!relaunching) mount();
  })
  .catch(() => mount());

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./settings";
import { ToastProvider } from "./components/Toast";
import { maybeAutoPull } from "./cloudSync";
import "./index.css";

function mount() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <SettingsProvider>
        <ToastProvider>
          <App />
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
    "Master Password sinkronisasi (untuk menarik setup dari perangkat lain):",
  ),
)
  .then((relaunching) => {
    if (!relaunching) mount();
  })
  .catch(() => mount());

import React from "react";
import ReactDOM from "react-dom/client";
import { BackupBanner } from "./components/BackupBanner";

/** Boot the lightweight always-on-top auto-backup progress banner window. */
export function mountBanner() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <BackupBanner />
    </React.StrictMode>,
  );
}

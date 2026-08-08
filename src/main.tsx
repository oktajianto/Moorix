import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./index.css";

// Both the main app and the tiny always-on-top backup banner load this same
// bundle. Branch by window label and lazily pull in only the code that window
// needs — the banner must not drag in Monaco/xterm/the whole app tree.
if (getCurrentWebviewWindow().label === "backup-banner") {
  void import("./bootBanner").then((m) => m.mountBanner());
} else {
  void import("./bootMain").then((m) => m.mountMain());
}

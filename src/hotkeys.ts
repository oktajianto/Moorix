/**
 * Hotkey system. A flat registry of app actions, each with default key
 * combos; users override them in Settings → Hotkeys. Combos are stored as
 * strings like "Ctrl-Shift-C" produced by `eventToCombo` so capture and
 * matching stay consistent.
 */

export type HotkeyAction = {
  id: string;
  label: string;
  defaults: string[];
};

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  // Terminal
  { id: "copy", label: "Copy to clipboard", defaults: ["Ctrl-Shift-C"] },
  { id: "paste", label: "Paste from clipboard", defaults: ["Ctrl-Shift-V", "Shift-Insert"] },
  { id: "select-all", label: "Select all", defaults: ["Ctrl-Shift-A"] },
  { id: "clear", label: "Clear terminal", defaults: [] },
  // Zoom
  { id: "zoom-in", label: "Zoom in", defaults: ["Ctrl-=", "Ctrl-Shift-="] },
  { id: "zoom-out", label: "Zoom out", defaults: ["Ctrl--", "Ctrl-Shift--"] },
  { id: "reset-zoom", label: "Reset zoom", defaults: ["Ctrl-0"] },
  // Tabs
  { id: "new-tab", label: "New tab", defaults: ["Ctrl-Shift-T"] },
  { id: "close-tab", label: "Close tab", defaults: ["Ctrl-Shift-W"] },
  { id: "next-tab", label: "Next tab", defaults: ["Ctrl-Tab", "Ctrl-Shift-Right"] },
  { id: "previous-tab", label: "Previous tab", defaults: ["Ctrl-Shift-Tab", "Ctrl-Shift-Left"] },
  { id: "tab-1", label: "Tab 1", defaults: ["Alt-1"] },
  { id: "tab-2", label: "Tab 2", defaults: ["Alt-2"] },
  { id: "tab-3", label: "Tab 3", defaults: ["Alt-3"] },
  { id: "tab-4", label: "Tab 4", defaults: ["Alt-4"] },
  { id: "tab-5", label: "Tab 5", defaults: ["Alt-5"] },
  { id: "tab-6", label: "Tab 6", defaults: ["Alt-6"] },
  { id: "tab-7", label: "Tab 7", defaults: ["Alt-7"] },
  { id: "tab-8", label: "Tab 8", defaults: ["Alt-8"] },
  { id: "tab-9", label: "Tab 9 (last)", defaults: ["Alt-9"] },
  // Window
  { id: "settings", label: "Open Settings", defaults: ["Ctrl-,"] },
  { id: "toggle-fullscreen", label: "Toggle fullscreen mode", defaults: ["F11"] },
  // Panes
  { id: "split-right", label: "Split to the right", defaults: ["Ctrl-Shift-S"] },
  { id: "split-bottom", label: "Split to the bottom", defaults: ["Ctrl-Shift-D"] },
  { id: "close-pane", label: "Close focused pane", defaults: ["Ctrl-Shift-X"] },
];

export type HotkeyId =
  | "copy" | "paste" | "select-all" | "clear"
  | "zoom-in" | "zoom-out" | "reset-zoom"
  | "new-tab" | "close-tab" | "next-tab" | "previous-tab"
  | "tab-1" | "tab-2" | "tab-3" | "tab-4" | "tab-5"
  | "tab-6" | "tab-7" | "tab-8" | "tab-9"
  | "settings" | "toggle-fullscreen"
  | "split-right" | "split-bottom" | "close-pane";

/** Shifted US-layout symbols normalised back to their base key so a combo is
 *  stable whether or not Shift is held. */
const SHIFT_SYMBOL: Record<string, string> = {
  "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7",
  "*": "8", "(": "9", ")": "0", _: "-", "+": "=", "{": "[", "}": "]",
  "|": "\\", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", "~": "`",
};

const KEY_ALIAS: Record<string, string> = {
  ArrowRight: "Right", ArrowLeft: "Left", ArrowUp: "Up", ArrowDown: "Down",
  " ": "Space", Escape: "Esc", Delete: "Delete", Insert: "Insert",
};

/** Serialise a keydown into a combo string, or null for a lone modifier press. */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  let key = e.key;
  if (SHIFT_SYMBOL[key]) key = SHIFT_SYMBOL[key];
  else if (KEY_ALIAS[key]) key = KEY_ALIAS[key];
  else if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join("-");
}

/** Effective combos for an action = user override if present, else defaults. */
export function bindingsFor(
  action: HotkeyAction,
  overrides: Record<string, string[]>,
): string[] {
  return overrides[action.id] ?? action.defaults;
}

/** combo -> actionId lookup across all actions (last write wins on conflict). */
export function buildComboMap(
  overrides: Record<string, string[]>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const action of HOTKEY_ACTIONS) {
    for (const combo of bindingsFor(action, overrides)) {
      map.set(combo, action.id);
    }
  }
  return map;
}

/** True while the Settings hotkey editor is capturing a keypress — the global
 *  dispatcher must stand down so the captured key isn't also executed. */
let capturing = false;
export function setHotkeyCapture(on: boolean): void {
  capturing = on;
}
export function isCapturingHotkey(): boolean {
  return capturing;
}

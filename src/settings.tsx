import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_THEME } from "./themes";
import { getStore, setValue } from "./store";

export type CursorShape = "block" | "bar" | "underline";
export type RendererType = "webgl" | "dom";
export type BellMode = "off" | "visual" | "audible";
export type WindowFrame = "custom" | "native";

export type Settings = {
  fontSize: number;
  fontFamily: string;
  themeName: string;
  cursorBlink: boolean;
  autoUpdate: boolean;
  animations: boolean;
  // Appearance
  fontLigatures: boolean;
  normalFontWeight: number;
  boldFontWeight: number;
  cursorShape: CursorShape;
  minimumContrastRatio: number;
  fallbackFont: string;
  linePadding: number;
  customCSS: string;
  // Terminal — rendering
  rendererType: RendererType;
  scrollback: number;
  boldBright: boolean;
  sixel: boolean;
  // Terminal — keyboard
  altIsMeta: boolean;
  scrollOnInput: boolean;
  // Terminal — mouse
  rightClickPaste: boolean;
  pasteOnMiddleClick: boolean;
  wordSeparators: string;
  // Terminal — clipboard
  copyOnSelect: boolean;
  copyFormatting: boolean;
  bracketedPaste: boolean;
  warnMultilinePaste: boolean;
  replaceLineBreaks: boolean;
  trimWhitespace: boolean;
  // Terminal — links
  requireKeyToClickLinks: boolean;
  // Terminal — sound / startup
  bell: BellMode;
  autoOpenTerminal: boolean;
  restoreTabs: boolean;
  // Hotkeys — per-action overrides (actionId -> combos). Absent = use defaults.
  hotkeys: Record<string, string[]>;
  // Config sync
  syncHost: string;
  syncToken: string;
  syncHotkeys: boolean;
  syncWindow: boolean;
  syncVault: boolean;
  // SFTP
  sftpWidth: number;
  // Window
  windowFrame: WindowFrame;
  alwaysOnTop: boolean;
  hideTabIndex: boolean;
  hideTabCloseButton: boolean;
  closeOnLastTab: boolean;
  focusFollowsMouse: boolean;
  // Shell (local terminals)
  defaultShell: string;
  shellWorkingDir: string;
  // Profiles → Advanced
  showBuiltinProfiles: boolean;
  recentProfilesCount: number;
  recentProfiles: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 14,
  fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
  themeName: DEFAULT_THEME,
  cursorBlink: true,
  autoUpdate: true,
  animations: true,
  fontLigatures: false,
  normalFontWeight: 400,
  boldFontWeight: 700,
  cursorShape: "block",
  minimumContrastRatio: 1,
  fallbackFont: "",
  linePadding: 0,
  customCSS: "",
  rendererType: "webgl",
  scrollback: 1000,
  boldBright: true,
  sixel: false,
  altIsMeta: false,
  scrollOnInput: true,
  rightClickPaste: true,
  pasteOnMiddleClick: false,
  wordSeparators: " ()[]{}'\"`",
  copyOnSelect: false,
  copyFormatting: false,
  bracketedPaste: true,
  warnMultilinePaste: true,
  replaceLineBreaks: false,
  trimWhitespace: true,
  requireKeyToClickLinks: true,
  bell: "off",
  autoOpenTerminal: false,
  restoreTabs: false,
  hotkeys: {},
  syncHost: "",
  syncToken: "",
  syncHotkeys: true,
  syncWindow: true,
  syncVault: true,
  sftpWidth: 440,
  windowFrame: "custom",
  alwaysOnTop: false,
  hideTabIndex: false,
  hideTabCloseButton: false,
  closeOnLastTab: false,
  focusFollowsMouse: false,
  defaultShell: "",
  shellWorkingDir: "",
  showBuiltinProfiles: true,
  recentProfilesCount: 3,
  recentProfiles: [],
};

/** The effective xterm font stack: main family, plus an optional fallback
 *  family appended for glyphs the main font lacks. */
export function effectiveFontFamily(s: Settings): string {
  const fb = s.fallbackFont.trim();
  return fb ? `${s.fontFamily}, ${fb}` : s.fontFamily;
}

/** xterm `lineHeight` multiplier derived from the pixel "line padding". */
export function lineHeightOf(s: Settings): number {
  return s.fontSize > 0 ? 1 + Math.max(0, s.linePadding) / s.fontSize : 1;
}

const STORAGE_KEY = "moorix.settings";
const STORE_KEY = "settings";

type SettingsContextValue = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  // localStorage gives an instant first paint; the persistent tauri-plugin-store
  // (cross-platform, survives OS keychain-less mobile) is the source of truth and
  // is loaded right after mount, then mirrored back to both on every change.
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Skip the first store-write (it would just echo what we loaded) and debounce
  // subsequent writes so dragging a slider / typing custom CSS isn't chatty.
  const loadedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const saved = await store.get<Partial<Settings>>(STORE_KEY);
        if (saved && typeof saved === "object") {
          setSettings((prev) => ({ ...prev, ...saved }));
        }
      } catch {
        // Not in a Tauri runtime (e.g. plain browser) — localStorage stands in.
      } finally {
        loadedRef.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    // Always keep the instant localStorage cache fresh.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota / unavailable
    }
    // Persist to the store once the initial load has settled, debounced.
    if (!loadedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void setValue(STORE_KEY, settings).catch(() => {});
    }, 300);
  }, [settings]);

  const update = (patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  return (
    <SettingsContext.Provider value={{ settings, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}

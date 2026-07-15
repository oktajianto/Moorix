import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_THEME } from "./themes";

export type CursorShape = "block" | "bar" | "underline";

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

type SettingsContextValue = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_THEME } from "./themes";

export type Settings = {
  fontSize: number;
  fontFamily: string;
  themeName: string;
  cursorBlink: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 14,
  fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
  themeName: DEFAULT_THEME,
  cursorBlink: true,
};

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

import type { ITheme } from "@xterm/xterm";

/**
 * A curated import of popular iTerm2 color schemes (mapped to xterm `ITheme`).
 * These extend the built-in Moorix themes and are available anywhere a theme is
 * picked — the global Color scheme and the per-profile COLORS tab.
 *
 * Values are the widely-published palettes for each scheme (background,
 * foreground, cursor, selection, and the 16 ANSI colors).
 */
export const ITERM2_THEMES: Record<string, ITheme> = {
  Nord: {
    background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "#434c5e",
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1",
    magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
    brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
  },
  "Gruvbox Dark": {
    background: "#282828", foreground: "#ebdbb2", cursor: "#ebdbb2", selectionBackground: "#504945",
    black: "#282828", red: "#cc241d", green: "#98971a", yellow: "#d79921", blue: "#458588",
    magenta: "#b16286", cyan: "#689d6a", white: "#a89984",
    brightBlack: "#928374", brightRed: "#fb4934", brightGreen: "#b8bb26", brightYellow: "#fabd2f",
    brightBlue: "#83a598", brightMagenta: "#d3869b", brightCyan: "#8ec07c", brightWhite: "#ebdbb2",
  },
  Monokai: {
    background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f2", selectionBackground: "#49483e",
    black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75", blue: "#66d9ef",
    magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
    brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e", brightYellow: "#f4bf75",
    brightBlue: "#66d9ef", brightMagenta: "#ae81ff", brightCyan: "#a1efe4", brightWhite: "#f9f8f5",
  },
  "Catppuccin Mocha": {
    background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", selectionBackground: "#585b70",
    black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa",
    magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de",
    brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af",
    brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5", brightWhite: "#a6adc8",
  },
  "Catppuccin Latte": {
    background: "#eff1f5", foreground: "#4c4f69", cursor: "#dc8a78", selectionBackground: "#ccced7",
    black: "#5c5f77", red: "#d20f39", green: "#40a02b", yellow: "#df8e1d", blue: "#1e66f5",
    magenta: "#ea76cb", cyan: "#179299", white: "#acb0be",
    brightBlack: "#6c6f85", brightRed: "#d20f39", brightGreen: "#40a02b", brightYellow: "#df8e1d",
    brightBlue: "#1e66f5", brightMagenta: "#ea76cb", brightCyan: "#179299", brightWhite: "#bcc0cc",
  },
  "Night Owl": {
    background: "#011627", foreground: "#d6deeb", cursor: "#80a4c2", selectionBackground: "#1d3b53",
    black: "#011627", red: "#ef5350", green: "#22da6e", yellow: "#addb67", blue: "#82aaff",
    magenta: "#c792ea", cyan: "#21c7a8", white: "#ffffff",
    brightBlack: "#575656", brightRed: "#ef5350", brightGreen: "#22da6e", brightYellow: "#ffeb95",
    brightBlue: "#82aaff", brightMagenta: "#c792ea", brightCyan: "#7fdbca", brightWhite: "#ffffff",
  },
  Cobalt2: {
    background: "#132738", foreground: "#ffffff", cursor: "#f8dd00", selectionBackground: "#18364a",
    black: "#000000", red: "#ff0000", green: "#38de21", yellow: "#ffe50a", blue: "#1460d2",
    magenta: "#ff005d", cyan: "#00bbbb", white: "#bbbbbb",
    brightBlack: "#555555", brightRed: "#f40e17", brightGreen: "#3bd01d", brightYellow: "#edc809",
    brightBlue: "#5555ff", brightMagenta: "#ff55ff", brightCyan: "#6ae3fa", brightWhite: "#ffffff",
  },
  Snazzy: {
    background: "#282a36", foreground: "#eff0eb", cursor: "#97979b", selectionBackground: "#78787e",
    black: "#282a36", red: "#ff5c57", green: "#5af78e", yellow: "#f3f99d", blue: "#57c7ff",
    magenta: "#ff6ac1", cyan: "#9aedfe", white: "#f1f1f0",
    brightBlack: "#686868", brightRed: "#ff5c57", brightGreen: "#5af78e", brightYellow: "#f3f99d",
    brightBlue: "#57c7ff", brightMagenta: "#ff6ac1", brightCyan: "#9aedfe", brightWhite: "#f1f1f0",
  },
  Palenight: {
    background: "#292d3e", foreground: "#d0d0d0", cursor: "#ffcc00", selectionBackground: "#3c435e",
    black: "#292d3e", red: "#f07178", green: "#c3e88d", yellow: "#ffcb6b", blue: "#82aaff",
    magenta: "#c792ea", cyan: "#89ddff", white: "#d0d0d0",
    brightBlack: "#434758", brightRed: "#ff8b92", brightGreen: "#ddffa7", brightYellow: "#ffe585",
    brightBlue: "#9cc4ff", brightMagenta: "#e1acff", brightCyan: "#a3f7ff", brightWhite: "#ffffff",
  },
  "Oceanic Next": {
    background: "#1b2b34", foreground: "#c0c5ce", cursor: "#c0c5ce", selectionBackground: "#4f5b66",
    black: "#1b2b34", red: "#ec5f67", green: "#99c794", yellow: "#fac863", blue: "#6699cc",
    magenta: "#c594c5", cyan: "#5fb3b3", white: "#c0c5ce",
    brightBlack: "#65737e", brightRed: "#ec5f67", brightGreen: "#99c794", brightYellow: "#fac863",
    brightBlue: "#6699cc", brightMagenta: "#c594c5", brightCyan: "#5fb3b3", brightWhite: "#d8dee9",
  },
  "Ayu Dark": {
    background: "#0a0e14", foreground: "#b3b1ad", cursor: "#e6b450", selectionBackground: "#273747",
    black: "#01060e", red: "#ea6c73", green: "#91b362", yellow: "#f9af4f", blue: "#53bdfa",
    magenta: "#fae994", cyan: "#90e1c6", white: "#c7c7c7",
    brightBlack: "#686868", brightRed: "#f07178", brightGreen: "#c2d94c", brightYellow: "#ffb454",
    brightBlue: "#59c2ff", brightMagenta: "#ffee99", brightCyan: "#95e6cb", brightWhite: "#ffffff",
  },
  "Ayu Mirage": {
    background: "#1f2430", foreground: "#cbccc6", cursor: "#ffcc66", selectionBackground: "#34455a",
    black: "#191e2a", red: "#ed8274", green: "#a6cc70", yellow: "#fad07b", blue: "#6dcbfa",
    magenta: "#cfbafa", cyan: "#90e1c6", white: "#c7c7c7",
    brightBlack: "#686868", brightRed: "#f28779", brightGreen: "#bae67e", brightYellow: "#ffd580",
    brightBlue: "#73d0ff", brightMagenta: "#d4bfff", brightCyan: "#95e6cb", brightWhite: "#ffffff",
  },
  "Ayu Light": {
    background: "#fafafa", foreground: "#5c6773", cursor: "#ff9940", selectionBackground: "#d9d8d7",
    black: "#000000", red: "#ff3333", green: "#86b300", yellow: "#f29718", blue: "#41a6d9",
    magenta: "#f07178", cyan: "#4dbf99", white: "#ffffff",
    brightBlack: "#323232", brightRed: "#ff6565", brightGreen: "#b8e532", brightYellow: "#ffc94a",
    brightBlue: "#73d8ff", brightMagenta: "#ffa3aa", brightCyan: "#7ff1cb", brightWhite: "#ffffff",
  },
  "GitHub Dark": {
    background: "#24292e", foreground: "#d1d5da", cursor: "#c8e1ff", selectionBackground: "#444d56",
    black: "#586069", red: "#ea4a5a", green: "#34d058", yellow: "#ffea7f", blue: "#2188ff",
    magenta: "#b392f0", cyan: "#39c5cf", white: "#d1d5da",
    brightBlack: "#959da5", brightRed: "#f97583", brightGreen: "#85e89d", brightYellow: "#ffea7f",
    brightBlue: "#79b8ff", brightMagenta: "#b392f0", brightCyan: "#56d4dd", brightWhite: "#fafbfc",
  },
  "GitHub Light": {
    background: "#ffffff", foreground: "#24292e", cursor: "#24292e", selectionBackground: "#c8e1ff",
    black: "#24292e", red: "#d73a49", green: "#22863a", yellow: "#b08800", blue: "#0366d6",
    magenta: "#5a32a3", cyan: "#1b7c83", white: "#6a737d",
    brightBlack: "#959da5", brightRed: "#cb2431", brightGreen: "#28a745", brightYellow: "#dbab09",
    brightBlue: "#2188ff", brightMagenta: "#8a63d2", brightCyan: "#3192aa", brightWhite: "#d1d5da",
  },
  "Solarized Light": {
    background: "#fdf6e3", foreground: "#657b83", cursor: "#586e75", selectionBackground: "#eee8d5",
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2",
    magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
    brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
    brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
  },
  "Tomorrow Night": {
    background: "#1d1f21", foreground: "#c5c8c6", cursor: "#c5c8c6", selectionBackground: "#373b41",
    black: "#000000", red: "#cc6666", green: "#b5bd68", yellow: "#f0c674", blue: "#81a2be",
    magenta: "#b294bb", cyan: "#8abeb7", white: "#ffffff",
    brightBlack: "#000000", brightRed: "#cc6666", brightGreen: "#b5bd68", brightYellow: "#f0c674",
    brightBlue: "#81a2be", brightMagenta: "#b294bb", brightCyan: "#8abeb7", brightWhite: "#ffffff",
  },
  "Base16 Default Dark": {
    background: "#181818", foreground: "#d8d8d8", cursor: "#d8d8d8", selectionBackground: "#282828",
    black: "#181818", red: "#ab4642", green: "#a1b56c", yellow: "#f7ca88", blue: "#7cafc2",
    magenta: "#ba8baf", cyan: "#86c1b9", white: "#d8d8d8",
    brightBlack: "#585858", brightRed: "#ab4642", brightGreen: "#a1b56c", brightYellow: "#f7ca88",
    brightBlue: "#7cafc2", brightMagenta: "#ba8baf", brightCyan: "#86c1b9", brightWhite: "#f8f8f8",
  },
};

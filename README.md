# Moorix

Cross-platform terminal & SSH client — built with **Tauri 2**.

Terinspirasi Tabby, dengan satu codebase yang menjangkau **desktop dan mobile**.

| Platform | Local shell | SSH / Telnet / Serial |
|---|---|---|
| Windows / Linux / macOS | ✅ PTY asli | ✅ |
| Android / iOS | ❌ (batasan OS) | ✅ SSH-only |

## Tech stack

- **Backend:** Rust + Tauri 2 (`russh`, `portable-pty`, `serialport`)
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Terminal rendering:** xterm.js
- **Package manager:** pnpm

Lihat [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) untuk arsitektur & roadmap lengkap.

## Prasyarat

- Rust (stable) + cargo
- Node.js LTS + pnpm
- Windows: VS C++ Build Tools + WebView2
- Android: Android Studio + SDK + NDK
- iOS: macOS + Xcode + Apple Developer account

## Development

```bash
pnpm install

# Desktop
pnpm tauri dev

# Build desktop
pnpm tauri build

# Android (setelah `pnpm tauri android init`)
pnpm tauri android dev
```

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Lisensi

Proprietary — © 2026 Hammam Oktajianto. All rights reserved. Lihat [LICENSE](./LICENSE).
Kode ini boleh dilihat untuk referensi, tetapi **tidak** boleh disalin, dimodifikasi, atau didistribusikan tanpa izin tertulis.

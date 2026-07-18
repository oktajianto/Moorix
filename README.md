# Moorix

**The complete hosting, VPS, and cloud management app — SSH terminal and SFTP in one window, no more app-switching.**

Managing a server used to mean juggling PuTTY for the terminal, FileZilla for file transfers, and a notepad full of credentials. **Moorix brings it all together**: SSH, FileZilla-style dual-pane SFTP, Telnet, Serial, port forwarding, and an encrypted credential vault — in one fast, lightweight app.

![Moorix layout — SSH terminal and dual-pane SFTP side by side in a single window](./moorix-layout-sample.png)

## Why Moorix?

- 🖥️ **SSH terminal + SFTP at the same time** — run commands while dragging and dropping files in the SFTP panel, without switching apps or logging in twice.
- 📁 **FileZilla-style dual-pane SFTP** — recursive upload/download with progress & cancel, drag-and-drop from your OS, right-click to compress/extract ZIP, rename, SHA-256 checksum, or "Open in Terminal".
- 🔐 **Encrypted credential vault** — passwords & private keys live in your OS keychain, protected by a master password (AES-GCM). No more credentials scattered around.
- 🔀 **SSH port forwarding** — Local (-L) and Dynamic/SOCKS5 (-D) straight from your saved profiles.
- ☁️ **Cross-device sync via Google Drive** — settings & vault sync end-to-end encrypted; moving to a new machine is just one pull away.
- 🎨 **Split panes, multi-tab, 17+ themes** (Nord, Gruvbox, Catppuccin, and more) + custom keybindings.
- 🔄 **Silent auto-update** — always on the latest version, no manual reinstalls.

> **⬇️ Try it now — free:** grab the installer for Windows (`.exe`), macOS (`.dmg`), or Linux (`.AppImage`/`.deb`) from the **[Releases](https://github.com/oktajianto/Moorix/releases/latest)** page, install in seconds, and feel the difference of managing your VPS from a single window. Your server will never feel far away again.

| Platform | Local shell | SSH / Telnet / Serial | SFTP |
|---|---|---|---|
| Windows / Linux / macOS | ✅ native PTY | ✅ | ✅ |
| Android / iOS | ❌ (OS limitation) | ✅ SSH-only | — |

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

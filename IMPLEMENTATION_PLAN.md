# Moorix — Implementation Plan

> Cross-platform terminal & SSH client, dibangun dengan **Tauri 2**.
> Satu codebase yang menjangkau desktop **dan** mobile.

Status dokumen: **Draft v1** · Terakhir diperbarui: 2026-07-15

---

## 0. Status Progress (ringkas)

| Fase | Fokus | Status |
|---|---|---|
| 0 | Setup & scaffolding (Tauri 2 + React + Tailwind) | ✅ |
| 1 | Terminal core (xterm.js + PTY desktop) | ✅ |
| 2 | SSH client (russh, password/key, host-key TOFU) | ✅ |
| 3 | Tabs + custom title bar | ✅ |
| 4 | Welcome + Settings + Themes | ✅ |
| 5 | Profiles + secrets (keychain) + editor SSH | ✅ |
| 6 | Split pane (resizable, pool preservation) | ✅ |
| 7A | Mobile-ready code (gate PTY/keyring, SSH-only, auto-reconnect) | ✅ |
| 7B | Android build → **signed release APK** | ✅ |
| 8 | Serial (desktop) + Telnet transports | ✅ |
| 9 | Advanced — SSH port forwarding **Local + Dynamic** | 🟡 (Remote -R, SFTP, sync, jump host: ⬜) |

**Berikutnya (kandidat):** port forwarding Remote (-R) · SFTP file browser · jump host + agent forwarding · sync profil (E2E) · plugin system · profile-editor Serial/Telnet (§17) · toast UI status forward.

> Detail per fase ada di **§16 Progress Log**. Kolom "Status" di-update tiap fase (jangan dihapus).

---

## 1. Ringkasan & Tujuan

Moorix adalah aplikasi terminal modern lintas platform:

- **Desktop (Windows, Linux, macOS):** terminal penuh — local shell (PTY), SSH, Telnet, Serial.
- **Mobile (Android, iOS):** **SSH-only** (karena OS melarang/menyulitkan local shell — lihat §3).

Prinsip desain:
- **Satu core codebase**, perbedaan platform di-*gate* dengan `#[cfg(desktop)]` / `#[cfg(mobile)]` di sisi Rust dan feature-flag di frontend.
- **Reuse xterm.js** untuk rendering terminal → tampilan konsisten & matang.
- **Performa native** lewat backend Rust (russh, portable-pty), binari kecil.

---

## 2. Scope & Matriks Platform

| Fitur | Windows | Linux | macOS | Android | iOS |
|---|---|---|---|---|---|
| Local shell (PTY) | ✅ | ✅ | ✅ | ❌ | ❌ |
| SSH client | ✅ | ✅ | ✅ | ✅ | ✅ |
| Telnet | ✅ | ✅ | ✅ | ✅ | ✅ |
| Serial | ✅ | ✅ | ✅ | ⚠️ (USB-OTG, nanti) | ❌ |
| Tabs & split pane | ✅ | ✅ | ✅ | ✅ (tab) | ✅ (tab) |
| Profile manager | ✅ | ✅ | ✅ | ✅ | ✅ |
| Secure credential store | ✅ | ✅ | ✅ | ✅ | ✅ |

**Catatan mobile:**
- iOS memutus koneksi jaringan saat app di-background → wajib ada **auto-reconnect** + indikator status.
- Android butuh permission `INTERNET` (standar).

---

## 3. Kendala Platform (yang sudah diputuskan)

- **iOS** melarang `fork/exec` binari arbitrer → tidak ada local shell. SSH pakai TCP keluar (russh) → aman.
- **Android** mengizinkan proses dalam sandbox app (gaya Termux), tapi ada aturan W^X sejak Android 10+ dan kebijakan Play Store ketat → **local shell tidak masuk scope v1** (mungkin fitur lanjutan jauh).
- **Desktop** bebas: PTY asli via `portable-pty`.

Kesimpulan: **desktop = full, mobile = SSH-first.**

---

## 4. Tech Stack

### Backend (Rust — `src-tauri/`)
| Kebutuhan | Crate | Platform |
|---|---|---|
| Framework | `tauri` 2.x | semua |
| Async runtime | `tokio` | semua |
| SSH | `russh` + `russh-keys` | semua |
| SFTP (nanti) | `russh-sftp` | semua |
| Local PTY | `portable-pty` | desktop |
| Serial | `serialport` | desktop |
| Secure storage | `tauri-plugin-stronghold` (terenkripsi, lintas platform) | semua |
| Config store | `tauri-plugin-store` (JSON) | semua |
| OS info | `tauri-plugin-os` | semua |
| Clipboard | `tauri-plugin-clipboard-manager` | semua |
| Logging | `tauri-plugin-log` + `tracing` | semua |

### Frontend (`src/`)
| Kebutuhan | Pilihan |
|---|---|
| Framework | **React + TypeScript + Vite** (default Tauri; ekosistem & contoh xterm.js paling banyak) |
| Terminal render | `@xterm/xterm` + addons: `addon-fit`, `addon-webgl`, `addon-web-links`, `addon-search`, `addon-unicode11` |
| Split pane | `allotment` (resizable split panes untuk React) |
| State | `zustand` (ringan) |
| Styling | CSS Modules / Tailwind (opsional) |

> **Keputusan frontend (terkunci):** **React + TypeScript**, package manager **pnpm**, lisensi **MIT**.

---

## 5. Arsitektur

### 5.1 Diagram alur data terminal

```
┌─────────────── Frontend (WebView) ───────────────┐
│  xterm.js  ──onData(keystroke)──►  invoke()       │
│     ▲                                   │          │
│     │ write(bytes)                      ▼          │
│  Tauri Channel  ◄──emit(bytes)──  Rust command     │
└───────────────────────────────────────┼──────────┘
                                         ▼
                       ┌──────── SessionManager ────────┐
                       │  HashMap<SessionId, Session>    │
                       │   ├─ PtySession   (desktop)     │
                       │   ├─ SshSession   (russh)       │
                       │   ├─ SerialSession(desktop)     │
                       │   └─ TelnetSession              │
                       └─────────────────────────────────┘
```

- **Input:** xterm.js `onData` → `invoke("session_write", {id, data})`.
- **Output:** setiap Session menjalankan task tokio yang membaca byte dari transport → dikirim ke frontend lewat **Tauri `Channel`** (streaming efisien) → `terminal.write(bytes)`.
- **Resize:** `addon-fit` hitung cols/rows → `invoke("session_resize", {id, cols, rows})`.

### 5.2 Abstraksi transport (Rust)

```rust
#[async_trait]
trait Transport: Send {
    async fn write(&mut self, data: &[u8]) -> Result<()>;
    async fn resize(&mut self, cols: u16, rows: u16) -> Result<()>;
    async fn read_loop(self, sink: Channel<Vec<u8>>) -> Result<()>;
    async fn close(&mut self) -> Result<()>;
}
```

Implementasi: `PtyTransport`, `SshTransport`, `SerialTransport`, `TelnetTransport`.
`PtyTransport` & `SerialTransport` hanya di-compile untuk desktop (`#[cfg(desktop)]`).

### 5.3 Commands (Tauri IPC)

- `session_open(profile) -> SessionId`
- `session_write(id, data)`
- `session_resize(id, cols, rows)`
- `session_close(id)`
- `profiles_list() / profiles_save(profile) / profiles_delete(id)`
- `secret_set(key, value) / secret_get(key)` (via stronghold)
- `settings_get() / settings_set(...)`

---

## 6. Struktur Proyek

```
Moorix/
├── IMPLEMENTATION_PLAN.md        # dokumen ini
├── package.json
├── vite.config.ts
├── index.html
├── src/                          # Frontend (React + TS)
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Terminal/             # wrapper xterm.js
│   │   ├── TabBar/
│   │   ├── SplitPane/
│   │   ├── ProfileManager/
│   │   └── Settings/
│   ├── lib/
│   │   ├── ipc.ts                # wrapper invoke()/Channel
│   │   ├── session.ts
│   │   └── themes.ts
│   ├── stores/                   # zustand
│   └── styles/
└── src-tauri/                    # Backend (Rust)
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/             # permission mobile/desktop
    ├── icons/
    └── src/
        ├── main.rs
        ├── lib.rs
        ├── state.rs              # SessionManager
        ├── commands.rs
        └── session/
            ├── mod.rs
            ├── transport.rs      # trait Transport
            ├── pty.rs            # #[cfg(desktop)]
            ├── ssh.rs
            ├── serial.rs         # #[cfg(desktop)]
            └── telnet.rs
```

---

## 7. Fitur: MVP vs Lanjutan

### MVP (v0.1) — target pertama
- [ ] Desktop: buka **local shell** dalam tab
- [ ] Semua platform: buka **SSH** (auth password + private key)
- [ ] Tab management (buka/tutup/pindah)
- [ ] 1 tema default + font monospace
- [ ] Settings dasar (font size, tema)
- [x] Mobile build jalan dengan SSH-only (Android APK; SSH-only, local shell di-gate)

### v0.2+
- [x] Split pane
- [ ] Profile/connection manager (simpan host, port, user, key)
- [ ] Secure credential store (stronghold)
- [ ] Banyak tema + import tema (format iTerm2)
- [ ] Keybinding kustom
- [x] Serial & Telnet (Serial desktop-only; Telnet cross-platform) — via Launcher quick-connect

### Lanjutan (v1.0+)
- [~] SSH port forwarding — Local (-L) & Dynamic (-D/SOCKS5) ✅; Remote (-R) ⬜
- [ ] SFTP file browser
- [ ] Sync profil antar device (terenkripsi)
- [ ] Plugin system
- [ ] Jump host / bastion, SSH agent forwarding

---

## 8. Fase Implementasi (Milestones)

| Fase | Fokus | Output |
|---|---|---|
| **0. Setup** | Scaffold Tauri 2 + React, konfigurasi Vite, jalankan window kosong di desktop | App boot |
| **1. Terminal core** | Integrasi xterm.js + PTY desktop, bridge Channel, resize | Bisa ketik di local shell |
| **2. SSH** | `SshTransport` (russh), auth password + key, uji ke server nyata | Bisa SSH dari desktop |
| **3. Tabs** | Tab bar, multi-session, lifecycle open/close | UI multi-tab |
| **4. Profiles + secrets** | CRUD profil koneksi + stronghold | Simpan & pakai profil |
| **5. Settings/Themes/Keys** | Panel settings, beberapa tema, keybinding | UX matang |
| **6. Split pane** | `allotment`, layout persist | Split view |
| **7. Mobile** | `tauri android init` lalu `ios init`, gate PTY, uji SSH di device, auto-reconnect | Build Android → iOS |
| **8. Serial + Telnet** | Transport tambahan (desktop) | Fitur lengkap desktop |
| **9. Advanced** | Port forwarding, SFTP, sync, plugin | Menuju v1.0 |

> Urutan disengaja: **desktop dulu sampai stabil**, mobile menyusul setelah core terbukti (Fase 7). Android sebelum iOS (iOS butuh macOS + Xcode + akun Apple Developer).

---

## 9. Tantangan Teknis & Solusi

| Tantangan | Solusi |
|---|---|
| Streaming byte terminal efisien | Tauri **`Channel`** (bukan event biasa) untuk output byte |
| Encoding/UTF-8 & escape sequence | xterm.js handle; kirim byte mentah, jangan konversi string |
| Resize race condition | Debounce fit → `session_resize`; PTY & SSH `window-change` |
| Host key verification (SSH) | Simpan known_hosts; prompt saat host baru (jangan auto-accept) |
| Secret disimpan aman | `tauri-plugin-stronghold` (terenkripsi), **jangan** plaintext |
| iOS koneksi mati saat background | Deteksi lifecycle, auto-reconnect, indikator status sesi |
| Private key berpassphrase | Prompt passphrase, decrypt via `russh-keys`, simpan di memori sesi |
| Perbedaan cfg desktop/mobile | `#[cfg(desktop)]` untuk pty/serial; feature-flag UI menyembunyikan menu |

---

## 10. Keamanan

- **Host key checking** wajib (cegah MITM); simpan known_hosts, konfirmasi host baru ke user.
- **Kredensial** hanya lewat stronghold terenkripsi; tidak pernah di config JSON plaintext.
- **Capabilities Tauri** dibatasi seminimal mungkin (prinsip least-privilege) di `capabilities/`.
- Passphrase & password hanya hidup di memori selama sesi.
- Tidak menyimpan/mengirim data koneksi ke pihak ketiga (sync harus end-to-end encrypted bila ada).

---

## 11. Testing

- **Rust unit test:** parsing profil, host-key logic, transport mock.
- **Integrasi SSH:** container `linuxserver/openssh-server` lokal sebagai target uji.
- **PTY:** uji spawn shell + echo di tiap OS desktop.
- **Manual/E2E:** matriks platform (minimal Windows + Linux + Android untuk awal).
- **CI:** GitHub Actions build per-OS (windows/ubuntu/macos runners).

---

## 12. Build & Distribusi

| Platform | Perintah | Artefak | Catatan |
|---|---|---|---|
| Windows | `tauri build` | `.msi` / `.exe` | code signing opsional |
| Linux | `tauri build` | `.deb` / `.AppImage` / `.rpm` | |
| macOS | `tauri build` | `.dmg` / `.app` | notarization utk distribusi |
| Android | `tauri android build` | `.apk` / `.aab` | butuh Android SDK + NDK; distribusi F-Droid/sideload aman utk fitur lanjutan |
| iOS | `tauri ios build` | `.ipa` | **butuh macOS + Xcode + Apple Developer ($99/th)** |

---

## 13. Prasyarat Pengembangan

- **Rust** (stable) + `cargo`
- **Node.js** (LTS) + package manager (pnpm/npm)
- **Tauri CLI 2:** `cargo install tauri-cli --version "^2"` atau `pnpm add -D @tauri-apps/cli@latest`
- **Windows:** Microsoft C++ Build Tools + WebView2
- **Linux:** `webkit2gtk`, `libssl`, dll (sesuai docs Tauri)
- **Android:** Android Studio, SDK, NDK, `ANDROID_HOME`/`NDK_HOME`
- **iOS:** macOS + Xcode + akun Apple Developer

---

## 14. Keputusan (Terkunci ✅ / Terbuka ⬜)

1. ✅ **Frontend framework** — **React + TypeScript**.
2. ✅ **Package manager** — **pnpm**.
3. ✅ **Lisensi & sifat proyek** — **Open source, MIT**.
4. ✅ **Urutan mobile** — **Android dulu**, iOS menyusul (butuh macOS + Xcode).
5. ✅ **Styling** — **Tailwind CSS**.

---

## 15. Langkah Berikutnya

Setelah plan ini disetujui:
1. **Fase 0** — scaffold `create-tauri-app` (React + TS) di dalam folder `Moorix/`.
2. Konfigurasi `tauri.conf.json`, identifier (`com.moorix.app`), window default.
3. Pasang dependency dasar (xterm.js, plugin store/stronghold).
4. Lanjut ke **Fase 1** (terminal core desktop).

---

## 16. Progress Log

### Fase 0 — Setup & Scaffolding ✅ SELESAI
- ✅ Prasyarat: Node 24, pnpm 11.12, WebView2, VS Build Tools (C++), Rust 1.97 (MSVC)
- ✅ Scaffold Tauri 2 (React + TS) via `create-tauri-app`
- ✅ Rebranding: `productName`/window "Moorix", identifier `com.moorix.app`, crate `moorix`/`moorix_lib`
- ✅ Tailwind CSS v4 terpasang (`@tailwindcss/vite`), `index.css` + UI awal Moorix
- ✅ LICENSE (MIT) + README
- ✅ Frontend build lolos (`pnpm build`)
- ✅ Rust/Tauri build lolos (`cargo build`, 458 crate, 2m14s) — toolchain MSVC OK
- ✅ `pnpm tauri dev` — window desktop "Moorix" tampil, Vite HTTP 200
- ✅ `git init` (branch `main`)

### Fase 1 — Terminal core (sedang berjalan)
- ✅ Dep frontend: `@xterm/xterm` 6, `addon-fit`, `addon-webgl`
- ✅ Dep backend: `portable-pty` 0.9
- ✅ `src-tauri/src/pty.rs` — `PtySession` (spawn shell, reader thread → Channel)
- ✅ `src-tauri/src/state.rs` — `AppState` (registry sesi + id counter)
- ✅ `src-tauri/src/commands.rs` — `session_open/write/resize/close`
- ✅ `src/components/TerminalView.tsx` — xterm.js ↔ IPC, fit + resize observer
- ✅ `App.tsx` — layout header + terminal full-height
- ✅ Frontend build lolos
- ✅ Rust build (dengan portable-pty)
- ✅ `pnpm tauri dev` — verifikasi bisa ketik di shell lokal nyata

**Catatan teknis Fase 1:**
- Output PTY dikirim sebagai `Vec<u8>` lewat Tauri `Channel` → di JS jadi `number[]` → `Uint8Array` ke xterm. Fungsional untuk MVP; optimasi (raw bytes/base64) menyusul bila throughput jadi isu.
- Default shell: `powershell.exe` (Windows), `$SHELL`/`/bin/bash` (Unix). cwd = home.
- Reader pakai `std::thread` (portable-pty I/O blocking), bukan tokio.

### Fase 2 — SSH client (sedang berjalan)
- ✅ Dep backend: `russh` 0.62, `tokio` (macros, sync, io-util)
- ✅ `src-tauri/src/ssh.rs` — `SshSession` (connect, auth password/key, request_pty+shell, IO loop `tokio::select!`)
- ✅ `state.rs` — refactor jadi enum `Session { Pty, Ssh }` → `session_write/resize/close` jalan untuk keduanya
- ✅ `commands.rs` — `ssh_open` (async command)
- ✅ Frontend: `TerminalView` digeneralisasi (prop `open`), `Launcher.tsx` (menu Local/SSH + form), `App.tsx` (launcher ↔ terminal + Disconnect)
- ✅ Frontend build lolos
- ✅ Rust build (russh)
- ✅ `pnpm tauri dev` — verifikasi konek SSH ke server nyata

**Catatan teknis Fase 2:**
- SSH pakai model input via `tokio::sync::mpsc`: command sync (`session_write/resize`) kirim pesan ke IO task async yang memegang russh channel. Output russh → Tauri Channel.
- Auth: password & private key (`load_secret_key` + `PrivateKeyWithHashAlg`).
- Backend kripto russh pakai `ring` (bukan `aws-lc-rs`) — hindari masalah build toolchain C di Windows.
- ✅ **Keamanan (host key) — SELESAI:** `check_server_key` sekarang TOFU: known & cocok → terima; known & berubah → tolak + event `host-key-mismatch`; unknown → prompt frontend (`host-key-prompt`) tampilkan fingerprint SHA256, tunggu keputusan via `host_key_decision`. Disimpan di `known_hosts.json` (app config dir). Bridge: `AppState.pending_host_keys` (oneshot).
- Belum ada auto-reconnect / keepalive (penting untuk mobile nanti).

### Fase 3 — Tabs + custom title bar ✅ SELESAI
- ✅ Window frameless (`decorations: false`) + minWidth/minHeight
- ✅ Izin window di `capabilities/default.json` (minimize/maximize/close/start-dragging)
- ✅ `src/components/TitleBar.tsx` — tab strip + tombol `+` + area drag (`data-tauri-drag-region`) + kontrol window (SVG ⚊ ▢ ✕)
- ✅ `App.tsx` — model multi-tab; semua tab tetap mounted (toggle `display`) → sesi tidak reset saat pindah tab
- ✅ TerminalView — guard fit saat tab tersembunyi (ukuran 0)
- ✅ Verifikasi manual: window controls, drag, buka/tutup/pindah tab, resize — semua jalan

**Catatan teknis Fase 3:**
- Backend tidak berubah — registry sesi sudah mendukung banyak sesi paralel; tiap tab = satu `SessionId`.
- Tab tetap di-*mount* (display none/block) agar xterm & sesi PTY/SSH tidak mati saat pindah tab.
- Middle-click / hover-✕ untuk menutup tab.

### Fase 4 — Welcome + Settings + Themes ✅ SELESAI
- ✅ `src/themes.ts` — 6 tema (Moorix Dark, Dracula, One Dark, Solarized Dark, Tokyo Night, Light)
- ✅ `src/settings.tsx` — Context + persist localStorage (fontSize, fontFamily, themeName, cursorBlink)
- ✅ `src/components/Settings.tsx` — panel overlay (tema+swatch, font, size slider, cursor blink)
- ✅ `src/components/Welcome.tsx` — first-launch (logo chevron Moorix sendiri, quick Dark/Light, Get started)
- ✅ `TerminalView` — terapkan settings live (font/tema) tanpa merusak sesi (pakai refs)
- ✅ `TitleBar` — tombol ⚙️; `main.tsx` — `SettingsProvider`; background area themable
- ✅ Frontend build lolos
- ✅ Verifikasi manual (Welcome, ganti tema live, settings)

**Catatan:** persist masih localStorage (MVP). Nanti pindah ke `tauri-plugin-store` agar konsisten lintas platform & lebih tahan.

### Fase 5 — Profiles & Settings page ✅ (iterasi berjalan)
- ✅ Chrome light/dark app-wide via CSS variables (`--m-*`), toggle class `.light` dari luminance tema
- ✅ Ikon app dari logo transparan user (`logo-transparant.png`) → `tauri icon` (desktop/iOS/Android), di-embed ke exe
- ✅ Logo user dipakai di Welcome
- ✅ Ikon UI pakai **lucide-react** (bukan emoji): sidebar Settings, daftar profil, palette, launcher, title bar
- ✅ **Quick-launch palette** (`ProfileMenu.tsx`) — tombol "Profiles & connections" setelah `+`; search + daftar profil + Manage profiles; keyboard ↑/↓/Enter/Esc
- ✅ **Registry profil** (`profiles.ts`) — built-in (PowerShell, CMD, Git Bash, SSH) dipakai bersama palette & Settings
- ✅ **Settings sebagai tab** (`SettingsPage.tsx`) ber-sidebar: Application, Appearance, Profiles & connections, Terminal, Color scheme, Config sync, Hotkeys, Shell, SSH, Vault, Window, Config file
  - Section **Profiles & connections → PROFILES**: Default profile selector, Filter, list berkelompok (Ungrouped / user groups / Built-in) dengan badge tipe
  - **New profile Group**: dropdown New ▾ → popup nama → grup tersimpan (`tauri-plugin-store`, key `profileGroups`)
  - Section **Color scheme** & **Terminal** (pindahan dari Settings lama); sisanya placeholder
- ✅ **tauri-plugin-store** — dep Rust + JS, capability `store:default`, `moorix.json` (key: `defaultProfileId`, `profileGroups`)
- ✅ Default profile → tombol `+` langsung buka profil default

### Fase 6 — Split pane ✅ SELESAI
- ✅ `src/paneTree.ts` — model tree pane per-tab (`PaneLeaf` / `PaneSplit` dir `row`/`col`, `sizes` fraksi) + helper murni: `makeLeaf`, `splitLeaf`, `closeLeaf` (collapse split 1-anak → renormalisasi sisa), `setSizesAtPath`, `findLeaf`/`firstLeaf`/`allLeaves`
- ✅ `src/components/SplitPane.tsx` — renderer rekursif `Panes` (flexbox: `flexGrow`=size, `flexBasis:0`) + `Divider` draggable (pointer events, hitung fraksi dari lebar/tinggi parent, clamp `MIN_PANE` 0.08) + toolbar hover per-pane (split right/down/close, ikon lucide `SquareSplit*`)
- ✅ **Sesi tidak mati saat split** — `TerminalView` di-refaktor pakai **pool modul** (`POOL: Map<paneId, PaneEntry>`): xterm + sesi backend hidup di luar mount React; saat tree berubah (leaf→split) DOM xterm di-*reparent* (`appendChild`), bukan dibuat ulang. Sesi hanya ditutup lewat `disposePane()` yang dipanggil App saat pane/tab benar-benar ditutup.
- ✅ `App.tsx` — tab terminal kini pegang `root: PaneNode` (bukan single terminal); state `activePaneId` (outline `--m-accent`), handler `splitPane`/`closePane`/`resizePane`, `closeTab` & `closePane` panggil `disposePane` untuk tiap leaf yang dibuang. Split = duplikat profil pane (reuse `open` closure → sesi baru independen).
- ✅ `--m-accent` ditambah ke `index.css` (dark/light) untuk highlight pane aktif
- ✅ Frontend build lolos (`pnpm build`)
- ✅ **Verifikasi** (harness browser, karena app penuh butuh runtime Tauri): split right/down + nested → layout benar; **pool preservation** — node xterm original bertahan identik melintasi split/close (sesi shell aman); divider drag proporsional presisi; close → collapse ke sibling + renormalisasi size. Plus 21 unit test murni `paneTree` lolos.

**Catatan teknis Fase 6:**
- "Layout persist" diartikan **selama sesi** (drag/re-render menjaga proporsi). Persist lintas restart app **tidak** dilakukan: sesi terminal bersifat ephemeral (PTY/SSH live), menyimpan layout tanpa sesi tak bermakna.
- Auto-close pane saat shell exit **belum** ada (sama seperti tab: backend belum emit event akhir sesi) → pane ditutup manual via tombol. Follow-up bareng auto-reconnect (Fase 7).
- `allotment` (disebut di §4) **tidak dipakai** — splitter kustom ringan dipilih agar dependensi minim (prinsip "binari kecil") & hindari risiko peer-dep React 19.

### Fase 7 — Mobile (bagian A: kode mobile-ready) ✅ SELESAI
> Scope sesi ini = **menyiapkan kode agar mobile-compilable & SSH-only**, TANPA `tauri android init`/build APK (butuh set env + JDK, ditunda). iOS di luar jangkauan (butuh macOS).

- ✅ **Gate backend desktop-only** (`#[cfg(desktop)]`):
  - `Cargo.toml` — `portable-pty` & `keyring` dipindah ke `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]` (tak ikut ter-compile di mobile)
  - `lib.rs` — `mod pty` di-gate desktop; `state.rs` — varian `Session::Pty` + lengan match di-gate; `commands.rs` — `session_open` badan desktop (PTY) / mobile (return `Err` "local shell not available")
- ✅ **Secret store split** (`secrets.rs`): desktop = OS keychain (`keyring`); mobile = in-memory session-only (placeholder aman; native EncryptedSharedPreferences/Keychain menyusul). Surface command `secret_set/get/delete` tetap sama.
- ✅ **plugin-os** — dep Rust `tauri-plugin-os` + JS `@tauri-apps/plugin-os`, registrasi di `lib.rs`, capability `os:default`. `src/platform.ts` → `IS_MOBILE` (deteksi `platform()`, fallback desktop di luar Tauri).
- ✅ **Frontend SSH-only di mobile**: `AVAILABLE_BUILTINS` menyaring profil `type:"local"` saat mobile → dipakai di `App` (default), `SettingsPage` (list+selector), `ProfileMenu` (palette). `Launcher` sembunyikan tombol "Local shell" di mobile.
- ✅ **SSH auto-reconnect + keepalive**:
  - keepalive sudah ada sejak Fase 5 (`config.keepalive_interval`/`keepalive_max`)
  - backend `ssh.rs` — emit `session-ended {id}` saat koneksi **putus tak terduga** (channel Eof/Close/None), bukan saat user tutup. Id di-assign di `ssh_open` sebelum `connect`.
  - frontend `TerminalView` — listener `session-ended`: pane dgn `sessionId` cocok & `reconnect:true` → reconnect otomatis **exponential backoff** (1s→15s, maks 5x) pakai channel & xterm yang sama (pool); reset saat sukses. **Initial connect gagal tidak** auto-retry. `TermOptions.reconnect=true` utk semua profil SSH.
- ✅ **Verifikasi**: `cargo check` (desktop) + `pnpm build`/`tsc` lolos; `pnpm tauri dev` boot bersih (window jalan, tanpa panic).

**Belum dikerjakan (bagian B, menyusul):**
- ~~`tauri android init` + build `.apk`~~ → ✅ **SELESAI** (lihat bagian B di bawah)
- ⬜ Native mobile secret store (Android EncryptedSharedPreferences / iOS Keychain).
- ⬜ iOS (butuh macOS + Xcode).

### Fase 7 — Mobile (bagian B: Android build) ✅ SELESAI
> Toolchain lokal: Android SDK+NDK sudah ada; JDK dipakai dari **JBR bawaan Android Studio**
> (`%LOCALAPPDATA%\Programs\Android Studio\jbr`, JDK 21). Env di-set **session-only** (tidak
> dipermanenkan di Windows atas permintaan user).

- ✅ `rustup target add` 4 ABI: `aarch64/armv7/i686/x86_64-linux-android`
- ✅ Env (session): `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`, `NDK_HOME=…\ndk\28.2.13676358`, `JAVA_HOME=…\Android Studio\jbr`
- ✅ `pnpm tauri android init` → proyek Gradle di `src-tauri/gen/android` (namespace/appId `com.moorix.app`, minSdk 24, targetSdk 36)
- ✅ **Cross-compile terbukti**: `libmoorix_lib.so` (arm64-v8a) ter-build → **gating `#[cfg(mobile)]` Fase 7A tervalidasi end-to-end** (PTY & keyring benar-benar tidak ikut compile di Android)
- ✅ **APK jadi**: `app-universal-debug.apk` (debug, arm64-v8a). Kendala Windows: symlink `.so` → jniLibs butuh **Developer Mode** ON (bukan masalah kode); setelah ON, Gradle assemble sukses.
- ✅ **git**: `gen/android` **di-commit** (proyek Android bisa dikustom). `.gitignore` bawaan Tauri sudah mengabaikan artefak build (`build/`, `.gradle`, `jniLibs/**/*.so`, `local.properties`) + kredensial (`keystore.properties`, `key.properties`). Repo `target/` juga di-ignore.
- ✅ **Release signing disiapkan**: `app/build.gradle.kts` diberi `signingConfigs.release` yang membaca `keystore.properties` (gitignored). Template committed: `keystore.properties.example`. **Keystore + password digenerate user sendiri** (`keytool`), tidak di-commit ke repo publik ini.

**Catatan / menyusul:**
- ✅ **Release APK ter-signing** — user generate keystore via `keytool` (alias `moorix`), `keystore.properties` diisi, `.jks` dicopy ke `src-tauri/gen/android/moorix-release.jks` (gitignored). `pnpm tauri android build --apk --target aarch64` → `app-universal-release.apk` **16.3 MB**, verifikasi `apksigner`: V2 signer `CN=hammam oktajianto, O=oktajianto.com, C=ID`. ⚠️ Keystore + password **wajib disimpan & di-backup** (tak tergantikan untuk update app).
- ⬜ Uji jalan di HP/emulator (`pnpm tauri android dev`) — bukti SSH di Android.
- ⚠️ NDK 28 dipakai; sempat ada exception **Kotlin daemon** saat Gradle build tapi auto-fallback "compile without daemon" → build tetap sukses. Pantau bila berulang (`./gradlew --stop`).
- Ikon app diganti ke `icon-logo-saja.png` via `tauri icon` (regen desktop/iOS/Android). Logo di dalam app (`src/assets/moorix-logo.png`) masih terpisah.

### Fase 8 — Serial + Telnet ✅ SELESAI
- ✅ **Serial (desktop-only)** — `src-tauri/src/serial.rs` `SerialSession` pakai crate `serialport` 4 (target-gated `cfg(not(android|ios))`). Reader thread (timeout 50ms, poll `AtomicBool` stop) → Channel; write langsung ke port. Command `serial_open(path, baud)` + `serial_ports()` (list port tersedia). `#[cfg(mobile)]` → return Err.
- ✅ **Telnet (cross-platform, TCP)** — `src-tauri/src/telnet.rs` `TelnetSession` (tokio TCP, model input mpsc seperti SSH). Parser negosiasi IAC minimal & **loop-safe**: setuju server ECHO+SGA, tolak opsi lain, skip subnegosiasi (SB…SE), escape `0xFF` (IAC IAC) di output. Command `telnet_open({host, port})`.
- ✅ `state.rs` — `Session` enum tambah `Serial` (desktop) & `Telnet`; write/resize(no-op)/kill di-handle. `lib.rs` daftarkan modul + command.
- ✅ **Frontend Launcher** — mode `menu/serial/telnet`. Menu: Local (desktop), SSH, Serial (desktop), Telnet. Form Serial: dropdown port (dari `serial_ports`, fallback text input `COM3`/`/dev/ttyUSB0`) + baud (9600–230400). Form Telnet: host + port (default 23). `serialOpen`/`telnetOpen` di `profiles.ts`. Serial disembunyikan di mobile (`IS_MOBILE`), Telnet tersedia semua platform.
- ✅ **Verifikasi**: `cargo check` (desktop) lolos; **8 unit test `TelnetParser`** (passthrough, escape IAC, agree ECHO/SGA, refuse lain, skip subneg, dedup anti-loop, IAC terpotong antar-read) lolos; `pnpm build` lolos; harness browser — menu→serial→telnet render benar, Telnet Connect memicu launch `host:port`.

**Catatan Fase 8:**
- Serial belum diuji dengan device fisik (butuh hardware). Telnet negosiasi teruji via unit test; end-to-end ke server nyata belum diuji dari UI Tauri (butuh window native).
- Serial/Telnet lewat **Launcher quick-connect**, belum jadi **saved profile** — template Serial/Telnet di `NewProfilePicker` masih disabled (butuh profile-editor per-tipe, ikut rancangan §17).
- Serial resize & Telnet NAWS di-no-op-kan (MVP).

### Fase 9 — Advanced: SSH Port Forwarding (iterasi 1) ✅ Local + Dynamic
> Fase 9 = keranjang (port forwarding / SFTP / sync / plugin / jump host). Iterasi 1
> fokus **port forwarding**, dimulai dari yang paling nyambung ke SSH yang sudah ada.

- ✅ `src-tauri/src/forward.rs` — forwarding sisi client via `direct-tcpip`:
  - **Local (-L)** `run_local`: `TcpListener` di `bindHost:bindPort` → tiap koneksi buka `channel_open_direct_tcpip(host, port)` → `copy_bidirectional(socket, channel.into_stream())`.
  - **Dynamic (-D)** `run_dynamic`: proxy **SOCKS5** (no-auth, CONNECT) → parse ATYP IPv4/domain/IPv6 → tunnel via `direct-tcpip`. Parser alamat + 4 unit test.
- ✅ `ssh.rs` — `Handle` di-share via `Arc<tokio::Mutex<Handle>>` (Handle bukan `Sync`/`Clone`; method `channel_open_direct_tcpip`/`disconnect` `&self`). Config `forwards: Vec<ForwardSpec>` (dari tab PORTS profil, port sebagai string → di-parse). `SshSession` simpan `JoinHandle` listener + `Drop` meng-abort (stop saat sesi tutup). Forward otomatis **re-establish saat auto-reconnect** (karena `sshOpenFromProfile` mengirim `forwards`).
- ✅ Frontend: `sshOpenFromProfile` kirim `forwards` (map dari `ssh.ports`). **UI tab PORTS sudah ada** sejak Fase 5 → tinggal jalan.
- ✅ **Verifikasi**: `cargo check` lolos; **4 unit test parser SOCKS** (IPv4/domain/IPv6/length salah) + 8 telnet = 12 lolos; `pnpm build` lolos.

**Catatan Fase 9:**
- **Remote (-R) belum** — butuh `ClientHandler` menerima channel `forwarded-tcpip` (+ global request `tcpip-forward`). Iterasi berikutnya.
- **End-to-end belum diuji** (butuh SSH server + service target + UI Tauri native). Cara uji manual: profil SSH → tab PORTS → tambah Local forward (mis. `127.0.0.1:8080 → localhost:80`) → connect → buka `localhost:8080`. Dynamic: set browser SOCKS5 ke `127.0.0.1:<bindPort>`.
- Error bind (port kepakai) saat ini hanya di-log backend (`eprintln`), belum ada toast UI.

---

## 17. Rancangan: New Profile & Profile Editor (SSH) — ⬜ BELUM DIBANGUN

> Direkam atas permintaan user. **Jangan dibangun dulu** — menunggu screenshot sub-tab
> yang belum ada (CIPHERS, COLORS, LOGIN SCRIPTS, INPUT). Fokus rancangan: **template SSH
> sampai tab ADVANCED**.

### 17.1 Alur "New profile"
1. Settings → Profiles → **New ▾ → New profile**
2. Muncul **palette pemilih template** (gaya quick-launch): judul *"Select a base profile to use as a template"* — ✅ **SUDAH DIBANGUN**
   - **Template**: Raw socket connection (Telnet), **SSH connection** (✅ aktif), Serial connection, Telnet session (⬜ disabled — Fase 8)
   - **Duplicate an existing profile**: ✅ daftar profil user tampil & bisa diklon
   - Keyboard ↑/↓ + Enter (baris teraktif badge `ENTER ↵`) — ✅ done
3. Pilih template → buka **modal editor profil** sesuai tipe. (Fokus: SSH.)

### 17.2 Editor Profil — kolom kiri (umum semua tipe)
- **Name** (text)
- **Group** (dropdown: Ungrouped + user groups)
- **Icon** (picker ikon Lucide)
- **Color** (color picker, hex; default `#000000`)
- **Disable dynamic tab title** (toggle) — "Connection name will be used instead"
- **When a session ends** (Auto / …) — dropdown
- **Clear terminal after connection** (toggle)

### 17.3 Editor Profil SSH — kolom kanan (tab)
Tab: **GENERAL · PORTS · ADVANCED · CIPHERS · COLORS · LOGIN SCRIPTS · INPUT** (semua terekam)

**GENERAL:**
- Connection: **Direct ▾** (direct / jump host)
- **Host** (text) · **Port** (number, default 22)
- **Username** (default `root`)
- **Authentication method**: Auto · Password · Key · Agent · Interactive
- **Password**: tombol "Set password" (simpan di keychain/vault)
- **Private keys**: "Add a private key"

**PORTS:**
- **Add a port forward**: `bindAddr:bindPort → host:port` + Description
- Tipe: **Local · Remote · Dynamic**, tombol "Forward port"
- Daftar forward yang sudah ditambah

**ADVANCED:**
- X11 forwarding (toggle) · Agent forwarding (toggle)
- Skip MoTD/banner (toggle) · Reuse session for multiple tabs (toggle)
- Keep Alive Interval ms (default 5000) · Max Keep Alive Count (default 10) · Ready Timeout ms (default 20000)

**CIPHERS:** daftar checkbox per kategori (✓ = default aktif). Default mengikuti OpenSSH/libssh.
- **Ciphers:** none, `aes128-ctr`✓, `aes192-ctr`✓, `aes256-ctr`✓, aes128-gcm@openssh.com, `aes256-gcm@openssh.com`✓, aes128-cbc, aes192-cbc, aes256-cbc, `chacha20-poly1305@openssh.com`✓
- **Key exchange:** `mlkem768x25519-sha256`✓, `curve25519-sha256`✓, `curve25519-sha256@libssh.org`✓, dh-group-exchange-sha1, dh-group-exchange-sha256, dh-group1-sha1, dh-group14-sha1, `dh-group14-sha256`✓, dh-group15-sha512, `dh-group16-sha512`✓, dh-group17-sha512, dh-group18-sha512, ecdh-sha2-nistp256/384/521
- **HMAC:** `hmac-sha1`✓, `hmac-sha2-256`✓, `hmac-sha2-512`✓, `hmac-sha1-etm`✓, `hmac-sha2-256-etm`✓, `hmac-sha2-512-etm`✓
- **Host key:** ssh-dss, `ecdsa-sha2-nistp256`✓, ecdsa-sha2-nistp384, `ecdsa-sha2-nistp521`✓, `ssh-ed25519`✓, `ssh-rsa`✓, `rsa-sha2-256`✓, `rsa-sha2-512`✓, sk-ecdsa-…@openssh.com, sk-ssh-ed25519@openssh.com
- **Compression:** zlib@openssh.com, zlib, `none`✓

**COLORS:** pemilih **color scheme khusus profil** (override tema global) — daftar scrollable, tiap item menampilkan **preview terminal live** (`john@doe-pc$ ls …`). Contoh skema: Arthur, AtelierSulphurpool, Atom, AtomOneLight, ayu, ayu_light, Base16 Default Dark, base2tone-{cave,desert,drawbridge,evening,forest,heath}-dark, … (banyak, ala iTerm2). *(Implementasi awal: pakai daftar tema Moorix + preview; koleksi iTerm2 menyusul.)*

**LOGIN SCRIPTS:** tabel automasi expect/send saat login.
- Kolom: **Expect** | **Send** | aksi
- Tombol **+ New item** menambah baris
- Per baris: dropdown (ikon gear) mode cocok **Exact match / Regex / Optional** + tombol hapus (trash)

**INPUT:**
- **Backspace key mode**: Pass-through / Ctrl-H / Ctrl-? / Delete (CSI 3~)

Footer: **Save** / **Cancel**.

### 17.5 Implikasi backend untuk CIPHERS & COLORS
- **CIPHERS** → `russh::client::Config.preferred` (`Preferred { kex, cipher, mac, key, compression }`). russh 0.62 mendukung set algoritma pilihan → ✅ **DITERAPKAN**; mapping nama UI → tipe russh + fallback default per kategori.
- **COLORS** → ✅ **DITERAPKAN** — override tema xterm **per-sesi** (independen dari tema global app), murni frontend via `TermOptions`. Saat ini memakai daftar tema Moorix; impor koleksi iTerm2 menyusul (opsional).

---

## 18. Penyimpanan kredensial (secret storage)

**Abstraksi:** 3 command Tauri — `secret_set(id, password)` / `secret_get(id)` / `secret_delete(id)`.
Frontend & editor SSH **tidak tahu** implementasinya → implementasi bisa beda per platform tanpa
mengubah frontend. Password **tidak pernah** disimpan di store (`moorix.json`); hanya id profil yang direferensikan.

**Desktop (✅ terpasang):** crate `keyring` 3 → Windows Credential Manager / macOS Keychain / Linux Secret Service. Tanpa master password. Service = `moorix`, account = profile id.

**Mobile (⬜ Fase 7):** implement command yang sama di balik `#[cfg(mobile)]`:
- **Android:** plugin Tauri (Kotlin) → **EncryptedSharedPreferences** (di-back Android Keystore)
- **iOS:** **Keychain Services** (Security.framework) via plugin/Swift bridge

**Alternatif (ditolak untuk sekarang):** unify ke `tauri-plugin-stronghold` (satu vault lintas platform) — konsisten tapi butuh master password tiap sesi. Bisa ditinjau ulang bila platform-native mobile terlalu ribet.

### Update Fase 5 — profil SSH user
- ✅ `NewProfilePicker` (template: SSH aktif; Serial/Telnet/Raw disabled)
  - ✅ **Duplicate an existing profile** — daftar profil user tampil & bisa diklon (`cloneProfile`: id baru, nama `(copy)`, password dikosongkan) → buka editor
  - ✅ **Keyboard navigation** — ↑/↓ pindah baris (template SSH + daftar duplicate), Enter pilih (badge `ENTER ↵`), Esc tutup, mouse-hover set aktif
  - ⬜ Template Serial/Telnet/Raw socket tetap disabled → menunggu **Fase 8** (transport backend)
- ✅ `ProfileEditor` — editor SSH 7 tab (GENERAL/PORTS/ADVANCED/CIPHERS/COLORS/LOGIN SCRIPTS/INPUT) + kolom kiri (Name/Group/Icon Lucide/Color/toggles)
- ✅ Profil user tersimpan di store (`userProfiles`), tampil di list (Ungrouped/grup) + palette, bisa edit/hapus/launch
- ✅ Password → OS keychain (`keyring`), diambil saat connect; strip dari store
- ✅ **Diterapkan ke backend russh:** CIPHERS (`Config.preferred` via `parse_names` + `TryFrom<&str>`, fallback default per kategori bila kosong), **keep-alive** (`keepalive_interval`/`keepalive_max`), **ready timeout** (`tokio::time::timeout` saat connect).
- ✅ **COLORS / INPUT / LOGIN SCRIPTS diterapkan (frontend-only, via `TermOptions` per-sesi di `TerminalView`):**
  - **COLORS** — `ssh.colorScheme` override tema xterm per-sesi (independen tema global; kosong = ikut global). Tetap override walau tema global berubah.
  - **INPUT** — backspace mode remap keystroke (`attachCustomKeyEventHandler`): ctrl-h→`\x08`, delete→CSI `\x1b[3~`, passthrough/ctrl-?→default DEL `\x7f`.
  - **LOGIN SCRIPTS** — automasi expect/send atas output stream (`runLoginScripts`): match exact/regex/optional (ANSI di-strip), kirim `send + \r`; step required blocking, optional bisa dilewati.
- ⬜ **Belum diterapkan (butuh kerja russh, bukan transport baru):** PORTS Remote (-R) forwarding, X11/agent forwarding, skip banner, reuse session (multiplexing). *(PORTS Local & Dynamic ✅ — lihat Fase 9.)*

### 17.4 Implikasi data & backend (catatan penting)
- Profil SSH user disimpan di `tauri-plugin-store` (metadata). ⚠️ **Password → stronghold/keychain, bukan store plaintext** (fitur keamanan menyusul).
- Launch profil SSH → `ssh_open` dengan config tersimpan.
- **Backend russh saat ini belum mendukung:** port forwarding, keep-alive, X11/agent forwarding, ciphers kustom, jump host. Field-field ini akan disimpan dulu; dukungan backend menyusul (perlu kerja di `ssh.rs`).
- Model `Profile` perlu diperluas: simpan `options` per tipe (host/port/user/auth/forwards/advanced…).

**Status:** rancangan tercatat. Implementasi menunggu screenshot sub-tab tersisa + konfirmasi user.

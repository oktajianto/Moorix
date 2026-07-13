# Moorix — Implementation Plan

> Cross-platform terminal & SSH client, dibangun dengan **Tauri 2**.
> Terinspirasi Tabby, tapi dengan satu codebase yang menjangkau desktop **dan** mobile.

Status dokumen: **Draft v1** · Terakhir diperbarui: 2026-07-13

---

## 1. Ringkasan & Tujuan

Moorix adalah aplikasi terminal modern lintas platform:

- **Desktop (Windows, Linux, macOS):** terminal penuh — local shell (PTY), SSH, Telnet, Serial.
- **Mobile (Android, iOS):** **SSH-only** (karena OS melarang/menyulitkan local shell — lihat §3).

Prinsip desain:
- **Satu core codebase**, perbedaan platform di-*gate* dengan `#[cfg(desktop)]` / `#[cfg(mobile)]` di sisi Rust dan feature-flag di frontend.
- **Reuse xterm.js** untuk rendering terminal (sama seperti Tabby) → tampilan konsisten & matang.
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
- [ ] Mobile build jalan dengan SSH-only

### v0.2+
- [ ] Split pane
- [ ] Profile/connection manager (simpan host, port, user, key)
- [ ] Secure credential store (stronghold)
- [ ] Banyak tema + import tema (iTerm/Tabby format)
- [ ] Keybinding kustom
- [ ] Serial & Telnet (desktop)

### Lanjutan (v1.0+)
- [ ] SSH port forwarding (local/remote/dynamic)
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
- 🔄 Rust build (dengan portable-pty)
- ⬜ `pnpm tauri dev` — verifikasi bisa ketik di shell lokal nyata

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
- 🔄 Rust build (russh)
- ⬜ `pnpm tauri dev` — verifikasi konek SSH ke server nyata

**Catatan teknis Fase 2:**
- SSH pakai model input via `tokio::sync::mpsc`: command sync (`session_write/resize`) kirim pesan ke IO task async yang memegang russh channel. Output russh → Tauri Channel.
- Auth: password & private key (`load_secret_key` + `PrivateKeyWithHashAlg`).
- Backend kripto russh pakai `ring` (bukan `aws-lc-rs`) — hindari masalah build toolchain C di Windows.
- ⚠️ **Keamanan (TODO):** `check_server_key` masih `Ok(true)` (terima semua host key) → rawan MITM. Wajib diganti verifikasi known_hosts + prompt sebelum rilis.
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

### Fase 4 — Welcome + Settings + Themes (verifikasi)
- ✅ `src/themes.ts` — 6 tema (Moorix Dark, Dracula, One Dark, Solarized Dark, Tokyo Night, Light)
- ✅ `src/settings.tsx` — Context + persist localStorage (fontSize, fontFamily, themeName, cursorBlink)
- ✅ `src/components/Settings.tsx` — panel overlay (tema+swatch, font, size slider, cursor blink)
- ✅ `src/components/Welcome.tsx` — first-launch (logo chevron Moorix sendiri, quick Dark/Light, Get started)
- ✅ `TerminalView` — terapkan settings live (font/tema) tanpa merusak sesi (pakai refs)
- ✅ `TitleBar` — tombol ⚙️; `main.tsx` — `SettingsProvider`; background area themable
- ✅ Frontend build lolos
- ⬜ Verifikasi manual (Welcome, ganti tema live, settings)

**Catatan:** persist masih localStorage (MVP). Nanti pindah ke `tauri-plugin-store` agar konsisten lintas platform & lebih tahan.

### Fase 5 — Profiles & Settings page ✅ (iterasi berjalan)
- ✅ Chrome light/dark app-wide via CSS variables (`--m-*`), toggle class `.light` dari luminance tema
- ✅ Ikon app dari logo transparan user (`logo-transparant.png`) → `tauri icon` (desktop/iOS/Android), di-embed ke exe
- ✅ Logo user dipakai di Welcome
- ✅ Ikon UI pakai **lucide-react** (bukan emoji): sidebar Settings, daftar profil, palette, launcher, title bar
- ✅ **Quick-launch palette** (`ProfileMenu.tsx`) — tombol "Profiles & connections" setelah `+`; search + daftar profil + Manage profiles; keyboard ↑/↓/Enter/Esc
- ✅ **Registry profil** (`profiles.ts`) — built-in (PowerShell, CMD, Git Bash, SSH) dipakai bersama palette & Settings
- ✅ **Settings sebagai tab** (`SettingsPage.tsx`) gaya Tabby: sidebar (Application, Appearance, Profiles & connections, Terminal, Color scheme, Config sync, Hotkeys, Shell, SSH, Vault, Window, Config file — **tanpa Plugins**)
  - Section **Profiles & connections → PROFILES**: Default profile selector, Filter, list berkelompok (Ungrouped / user groups / Built-in) dengan badge tipe
  - **New profile Group**: dropdown New ▾ → popup nama → grup tersimpan (`tauri-plugin-store`, key `profileGroups`)
  - Section **Color scheme** & **Terminal** (pindahan dari Settings lama); sisanya placeholder
- ✅ **tauri-plugin-store** — dep Rust + JS, capability `store:default`, `moorix.json` (key: `defaultProfileId`, `profileGroups`)
- ✅ Default profile → tombol `+` langsung buka profil default

---

## 17. Rancangan: New Profile & Profile Editor (SSH) — ⬜ BELUM DIBANGUN

> Direkam atas permintaan user. **Jangan dibangun dulu** — menunggu screenshot sub-tab
> yang belum ada (CIPHERS, COLORS, LOGIN SCRIPTS, INPUT). Fokus rancangan: **template SSH
> sampai tab ADVANCED**.

### 17.1 Alur "New profile"
1. Settings → Profiles → **New ▾ → New profile**
2. Muncul **palette pemilih template** (gaya quick-launch): judul *"Select a base profile to use as a template"*
   - **Template**: Raw socket connection (Telnet), **SSH connection**, Serial connection, Telnet session
   - **Duplicate an existing profile**: daftar profil yang ada (built-in + user) untuk diklon
   - Keyboard ↑/↓ + Enter (baris teraktif badge `ENTER →`)
3. Pilih template → buka **modal editor profil** sesuai tipe. (Fokus: SSH.)

### 17.2 Editor Profil — kolom kiri (umum semua tipe)
- **Name** (text)
- **Group** (dropdown: Ungrouped + user groups)
- **Icon** (Tabby: class FontAwesome `fas fa-desktop`. **Moorix: ganti ke picker ikon Lucide**)
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

**CIPHERS:** daftar checkbox per kategori (✓ = default aktif). Meniru default OpenSSH/libssh Tabby.
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
- **CIPHERS** → `russh::client::Config.preferred` (`Preferred { kex, cipher, mac, key, compression }`). russh 0.62 mendukung set algoritma pilihan → **feasible**; perlu mapping nama UI → tipe russh, dan validasi mana yang didukung `ring` backend.
- **COLORS** → override tema xterm **per-sesi** (independen dari tema global app). Murni frontend; perlu pustaka skema warna (impor koleksi iTerm2 seperti Tabby).

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
- ✅ `ProfileEditor` — editor SSH 7 tab (GENERAL/PORTS/ADVANCED/CIPHERS/COLORS/LOGIN SCRIPTS/INPUT) + kolom kiri (Name/Group/Icon Lucide/Color/toggles)
- ✅ Profil user tersimpan di store (`userProfiles`), tampil di list (Ungrouped/grup) + palette, bisa edit/hapus/launch
- ✅ Password → OS keychain (`keyring`), diambil saat connect; strip dari store
- ⚠️ PORTS/ADVANCED/CIPHERS: UI + tersimpan, **backend russh belum menerapkan** (host/port/user/auth yang aktif). COLORS pakai tema Moorix + preview.

### 17.4 Implikasi data & backend (catatan penting)
- Profil SSH user disimpan di `tauri-plugin-store` (metadata). ⚠️ **Password → stronghold/keychain, bukan store plaintext** (fitur keamanan menyusul).
- Launch profil SSH → `ssh_open` dengan config tersimpan.
- **Backend russh saat ini belum mendukung:** port forwarding, keep-alive, X11/agent forwarding, ciphers kustom, jump host. Field-field ini akan disimpan dulu; dukungan backend menyusul (perlu kerja di `ssh.rs`).
- Model `Profile` perlu diperluas: simpan `options` per tipe (host/port/user/auth/forwards/advanced…).

**Status:** rancangan tercatat. Implementasi menunggu screenshot sub-tab tersisa + konfirmasi user.

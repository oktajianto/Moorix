# Moorix — Implementation Plan

> Cross-platform terminal & SSH client, dibangun dengan **Tauri 2**.
> Satu codebase yang menjangkau desktop **dan** mobile.

Status dokumen: **Draft v1** · Terakhir diperbarui: 2026-08-13 · **Rilis publik pertama: `v0.1.0` (2026-08-03)** · **Rilis stabil terakhir: `v0.1.1` (2026-08-13)**

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
| 9 | Advanced — SSH port forwarding **Local + Dynamic** | 🟡 (SFTP ✅ Fase 11 · sync ✅ Fase 17; **sisa**: Remote -R, jump host ⬜) |
| 10 | Settings → Application + Appearance (ala Tabby) + **auto-update silent** (GitHub Releases) | ✅ (publish rilis ber-signing: ✅ — rilis publik pertama **`v0.1.0`** 2026-08-03 · terakhir/latest **`v0.1.1`** 2026-08-13) |
| 11 | **SFTP file manager** (dual-pane lokal/remote, upload/download rekursif, DnD, ops remote) | ✅ T1 backend · T2 panel+navigasi · T3 transfer rekursif+progress+cancel · T4 drag-and-drop (in-app + OS drop) · T5 ops mkdir/rename/delete + menu klik-kanan |
| 16 | **Google login (OAuth)** di Account & Sync + OAuth app **In production** + CI secret wiring + rilis `v0.1.0-pre.7` | ✅ |
| 17 | **Google Drive sync nyata** (Push/Pull terenkripsi ke appDataFolder, refresh token silent) + **Account UI** (kartu profil + logout) + README global | ✅ |
| 18–19 | **SFTP edit in-app (Monaco)** + **Editor multi-file** (tab, minimize, split view) | ✅ (detail di §16 Fase 18–19) |
| **20** | **Database Manager native** — MySQL/MariaDB + PostgreSQL via SSH tunnel (browse · SQL editor · edit/insert/delete · create/drop/rename · export/import `.sql`) | ✅ **rilis `0.1.0`** (2026-08-03) · ✅ **implementasi tuntas** — **20A** (MVP: konek·SQL·browse·autocomplete·tipe ramah) · **20B** (Structure·edit/insert/delete·multi-delete) · **20C** (export/import·drop/rename) · **20D** (PostgreSQL: 20D-1 konek/tree/SQL · 20D-2 browse/structure · 20D-3 edit/DDL · 20D-4 pg_dump/psql) · ✅ **find-in-row** di popup Edit row (cari nama kolom + isi nilai, counter n/m, next/prev ↑/↓, auto-scroll, highlight amber; `v0.1.1`). Sisa: uji native menyeluruh (lihat **§19**) |
| 21 | **Terminal Search** (Find in terminal, **Ctrl+F**) — cari teks di output SSH/CMD/PowerShell, highlight + next/prev, hotkey overridable | ✅ (implementasi; uji native pending — lihat **§16 Fase 21**) |
| 22 | **SFTP: dropdown folder induk** di address bar — lompat ke folder induk/root tanpa klik Up berkali-kali | ✅ (implementasi; uji native pending — lihat **§16 Fase 22**) |
| **23** | **Auto-Backup DB** — Settings → menu "Backup DB": list setup auto-backup (jalan saat komputer/app menyala), tiap setup pilih SSH·userDB·database(satu/semua)·folder tujuan; jalan berurutan dgn jeda menit; penanda "sudah jalan hari ini" di store; autostart + notifikasi OS + system tray (hide-to-tray, start-hidden); default **OFF** | ✅ **implementasi** (23A UI · 23B backend+Run manual · 23C runner+penanda · 23D-1 autostart+notif · 23D-2 tray) — uji native pending (lihat **§20**) |
| **24** | **Notes** — Settings → menu "Notes": list note + Add, editor master-detail; judul wajib (jadi nama list); isi 2 mode: **Teks** (Monaco + pilih bahasa) & **Tabel** (tambah/hapus baris & kolom, teks bebas); **offline-first** (store key `notes`) + **sync terenkripsi** via Drive (numpang pipeline) + **merge per-note** (union `id` · menang `updatedAt` · tombstone `deletedAt`); auto-save (tanpa tombol Save) | 📝 **rancangan disetujui** (diskusi 2026-08-07) — implementasi belum mulai (detail di **§24**) |

> Detail per fase ada di **§16 Progress Log**. Kolom "Status" di-update tiap fase (jangan dihapus).

---

## 0A. Sisa Pekerjaan & Roadmap (belum selesai)

### 🔴 Wajib — urutan disarankan
1. **Lengkapi file kunci lokal** (§0B) — restore dari repo `all_key_mine` **sebelum** build rilis desktop/Android.
2. ~~**Publikasikan GitHub Release ber-signing**~~ ✅ **SELESAI** (terakhir `v0.1.1`, 2026-08-13 — rilis stabil/latest; lihat Fase 16). Secret repo kini **3**: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `MOORIX_GOOGLE_CLIENT_SECRET`.

   **📋 Prosedur rilis (WAJIB tiap tag baru):**
   1. **Bump versi** di 4 file: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock` (updater bandingkan versi build ini, bukan nama tag).
   2. **Commit + push** ke `main`, lalu `git tag vX && git push origin vX` → workflow `release.yml` build+sign 4 platform (~15–30 mnt) dan **membuat Release** dengan `releaseBody` **statis** (placeholder "Desktop build of Moorix…").
   3. **Tulis ulang release notes SETELAH build selesai** (rilis baru ada setelah build): `gh release edit vX --notes-file <file>`. **Ini WAJIB** — halaman **changelog website** menarik **body GitHub Release** via API dan `parseBody()` hanya membaca **bullet** di bawah heading; tanpa langkah ini, changelog cuma menampilkan placeholder.
   - **Format release notes (agar terbaca website):**
     - **BAHASA INGGRIS** — deskripsi rilis/pre-rilis (summary + semua bullet) **WAJIB bahasa Inggris**, bukan Indonesia (keputusan user 2026-08-06).
     - **Paragraf intro** (1 kalimat) di paling atas → jadi *summary*.
     - Detail **HARUS bullet** (`- …`) di bawah heading. Heading → label warna: **`### Added`** / New / Feature(s) = hijau · **`### Fixed`** / Fixes / Bugfixes = biru · **`### Changed`** / Improved / Improvements = kuning. Heading lain/tanpa heading = default *Changed*. `**bold**`/`` `code` ``/`[link](url)` otomatis di-strip.
     - **Isi lengkap**: cantumkan **semua** perubahan/perbaikan yang masuk di rilis itu (dari commit-commit sejak tag sebelumnya), bukan ringkasan singkat.
     - **WAJIB akhiri dengan blok Download/Install** (di bawah bullet perubahan) yang mengarahkan Windows ke **Microsoft Store** dulu, baru installer langsung. Blok ini diabaikan `parseBody()` (tak ada heading bullet), tapi tampil di halaman GitHub Release. Format:
       ```
       ## Download

       **Windows:** [Get it from the Microsoft Store](https://apps.microsoft.com/detail/9PFM3C4LWS8B) (recommended — no SmartScreen, auto-updates), or the `.exe` below (SmartScreen prompt → More info → Run anyway).

       **macOS:** `.dmg` below · **Linux:** `.AppImage` / `.deb` below.
       ```
       Store id `9PFM3C4LWS8B` · link https://apps.microsoft.com/detail/9PFM3C4LWS8B · PFN `oktajianto.com.Moorix_44216rjve3r6j` (lihat §25 untuk pipeline MSIX).
   - **Catatan:** message **git tag TIDAK dipakai** website (workspace baca body Release). Contoh yang sudah benar: rilis `v0.1.0` & `v0.1.1-pre.1`.
3. **Section Settings yang masih placeholder** — **Shell**, **SSH**, **Window**, **Vault**, **Config file** (+ **Plugins** bila ditambah ke sidebar). Minimal buat fungsional/tampil rapi ala Tabby (pola sama seperti section yang sudah jadi).
4. **Uji end-to-end di window native** (tak bisa dari harness): transfer SFTP nyata ke VPS, hotkeys, auto-open/restore tabs, DnD OS→panel, klik-kanan terminal (menu native), Serial/Telnet.

### ✅ Rilis 0.1.0 — TERBIT (2026-08-03)
- **Database Manager native** (Fase 20) — panel DB ala phpMyAdmin di dalam Moorix: MySQL/MariaDB + PostgreSQL lewat SSH tunnel yang sudah ada, dengan **profil DB** (anak dari profil SSH, kredensial di vault), browse tabel, SQL editor (reuse Monaco), edit/insert/delete, dan export/import `.sql`. **Rancangan lengkap + pentahapan di §19.** ✅ **Implementasi tuntas & dirilis di `v0.1.0`** (detail changelog di §16 "Rilis publik 0.1.0"). Sisa: uji native menyeluruh.

### 🟡 Opsional — nilai tambah
- **Auto-Backup DB (Fase 23)** — ⬜ **RANCANGAN** (§20, diskusi user 2026-08-05): Settings → "Backup DB", list setup auto-backup yang jalan saat komputer/app menyala, tiap setup pilih SSH·userDB·database·folder tujuan, jalan berurutan dgn jeda menit, folder bertanggal `-ddMonthNameyyyy` (1 `.sql`/DB), penanda per-hari di store (+cleanup >7 hari), default **OFF**. Reuse `mysqldump`/`pg_dump` (§19.5).
- ~~**Config sync**: bangun server sync minimal~~ ✅ **SELESAI via Google Drive** (Fase 17) — Push/Pull E2E-encrypted ke appDataFolder; tanpa server sendiri.
- **SFTP**: lebar panel **persist antar-restart**, **preview file**, **checksum/verify** transfer, progres byte per-file (kini per-file by name/index), simbol link ikon khusus. ~~Dropdown folder induk di address bar~~ ✅ **SELESAI** (Fase 22 — implementasi; uji native pending).
- **Editor multi-file (minimize + tab + split view ala VS Code)** — ✅ **SELESAI & teruji native** (Fase 19, T1–T3, user 2026-07-22): editor jadi surface multi-dokumen, tab bar + dot unsaved, minimize→pill, split view bebas bersarang (pemilih file), Monaco model per file (undo/scroll/kursor terjaga), read-only saat sesi SFTP tertutup + re-bind saat panel dibuka lagi.
- **SFTP edit file in-app (Monaco)** — ✅ **SELESAI & teruji native** (Fase 18, user 2026-07-22): buka file teks → edit di Monaco → Save tulis balik ke remote/lokal; soft-cap 1 MB (konfirmasi >1MB), hard-cap 10 MB, biner tetap read-only, auto-refresh listing setelah save.
- **Store-only settings** (UI ada, belum berpengaruh runtime): **Sixel** (butuh `@xterm/addon-image`), **Word separators** (custom double-click selection), **Copy with formatting** (rich clipboard), **Bracketed paste**, **Require key to click links** (butuh `@xterm/addon-web-links`).
- **Terminal**: ligatures **live** (kini hanya terminal baru), renderer switch **live** (kini saat create). ~~Search (Ctrl+F)~~ ✅ **SELESAI** (Fase 21 — implementasi; uji native pending).
- **Restore tabs**: pulihkan **layout split** (kini single-pane), dan urutan/tab aktif.
- **SSH advanced (lanjutan Fase 9)**: **Remote (-R)** forwarding, **X11/agent forwarding**, skip banner, **reuse session** (multiplexing), **jump host**.
- **Autentikasi SSH pakai Key + Generate Key (Fase 26)** — ⬜ **RANCANGAN** (§26, diskusi user 2026-08-25): (A) pakai private key yang sudah ada — Browse file + dukung passphrase (keychain); (B) generate keypair (Ed25519/RSA) langsung dari app + tampil/copy public key + (opsional) install ke server ala `ssh-copy-id`. Backend key-auth **sudah ada** (`ssh.rs` `SshAuth::Key`); yang kurang = UI (Browse/passphrase/generator). Branch kerja `koneksiSSH-withSSHKey`.
- **Profile editor** untuk **Serial/Telnet** (§17) — kini hanya SSH.
- **Mobile**: hadirkan file manager/fitur desktop-only ke mobile bila diinginkan (FS sandbox).

---

## 0B. File Kunci / Secret — restore dari repo `all_key_mine`

Beberapa file kunci **sengaja `gitignored`** (rahasia, tidak di-commit ke repo publik). Di mesin baru / setelah clone, lengkapi dulu:

1. **Clone/pull** repo privat **`all_key_mine`**.
2. **Copy** isi folder **`moorix/`** pada repo itu ke direktori projek ini **sesuai letak/path aslinya** (struktur folder di `moorix/` mengikuti struktur projek — tinggal timpa sesuai path).

File yang harus ada setelah copy:

| File (relatif ke root projek) | Fungsi | Diperlukan untuk |
|---|---|---|
| `src-tauri/updater-signing.key` | private key minisign (updater) | sign artefak auto-update |
| `src-tauri/gen/android/moorix-release.jks` | keystore Android | build APK **release** ber-signing |
| `src-tauri/gen/android/keystore.properties` | kredensial keystore (path/alias/password) | build APK release |
| `src-tauri/.cargo/config.toml` | `[env] MOORIX_GOOGLE_CLIENT_SECRET` (OAuth client secret Google) | build lokal dengan Google login berfungsi (CI pakai repo secret) |

> Catatan: file `*.pub` (mis. `src-tauri/updater-signing.key.pub`) **aman & sudah di-commit** — tidak perlu di-restore. **Jangan** meng-commit file pada tabel di atas (sudah diabaikan `.gitignore`); backup hanya via repo privat `all_key_mine`. Kehilangan `updater-signing.key`/password = tak bisa rilis update; kehilangan `.jks`/password = tak bisa update APK Android.

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
- [x] Desktop: buka **local shell** dalam tab
- [x] Semua platform: buka **SSH** (auth password + private key)
- [x] Tab management (buka/tutup/pindah)
- [x] 1 tema default + font monospace
- [x] Settings dasar (font size, tema)
- [x] Mobile build jalan dengan SSH-only (Android APK; SSH-only, local shell di-gate)

### v0.2+
- [x] Split pane
- [x] Profile/connection manager (simpan host, port, user, key) — SSH/Serial/Telnet
- [x] Secure credential store — OS keychain **+ master-password Vault** (Web Crypto AES-GCM, lintas platform; alternatif stronghold ditolak)
- [x] Banyak tema + import tema (format iTerm2) — 17 skema iTerm2 diimport (`iterm2Themes.ts`)
- [x] Keybinding kustom
- [x] Serial & Telnet (Serial desktop-only; Telnet cross-platform) — via Launcher quick-connect

### Lanjutan (v1.0+)
- [~] SSH port forwarding — Local (-L) & Dynamic (-D/SOCKS5) ✅; Remote (-R) ⬜
- [x] SFTP file browser — dual-pane + transfer rekursif + ops remote (Fase 11)
- [x] **Edit file in-app (Monaco)** + **editor multi-file** (tab, minimize, split view) (Fase 18–19)
- [x] Sync profil/config antar device (terenkripsi) — via Google Drive, Push/Pull + auto-sync (Fase 17)
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
| Windows (Store) | `makeappx pack` (paska build) | `.msix` | distribusi via **Microsoft Store** → bebas SmartScreen. Detail: **Fase 25 (§25)** |
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

**Catatan:** ~~persist masih localStorage (MVP)~~ → ✅ dipindah ke `tauri-plugin-store` (Fase 13); localStorage tetap sebagai cache instan.

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
- ✅ **End-to-end terverifikasi** (user, 2026-07-16): Local & Dynamic port forwarding jalan di window native ke server nyata.
- Error bind (port kepakai) saat ini hanya di-log backend (`eprintln`), belum ada toast UI.

### Fase 10 — Settings → Application + Auto-update silent ✅

**UI (ala Tabby)** — `SettingsPage.tsx` → `ApplicationSection`:
- Header brand (logo `moorix-logo.png` + versi via `@tauri-apps/api/app` `getVersion()`) + tombol **Check for updates**.
- Tautan eksternal (buka via `openUrl` plugin-opener): **Report a problem** (`/issues/new`), **GitHub** (source), **What's new** (`/releases`). *Discord sengaja tidak ada (belum).*
- **Application settings**: toggle **Automatic Updates** (`settings.autoUpdate`), **Debugging → Open DevTools** (`invoke("open_devtools")`).
- **Accessibility**: toggle **Enable animations** (`settings.animations` → class `.no-animations` mematikan semua transition/animation via `index.css`).
- Komponen switch/pill sendiri; `settings.tsx` ditambah `autoUpdate` & `animations` (default `true`).

**Auto-update (desktop-only, silent/quiet)**:
- Plugin: `tauri-plugin-updater` + `tauri-plugin-process` (Rust, di target table non-android/ios) & JS `@tauri-apps/plugin-{updater,process}`. Diregistrasi `#[cfg(desktop)]` di `lib.rs`. Command `open_devtools` (tauri feature `devtools` diaktifkan → jalan juga di release).
- Capabilities: `updater:default`, `process:default`, `core:app:default`.
- Config `tauri.conf.json`: `bundle.createUpdaterArtifacts: true`; `plugins.updater.endpoints = [".../releases/latest/download/latest.json"]`, `pubkey` (minisign), `windows.installMode: "quiet"` (**installer tidak muncul**).
- `src/updater.ts` `checkForUpdates(toast, {silent})`: `check()` → jika ada update, `downloadAndInstall` dengan event `Started/Progress/Finished` → **toast progress** (persen + MB) → `Installing…` → `relaunch()`. Startup App memanggil versi `silent` (hanya muncul kalau benar ada update). Tombol Check memanggil versi non-silent (tampil "Checking…"/"up to date"/error).
- **Toast system baru**: `src/components/Toast.tsx` (`ToastProvider`/`useToast`), progress bar determinate + indeterminate, dipasang di `main.tsx`. *Bisa dipakai ulang untuk status port-forward, dsb.*

**⚠️ Wajib untuk update benar-benar jalan (belum dikerjakan — butuh aksi user/CI):**
1. **Signing key** sudah digenerate: `src-tauri/updater-signing.key` (**gitignored, RAHASIA — backup!**) + `.key.pub` (pubkey sudah masuk config). **Hilang key = tak bisa rilis update.**
2. Publikasikan GitHub Release dengan artefak updater **ber-signing** + file **`latest.json`** (format Tauri) sebagai asset rilis. Set env `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`, kosong) saat `tauri build` (idealnya via GitHub Actions secret).
3. Selama belum ada `latest.json` di rilis, tombol "Check for updates" akan menampilkan toast **error/"up to date"** (endpoint 404) — itu normal.

**Settings → Appearance (ala Tabby)** — `SettingsPage.tsx` → `AppearanceSection`:
- Kontrol: **Font** (family text + size), **Enable font ligatures**, **Normal/Bold font weight**, **Cursor shape** (block/bar/underline, segmented), **Blink cursor**, **Minimum contrast ratio**, **Fallback font**, **Line padding**, **Custom CSS** (textarea).
- **Live preview terminal** (`TerminalPreview`) memakai warna tema aktif + mencerminkan font/weight/ligature/line-padding secara real-time.
- `settings.tsx` ditambah: `fontLigatures`, `normalFontWeight`, `boldFontWeight`, `cursorShape`, `minimumContrastRatio`, `fallbackFont`, `linePadding`, `customCSS` + helper `effectiveFontFamily()` & `lineHeightOf()`.
- **Diterapkan ke terminal asli** (`TerminalView.tsx`, live): `fontFamily` (+fallback), `fontWeight`/`fontWeightBold`, `cursorStyle`, `minimumContrastRatio`, `lineHeight`. **Custom CSS** di-inject sebagai `<style>` global (App.tsx). **Ligatures**: DOM renderer + `font-feature-settings` saat aktif (WebGL dilewati) — berlaku untuk terminal yang **baru dibuka** (renderer dipilih saat create).

**Settings → Terminal (ala Tabby)** — `SettingsPage.tsx` → `TerminalSection` (menggantikan versi lama font/size/blink yang kini di Appearance):
- Seksi: **Rendering** (Frontend WebGL/DOM, Scrollback, Draw bold in bright, Sixel*), **Keyboard** (Alt as Meta, Scroll on input), **Mouse** (Right click, Paste on middle-click, Word separators*), **Clipboard** (Copy on select, Warn multi-line paste, Replace line breaks, Trim whitespace), **Sound** (Terminal bell Off/Visual/Audible), **Startup** (Auto-open terminal*, Restore tabs*).
- **Wired live** (`TerminalView.tsx`): `scrollback`, `drawBoldTextInBrightColors` (boldBright), `scrollOnUserInput` (scrollOnInput), `macOptionIsMeta` (altIsMeta); renderer WebGL/DOM saat create (DOM juga saat ligatures). **Perilaku** via `attachTerminalBehaviors()`: copy-on-select (+trim), right-click (paste / paste-if-no-selection-else-copy / off), paste-on-middle-click, replace-line-breaks + warn-multiline saat paste (pakai `navigator.clipboard`), **bell** visual (flash `invert`) / audible (WebAudio beep).
- `*` **Store-only** (UI + persist, belum berpengaruh runtime): Sixel (butuh addon-image), Word separators (xterm core tak punya opsi ini). **Diomit** dari screenshot: "Set as %COMSPEC%" (registry Windows, tak relevan/aman), Copy-with-formatting, Bracketed-paste, Require-key-to-click-links (butuh rich clipboard / web-links addon).
- `Segmented`/`SelectBox`/`SectionTitle` helper baru; helper `Row` lama dihapus.

**Iterasi lanjutan Terminal:**
- **Right click** diubah dari dropdown 3-mode → **toggle `rightClickPaste`** (default ON = paste / copy-jika-ada-seleksi). **OFF ⇒ menu konteks native** (copy/paste/…) muncul kembali (handler `contextmenu` tak meng-`preventDefault`).
- **Auto-open a terminal on start** ✅ diwujudkan: startup membuka **local shell** default (desktop; di-skip di mobile).
- **Restore terminal tabs** ✅ diwujudkan: tiap tab terminal menyimpan **`TabDesc`** serializable (local/ssh/serial/telnet) yang di-persist ke store (`openTabs`) tiap `tabs` berubah (di-guard `bootedRef` agar tak menimpa saat boot). Saat start, tab dibuka ulang sebagai **sesi baru single-pane** (layout split & sesi lama tidak dipulihkan; SSH pakai `profileId` → reconnect via keychain). `desc` di-thread lewat `openTerminalTab`/`launchInTab` + semua call-site (launchProfile/launchUserProfile/editor SSH/Launcher local·serial·telnet).

**Settings → Hotkeys (ala Tabby, fungsional)** — `src/hotkeys.ts` + `SettingsPage.tsx` → `HotkeysSection`:
- **Registry aksi** Moorix-relevan (~24): copy/paste/select-all/clear, zoom in/out/reset, new/close/next/prev tab + tab-1..9, open settings, toggle fullscreen, split right/bottom, close pane. *(Aksi Tabby yang tak ada di Moorix — WinSCP/SFTP/config-sync/broadcast/command-selector/20 tab/9 pane/serial-restart — sengaja tak disertakan.)*
- **UI**: search box + daftar aksi (label + id), tiap aksi punya **chip binding** (× hapus) + tombol **Add…** yang **meng-capture** keypress berikutnya (Esc batal). Binding disimpan sebagai override per-aksi di `settings.hotkeys` (kosong = pakai default).
- **Dispatch global** (`App.tsx`): listener `keydown` capture-phase → `eventToCombo` → `buildComboMap(overrides)` → jalankan aksi. Tetap aktif di terminal (deteksi `.xterm-helper-textarea`), tapi **stand down** saat mengetik di field form biasa & saat capture (`isCapturingHotkey`). Combo dinormalisasi (simbol ber-Shift → base, Arrow→Right/Left, dst).
- **Wiring**: copy/paste/select-all/clear via helper pool baru di `TerminalView.tsx` (`copyPane`/`pastePane`/`clearPane`/`selectAllPane` + field `write`); zoom = `fontSize`; tab/split/close-pane via handler App; fullscreen via `getCurrentWindow().setFullscreen` (capability `core:window:allow-set-fullscreen`/`allow-is-fullscreen` ditambah).

**Lanjutan Fase 10 (polish + rilis):**
- **Font & Fallback font** di Appearance kini **dropdown** (`FONT_FAMILIES` / `FALLBACK_FONTS`), bukan input teks bebas.
- **Ikon app diperbesar**: `icon-logo-saja.png` punya padding transparan besar (konten hanya 715×423 di kanvas 1024²). Skrip PowerShell (System.Drawing, di scratchpad) auto-crop alpha bbox → compose ke `icon-source.png` 1024² (logo mengisi ~92%). `pnpm tauri icon icon-source.png` regen semua ikon desktop+mobile.
- **Ikon installer = ikon app**: `tauri.conf.json` → `bundle.windows.nsis.installerIcon = "icons/icon.ico"`.
- **CI rilis** `.github/workflows/release.yml`: pada push tag `v*`, `tauri-apps/tauri-action` build Windows/macOS(universal)/Linux, **sign** (env `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` dari secrets), `includeUpdaterJson: true` → upload **`latest.json`**. `prerelease: false` (wajib — endpoint `releases/latest` mengabaikan prerelease).
  - **Aksi user sebelum rilis**: tambah **2 secret** repo — `TAURI_SIGNING_PRIVATE_KEY` (isi `src-tauri/updater-signing.key`) + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (password key, karena key kini **ber-password**); **bump `version`** di `package.json` + `tauri.conf.json` + `Cargo.toml` (updater membandingkan versi ini, bukan tag) sebelum tag & push.
  - Key di-regenerate **ber-password** (pubkey di `tauri.conf.json` sudah diperbarui). Private key + password **RAHASIA & wajib di-backup** — hilang = tak bisa rilis update.
  - **Rilis publik pertama = `0.1.0`** (naik dari seri `0.1.0-pre.N`, di-set di 4 file). Catatan: **flag prerelease GitHub `false`** (endpoint `releases/latest` dipakai updater). **MSI tetap dibuang** dari `bundle.targets` (dulu WiX menolak semver pre-release; dipertahankan untuk konsistensi) → Windows pakai **NSIS** saja (installer yang dipakai updater).

**Verifikasi Fase 10:** `tsc --noEmit` lolos; `cargo`/`tauri dev` **Finished tanpa warning** & window native jalan; HMR Appearance bersih; `tauri icon` regen sukses (logo mengisi frame). (Uji end-to-end unduh+install butuh rilis ber-signing di GitHub — lihat poin di atas.)

### Fase 11 — SFTP file manager ✅ (dual-pane, ala FileZilla di dalam app)

**Backend (Rust):** dep `russh-sftp`. SFTP dibuka sebagai **subsystem channel di koneksi SSH yang sama** (reuse `Handle` via `AppState::ssh_handle`, tanpa login ulang).
- `ssh.rs`: `SshSession` menyimpan `SshHandle` (alias `Arc<Mutex<Handle>>`) + accessor; `ClientHandler` jadi `pub(crate)`.
- `state.rs`: registry `sftp` (id → `Arc<SftpSession>`) + registry `transfers` (id → `AtomicBool` untuk cancel).
- `sftp.rs`: `sftp_open`/`sftp_list`/`sftp_realpath`/`sftp_close`; `sftp_upload`/`sftp_download` **streaming rekursif** (chunk 32KB, walk folder, progress via `Channel<TransferEvent>` di-throttle 256KB, cek cancel tiap loop); `sftp_cancel`; `sftp_mkdir`/`sftp_rename`/`sftp_remove` (**remove rekursif** DFS pre-order → hapus file, lalu dir deepest-first).
- `localfs.rs`: `local_home`/`local_list`/`local_mkdir`/`local_rename`/`local_remove` (`std::fs`, path pakai "/").

**Frontend (React):**
- **Tombol folder** di header pane **SSH** (`SplitPane.tsx`) → App buka panel di kanan tab (`App.tsx`, state `sftpTabs` per-tab, pakai `paneSessionId`).
- `SftpPanel.tsx`: dua sisi **Local (atas)** + **Remote (bawah)** — navigasi (double-click, up, refresh, ketik path), pilih (klik + highlight), tombol transfer ⤓/⤒, **footer progress + cancel**.
- **Drag-and-drop**: antar-panel (HTML5 draggable + drop target berhighlight) + **drop file dari OS** (`getCurrentWebview().onDragDropEvent` → path lokal, hit-test posisi terhadap rect panel → upload).
- **Menu klik-kanan** tiap sisi: Rename / Delete / New folder (`window.prompt`/`confirm` untuk MVP).

**Verifikasi Fase 11:** `tsc --noEmit` lolos; `cargo`/`tauri dev` **Finished** & window jalan (API russh-sftp — `create/open/read_dir/create_dir/rename/remove_*/metadata` — cocok). ✅ **End-to-end transfer terverifikasi** (user, 2026-07-16) di window native ke server SSH nyata.
**Polish Fase 11 (lanjutan) ✅:** lebar panel **bisa di-drag** (divider 300–900px, **per-tab** `sftpWidths` di `App.tsx`), **antrean multi-transfer** (`SftpPanel` `queueRef`/`activeRef` — satu per satu, sisanya antre; OS-drop banyak file semua masuk antrean; footer `+N queued`; cancel mengosongkan antrean), **progres per-file** dalam folder rekursif (backend emit `TransferEvent::File{index,count,name}` → footer tampil `nama (i/N)` + bar total), **ikon per-tipe file** (`iconForFile` ext→lucide: image/video/audio/archive/code/text).
**Polish opsional:** ✅ panel lebar persist antar-restart, ✅ preview file, ✅ checksum SHA-256 — semua selesai di Fase 13.

### Settings → Config sync (ala Tabby) ✅ (UI + persist)
`SettingsPage.tsx` → `ConfigSyncSection`: sub-tab **SYNC** (input **Sync host** + banner info) & **ADVANCED** (toggle **Sync hotkeys** / **Sync window settings** / **Sync Vault**). Setting baru di `settings.tsx`: `syncHost`, `syncHotkeys`, `syncWindow`, `syncVault`. **Catatan:** sinkronisasi nyata butuh **server sync kompatibel** (self-hosted) — Moorix belum menyediakannya; UI + penyimpanan setting sudah siap untuk implementasi backend sync di masa depan.

### Fase 12 — Serial/Telnet saved profiles + Master-password Vault ✅

**Serial/Telnet sebagai saved profile** (data model, editor, & launch sudah ada sejak sebelumnya — sesi ini menuntaskan pemicunya):
- ✅ `NewProfilePicker` sekarang **merender** template **Serial** & **Telnet** (sebelumnya ada di array keyboard-nav tapi tidak tergambar). Raw socket tetap disabled (butuh transport `raw_open`).
- ✅ Subtitle baris "Duplicate" per-tipe (`user@host:port` / `path · baud` / `host:port`), bukan asumsi SSH.
- ✅ Alur lengkap terverifikasi: `createNewProfile(type)` → `ProfileEditor` (tab GENERAL Serial=port+baud, Telnet=host+port; SSH tetap 7 tab) → simpan `userProfiles` → `launchUserProfile` buka `serialOpen`/`telnetOpen`/`sshOpenFromProfile` sesuai tipe.

**Master-password Vault** (frontend, Web Crypto — cross-platform termasuk mobile, tanpa Rust):
- ✅ `src/vault.ts` — PBKDF2-SHA256 (200k iter) → AES-GCM-256. Blob terenkripsi disimpan di `moorix.json` key `vault` (`{v,salt,verifier,entries}`). `verifier` = token dikenal terenkripsi → verifikasi master password tanpa menyimpannya. Key hidup di memori saat unlocked, dibuang saat lock. API: `createVault`/`unlock`/`lock`/`vaultSet`/`vaultGet`/`vaultDelete`/`changeMaster`/`destroyVault`/`vaultConfigured`/`isUnlocked`.
- ✅ `src/secrets.ts` — wrapper terpadu `secretGet/Set/Delete`: kalau vault terpasang → lewat vault (minta unlock via handler UI); kalau tidak → OS keychain (`secret_*`) seperti sebelumnya. Semua call-site (`profiles.ts` `sshOpenFromProfile` + jump host, `App.tsx` `saveProfile`/`deleteProfile`) dialihkan ke wrapper.
- ✅ `VaultUnlockModal` + gate di `App.tsx`: saat secret dibutuhkan tapi vault terkunci, modal minta master password (antre resolver bila banyak pemanggil paralel).
- ✅ `SettingsPage` → **Vault section**: create (password + konfirmasi), unlock/lock, change master password, remove (danger zone), indikator status locked/unlocked. Toast feedback.
- ✅ **Verifikasi**: `tsc && vite build` lolos (1831 modul). Runtime unlock/enkripsi belum diuji di window native (butuh app jalan — WDAC memblokir compile Rust dari sini, tapi fitur ini murni frontend jadi build = bukti tipe & bundling).

**Catatan Vault:**
- Password yang sudah terlanjur di OS keychain **tidak dimigrasi** otomatis saat vault dibuat — user isi ulang di profil. (Migrasi otomatis = follow-up opsional.)
- Alternatif `tauri-plugin-stronghold` (§18) **tidak dipakai**; Web Crypto dipilih karena lintas platform, tanpa dependensi Rust, dan bisa dibangun/diuji-build tanpa toolchain native.
- Master password **tidak tersimpan**; hilang = secret tak bisa dipulihkan (by design).

### Fase 13 — Polish: persist settings, port-forward toast, SFTP preview/checksum, iTerm2 themes ✅
> Diverifikasi live di `pnpm tauri dev` (window native, HMR frontend + recompile Rust 19s tanpa error).

- ✅ **Settings persist → `tauri-plugin-store`** (`settings.tsx`): boot dari localStorage (instant) lalu load dari store (`moorix.json` key `settings`) sebagai source-of-truth; tiap perubahan ditulis balik ke localStorage + store (debounce 300ms). Fallback ke localStorage di luar Tauri.
- ✅ **Toast error bind port-forward** (`forward.rs` emit event `forward-error` `{kind,bind,message}` saat `TcpListener::bind` gagal → `App.tsx` listener → toast merah). `run_local`/`run_dynamic` terima `AppHandle`; di-thread dari `ssh.rs`.
- ✅ **SFTP lebar panel persist antar-restart** — width terakhir disimpan ke `settings.sftpWidth` (kini via store) saat drag selesai; jadi default panel berikutnya & sesudah restart.
- ✅ **SFTP file preview** — sudah ada (`sftp_preview`/`local_preview` 512KB cap, modal text/image via double-click); dikonfirmasi jalan.
- ✅ **SFTP checksum SHA-256** — backend `sftp_checksum`/`local_checksum` (streaming 64KB, crate `sha2` yang sudah ada transitif via russh → tanpa build-script baru); menu klik-kanan "Checksum (SHA-256)" → modal hash + tombol Copy.
- ✅ **Import 17 skema iTerm2** (`iterm2Themes.ts`: Nord, Gruvbox Dark, Monokai, Catppuccin Mocha/Latte, Night Owl, Cobalt2, Snazzy, Palenight, Oceanic Next, Ayu Dark/Mirage/Light, GitHub Dark/Light, Solarized Light, Tomorrow Night, Base16 Default Dark) → digabung ke `THEMES`, otomatis muncul di Color scheme global & tab COLORS per-profil.
- ✅ **Verifikasi user (2026-07-16):** SSH connect live, port forwarding, & SFTP transfer end-to-end jalan di window native.

### Fase 14 — Settings → Window + rapikan sidebar ✅
- ✅ **Hapus item "SSH"** dari sidebar Settings (redundan dengan Profiles & connections) — `SectionId` & import `Globe` dibersihkan.
- ✅ **Window section** (`WindowSection`) — hanya kontrol yang benar-benar ke-wire ke perilaku Moorix (row Tabby yang cosmetic/tak relevan sengaja tak disertakan):
  - **Window**: *Window frame* Custom/Native → `getCurrentWindow().setDecorations()`; *Always on top* → `setAlwaysOnTop()`.
  - **Tabs**: *Hide tab index*, *Hide tab close button* (dibaca `TitleBar` via `useSettings`), *Close window after closing the last tab* (di `closeTab`).
  - **Panes**: *Focus follows mouse* → `Panes`/`SplitPane` `onMouseEnter` aktifkan pane.
  - **Hacks**: *Disable GPU acceleration* → petakan ke `rendererType` (webgl/dom).
  - Setting baru: `windowFrame`, `alwaysOnTop`, `hideTabIndex`, `hideTabCloseButton`, `closeOnLastTab`, `focusFollowsMouse` (persist via store).
  - Capability ditambah: `core:window:allow-set-decorations`, `allow-set-always-on-top`.
  - Verifikasi: `tsc` lolos; `tauri dev` recompile 11.6s tanpa error, app relaunch.

### Fase 15 — Settings → Shell + Profiles ADVANCED ✅
- ✅ **Shell section** (`ShellSection`) — default untuk local terminal:
  - **Default shell** (input + datalist shell umum; kosong = OS default) → dipakai Launcher "Local shell".
  - **Working directory** (kosong = home) → cwd untuk semua local shell.
  - Backend: `session_open`/`PtySession::spawn` terima `cwd: Option<String>` (validasi `is_dir`, fallback home). Frontend: `localOpen` baca default modul (`setLocalShellDefaults`) yang di-mirror App dari settings → berlaku ke semua local shell tanpa ubah call-site.
  - Setting baru: `defaultShell`, `shellWorkingDir`.
- ✅ **Profiles → ADVANCED** (tab kini fungsional, sebelumnya span mati):
  - **Show recent profiles in selector** (angka 0–20) → palette ProfileMenu tampilkan section "Recent" (dilacak `recentProfiles` di App saat launch, cap 20).
  - **Show built-in profiles in selector** (toggle) → sembunyikan built-in dari palette.
  - Setting baru: `showBuiltinProfiles`, `recentProfilesCount`, `recentProfiles`.
  - **Bonus**: subtitle/badge palette diperbaiki per-tipe (Serial `path·baud`, Telnet `host:port`) — sebelumnya selalu asumsi SSH.
- ✅ Verifikasi: `tsc` lolos + `cargo check` lolos (12s). ⚠️ **Belum diuji runtime** — Smart App Control (WDAC) memblokir exe hasil build baru saat di-spawn tool saya (`os error 4551`), jadi app perlu dijalankan ulang `pnpm tauri dev` dari terminal user.

### Fase 16 — Google login + polish SFTP + rilis `v0.1.0-pre.7` ✅ (2026-07-18)
- ✅ **SFTP context menu flip** (`SftpPanel.tsx`): menu klik-kanan kini diukur via `useLayoutEffect` (render hidden → ukur → posisikan) dan **flip ke atas/kiri** bila melewati tepi viewport (pad 4px) — sebelumnya terpotong saat klik item di bagian bawah panel.
- ✅ **Sign in with Google fungsional** (`SettingsPage.tsx` → `AccountSection`): tombol dulu hanya `console.log`; kini memanggil `start_google_login` → `exchange_google_token` (`cloud_auth.rs`), dengan state loading (tombol disabled, "Menunggu login di browser…") + hasil inline (hijau sukses / merah pesan error). **Tombol Apple di-comment** (disembunyikan sampai flow-nya siap).
- ✅ **Client secret keluar dari kode**: `CLIENT_SECRET` di `cloud_auth.rs` kini `option_env!("MOORIX_GOOGLE_CLIENT_SECRET")` (compile-time). Lokal: `src-tauri/.cargo/config.toml` `[env]` — **gitignored** (masuk daftar §0B konsep-nya; nilai = client secret OAuth "Moorix Client"). CI: repo secret `MOORIX_GOOGLE_CLIENT_SECRET` diteruskan di `release.yml` + `build-windows.yml`. Latar: push sempat diblokir **GitHub push protection** karena secret ter-hardcode; commit dibuat ulang tanpa secret.
- ✅ **Google Cloud Console** (project `Moorix Sync`, client Desktop `716246034426-…`): status OAuth **Testing → In production** (scope `drive.appdata` = non-sensitive, tanpa verifikasi Google); test user tak dibutuhkan lagi; branding tanpa logo (verifikasi branding di-skip dulu). Login end-to-end diuji sukses.
- ✅ **Rilis `v0.1.0-pre.7`**: bump versi 4 file + tag. Run pertama **gagal** — `Resource not accessible by integration` saat create release: setting repo **Actions → Workflow permissions ternyata `read`** → diubah ke **`write`** via `gh api` (ini juga fix permanen). Tag dipindah ke commit berisi CI fix, run kedua **sukses 4 platform** + `latest.json` + semua `.sig` → auto-update dari pre.6 tetap jalan (kunci signing sama, semver pre.7 > pre.6).
- 🔧 **Tooling**: GitHub CLI (`gh`) di-install via winget + auth sebagai `oktajianto` — dipakai untuk repo secret, inspeksi run, dan API setting.
- ✅ ~~Lanjutan sync~~ → dikerjakan di Fase 17.

### Fase 17 — Google Drive sync nyata + Account UI + README global ✅ (2026-07-18)
- ✅ **Account & Sync UI** (`SettingsPage.tsx` → `AccountSection`): akun Google **dipersist** di store (`moorix.json` key `googleAccount`: email/name/picture + access & refresh token) → restore saat mount; kartu profil (avatar / inisial fallback, nama, email, indikator "Signed in") + tombol **Log out** (revoke token best-effort via `google_logout` + hapus store). Scope OAuth ditambah `openid email profile`; command baru `google_user_info` (userinfo endpoint).
- ✅ **Callback browser dirapikan** (`cloud_auth.rs`): response kini ber-`Content-Type: text/html` (sebelumnya tampil HTML mentah) + halaman sukses ber-style gelap.
- ✅ **Drive sync nyata** (menggantikan mock di Config sync):
  - Backend: `google_refresh_token` (silent re-auth), `drive_upload_appdata` (create multipart / overwrite media ke **appDataFolder**, file `moorix-sync.bin`), `drive_download_appdata`. reqwest 0.13 perlu feature **`query`**.
  - **Bugfix penting** (`sync.rs`): payload membaca `store.json` yang **tidak pernah ada** → diganti `moorix.json` (payload selama ini kosong!). `googleAccount` **di-strip dari payload** (token per-perangkat; pull tidak menimpa/membocorkan sesi) dan di-merge balik saat apply.
  - Frontend: Push = password → `export_sync_data` (AES-GCM) → upload (pesan ukuran backup); Pull = password → **confirm timpa** → download → `import_sync_data` → **`relaunch()`** (hindari store in-memory menimpa hasil pull). Tombol busy-state; error inline. Silent auth: refresh token → fallback login interaktif.
- ✅ **README**: bagian atas ditulis ulang **bahasa Inggris** (audiens global) — tagline "hosting/VPS/cloud management, SSH + SFTP satu jendela", screenshot `moorix-layout-sample.png` (baru, root repo), 7 poin "Why Moorix?", CTA unduh ke Releases; Tech stack ke bawah tetap Indonesia.
- ✅ Verifikasi: `tsc` + `cargo check` lolos; app dev auto-rebuild & jalan.

### Fase 18 — SFTP: edit file in-app (Monaco) + save ke remote/lokal ✅ SELESAI (teruji native, user 2026-07-22)
> **Progress bertahap:** ✅ Tahap 1 (backend) · ✅ Tahap 2 (setup Monaco lokal) · ✅ Tahap 3 (UI editor + save + auto-refresh)
> Tujuan: file teks (`.txt`, `.html`, `.ts`, dll) yang dibuka di SFTP file manager bisa **diedit
> langsung di aplikasi** dan **disimpan** — jika file remote → tulis balik ke remote (SFTP),
> jika lokal → tulis balik ke disk lokal. Editor pakai **Monaco** (mesin editor VS Code).
> Berlaku untuk **remote dan lokal**.

**Kondisi awal (yang sudah ada):**
- `sftp_preview` (`sftp.rs`) & `local_preview` (`localfs.rs`) baca **maks 512KB** → `PreviewModal` (`SftpPanel.tsx`) tampil **read-only** di `<pre>`.
- Primitif tulis ke remote sudah ada: `sftp.create(path)` (truncate+write, dipakai di `do_upload`).

**⚠️ Jebakan yang harus dihindari:** mode edit **tidak boleh** memakai hasil `*_preview` (terpotong 512KB) sebagai sumber — kalau disimpan, file remote/lokal akan ke-truncate & sisanya hilang. Edit **wajib baca file utuh**.

**Keputusan (terkunci ✅):**
1. ✅ **Editor = Monaco**, di-**install & bundle lokal** (bukan CDN) — `@monaco-editor/react` default load dari jsdelivr; di app Tauri harus offline-safe → `loader.config({ monaco })` + setup Web Worker via Vite. Konsekuensi bundle +~1–5 MB (wajar untuk desktop).
2. ✅ **Batas ukuran**: **soft 1 MB** (default boleh edit). File **> 1 MB** tetap bisa dibuka lewat **dialog konfirmasi (English)** "This file is X MB. Editing large files may be slow. Continue?" → jika lanjut, tampil **loading "Downloading & preparing editor…"** agar user paham perlu waktu setup/download. **Hard cap ~10 MB** (di atas itu tolak total — Monaco freeze).
3. ✅ **Remote + lokal** — dua-duanya bisa diedit & disimpan.
4. ✅ **File biner** (mis. `.png`, `.zip`) → tetap **preview read-only** (editor hanya untuk teks; deteksi biner → blok edit).
5. ✅ **Setelah Save → auto-refresh listing** sisi terkait (ukuran/tanggal update).

**Rencana kerja:**
- **Backend (Rust) — ✅ TAHAP 1 SELESAI (`cargo check` lolos):**
  - ✅ `sftp_read_text(sftp_id, path)` (`sftp.rs`) — baca **utuh**; tolak bila > `EDIT_HARD_CAP` (10 MB), berisi **NUL byte** (biner), atau bukan **UTF-8 valid**.
  - ✅ `sftp_write(sftp_id, path, content)` — `create` + `write_all` + flush/shutdown + **verify size**.
  - ✅ `local_read_text` + `local_write` (`localfs.rs`) — versi lokal (share `EDIT_HARD_CAP`, cek NUL + UTF-8).
  - ✅ 4 command didaftarkan di `lib.rs` `invoke_handler`.
- **Setup Monaco lokal — ✅ TAHAP 2 SELESAI (`pnpm build` lolos):**
  - ✅ Dep: `monaco-editor@0.56` + `@monaco-editor/react@4.7`.
  - ✅ `src/monaco.ts` — offline setup: `loader.config({ monaco })` (pakai bundle lokal, bukan CDN) + Web Worker via Vite `?worker`. **Catatan:** path worker harus **tanpa** prefix `esm/vs/` (exports map monaco me-rewrite `"./*"` → `"./esm/vs/*.js"`; prefix ganda = gagal resolve). Diimpor sekali di `main.tsx`. Plus helper `languageForFile()` (ekstensi → language id Monaco).
  - ✅ **Heap build**: bundling worker TS (kompiler TypeScript penuh) bikin `vite build` OOM di heap default → script `build` diberi `cross-env NODE_OPTIONS=--max-old-space-size=4096` (dep `cross-env`), berlaku juga di CI. Bundle main ~4.8 MB (gzip 1.26 MB) — wajar untuk desktop (load dari disk lokal); bahasa lain code-split, dimuat on-demand.
- **Frontend (`SftpPanel.tsx`) — ✅ TAHAP 3 SELESAI (`tsc` + `pnpm build` lolos):**
  - ✅ `PreviewModal` di-rewrite jadi **mesin state** `phase`: `image` (read-only, seperti dulu) · `confirm` (file >1MB) · `loading` ("Downloading & preparing editor…") · `editor` (Monaco) · `error`.
  - ✅ Deteksi bahasa via `languageForFile(name)`; tema Monaco ikut app (`light`/`vs-dark` dari `documentElement.classList`).
  - ✅ **Save** (tombol) + **Ctrl/Cmd+S** (via `saveRef` agar tak kena stale closure Monaco); indikator **dot amber** "unsaved" saat `text !== original`; **konfirmasi discard** saat close/Esc bila dirty.
  - ✅ Dialog konfirmasi file **>1MB** (English, tampil ukuran MB) → Continue → loading → editor.
  - ✅ `size` entry diteruskan ke modal (menentukan soft-cap); **auto-refresh listing** sisi terkait via `onSaved` (`loadLocal`/`loadRemote`) setelah save sukses.
  - ✅ Command: lokal `local_read_text`/`local_write`, remote `sftp_read_text`/`sftp_write`.
  - ✅ **Kontrol editor (header):** toggle **Word wrap** (ikon `WrapText`, default **on** — live via `editor.updateOptions`, tanpa remount) + toggle **Maximize/Restore** (`Maximize2`/`Minimize2` — modal `98vw×97vh` saat maximized vs `max-w-4xl×82vh` normal; Monaco `height:100%` + `automaticLayout` menyesuaikan).
- **Perilaku default:** baca/tulis **UTF-8**; line ending (CRLF/LF) **tidak** dikonversi (isi disimpan apa adanya).

**Verifikasi:**
- ✅ `cargo check` (backend), `tsc` + `pnpm build` (frontend) lolos.
- ✅ **Runtime Monaco (harness browser)**: ke-5 Web Worker Monaco (typescript/json/css/html/editor) ter-instansiasi OK via `MonacoEnvironment` lokal → **setup offline Tahap 2 terbukti**; `monaco.editor.create` sukses.
- ⚠️ **Browser preview tidak bisa dipakai memverifikasi app ini.** `main.tsx` menunggu `maybeAutoPull()` sebelum `mount()`, dan rantai itu memanggil Tauri store yang **menggantung** (bukan reject) di browser biasa → `mount()` tak pernah jalan, `#root` kosong, tanpa error. Jadi "tanpa error di console" **bukan** bukti app sehat. Verifikasi UI **wajib** di window native (`pnpm tauri dev`). Tes Monaco di atas tetap sahih karena meng-import monaco langsung, tak bergantung app mount.
- ✅ **Teruji E2E di window native** (uji user, 2026-07-22): file remote `.env_ex` terbuka di Monaco dengan syntax highlight + line number + minimap; edit → Save → isi & tanggal ter-update. Alur konfirmasi >1MB, blok biner, dan blok >10MB tercakup lewat jalur klasifikasi di Fase 19-T1.

### Fase 19 — Editor multi-file: minimize + tab + split view ✅ SELESAI
> **Progress bertahap:** ✅ T1 (state ke App + tab bar + minimize) · ✅ T2 (split view) · ✅ T3 (polish) — **ketiga tahap selesai & teruji di window native (user, 2026-07-22).**
> **Keputusan user (2026-07-22):** ketiga usulan Claude di bawah **disetujui** — (1) sesi tertutup → read-only + tanda, (2) minimize = pill melayang, (3) split bebas bersarang.
> Permintaan user (2026-07-22): (a) editor bisa **di-minimize** supaya bisa buka **>1 file**, (b) **split view** 2 file kiri-kanan ala VS Code/Chrome, dan **bisa dipisah lagi**.

**Diagnosis:** editor Fase 18 adalah **modal 1-file** milik `SftpPanel` (`fixed inset-0`, state `preview` tunggal). Selama berbentuk modal, buka >1 file mustahil — karena itu minimize & split sebenarnya **satu paket**: editor harus jadi **surface multi-dokumen** dengan state sendiri.

**Aset yang bisa dipakai ulang:** `paneTree.ts` (`splitLeaf`/`closeLeaf`/`setSizesAtPath` + renormalisasi, 21 unit test) & divider draggable `SplitPane.tsx` — logikanya persis kebutuhan split editor. ⚠️ Ganjalan: `PaneLeaf` terikat terminal (`open: OpenSession`, `TermOptions`).
- **Opsi A (rekomendasi):** duplikasi ~90 baris tree-ops ke `editorTree.ts` khusus editor → **risiko nol** ke kode terminal yang stabil.
- **Opsi B:** generify `paneTree` jadi generic + wrapper terminal → lebih rapi, tapi menyentuh kode terminal + 21 test-nya.

**Rancangan:**
1. **State editor naik ke level App** (bukan di `SftpPanel`, yang state-nya mati saat re-render/tutup): daftar file terbuka `{ id, path, name, isLocal, sftpId, dirty }`.
2. **Overlay editor**: **tab bar** (1 tab/file, dot unsaved per tab) · **Minimize** → collapse jadi pill kecil ("📝 3 files"), file tetap hidup, klik = restore · **Split right/down** pada pane aktif → pohon pane; tutup satu sisi = collapse otomatis.
3. **Monaco: satu `model` per file** (`monaco.editor.createModel`), bukan value string — agar **undo history, kursor, scroll terjaga** saat pindah tab/split. Model **wajib di-dispose** saat file ditutup (cegah bocor memori). Dua pane atas file yang sama otomatis berbagi model (sinkron, seperti VS Code).

**Keputusan yang menunggu user (usulan Claude ditandai →):**
1. **Sesi SSH ditutup saat editor masih buka** (file remote menyimpan `sftpId`, Save akan gagal): (a) tutup paksa editor file itu · **→ (b) biarkan terbuka read-only + tanda "session closed"** · (c) coba buka ulang sesi saat save.
2. **Bentuk minimize**: **→ pill melayang** (dekat alur "edit sambil lihat file manager") · atau editor jadi **tab aplikasi** sendiri (seperti Settings).
3. **Batas split**: 2 pane saja · **→ bebas bersarang** (gratis, logika pohon sudah ada).

**Ukuran:** ~3–4x Fase 18. Pentahapan: **T1** state ke App + tab bar + minimize/restore (belum split) · **T2** split view (pane tree + divider) + collapse saat tutup pane · **T3** polish (drag tab antar-pane, shortcut, konfirmasi close-all saat dirty).

**✅ T1 SELESAI** (`tsc` + `pnpm build` lolos; app native jalan):
- ✅ `src/editorStore.tsx` — `EditorProvider` + `useEditorDocs()`: daftar `EditorDoc` (`id` = `local:`/`remote:` + path, juga dipakai sebagai **Monaco model path**), `activeId`, `minimized`, `openDoc`/`closeDoc`/`closeAll`/`patchDoc`, dan `lastSaved` (counter) sebagai sinyal refresh listing. `EDIT_SOFT_CAP` pindah ke sini.
- ✅ `src/components/EditorOverlay.tsx` — overlay dengan **tab bar** (dot unsaved + tombol X per tab), kontrol **Minimize** (collapse jadi **pill** "N files" + dot dirty; klik = restore) · **Maximize/Restore** · **Word wrap** · **Save** (+Ctrl/Cmd+S via `saveRef`). Fase per-dokumen: `confirm` (>1MB) / `loading` / `ready` / `error`. Tutup tab & close-all **konfirmasi bila dirty** dan **dispose Monaco model** (cegah bocor).
- ✅ **Per-file model**: satu `<Editor path={doc.id}>` — @monaco-editor/react menyimpan model per path, jadi **undo history, kursor, dan scroll terjaga** saat pindah tab.
- ✅ `main.tsx` — `<EditorProvider>` membungkus `<App/>` + `<EditorOverlay/>` (overlay hidup di luar `SftpPanel`, jadi tak mati saat panel re-render).
- ✅ `SftpPanel.tsx` — `PreviewModal` disusutkan jadi **preview gambar read-only saja**; file non-gambar dirutekan ke `openDoc()` lewat handler `openEntry` (prop `setPreview` → `onOpenFile`). Listing auto-refresh saat `lastSaved` berubah.
- ✅ **Uji manual window native (user, 2026-07-22) — LOLOS:** 3 tab muncul · save mengenai **file yang benar** saat banyak tab · **lokal + remote bersamaan** aman (tak tertukar) · undo/scroll/kursor per file terjaga saat pindah tab (kursor melompat ke lokasi edit saat undo = perilaku normal Monaco/VS Code) · buka file sama 2x → fokus tab lama (tak duplikat) · dot unsaved per tab · konfirmasi discard saat tutup tab · pill menampilkan dot dirty · close-all menyebut jumlah file dirty · gambar tetap preview read-only · listing auto-refresh setelah save.
- 🐛 **Bug ditemukan & diperbaiki — file biner/kelewat besar menawarkan "Continue".** `.zip` 15.4 MB memunculkan dialog konfirmasi file besar; kalau diteruskan, ia mengunduh 15.4 MB lalu tetap gagal (biner **dan** > hard-cap 10 MB). Sebab: gerbang ukuran di frontend jalan lebih dulu, deteksi biner baru di backend setelah unduh. **Fix** (`editorStore.tsx` → `initialState()`): klasifikasi di depan memakai data listing (nama + ukuran) — ekstensi biner (`BINARY_EXTS`: arsip/media/executable/dokumen/font/db) → langsung fase `error` "Binary file"; ukuran > `EDIT_HARD_CAP` (10 MB, mirror konstanta backend) → langsung `error` "too large"; sisanya baru `confirm` (>1 MB) / `loading`. **Tanpa unduh sia-sia.** Backend tetap mengecek NUL byte + UTF-8 sebagai pertahanan lapis kedua (menangkap biner berekstensi menipu).
- ℹ️ Catatan dev: `editorStore.tsx` mengekspor komponen **dan** nilai non-komponen, jadi Vite Fast Refresh tak bisa incremental → tiap edit file itu memicu **full page reload** (tab editor yang terbuka ikut hilang). Hanya gangguan saat dev, tak berpengaruh di build.

**✅ T2 SELESAI — split view** (`tsc` + `pnpm build` lolos):
- ✅ `src/editorTree.ts` (**Opsi A** dijalankan — duplikasi, bukan generify, jadi kode terminal + 21 test-nya tak tersentuh): `EditorLeaf {paneId, docId}` / `EditorSplit {dir, sizes, children}` + `splitLeaf`, `closeLeaf` (collapse split 1-anak + renormalisasi), `setSizesAtPath`, `findLeaf`, `leafCount`, `mapLeaves`, `setPaneDoc`, `MIN_PANE`.
- ✅ **Model dua lapis** di `editorStore`: `docs` = himpunan file terbuka (tab bar global), `tree` = tata letak split di mana tiap pane menunjuk satu doc lewat `docId`. **Menutup pane tidak menutup dokumen** (seperti VS Code). Operasi baru: `showDoc` (klik tab → arahkan **pane aktif**), `splitPane`, `closePane`, `resizePane`, `setActivePane`.
- ✅ **Alur pakai:** buka 2 file → **Split right/down** (tombol hover di pojok pane) → pane baru mulai dari file yang sama → klik tab lain untuk mengganti isi pane aktif → jadilah kiri-kanan. Tutup pane = collapse balik ("dipisahkan lagi"). Split **bebas bersarang** (keputusan user no. 3).
- ✅ Divider draggable dengan matematika & clamp `MIN_PANE` identik dengan `SplitPane.tsx` terminal; pane aktif ditandai outline `--m-accent`.
- ✅ **`keepCurrentModel`** di `<Editor>` — krusial: dua pane bisa menampilkan file yang sama (model Monaco dipakai bersama, edit tersinkron). Tanpa ini, menutup satu pane akan men-dispose model yang masih dipakai pane lain. Disposal tetap eksplisit saat **tab** ditutup.
- ✅ Ctrl/Cmd+S sadar-pane: `savePane(paneId)` menyimpan dokumen yang sedang ditampilkan pane itu, via `saveRef` agar tak kena stale closure.
- ✅ **Uji manual native (user, 2026-07-22) — LOLOS:** split kiri-kanan dua file berbeda · divider mulus · split bersarang · close pane collapse benar (file tetap di tab bar) · dua pane file sama → edit tersinkron.
- 🐛 **Bug ditemukan & diperbaiki — Ctrl+S menyimpan pane yang salah.** Gejala: Ctrl+S jalan di satu pane, "tak berfungsi" di pane lain. **Akar masalah:** keybinding didaftarkan per-editor via `editor.addCommand()`, padahal **standalone keybinding service Monaco itu tunggal per window** — chord yang sama didaftarkan di tiap pane membuat **hanya satu handler yang menang**, dan handler itu terikat `paneId` miliknya sendiri. Jadi Ctrl+S di pane B sebenarnya memanggil save untuk pane A; karena file A kebetulan bersih, `savePane` keluar lebih awal dan tampak "tidak terjadi apa-apa". **Bila kedua file sama-sama dirty, ini menyimpan file yang salah.** **Fix:** `addCommand` dihapus; Ctrl/Cmd+S ditangani **satu listener `keydown` di level overlay** memakai `activePaneId` terkini (di-skip saat `minimized` agar tak membajak Ctrl+S ketika user memakai terminal/file manager). ✅ Diverifikasi user: dua file sama-sama dirty → Ctrl+S menyimpan pane yang benar, tak tertukar.

**✅ T3 SELESAI — polish** (`tsc` + `pnpm build` lolos):
- ✅ **Sesi SFTP tertutup → read-only** (menjalankan keputusan user no. 1). `EditorDoc.sessionClosed`; `SftpPanel` memanggil `invalidateSftp(sftpId)` di cleanup **sebelum** `sftp_close`, menandai semua dokumen milik sesi itu. Efek: badge **"read-only"** di header, tombol Save non-aktif, Monaco `readOnly`, dan `savePane` menolak dengan pesan jelas ("SFTP session closed — reopen the file manager to save"). Dokumen **tetap terbuka & terbaca**, tidak ditutup paksa.
- ↩️ **Drag tab ke pane — DICOBA LALU DIBUANG.** Implementasi awal (tab `draggable` + pane sebagai drop target, MIME `application/x-moorix-doc`) **tidak andal saat diuji user**: Monaco menangani drag-and-drop sendiri di dalam area editor, sehingga drop di atas pane tidak konsisten sampai ke handler kita. Akar pastinya tidak dikejar karena diganti mekanisme yang lebih baik (di bawah) — jalur drag dihapus seluruhnya (termasuk aksi `showDocInPane` di store) agar tak ada dua jalur dengan salah satunya goyah.
- ✅ **Split dengan pemilih file (usulan user, menggantikan drag)** — klik **Split right/down** saat >1 file terbuka → muncul **dropdown daftar file terbuka** → pilih satu → pane baru langsung berisi file itu. Hanya **1 gestur** (sebelumnya 2: split lalu ganti isi pane), lebih *discoverable*, dan **tidak bergantung pada DnD di atas Monaco** — jadi sekaligus menyelesaikan bug di atas. Bila hanya 1 file terbuka, split langsung tanpa menu. File yang sedang tampil ikut masuk daftar (ditandai `current`) supaya bisa **membandingkan dua bagian file yang sama**. `splitPane(paneId, dir, docId?)` — `docId` opsional, default ke file pane sumber.
- ⛔ **Shortcut tambahan sengaja TIDAK ditambahkan.** `Ctrl-Tab`/`Ctrl-Shift-Tab` (next/previous tab), `Ctrl-Shift-S`/`Ctrl-Shift-D` (split pane terminal), `Ctrl-Shift-W` (close tab) **sudah terpakai** di `hotkeys.ts`. Menambah shortcut editor berisiko bentrok dengan hotkey terminal yang sudah mapan; nilai tambahnya kecil dibanding risikonya. Ctrl/Cmd+S saja sudah cukup dan sudah ter-scope (hanya saat overlay terbuka & tidak minimized).
- ✅ **Uji manual native (user, 2026-07-22):** dropdown split jalan · split 1 file (tanpa menu) · split file yang sama (edit tersinkron) · panel SFTP ditutup → file remote jadi read-only.
- 🐛 **Bug ditemukan & diperbaiki — read-only tidak pernah dicabut.** Setelah panel SFTP ditutup lalu **dibuka lagi**, dokumen tetap read-only selamanya. Sebab: `sessionClosed` hanya pernah di-set `true`, dan `sftpId` lama tak pernah diganti dengan channel baru. **Fix:** `EditorDoc` kini menyimpan **`sessionId` (sesi SSH)** yang umurnya lebih panjang dari `sftpId` (yang diterbitkan ulang tiap panel dibuka). `SftpPanel` memanggil `rebindSftp(sessionId, sftpIdBaru)` setelah `sftp_open` sukses → dokumen milik sesi itu diarahkan ke channel baru dan `sessionClosed` dicabut, jadi **bisa diedit & disimpan lagi**.
- 🐛 **Celah terkait yang ikut ditutup — tabrakan `docId` antar-server.** `docId` remote sebelumnya hanya `remote:<path>`, sehingga file **berpath sama di dua server berbeda** (mis. `/root/.env` di VPS A dan B) dianggap **satu dokumen** — membuka yang kedua hanya memfokuskan tab yang pertama, menampilkan isi server yang salah. Kini `remote:<sessionId>:<path>` (lokal tetap `local:<path>`). `docId` juga dipakai sebagai path model Monaco, jadi keunikan ini wajib.
- ✅ **Tab mendekat saat split (permintaan user, ala Chrome).** Saat split memakai file lain, tab file itu **dipindah tepat di sebelah** tab file pane sumber, sehingga urutan tab mencerminkan tata letak split. Indeks anchor dihitung ulang setelah pemindahan agar tak meleset.
- ℹ️ **Kode lengkap** (kedua fix di atas + tab-mendekat sudah terpasang). Sisa hanya re-verifikasi manual opsional: tutup panel SFTP → buka lagi → file remote bisa diedit kembali (badge read-only hilang); split dengan file lain → tab-nya berpindah mendekat.

---

### Fase 21 — Terminal Search (Find in terminal, Ctrl+F) ✅ (implementasi; uji native pending)
> Permintaan user (2026-07-26): tambah **search (Ctrl+F)** di panel terminal (SSH/CMD/PowerShell) untuk mencari teks yang muncul di output terminal — dengan highlight & navigasi next/prev.

**Rancangan:** search bekerja di sisi frontend atas isi buffer xterm (scrollback termasuk), jadi **tidak perlu perubahan backend Rust** — murni addon xterm + overlay React. Addon `@xterm/addon-search` sudah tercantum di §4 sejak awal tapi belum terpasang; kini dipasang (`0.16.0`, kompatibel xterm 6).

- ✅ **Dep:** `pnpm add @xterm/addon-search` → `0.16.0`.
- ✅ `src/components/TerminalView.tsx` — `SearchAddon` di-*load* per-pane di `createEntry`, disimpan di `PaneEntry.search`. Overlay dirender **sebagai sibling** dari container xterm (bukan anak yang sama) supaya React tak berebut DOM dengan xterm saat pane di-*re-parent* antar split. Fungsi modul baru **`openPaneSearch(paneId)`** membuka Find bar pane aktif lewat `PaneEntry.openSearch` (ref callback yang didaftarkan komponen React saat mount, di-null-kan saat unmount). Sinyal `searchSignal` di-*bump* tiap Ctrl+F agar menekan lagi saat bar terbuka **me-refocus** input & re-seed dari seleksi terminal. Warna highlight ikut tema (`--m-accent` untuk match aktif).
- ✅ `src/components/TerminalSearch.tsx` (baru) — Find bar melayang di pojok kanan-atas pane: input + hitungan **`index/total`** (dari `onDidChangeResults`) + toggle **Match case / Whole word / Regex** + tombol prev/next/close. **Enter** = next, **Shift+Enter** = prev, **Esc** = tutup (bersihkan dekorasi + balikkan fokus ke terminal). Pencarian **incremental** saat mengetik (highlight semua match, dekorasi via `decorations`); pola regex invalid → indikator "Bad pattern" tanpa melempar. Prefill dari seleksi terminal (satu baris) saat dibuka.
- ✅ `src/hotkeys.ts` — action baru **`find`** default **`Ctrl-F`** (masuk registry → **overridable** di Settings → Hotkeys, sejajar copy/paste/clear). Karena lewat registry, dispatcher global App menangkap Ctrl+F **sebelum** xterm meneruskannya ke shell (capture-phase `preventDefault`+`stopPropagation`), jadi tidak lagi terkirim sebagai `forward-char` ke readline.
- ✅ `src/App.tsx` — `case "find": openPaneSearch(activePaneId)` di `runAction`; import `openPaneSearch`.
- ✅ **Verifikasi:** `tsc --noEmit` bersih + `pnpm build` lolos (bundle addon OK). **Uji E2E native masih pending** — output terminal berasal dari backend Tauri (PTY/SSH) yang tak aktif di preview browser biasa, jadi pencarian atas output nyata perlu window native (konsisten dgn catatan uji native di dokumen ini).
- ℹ️ **Catatan default hotkey:** `Ctrl-F` sengaja dipilih sesuai permintaan user meski di shell ia biasanya `forward-char`. Karena overridable, user yang butuh `forward-char` bisa memindah ke mis. `Ctrl-Shift-F`.

---

### Fase 22 — SFTP: dropdown folder induk di address bar ✅ (implementasi; uji native pending)
> Permintaan user (2026-07-26): di **address bar SFTP**, tambah **dropdown daftar folder induk** — saat sudah masuk folder dalam-dalam, bisa **lompat langsung** ke folder induk mana pun atau ke root **tanpa klik Up/Back berkali-kali**.

- ✅ `src/components/SftpPanel.tsx` — helper murni **`ancestors(path)`** membangun rantai folder saat ini → semua induk → root (nearest-first), mis. `/a/b/c` → `["/a/b/c","/a/b","/a","/"]`. Dibangun dengan menjalankan `parentPath` berulang, jadi berhenti wajar di `/` (remote) atau drive root `C:` (lokal) — konsisten dengan tombol Up yang sudah ada.
- ✅ **UI dropdown** di toolbar `FileHalf`: tombol **chevron** di ujung address bar (di samping teks path). Klik → menu daftar folder (ikon `Folder` + nama folder, `title` = path penuh), folder aktif ditandai **"current"** (non-navigasi). Pilih salah satu → `onPath(folder)` → pane pindah + listing dimuat ulang. Menu **tutup** saat klik di luar / **Esc**. Berlaku untuk **kedua pane** (Local & Remote); tombol dinonaktifkan saat pane remote belum tersambung (`disabled`).
- ✅ **Selection dibersihkan saat lompat** — `onPath` di kedua sisi kini `setSel*(new Set())` dulu sebelum set path (juga memperbaiki input-path manual: seleksi lama tak lagi menyorot nama yang tak ada di folder baru).
- ✅ **Verifikasi:** `tsc --noEmit` bersih + `pnpm build` lolos. **Uji E2E native pending** (SFTP butuh backend Tauri — sama seperti fitur SFTP lain).

---

### Rilis publik 0.1.0 ✅ (2026-08-03)
> Seri pra-rilis `0.1.0-pre.N` lulus jadi **rilis publik pertama `0.1.0`** (tag `v0.1.0` di-push → workflow `release.yml` build+sign 4 platform, run **30790649702** sukses, 13 asset, `prerelease: false`). Sorotan sejak `pre.13`:

- ✅ **Database Manager native (Fase 20)** — panel ala phpMyAdmin di dalam Moorix untuk **MySQL/MariaDB + PostgreSQL** lewat SSH tunnel yang sudah ada (127.0.0.1, tak ada port DB terekspos). Profil DB = anak profil SSH, kredensial di vault. Meliputi: tree database/tabel (grup per-schema di PG), SQL editor (autocomplete sadar-schema + tipe ramah), browse + edit/insert/delete inline (Browse↔SQL tersinkron), **Structure** (add/edit/drop kolom, posisi First/After di MySQL, NOT NULL, DEFAULT), **enum terpandu** (di dialog kolom; PG create/extend type idempoten, boleh nilai kosong asal ada ≥1 non-kosong), create/drop/rename tabel & database, dan **export/import `.sql`** (mysqldump/mysql · pg_dump/psql; tabel hasil import langsung muncul di sidebar). Detail pentahapan 20A–20D di **§19**.
- ✅ **SFTP: download + aksi multi-select** — download file & folder (rekursif, progres) langsung ke **folder Downloads OS**, satu atau banyak sekaligus; **multi-delete** dan **multi-compress** (beberapa item → satu arsip `.zip`/`.tar`).
- ✅ **Terminal Search (Fase 21)** + **dropdown folder induk SFTP (Fase 22)**.
- ✅ **Fix compress/extract `.zip`/`.tar` SFTP** — dulu gagal "ssh session not found" (id SFTP dicocokkan ke map sesi SSH); kini pakai id sesi SSH. Di Windows arsiver dipatok ke **System32 bsdtar** (GNU tar bawaan salah label & tak bisa baca zip).
- ✅ **Keamanan kredensial DB** — password ke tool CLI lewat file **mode-600** (`--defaults-extra-file` / `.pgpass` / `PGPASSFILE`), tak pernah di argv (bocor lewat daftar proses).
- ✅ **Versi `0.1.0`** di 4 file (`package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`) — kata "pre" dihapus; README menandai DB manager **Completed**.
- ✅ **Catatan changelog website:** halaman changelog Moorix menarik **body GitHub Release** via API dan `parseBody()` hanya membaca **bullet** di bawah heading `## Added`/`Fixed`/`Changed` (paragraf jadi summary). Body rilis `v0.1.0` sudah ditulis ulang mengikuti format itu (bukan dari message tag — `release.yml` memakai `releaseBody` statis).

### Pra-rilis 0.1.1-pre.1 ✅ (2026-08-03)
> Perbaikan bug pasca-0.1.0, di-bump ke `0.1.1-pre.1` (4 file versi) + tag `v0.1.1-pre.1`.

- ✅ **Fix modal Add/Edit kolom (Structure) — tombol Save/Cancel selalu terlihat.** Saat type **enum** dengan banyak nilai, isi modal meluber sampai Save/Cancel keluar viewport. `ColumnDialog` (`DatabasePanel.tsx`) kini kontainer **flex-column** `max-h-[88vh]`; body (Name/Type/editor enum/NOT NULL/Default/Position) jadi area **scroll** (`min-h-0 flex-1 overflow-auto`), sedangkan header & footer (Cancel/Save) **pinned** (tak ikut scroll). Pola sama dgn Create table/Create enum dialog. `tsc --noEmit` lolos.

### Fix — password DB ikut Google Drive sync ✅ (implementasi; uji native pending, 2026-08-03)
> Bug user: login Google yang sama di perangkat lain → klik **Connect** pada database gagal tersambung karena **password DB tak tersimpan di Drive**. Harusnya langsung tersambung.

- ✅ **Akar masalah:** `get_sync_payload` (`sync.rs`) mengumpulkan secret **hanya** untuk profil `userProfiles` (keyed by profile id). Password DB disimpan di keychain keyed by **DBProfile id** (`App.saveProfile` → `secretSet(d.id, …)`), dan tak pernah ikut dikumpulkan → tak tersync.
- ✅ **Fix:** di loop `userProfiles`, kini juga iterasi `p.databases[]` dan ambil secret per `d.id` ke `secrets_map`. Sisi restore (`apply_sync_payload`) sudah generik (set semua secret di map) → tak perlu diubah. Berlaku utk auto-sync **dan** Push/Pull manual (keduanya lewat `export_sync_data`). `cargo check` lolos.
- ⚠️ **Perlu re-push:** backup lama di Drive dibuat tanpa password DB. Setelah rebuild, **Push ulang** dari perangkat yang punya password (auto-push saat ada perubahan / Push manual di Settings) agar backup Drive ter-refresh; baru **Pull** di perangkat lain. **Butuh rebuild backend** (bukan HMR).

### Pra-rilis 0.1.1-pre.2 ✅ (2026-08-03)
> Lanjutan pasca-`pre.1`, di-bump ke `0.1.1-pre.2` (4 file versi) + tag `v0.1.1-pre.2`. Isi (sejak `v0.1.1-pre.1`):

- ✅ **Pagination First/Last** (`<<`/`>>`) di komponen `Pager` (SQL & Browse) — detail di §19 "Pagination First/Last".
- ✅ **Create database — charset/collation** (MySQL `CHARACTER SET`/`COLLATE`; PG `ENCODING`) — detail di §19 "Create database — charset/collation".
- ✅ **Fix password DB ikut Google Drive sync** — lihat bagian di atas.

---

## 17. Rancangan: New Profile & Profile Editor (SSH) — ✅ SEBAGIAN BESAR TERBANGUN

> **Update status:** rancangan ini **sudah diimplementasikan** — `NewProfilePicker` (template SSH + duplicate)
> dan `ProfileEditor` SSH 7 tab (GENERAL/PORTS/ADVANCED/CIPHERS/COLORS/LOGIN SCRIPTS/INPUT) sudah jalan;
> CIPHERS/keep-alive/ready-timeout diterapkan ke russh, COLORS/INPUT/LOGIN SCRIPTS via `TermOptions` per-sesi
> (detail di §18 "Update Fase 5"). **Sisa ⬜:** PORTS Remote (-R), X11/agent forwarding, skip banner, reuse
> session (butuh kerja russh), + template Serial/Telnet editor. Bagian di bawah = spesifikasi rancangan asli (arsip).

### 17.1 Alur "New profile"
1. Settings → Profiles → **New ▾ → New profile**
2. Muncul **palette pemilih template** (gaya quick-launch): judul *"Select a base profile to use as a template"* — ✅ **SUDAH DIBANGUN**
   - **Template**: **SSH** ✅, **Serial** ✅, **Telnet** ✅ (semua aktif & bisa disimpan sebagai profil); Raw socket ⬜ disabled (butuh transport `raw_open` khusus)
   - **Duplicate an existing profile**: ✅ daftar profil user tampil & bisa diklon (subtitle per-tipe ssh/serial/telnet)
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

**Status:** ✅ **Terimplementasi** (editor SSH 7 tab + backend russh untuk CIPHERS/keep-alive/timeout; COLORS/INPUT/LOGIN SCRIPTS frontend). **Sisa ⬜:** Remote (-R) forwarding, X11/agent forwarding, skip banner, reuse session, dan editor profil Serial/Telnet.

---

## 19. Rancangan: Database Manager native (Fase 20) — 🎯 RILIS 0.1.0 · ✅ IMPLEMENTASI TUNTAS

> Direkam atas permintaan user (diskusi 2026-07-24). **Jangan mulai koding dulu** — dokumen ini
> adalah rencana bertahap yang harus tersusun rapi sebelum implementasi. Target rilis: **v0.1.0-pre.14**.

### 19.0 Tujuan & prinsip

Membangun **DB manager native** di dalam Moorix (bukan meng-embed phpMyAdmin), setara fungsi harian phpMyAdmin: browse data, jalankan SQL, edit/insert/delete baris, dan **export/import `.sql`**. Mendukung **MySQL/MariaDB** dan **PostgreSQL**, dengan engine dipilih per-profil (disarankan otomatis dari deteksi server, keputusan final manual).

Prinsip:
- **Native, menyatu dengan Moorix** — panel Database jadi **tipe tab baru** sejajar Terminal/SFTP dalam satu window (selaras positioning "semua dalam satu window"). Reuse tema, vault, dan Monaco.
- **Nol dependensi wajib di server** — cukup DB-nya jalan; tidak perlu phpMyAdmin/web server terpasang.
- **Koneksi selalu lewat SSH tunnel** dari sesi SSH yang sedang aktif (mekanisme `direct-tcpip`, sama dengan port forwarding -L yang sudah ada).
- **MySQL/MariaDB dituntaskan dulu** (Fase 20A–20C), **PostgreSQL menyusul** (Fase 20D) — tapi abstraksi driver dipasang **sejak awal** supaya Postgres nyusul tanpa merombak UI.

### 19.1 Keputusan (terkunci ✅ — hasil diskusi user 2026-07-24)

1. ✅ **Native DB manager**, bukan embed phpMyAdmin.
2. ✅ **Lengkap ala phpMyAdmin**: browse, SQL editor, edit/insert/delete, **export & import**.
3. ✅ **Engine**: MySQL/MariaDB **dan** PostgreSQL; pilihannya tergantung yang tersedia di server aktif.
4. ✅ **Export format utama `.sql`** (via `mysqldump`/`pg_dump` server-side); CSV per-tabel = sekunder.
5. ✅ **Profil DB** = **anak dari profil SSH**. Satu server bisa punya **banyak akun DB**. Profil DB menyimpan `username`/`password` (di **vault** terenkripsi) → bisa masuk lagi sewaktu-waktu, semudah SSH. Bagian SSH **auto** dari profil SSH induk (profil DB tidak menyimpan kredensial SSH apa pun).
6. ✅ **Tombol picker DB** (dropdown) ada di **layout SSH, dekat tombol SFTP**.
7. ✅ **Quick-connect sekali pakai** — **perlu** (bisa coba koneksi tanpa menyimpan profil).
8. ✅ **Auto-deteksi engine** — dipakai untuk **menyarankan** saat membuat profil DB baru (mis. "terdeteksi MySQL di :3306, Postgres di :5432"), tapi keputusan final tetap **manual** lewat profil.

### 19.2 Model data — profil DB sebagai anak profil SSH

```
SSHProfile
 ├─ (kredensial SSH → vault/keychain, tak berubah)
 └─ databases: DBProfile[]
      DBProfile {
        id
        sshProfileId          // referensi induk; tunnel & host SSH dari sini
        name                  // label, mis. "app-prod (root)"
        engine                // "mysql" | "mariadb" | "postgres"
        dbUser
        dbPassword            // → vault (secret_set/get, id = db profile id); TIDAK di store plaintext
        host = "127.0.0.1"    // dari sudut pandang server (via tunnel); jarang diubah
        port = 3306 | 5432
        defaultDatabase?      // opsional
      }
```

- Disimpan di `tauri-plugin-store` (metadata `dbProfiles`), password **hanya** di vault (pola sama dgn SSH — §18).
- **Konsistensi kredensial**: satu set `dbUser`/`dbPassword` dipakai untuk **(a)** koneksi driver Rust **dan** **(b)** `mysqldump`/`pg_dump` saat export/import. Tak ada input ganda.
- **Dikelola di dalam SSH profile editor** — tambah section **"Databases"** di editor profil SSH (§17), plus tombol "quick add" dari dropdown picker.

### 19.3 Arsitektur backend (Rust)

**Abstraksi driver (dipasang sejak awal):**
```rust
#[async_trait]
trait DatabaseDriver: Send {
    async fn list_databases(&self) -> Result<Vec<String>>;
    async fn list_schemas(&self, db: &str) -> Result<Vec<String>>;      // Postgres: schema; MySQL: = database
    async fn list_tables(&self, db: &str, schema: Option<&str>) -> Result<Vec<TableInfo>>;
    async fn columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>>; // + PK/nullable/type
    async fn indexes(&self, table: &TableRef) -> Result<Vec<IndexInfo>>;
    async fn foreign_keys(&self, table: &TableRef) -> Result<Vec<FkInfo>>;
    async fn run_sql(&self, sql: &str) -> Result<QueryResult>;           // SQL bebas (bisa multi-statement)
    async fn browse(&self, table: &TableRef, page: Page, sort: Option<Sort>, filter: Option<Filter>) -> Result<QueryResult>;
    async fn insert_row(&self, table: &TableRef, values: Row) -> Result<()>;
    async fn update_row(&self, table: &TableRef, pk: PkValues, values: Row) -> Result<()>;
    async fn delete_row(&self, table: &TableRef, pk: PkValues) -> Result<()>;
}
```
Implementasi: `MySqlDriver` (Fase 20A–C), `PgDriver` (Fase 20D). Perbedaan engine (hierarki schema, quoting `` ` `` vs `"`, query introspeksi) **dikurung di balik trait** ini.

**Crate driver:** `sqlx` (satu crate, MySQL + Postgres, mode query dinamis/runtime) **atau** `mysql_async` + `tokio-postgres` bila butuh kontrol tipe lebih detail. **Keputusan crate ditunda ke awal Fase 20A** (setelah spike tipe-mapping) — lihat §19.7.

**Koneksi via tunnel:** `russh` buka channel `direct-tcpip` ke `127.0.0.1:<port>` di server (reuse mekanisme port-forward -L). Driver diarahkan ke port lokal hasil forward. **Lifecycle koneksi DB + pool diikat ke sesi SSH**: sesi ditutup → tunnel + pool ditutup. (Perhatikan pola bug read-only editor di Fase 19-T3: bila panel dibuka-ulang, sesi SSH lebih panjang umurnya daripada channel — pakai `sessionId` sebagai anchor, bukan channel id.)

**Bentuk payload hasil query (`QueryResult`) — pekerjaan inti yang sering diremehkan:**
```
QueryResult {
  columns: [{ name, dbType, nullable, isPk }]
  rows: [[cell, ...]]        // cell = string | null (lihat aturan tipe)
  rowsAffected, meta
}
```
Aturan tipe (WAJIB, cegah bug halus):
- **`BIGINT`/`DECIMAL`/`NUMERIC` → kirim sebagai STRING** (number JS kehilangan presisi).
- **`BLOB`/`bytea`/biner → hex atau base64 + flag**, ditampilkan sebagai badge "(binary N bytes)" + tombol download; **tidak** di-render mentah.
- **`NULL`** dibedakan dari string kosong (kirim `null`, UI tampil badge `NULL`).
- `DATE/DATETIME/TIMESTAMP/JSON/ENUM` → string apa adanya dari server.

### 19.4 Introspeksi skema per-engine (ringkas)

| Kebutuhan | MySQL/MariaDB | PostgreSQL |
|---|---|---|
| Hierarki | `server → database → table` | `server → database → schema → table` (ada layer schema) |
| List DB | `SHOW DATABASES` | `SELECT datname FROM pg_database WHERE NOT datistemplate` (harus reconnect per-DB utk isinya) |
| List tabel | `information_schema.tables` / `SHOW TABLES` | `information_schema.tables` (filter `table_schema`) |
| Kolom + PK | `information_schema.columns` + `SHOW KEYS`/`key_column_usage` | `information_schema.columns` + `pg_index`/`key_column_usage` |
| Quoting identifier | `` `nama` `` | `"nama"` |

> **Postgres perlu koneksi ke 1 database dulu** untuk melihat isinya (beda dgn MySQL yang satu koneksi lihat semua). UI tree harus menangani layer schema ekstra ini.

**Edit/hapus baris butuh Primary Key:** introspeksi PK/unique **wajib jalan sebelum** fitur edit. Bila hasil query tak punya PK (mis. hasil JOIN), **edit inline di-disable** dan diarahkan ke SQL manual — persis peringatan phpMyAdmin. Semua UPDATE/DELETE **diparameterisasi** (bukan string concat) + identifier di-quote sesuai engine.

### 19.5 Export / Import `.sql` (server-side, keunggulan unik Moorix)

Karena Moorix **sudah SSH** ke server, **jangan reimplementasi logika dump di Rust**:
- **Export** → jalankan `mysqldump` / `pg_dump` **di server via exec SSH**, hasil `.sql` ditarik ke lokal via **SFTP** (yang sudah ada). Robust: struktur + data + trigger + FK order beres. Scope pilihan: seluruh DB / tabel terpilih / struktur-saja / data-saja.
- **Import** → kirim `.sql` ke server via SFTP lalu `mysql < file` / `psql -f file` via exec, atau (file kecil) eksekusi statement lewat driver.
- **CSV** per-tabel = opsi sekunder, langsung dari driver.

**⚠️ Detail keamanan kredensial (WAJIB):** jangan lempar password sebagai `-p<pass>` / di argv (terlihat di `ps aux` user lain). Pakai file sementara **`--defaults-extra-file`** (MySQL) atau **`.pgpass`/`PGPASSWORD` env** (Postgres), ditulis via SFTP dengan **permission 600**, lalu **dihapus** setelah selesai.

### 19.6 Frontend

- **Panel Database** = tipe tab baru (sejajar Terminal/SFTP). Di layout sesi SSH: **dropdown picker** dekat tombol SFTP → daftar profil DB milik server aktif + "＋ Tambah koneksi DB…" + "Quick connect (sekali pakai)". Pilih → buka tab Database.
- **Layout panel:** kiri = **tree** `database → (schema) → tabel/view`; kanan = tab kerja:
  - **Structure** — kolom, tipe, PK/index/FK.
  - **Browse** — data grid: pagination, sort kolom, filter, **inline edit / insert / delete** (aktif hanya bila PK terdeteksi).
  - **SQL** — **reuse Monaco** (sudah di app) dengan syntax highlight SQL → jalankan, hasil di grid. Win besar: editor sudah matang dari Fase 18–19.
  - **Insert** — form per kolom.
  - **Export / Import** — pilihan scope + progress (reuse pola transfer SFTP).
- **Grid besar** → virtualisasi + pagination server-side (jangan tarik sejuta baris ke webview).

### 19.7 Pentahapan (biar tetap bisa rilis; garap MySQL dulu tuntas)

| Sub-fase | Isi | Output |
|---|---|---|
| **20A — MVP (MySQL)** | Spike crate & tipe-mapping · profil DB (CRUD + vault) · dropdown picker dekat SFTP · quick-connect · tunnel + pool terikat sesi · tree DB→tabel · **SQL editor (Monaco) + result grid** · browse tabel + pagination | Bisa konek & jalankan SQL, lihat data — sudah berguna |
| **20B — Edit (MySQL)** | Introspeksi PK/index/FK · tab Structure · inline **edit/insert/delete** (parameterized, guard PK) | Setara fungsi harian phpMyAdmin |
| **20C — Export/Import (MySQL)** | `mysqldump`/import via SSH+SFTP (aman: `--defaults-extra-file`) · export CSV · progress | **Fitur pamungkas**, MySQL tuntas |
| **20D — PostgreSQL** | Isi `PgDriver` (layer schema, quoting `"`, `pg_dump`/`psql`) · auto-deteksi engine di server · paritas fitur 20A–C | Multi-engine penuh |

**Urutan disengaja:** tuntaskan **MySQL (20A–C)** sebelum Postgres — menggarap dua engine paralel di awal menggandakan permukaan bug (tipe, quoting, schema layer) saat UX belum matang. Abstraksi trait tetap dari awal supaya 20D nyusul mulus.

### 19.8 Tantangan & risiko (catat di awal)

| Tantangan | Solusi |
|---|---|
| Presisi angka JS (BIGINT/DECIMAL) | kirim sebagai **string** dari Rust |
| Tipe biner (BLOB/bytea) | hex/base64 + badge + download, bukan render mentah |
| Edit tanpa PK | deteksi PK dulu; disable inline-edit bila tak ada, arahkan ke SQL |
| Hasil besar | pagination + grid virtualized; jangan tarik semua |
| Password di `ps aux` saat dump | `--defaults-extra-file` (MySQL) / `.pgpass`/env (Postgres), perm 600, hapus |
| Postgres beda hierarki | layer schema di tree + reconnect per-database |
| Multi-statement SQL (DELIMITER, string berisi `;`) | andalkan multi-statement driver / eksekusi per-statement; jangan split naif pada `;` |
| Sesi SSH ditutup saat panel DB buka | anchor ke `sessionId` (bukan channel), tutup pool saat sesi mati; pola dari Fase 19-T3 |
| SQL injection di UPDATE/DELETE generated | parameterisasi + quote identifier per-engine |

### 19.9 Keputusan yang masih terbuka (sebelum mulai Fase 20A)

1. ✅ **Crate driver**: **`mysql_async`** (v0.37, `default-features = false, features=["minimal"]` → tanpa TLS/OpenSSL karena selalu lewat tunnel ke 127.0.0.1) untuk MySQL/MariaDB; **`tokio-postgres`** menyusul di 20D. Dipilih atas kontrol tipe langsung (Value enum) — keputusan user 2026-07-28.
2. ⬜ **Grid**: pakai lib data-grid (virtualized) apa, atau bangun ringan sendiri.
3. ⬜ **Scope export awal**: cukup "seluruh database" dulu, atau langsung dengan pilih-tabel + struktur/data-only.

**Status:** rancangan tercatat & disetujui (diskusi 2026-07-24). Crate driver = **mysql_async** (§19.9 poin 1, keputusan user 2026-07-28).

**Progress:**
- **20A-1 ✅ (uji native ✅ — user 2026-07-28, konek MySQL 8.4.10 lewat SSH)** — spike konektivitas end-to-end. Backend `src-tauri/src/db.rs`: `open_tunnel` (listener ephemeral `127.0.0.1:0` → `channel_open_direct_tcpip` ke `127.0.0.1:<db_port>`, reuse pola `forward.rs`), `db_test_connect` command (`SELECT VERSION()` + `SHOW DATABASES`, `prefer_socket(false)` agar tak lolos ke socket lokal). Frontend `DbConnectTest.tsx` (dialog quick-connect manual).
- **20A-2 ✅ (implementasi; uji native pending)** — profil DB sebagai anak profil SSH. `src/db.ts` (`DBProfile`, `dbConnect`, engine helper); `UserProfile.databases[]` (`profiles.ts`) — password ke **vault** by db-profile-id, di-strip dari store (`App.saveProfile`/`deleteProfile`). Editor tab **DATABASES** (CRUD: name/engine/host/port/user/password/defaultDb) di `ProfileEditor.tsx`. **Picker** `DbPicker.tsx` (tombol Database di toolbar pane → list profil DB + connect satu-klik pakai kredensial vault + Quick-connect one-off + "Manage connections…" buka editor tab DATABASES). Connect untuk sekarang = validasi + tampil versi/daftar DB (tab DB nyata di 20A-3). Postgres di-gate (nunggu 20D).
- **20A-3 ✅ (implementasi; uji native pending)** — tab Database + schema tree. Backend: **`DbSession`** persisten (pool `mysql_async` + tunnel) di `AppState.db_sessions`, **lifetime terikat SSH** (`AppState::close` men-drop DB session anak → tunnel abort, no orphan). Command `db_open` (validasi `SELECT 1` sebelum register), `db_list_databases` (`SHOW DATABASES`), `db_list_tables` (information_schema, name+type table/view), `db_close` (disconnect pool). Frontend: tipe **tab baru `db`** (`App.tsx`), `DatabasePanel.tsx` (tree `database → tabel/view`, lazy-load tabel saat expand, refresh). Picker **Connect** kini buka tab DB (bukan inline result). Right pane placeholder → SQL editor + browse di 20A-4.
- **20A-4 ✅ (implementasi; uji native pending)** — SQL editor + result grid + browse. Backend: `db_run_sql` (SQL bebas, `USE <db>` bila schema dipilih, cap `MAX_ROWS=2000` + flag `truncated`), `db_browse` (`SELECT * … LIMIT/OFFSET` + `COUNT(*)` total, identifier di-quote). `QueryResult{columns,rows,rowsAffected,truncated}` — **cell = `string|null`**; `value_to_cell` stringify semua (BIGINT/DECIMAL via text-protocol jadi string → presisi aman), NULL→null (badge), non-UTF8→"(binary, N bytes)". Frontend `DatabasePanel.tsx`: right pane **SQL** (Monaco `language=sql`, tombol Run + Ctrl+Enter, reuse setup `monaco.ts`) + **Browse** (grid paginated 100/hal, prev/next, total). `ResultGrid` (sticky header nama+tipe kolom, badge NULL, ∅ untuk string kosong, notice truncated). → **20A (MVP MySQL) lengkap: konek · SQL · browse.**
- **20A-4b ✅ (implementasi; uji native pending)** — penyempurnaan UX (req user 2026-07-29): klik tabel → SQL editor auto-terisi `SELECT * FROM \`table\`` + auto-run. **Pagination di SQL editor** (backend `db_run_sql` inject `LIMIT/OFFSET` + `COUNT(*)` untuk SELECT tunggal tanpa LIMIT → `SqlResult{result,total,paginated}`); **page size dipilih user** (25/50/100/500) via komponen `Pager` bersama (SQL + Browse). Cap 2000 hanya untuk query non-paginable.
- **Pagination First/Last ✅ (implementasi; uji native pending, 2026-08-03)** — req user: tombol **`<<`** (ChevronsLeft → `onPage(0)`) & **`>>`** (ChevronsRight → `onPage(pages-1)`) di komponen `Pager` (berlaku SQL & Browse). First aktif saat `page>0`; Last butuh total diketahui (`canLast = pages!=null && page+1<pages`) → nonaktif untuk hasil SQL yang `COUNT(*)`-nya gagal (total null).
- **Create database — charset/collation ✅ (implementasi; uji native pending, 2026-08-03)** — req user: pilih **utf8 dll** saat buat database. Backend `db_create_database` +param opsional `charset`/`collation` (divalidasi `[A-Za-z0-9_]`, anti-injeksi). **MySQL/MariaDB:** `CHARACTER SET {charset} COLLATE {collation}`. **PostgreSQL:** `charset`→`ENCODING '…'` (+`collation`→`LC_COLLATE/LC_CTYPE`), pakai `TEMPLATE template0` bila non-default. `CreateDatabaseDialog` dapat prop `isPg`: MySQL tampil 2 dropdown **Character set** (utf8mb4/utf8/latin1/ascii/binary) + **Collation** (difilter per-charset via `MYSQL_COLLATIONS`); PG tampil dropdown **Encoding** (UTF8/LATIN1/WIN1252/SQL_ASCII). Default "Server default" = klausa dihilangkan. **Butuh rebuild backend.**
- **20A-4c ✅ (implementasi; uji native pending)** — SQL autocomplete + label tipe ramah (req user 2026-07-29): (1) **Autocomplete Monaco** — provider `sqlCompletion.ts` (keyword + tabel + kolom); backend `db_schema` (information_schema.COLUMNS → tabel/kolom/tipe), di-fetch per activeDb (cached), di-set saat editor focus. Ketik `wh`→WHERE, `tgl`→tglinputmili. (2) **Label tipe ramah** — `friendly_type()` (protocol type + charset 63 + flags ENUM/SET/UNSIGNED) → varchar/int/bigint/text/datetime dst, dipakai di `ColumnInfo.dbType` grid.
- **20B-1 ✅ (uji native ✅)** — tab **Structure**: backend `db_table_structure` (information_schema: kolom+PK/nullable/default/extra/comment, indexes grouped, foreign keys). Frontend `StructureView` (tabel Columns dgn `#` + 🔑 PK + Type ellipsis+tooltip, Indexes dgn `#`, FKs). `primaryKey[]` menggerbang inline-edit.
- **20B-2 ✅ (implementasi; uji native pending)** — inline edit/insert/delete. Backend `db_update_row`/`db_delete_row`/`db_insert_row` — **parameterized** (`exec_drop` + `Vec<Value>`, identifier di-quote, `LIMIT 1`, guard PK non-empty untuk update/delete). Frontend: kolom aksi (Edit/Delete) di grid Browse + tombol **Insert row** (aktif hanya untuk tabel base dgn PK; tanpa PK → badge "edit/delete disabled"). `RowEditor` modal (field per kolom + checkbox NULL; edit kirim hanya kolom berubah non-PK, PK read-only; insert omit kolom kosong → default/auto_increment). Reload page setelah mutasi.
- **20B-2b ✅ (implementasi; uji native pending)** — hasil query di menu **SQL** juga editable (req user 2026-07-29). Ekstrak `EditableResult` (grid + row-actions + Insert + `RowEditor`) dipakai Browse **dan** SQL. `parseSingleTable()` deteksi SELECT satu-tabel (tanpa JOIN/koma/subquery) → fetch struktur → grid dapat Edit/Delete/Insert bila PK ada di hasil; JOIN/expression tetap read-only. Reload SQL = re-run query di page aktif. Browse view di-refactor pakai komponen sama.
- **20C-1 ✅ (implementasi; uji native pending)** — **Export `.sql`** via server-side `mysqldump`. `DbSession` kini simpan kredensial DB (user/pass/host/port). Backend `db_export_sql`: tulis `--defaults-extra-file` ke server via **exec `umask 077; cat > file` (password lewat stdin, tak pernah di argv/`ps`)**, jalankan `mysqldump --single-transaction --quick [--no-data|--no-create-info] db [tables]`, **stream stdout → file lokal** (mpsc, tak buffer di memori), lalu **hapus .cnf** (selalu). Simpan ke folder **Downloads** OS (`app.path().download_dir()`), return path. Helper `run_exec`/`exec_to_file`/`write_secure_remote`/`shq` (quote identifier shell). Frontend: tombol **Export** di toolbar → `ExportDialog` (scope whole-db/table · content all/structure/data) → tampil path tersimpan.
- **20C-2 ✅ (implementasi; uji native pending)** — **Import `.sql`** via server-side `mysql`. Backend `db_import_sql`: tulis `.cnf` mode-600 (cara sama), jalankan `mysql --defaults-extra-file=cnf <db>` dengan **script di-stream ke stdin** (`run_exec` kini kirim stdin ber-chunk 32KB, aman dari batas paket SSH), lalu hapus `.cnf`. Frontend: tombol **Import** → `ImportDialog` (`<input type=file>` baca teks di webview → kirim ke backend; warning script bisa DROP/overwrite; refresh tree setelah sukses). Export 20C-1 terverifikasi native (4034 baris cocok, 2026-07-29).
- **20C-3 ✅ (implementasi; uji native pending)** — DDL drop/rename (req user 2026-07-29). Backend: `db_drop_table`, `db_rename_table` (`RENAME TABLE`), `db_drop_database`, `db_rename_database` (MySQL tak punya RENAME DATABASE → CREATE DB baru + `RENAME TABLE` semua base table + DROP DB lama; views/routines tak ikut). Frontend: **menu klik-kanan** di node tree (database: Refresh/Rename/Drop · table: Rename/Drop) + `RenameDialog` + `window.confirm` untuk drop. Refresh tree otomatis setelah aksi.
- **20C-4 ✅ (implementasi; uji native pending)** — sinkron grid SQL saat DDL (bugfix user 2026-07-29): DatabasePanel kirim `schemaEvent{token,renamedTable?}` ke SqlView. Drop/drop-db/rename-db → re-run query terakhir (tabel hilang → error, bukan data basi). Rename tabel → `renameTableInSql()` tulis-ulang nama tabel di query (backtick / bareword after FROM) lalu re-run → tampil data tabel bernama baru.
- **20B-3 ✅ (implementasi; uji native pending)** — multi-delete via checkbox (req user 2026-07-29, ala phpMyAdmin). `EditableResult`: state `selected: Set<rowIndex>` (reset saat data berubah), toggle per-baris + select-all; tombol **Delete selected (N)** (loop `dbDeleteRow` parameterized). `ResultGrid` dapat kolom checkbox + header select-all (hanya saat grid editable / PK ada). Berlaku di SQL & Browse.
- **20D-1 ✅ (implementasi; uji native pending)** — PostgreSQL: connect + tree + SQL view. Backend: crate `tokio-postgres` (NoTls, via tunnel); `DbSession` kini pakai enum `DbBackend{Mysql(Pool)|Postgres(PgBackend)}` + field `engine`; `PgBackend` kelola client per-database (lazy, cached) lewat satu tunnel. `db_open` bercabang per-engine (param `engine` baru). `db_list_databases` (pg_database), `db_list_schemas` (baru, Postgres), `db_list_tables` (+ param `schema` untuk PG). `db_run_sql` cabang PG via `simple_query` (nilai teks) + pagination LIMIT/OFFSET + `pg_count`. Frontend: `engine` mengalir ke tab DB + `DatabasePanel`; tree PG **database → schema → tabel** (`PgSchemaNodes`), klik tabel → `SELECT * FROM "schema"."tabel"`. Surface MySQL-only (Browse/Structure/Export/Import/DDL menu) di-gate untuk PG (menyusul di 20D-2..4). Edit/insert/delete otomatis read-only untuk PG (introspeksi MySQL-only).
- **Host-key change UX ✅ (implementasi; uji native pending, 2026-07-30)** — dialog "Host key changed" dulu cuma punya Close (buntu bila server di-rebuild / IP dipakai ulang). Kini ada tombol **Trust new key** → command `ssh::trust_host_key(host, fingerprint)` simpan fingerprint baru ke known_hosts (setara `ssh-keygen -R` + accept). Command `ssh::forget_host_key` juga tersedia.

- **Create database & table ✅ (implementasi; uji native pending, 2026-07-30)** — untuk MySQL/MariaDB **dan** PostgreSQL. Backend `db_create_database` (quoting per-engine; PG via `batch_execute` di luar txn) & `db_create_table` (spec `NewColumn[]` → rakit DDL engine-aware: NOT NULL/DEFAULT/PK, AUTO_INCREMENT MySQL, serial untuk PG; schema untuk PG). Frontend: tombol **＋ New database** di header tree → `CreateDatabaseDialog`; menu klik-kanan **Create table…** (MySQL: db node · PG: schema node) → `CreateTableDialog` (nama tabel + baris kolom: name/type(datalist per engine)/NN/PK/AI/default, add/remove). Refresh tree otomatis setelah create.

- **20D-2 ✅ (implementasi; uji native pending, 2026-07-31)** — Browse + Structure + autocomplete untuk PostgreSQL. Backend: `db_browse` & `db_table_structure` dapat param `schema` (opsional; diabaikan MySQL) + cabang PG. `db_browse` PG: window `"schema"."tabel"` via `run_query_pg`, kolom di-enrich tipe ramah dari `information_schema` (helper `pg_column_types` + `pg_friendly_type`: `int4→integer`, `varchar(n)`, `numeric(p,s)`, `bool→boolean`, dll.), total via `pg_count_table`. `db_table_structure` PG: kolom (nullable/default/PK/extra `serial`|`identity`) dari `information_schema.columns`, PK/indeks/FK dari `pg_catalog` (indeks kolom via `= ANY(indkey)` + `array_position`, FK pasangan `conkey`/`confkey` per-ordinal). `db_schema` PG (autocomplete): semua tabel+kolom skema non-sistem. Frontend: tab **Browse/Structure** diaktifkan untuk PG; `schema` mengalir dari `selected` ke view & backend; klik tabel PG → **Browse** (grid read-only bertipe) — MySQL tetap ke SQL editable. `SqlView` skip target editable untuk PG (DML nyusul 20D-3). Header Browse/Structure tampil `db.schema.tabel`.
- **20D-3 ✅ (implementasi; uji native pending, 2026-07-31)** — edit/insert/delete + DDL PostgreSQL. Backend: `db_update_row`/`db_delete_row`/`db_insert_row` dapat param `schema` + cabang PG. Nilai **di-inline sebagai literal** (helper `pg_quote_literal` doubling `''`, aman dgn standard_conforming_strings; `pg_cell_literal`: NULL→`NULL`) lalu dieksekusi via `simple_query` (`pg_exec_count` baca CommandComplete) — literal unknown-type di-coerce server ke tipe kolom (setara model teks MySQL), menghindari batasan tokio-postgres yg tolak String utk kolom int. UPDATE/DELETE PG **tanpa LIMIT**. DDL: `db_drop_table`/`db_rename_table` (+param `schema`; PG `DROP TABLE "s"."t"` / `ALTER TABLE "s"."old" RENAME TO "new"`); `db_drop_database` (PG `DROP DATABASE` dari koneksi default) & `db_rename_database` (PG native `ALTER DATABASE … RENAME TO …`) — keduanya **evict client cache** dulu (`PgBackend::close_db`) krn PG tolak drop/rename database yg sedang tersambung. Frontend: `EditTarget` dapat `schema?`; Browse PG kini **editable** (Insert/Edit/Delete + multi-delete) — `schema` mengalir ke semua panggilan DML. Menu klik-kanan PG: node tabel → Rename/Drop table (bawa `schema`), node database → Rename/Drop database (+Refresh schemas). `RenameDialog` sembunyikan peringatan "MySQL no native rename" utk PG. Cleanup state PG (pgSchemas) saat drop/rename database. **Catatan:** grid SQL-editor PG tetap read-only (edit lewat Browse); SQL-editor-edit PG bisa menyusul.
- **20D-4 ✅ (implementasi; uji native pending, 2026-07-31)** — export/import PostgreSQL via `pg_dump`/`psql` (tuntas Fase 20). Backend: `db_export_sql` dapat param `schema` + cabang PG → `PGPASSFILE=<pgpass> pg_dump -h -p -U -d --no-owner --no-privileges [--schema-only|--data-only] [-t schema.tabel …]`, stdout di-stream ke Downloads (`exec_to_file`). `db_import_sql` cabang PG → `PGPASSFILE=<pgpass> psql -h -p -U -d -v ON_ERROR_STOP=1 -q` (skrip via stdin). Kredensial lewat file **.pgpass mode-600** (`*:*:*:user:password`, helper `pg_pgpass_escape` untuk `\`/`:`) yg ditulis `write_secure_remote` (umask 077) lalu dihapus — password tak pernah di argv. Path Downloads dihitung engine-independent. Frontend: tombol **Import/Export** kini tampil untuk PG; `dbExportSql` dapat `schema?`; `ExportDialog` terima `schema` (scope tabel PG → `-t schema.tabel`); `ImportDialog.onDone` refresh tree PG (`refreshPgSchemas` + re-fetch skema yg sedang terbuka).
- **Import PG auto-refresh tree ✅ (fix user 2026-07-31)** — setelah import PG sukses, tabel baru tak langsung muncul kalau schema target (`public`) ketutup/belum di-load. `ImportDialog.onDone` PG kini refresh **`public` (target default) + semua schema yg terbuka** (via `pgTablesRef` biar tak snapshot basi), jadi tabel baru langsung tampil & `public` auto-expand. (File `.sql` MySQL/backtick memang tak jalan di PG — psql tolak `` ` ``; error tampil benar. Disediakan demo PG-compat `moorix_demo_produk_pg.sql`.)
- **Edit Structure — kolom (Add/Edit/Drop) ✅ (implementasi; uji native pending, 2026-07-31)** — tab Structure kini bisa edit kolom, MySQL/MariaDB **dan** PostgreSQL (pilihan user: kolom saja dulu). Backend: helper `build_column_def` (dipakai bareng create-table) + `db_add_column`/`db_modify_column`/`db_drop_column` (semua +param `schema`; helper `ddl_qualified`). MySQL: `ALTER TABLE … ADD/DROP COLUMN`, modify via `CHANGE COLUMN old <def>` (rename+redefine sekaligus). PostgreSQL: `ADD/DROP COLUMN`; modify = batch atomik `RENAME COLUMN` (jika nama berubah) + `ALTER COLUMN TYPE … USING col::type` (cast nilai lama) + `SET/DROP NOT NULL` + `SET/DROP DEFAULT`. Frontend: `StructureView` dapat `isPg`+`onSchemaChange`, reload token, tombol **＋ Add column** + aksi **Edit/Drop** per baris kolom (Drop diblok bila kolom tinggal satu). Komponen `ColumnDialog` (name·type dropdown+Custom·NOT NULL·AUTO_INCREMENT MySQL-only·Default raw-expr; edit-mode prefill + auto-custom bila tipe di luar preset). Hanya base table (bukan view). **Catatan:** edit PK/urutan kolom/comment belum; indeks & FK editing menyusul bila diminta.
- **Add column — posisi (First/After) ✅ (2026-07-31)** — `db_add_column` +param `first`/`after`; MySQL/MariaDB `ADD COLUMN … FIRST|AFTER \`col\``. Dialog Add column: dropdown **Position** (At end / First / After &lt;kolom&gt;), hanya saat mode Add. **PostgreSQL** tak dukung posisi (kolom selalu di akhir) → selector disembunyikan + catatan.
- **Enum — guided di dialog kolom + Create TYPE PG ✅ (2026-07-31)** — di `ColumnDialog` (Add/Edit) pilih type **enum** → muncul editor nilai (Add/remove value). MySQL/MariaDB: bikin inline `enum('a','b',…)` (escape `'`/`\`). PostgreSQL: input **nama type** + nilai → jalankan `db_create_enum` (`CREATE TYPE schema.name AS ENUM (...)`, PG-only, nilai via `pg_quote_literal`) lalu kolom pakai nama type itu. Juga ada entry **Create enum type…** di menu klik-kanan schema (dialog `CreateEnumDialog` mandiri + preview SQL). Preset `enum('a','b')`/`set('a','b')` tetap ada di `MYSQL_TYPES` untuk CreateTableDialog (switch ke Custom); di ColumnDialog preset template di-filter, diganti opsi **enum** terpandu.
- **Fase 20 SELESAI (implementasi)** — Database Manager native multi-engine (MySQL/MariaDB + PostgreSQL): connect·SQL editor·browse·structure (+edit kolom·posisi·enum)·edit/insert/delete·create db/table/enum-type·drop/rename·export/import `.sql`. Sisa: uji native menyeluruh oleh user + polish opsional (SQL-editor-edit PG · indeks/FK editing).

---

## 20. Rancangan: Auto-Backup DB (Fase 23) — ⬜ RANCANGAN (diskusi user 2026-08-05)

### 20.0 Tujuan
Menu **Settings → "Backup DB"**: user setup auto-backup database yang **jalan otomatis saat komputer/aplikasi menyala**. Reuse mesin dump yang sudah ada (`mysqldump`/`pg_dump` server-side lewat SSH — lihat §19.5 & `db_export_sql` di `db.rs`). **Default fitur OFF.**

### 20.1 Keputusan terkunci ✅ (hasil diskusi user 2026-08-05)

1. **List setup (banyak profil), bukan satu.** Tiap setup = satu "backup job". Bisa tambah/hapus/reorder.
2. **Field per setup:**
   - **Backup name** (pembeda + jadi kunci penanda run). Contoh: `prod-harian`.
   - **Folder save** (folder tujuan konfigurable). Contoh: `C:/backups`.
   - **SSH profile** — pilih dari profil yang **databasenya sudah di-setup** (punya `databases[]`).
   - **UserDB** — profil DB (anak SSH) yang dipakai kredensialnya.
   - **Database** — pilih **satu, beberapa, atau semua**. Contoh: `dbsave,dbsave-1,dbsave-2`.
   - **Folder format** (base name). Contoh: `dbbackup`.
   - **Jeda (menit)** sebelum job dijalankan relatif ke job sebelumnya. Default **5**.
   - **Retensi (hari)** — simpan N hari terakhir, sisanya folder lama auto-hapus. Default **2**; kosong/0 = jangan hapus (lihat §20.6).
3. **Struktur output** — satu **folder bertanggal** per job, isinya **satu `.sql` per database**:
   ```
   C:/backups/dbbackup-05August2026/dbsave.sql
   C:/backups/dbbackup-05August2026/dbsave-1.sql
   C:/backups/dbbackup-05August2026/dbsave-2.sql
   ```
   - Suffix folder auto = `-ddMonthNameyyyy`, **nama bulan bahasa Inggris** (`August`, bukan `Agustus`) → `dbbackup-05August2026`.
   - **Jika folder tanggal sudah ada** (backup ke-2 di hari sama): **timpa** file (`.sql` = snapshot terakhir hari itu). *(Alternatif tambah jam ke nama folder = ditolak; pilih timpa.)*
4. **Eksekusi berurutan (sequential), bukan paralel.** Job dijalankan sesuai urutan list; **urutan bisa diubah** (reorder). Jeda antar-job = field jeda job (default 5 menit setelah job sebelumnya **selesai**).
5. **Item pertama** saat app start: **jeda awal 1–2 menit** dulu (biar app & koneksi settle) + **popup kanan-bawah**: "Autobackup akan dimulai…". Baru mulai job pertama.
6. **Trigger "saat komputer menyala"** = Model A: backup jalan **saat aplikasi Moorix start**, dan Moorix didaftarkan **autostart OS**. (Model B — OS Task Scheduler headless — ditolak untuk v1: butuh mode CLI + akses kredensial di luar app.)
7. **Penanda "sudah jalan"** — per **backup name** simpan **tanggal terakhir jalan**. Saat start: jika sudah jalan **hari ini** → skip; jika belum → jalankan lalu update penanda. Efek: **maks 1× per hari per job** (selaras folder bertanggal). App dibuka-tutup berkali-kali dalam sehari → tetap sekali.
8. **Penyimpanan** — pakai **Tauri plugin-store (`moorix.json`)**, bukan `localStorage`. Config list & penanda run dua-duanya di store (`store.ts`).
9. **Auto-cleanup penanda** — penanda yang **lebih tua dari 7 hari** (tanggal terakhir jalan > 7 hari lalu) → **dihapus** saat start, biar store tak membludak (terutama penanda job yang sudah dihapus). Rename backup name → penanda lama jadi orphan, kehapus sendiri oleh aturan 7 hari + job jalan sekali lagi hari itu (**acceptable**).
10. **Popup progress** kanan-bawah saat proses backup berjalan (reuse komponen `Toast`).
11. **Retensi / rotasi backup (auto-hapus folder lama)** — lihat §20.6. Default **2 hari**, hapus **permanen** (bypass Recycle Bin), dijalankan **setelah** backup hari ini sukses.
14. **Autostart + tray + notifikasi OS** (keputusan user 2026-08-06) — **Toggle "Jalankan saat startup"** di **Application** (default **OFF**, via `tauri-plugin-autostart`). Saat komputer nyala → Moorix jalan sendiri → runner 23C jalan. **Minimize ke system tray** (bukan taskbar) — tray hanya "aktif" bila **auto-backup ATAU autostart aktif**; kalau dua-duanya off, Moorix berperilaku window biasa (close = quit). Saat di-autostart, Moorix **start tersembunyi ke tray**. **Notifikasi OS native** (`tauri-plugin-notification`) untuk progress/hasil backup → muncul di **kanan-bawah dekat tray**, kelihatan walau window tersembunyi.
13. **Exclude schema sistem** — `information_schema`, `performance_schema`, `mysql`, `sys` (MySQL/MariaDB) + `template0`/`template1` (PostgreSQL) **tidak ditampilkan** di checklist database, dan **tidak diikutkan** saat "Semua database" dicentang. Daftar `SYSTEM_DATABASES` di `backupDb.ts` dipakai bersama frontend (filter tampilan) & backend 23B (filter "all"). *(PG `postgres` default DB dibiarkan tampil karena bisa berisi data nyata.)*
12. **Tombol "Run backup" (jalankan manual)** — tiap job punya tombol untuk menjalankan backup **sekarang** dengan **mekanisme sama persis** seperti auto (headless connect → dump per DB → folder bertanggal → retensi + popup progress), hanya trigger-nya klik. **Force-run**: jalan tanpa peduli penanda "sudah jalan hari ini", dan **tetap** update penanda ke hari ini (dianggap sudah backup hari ini). Ini juga membuat backend **23B** bisa diuji langsung tanpa menunggu runner startup (23C). *(Sub-keputusan kecil: apakah manual-run ikut memicu retensi/auto-hapus folder lama — usul: **ya**, biar identik dengan auto.)*

### 20.2 Kredensial / vault (§ lihat `secrets.ts`, `vault.ts`)
Dua mode, keduanya **wajib didukung**:
- **Mode A — OS keychain** (vault master-password TIDAK aktif): password DB & SSH ditarik otomatis dari Windows Credential Manager → **autobackup 100% silent**. **User `hajih` saat ini Mode A** (dicek 2026-08-05: `moorix.json` tak punya key `vault`).
- **Mode B — Vault master-password**: saat start vault terkunci → **tak bisa baca kredensial tanpa unlock**. Jika ada job due & vault Mode B: tampilkan **popup + tombol unlock** (reuse `VaultUnlockModal`) di jendela jeda awal itu. Unlock → jalan normal. Diabaikan/cancel → **skip sesi ini, penanda TIDAK ditulis** → retry di startup berikutnya. **Master password TIDAK pernah disimpan.**
- Vault **tidak punya auto-lock idle** (dicek: tak ada timer lock) → **unlock sekali di awal aman** untuk seluruh sequence 5-menit-antar-job.

### 20.3 Backend (Rust)
- **Command baru khusus backup** (mis. `db_backup_run`), **JANGAN utak-atik `db_export_sql`** — export manual di panel Database **tetap** ke folder Downloads OS (perilaku lama, zero regresi).
- Command backup terima: `dest_dir`, `folder_base` (→ hitung suffix `-ddMonthNameyyyy`), daftar `database[]`, kredensial job. Loop DB → buat subfolder bertanggal → satu `.sql` per DB (timpa bila ada). Reuse jalur `mysqldump --single-transaction --quick` / `pg_dump --no-owner --no-privileges`, kredensial via `--defaults-extra-file` / `.pgpass` mode-600 (pola §19.5), stream stdout → file (`exec_to_file`).
- **Orkestrasi headless**: buka SSH → `db_open` → dump per DB → tutup. Perlu flow "connect terprogram" yang belum ada (sekarang `db_export_sql` mengandalkan `db_session`/`ssh_handle` yang sudah aktif dari UI).
- Nama bulan Inggris: format tanggal manual (hindari locale OS) — array 12 nama bulan Inggris.

### 20.4 Frontend
- **Section baru** `backupdb` di `SettingsPage.tsx` sidebar + tipe `SectionId`. Default fitur **OFF** (master toggle).
- **Editor list job**: tambah/hapus/reorder (drag), tiap job form field §20.1.2, tiap kartu bisa **collapse** (sisakan header/nama biar reorder simpel). Dropdown SSH difilter ke profil yang punya `databases[]`; dropdown DB multi-select (checklist + search + Pilih semua, auto-connect) atau opsi "Semua".
- **Tombol "Run backup" (manual)** per kartu job (§20.1 poin 12): klik → panggil `db_backup_run` job itu (force, abaikan penanda) → popup progress → update penanda. Reuse fungsi runner yang sama dengan auto; jadi penguji utama backend 23B.
- **Runner** dijalankan sekali saat app siap (mis. di `App.tsx`/`main.tsx`): baca list → filter job enabled & belum jalan hari ini → jeda awal 1–2 mnt + popup → loop sequential dgn jeda → update penanda → cleanup penanda >7 hari.
- **Autostart OS**: butuh `tauri-plugin-autostart` (**belum ada** di `Cargo.toml`) + toggle "Jalankan Moorix saat startup".
- **Notifikasi**: v1 pakai **toast in-app** (`Toast` sudah ada) — progress hanya kelihatan saat app kebuka. Notifikasi OS native (`tauri-plugin-notification`, **belum ada**) = opsional menyusul.

### 20.5 Yang perlu ditambah (dependency)
- `tauri-plugin-autostart` (untuk "saat komputer menyala" Model A).
- (opsional) `tauri-plugin-notification` (popup OS native, bukan sekadar toast in-app).

### 20.6 Retensi / rotasi backup — auto-hapus folder lama ✅ (keputusan user 2026-08-05)
Sebelum disk penuh, job auto-hapus folder backup lama miliknya sendiri.

- **Aturan:** simpan **N hari terakhir** (field per job, **default 2**). Contoh N=2, hari ini 9 Juli → hapus folder dgn tanggal **`< 7 Juli`** (`backupdb-05July2026`, `backupdb-06July2026` kehapus; `07`/`08`/`09` tetap → efektif simpan 3 folder). **Kosong/0 = jangan hapus apa-apa** (opt-out aman).
- **Waktu jalan:** **SETELAH backup hari ini sukses**, bukan sebelum. Alasan: kalau hapus dulu lalu dump gagal, backup lama keburu hilang padahal pengganti gagal dibuat. Hapus setelah sukses → coverage tak pernah berkurang tanpa pengganti.
- **Hapus permanen** (`std::fs::remove_dir_all`, **bypass Recycle Bin**) — memang tujuannya kontrol penyimpanan.
- **Pengaman cakupan (WAJIB, karena irreversible):** hanya hapus folder yang **(a)** anak langsung dari `folder save` job itu, **(b)** namanya cocok pola **pasti** `"<folderBase>-<tanggal>"` job itu (base sama persis), **dan (c)** suffix tanggal **berhasil di-parse** jadi `Date` valid. Folder yang tak cocok pola → **di-skip, tidak dihapus** (mis. `foto-liburan`, `backupdb-catatan`). Tidak rekursif ke parent.
- **Perbandingan sebagai tanggal asli, bukan string** — `05July2026` vs `06June2026` salah kalau di-sort string; parse ke `Date` (nama bulan Inggris) dulu, baru bandingkan `< (hari_ini − N hari)`.
- Retensi ini **per job** (base name + `folder save`-nya sendiri), independen antar job.

### 20.7 Pentahapan usulan
| Sub-fase | Isi |
|---|---|
| **23A — Setting + persist** | Section "Backup DB" (master toggle OFF) · CRUD+reorder list job di store · form field lengkap · dropdown SSH/DB terfilter |
| **23B — Backend backup + Run manual** | Command `db_backup_run` (folder bertanggal · 1 `.sql`/DB · timpa) · orkestrasi headless connect · reuse dump MySQL+PG · **tombol "Run backup" per job (force-run + popup progress)** → backend langsung teruji tanpa runner startup |
| **23C — Runner + penanda** | Trigger saat app start · jeda awal + popup kanan-bawah · sequential + jeda antar-job · penanda per-hari di store · cleanup >7 hari · Mode B prompt-unlock/skip-retry · **retensi/auto-hapus folder lama setelah sukses (§20.6)** |
| **23D-1 — Autostart + notifikasi OS** | `tauri-plugin-autostart` + toggle "Jalankan saat startup" (Application, default off) · `tauri-plugin-notification` untuk popup progress/hasil dekat tray |
| **23D-2 — System tray** | Tray icon + menu (Show/Quit) · minimize/close → hide-to-tray (kondisional: hanya bila autobackup/autostart aktif) · start hidden saat `--autostart` |
| **23E — Banner progres desktop** | Window banner always-on-top di pojok kanan-bawah (di atas taskbar) yang tampil selama backup berjalan · kelihatan walau window utama hidden-to-tray |

**Status:** rancangan disetujui (diskusi 2026-08-05). Implementasi bertahap dimulai 2026-08-06.

**Progress:**
- **23E — Banner progres desktop ✅ (implementasi; uji native pending, 2026-08-08)** — req user: mau indikator visual **selama** backup berjalan (bukan cuma notif OS saat selesai), tampil di **pojok kanan-bawah di atas taskbar**, kelihatan walau window utama disembunyikan ke tray. **Solusi: window kedua khusus** (label `backup-banner`) di `tauri.conf.json` — frameless, `transparent`, `alwaysOnTop`, `skipTaskbar`, `shadow:false`, `focus:false`, `visible:false` (start hidden), 360×88. Capability baru `capabilities/backup-banner.json` (scope window `backup-banner`: `core:default` + `core:window:allow-set-position`/`allow-set-always-on-top`). **Rust `lib.rs`**: `set_backup_activity` (yg sudah update tooltip tray) kini juga `emit_to("backup-banner","backup-activity",{active,label})` lalu `win.show()`+`set_always_on_top(true)` saat active / `win.hide()` saat idle (struct `BackupActivity`). **Frontend**: `main.tsx` dipecah — cek `getCurrentWebviewWindow().label`, dynamic-import `bootMain` (app penuh) atau `bootBanner` (banner ringan) supaya banner **tak** menarik Monaco/xterm/App. Komponen `components/BackupBanner.tsx`: listen event `backup-activity` (update label), posisikan diri ke kanan-bawah **work area** (`screen.avail*` → exclude taskbar) via `setPosition(LogicalPosition)`, kartu reuse gaya Toast (spinner `Loader2` + judul "Auto-backup running…" + bar indeterminate `moorix-toast-indeterminate`). Karena dipicu `beginBackupActivity`/`endBackupActivity`, banner muncul untuk backup **manual maupun auto**. Default tema dark (banner tak load SettingsProvider). Build FE + `cargo check` lolos.
- **Single-instance guard ✅ (bugfix; uji native pending, 2026-08-08)** — user melaporkan **2 tray icon** padahal cuma 1 app. Sebab: tak ada guard instance-tunggal → autostart (`--autostart`, hidden-to-tray) menaruh 1 instance di tray saat login, lalu buka Moorix manual = **proses kedua** = tray icon kedua (job backup tetap 1 tray krn `build_tray` sekali per instance + job jalan sequential). **Fix**: tambah **`tauri-plugin-single-instance`** (Cargo, desktop-only) + registrasi sbg **plugin pertama** di `lib.rs` builder (syarat Tauri); callback → `show_main_window(app)` (show+unminimize+focus window `main`) sehingga peluncuran kedua cuma memunculkan window instance pertama, tanpa proses/tray baru. Tak ada command frontend → tak perlu capability.
- **23A ✅ (implementasi; uji native pending, 2026-08-06)** — Setting + persist. Modul baru `src/backupDb.ts` (`BackupJob`/`BackupConfig`, `loadBackupConfig`/`saveBackupConfig` via plugin-store key `dbBackup`, `createBackupJob`, `datedFolderName` = `<base>-ddMonthNameyyyy` bulan Inggris). Section baru **Backup DB** di `SettingsPage.tsx` (SectionId + SIDEBAR ikon `DatabaseBackup`, di bawah Profiles): master toggle **OFF default** + list job (Tambah/Hapus/Reorder ↑↓) via `BackupJobCard`. Field per job: backup name · enable · **SSH profile** (dropdown difilter ke profil ssh yg punya `databases[]`) · **User DB** (dropdown `DBProfile` anak profil terpilih) · Semua database (toggle) · Database (list koma) · Folder tujuan · Nama folder (+preview `datedFolderName`) · Jeda menit (default 5) · Retensi hari (default 2). Semua persist ke store tiap perubahan. **Belum ada eksekusi** (runner + command backend = 23B/23C).
- **Backup config = per-device (tidak ikut Google Drive sync) ✅ (req user 2026-08-06)** — `sync.rs`: const `LOCAL_ONLY_KEYS = ["googleAccount", "dbBackup", "dbBackupRuns"]`. `get_sync_payload` loop strip semua key ini dari store_json sebelum diekspor; `apply_sync_payload` skip key ini saat import (belt-and-suspenders). Efek: setup auto-backup (`dbBackup`) + penanda run (`dbBackupRuns`) **tidak** terunggah ke Drive & tidak menimpa saat pull → login akun sama di komputer lain **tidak** ikut auto-backup. Berlaku untuk semua jalur sync (Push/Pull manual, auto-sync, seed, pull-on-login) karena semua lewat `export_sync_data`/`import_sync_data`.
- **23D-2 (lengkap) — hide-to-tray + start-hidden ✅ (implementasi; uji native pending, 2026-08-06)** — **Rust**: `AppState.tray_mode: AtomicBool` (+`set_tray_mode`/`tray_mode`). Command `set_tray_mode(enabled)` & `window_minimize` (hide bila tray_mode, else minimize biasa). `.on_window_event` intercept **`CloseRequested`** → bila `tray_mode` aktif: `prevent_close` + `window.hide()` (app tetap hidup di tray, auto-backup jalan terus). `.setup`: window `"visible": false` di `tauri.conf` → **start hidden**; ditampilkan (`window.show()`) kecuali dijalankan dgn arg **`--autostart`** (login item) → saat komputer nyala Moorix diam di tray tanpa window nongol. **Frontend**: `syncTrayMode()` di `backupDb.ts` (hitung `backupConfig.enabled || autostartEnabled` → `set_tray_mode`), dipanggil saat boot `App.tsx` + saat toggle **Enable auto-backup** & **Run at startup** berubah. Tombol **minimize** title bar → `invoke("window_minimize")` (hide-to-tray saat tray_mode). **→ Fase 23 selesai (implementasi):** setup UI · backend dump · runner startup + penanda · autostart + notifikasi OS · system tray (indikator + hide-to-tray + start-hidden). Sisa: uji native menyeluruh oleh user.
- **UI English-only ✅ (req user 2026-08-06)** — semua teks UI diubah ke Inggris (user: "jangan ada bahasa indonesia"). Bukan hanya fitur Backup DB (section, toggle autostart, toast/notifikasi, tray menu "Open Moorix/Quit" + tooltip "Moorix — Backup running", error backend `db_backup_run`), tapi juga string Indonesia lama yang masih tersisa: **Config sync** section (`ConfigSyncSection` prompt/label/status Push/Pull/Auto-sync), `Placeholder` ("This section is being designed."), Google login prompts (`SettingsPage` pull-on-login confirm + master password), `cloudSync.ts` ("Not signed in to Google."), `main.tsx` auto-pull prompt, `Welcome.tsx` login alert. Komentar kode (mis. `backupDb.ts`) sengaja dibiarkan (bukan UI). `ini` di `monaco.ts`/`SftpPanel.tsx` = identifier format INI, bukan bhs Indonesia.
- **23D-2 (mulai) — System tray + indikator backup di tray ✅ (req user 2026-08-06)** — user mau indikator di **system tray Windows** (dekat jam), bukan title bar (indikator title-bar dibatalkan/di-revert). **Rust `lib.rs`**: `build_tray()` (di `.setup()`, desktop-only) — tray icon id `main` pakai `default_window_icon`, tooltip "Moorix", menu **Buka Moorix / Keluar** (`on_menu_event`), **klik kiri → tampilkan window** (`on_tray_icon_event`, `show_main_window` = show+unminimize+focus). Command `set_backup_activity(active,label)` → update **tooltip tray** jadi "Moorix — Backup sedang berjalan: <nama>" saat jalan, balik "Moorix" saat idle. Cargo tauri feature `tray-icon`+`image-png` (dari 23D-1). **Frontend**: `backupDb.ts` `beginBackupActivity`/`endBackupActivity` (membungkus `runBackupJob`) kini panggil `invoke("set_backup_activity")` → tooltip tray sinkron untuk semua backup (manual/auto). **Sisa 23D-2**: minimize/close → hide-to-tray (kondisional autobackup/autostart) + start-hidden saat `--autostart`.
- **23D-1 ✅ (implementasi; uji native pending, 2026-08-06)** — Autostart + notifikasi OS. Plugin baru: **`tauri-plugin-autostart`** (desktop-only, `MacosLauncher::LaunchAgent`, arg `--autostart` untuk start-hidden 23D-2) + **`tauri-plugin-notification`** (base) — di `lib.rs`; tauri feature **`tray-icon`+`image-png`** ditambah (siap 23D-2); capability `notification:default` + `autostart:allow-enable/disable/is-enabled`; npm `@tauri-apps/plugin-autostart` & `plugin-notification`. **Frontend**: toggle **"Jalankan saat startup"** di `ApplicationSection` (baca `isEnabled`, `enable`/`disable`, default off). Helper **`notifyOS(title,body)`** di `backupDb.ts` (izin sekali, `sendNotification`); dipanggil di `runAutoBackups` (mulai + tiap hasil job sukses/gagal) → popup OS kanan-bawah dekat tray, kelihatan walau window tersembunyi. **Belum**: system tray + start-hidden (23D-2).
- **23C ✅ (implementasi; uji native pending, 2026-08-06)** — Runner startup + penanda per-hari. `backupDb.ts`: **penanda run** di store key `dbBackupRuns` = `{backupName → "YYYY-MM-DD"}` (`loadRunMarkers`/`saveRunMarkers`/`markJobRanToday`/`todayKey`), `pruneMarkers(m,7)` buang penanda >7 hari. **`runAutoBackups(userProfiles, toast)`** (guard `autoBackupStarted` — aman dari StrictMode double-mount): selalu prune penanda >7 hari; bila `cfg.enabled` → pilih job **due** (enabled · nama non-kosong · `markers[name]≠today` · ssh/userDB/folder/database lengkap) → **jeda awal 90 dtk** + popup "Autobackup akan dimulai (N job)" → loop **sequential** (job ke-2+ tunggu `delayMinutes`) dgn popup progress; **tulis penanda hanya bila full-success** (gagal → tak ditandai → retry launch berikutnya). Dipanggil sekali di boot `App.tsx` (fire-and-forget, pakai `profiles` yg baru di-load). **Mode B vault**: baca kredensial pertama memicu `VaultUnlockModal` yg sudah terpasang (`setVaultUnlockHandler`); batal → job gagal → tak ditandai → retry. **Tombol Run manual (23B)** kini juga `markJobRanToday` saat sukses (manual-run dihitung "sudah hari ini"). **Belum**: autostart OS (23D) + notifikasi OS native (opsional).
- **23B ✅ (implementasi; uji native pending, 2026-08-06)** — Backend backup + tombol Run manual. **Rust** (`db.rs`): command `db_backup_run(db_session_id, databases[], dest_dir, folder_base, retention_days)` → buat folder `<dest>/<base>-ddMonthNameyyyy` (`dated_folder_name`, bulan Inggris via `chrono`, timpa), dump tiap DB **full** ke `<db>.sql` lewat helper `dump_full_database` (reuse `mysqldump --single-transaction --quick` / `pg_dump --no-owner --no-privileges`, kredensial via `--defaults-extra-file`/`.pgpass` mode-600, stream `exec_to_file`), lalu **retensi**: hanya bila **semua** dump sukses & `retention_days>0` → `prune_old_folders` hapus permanen (`remove_dir_all`) folder yg namanya cocok `<base>-<tanggal>` & tanggalnya `< today-N` (guard: hanya anak langsung, hanya yg `parse_dated_folder` valid). Return `BackupRunResult{folder, files[{database,path,ok,error,bytes}], pruned[]}`. Registrasi di `lib.rs`; **`db_export_sql` tidak diubah** (export manual tetap ke Downloads). Dep `chrono` (clock) dipromosikan ke direct. **Frontend**: `runBackupJob(job, ssh)` di `backupDb.ts` (headless connect → resolve db list, `allDatabases`→`dbListDatabases`∖system → `db_backup_run`); tombol **Run** (hijau, ikon Play) di header tiap `BackupJobCard` (tampil walau collapse) → **force-run** dgn **popup progress** (`Toast` indeterminate → sukses/gagal + path folder + jumlah folder terhapus). Validasi pra-run (SSH/User DB/folder/database). **Belum**: runner startup + penanda (23C), update penanda saat manual-run (nyusul 23C).
- **23A-3 ✅ (implementasi; uji native pending, 2026-08-06)** — (req user): (1) **Collapse kartu job** — tiap `BackupJobCard` punya toggle chevron; collapse menyisakan header (nama job) supaya drag-reorder simpel/pendek. (2) **Dropdown DB viewport-aware** — panel `MultiDbSelect` dibatasi tinggi sesuai ruang layar + **auto flip ke atas** bila tombol di bawah; list `flex-1 min-h-0 overflow-y-auto overscroll-contain` (scroll di dalam dropdown, bukan halaman). (3) **Exclude schema sistem** (§20.1 poin 13) — helper `SYSTEM_DATABASES`/`userDatabases` di `backupDb.ts`; `MultiDbSelect` sembunyikan `information_schema`/`performance_schema`/`mysql`/`sys`/`template0`/`template1` dari checklist & dari "Pilih semua".
- **23A-2 ✅ (implementasi; uji native pending, 2026-08-06)** — penyempurnaan UX (req user): (1) **Folder picker native** — tombol folder buka `open({directory:true})` via **`tauri-plugin-dialog`** (baru: Cargo dep + `lib.rs` `.plugin(tauri_plugin_dialog::init())` + capability `dialog:default` + npm `@tauri-apps/plugin-dialog`). (2) **Database checklist auto-connect** — pilih SSH + User DB → komponen `MultiDbSelect` auto-fetch daftar database asli (checklist multi-pilih + search + Pilih semua/Kosongkan + refresh). Helper baru `fetchDatabaseList(ssh, db)` di `backupDb.ts`: buka SSH throwaway via `sshOpenFromProfile` (Channel dummy) → `dbOpen` → `dbListDatabases` → tutup (`dbClose` + `session_close`) — **ini juga jalur "headless connect" yang dipakai runner 23B/C**. Ganti input koma → dropdown. (3) **Drag-and-drop reorder** kartu job (HTML5 DnD, handle `GripVertical`, highlight drop target); panah ↑↓ tetap ada.

---

## 24. Notes (catatan mirip sticky-note) — **rancangan disetujui 2026-08-07**

Fitur catatan personal di dalam Moorix. Menu **Notes** di sidebar Settings menampilkan daftar note; tombol **Add** membuat note baru. Tiap note punya **judul** (wajib — jadi nama di list) dan **isi** dengan dua mode. Karena Moorix tool database, sasaran utama isi = snippet SQL/JSON/config/error log, jadi mode teks pakai **Monaco** (bukan textarea polos).

### 24.1 Keputusan (diskusi user 2026-08-07)
- **Offline-first**: note disimpan di store `moorix.json` key **`notes`** via `@tauri-apps/plugin-store` → persist lokal instan, **jalan tanpa login/koneksi**.
- **Sync terenkripsi**: numpang pipeline Google Drive yang sudah ada (`export_sync_data`/`import_sync_data`, blob `moorix-sync.bin`). **Tidak** bikin server sync sendiri (folder `sync-server/` = sisa dev lama, tidak dipakai). Enkripsi otomatis ikut pipeline.
- **Merge per-note (aktif di v1)**, bukan LWW blob — supaya janji "**tidak ada note hilang**" saat 2 komputer benar terjadi: gabung union by `id`, menang `updatedAt` terbaru, tombstone (`deletedAt`) menang. (Diskusi: LWW murni ditolak karena menimpa; tafsiran merge = **per-note**, bukan per-field/CRDT.)
- **Soft-delete** (tombstone `deletedAt`) wajib walau merge cuma per-note — kalau hard-delete, note "hidup lagi" dari device lain saat merge.
- **Auto-save** (debounce), **tanpa tombol Save**. Mode teks pakai **Monaco** + dropdown pilih bahasa. Add = **inline draft** (bukan modal).

### 24.2 Model data (`src/notes.ts`)
```ts
type NoteColumn = { id: string; name: string };
type Note = {
  id: string;                     // uuid — kunci identitas lintas device (untuk merge)
  title: string;                  // WAJIB — nama di list
  mode: "text" | "table";
  body: string;                   // dipakai saat mode "text"
  language?: string;              // Monaco language, default "plaintext"
  columns: NoteColumn[];          // dipakai saat mode "table"
  rows: Record<string, string>[]; // tiap row: { [columnId]: nilai }
  pinned?: boolean;
  order: number;                  // sort manual
  createdAt: number;
  updatedAt: number;              // penentu pemenang merge + tampilan "terakhir diubah"
  deletedAt?: number;             // tombstone (soft delete)
};
```
- `body` **dan** `columns/rows` disimpan bareng → ganti mode tidak menghapus data mode lain (toggle mode = ubah cara tampil saja).
- `rows` pakai `Record<columnId, value>` (bukan array posisi) → hapus/tambah kolom di tengah **tidak** menggeser data kolom lain.

### 24.3 Sync & merge (temuan kode)
- **Notes otomatis ikut sync tanpa ubah Rust.** `get_sync_payload` pakai **blacklist** `LOCAL_ONLY_KEYS` (`sync.rs:30` = `googleAccount`/`dbBackup`/`dbBackupRuns`) — key lain (termasuk `notes`) ikut diekspor & terenkripsi.
- **Import mengganti key `notes` bulat-bulat.** `apply_sync_payload` (`sync.rs:114`) `store.set(key, value)` per key → array `notes` remote **menimpa** lokal = LWW. **Di sinilah merge disisipkan.**
- **Titik merge = Rust `apply_sync_payload`, khusus key `"notes"`** (rekomendasi): baca notes lokal saat ini + notes masuk → `mergeNotes` (union `id` · menang `updatedAt` · tombstone menang) → set hasil. Alasan: satu-satunya *choke point* saat remote ketemu lokal (merge hanya perlu saat **pull**; push ekspor apa adanya). Menghindari stash-lokal-lewat-relaunch yang rapuh. Aturannya JSON generik (`id`/`updatedAt`/`deletedAt`) — tak perlu tahu bentuk penuh `Note`.
  - **Alternatif (TIDAK direkomendasikan):** reconcile di TS via stash `localStorage` di `cloudSync.ts` + merge saat boot di `main.tsx` sebelum `mount()`. Lebih banyak bagian bergerak/rawan timing.
- `mergeNotes` versi TS tetap ditulis di `notes.ts` untuk **unit test paritas** + referensi.
- **GC tombstone**: buang note yang `deletedAt`-nya sudah lewat masa aman (mis. **30 hari**) di `loadNotes()`/boot. Jangan terlalu cepat — device yang belum lihat tombstone bisa membangkitkannya lagi.

### 24.4 UI
- Section **`notes`** di sidebar Settings: tambah ke union `SectionId` + entri `SIDEBAR` (ikon `StickyNote`) + cabang render di `SettingsPage.tsx`.
- **Master-detail** di area konten:
  - **List (≈280px)**: tombol **Add** + **search** (filter judul + isi) + item (judul · badge mode `teks`/`tabel` · waktu relatif · pin 📌). Urut: pinned dulu → `updatedAt` terbaru. Note ber-`deletedAt` **tidak** ditampilkan.
  - **Editor**: input **Judul** (wajib + validasi "Judul wajib"), toolbar (toggle `Teks|Tabel` · pin · hapus · dropdown bahasa · label "terakhir diubah"). Auto-save debounce → `saveNotes()` + `scheduleAutoPush()`.
- **Mode Teks**: **Monaco** via `@monaco-editor/react` (reuse `src/monaco.ts`); container **tinggi pasti + `automaticLayout`**, `wordWrap:"on"`, dispose saat ganti note; dropdown bahasa (`plaintext`/`sql`/`json`/`js`/`markdown`).
- **Mode Tabel** (`src/components/NoteTable.tsx`): grid editable — tambah/hapus **baris**, tambah/hapus/rename **kolom**, edit sel; teks bebas (scope v1). Model `rows[i][columnId]`.
- **Add inline**: klik `+` → draft note baru (default mode Teks), auto-terpilih, fokus ke Judul. Judul kosong **dan** isi kosong saat pindah/tutup → draft dibuang.
- **Empty states**: belum ada note (ajakan Add) · belum pilih note (placeholder).
- **Hapus** = soft-delete (`deletedAt`) + konfirmasi singkat; hilang dari list, tidak terhapus dari disk (biar merge/tombstone jalan).

### 24.5 Pentahapan (tiap fase berdiri sendiri & bisa diuji)
| Sub-fase | Isi | File |
|---|---|---|
| **24A — Lapisan data** | Tipe `Note`/`NoteColumn` · CRUD (`load/saveNotes`, `createNote`, `updateNote` bump `updatedAt`, `softDelete`) · `visibleNotes` · `mergeNotes` murni · `uuid`/`now` | **baru** `src/notes.ts` |
| **24B — UI section + list** | `SectionId`+`SIDEBAR`+render · kerangka master-detail (list: Add/search/item/empty · seleksi · editor placeholder). **Uji: restart app → note tetap ada (offline-first)** | edit `SettingsPage.tsx` · **baru** `NotesSection.tsx` |
| **24C — Editor 2 mode** | Judul wajib+validasi · toolbar · auto-save+`scheduleAutoPush` · **Teks (Monaco + bahasa)** · **Tabel (grid)** | edit `NotesSection.tsx` · **baru** `NoteTable.tsx` |
| **24D — Sync + merge** | Merge per-note di `apply_sync_payload` (key `notes`). **Uji: A edit note-1, B buat note-2 → dua-duanya selamat; hapus → tak hidup lagi** | edit `src-tauri/src/sync.rs` |
| **24E — Poles (opsional)** | Sort pinned+updatedAt · waktu relatif · search isi tabel · konfirmasi hapus · GC tombstone (>30 hari) · (opsional) "Baru dihapus"/restore · (opsional) pintu cepat ke Notes dari luar Settings | beberapa di atas |

> Titik henti MVP terasa lengkap: **akhir 24D**. 24E murni penghalusan.

### 24.6 Sentuhan file (ringkas)
| File | Aksi |
|---|---|
| `src/notes.ts` | **baru** — tipe + CRUD + `mergeNotes` |
| `src/components/SettingsPage.tsx` | edit — daftar section `notes` |
| `src/components/NotesSection.tsx` | **baru** — master-detail + editor + auto-save |
| `src/components/NoteTable.tsx` | **baru** — grid tabel |
| `src-tauri/src/sync.rs` | edit — merge per-note di `apply_sync_payload` |

**Tidak perlu:** migrasi data (key baru) · ubah server · ubah pipeline enkripsi/Drive.

### 24.7 Batas scope v1 (sengaja, biar tidak jadi "Notion mini")
- Kolom tabel = **teks bebas** saja (tak ada tipe angka/tanggal/validasi/formula).
- Merge **per-note**, bukan per-field/CRDT → edit note **yang sama** di 2 device barengan tetap LWW (satu versi kalah). Cukup untuk pemakaian pribadi.
- Menu di **dalam Settings** (sesuai permintaan); pintu cepat dari luar Settings = pertimbangan nanti.

**Status:** rancangan disetujui (diskusi 2026-08-07). Implementasi belum mulai.

---

## 25. Distribusi Microsoft Store (MSIX) — **Fase 25** · ⬜ RANCANGAN (keputusan user 2026-08-23)

> Branch kerja: **`ms-store`**. Tujuan: publish Moorix ke Microsoft Store sebagai paket **MSIX** supaya installer **tidak lagi kena SmartScreen / Smart App Control**.

### 25.0 Tujuan
- Hilangkan peringatan **SmartScreen** ("Windows protected your PC") & blokir **Smart App Control** yang sekarang muncul di installer NSIS (`.exe`) karena belum ter-sign / belum punya reputasi.
- **Kenapa lewat Store menyelesaikan ini:** app yang di-install dari Microsoft Store dipercaya oleh Windows — reputasi datang dari Store, **bukan** dari sertifikat EV. Jadi **tidak perlu beli EV code-signing certificate** (biaya ~$300–600/th) hanya untuk lewat Store.

### 25.1 Keputusan terkunci ✅ (diskusi user 2026-08-23)
- **Jalur:** MSIX (paket `.msix`), bukan submit EXE/MSI unpackaged.
- **Akun:** Microsoft Partner Center **sudah ada** → tinggal reserve nama app + ambil identitas paket.
- **Distribusi eksisting tetap jalan:** NSIS `.exe` + GitHub Releases **tidak dihapus**. Build Store adalah **varian tambahan**, bukan pengganti. (User yang download langsung tetap dilayani jalur lama; Store jadi jalur "aman & mudah".)

### 25.2 Kendala inti: Tauri v2 tidak produksi MSIX secara native
Bundler Tauri (`targets`) hanya punya `nsis`/`msi`/`app` untuk Windows — **tidak ada target `msix`**. Jadi MSIX dibuat **paska-build** dengan langkah manual yang direproduksi lewat skrip:
1. `tauri build` (target `app`/`nsis`) → dapat `Moorix.exe` + sidecar/resource di `src-tauri/target/release/`.
2. Susun **layout** paket (folder berisi exe + aset + `AppxManifest.xml`).
3. `makeappx.exe pack` (dari Windows SDK) → hasil `.msix`.
4. (Uji lokal saja) `signtool` dgn sertifikat self-signed yang **Publisher-nya == manifest** → install & tes. **Untuk submit ke Store TIDAK perlu sign sendiri** — Store yang menandatangani.

> Ini adalah paket **"packaged Win32 desktop app"** (full-trust), bukan UWP. Aplikasi tetap Win32 penuh, cuma dibungkus MSIX.

### 25.3 Identitas paket dari Partner Center (langkah pertama, sebelum ngoding)
Di Partner Center → reserve app name "Moorix", lalu **Product → Product identity** catat:
- **Package/Identity/Name** (mis. `12345Publisher.Moorix`)
- **Publisher** (mis. `CN=ABCD1234-...`)  ← wajib **persis** di manifest
- **Publisher display name**
- **Package Family Name (PFN)**

Nilai-nilai ini masuk ke `AppxManifest.xml` (§25.6). Salah satu huruf beda → sertifikasi Store gagal.

### 25.4 Perubahan WAJIB pada kode/konfig untuk build Store
Build Store harus dibedakan dari build biasa (via **Cargo feature** mis. `msstore`, atau env `MOORIX_STORE=1`). Yang berubah:

1. **Matikan in-app updater** — Store yang meng-update app. Updater Tauri yang self-download **dilarang** di app Store & bakal gagal (MSIX read-only). → di build Store: jangan register `tauri_plugin_updater`, dan sembunyikan UI "Check for updates". (`createUpdaterArtifacts` tetap boleh untuk jalur non-Store.)
2. **Autostart** — plugin autostart nulis ke registry `Run` key; di MSIX itu **tervirtualisasi/diblok**. Ganti dengan **`StartupTask` extension** di manifest (§25.6). Fitur "Run at startup" (Fase 23D) harus dites ulang: di build Store toggle-nya mengaktifkan StartupTask, bukan registry.
3. **Capability `runFullTrust`** (`rescap`) — **wajib**, supaya app tetap punya akses FS penuh & bisa spawn proses eksternal (`ssh`, `mysqldump`/`mysql`, `pg_dump`/`psql`, tulis backup ke folder pilihan user di Fase 23). Tanpa ini backup & DB export/import mati.
4. **Versi 4-part, revisi = 0** — MSIX butuh `Major.Minor.Build.Revision` dan Store mensyaratkan **revisi (part ke-4) = 0**. `0.1.1` → `0.1.1.0`. **Pertimbangkan bump ke `1.0.0.0`** (Store lebih ramah versi ≥ 1.0; sekaligus menandai "rilis publik").
5. **Single-instance guard** (sudah ada) — perlu diuji di sandbox MSIX (identitas paket beda; named-mutex biasanya tetap jalan, tapi verifikasi).
6. **Tray + hide-to-tray + `--autostart` arg** (Fase 23D) — StartupTask bisa kirim argumen; pastikan app tetap start-hidden saat dinyalakan oleh StartupTask.

### 25.5 `AppxManifest.xml` (template — disimpan di `src-tauri/msix/AppxManifest.xml`)
Elemen kunci:
- `<Identity Name="… (dari Partner Center)" Publisher="CN=…" Version="1.0.0.0" ProcessorArchitecture="x64"/>`
- `<Properties>`: `DisplayName`, `PublisherDisplayName`, `Logo`.
- `<Dependencies>`: `TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0"` (sesuaikan).
- `<Applications><Application Id="Moorix" Executable="Moorix.exe" EntryPoint="Windows.FullTrustApplication">`
  - `<uap:VisualElements …>` (nama, ikon, warna latar, tile).
  - **StartupTask**: `<uap5:Extension Category="windows.startupTask"><uap5:StartupTask TaskId="MoorixAutostart" Enabled="false" DisplayName="Moorix"/></uap5:Extension>` (+ argumen `--autostart` bila didukung).
  - (Opsional) protocol handler bila mau deep-link.
- `<Capabilities>`: `<rescap:Capability Name="runFullTrust"/>` (+ namespace `rescap`/`uap5` di root).

### 25.6 Aset visual MSIX (dari `icon-source.png`)
Store butuh set aset khusus (beda dari `.ico`): `Square44x44Logo`, `Square150x150Logo`, `Wide310x150Logo` (opsional), `StoreLogo` (50x50), `Square71x71`, splash/tile + versi scale (100/125/150/200/400) & **target-size** (16/24/32/48/256) untuk taskbar/Explorer. Generate sekali (script) ke `src-tauri/msix/Assets/`.

### 25.7 Skrip packaging (`scripts/pack-msix.ps1`)
Langkah yang diotomasi:
1. `pnpm tauri build --features msstore` (atau env flag) → `Moorix.exe`.
2. Copy exe + `Assets/` + `AppxManifest.xml` (dengan versi di-inject) ke folder layout `target/msix/layout/`.
3. `makeappx pack /d layout /p Moorix.msix /o`.
4. (uji lokal) buat cert self-signed `New-SelfSignedCertificate` Publisher==manifest → `signtool sign` → `Add-AppxPackage`.
Deteksi path Windows SDK (`makeappx.exe`, `signtool.exe`) via `Get-ChildItem` di `C:\Program Files (x86)\Windows Kits\10\bin\*\x64\`.

### 25.8 Uji lokal (sebelum submit) — checklist
- Install `.msix` (self-signed) → **tidak ada SmartScreen** saat dijalankan dari paket.
- Window utama tampil; title bar custom (decorations:false) OK.
- **Secret storage** (vault/kredensial) baca-tulis OK di sandbox MSIX.
- **Autostart** via StartupTask → reboot → app start hidden di tray.
- **Backup DB** (Fase 23) nulis file ke folder tujuan (butuh `runFullTrust`).
- **Spawn tool**: SSH connect, `mysqldump`/`pg_dump` export & import jalan.
- **Tray**: hide-to-tray + close-to-tray OK.
- **Updater**: pastikan UI update tersembunyi / tak ada percobaan self-update.

### 25.9 Submit ke Partner Center
1. Buat submission baru → upload `Moorix.msix` (**unsigned** — Store yang sign).
2. Isi listing: deskripsi, screenshot, kategori (Developer tools), rating (IARC), privacy policy URL.
3. Kirim untuk sertifikasi → tunggu review. Jika lolos → live di Store, **SmartScreen hilang** untuk semua yang install via Store.

**Fase 25D — dimulai 2026-08-23.** Paket submission siap: `src-tauri/target/msix/Moorix-0.1.1.0.msix` (**unsigned**, `Get-AuthenticodeSignature` = NotSigned; Identity `oktajianto.com.Moorix`, Publisher `CN=212C59D6-...`, versi `0.1.1.0`). Catatan versi: `0.1.1.0` = format MSIX 4-angka (revision 0 wajib Store); versi sumber tetap `0.1.1` — build Linux/mac/NSIS **tidak** terpengaruh (skrip pack tak menyentuh `tauri.conf.json`/`Cargo.toml`). Arsitektur x64 saja (arm64 opsional menyusul). Sisa: user upload via Partner Center (Packages) + isi listing + submit sertifikasi.

### 25.10 Pentahapan (tiap fase berdiri sendiri & bisa diuji)
- **25A ✅ (2026-08-23)** — Packaging lokal jalan. Dibuat: `src-tauri/msix/AppxManifest.template.xml` (full-trust + `runFullTrust` + StartupTask, token identitas/versi diinject), `scripts/pack-msix.ps1` (build `--no-bundle` → susun layout → `makeappx pack` → opsi self-sign+install), `src-tauri/msix/README.md`. `.gitignore`: abaikan `*.pfx`/`*.cer`/`*.msix`. **Terverifikasi:** `pack-msix.ps1 -SkipBuild` → `makeappx` memvalidasi manifest & menghasilkan `Moorix-0.1.1.0.msix` (~12,66 MB) di `src-tauri/target/msix/`. Catatan implementasi: (a) komentar XML tak boleh memuat `--` (mis. `--autostart`) → di-reword; (b) template dibaca UTF-8 & manifest ditulis UTF-8-no-BOM agar tak mojibake di PS 5.1. *Belum sentuh updater/autostart (→ 25B).* Uji install butuh trust cert self-signed (admin) — belum dijalankan di sini.
- **25B — Penyesuaian build Store.** Feature flag `msstore`: matikan updater, capability `runFullTrust` (sudah di manifest 25A), autostart → StartupTask, versi 4-part.
  - **25B-1 ✅ (2026-08-23)** — Feature `msstore` di `Cargo.toml`. `lib.rs`: plugin `tauri_plugin_updater` **tidak diregister** saat `feature = "msstore"` (plugin `process` tetap — dipakai relaunch cloud-sync, bukan cuma updater); command baru `is_store_build() -> cfg!(feature="msstore")`. Frontend: `src/appFlavor.ts` (`isStoreBuild()`, cached); `updater.ts` early-return bila store build (mencakup auto-check startup + tombol manual); `SettingsPage.tsx` menyembunyikan tombol "Check for updates" + toggle "Automatic Updates" + toggle "Run at startup" saat store build (diganti hint sementara → StartupTask di 25B-2). `pack-msix.ps1` build dengan `--features msstore`. Versi 4-part sudah dari pack script (25A). **Verifikasi:** `tsc` lolos; `cargo check` **dan** `cargo check --features msstore` lolos (hanya 4 warning lama); build release `--features msstore` + `makeappx pack` → MSIX baru sukses.
  - **25B-2 ✅ (2026-08-23)** — Autostart via **StartupTask** (WinRT). `src-tauri/src/win_startup.rs` (hanya `cfg(all(windows, feature="msstore"))`): `StartupTask::GetAsync`/`State`/`RequestEnableAsync`/`Disable`, TaskId `MoorixAutostart` (cocok dgn manifest). Async di-block via metode inheren `IAsyncOperation::Status()`/`GetResults()` — **bukan** `.get()` (trait `Async` tak diekspor publik & gated `std`). Dep: `windows = "0.62"` (features `ApplicationModel`,`Foundation`) + `windows-future = "0.3"` (facade `windows` tak re-export tipe async), keduanya **opsional** ditarik feature `msstore`, Windows-only, versi cocok dgn yg sudah ada di lock. Command `startup_task_state`/`startup_task_set` (body cfg-split ala `serial`: impl asli di windows+msstore, else `Err` — supaya `generate_handler!` tetap sama utk Android). Frontend: `src/autostart.ts` (`isAutostartEnabled`/`setAutostartEnabled` route ke plugin non-store atau command store), dipakai di `SettingsPage.tsx` (toggle "Run at startup" dikembalikan utk store build) & `backupDb.ts` `syncTrayMode`. **Verifikasi:** `tsc` + `cargo check` (normal & `--features msstore`) lolos; build release `--features msstore` + `makeappx pack` sukses.
  - **25B-3 ✅ (2026-08-23)** — Start-hidden untuk build Store. StartupTask tak bisa kirim arg `--autostart`, jadi deteksi via WinRT: `win_startup::launched_by_startup_task()` → `AppInstance::GetActivatedEventArgs()` lalu `Kind() == ActivationKind::StartupTask` (feature windows `ApplicationModel_Activation`). Di `lib.rs` `setup()`, hasil ini di-OR dengan cek argv `--autostart` (cfg `all(windows, feature="msstore")`) → instance login diam di tray, launch manual dari Start tetap menampilkan window. Build unpackaged (dev exe) → `GetActivatedEventArgs` error → false (aman). **Verifikasi:** `cargo check` normal & `--features msstore` lolos; build+pack sukses. Uji reboot sebenarnya = 25C.
- **25C — Uji native menyeluruh** (checklist §25.8) di mesin user. Pakai identitas asli dari Partner Center (§25.3).
  - **25C-1 ✅ (2026-08-23)** — Identitas Partner Center diterima & dipasang: `src-tauri/msix/store-identity.json` (Name `oktajianto.com.Moorix`, Publisher `CN=212C59D6-8E60-48FC-BFC8-F5EDD847F490`, PublisherDisplayName `oktajianto.com`; PFN `oktajianto.com.Moorix_44216rjve3r6j`, Store ID `9PFM3C4LWS8B` — semua publik). `pack-msix.ps1` kini auto-load file ini (prioritas: param eksplisit > json > default dummy self-signed). **Hasil:** MSIX submission `Moorix-0.1.1.0.msix` (unsigned) ter-generate dengan Identity asli — terverifikasi di manifest layout.
  - **25C-3 ✅ (2026-08-23)** — Fix ikon taskbar "background hitam". Logo = glyph di atas transparansi; tanpa varian `altform-unplated` + `resources.pri`, MSIX me-*plating* ikon jadi kotak gelap. `pack-msix.ps1` kini: (a) generate `Square44x44Logo.targetsize-{16,24,32,48,256}.png` + `..._altform-unplated.png` (downscale dari `icons/icon.png` 512px transparan via System.Drawing HQ bicubic); (b) bangun `resources.pri` via `makepri createconfig`+`new` sehingga MRT resolve varian (unplated dipakai taskbar/Start). `-Install` kini uninstall dulu paket lama (reinstall konten versi-sama tanpa error). Hasil uji native: Start/search/tray **bersih** (pakai unplated). **Taskbar** app packaged tetap *plated* (Windows tak bisa dipaksa unplated di konteks ini) → solusi: `BackgroundColor="#FFFFFF"` di manifest supaya plate taskbar **putih bersih** (bukan hitam/biru). Skrip generate **hanya** varian unplated + `resources.pri`. Dikonfirmasi user: taskbar putih OK.
  - **25C-2 🔶 sebagian (2026-08-23)** — Uji native oleh user pada paket identitas-Store asli (self-signed lokal): **install sukses**, app kebuka tanpa SmartScreen, UI updater tersembunyi. **"Run at startup" + start-hidden TERVERIFIKASI native**: setelah aktifkan toggle lalu **restart**, Moorix diluncurkan StartupTask saat login dan **diam di tray tanpa window** (25B-2 + 25B-3 confirmed). Sisa uji: secrets baca/tulis, backup DB tulis file, spawn `ssh`/`mysqldump`/`pg_dump`. Opsional: **WACK** (`appcert.exe`) sbg pre-check sertifikasi.
- **25D — Submit & sertifikasi** (§25.9). Setelah live: dokumentasikan alur "update rilis Store" (build → pack → new submission).

### 25.11 Risiko & mitigasi
| Risiko | Mitigasi |
|---|---|
| Publisher/Identity manifest ≠ Partner Center | Ambil nilai persis dari Product Identity; inject saat pack, jangan hardcode salah |
| Updater self-download aktif di build Store → reject/crash | Feature flag `msstore` menonaktifkan plugin updater + UI-nya |
| Autostart via registry tak jalan di MSIX | Pindah ke `StartupTask` extension; uji reboot |
| Backup/DB tool gagal karena sandbox | `runFullTrust` capability; uji spawn `ssh`/`mysqldump`/`pg_dump` |
| Versi ditolak (revisi ≠ 0 / < aturan Store) | Skema `Major.Minor.Build.0`; pertimbangkan mulai `1.0.0.0` |
| Tauri update masa depan mengubah nama/letak exe | Skrip pack deteksi exe dari `target/release`, tidak hardcode |

**Status:** **✅ FASE 25 SELESAI — Moorix LIVE di Microsoft Store** (accepted 2026-08-25). Store id `9PFM3C4LWS8B` → https://apps.microsoft.com/detail/9PFM3C4LWS8B. 25A pipeline MSIX · 25B build variant `msstore` (updater mati, autostart StartupTask, start-hidden) · 25C identitas Partner Center + fix ikon (unplated + white plate) · 25D submit → **accepted & live**. Branch `ms-store` di-merge ke `main` (2026-08-25). README punya blok Download (Store utama). Distribusi: MSIX = Store-only; NSIS `.exe` tetap di GitHub Releases (kena SmartScreen kecuali di-sign). Sisa opsional: ARM64, sertifikat code-signing untuk sideload/`.exe`.

---

## 26. Autentikasi SSH pakai Key + Generate Key — **Fase 26** · ⬜ RANCANGAN (diskusi user 2026-08-25)

> Branch kerja: **`koneksiSSH-withSSHKey`**. Tujuan: koneksi SSH tak lagi hanya username+password — bisa pakai **private key** (yang user generate sendiri), **dan** Moorix bisa **men-generate keypair baru** langsung dari app lalu memandu memasang public key ke server.

### 26.0 Tujuan
Dua kemampuan yang saling melengkapi:
- **A — Pakai key yang sudah ada** (user sudah `ssh-keygen` di komputernya): pilih file private key lewat **Browse** (bukan ketik path manual), dukung **key ber-passphrase**, kredensial passphrase disimpan aman di OS keychain (opsional).
- **B — Generate keypair di dalam app**: tombol **Generate key…** → pilih algoritma (Ed25519 default / RSA), passphrase opsional, komentar, lokasi simpan → app buat `id_*` + `id_*.pub`, set profil ke key itu, lalu **tampilkan public key + Copy** dengan panduan pasang ke `~/.ssh/authorized_keys` server. (Stretch: pasang otomatis ala `ssh-copy-id` lewat sesi password yang masih aktif.)

### 26.1 Temuan kode (apa yang SUDAH ada) ✅
Backend key-auth **sudah jalan**, cuma UI/kelengkapannya kurang:
- **`src-tauri/src/ssh.rs`** — enum `SshAuth::Key { path, passphrase }` (`ssh.rs:68`); saat connect: `load_secret_key(path, passphrase.as_deref())` → `authenticate_publickey(...)` (`ssh.rs:174`). Passphrase **sudah didukung di level backend**, tinggal frontend mengirimkannya.
- **`src/profiles.ts`** — `SshAuthMethod = "auto"|"password"|"key"|"agent"|"interactive"` (`profiles.ts:101`); `SshOptions` punya `authMethod`, `password`, `keyPath` (`profiles.ts:136`). `sshOpenFromProfile` mengirim `{ type:"key", path:s.keyPath, passphrase:null }` saat `authMethod==="key" && keyPath` (`profiles.ts:344`) — **passphrase di-hardcode `null`**. Jump host juga (`profiles.ts:365`).
- **`src/components/ProfileEditor.tsx`** — tombol metode auth (`AUTH_METHODS`, `ProfileEditor.tsx:285`); saat `key`/`auto` muncul input teks **"Private key path"** (`ProfileEditor.tsx:371`) — **belum ada Browse, belum ada field passphrase**.
- **`tauri-plugin-dialog`** sudah terpasang sejak Fase 23A-2 (folder picker) → **file picker key tinggal reuse** (`open({ multiple:false })`).
- **Secret storage** siap pakai: `src/secrets.ts` (`secretGet`/`secretSet`/`secretDelete`, keyed by id, lewat vault/keychain) + `src-tauri/src/secrets.rs` (`keyring` OS).

**Kesenjangan yang ditutup Fase 26:** (1) Browse file key · (2) input + penyimpanan passphrase · (3) kirim passphrase ke backend (buang `null` hardcode) · (4) generator keypair in-app + tampil public key. **`agent`/`interactive`** tetap **di luar scope** fase ini (enum backend belum punya varian-nya; catat sebagai lanjutan).

### 26.2 Keputusan desain — Part A (pakai key existing)
1. **Browse file** — tombol di sebelah input "Private key path" → `open({ multiple:false, title:"Select private key" })`. Tanpa filter ekstensi ketat (key sering tanpa ekstensi: `id_ed25519`, `id_rsa`) — filter opsional "All files". Hasil path → `setSsh({ keyPath })`. Input manual tetap boleh (path ketik/paste masih jalan).
2. **Passphrase** — checkbox **"Key has a passphrase"**; saat aktif muncul input password. **Penyimpanan:** di OS keychain, **key terpisah dari password** profil, mis. id `"<profileId>#keyPassphrase"` (reuse `secretSet`/`secretGet`) — **tidak** ditulis ke `moorix.json`. Kosong = key tanpa passphrase (kirim `passphrase: null`).
3. **Kirim ke backend** — `sshOpenFromProfile`: bila `authMethod` key/auto & `keyPath` → `passphrase = (await secretGet("<id>#keyPassphrase")) ?? null`, kirim di objek auth. Sama untuk **jump host** (`profiles.ts:365`).
4. **Key TIDAK tersimpan di akun/cloud — hanya profil yang tersync** ✅ (keputusan user 2026-08-26). Private key adalah **file lokal**; **`keyPath` dan passphrase key TIDAK ikut sync** ke akun (Google Drive). Yang tersync hanya metadata profil (host/port/username/nama/`authMethod`/dll). Efek: login akun sama di **komputer lain** (atau install ulang) → profil muncul, tapi **binding key kosong** → user **setup ulang** key (Browse existing / Generate baru). Detail penyimpanan & mekanisme strip di **§26.10**.
5. **Auto** — biarkan perilaku sekarang (ada `keyPath` → coba key, else password). Multi-method fallback (coba publickey lalu password lalu keyboard-interactive dalam satu koneksi) = **lanjutan opsional**, bukan fase ini.

### 26.3 Keputusan desain — Part B (generate keypair)
1. **Pemicu UI** — tombol **"Generate key…"** di section key ProfileEditor → modal `GenerateKeyModal`.
2. **Field modal:**
   - **Type**: `Ed25519` (default, direkomendasikan) · `RSA` (pilih **2048/3072/4096**, default 3072). *(ECDSA di-skip; Ed25519 sudah cukup & modern.)*
   - **Passphrase** (opsional) + **konfirmasi** (mismatch → error). Kosong = key tanpa passphrase.
   - **Comment** — default `moorix:<profileName>` atau `<username>@<host>`.
   - **Save to** — default folder `~/.ssh/` (buat bila belum ada) nama `id_ed25519`/`id_rsa`; bisa diubah via dialog. **Cek overwrite** (tolak/timpa dengan konfirmasi).
3. **Hasil** — setelah generate:
   - Tulis **private key** (format OpenSSH; **chmod 600** di unix) + **`<path>.pub`**.
   - Set profil: `keyPath = <path>`, `authMethod = "key"`; bila ada passphrase → simpan ke keychain (§26.2 poin 2).
   - Modal beralih ke tampilan **"Key created"**: tampilkan **public key** (satu baris `authorized_keys`) + tombol **Copy** + instruksi ringkas ("Add this line to `~/.ssh/authorized_keys` on the server"). Tampilkan juga path privat/publik.
4. **Stretch (26C) — Install ke server otomatis** (ala `ssh-copy-id`): bila profil masih punya **password** yang valid, tawarkan tombol **"Install to server now"** → buka sesi via password → `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo <pub> >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys` (idempotent: cek duplikat dulu). Sukses → user bisa langsung ganti ke auth key. *(Butuh koneksi password aktif; kalau tak ada, fallback ke instruksi copy manual.)*

### 26.4 Backend (Rust)
- **`ssh.rs` — tidak berubah** untuk Part A (passphrase sudah didukung; frontend cukup berhenti mengirim `null`).
- **Command baru `ssh_generate_keypair`** (Part B), mis. di modul baru `src-tauri/src/keygen.rs` (atau di `ssh.rs`):
  - Input: `{ algo: "ed25519"|"rsa", bits?: u32, passphrase?: String, comment?: String, out_path: String }`.
  - Pakai **`ssh-key`** (crate yang sudah ditarik `russh::keys`): `PrivateKey::random(&mut OsRng, Algorithm::Ed25519)` / RSA `Algorithm::Rsa { .. }` (atau `RsaKeypair::random`), set `comment`, `encrypt(&mut OsRng, passphrase)` bila ada → `to_openssh(LineEnding::LF)` untuk privat; `public_key().to_openssh()` untuk `.pub`.
  - Tulis file (buat folder induk bila perlu); **unix: set permission 0600** privat / 0644 publik (`std::os::unix::fs::PermissionsExt`, `cfg(unix)`). Windows: andalkan ACL default profil user.
  - Return `{ private_path, public_path, public_openssh }`.
- **(26C) command `ssh_install_pubkey`** (opsional): terima config koneksi (password) + baris public key → jalankan perintah append idempotent di server, return sukses/gagal. Bisa reuse jalur channel exec yang sudah ada.

### 26.5 Frontend
- **`ProfileEditor.tsx`** (section key, `ProfileEditor.tsx:371`):
  - Tambah tombol **Browse** (ikon `FolderOpen`) di kanan input path → `open({multiple:false})`.
  - Tambah **checkbox passphrase** + input (baca/tulis keychain via `secrets.ts`; jangan taruh di `setSsh`).
  - Tambah tombol **Generate key…** → buka `GenerateKeyModal`.
- **Baru `src/components/GenerateKeyModal.tsx`** — form §26.3 → panggil `invoke("ssh_generate_keypair", …)` → tampilan hasil (public key + Copy) → set profil (`keyPath`/`authMethod`) + simpan passphrase → (26C) tombol Install to server.
- **`profiles.ts`** — `sshOpenFromProfile`: ambil passphrase dari keychain, kirim di auth (utama **dan** jump host); hapus `passphrase: null` hardcode (`profiles.ts:344` & `:365`).
- **`src/secrets.ts`** — reuse; helper opsional `keyPassphraseId(profileId)` biar konsisten.
- **Keamanan UI** — passphrase input `type=password`, tak pernah dilog; public key aman ditampilkan (memang publik).

### 26.6 Dependency (yang mungkin perlu ditambah)
- **`ssh-key`** sebagai **dep langsung** dengan feature keygen — **versi disamakan** dengan yang dipakai `russh` 0.62 (hindari mismatch tipe), feature kira-kira `["ed25519","rsa","encryption","getrandom"]`. *(russh sudah menarik `ssh-key`, tapi feature random/encryption mungkin belum aktif → aktifkan lewat dep langsung.)*
- **`rand_core`/`OsRng`** (via `rand` atau `getrandom`) untuk sumber acak generate.
- **`tauri-plugin-dialog`** — **sudah ada** (Fase 23A-2), tak perlu tambah.
- Verifikasi: `cargo check` normal **dan** `--features msstore` tetap lolos (generate key harus jalan di build Store — `runFullTrust` sudah mengizinkan tulis file).
- **Alternatif kalau crate rewel:** shell-out ke `ssh-keygen` bila tersedia di PATH — **tidak dipilih** (tak selalu ada di Windows, kalah "in-app"), hanya fallback darurat.

### 26.7 Pentahapan (tiap sub-fase berdiri sendiri & bisa diuji)
| Sub-fase | Isi | File utama |
|---|---|---|
| **26A — Pakai key existing + strip sync** | Browse file key · checkbox+input passphrase (simpan keychain) · kirim passphrase ke backend (utama + jump host) · **strip `keyPath` dari sync + preserve keyPath lokal saat pull (§26.10)**. **Uji: connect pakai key ber-passphrase · push→pull di device lain key kosong** | `ProfileEditor.tsx` · `profiles.ts` · `secrets.ts` · `sync.rs` |
| **26B — Generate keypair** | Command `ssh_generate_keypair` (Ed25519/RSA, passphrase, chmod 600) · `GenerateKeyModal` · tulis `id_*`+`.pub` · set profil · tampil+Copy public key. **Uji: generate → file muncul → public key valid** | **baru** `keygen.rs` · **baru** `GenerateKeyModal.tsx` · `ProfileEditor.tsx` |
| **26C — Install ke server (opsional)** | `ssh_install_pubkey` (append idempotent ke `authorized_keys` lewat sesi password) · tombol "Install to server now". **Uji: dari password → install → login berikutnya cukup key** | `ssh.rs`/`keygen.rs` · `GenerateKeyModal.tsx` |
| **26D — Poles (opsional)** | Multi-method **auto** (publickey→password→keyboard-interactive) · dukung **agent**/**interactive** (varian `SshAuth` baru) · validasi/format public key · indikator "key ✓ terbaca" | `ssh.rs` · `ProfileEditor.tsx` |

> Titik henti MVP terasa lengkap: **akhir 26B** (pakai key + generate). 26C/26D nilai tambah.

### 26.8 Sentuhan file (ringkas)
| File | Aksi |
|---|---|
| `src/components/ProfileEditor.tsx` | edit — Browse · passphrase · tombol Generate |
| `src/components/GenerateKeyModal.tsx` | **baru** — form generate + hasil public key |
| `src/profiles.ts` | edit — kirim passphrase (buang `null`), utama + jump host |
| `src/secrets.ts` | edit(opsional) — helper id passphrase |
| `src-tauri/src/keygen.rs` | **baru** — `ssh_generate_keypair` (+`ssh_install_pubkey` 26C) |
| `src-tauri/src/ssh.rs` | edit(hanya 26C/26D) — install pubkey / varian auth baru |
| `src-tauri/Cargo.toml` | edit — dep `ssh-key` (feature keygen) + `rand` |
| `src-tauri/src/lib.rs` | edit — registrasi command baru di `generate_handler!` |

**Perlu disentuh untuk §26.10:** `src-tauri/src/sync.rs` (strip `ssh.keyPath` saat export + preserve keyPath lokal saat import). **Tidak perlu:** ubah server · migrasi data (field `keyPath` sudah ada; passphrase di keychain).

### 26.9 Risiko & mitigasi
| Risiko | Mitigasi |
|---|---|
| Versi `ssh-key` beda dgn yg dipakai `russh` → mismatch tipe saat compile | Samakan versi persis ke transitive `russh` 0.62; kunci di `Cargo.lock`; kalau tetap rewel → fallback shell `ssh-keygen` |
| Path key beda antar-komputer (drive/OS beda) | **Diselesaikan oleh keputusan §26.10**: `keyPath` tak disync → tiap device setup key sendiri, tak ada path nyasar |
| Key ter-upload ke cloud tanpa sengaja (bocor rahasia) | `keyPath`/passphrase di-strip dari payload sync (§26.10); private key = file lokal, tak pernah masuk store |
| Generate/encrypt gagal di build Store (sandbox MSIX) | `runFullTrust` sudah aktif (Fase 25); uji tulis `~/.ssh` + generate di paket MSIX (masuk checklist §25.8) |
| Permission private key longgar di Windows (tak ada chmod) | Andalkan ACL profil user; dokumentasikan; unix tetap 0600 |
| Passphrase bocor ke store/log | Simpan hanya di keychain/vault; input `type=password`; jangan pernah `console.log` |
| Install-to-server (26C) menduplikasi baris di `authorized_keys` | Perintah idempotent: `grep -q` dulu sebelum append |

### 26.10 Penyimpanan & sync key — key tidak masuk akun ✅ (keputusan user 2026-08-26)
**Prinsip:** private key & passphrase = **rahasia per-device**, tak pernah diunggah ke akun/cloud. Hanya **profil** yang tersync. Reconnect di device lain → **setup ulang** key.

- **Lapisan penyimpanan:**
  - **Private key** — file di disk device itu (mis. `~/.ssh/id_ed25519`). Tak pernah masuk store/cloud.
  - **`keyPath`** — persist **lokal** di `moorix.json` (bagian `SshOptions`) supaya reconnect di **device yang sama** tak perlu ulang, **tetapi di-strip** saat export sync (tak ikut ke Drive).
  - **Passphrase** — OS keychain / vault (id `"<profileId>#keyPassphrase"`), lokal; tidak disync sebagai plaintext. (Konsisten dgn password profil yang juga di keychain.)
  - **Profil (metadata)** — host/port/username/nama/`authMethod`/ports/ciphers/dll → **tetap disync** seperti sekarang.
- **Mekanisme strip (di `sync.rs`)** — `LOCAL_ONLY_KEYS` tak cukup (itu per **key top-level** store; `keyPath` ada **di dalam** array `userProfiles`). Jadi perlu penanganan per-field khusus key `"userProfiles"`, mirip pola merge Notes (§24.3):
  - **Export (`get_sync_payload`)** — untuk tiap profil di `userProfiles`, set `ssh.keyPath = ""` di salinan payload sebelum dienkripsi/upload. (Password sudah tak di store — di keychain.)
  - **Import/pull (`apply_sync_payload`)** — saat menerima `userProfiles` remote, **pertahankan `keyPath` lokal** untuk profil dgn `id` yang sama (jangan timpa jadi kosong). Profil **baru** dari device lain → `keyPath` kosong → user setup ulang. Ini mencegah pull menghapus binding key yang sudah dipasang lokal.
- **Efek yang diharapkan (uji):** (a) Device A pasang key → reconnect setelah restart **tanpa** ulang. (b) Push dari A → Pull di B → profil muncul di B **tanpa** key → B Browse/Generate key sendiri. (c) Blob Drive **tak** memuat `keyPath`/passphrase (verifikasi: dump payload sebelum upload).
- **`authMethod` tetap disync** — di device baru profil bisa tampil sebagai "Key" tapi `keyPath` kosong → UI beri **hint** "Key belum dipasang di perangkat ini — Browse atau Generate".

**Status:** rancangan (diskusi user 2026-08-25, penyimpanan/sync dikunci 2026-08-26). Implementasi belum mulai. Urutan disarankan: **26A → 26B** (MVP; 26A sudah termasuk strip sync §26.10), lalu 26C/26D bila diinginkan.

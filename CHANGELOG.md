# Changelog

All notable changes to **Moorix** are documented here.

> These are early `0.1.x` builds. Formats and data may still change between releases.
> Desktop (Windows / Linux / macOS) is the actively released target; Android / iOS are planned.

---

## [0.1.1] — 2026-08-13

**Never lose a database again.** Moorix gains an unattended **Auto-Backup** system for your databases, plus faster in-app search and a batch of database-editor polish.

### Added
- **Auto-Backup DB.** Schedule recurring database backups that keep running in the background — the app can start on login and live in the **system tray**, so backups happen even when the window is closed. A **progress banner** shows each backup as it runs.
- **Find-in-row search** in the Edit row popup — jump straight to a field in wide rows.
- **`Ctrl`/`Cmd`+F opens the Monaco find widget** inside the editor, with a dedicated search button in the header.
- **Create-database charset options** — pick the character set / collation when creating a new database.
- **First / last page buttons** in the database pager for quicker navigation through large tables.

### Changed
- **Single-instance guard** — launching Moorix again focuses the existing window instead of opening a second copy (keeps tray, autostart, and backups consistent).

### Fixed
- Database password now syncs correctly across the connection and backup flows.
- The Add/Edit column modal keeps its **Save / Cancel** buttons in view instead of pushing them off-screen.

### Distribution
- **Moorix is now on the [Microsoft Store](https://apps.microsoft.com/detail/9PFM3C4LWS8B)** — the recommended way to install: no SmartScreen warnings, with automatic install and updates.
- New **MSIX Store build** (`msstore` variant) with a real Partner Center identity. The Store build **autostarts on login via a WinRT StartupTask** and can **start hidden** straight to the system tray.
- The direct `.exe` installer is still available from the Releases page (unsigned — Windows may show a SmartScreen prompt).

---

## [0.1.0] — 2026-08-03

**First stable `0.1.0`.** A native **Database Manager** joins the SFTP file manager and terminal, and files download straight to your OS Downloads folder.

### Added
- **Native Database Manager** — connect to **MySQL / MariaDB** (and **PostgreSQL**) over the SSH tunnel, browse tables, and run SQL without leaving Moorix.
- **Structure editor** — add and edit columns, reorder column position, define enums with a guided picker, and **Create TYPE** (PostgreSQL). Browse and SQL views stay in sync as you edit.
- **Terminal search** — find text within the terminal panel, plus a **folder dropdown** for quicker navigation in the SFTP file manager.
- **SFTP downloads go to the OS Downloads folder** — no more picking a destination for every file.

### Fixed
- SFTP **compress / extract** and **multi-select delete** now work reliably.

---

## [0.1.0-pre.13] — 2026-07-22

**The in-app code editor arrives.** Moorix can now open, edit, and save files directly from the SFTP file manager — no download-edit-reupload round trip — and grows into a full multi-document editor.

### Added
- **Built-in Monaco (VS Code) editor.** Open any text file from the SFTP panel — local or remote — edit it with full syntax highlighting, line numbers, and minimap, then **Save** (button or `Ctrl`/`Cmd`+S) to write it straight back. Listings auto-refresh (size & date) after each save.
- **Multi-file editing.** Open several files at once in a **tab bar**, each with an unsaved-changes indicator. Every file keeps its own Monaco model, so **undo history, cursor, and scroll position are preserved** when switching tabs.
- **Minimize to a floating pill.** Collapse the editor into a small "N files" pill (with a dirty-state dot) so you can keep editing while using the terminal or file manager, then click to restore.
- **Split view, freely nestable.** Split any pane right or down and pick which open file appears in the new pane — including the *same* file, to compare two parts side by side. Closing a pane collapses the layout back automatically.
- **Word-wrap and maximize toggles** in the editor header.

### Changed
- Files are read/written as **UTF-8**; line endings (CRLF/LF) are preserved exactly as stored.
- Closing a tab or "close all" prompts for confirmation when there are unsaved changes.

### Safety & limits
- **Soft cap 1 MB** — larger files prompt a confirmation before opening.
- **Hard cap 10 MB** — beyond this, editing is declined to keep the editor responsive.
- **Binary files** (archives, media, executables, …) are detected up front and kept **read-only** — no wasted download.
- When an SSH/SFTP session closes while a remote file is open, the document becomes **read-only** with a clear badge; reopening the file manager **re-binds** it so you can edit and save again.

---

## [0.1.0-pre.12] — 2026-07-22

### Fixed
- **Auto-sync no longer overwrites a good backup with an empty config.** A guard now prevents a blank or not-yet-loaded local state from replacing a valid cloud backup, protecting your saved profiles and settings.

---

## [0.1.0-pre.11] — 2026-07-21

### Fixed
- **Pulled sync config no longer vanishes after restart.** Configuration downloaded from Google Drive is now persisted correctly, so it survives an app restart instead of disappearing on next launch.

---

## [0.1.0-pre.10] — 2026-07-21

### Added
- **Automatic cross-device sync via Google Drive.** On top of manual Push/Pull, Moorix can now sync your settings and encrypted vault **automatically in the background**, so moving between machines stays effortless — always end-to-end encrypted.

---

## [0.1.0-pre.9] — 2026-07-21

### Added
- **Last-modified timestamps in the SFTP file manager.** Both local and remote listings now show each file's modification date, making it easier to spot recent changes at a glance.

---

## [0.1.0-pre.8] — 2026-07-18

**Cloud sync goes live.**

### Added
- **Real Google Drive sync.** Push and Pull your settings and vault as an **end-to-end encrypted** backup stored in the app's private Drive folder (`appDataFolder`), with silent token refresh so you rarely have to sign in again.
- **Account & profile UI.** A profile card shows your connected Google account, with a one-click logout.
- Refreshed, global (English) README for the project.

---

## [0.1.0-pre.7] — 2026-07-18

### Fixed
- **Google login now works in release builds.** The OAuth client secret is wired through the CI pipeline so sign-in functions in published releases, not just local dev builds.

---

## [0.1.0-pre.6] — 2026-07-16

### Fixed
- Resolved Rust compilation errors in the cloud-sync and SFTP modules.
- Migrated the encryption code to the **`aes-gcm` 0.11** API and replaced `rand` with `getrandom` for more reliable cross-platform builds.

*(Maintenance release — stabilizes the groundwork shipped in pre.5.)*

---

## [0.1.0-pre.5] — 2026-07-16

### Added
- **Google Drive cloud sync (initial integration)** — the foundation for backing up and syncing configuration across devices.
- **Advanced SFTP file operations** — richer right-click actions in the file manager (compress/extract ZIP, checksum, and more).
- Windows build workflow in CI.

---

## [0.1.0-pre.4] — 2026-07-16

### Added
- **Serial and Telnet profiles.** Serial and Telnet connections can now be saved as profiles (previously quick-connect only), so recurring devices and hosts are one click away.

---

## [0.1.0-pre.3] — 2026-07-15

### Fixed
- **Linux builds fixed** by installing `libudev-dev` in CI (required by serial-port support).
- Release workflow now **publishes** the GitHub Release directly instead of leaving it as a draft.

*(Re-release of pre.2 with working Linux artifacts.)*

---

## [0.1.0-pre.2] — 2026-07-15

**A major feature release.**

### Added
- **Silent auto-update** via GitHub Releases — the app keeps itself current with no manual reinstalls.
- **Settings: Application & Appearance panels** (Tabby-style) for a more polished configuration experience.
- **Split panes** — run multiple sessions side by side in one tab, with resizable dividers.
- **SSH auto-reconnect** and a mobile-ready core (platform features gated for desktop vs. mobile).
- **Android project** initialized with **signed release APK** build setup.
- **Serial (desktop) and Telnet transports.**
- **SSH port forwarding** — **Local (`-L`)** and **Dynamic / SOCKS5 (`-D`)**.
- A larger, refined app icon.

### Changed
- **License changed from MIT to Proprietary** (all rights reserved).
- Removed third-party references from the documentation.

---

## [0.1.0-pre.1] — 2026-07-14

**First tagged pre-release — the foundation.**

### Added
- **Cross-platform terminal core** built on Tauri 2 + Rust + xterm.js.
  - **Local shell (PTY)** on desktop (PowerShell / CMD / your `$SHELL`).
  - **SSH client** (via `russh`) with **password and private-key** authentication.
- **Multi-tab sessions** with a custom **frameless title bar** and window controls; tabs stay alive when you switch between them.
- **Connection profiles** + a **Settings page** with an SSH profile editor.
- **Multiple built-in themes** and a themeable app chrome.
- **SSH host-key verification (TOFU)** — new hosts prompt with their SHA-256 fingerprint; changed keys are rejected to guard against MITM.
- **CI release workflow** (GitHub Actions) producing Windows, macOS, and Linux artifacts.

---

[0.1.0-pre.13]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.13
[0.1.0-pre.12]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.12
[0.1.0-pre.11]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.11
[0.1.0-pre.10]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.10
[0.1.0-pre.9]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.9
[0.1.0-pre.8]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.8
[0.1.0-pre.7]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.7
[0.1.0-pre.6]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.6
[0.1.0-pre.5]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.5
[0.1.0-pre.4]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.4
[0.1.0-pre.3]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.3
[0.1.0-pre.2]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.2
[0.1.0-pre.1]: https://github.com/oktajianto/Moorix/releases/tag/v0.1.0-pre.1

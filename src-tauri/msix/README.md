# MSIX packaging (Microsoft Store) — Fase 25

Moorix ships to the Microsoft Store as an **MSIX** so the installer is no longer
flagged by SmartScreen / Smart App Control. Tauri v2 does not emit MSIX, so we
build the Win32 exe and package it afterwards with the Windows SDK `makeappx`.

Files here:

- `AppxManifest.template.xml` — the package manifest, with `{{TOKENS}}` that the
  pack script fills in. Edit this, never the generated copy.

The packaging script lives at [`../../scripts/pack-msix.ps1`](../../scripts/pack-msix.ps1).

## Quick start (local test package)

```powershell
# Build + pack + self-sign + install for local testing:
powershell -ExecutionPolicy Bypass -File scripts/pack-msix.ps1 -Sign -Install
```

To install a self-signed package you must trust its test certificate **once, as
Administrator**: the script exports `moorix-test.cer` into `src-tauri/target/msix/`
— import it into **Local Machine → Trusted People**, then run with `-Install`.

Skip the rebuild if `moorix.exe` already exists:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/pack-msix.ps1 -SkipBuild
```

## Store submission build (Fase 25C)

For a real submission you do **not** sign the package yourself — the Store signs
it. Pass the identity values from **Partner Center → Product → Product identity**:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/pack-msix.ps1 `
  -IdentityName "1234Publisher.Moorix" `
  -Publisher "CN=ABCDEF12-3456-7890-...." `
  -PublisherDisplay "Your Publisher Name" `
  -Version 1.0.0.0
```

Then upload `src-tauri/target/msix/Moorix-<version>.msix` in a new submission.

## Prerequisites

- **Windows 10/11 SDK** (provides `makeappx.exe` and `signtool.exe`).
- `pnpm` + the Tauri toolchain (already required to build Moorix).

## Status / TODO (see IMPLEMENTATION_PLAN.md §25)

- **25A ✅** — packaging pipeline (this folder + script) produces an installable `.msix`.
- **25B-1 ✅** — `msstore` Cargo feature: in-app updater disabled + its UI hidden
  (`is_store_build` command / `src/appFlavor.ts`). The pack script builds with
  `--features msstore`.
- **25B-2 ✅** — "Run at startup" toggles the manifest `StartupTask` via WinRT
  (`src-tauri/src/win_startup.rs`, `src/autostart.ts`).
- **25C ⬜** — native testing with the real Partner Center identity.
- **25D ⬜** — submit & certification.

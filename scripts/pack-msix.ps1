<#
.SYNOPSIS
  Package Moorix (Tauri build) into an MSIX for the Microsoft Store (Fase 25).

.DESCRIPTION
  Tauri v2 does not emit MSIX natively, so this script does it post-build:
    1. Build the Win32 exe   (pnpm tauri build --no-bundle)  unless -SkipBuild
    2. Assemble a packaging layout (exe + Assets + AppxManifest.xml)
    3. makeappx pack  ->  Moorix.msix
    4. (optional) self-sign + install for LOCAL testing only (-Sign / -Install)

  For a real Store submission you upload the UNSIGNED .msix - the Store signs it.
  The identity defaults below are placeholders for local testing; pass the real
  Partner Center values (-IdentityName / -Publisher / -PublisherDisplay) for a
  submission build (Fase 25C).

.EXAMPLE
  # Local test package (build + pack + self-sign + install):
  pwsh -File scripts/pack-msix.ps1 -Sign -Install

.EXAMPLE
  # Store submission package (identity from Partner Center, unsigned):
  pwsh -File scripts/pack-msix.ps1 -IdentityName "1234Publisher.Moorix" `
       -Publisher "CN=ABCDEF12-3456-..." -PublisherDisplay "Your Name" -Version 1.0.0.0
#>
[CmdletBinding()]
param(
  [string]$Version,
  [string]$IdentityName,
  [string]$Publisher,
  [string]$PublisherDisplay,
  [switch]$SkipBuild,
  [switch]$Sign,
  [switch]$Install
)

$ErrorActionPreference = "Stop"

# --- Paths -------------------------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$TauriDir  = Join-Path $RepoRoot "src-tauri"
$MsixSrc   = Join-Path $TauriDir "msix"
$IconsDir  = Join-Path $TauriDir "icons"
$Template  = Join-Path $MsixSrc  "AppxManifest.template.xml"
$OutDir    = Join-Path $TauriDir "target\msix"
$LayoutDir = Join-Path $OutDir   "layout"
$ExePath   = Join-Path $TauriDir "target\release\moorix.exe"

function Info($m) { Write-Host "[pack-msix] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[pack-msix] ERROR: $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $Template)) { Fail "Manifest template not found: $Template" }

# --- Identity: explicit params > store-identity.json (real Partner Center values,
#     Fase 25C) > local self-signed test defaults. -----------------------------
$identityFile = Join-Path $MsixSrc "store-identity.json"
$fileId = $null
if (Test-Path $identityFile) {
  try { $fileId = Get-Content $identityFile -Raw | ConvertFrom-Json } catch { $fileId = $null }
}
if (-not $IdentityName)     { $IdentityName     = if ($fileId) { $fileId.identityName }        else { "Moorix.Dev" } }
if (-not $Publisher)        { $Publisher        = if ($fileId) { $fileId.publisher }            else { "CN=Moorix Dev" } }
if (-not $PublisherDisplay) { $PublisherDisplay = if ($fileId) { $fileId.publisherDisplayName } else { "Moorix Dev" } }

# --- Version: read from tauri.conf.json, normalise to 4 parts (revision 0) ----
if (-not $Version) {
  $conf = Get-Content (Join-Path $TauriDir "tauri.conf.json") -Raw | ConvertFrom-Json
  $Version = $conf.version
}
$parts = @($Version -split '\.')
while ($parts.Count -lt 4) { $parts += '0' }
if ($parts.Count -gt 4) { $parts = $parts[0..3] }
# Store requires the 4th (revision) part to be 0.
$parts[3] = '0'
$Version4 = ($parts -join '.')
Info "Version : $Version4"
Info "Identity: $IdentityName  |  Publisher: $Publisher"

# --- Locate Windows SDK tools (makeappx / signtool) --------------------------
function Find-SdkTool($name) {
  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
  ) | Where-Object { $_ -and (Test-Path $_) }
  $hits = foreach ($r in $roots) {
    Get-ChildItem -Path $r -Recurse -Filter $name -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' }
  }
  $hits | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}

$MakeAppx = Find-SdkTool "makeappx.exe"
if (-not $MakeAppx) { Fail "makeappx.exe not found. Install the Windows 10/11 SDK (Windows Kits\10\bin\...\x64)." }
Info "makeappx: $MakeAppx"

# --- 1. Build ----------------------------------------------------------------
if ($SkipBuild) {
  Info "Skipping build (-SkipBuild). Using existing $ExePath"
  if (-not (Test-Path $ExePath)) { Fail "Exe not found and -SkipBuild set: $ExePath" }
} else {
  # Build the Store variant: `msstore` disables the in-app updater (Fase 25B).
  Info "Building (pnpm tauri build --no-bundle --features msstore) ..."
  Push-Location $RepoRoot
  try {
    & pnpm tauri build --no-bundle --features msstore
    if ($LASTEXITCODE -ne 0) { Fail "tauri build failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
  if (-not (Test-Path $ExePath)) { Fail "Build finished but exe missing: $ExePath" }
}

# --- 2. Assemble layout ------------------------------------------------------
if (Test-Path $LayoutDir) { Remove-Item $LayoutDir -Recurse -Force }
New-Item -ItemType Directory -Path $LayoutDir -Force | Out-Null
$AssetsDir = Join-Path $LayoutDir "Assets"
New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null

Copy-Item $ExePath (Join-Path $LayoutDir "moorix.exe") -Force

$assets = @(
  "StoreLogo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square150x150Logo.png",
  "Square310x310Logo.png"
)
foreach ($a in $assets) {
  $src = Join-Path $IconsDir $a
  if (-not (Test-Path $src)) { Fail "Asset missing: $src" }
  Copy-Item $src (Join-Path $AssetsDir $a) -Force
}

# Manifest: replace tokens -> layout\AppxManifest.xml
$manifest = [System.IO.File]::ReadAllText($Template)
$manifest = $manifest.Replace("{{IDENTITY_NAME}}",     $IdentityName)
$manifest = $manifest.Replace("{{PUBLISHER}}",         $Publisher)
$manifest = $manifest.Replace("{{PUBLISHER_DISPLAY}}", $PublisherDisplay)
$manifest = $manifest.Replace("{{VERSION}}",           $Version4)
$ManifestOut = Join-Path $LayoutDir "AppxManifest.xml"
# MSIX manifest must be UTF-8 without BOM.
[System.IO.File]::WriteAllText($ManifestOut, $manifest, (New-Object System.Text.UTF8Encoding($false)))
Info "Layout assembled: $LayoutDir"

# --- 3. Pack -----------------------------------------------------------------
$MsixOut = Join-Path $OutDir "Moorix-$Version4.msix"
if (Test-Path $MsixOut) { Remove-Item $MsixOut -Force }
Info "Packing -> $MsixOut"
& $MakeAppx pack /o /d $LayoutDir /p $MsixOut
if ($LASTEXITCODE -ne 0) { Fail "makeappx pack failed (exit $LASTEXITCODE)" }
Info "MSIX created: $MsixOut"

# --- 4. (optional) self-sign + install for LOCAL testing ---------------------
if ($Sign -or $Install) {
  $SignTool = Find-SdkTool "signtool.exe"
  if (-not $SignTool) { Fail "signtool.exe not found (needed for -Sign)." }

  Info "Creating/using self-signed cert with subject: $Publisher"
  $cert = Get-ChildItem Cert:\CurrentUser\My |
            Where-Object { $_.Subject -eq $Publisher } |
            Select-Object -First 1
  if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher `
      -KeyUsage DigitalSignature -FriendlyName "Moorix MSIX test" `
      -CertStoreLocation "Cert:\CurrentUser\My" `
      -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
  }
  $pfx  = Join-Path $OutDir "moorix-test.pfx"
  $pass = ConvertTo-SecureString -String "moorix" -Force -AsPlainText
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pass | Out-Null

  Info "Signing MSIX ..."
  & $SignTool sign /fd SHA256 /a /f $pfx /p "moorix" $MsixOut
  if ($LASTEXITCODE -ne 0) { Fail "signtool sign failed (exit $LASTEXITCODE)" }
  Info "Signed."

  $cer = Join-Path $OutDir "moorix-test.cer"
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Info "Public cert exported: $cer"
  Write-Host ""
  Write-Host "To trust the test cert (run once, as Administrator):" -ForegroundColor Yellow
  Write-Host "  Import-Certificate -FilePath `"$cer`" -CertStoreLocation Cert:\LocalMachine\TrustedPeople" -ForegroundColor Yellow

  if ($Install) {
    Info "Installing MSIX (Add-AppxPackage) ..."
    try {
      Add-AppxPackage -Path $MsixOut
      Info "Installed. Launch 'Moorix' from Start."
    } catch {
      Fail "Add-AppxPackage failed: $($_.Exception.Message)`nMost likely the test cert is not trusted yet - import '$cer' into LocalMachine\TrustedPeople (admin) and retry."
    }
  }
}

Write-Host ""
Info "Done. Output: $MsixOut"

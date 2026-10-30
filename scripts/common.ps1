# Paths and helpers shared by the Windows scripts (the counterpart of common.sh). Platform-specific details
# live in scripts/platform/windows.ps1. ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ROOT = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Firefox build language (any Mozilla locale code, e.g. en-US, de, ja).
$LOCALE = if ($env:SILLAGE_LOCALE) { $env:SILLAGE_LOCALE } else { "en-US" }

# Defines $FF_BIN, $GRE_DIR (where the loader goes), $PROFILE_DIR, $FF_URL, $POLICIES and the functions
# Find-SystemFirefox, Expand-Firefox, Register-App, Start-App, Set-DefaultBrowser, Unregister-App.
. (Join-Path $ROOT "scripts\platform\windows.ps1")

# Gets Firefox without installing it system-wide. An existing Firefox is copied (no download); -Fresh, used by
# `update`, downloads the latest release instead.
function Get-Firefox([switch]$Fresh) {
  if (-not $Fresh) {
    $existing = Find-SystemFirefox
    if ($existing) {
      Write-Host "Using the Firefox already installed at $existing (no download)..."
      Install-FirefoxFiles $existing
      return
    }
  }
  Write-Host "Downloading Firefox ($LOCALE)..."
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("sillage-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $installer = Join-Path $tmp "firefox-setup.exe"
    Invoke-WebRequest -UseBasicParsing -Uri $FF_URL -OutFile $installer
    Expand-Firefox $installer $tmp
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Copies the Sillage loader and enterprise policies into Firefox.
function Install-Loader {
  New-Item -ItemType Directory -Force -Path "$GRE_DIR\defaults\pref", "$GRE_DIR\distribution" | Out-Null
  Copy-Item (Join-Path $ROOT "firefox\config.js") "$GRE_DIR\config.js" -Force
  Copy-Item (Join-Path $ROOT "firefox\defaults\pref\sillage-prefs.js") "$GRE_DIR\defaults\pref\sillage-prefs.js" -Force
  Copy-Item $POLICIES "$GRE_DIR\distribution\policies.json" -Force
}

function Test-SameFile($a, $b) {
  (Test-Path $a) -and (Test-Path $b) -and ((Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash)
}

function Test-LoaderUpToDate {
  (Test-SameFile (Join-Path $ROOT "firefox\config.js") "$GRE_DIR\config.js") -and
  (Test-SameFile (Join-Path $ROOT "firefox\defaults\pref\sillage-prefs.js") "$GRE_DIR\defaults\pref\sillage-prefs.js") -and
  (Test-SameFile $POLICIES "$GRE_DIR\distribution\policies.json")
}

# The profile's chrome folder is a junction (no administrator rights, unlike a symlink) to the repository:
# editing profile\chrome changes the interface. user.js is copied, and refreshed at every launch.
function Update-Profile {
  New-Item -ItemType Directory -Force -Path $PROFILE_DIR | Out-Null
  $chrome = Join-Path $PROFILE_DIR "chrome"
  $item = Get-Item $chrome -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType -ne "Junction") { Move-Item $chrome "$chrome.bak" -Force; $item = $null }
  if (-not $item) { New-Item -ItemType Junction -Path $chrome -Target (Join-Path $ROOT "profile\chrome") | Out-Null }
  Copy-Item (Join-Path $ROOT "profile\user.js") (Join-Path $PROFILE_DIR "user.js") -Force
}

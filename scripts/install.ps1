# Installs Sillage for the current user (no administrator rights needed).
# An existing Firefox is reused (copied, not downloaded). -Update downloads the latest Firefox release again.
param([switch]$Update)
. (Join-Path $PSScriptRoot "common.ps1")

if ($Update -and (Test-FirefoxRunning)) {
  Write-Error "Sillage is running: quit it (Ctrl+Q) before updating Firefox."
}
if ($Update -or -not (Test-Path $FF_BIN)) { Get-Firefox -Fresh:$Update }
Install-Loader
Update-Profile
Register-App
Write-Host "Sillage installed: start it from the Start Menu, or run ``sillage launch``."

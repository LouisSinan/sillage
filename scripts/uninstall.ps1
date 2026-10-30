# Removes the app and its Firefox copy; the profile (tabs, workspaces, passwords) is kept.
. (Join-Path $PSScriptRoot "common.ps1")
if (Test-FirefoxRunning) { Write-Error "Sillage is running: quit it (Ctrl+Q) first." }
Unregister-App
Write-Host "Sillage uninstalled. Profile kept at: $PROFILE_DIR"

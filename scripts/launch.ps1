# Starts Sillage. Extra arguments go to Firefox (e.g. a URL, --private-window).
param([Parameter(ValueFromRemainingArguments = $true)] $Rest)
. (Join-Path $PSScriptRoot "common.ps1")
if (-not (Test-Path $FF_BIN)) { Write-Error "Sillage is not installed: run ``sillage install``." }
# A Firefox update may remove the loader: put it back. Pick up edits of user.js too.
if (-not (Test-LoaderUpToDate)) { Install-Loader }
Update-Profile
Start-App @($Rest)

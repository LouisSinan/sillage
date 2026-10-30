# The Windows counterpart of the Makefile: `sillage <command>` (see sillage.cmd).
param([string]$Command = "", [Parameter(ValueFromRemainingArguments = $true)] $Rest)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path $here -Parent
if (-not $Command) {
  # Double-click: install the first time, then start.
  . (Join-Path $here "common.ps1")
  if (-not (Test-Path $FF_BIN)) { & (Join-Path $here "install.ps1") }
  $Command = "launch"
}
switch ($Command) {
  "install"   { & (Join-Path $here "install.ps1") }
  "launch"    { & (Join-Path $here "launch.ps1") @($Rest) }
  "default"   { & (Join-Path $here "default.ps1") }
  "update"    { try { git -C $root pull --ff-only } catch {}; & (Join-Path $here "install.ps1") -Update }
  "test"      { & (Join-Path $root "tests\run.ps1") @($Rest) }
  "uninstall" { & (Join-Path $here "uninstall.ps1") }
  default     { Write-Host "Usage: sillage [install|launch|default|update|test|uninstall]"; exit 1 }
}

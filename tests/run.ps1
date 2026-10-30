# Runs the test suite inside a headless Firefox on a throwaway profile (no window is shown).
# $env:SILLAGE_TEST=<file.js> runs another script instead; $env:SILLAGE_TEST_PREFS adds user.js lines;
# the first argument is the directory to copy screenshots (*.png) to.
param([string]$Out = $env:TEMP)
. (Join-Path $PSScriptRoot "..\scripts\common.ps1")
if (-not (Test-Path $FF_BIN)) { Write-Error "Firefox not found: run ``sillage install`` first." }
if (-not (Test-LoaderUpToDate)) { Install-Loader }

# The profile lives in its own temporary "home": Sillage looks for older separate profiles next to it.
$home_dir = Join-Path ([IO.Path]::GetTempPath()) ("sillage-test-" + [Guid]::NewGuid().ToString("N"))
$prof = Join-Path $home_dir "profile"
New-Item -ItemType Directory -Force -Path "$prof\chrome" | Out-Null
Copy-Item "$ROOT\profile\chrome\*" "$prof\chrome" -Recurse -Force
$suite = if ($env:SILLAGE_TEST) { $env:SILLAGE_TEST } else { Join-Path $ROOT "tests\suite.js" }
Copy-Item $suite "$prof\chrome\debug.js" -Force
Copy-Item "$ROOT\profile\user.js" "$prof\user.js"
# Throwaway profile: skip the terms-of-use dialog (it blocks tab switching).
Add-Content "$prof\user.js" 'user_pref("termsofuse.bypassNotification", true);'
if ($env:SILLAGE_TEST_PREFS) { Add-Content "$prof\user.js" $env:SILLAGE_TEST_PREFS }

$env:MOZ_HEADLESS = "1"; $env:MOZ_HEADLESS_WIDTH = "1400"; $env:MOZ_HEADLESS_HEIGHT = "900"
$p = Start-Process -FilePath $FF_BIN -ArgumentList @("--no-remote", "--profile", "`"$prof`"", "about:blank") -PassThru
if (-not $p.WaitForExit(120000)) { $p.Kill() }

$log = Join-Path $prof "sillage.log"
Get-Content $log
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Get-ChildItem "$prof\*.png" -ErrorAction SilentlyContinue | Copy-Item -Destination $Out -Force
if (Test-Path "$prof\capture.png") { Copy-Item "$prof\capture.png" (Join-Path $Out "sillage-capture.png") -Force }
$ok = Select-String -Path $log -Pattern "DONE: .* 0 failed" -Quiet
Remove-Item $home_dir -Recurse -Force -ErrorAction SilentlyContinue
if (-not $ok) { exit 1 }

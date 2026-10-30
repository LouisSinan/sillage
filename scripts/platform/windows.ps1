# Windows: a private copy of Firefox in %LOCALAPPDATA%\Sillage (no administrator rights needed), a Start Menu
# shortcut with its own icon, and a registration under "Default apps". Dot-sourced by common.ps1.
$APP_HOME = Join-Path $env:LOCALAPPDATA "Sillage"
$FF_DIR   = Join-Path $APP_HOME "firefox"
$FF_BIN   = Join-Path $FF_DIR "firefox.exe"
$GRE_DIR  = $FF_DIR
$PROFILE_DIR = Join-Path $env:APPDATA "Sillage\Profile"
$FF_URL   = "https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=$LOCALE"
# Same policies as macOS: a copied Firefox cannot update itself, `sillage update` does it instead.
$POLICIES = Join-Path $ROOT "firefox\policies-windows.json"
$ICON     = Join-Path $APP_HOME "sillage.ico"
$SHORTCUT = Join-Path ([Environment]::GetFolderPath("Programs")) "Sillage.lnk"
$REG_APP  = "HKCU:\Software\Clients\StartMenuInternet\Sillage"

# The Firefox already installed on this machine (any channel-less install), or $null.
function Find-SystemFirefox {
  $candidates = @()
  foreach ($hive in "HKLM:", "HKCU:") {
    $p = (Get-ItemProperty "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe" -ErrorAction SilentlyContinue)."(default)"
    if ($p) { $candidates += $p }
  }
  foreach ($base in $env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs") {
    if ($base) { $candidates += Join-Path $base "Mozilla Firefox\firefox.exe" }
  }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c) -and ((Split-Path $c -Parent) -ne $FF_DIR)) { return Split-Path $c -Parent }
  }
  return $null
}

function Install-FirefoxFiles($src) {
  New-Item -ItemType Directory -Force -Path $APP_HOME | Out-Null
  if (Test-Path $FF_DIR) { Remove-Item $FF_DIR -Recurse -Force }
  Copy-Item $src $FF_DIR -Recurse -Force
}

# Extracts the Firefox installer without installing it (no registry entries, no administrator rights).
function Expand-Firefox($installer, $tmp) {
  $out = Join-Path $tmp "extract"
  Start-Process -FilePath $installer -ArgumentList "/ExtractDir=`"$out`"" -Wait | Out-Null
  $src = @("$out\core", $out) | Where-Object { Test-Path "$_\firefox.exe" } | Select-Object -First 1
  if (-not $src) { throw "Could not extract Firefox from $installer" }
  Install-FirefoxFiles $src
}

function Test-FirefoxRunning {
  [bool](Get-Process firefox -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $FF_BIN })
}

# Creates sillage.ico (a PNG-compressed icon, supported since Windows Vista) from assets\icon-1024.png.
function New-Icon {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Image]::FromFile((Join-Path $ROOT "assets\icon-1024.png"))
  $bmp = New-Object System.Drawing.Bitmap 256, 256
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, 256, 256)
  $g.Dispose(); $src.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $png = $ms.ToArray()
  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $out
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)            # ICONDIR: one image
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0) # 256x256 (0), no palette
  $w.Write([uint16]1); $w.Write([uint16]32)                                  # planes, bits per pixel
  $w.Write([uint32]$png.Length); $w.Write([uint32]22)                        # size, offset
  $w.Write($png)
  $w.Flush()
  [System.IO.File]::WriteAllBytes($ICON, $out.ToArray())
}

# The command line that starts Sillage; $extra goes at the end (e.g. -osint -url "%1").
function Get-LaunchCommand($extra = "") {
  "`"$FF_BIN`" --profile `"$PROFILE_DIR`" --name sillage $extra".Trim()
}

function Set-RegKey($path, $default, $values = @{}) {
  New-Item -Path $path -Force -Value $default | Out-Null
  foreach ($k in $values.Keys) { Set-ItemProperty -Path $path -Name $k -Value $values[$k] }
}

function Register-App {
  New-Icon
  # Start Menu shortcut straight to firefox.exe: the taskbar groups the windows under the Sillage icon.
  $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($SHORTCUT)
  $sh.TargetPath = $FF_BIN
  $sh.Arguments = "--profile `"$PROFILE_DIR`" --name sillage"
  $sh.WorkingDirectory = $FF_DIR
  $sh.IconLocation = "$ICON,0"
  $sh.Description = "Arc-style browser built on Firefox"
  $sh.Save()

  # "Default apps": file and link handlers, then the browser entry that lists them.
  $open = Get-LaunchCommand '-osint -url "%1"'
  Set-RegKey "HKCU:\Software\Classes\SillageHTML" "Sillage HTML Document" @{}
  Set-RegKey "HKCU:\Software\Classes\SillageHTML\DefaultIcon" "$ICON,0"
  Set-RegKey "HKCU:\Software\Classes\SillageHTML\shell\open\command" $open
  Set-RegKey "HKCU:\Software\Classes\SillageURL" "Sillage URL" @{ "URL Protocol" = "" }
  Set-RegKey "HKCU:\Software\Classes\SillageURL\DefaultIcon" "$ICON,0"
  Set-RegKey "HKCU:\Software\Classes\SillageURL\shell\open\command" $open
  Set-RegKey $REG_APP "Sillage"
  Set-RegKey "$REG_APP\DefaultIcon" "$ICON,0"
  Set-RegKey "$REG_APP\shell\open\command" (Get-LaunchCommand)
  Set-RegKey "$REG_APP\Capabilities" "" @{ ApplicationName = "Sillage"; ApplicationIcon = "$ICON,0"; ApplicationDescription = "Arc-style browser built on Firefox" }
  Set-RegKey "$REG_APP\Capabilities\FileAssociations" "" @{ ".htm" = "SillageHTML"; ".html" = "SillageHTML"; ".xhtml" = "SillageHTML" }
  Set-RegKey "$REG_APP\Capabilities\URLAssociations" "" @{ http = "SillageURL"; https = "SillageURL" }
  New-Item -Path "HKCU:\Software\RegisteredApplications" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\RegisteredApplications" -Name "Sillage" -Value "Software\Clients\StartMenuInternet\Sillage\Capabilities"
}

function Start-App($rest = @()) {
  $quoted = $rest | ForEach-Object { if ($_ -match "\s") { "`"$_`"" } else { $_ } }
  $argList = @("--profile", "`"$PROFILE_DIR`"", "--name", "sillage") + @($quoted)
  Start-Process -FilePath $FF_BIN -ArgumentList $argList
}

function Set-DefaultBrowser {
  # Windows does not let programs choose the default browser: open the page where the user does.
  Write-Host "Windows asks for confirmation: Settings > Apps > Default apps > Sillage"
  Start-Process "ms-settings:defaultapps"
}

function Unregister-App {
  Remove-Item $SHORTCUT -Force -ErrorAction SilentlyContinue
  foreach ($k in "HKCU:\Software\Classes\SillageHTML", "HKCU:\Software\Classes\SillageURL", $REG_APP) {
    Remove-Item $k -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-ItemProperty -Path "HKCU:\Software\RegisteredApplications" -Name "Sillage" -ErrorAction SilentlyContinue
  if (Test-Path $APP_HOME) { Remove-Item $APP_HOME -Recurse -Force }
}

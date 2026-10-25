# macOS: ~/Applications/Sillage.app is the official Firefox, renamed and loaded with the Sillage interface.
APP="$HOME/Applications/Sillage.app"
FF_BIN="$APP/Contents/MacOS/firefox"
GRE_DIR="$APP/Contents/Resources"
PROFILE="$HOME/Library/Application Support/Sillage/Profile"
FF_URL="https://download.mozilla.org/?product=firefox-latest-ssl&os=osx&lang=$LOCALE"
BUNDLE_ID="io.github.louissinan.sillage"

extract_firefox() {
  hdiutil attach -nobrowse -quiet -mountpoint "$2/mnt" "$1"
  mkdir -p "$(dirname "$APP")"
  rm -rf "$APP.new"
  ditto "$2/mnt/Firefox.app" "$APP.new"
  hdiutil detach -quiet "$2/mnt"
  rm -rf "$APP"
  mv "$APP.new" "$APP"
}

register_app() {
  # A modified Firefox bundle cannot update itself: `make update` does it instead
  # (Sillage shows a notice when a new Firefox release is out).
  mkdir -p "$GRE_DIR/distribution"
  cp "$ROOT/firefox/policies.json" "$GRE_DIR/distribution/policies.json"

  local work iconset s
  work="$(mktemp -d)"
  iconset="$work/sillage.iconset"
  mkdir -p "$iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ROOT/assets/icon-1024.png" --out "$iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$ROOT/assets/icon-1024.png" --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$GRE_DIR/sillage.icns"
  rm -rf "$work"

  # App identity: name, icon, a bundle id distinct from Firefox, and a dedicated profile.
  local pl="$APP/Contents/Info.plist"
  pb() { /usr/libexec/PlistBuddy -c "$1" "$pl" 2>/dev/null || true; }
  pb "Delete :CFBundleName";        pb "Add :CFBundleName string Sillage"
  pb "Delete :CFBundleDisplayName"; pb "Add :CFBundleDisplayName string Sillage"
  pb "Delete :CFBundleIdentifier";  pb "Add :CFBundleIdentifier string $BUNDLE_ID"
  pb "Delete :CFBundleIconName"
  pb "Delete :CFBundleIconFile";    pb "Add :CFBundleIconFile string sillage.icns"
  pb "Delete :LSEnvironment";       pb "Add :LSEnvironment dict"
  pb "Add :LSEnvironment:XRE_PROFILE_PATH string $PROFILE"

  # The bundle was modified: re-sign it ad hoc so macOS accepts to launch it.
  xattr -cr "$APP"
  codesign --force --deep --sign - "$APP" 2>/dev/null
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" || true
  touch "$APP"
}

launch_app() { open "$APP" --args "$@"; }

set_default() {
  echo "macOS asks for confirmation: System Settings → Desktop & Dock → Default web browser → Sillage"
  open "x-apple.systempreferences:com.apple.Desktop-Settings.extension" || true
}

unregister_app() { rm -rf "$APP"; }

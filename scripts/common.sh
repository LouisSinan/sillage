# Paths and helpers shared by all scripts. Platform-specific details live in
# scripts/platform/<linux|macos>.sh.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

case "$(uname -s)" in
  Darwin) PLATFORM=macos ;;
  Linux)  PLATFORM=linux ;;
  *) echo "Unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac

# Firefox build language (any Mozilla locale code, e.g. en-US, de, ja).
LOCALE="${SILLAGE_LOCALE:-en-US}"

# Defines FF_BIN, GRE_DIR (where the loader goes), PROFILE, FF_URL and the functions
# extract_firefox, register_app, launch_app, set_default, unregister_app.
source "$ROOT/scripts/platform/$PLATFORM.sh"

# Downloads the latest Firefox release.
download_firefox() {
  echo "Downloading Firefox ($LOCALE)…"
  local tmp
  tmp="$(mktemp -d)"
  curl -fL --progress-bar -o "$tmp/firefox.pkg" "$FF_URL"
  extract_firefox "$tmp/firefox.pkg" "$tmp"
  rm -rf "$tmp"
}

# Copies the Sillage loader into Firefox (a Firefox update may remove it).
install_loader() {
  cp "$ROOT/firefox/config.js" "$GRE_DIR/config.js"
  mkdir -p "$GRE_DIR/defaults/pref"
  cp "$ROOT/firefox/defaults/pref/sillage-prefs.js" "$GRE_DIR/defaults/pref/sillage-prefs.js"
}

loader_up_to_date() {
  cmp -s "$ROOT/firefox/config.js" "$GRE_DIR/config.js" &&
    cmp -s "$ROOT/firefox/defaults/pref/sillage-prefs.js" "$GRE_DIR/defaults/pref/sillage-prefs.js"
}

# The profile links back to the repository: editing profile/chrome changes the interface.
link_profile() {
  mkdir -p "$PROFILE"
  if [ -e "$PROFILE/chrome" ] && [ ! -L "$PROFILE/chrome" ]; then mv "$PROFILE/chrome" "$PROFILE/chrome.bak"; fi
  ln -sfn "$ROOT/profile/chrome" "$PROFILE/chrome"
  ln -sf "$ROOT/profile/user.js" "$PROFILE/user.js"
}

# Linux: Firefox lives in ~/.local/opt (it updates itself there); a .desktop entry registers the app.
FF_DIR="$HOME/.local/opt/sillage-firefox"
FF_BIN="$FF_DIR/firefox"
GRE_DIR="$FF_DIR"
PROFILE="$HOME/.local/share/sillage/profile"
FF_URL="https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=$LOCALE"
DESKTOP="$HOME/.local/share/applications/sillage.desktop"
ICON="$HOME/.local/share/icons/hicolor/scalable/apps/sillage.svg"

extract_firefox() {
  tar -xf "$1" -C "$2"
  mkdir -p "$(dirname "$FF_DIR")"
  rm -rf "$FF_DIR"
  mv "$2/firefox" "$FF_DIR"
}

register_app() {
  mkdir -p "$HOME/.local/bin" "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
  ln -sf "$ROOT/bin/sillage" "$HOME/.local/bin/sillage"
  cp "$ROOT/assets/icon.svg" "$ICON"
  cat > "$DESKTOP" <<DESK
[Desktop Entry]
Name=Sillage
GenericName=Web Browser
Comment=Arc-style browser built on Firefox
Exec=$ROOT/bin/sillage %u
Icon=sillage
Terminal=false
Type=Application
Categories=Network;WebBrowser;
MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=sillage
Actions=private;
[Desktop Action private]
Name=New Private Window
Exec=$ROOT/bin/sillage --private-window %u
DESK
  update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
  gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
}

launch_app() { nohup "$ROOT/bin/sillage" "$@" >/dev/null 2>&1 & }

set_default() {
  # A $BROWSER variable (set by some desktops) blocks xdg-settings; ignore it for this call.
  env -u BROWSER xdg-settings set default-web-browser sillage.desktop
  xdg-mime default sillage.desktop text/html application/xhtml+xml x-scheme-handler/http x-scheme-handler/https x-scheme-handler/about
  echo "Sillage is now the default browser."
}

unregister_app() {
  rm -f "$DESKTOP" "$ICON" "$HOME/.local/bin/sillage"
  rm -rf "$FF_DIR"
  update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
}

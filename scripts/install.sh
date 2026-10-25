#!/bin/bash
# Installs Sillage for the current user (no root needed).
# --update downloads the latest Firefox release again.
set -euo pipefail
source "$(dirname "$0")/common.sh"

if [ ! -x "$FF_BIN" ] || [ "${1:-}" = "--update" ]; then
  if ps -eo args | grep -q "^$FF_BIN"; then
    echo "Sillage is running: quit it (Ctrl+Q / ⌘Q) before updating Firefox." >&2
    exit 1
  fi
  download_firefox
fi
install_loader
link_profile
register_app
echo "Sillage installed: start it from your app launcher, or run \`make launch\`."

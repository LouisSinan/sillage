#!/bin/bash
# Removes the app and its Firefox copy; the profile (tabs, workspaces, passwords) is kept.
set -euo pipefail
source "$(dirname "$0")/common.sh"
unregister_app
echo "Sillage uninstalled. Profile kept at: $PROFILE"

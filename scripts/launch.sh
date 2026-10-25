#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
[ -x "$FF_BIN" ] || { echo "Sillage is not installed: run \`make install\`." >&2; exit 1; }
launch_app "$@"

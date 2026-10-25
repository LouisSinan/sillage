#!/bin/bash
# Runs the test suite inside a headless Firefox on a throwaway profile (no window is shown).
# SILLAGE_TEST=<file.js> runs another script instead; $1 = directory to copy the screenshot to.
source "$(dirname "$0")/../scripts/common.sh"
[ -x "$FF_BIN" ] || { echo "Firefox not found: run \`make install\` first." >&2; exit 1; }
loader_up_to_date || install_loader

PROF="$(mktemp -d)"
mkdir -p "$PROF/chrome"
for f in "$ROOT"/profile/chrome/*; do ln -s "$f" "$PROF/chrome/"; done
ln -s "${SILLAGE_TEST:-$ROOT/tests/suite.js}" "$PROF/chrome/debug.js"
cp "$ROOT/profile/user.js" "$PROF/user.js"
# Throwaway profile: skip the terms-of-use dialog (it blocks tab switching).
echo 'user_pref("termsofuse.bypassNotification", true);' >> "$PROF/user.js"

MOZ_HEADLESS=1 MOZ_HEADLESS_WIDTH=1400 MOZ_HEADLESS_HEIGHT=900 "$FF_BIN" --no-remote --profile "$PROF" about:blank >/dev/null 2>&1 &
pid=$!
( sleep 120; kill $pid 2>/dev/null ) &
watchdog=$!
wait $pid 2>/dev/null
kill $watchdog 2>/dev/null

cat "$PROF/sillage.log"
[ -f "$PROF/capture.png" ] && cp "$PROF/capture.png" "${1:-/tmp}/sillage-capture.png"
grep -q "DONE: .* 0 failed" "$PROF/sillage.log"; status=$?
rm -rf "$PROF"
exit $status

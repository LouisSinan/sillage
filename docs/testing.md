# Testing

## The suite

```sh
make test              # or tests/run.sh
```

`tests/run.sh` starts the installed Firefox **headless** (1400×900) on a throwaway profile in a temporary
directory, so it never touches your Sillage profile or your screen:

1. creates `<tmp>/profile`, symlinks `profile/chrome/*` into it and copies `profile/user.js`;
2. links the test script as `chrome/debug.js`; Sillage loads `chrome://sillage/content/debug.js` at the end of
   startup when that file exists;
3. waits for Firefox to quit (watchdog: 120 s), prints `sillage.log`, copies any `*.png` written to the
   profile, and succeeds only if the log contains `DONE: … 0 failed`.

`tests/suite.js` runs inside the browser window with chrome privileges. It reaches the internals through
`Sillage._t` and logs one `PASS` / `FAIL` line per check. Helpers at the top: `ok(cond, name, extra)`,
`until(fn, ms)` (poll a condition), `wait(ms)`, `keydown(opts)`, `xulKey(mods, key)`.

Some checks load real pages (`example.com`, `example.org`), so the suite needs network access.

## Writing tests

- Every behaviour change comes with checks in `tests/suite.js`, next to the related ones.
- Prefer `until()` to fixed waits; animations, page loads and Firefox's own DOM updates are asynchronous.
- Synthetic events are fine for chrome UI (`dispatchEvent(new MouseEvent(...))`, `DragEvent` with a
  `DataTransfer`). Clicks inside web pages cannot be synthesized from the suite; reproduce the path Firefox
  takes instead (for example `window.openLinkIn(url, "tab", { openerBrowser, ... })` for a link that opens a tab).
- Expose what a test needs through `Sillage._t` rather than reaching into the DOM structure.
- Clean up: close the tabs and remove the items a test creates, the suite runs in one session.

## Probes and screenshots

`SILLAGE_TEST=<file.js> tests/run.sh <dir>` runs another script instead of the suite, and copies the PNG
files it writes into `<dir>`. Useful for one-off investigations and screenshots:

```js
(async () => {
  const L = sillageLog, S = Sillage._t;
  await new Promise(r => setTimeout(r, 2500));
  const cv = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  cv.width = innerWidth; cv.height = innerHeight;
  cv.getContext("2d").drawWindow(window, 0, 0, cv.width, cv.height, "rgb(0,0,0)");
  const blob = await new Promise(r => cv.toBlob(r, "image/png"));
  await IOUtils.write(PathUtils.join(PathUtils.profileDir, "shot.png"), new Uint8Array(await blob.arrayBuffer()));
  L("DONE: 0 passed, 0 failed");
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
})();
```

`drawWindow` captures the interface but not web page content (pages render in other processes).
`SILLAGE_TEST_PREFS` adds `user.js` lines, for example `'user_pref("ui.systemUsesDarkTheme", 1);'`.

To read a Firefox source file from a probe: `await (await fetch("moz-src:///browser/components/…")).text()`.

## Before a pull request

- `make test` passes;
- the change was tried in a real Sillage window (restart Sillage to load it), on macOS too when it touches
  shortcuts, the window or the scripts;
- the README and these docs describe the new behaviour.

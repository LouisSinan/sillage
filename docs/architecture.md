# Architecture

## Loading

```
Firefox start
 └─ defaults/pref/sillage-prefs.js       general.config.filename = "config.js", sandbox disabled
     └─ <Firefox>/config.js                autoconfig, runs once with chrome privileges
         ├─ registers <profile>/chrome/chrome.manifest   → chrome://sillage/content/
         ├─ creates `shared` (state common to all windows) and `log`
         └─ on "browser-delayed-startup-finished" (each browser window):
              window.sillageLog / window.sillageShared
              loadSubScript("chrome://sillage/content/sillage.uc.js", window)
```

- `firefox/` is copied into the Firefox installation by `scripts/install.sh` (`install_loader` in
  `scripts/common.sh`). A Firefox update can remove these files: `tests/run.sh` and, on Linux, `bin/sillage`
  copy them again when they are out of date; on macOS, Firefox lives inside the app and is only updated by
  `make update`.
- `profile/chrome/` is **symlinked** into the profile, so editing the repository and restarting Sillage is
  enough. `chrome.manifest` maps that directory to `chrome://sillage/content/`, because privileged modules must
  load from a chrome URL.
- `profile/user.js` is copied into the profile and applied at every start.
- `firefox/policies.json` (enterprise policies) installs Consent-O-Matic.

## Files

| File | Role |
|---|---|
| `firefox/config.js` | Autoconfig loader, log function, shared state |
| `profile/chrome/sillage.uc.js` | The whole interface, one IIFE per browser window |
| `profile/chrome/sillage.css` | Styles, loaded as an author sheet by the script |
| `profile/chrome/sillage-sync.sys.mjs` | Firefox Sync engine (an ES module: one instance for the application) |
| `profile/user.js` | Preferences |
| `scripts/` | `install`, `launch`, `default`, `uninstall`; `common.sh` + `platform/<linux|macos>.sh` |
| `bin/sillage` | Linux launcher (separate `WM_CLASS`, the Sillage profile) |
| `tests/run.sh`, `tests/suite.js` | Headless test runner and suite |

## `sillage.uc.js`

The script is a single function run in each browser window. It returns early in popups (no toolbar) and if
it already ran. Sections are marked with `/* ---------- name ---------- */` comments, in this order:

| Section | What it holds |
|---|---|
| utilities | `h()` (element builder), `icon()`, `host()`, `uid()` |
| persistent data | `defaults()`, `migrate()`, `loadData()`, `save()` |
| per-profile history | palette history, per profile |
| tabs ↔ workspaces | `tabWs`, `inView`, `todayTabs`, placeholders, `addTab` |
| recent tabs / walk the sidebar | Ctrl+Shift+arrows |
| tab and pinned item actions | open, pin, favorite, close, archive |
| profiles & workspaces | containers, `switchWs`, `applyVisibility` |
| user interface | `buildUi`, `renderNow` and row builders |
| sidebar events, renaming, drag and drop, resizing & peek, context menus | sidebar behaviour |
| pinned extensions per workspace | toolbar icons hidden per workspace |
| command palette, workspace editor, Chromium import | |
| Little Sillage | window for links from other apps |
| Glance | link previews in a card over the page |
| Board | infinite canvas per workspace |
| keyboard shortcuts, updates, Sync observer | |
| startup | `init()`: data, UI, event wiring, session restore handling |

At the end, `window.Sillage` exposes a small API (`render`, `switchWs`, `openPalette`, `toast`,
`adoptIntoWorkspace`) used between windows, and `Sillage._t`, the internals used by the tests.

## Rendering

The sidebar is rebuilt from data, not patched: `render()` schedules `renderNow()` on the next animation
frame, which rebuilds the favorites, pinned tree and today list with `replaceChildren`. Rendering is skipped
(and replayed afterwards) while a drag or a rename is in progress.

Changes coming from pages go through `renderLater()`, which groups them (at most one render every 250 ms)
and ignores tabs the sidebar does not show. Use `render()` for anything the user just did, `renderLater()`
for background noise.

## Windows and shared state

All browser windows share one data object (`shared.data`, loaded once) and save it to the same file. After a
change, `save()` writes the file and asks the other windows to render. Each window has its own active
workspace. The Sync engine is an ES module, so it exists once for the application and receives `shared` from
the first window.

**All profiles and workspaces live in one window.** Profiles are Firefox containers, not separate Firefox
profiles: earlier attempts with one Firefox instance per profile opened extra windows and were reverted.
Separate profiles left over from that period are merged back at startup (`absorbSeparateProfiles`).

## Logs

`log()` appends to `sillage.log` in the profile directory. Exceptions in event handlers are caught and
logged so that one failure does not break the window.

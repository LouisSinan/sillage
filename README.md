<p align="center">
  <img src="assets/icon.svg" width="96" alt="Sillage icon">
</p>

<h1 align="center">Sillage</h1>

<p align="center">An Arc-style browser built on top of the real Firefox.</p>

Sillage replaces Firefox's interface with a vertical sidebar, workspaces, profiles and a command
palette. It does not fork or rebuild Firefox. It installs an unmodified Mozilla release and injects
its interface at startup through Firefox's autoconfig mechanism. The browser engine, security
updates, extensions, Firefox Sync, DRM playback and sign-in flows (Google included) are those of
Firefox.

## Features

- **Sidebar** with favorites, pinned tabs, folders and today tabs. Toggle it per window with
  <kbd>Ctrl</kbd>+<kbd>S</kbd> or <kbd>Ctrl</kbd>+<kbd>B</kbd>; when hidden, hover the left edge of the window to peek at it.
- **Workspaces** with their own color, pinned tabs and open tabs. Switch with <kbd>Ctrl</kbd>+<kbd>←</kbd> / <kbd>→</kbd>,
  <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd>, a horizontal swipe on the sidebar, or the palette.
- **Profiles.** Each profile is a real Firefox profile with its own extensions, passwords, history, sign-ins
  and Firefox Account, running in its own window. The sidebar lists the workspaces of every profile;
  choosing one of another profile switches to that profile's window.
- **Command palette** (<kbd>Ctrl</kbd>+<kbd>T</kbd> / <kbd>Ctrl</kbd>+<kbd>L</kbd>): URLs, web search with
  suggestions, open tabs, pinned items, history and commands, with inline autofill of the best match.
- **Recent tabs switcher** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd>): Alt+Tab-style cycling with page
  thumbnails; the tab opens when the keys are released.
- **Board**: each workspace has an infinite canvas of sticky notes. Notes last 7 days, with a countdown
  and a shrinking lifetime bar, and can be renewed. Open it with the Sillage orb in the middle of the
  sidebar divider, or from the palette. There are no empty pages: when a workspace has nothing open,
  its board is shown instead.
- **Little Sillage**: links opened from other apps land in a small separate window instead of a workspace;
  "Open in…" moves the tab into the workspace of your choice. Can be turned off from the palette.
- **Sync** through your Firefox Account: workspaces, pinned items, folders, boards, profiles and favorites
  follow you across devices, end-to-end encrypted like the rest of Firefox Sync.
- **Pinned tabs** that keep their home URL; closing a pinned tab unloads it instead of removing it.
- **Auto-archiving** of today tabs that have not been viewed for a while (12 hours to 7 days, or never).
- **Drag and drop** to reorder, pin, file into folders or move tabs to another workspace.
- **Imports** from Chromium-based browsers (passwords, history, bookmarks), or Chromium bookmarks as pinned items.
- **Sensible defaults**: cookie consent banners are refused automatically by
  [Consent-O-Matic](https://addons.mozilla.org/firefox/addon/consent-o-matic/) (installed through Firefox
  policies; it can be disabled in `about:addons`), and videos switch to Picture-in-Picture when you leave their tab.

## Requirements

- Linux (x86_64) or macOS
- `bash`, `curl`, `make`
- About 350 MB of disk space for the Firefox copy

## Installation

```sh
git clone https://github.com/LouisSinan/sillage.git
cd sillage
make install   # downloads Firefox and installs the Sillage app (no root needed)
make launch    # or start Sillage from your app launcher, Spotlight or Launchpad
```

| Command | Description |
|---|---|
| `make install` | Download Firefox and install the Sillage app |
| `make launch` | Start Sillage |
| `make default` | Make Sillage the default web browser |
| `make update` | Pull the repository and update Firefox |
| `make test` | Run the test suite in a headless Firefox on a throwaway profile |
| `make uninstall` | Remove the app (the profile is kept) |

Firefox is downloaded in US English. Set `SILLAGE_LOCALE` to use another language, for example
`SILLAGE_LOCALE=de make install`.

| | Linux | macOS |
|---|---|---|
| App | `~/.local/share/applications/sillage.desktop` | `~/Applications/Sillage.app` |
| Firefox | `~/.local/opt/sillage-firefox` (updates itself) | inside the app; `make update` (Sillage shows a notice) |
| Profile | `~/.local/share/sillage/profile` | `~/Library/Application Support/Sillage/Profile` |

## Keyboard shortcuts

On macOS, <kbd>Ctrl</kbd> becomes <kbd>⌘</kbd>, except for <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd>; previous / next
workspace is <kbd>⌘</kbd>+<kbd>⌥</kbd>+<kbd>←</kbd> / <kbd>→</kbd>, as in Arc.

| Shortcut | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>S</kbd> or <kbd>Ctrl</kbd>+<kbd>B</kbd> | Toggle the sidebar in the current window |
| <kbd>Ctrl</kbd>+<kbd>T</kbd> | Open the command palette |
| <kbd>Ctrl</kbd>+<kbd>L</kbd> | Open the palette on the current tab |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd> | Recent tabs: go further back (hold <kbd>Ctrl</kbd>+<kbd>Shift</kbd>, release to open, <kbd>Esc</kbd> to cancel) |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>←</kbd> | Recent tabs: move back towards the current tab |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> | Previous / next entry in the sidebar |
| <kbd>Ctrl</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | Previous / next workspace (in text fields, moves by word as usual) |
| <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> | Switch to workspace *n* (physical key, works with any keyboard layout) |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Pin / unpin the current tab |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> | Add / remove the current tab from favorites |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Copy the current URL |

Other Firefox shortcuts (<kbd>Ctrl</kbd>+<kbd>W</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>, <kbd>Ctrl</kbd>+<kbd>F</kbd>…) work as usual.
Closing a tab returns to the previously active tab of the workspace.

## How it works

Firefox's user interface is written in HTML, CSS and JavaScript. At startup, Firefox reads an
autoconfig file from its installation directory with chrome privileges. Sillage uses it to load
`profile/chrome/sillage.uc.js` into every browser window, which builds the sidebar, moves the native
navigation toolbar into it and hides the native tab strip. Workspaces rely on Firefox's tab hiding, and
each tab's workspace is stored as a session-store value, so it survives restarts. Each profile is a
separate Firefox profile running as its own instance.

A Firefox release can occasionally change internals the interface depends on. Browsing keeps working
in that case, and `make test` shows what needs attention.

```
Makefile          install | launch | default | update | test | uninstall
firefox/          copied into Firefox: autoconfig loader and preference, enterprise policies
profile/chrome/   the interface (sillage.uc.js, sillage.css), linked into the profile
profile/user.js   profile preferences
scripts/          one script per command; common.sh + platform/<linux|macos>.sh
bin/sillage       Linux launcher
tests/            test suite (headless Firefox, throwaway profile)
assets/           icon
```

The interface reloads with Sillage: edit `profile/chrome/`, then restart it. Logs are written to
`sillage.log` in the profile directory.

## Profiles

Create one from the palette (**New profile**). Each profile lives in its own
Firefox profile directory next to the default one (`profiles/<id>/`) and runs as its own Firefox instance,
so extensions, passwords, history, cookies and the Firefox Account are fully separate.

- The sidebar shows the workspaces of all profiles, grouped by profile. Choosing a workspace of another
  profile (click, <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd>, palette) starts that profile's window or brings it to the
  front. <kbd>Ctrl</kbd>+<kbd>←</kbd>/<kbd>→</kbd> and swipes stay within the current profile.
- New workspaces are created in the current window. Tabs and whole workspaces can be moved to another profile
  (drag a tab onto its workspace, the tab menu, or **Edit workspace**); they reopen there, signed in with that
  profile's accounts.
- To sync a profile across devices, sign in to a Firefox Account in its window. Using a separate account per
  profile keeps profiles separate on every device; an email alias (`you+work@example.com`) is enough.
  The list of profiles itself travels with the default profile, so other devices offer the same profiles.
- Profiles from earlier versions, based on Firefox containers, are migrated automatically: workspaces,
  favorites, open tabs and sign-in cookies move to a real profile.

## Sync

Sign in to your Firefox Account in Sillage (palette → Settings → Sync) on each device. Sillage registers its
own engine with Firefox Sync, so its data is encrypted with your account keys and stored in a separate
collection that regular Firefox clients ignore.

- Synced: the profile's workspaces (name, icon, color, pinned items and folders, board notes), favorites,
  and deletions; the default profile also carries the list of profiles.
- Not synced: open tabs (Firefox already shares them), sidebar width and visibility, board pan and zoom.
- Conflicts are resolved per workspace and per profile: the most recent change wins. When a fresh install
  joins, its untouched default workspace is replaced by your synced workspaces.

## Data

Workspaces, pinned items, favorites and boards are stored in `sillage.json`, and palette history in
`sillage-history.json`, both in the profile directory. Sillage makes no network
requests of its own beyond search suggestions from your default search engine (when enabled in Firefox),
Firefox Sync when you are signed in, and, on macOS, a daily check for new Firefox releases.

## Acknowledgements

Sillage is inspired by [Arc](https://arc.net) and builds on [Firefox](https://www.mozilla.org/firefox/).
It is not affiliated with Mozilla or The Browser Company. Firefox is a trademark of the Mozilla Foundation.

## License

Sillage is released under the [MIT License](LICENSE). Firefox itself is not part of this repository:
it is downloaded from Mozilla at install time and remains under the
[Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/).

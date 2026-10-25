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
- **Profiles.** Each workspace is assigned a profile backed by a Firefox container: separate cookies and
  sessions (for example two Google accounts side by side), plus separate palette history and favorites.
- **Command palette** (<kbd>Ctrl</kbd>+<kbd>T</kbd> / <kbd>Ctrl</kbd>+<kbd>L</kbd>): URLs, web search with
  suggestions, open tabs, pinned items, history and commands, with inline autofill of the best match.
- **Recent tabs switcher** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd>): Alt+Tab-style cycling with page
  thumbnails; the tab opens when the keys are released.
- **Pinned tabs** that keep their home URL; closing a pinned tab unloads it instead of removing it.
- **Auto-archiving** of today tabs that have not been viewed for a while (12 hours to 7 days, or never).
- **Drag and drop** to reorder, pin, file into folders or move tabs to another workspace.
- **Imports** from Chromium-based browsers (passwords, history, bookmarks), or Chromium bookmarks as pinned items.

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
each tab's workspace is stored as a session-store value, so it survives restarts. Profiles map to
Firefox containers.

A Firefox release can occasionally change internals the interface depends on. Browsing keeps working
in that case, and `make test` shows what needs attention.

```
Makefile          install | launch | default | update | test | uninstall
firefox/          copied into Firefox: autoconfig loader and preference, macOS policy
profile/chrome/   the interface (sillage.uc.js, sillage.css), linked into the profile
profile/user.js   profile preferences
scripts/          one script per command; common.sh + platform/<linux|macos>.sh
bin/sillage       Linux launcher
tests/            test suite (headless Firefox, throwaway profile)
assets/           icon
```

The interface reloads with Sillage: edit `profile/chrome/`, then restart it. Logs are written to
`sillage.log` in the profile directory.

## Data

Workspaces, pinned items and favorites are stored in `sillage.json`, and palette history in
`sillage-history.json`, both in the profile directory. Everything stays on your machine; Sillage
makes no network requests of its own beyond search suggestions from your default search engine
(when enabled in Firefox) and, on macOS, a daily check for new Firefox releases.

## Acknowledgements

Sillage is inspired by [Arc](https://arc.net) and builds on [Firefox](https://www.mozilla.org/firefox/).
It is not affiliated with Mozilla or The Browser Company. Firefox is a trademark of the Mozilla Foundation.

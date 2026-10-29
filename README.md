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

- **Sidebar** with favorites, pinned tabs, folders and today tabs (hover any tab for its close button, or
  middle-click it). Toggle it per window with
  <kbd>Ctrl</kbd>+<kbd>S</kbd> or <kbd>Ctrl</kbd>+<kbd>B</kbd>; when hidden, hover the left edge of the window to peek at it
  (over the board too). Double-click a tab to go back to the page it started on: a pinned tab returns to its
  pinned URL, a today tab to the first page of its history (a pinned tab already there is renamed instead).
- **Workspaces** with their own color, pinned tabs and open tabs. Switch with <kbd>Ctrl</kbd>+<kbd>←</kbd> / <kbd>→</kbd>,
  <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd>, a horizontal swipe on the sidebar (one workspace per swipe, swipe again
  right away to keep going), or the palette.
- **Profiles.** Each workspace is assigned a profile backed by a Firefox container: separate cookies and
  sessions (for example two Google accounts side by side), plus separate palette history and favorites.
  All profiles share one window. The current profile's container name shows as a colored label in the top row
  of the toolbar, above the address bar. Extensions are shared too, but each workspace shows its own pinned extension
  icons: right-click an icon → *Hide in …*; right-click the extensions button → *Show hidden extensions*, or use
  the palette.
- **Command palette** (<kbd>Ctrl</kbd>+<kbd>T</kbd> / <kbd>Ctrl</kbd>+<kbd>L</kbd>): URLs, web search with
  suggestions, open tabs, pinned items, history and commands, with inline autofill of the best match. Tabs and
  pinned items of the current workspace come before those of other workspaces.
- **Recent tabs switcher** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd>): Alt+Tab-style cycling through the current workspace, with page
  thumbnails; the tab opens when the keys are released. The board counts as a tab here, and in
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd>.
- **Board**: each workspace has an infinite canvas with sticky notes, free text and basic shapes (line, arrow,
  rectangle, ellipse); colors, fill, stroke width, font and text size can be set for everything. Notes last 7 days
  by default, adjustable per note (or never expire). An expired note is kept and raises a red alert on the
  board, on the Sillage orb and on the workspace icon until you renew it, ask to be reminded later, or delete
  it. Open the board with the orb in the middle of the sidebar divider, or from the palette. There are no empty
  pages: when a workspace has nothing open, its board is shown instead. Tools: <kbd>V</kbd> select,
  <kbd>N</kbd> note, <kbd>T</kbd> text, <kbd>L</kbd> line, <kbd>A</kbd> arrow, <kbd>R</kbd> rectangle,
  <kbd>O</kbd> ellipse; <kbd>Shift</kbd> constrains, <kbd>Del</kbd> deletes, <kbd>Space</kbd> or the middle button pans.
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes, <kbd>Ctrl</kbd>+<kbd>Y</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes
  (also buttons in the board's bar); <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> copy, cut and paste
  the selection (pasted under the mouse), <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicates it. Pasting text from elsewhere
  adds a text item, or a link block for a URL.
  Drag a tab, a pinned item or a link onto the board to add a small link block: clicking it goes to the tab
  (or opens the page), and the sidebar is left unchanged.
- **Glance**: a link that would open a new tab (or any link with <kbd>Shift</kbd>+click) shows in a card over the
  current page instead, like Arc's Peek. Click beside it or press <kbd>Esc</kbd> to close it, or *Open as tab* (<kbd>Ctrl</kbd>+<kbd>O</kbd>) to
  keep it. <kbd>Ctrl</kbd>+click still opens a background tab. Can be turned off from the palette.
- **Little Sillage**: links opened from other apps land in a small separate window instead of a workspace;
  "Open in…" moves the tab into the workspace of your choice. With several profiles, the window first asks
  which profile to open the link with (<kbd>1</kbd>…<kbd>9</kbd>, arrows and <kbd>Enter</kbd>; the last choice
  is offered first), and the profile button in its bar reopens the page in another one. Can be turned off from the palette.
- **Sync** through your Firefox Account: workspaces, pinned items, folders, boards, profiles and favorites
  follow you across devices, end-to-end encrypted like the rest of Firefox Sync.
- **Light on memory**: after a restart, tabs load when you open them; once loaded they stay alive. Hovering a
  sidebar row prepares its tab so switching is instant.
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
| <kbd>Ctrl</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | Previous / next workspace (in a text field you clicked or typed in, moves by word as usual) |
| <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> | Switch to workspace *n* (physical key, works with any keyboard layout) |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Pin / unpin the current tab |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> | Add / remove the current tab from favorites |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Copy the current URL |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | Open the Glance card as a tab (without a card: Firefox's Open File) |

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
firefox/          copied into Firefox: autoconfig loader and preference, enterprise policies
profile/chrome/   the interface (sillage.uc.js, sillage.css), linked into the profile
profile/user.js   profile preferences
scripts/          one script per command; common.sh + platform/<linux|macos>.sh
bin/sillage       Linux launcher
tests/            test suite (headless Firefox, throwaway profile)
docs/             technical documentation
assets/           icon
```

The interface reloads with Sillage: edit `profile/chrome/`, then restart it. Logs are written to
`sillage.log` in the profile directory. The [technical documentation](docs/README.md) covers the
architecture, the data model, how each feature is built, Sync, testing and the Firefox internals Sillage
relies on.

## Sync

Sign in to your Firefox Account in Sillage (palette → Settings → Sync) on each device. Sillage registers its
own engine with Firefox Sync, so its data is encrypted with your account keys and stored in a separate
collection that regular Firefox clients ignore.

- Synced: workspaces (name, icon, color, profile, pinned items and folders, board notes), profiles (name,
  favorites), and deletions.
- Not synced: open tabs (Firefox already shares them), sidebar width and visibility, board pan and zoom.
  Each profile's Firefox container is created locally when the profile first arrives on a device.
- Conflicts are resolved per workspace and per profile: the most recent change wins. When a fresh install
  joins, its untouched default workspace is replaced by your synced workspaces.

## Data

Workspaces, pinned items, favorites and boards are stored in `sillage.json`, palette history in
`sillage-history.json` and the last icon of each site in `sillage-icons.json`, all in the profile directory. Sillage makes no network
requests of its own beyond search suggestions from your default search engine (when enabled in Firefox),
Firefox Sync when you are signed in, and, on macOS, a daily check for new Firefox releases.

## Contributing

Contributions are welcome: see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). In short, edit `profile/chrome/`,
run `make test`, restart Sillage to try the change, and open a pull request using the template. Coding agents
follow [AGENTS.md](AGENTS.md).

## Acknowledgements

Sillage is inspired by [Arc](https://arc.net) and builds on [Firefox](https://www.mozilla.org/firefox/).
It is not affiliated with Mozilla or The Browser Company. Firefox is a trademark of the Mozilla Foundation.

## License

Sillage is released under the [MIT License](LICENSE). Firefox itself is not part of this repository:
it is downloaded from Mozilla at install time and remains under the
[Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/).

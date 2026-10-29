# Features: how they are built

Each section names the functions to start from in `profile/chrome/sillage.uc.js`.

## Workspaces and tabs

- A tab belongs to a workspace through its `sillage-ws` value, or through the pinned item it was opened from
  (see [data model](data-model.md)). `tabWs()` and `inView()` answer "where does this tab live".
- `switchWs(id)` remembers the selected tab of the workspace being left, selects the target's last tab (or
  its placeholder, which shows the board), then `applyVisibility()` hides every tab that is not in view with
  `gBrowser.hideTab`. Firefox keeps hidden tabs loaded.
- New tabs opened while a workspace is active get its id (`TabOpen` handler). A tab opened in the wrong
  container (for example a link from another app) is reopened in the workspace's container (`rehome`).
- **Placeholder**: Firefox always needs a selected tab. When a workspace has nothing open, a blank tab marked
  `sillage-blank` stays selected behind the board and is never listed (`placeholder`, `isBlank`,
  `adoptEmptyTab`).
- **Closing** a tab returns to the previous tab of the workspace: `updateSuccessor()` keeps Firefox's tab
  successor in line with the most-recently-used list (`mru`).
- **Archiving**: `archive()` closes today tabs not viewed for `settings.archiveHours`.
- **Tab freshness**: tabs are restored when first opened (`restore_on_demand`), then stay alive; hovering a
  sidebar row for 120 ms calls `gBrowser.warmupTab` so the switch is instant.

## Sidebar

- Built once by `buildUi()`; the navigation toolbar (`#navigator-toolbox`) is moved into it and the native tab
  strip is hidden by CSS.
- Content is rebuilt by `renderNow()`: favorites grid, workspace title, pinned tree (`node()` recursion for
  nested folders), today tabs. See [rendering](architecture.md#rendering).
- Drag and drop (`wireDnd`, `computeDrop`, `moveTab`, `moveItem`, `moveFolder`, `moveWorkspace`): one
  `dragging` descriptor, drop targets computed from the pointer position, marks as CSS classes.
- Renaming (`startRename`): an input replaces the title; Enter or a click elsewhere commits, Escape cancels.
- Double-click on a row: `backToStart()` returns a pinned tab to its pinned URL (`resetItem`) or a today tab
  to the first entry of its session history that is not a blank / new tab page (`browser.gotoIndex`). When
  there is nothing to go back to, a pinned row is renamed instead.
- The container label (`#userContext-icons`, updated by Firefox) is moved from the address bar into `#nav-bar`
  and placed by CSS in the free space of the top row. `fixContainerColors()` renames the color "turquoise"
  (used by older versions, since renamed "cyan" by Firefox and left without a color) at startup.
- Hidden sidebar: hovering the left edge shows it temporarily (*peek*, `wirePeek`, `endPeek`). The peek zone
  and the peeked sidebar sit above the board and Glance cards (z-index).
- Horizontal swipe on the sidebar (`wheel` listener in the sidebar events): one `stepWs` per gesture. Wheel
  events carry no gesture phase, so after a step the trackpad momentum is ignored and a new gesture is
  recognised by a 250 ms pause, a change of direction, or deltas growing again after having decayed
  (below 40 % of the peak).
- Icons (`favicon`): the tab's icon, then the site's cached icon (`rememberIcon` on `TabAttrModified`
  `image`, `cachedIcon`), then `page-icon:`, then a colored letter; each failing source falls through to the
  next. A loading tab keeps its known icon, dimmed; the spinner only shows when no icon is known yet.
- Workspace color: the hue is a registered CSS property (`--sl-h`) so it animates; `setHue()` picks the
  shortest way around the color wheel.

## Profiles and pinned extensions

- `createProfile()` creates a container with `ContextualIdentityService.create`. Changing a workspace's
  profile reopens its tabs in the new container (`saveWs` → `rehome`).
- Extensions are shared, but each workspace hides the toolbar widgets listed in `hiddenExtensions`
  (`applyExtensionPins`, `setExtensionHidden`, context menu entries added by `wireExtensionPins`).

## Command palette

`openPalette(mode)` and `query()`: URL fixup, search engine suggestions, open tabs, pinned items, palette
history (per profile) and commands (`COMMANDS`, `dynamicCommands`). `choose()` runs the selection; commands
are handled in `runCommand`. Inline autofill completes the best match. Tabs (`byRecency`) and pinned items
of the current workspace are listed before those of other workspaces.

## Recent tabs switcher

Ctrl+Shift+→ / ← (`cycleStep`, `endCycle`): cycles through `mru` limited to the current workspace and
selects on key release. The board is an entry of `mru` too (`boardKey(wsId)`, one object per workspace,
touched by `openBoard`); `shownEntry()` is the board when it is open, otherwise the selected tab. The sidebar
walk (Ctrl+Shift+↑ / ↓, `sidebarEntries`) has a board entry between pinned items and today tabs. Thumbnails are captured with `drawSnapshot` shortly after a tab is shown
(`captureThumb`).

## Glance

A link that would open a foreground tab shows in a card over the current page.

- `hookGlance()` wraps `gBrowser.addTab`. When the call comes from a page (`openerBrowser` is the selected
  tab), is not in the background and not from another app, the tab is created in the background and
  `openGlance()` shows it. It also wraps `window.openLinkIn` so Shift+click (normally a new window) opens a
  card, and listens to Firefox's Stop command so Escape closes the card when the page does not use the key.
- `openGlance()` puts the page and the new tab in a **Firefox split view** (`gBrowser.addTabSplitView`), which
  keeps both pages live, then restyles the two panels with the `[sl-glance-base]` / `[sl-glance-card]`
  attributes. `#sl-glance` adds the shade (a clip path with a hole where the card is) and the buttons.
  `positionGlance()` computes the card's place instead of measuring it, because the card is animated.
- `closeGlance({ keep })` undoes the split view and either keeps the tab (selected, listed in the sidebar) or
  closes it. Selecting another tab closes the card; this is deferred by one tick because Firefox also moves the
  selection away from a tab it is about to close. Ctrl+O (⌘O) keeps the card as a tab.
- Firefox's tab switcher does not turn off the pages of a split view when another tab is chosen, and nothing
  does once the split view is gone: switching back later found a page it believed was painted, and the tab
  stayed empty. `sendToBackground()` sets `docShellIsActive = false` on the card or the page left in the
  background after `closeGlance()`.
- The card's tab is left out of the sidebar and of the recent tabs list while it is a card.

## Board

An infinite canvas per workspace (`buildBoard`, `renderBoard`, `refreshBoard`), shown over the page area
(`positionBoard`).

- Notes (`addNote`, `noteEl`): text, color, font, size, and a lifetime. `remaining()` gives the label and
  state; an expired note is kept and raises an alert (board, orb, workspace icon) until it is renewed
  (`renewNote`), snoozed (`snoozeNote`) or deleted. `tickBoard()` refreshes countdowns every 30 s without
  rebuilding.
- Items (`board().items`): free text (`addText`, `editText`), shapes drawn in an SVG layer (`renderShapes`,
  `shapeGeometry`; Shift constrains), and link blocks (`addLink`, `openLink`) created by dropping a tab,
  pinned item or link on the board.
- Tools and the floating style bar: `setTool`, `select`, `drawStyleBar`. The last chosen style becomes the
  default for new items (`boardStyle`).
- `refreshBoard()` skips rebuilding while text is being edited or something is dragged.
- Undo / redo (`boardCommit`, `boardUndo`): `save()` snapshots the current workspace's notes and items (not
  the view) and pushes the previous snapshot when they changed; one history per workspace, in memory, 100
  steps. Changes from sync reset the baseline (`boardRebase`) so they are not undone as a step. Text typed in
  a note or text item is captured at its debounced save; inside a text field, Ctrl+Z is the field's own undo.
- Copy / paste (`boardCopy`, `boardPaste`, `boardDuplicate`, `placeCopy`): the copied object is kept in
  `boardClip` and its text or URL goes to the system clipboard. Pasting restores the object while the
  clipboard still holds that text; otherwise the clipboard text becomes a text item or a link block. Keys are
  matched on `e.key`, so they follow the keyboard layout.

## Little Sillage

`hookExternalLinks()` replaces `window.browserDOMWindow` with a wrapper whose `openURI` sends links from
other apps (`OPEN_EXTERNAL`) to a small separate window (`openLittle`, `enterLittle`). "Open in…" moves the
tab into a workspace of the main window (`adoptIntoWorkspace`).

With several profiles, `openLittle` opens the window on `about:blank` and leaves the URL in
`shared.littlePick`; `enterLittle` then shows `showProfilePick`, and the link is only loaded once a profile
is chosen, in its container. The choice is remembered in `D.settings.littleProfile`
(`defaultLittleProfile`). "Open in" targets the main window's workspace, or, when that workspace belongs to
another profile, the last workspace used with the page's profile (`D.lastWsByProfile`, set by `switchWs`).

## Keyboard shortcuts

`SHORTCUTS` become XUL `<key>` elements (they act after the page had a chance to handle the key). Keys that
pages tend to consume (Ctrl+arrows, Ctrl+1…9, Ctrl+Shift+arrows, Ctrl+Shift+C) are handled by a capturing
`keydown` listener on the window instead. `disableNativeKeys()` disables Firefox's keys that clash. On macOS,
Ctrl becomes ⌘ except for Ctrl+1…9, and workspace switching is ⌘⌥+arrows.

Ctrl+arrows are left to a text field (word navigation) only when the user has clicked or typed in the page
(`pageEngaged`, reset on `TabSelect` and on a new document): fields that pages focus on their own while
loading (search engines, chat apps) would otherwise swallow the shortcut. Chrome fields (address bar,
sidebar inputs) always keep it.

## macOS updates

Firefox inside `Sillage.app` cannot update itself. `checkFirefoxUpdate()` compares the version once a day with
Mozilla's product details and shows a notice suggesting `make update`.

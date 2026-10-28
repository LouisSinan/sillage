# Data model

## `sillage.json`

Stored in the profile directory, written atomically (`IOUtils.writeJSON` with a temporary file). Shape:

```js
{
  version: 2,
  profiles: [{
    id, name,
    userContextId,             // Firefox container id (0 = no container, the default profile)
    favorites: [item],         // the grid at the top of the sidebar
    mod,                       // last change, for Sync
  }],
  workspaces: [{
    id, name, icon, hue,       // icon is an emoji, hue drives the colors
    profile,                   // profile id
    pinned: [node],            // pinned tree, see below
    hiddenExtensions: [id],    // extension widgets hidden in this workspace
    board: {
      notes: [{ id, x, y, text, color, font, size, created, lifetime, expires, snoozed }],
      items: [{ id, kind: "text" | "line" | "arrow" | "rect" | "ellipse" | "link", ... }],
      view: { x, y, z },       // pan and zoom (not synced)
    },
    mod,
  }],
  lastWs,
  settings: { sidebarVisible, sidebarWidth, archiveHours, littleWindow, glance, noteLifetime, boardStyle, ... },
  sync: { tombstones: { "workspace:<id>": time, "profile:<id>": time } },  // managed by the Sync engine
}
```

Pinned tree nodes:

```js
{ type: "item", id, url, title, customTitle, icon }   // icon: only an http(s) URL, if any (see below)
{ type: "folder", id, name, open, children: [node] }   // folders nest to any depth
```

`migrate()` upgrades older files; `loadData()` fills missing keys from `defaults()`. Keys starting with `_`
are runtime-only and never saved or synced.

`sillage-history.json` holds the palette history, keyed by profile id.

`sillage-icons.json` maps a host to the last favicon seen for it (a data URI, at most 32 KB, about 800
hosts). Firefox hands tab icons out as data URIs that only live with the tab, so this local, unsynced cache
is what unloaded pinned items, favorites, the palette and the switcher show. `loadData()` moves the data
URIs that older versions stored in `item.icon` into it.

## Tab values

Tabs are Firefox tabs. Sillage stores what it needs on them with session-store custom values, so the
information survives restarts:

| Key | Value |
|---|---|
| `sillage-ws` | id of the workspace the tab belongs to (a "today" tab) |
| `sillage-item` | id of the pinned item or favorite the tab was opened from |
| `sillage-blank` | `"1"` on the placeholder tab kept behind the board when a workspace is empty |

`tabWs(t)` derives a tab's place: the workspace of its pinned item, `"*<profile id>"` for a favorite, or
`sillage-ws`. `inView(t)` tells whether the tab belongs in the current workspace (its own tabs plus its
profile's favorites). Workspace switching hides the other tabs with `gBrowser.hideTab`.

## Profiles

A profile is a Firefox container (`ContextualIdentityService`) plus a name, favorites and palette history.
Tabs of a workspace open in its profile's container, so two workspaces can be signed in to different
accounts. Extensions, bookmarks and Firefox history are shared by all profiles.

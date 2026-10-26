# Sync

`profile/chrome/sillage-sync.sys.mjs` registers a Firefox Sync engine named `sillage`. Data goes through the
user's Firefox Account, encrypted with the account keys like bookmarks or passwords, in a `sillage`
collection that other Firefox clients ignore.

## What is synced

| Synced | Not synced (per device) |
|---|---|
| Workspaces: name, icon, hue, profile, pinned tree, board notes and items, hidden extensions, order | Open tabs (Firefox syncs them already) |
| Profiles: name, favorites | Sidebar width and visibility, board pan and zoom |
| Deletions of workspaces and profiles | The container behind each profile (created locally on arrival) |

The fields are listed in `workspaceFields()` and `profileFields()`. **Adding a field to the data model that
should follow the user means adding it there**, and to `pristine()` if it can make a default workspace
"non-empty".

## Record and merge

- The whole state is one record (`sillage-state`): `{ v: 1, profiles: { id: {...fields, mod} }, workspaces: { id: {...} } }`.
- `stamp()` hashes each entity's synced fields after every `save()`; an entity whose hash changed gets
  `mod = now`. So "last modified" is per workspace and per profile.
- `merge()` applies a remote state: for each entity, the side with the higher `mod` wins. Profiles are merged
  first since workspaces refer to them. A profile arriving from another device gets a new local container.
- Deletions are tombstones in `D.sync.tombstones` (`"workspace:<id>"` → time), kept 90 days, uploaded as
  `{ deleted: true, mod }`.
- **Pristine** entities (fresh-install defaults, `mod` 0 and empty) are never uploaded and never win. When a
  new device joins, its untouched default workspace is replaced by the synced ones instead of being added.
- When the merged result differs from both the local and the remote state, it is uploaded on the next sync
  (`needsUpload`).

After a merge, the store writes `sillage.json` and notifies `sillage-sync-applied`; each window then renders,
and closes the tabs of removed workspaces.

## Engine wiring

- `init(shared)` is called by the first window. It enables the engine prefs, including
  `services.sync.engineStatusChanged.sillage`: without it, Sync treats an engine that is missing on the
  server as disabled elsewhere and turns it off before the first upload.
- The tracker keeps a single "modified" flag in a pref; `dataSaved()` sets it and raises the score so Sync
  runs soon. An upload is also scheduled 10 s after startup.
- `_reconcile()` always accepts incoming records: the store does its own merging.
- "Sync now" in the palette calls `syncNow()`.

The merge logic is plain functions (`stamp`, `buildState`, `merge`, `noteDeletion`, `initStamps`), so the
test suite exercises two simulated devices without a server.

# Sillage documentation

Technical documentation for people working on Sillage. For installing and using it, see the
[main README](../README.md).

| Document | Contents |
|---|---|
| [Contributing](CONTRIBUTING.md) | Setting up, the development loop, conventions, pull requests |
| [Architecture](architecture.md) | How the interface gets into Firefox, files, windows and shared state |
| [Data model](data-model.md) | `sillage.json`, session-store tab values, profiles and containers |
| [Features](features.md) | How each feature is built: workspaces, sidebar, palette, board, Glance… |
| [Sync](sync.md) | The Firefox Sync engine: record format, merging, deletions |
| [Testing](testing.md) | The headless test suite, probes and screenshots |
| [Firefox internals](firefox-internals.md) | Firefox APIs Sillage relies on, and what to check after a Firefox update |

## In one paragraph

Sillage is not a fork. `make install` downloads an unmodified Firefox release and copies an autoconfig
loader (`firefox/config.js`) into it. At startup, Firefox runs that loader with chrome privileges; it loads
`profile/chrome/sillage.uc.js` and `sillage.css` into every browser window. The script builds the sidebar,
moves Firefox's own navigation toolbar into it and hides the native tab strip. Everything else (tabs,
history, containers, extensions, Sync) is plain Firefox, driven through its internal JavaScript APIs.

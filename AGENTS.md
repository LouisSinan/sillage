# Agent guide

Instructions for AI coding agents (and a quick start for anyone) working on Sillage. Humans: see
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## What this is

An Arc-style interface for an **unmodified Firefox**, injected at startup through autoconfig. No fork, no
build step, no dependencies. Read [docs/architecture.md](docs/architecture.md) first; the documentation index
is [docs/README.md](docs/README.md).

```
firefox/config.js                  autoconfig loader, copied into Firefox
profile/chrome/sillage.uc.js       the interface (one IIFE per window, sections marked /* ---------- */)
profile/chrome/sillage.css         styles
profile/chrome/sillage-sync.sys.mjs Firefox Sync engine
profile/user.js                    preferences
scripts/, bin/sillage, Makefile    install / launch / update / uninstall (Linux + macOS)
tests/run.sh, tests/suite.js       headless test suite
docs/                              technical documentation
```

## Commands

```sh
make test                                   # headless suite, throwaway profile; must end with "0 failed"
SILLAGE_TEST=probe.js tests/run.sh out/     # run your own script in the headless browser (screenshots → out/)
```

There is no build or lint step. A change is loaded by restarting Sillage.

## Rules

- **Test headless.** Use `make test` and probes. Do not drive the user's screen (no simulated input, no
  screenshots of their desktop, no restarting their browser) unless they ask for it.
- **One window.** Profiles are Firefox containers inside one window. Never reintroduce one Firefox
  instance or window per profile; this was tried and reverted.
- **Firefox stays unmodified.** Work through chrome APIs, preferences and policies only.
- **English only** in the repository: code, comments, UI strings, commits, docs.
- **No personal data** in commits: no e-mail addresses (use a GitHub `noreply` address), profiles, logs or
  screenshots of real browsing.
- **Both platforms.** Shortcuts and window behaviour differ on macOS (`IS_MAC`; ⌘ instead of Ctrl). Keep
  platform specifics in `scripts/platform/`.
- **Tests with every change** in `tests/suite.js`; reach internals through `Sillage._t` (export what you need).
- **Docs with every change**: README for user-facing behaviour, `docs/` for internals,
  `docs/firefox-internals.md` when you rely on a new Firefox API.
- Synced data: new fields that should follow the user go in `workspaceFields` / `profileFields`
  (`docs/sync.md`).

## Pitfalls

- Firefox internals change between releases. When something breaks, read the actual source of the running
  version from a probe: `await (await fetch("moz-src:///browser/components/…")).text()`.
- Rendering rebuilds the sidebar; page-driven updates must use `renderLater()`, not `render()`.
- `TabSelect` fires when Firefox moves the selection away from a tab it is closing, *before* `TabClose`:
  do not close or remove tabs synchronously from a `TabSelect` handler.
- Clicks inside web pages cannot be synthesized from the suite; reproduce Firefox's own path instead
  (`window.openLinkIn(..., { openerBrowser })`).
- `drawWindow` screenshots show the interface, not web content.
- Avoid infinite CSS animations: they keep the whole window repainting.
- Pages run in other processes; `getBoundingClientRect` on animated elements includes transforms.

## Commits

Imperative summary line ("Nest pinned folders"), body for the why. Run `make test` before committing.

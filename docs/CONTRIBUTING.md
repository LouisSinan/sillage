# Contributing to Sillage

Thanks for your interest. Sillage is a small project: an interface layer on top of an unmodified Firefox.
Bug reports, fixes and focused features are welcome.

## Setup

Requirements: Linux (x86_64) or macOS, `bash`, `curl`, `make`; or Windows 10/11 with PowerShell 5.1 (no `make`: use `sillage.cmd`).

```sh
git clone https://github.com/LouisSinan/sillage.git
cd sillage
make install      # downloads Firefox, installs the loader and the app
make test         # headless test suite on a throwaway profile
```

## Development loop

1. Edit `profile/chrome/` (`sillage.uc.js`, `sillage.css`, `sillage-sync.sys.mjs`). The directory is linked
   into the profile, so there is no build step.
2. Run `make test`. It uses its own temporary profile and a headless Firefox: it does not touch your data and
   opens no window.
3. Restart Sillage (quit with Ctrl+Q / ⌘Q, then `make launch`) to try the change for real.
4. Read `sillage.log` in the profile directory (see the README for its location) when something goes wrong.

For investigations, `SILLAGE_TEST=probe.js tests/run.sh out/` runs your own script in the headless browser
and can take screenshots. See [testing](testing.md).

## Where things are

Start with [architecture](architecture.md), then [features](features.md) for the part you are changing.
[Firefox internals](firefox-internals.md) lists the Firefox APIs Sillage relies on.

## Conventions

**Scope**
- Firefox stays unmodified. Everything goes through the autoconfig loader, the profile and preferences.
- One window: profiles are Firefox containers and all workspaces share the window. Do not reintroduce one
  Firefox instance per profile.
- Sillage makes no network requests of its own beyond those listed in the README's *Data* section. A new one
  needs a good reason and a README update.
- Linux, macOS and Windows must all keep working. Platform specifics go in `scripts/platform/` and `IS_MAC` / `IS_WIN` branches. The Windows scripts (`scripts/*.ps1`, `tests/run.ps1`) mirror the bash ones: change both.

**Code**
- Plain JavaScript and CSS, no dependencies, no build step.
- Follow the surrounding code: the `h()` element builder, short functions, comments that explain *why*.
  Section headers `/* ---------- name ---------- */` keep `sillage.uc.js` navigable.
- New persistent data goes in `sillage.json` through `D` and `save()`, with defaults in `defaults()` or the
  reader. If it should follow the user across devices, add it to the synced fields (see [sync](sync.md)).
- Changes triggered by pages use `renderLater()`, user actions `render()`.
- Catch and `log()` errors in event handlers so one failure does not break the window.
- CSS colors use the hue variables (`--sl-h`) and support dark mode and `prefers-reduced-motion`. Avoid
  animations that run forever: they keep the window repainting.

**Language**
- Everything in the repository is in English: code, comments, interface text, commits, docs.
- Interface text is short and sentence case.

**Tests**
- Each behaviour change adds or updates checks in `tests/suite.js`, and `make test` passes.

## Commits and pull requests

- One topic per pull request. Rebase on `main`; keep the history readable.
- Commit messages: an imperative summary line under ~70 characters ("Nest pinned folders", "Keep the recent
  tabs switcher within the current workspace"), and a body explaining what and why when it is not obvious.
- Do not commit personal data: profiles, logs, screenshots of real browsing, or your e-mail address (use the
  GitHub `noreply` address if you prefer).
- Fill in the pull request template: what changed, how it was tested, platforms tried.
- Update the README (user-facing behaviour) and `docs/` (internals) in the same pull request.

## Reporting bugs

Include your platform, Firefox version (`about:support`), steps to reproduce, and the relevant lines of
`sillage.log`.

## License

By contributing, you agree that your contributions are released under the [MIT License](../LICENSE).

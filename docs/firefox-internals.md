# Firefox internals Sillage depends on

Sillage drives Firefox through internal chrome APIs that have no stability guarantee. This page lists them so
that a Firefox update can be checked quickly. Firefox's source for a given file can be read from a probe (see
[testing](testing.md#probes-and-screenshots)) or on [searchfox.org](https://searchfox.org).

## Loading

| Dependency | Used for |
|---|---|
| Autoconfig (`general.config.filename`, `sandbox_enabled false`) | Running `config.js` with chrome privileges |
| `browser-delayed-startup-finished` observer | Injecting the script into each window |
| `Components.manager.autoRegister(chrome.manifest)` | `chrome://sillage/content/` |
| `windowUtils.loadSheetUsingURIString` | Loading `sillage.css` |

## Tabs and windows

| Dependency | Used for |
|---|---|
| `gBrowser.hideTab` / `showTab`, `TabShow` / `TabHide` | Workspaces |
| `SessionStore.get/set/deleteCustomTabValue`, `SSTabRestoring` | Tab ↔ workspace values |
| `SessionStore.promiseAllWindowsRestored`, `getCustomWindowValue` | Startup, Little Sillage windows |
| `gBrowser.setSuccessor` / `clearSuccessor` | Returning to the previous tab on close |
| `gBrowser.warmupTab`, `lastAccessed` | Instant switching, archiving |
| `gBrowser.addTrustedTab`, `addTab` options (`openerBrowser`, `inBackground`, `fromExternal`, `userContextId`) | Opening tabs; Glance detection |
| `gBrowser.addTabSplitView`, split view wrapper `unsplitTabs()`, `gBrowser.splitViews`, panel classes `split-view-panel` / `deck-selected` | Glance |
| `window.openLinkIn` | Shift+click → Glance |
| `window.browserDOMWindow.openURI` with `OPEN_EXTERNAL` | Little Sillage |
| `Browser:Stop` command | Escape closes a Glance card |
| `gBrowser.addTabsProgressListener` (`onLocationChange`, `LOCATION_CHANGE_SAME_DOCUMENT` flag) | Visits, placeholders, container checks, resetting `pageEngaged` |
| Chrome `keydown` / `mousedown` listeners see events aimed at a remote page with the `<browser>` as target | `pageEngaged` (has the user interacted with the page) |
| `TabAttrModified` `detail.changed` | Deciding when the sidebar needs a render |
| `windowGlobal.drawSnapshot` | Switcher thumbnails |
| `browsingContext.sessionHistory` (`index`, `getEntryAtIndex`), `browser.gotoIndex`, `canGoBack` | Double-click: back to a tab's first page |
| `#userContext-icons` (`#userContext-label`, `#userContext-indicator`, `identity-color-*` classes from `usercontext.css`) | Container label, moved above the address bar |
| `gBrowser.getIcon` (a data URI), tab `image` attribute (`moz-remote-image://?url=<data URI>`), `page-icon:` | Favicons and their cache |
| `#navigator-toolbox`, `#TabsToolbar`, `#tabbrowser-tabbox`, `#tabbrowser-tabpanels` | Layout |

## Other services

| Dependency | Used for |
|---|---|
| `ContextualIdentityService` (`moz-src:///toolkit/components/contextualidentity/…`; `create`, `update`, `getPublicIdentityFromId`, colors of `CONTAINER_COLORS`) | Profiles as containers |
| `Services.clipboard.getData` with an `nsITransferable`, `nsIClipboardHelper.copyString` | Board copy / paste, copying URLs |
| `resource://services-sync/` (`SyncEngine`, `Store`, `Tracker`, `CryptoWrapper`, `Weave.Service`) | Sync engine |
| `MigrationUtils.showMigrationWizard` | Import from other browsers |
| `IOUtils`, `PathUtils`, `Sqlite.sys.mjs` | Files; merging separate profiles left over from older versions |
| Extension widgets in `#nav-bar`, the extensions panel (`#unified-extensions-button`, `.unified-extensions-item-name`) | Pinned extensions per workspace |

## Preferences (`profile/user.js`)

Session restore on demand, tab layer cache (3), vertical tabs and the sidebar revamp off, containers on,
Picture-in-Picture when leaving a tab, DRM on, no new tab page, no default-browser check.

## After a Firefox update

1. `make test`; failures usually point at the internal that changed.
2. Read `sillage.log` in the profile for exceptions at startup.
3. Check this list against the Firefox release notes and the changed files on searchfox.

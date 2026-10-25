// Sillage profile preferences (re-applied on every start).

// Session and tabs
user_pref("browser.startup.page", 3);
user_pref("browser.tabs.closeWindowWithLastTab", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
user_pref("browser.warnOnQuitShortcut", false);
user_pref("browser.sessionstore.warnOnQuit", false);
user_pref("browser.tabs.hoverPreview.enabled", false);

// New tab and home page: Sillage uses its own command palette
user_pref("browser.newtabpage.enabled", false);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("trailhead.firstrun.didSeeAboutWelcome", true);
user_pref("browser.shell.checkDefaultBrowser", false);

// Native UI replaced by the Sillage sidebar
user_pref("browser.toolbars.bookmarks.visibility", "never");
user_pref("sidebar.revamp", false);
user_pref("sidebar.verticalTabs", false);
user_pref("browser.tabs.inTitlebar", 0);
// Fullscreen: keep toolbars (Sillage manages its sidebar itself)
user_pref("browser.fullscreen.autohide", false);

// DRM playback (Spotify, Netflix…)
user_pref("media.eme.enabled", true);
user_pref("media.gmp-widevinecdm.enabled", true);
user_pref("media.gmp-widevinecdm.visible", true);
// Picture-in-Picture starts automatically when leaving a tab that plays a video
user_pref("media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled", true);
// No "Speech Dispatcher is required" notification when the system has no speech synthesis
user_pref("media.webspeech.synth.dont_notify_on_error", true);

// Containers back Sillage profiles
user_pref("privacy.userContext.enabled", true);
user_pref("privacy.userContext.ui.enabled", true);
user_pref("privacy.userContext.newTabContainerOnLeftClick.enabled", false);

// Linux: native file picker through the XDG portal
user_pref("widget.use-xdg-desktop-portal.file-picker", 1);
// Sync Sillage data (workspaces, pinned items, boards, profiles) with the Firefox Account
user_pref("services.sync.engine.sillage", true);

// Sillage — an Arc-style interface injected into the Firefox browser window.
(() => {
  "use strict";
  if (window.Sillage) return;
  // Popup windows (OAuth, payments…) have no toolbar: leave them untouched.
  if (!window.toolbar.visible) return;

  const HTML = "http://www.w3.org/1999/xhtml";
  const doc = document;
  const log = window.sillageLog || (() => {});
  const shared = window.sillageShared;
  const WS_KEY = "sillage-ws", ITEM_KEY = "sillage-item", BLANK_KEY = "sillage-blank";
  const DATA_PATH = PathUtils.join(PathUtils.profileDir, "sillage.json");
  const HIST_PATH = PathUtils.join(PathUtils.profileDir, "sillage-history.json");
  const ICONS_PATH = PathUtils.join(PathUtils.profileDir, "sillage-icons.json");
  const IS_MAC = AppConstants.platform === "macosx";
  const accel = e => (IS_MAC ? e.metaKey : e.ctrlKey);
  const { ContextualIdentityService } = ChromeUtils.importESModule("moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs");
  // Firefox Sync engine (lives as long as the application, unlike this window).
  const SillageSync = ChromeUtils.importESModule("chrome://sillage/content/sillage-sync.sys.mjs");

  /* ---------- utilities ---------- */

  function h(tag, attrs = {}, ...kids) {
    const e = doc.createElementNS(HTML, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
    return e;
  }
  const uid = () => crypto.randomUUID().slice(0, 8);
  const $ = sel => doc.querySelector(sel);

  function host(url) {
    try {
      const u = new URL(url);
      return u.host.replace(/^www\./, "") || url;
    } catch { return url || ""; }
  }
  function hueOf(str) { let x = 0; for (const c of str) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M7 7l10 10M17 7L7 17"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    expand: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    sound: '<path d="M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6"/>',
    mute: '<path d="M4 10v4h4l5 4V6L8 10zM16 10l4 4M20 10l-4 4"/>',
    back: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
    undo: '<path d="M9 13L4 8l5-5M4 8h10.5a5.5 5.5 0 0 1 0 11H10"/>',
    redo: '<path d="M15 13l5-5-5-5M20 8H9.5a5.5 5.5 0 0 0 0 11H14"/>',
    cmd: '<path d="M5 7l5 5-5 5M12 17h7"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 3 2.5 14 0 17M12 3.5c-2.5 3-2.5 14 0 17"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    board: '<path d="M5 4h10l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 16h5"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>',
    cursor: '<path d="M6 4l12 7-5.5 1.5L10 18z"/>',
    text: '<path d="M6 6h12M12 6v13M9 19h6"/>',
    line: '<path d="M5 19L19 5"/>',
    arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  };
  function icon(name, cls = "") {
    const e = h("span", { class: "sl-icon " + cls });
    // innerHTML is not allowed in the chrome document, so the SVG is parsed instead.
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${ICONS[name]}</svg>`, "image/svg+xml").documentElement;
    e.append(doc.importNode(svg, true));
    return e;
  }

  /* ---------- persistent data (shared across windows) ---------- */

  const DEFAULT_PROFILE = "default";

  function defaults() {
    return {
      version: 2,
      // A profile is a Firefox container (separate cookies and sessions) plus its own palette history.
      profiles: [{ id: DEFAULT_PROFILE, name: "Personal", userContextId: 0, favorites: [] }],
      workspaces: [{ id: uid(), name: "Personal", icon: "🏠", hue: 250, profile: DEFAULT_PROFILE, pinned: [] }],
      lastWs: null,
      settings: { sidebarVisible: true, sidebarWidth: 270, archiveHours: 168, littleWindow: true },
    };
  }

  function migrate(d) {
    // v1: favorites were global; v2 moves them into the default profile.
    if (!d.profiles) {
      d.profiles = [{ id: DEFAULT_PROFILE, name: "Personal", userContextId: 0, favorites: d.favorites || [] }];
      delete d.favorites;
    }
    // Early builds used "perso" as the default profile id.
    const legacy = d.profiles.find(p => p.id === "perso");
    if (legacy) {
      legacy.id = DEFAULT_PROFILE;
      for (const w of d.workspaces) if (w.profile === "perso") w.profile = DEFAULT_PROFILE;
      d.legacyProfileId = true;
    }
    for (const w of d.workspaces) if (!d.profiles.some(p => p.id === w.profile)) w.profile = d.profiles[0].id;
    d.version = 2;
    return d;
  }

  async function loadData() {
    if (!shared.ready) {
      shared.ready = (async () => {
        let d;
        try { d = await IOUtils.readJSON(DATA_PATH); } catch { d = null; }
        const def = defaults();
        d = migrate(Object.assign(def, d || {}));
        d.settings = Object.assign(defaults().settings, d.settings);
        // (def is the object returned by Object.assign above: take fresh defaults.)
        if (!Array.isArray(d.workspaces) || !d.workspaces.length) d.workspaces = defaults().workspaces;
        shared.data = d;
        shared.persist = () => IOUtils.writeJSON(DATA_PATH, shared.data, { tmpPath: DATA_PATH + ".tmp" });
        try { shared.hist = await IOUtils.readJSON(HIST_PATH); } catch { shared.hist = {}; }
        try { shared.icons = await IOUtils.readJSON(ICONS_PATH); } catch { shared.icons = {}; }
        // Icons used to be kept on pinned items, sometimes as long data URIs (synced): move them to the cache.
        const moveIcons = list => {
          for (const n of list || []) {
            if (n.type === "folder") moveIcons(n.children);
            else if (n.icon && !/^https?:/.test(n.icon)) {
              const ic = plainIcon(n.icon);
              if (ic && n.url) shared.icons[iconKey(n.url)] ??= ic;
              delete n.icon;
            }
          }
        };
        for (const p of d.profiles) moveIcons(p.favorites);
        for (const w of d.workspaces) moveIcons(w.pinned);
        if (d.legacyProfileId) {
          if (shared.hist.perso) { shared.hist[DEFAULT_PROFILE] = shared.hist.perso; delete shared.hist.perso; }
          delete d.legacyProfileId;
        }
      })();
    }
    await shared.ready;
    return shared.data;
  }

  function save() {
    try { boardCommit(); } catch (e) { log("board history " + e); }
    clearTimeout(shared.saveTimer);
    shared.saveTimer = setTimeout(() => shared.persist().catch(e => log("save " + e)), 300);
    try { SillageSync.dataSaved(D); } catch (e) { log("sync " + e); }
    for (const w of shared.windows) if (w !== window) w.Sillage?.render();
  }

  let D; // persistent data
  let activeWs; // active workspace of THIS window
  let sidebarVisible = true; // per window; the last choice is the default for new windows
  let little = false; // Little Sillage window (external links), see below
  shared.littleWindows ||= new WeakSet();

  const wsById = id => D.workspaces.find(w => w.id === id);
  const curWs = () => wsById(activeWs) || D.workspaces[0];
  const profById = id => D.profiles.find(p => p.id === id) || D.profiles[0];
  const profOf = wsId => profById(wsById(wsId)?.profile);
  const curProf = () => profOf(activeWs);

  /* Pinned tree: { type: "item", id, url, title, customTitle } | { type: "folder", id, name, open, children: [node] }
     Folders nest to any depth. Favorites (the top grid) belong to a profile; pinned items belong to a workspace. */
  function* walkTree(list, w, folder = null) {
    for (const n of list) {
      if (n.type === "folder") yield* walkTree(n.children, w, n);
      else yield { item: n, list, ws: w, profile: profById(w.profile), folder };
    }
  }
  function* walkItems() {
    for (const p of D.profiles) for (const it of p.favorites) yield { item: it, list: p.favorites, ws: null, profile: p, folder: null };
    for (const w of D.workspaces) yield* walkTree(w.pinned, w);
  }
  function findItem(id) { for (const r of walkItems()) if (r.item.id === id) return r; return null; }
  /* A folder anywhere in the pinned trees: { w, list (its parent's children), i, f, parent }. */
  function findFolder(id) {
    const search = (list, w, parent) => {
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (n.type !== "folder") continue;
        if (n.id === id) return { w, list, i, f: n, parent };
        const r = search(n.children, w, n);
        if (r) return r;
      }
      return null;
    };
    for (const w of D.workspaces) { const r = search(w.pinned, w, null); if (r) return r; }
    return null;
  }
  /* Is folder `id` the folder `ancestor` or inside it? */
  function folderWithin(id, ancestor) {
    for (let r = findFolder(id); r; r = r.parent && findFolder(r.parent.id)) if (r.f.id === ancestor) return true;
    return false;
  }

  /* ---------- favicon cache ----------
     Firefox hands tab icons out as data: URIs (or moz-remote-image:// wrapping one), which only live as long
     as the tab. The last icon seen for each site is kept in a local file (not synced: it is rebuilt by
     browsing), so unloaded pinned items, favorites, the palette and the switcher keep their icons. */

  const iconKey = url => { try { return new URL(url).host; } catch { return ""; } };
  function plainIcon(ic) {
    if (!ic) return null;
    if (ic.startsWith("moz-remote-image:")) { try { ic = new URL(ic).searchParams.get("url"); } catch { return null; } }
    return ic && /^(data:image\/|https?:)/.test(ic) && ic.length < 32768 ? ic : null;
  }
  const cachedIcon = url => (/^https?:/.test(url) && shared.icons?.[iconKey(url)]) || null;
  let iconSaveTimer;
  function rememberIcon(t) {
    const url = tabUrl(t), key = iconKey(url), ic = plainIcon(gBrowser.getIcon(t) || t.getAttribute("image"));
    if (!/^https?:/.test(url) || !key || !ic || shared.icons[key] === ic) return;
    const I = shared.icons;
    delete I[key];
    I[key] = ic; // most recent last
    const keys = Object.keys(I);
    if (keys.length > 800) for (const k of keys.slice(0, keys.length - 700)) delete I[k];
    clearTimeout(iconSaveTimer);
    iconSaveTimer = setTimeout(() => IOUtils.writeJSON(ICONS_PATH, I, { tmpPath: ICONS_PATH + ".tmp" }).catch(() => {}), 2000);
  }

  /* ---------- per-profile history (palette) ---------- */

  let histSaveTimer;
  function recordVisit(t, url) {
    if (!/^https?:/.test(url)) return;
    const pid = tabProfile(t)?.id;
    if (!pid) return;
    const H = shared.hist;
    const list = (H[pid] ||= []);
    let e = list.find(x => x.u === url);
    if (!e) { e = { u: url, t: "", n: 0, l: 0 }; list.push(e); }
    e.n++;
    e.l = Date.now();
    if (t.label && t.label !== url) e.t = t.label;
    if (list.length > 5000) { list.sort((a, b) => b.l - a.l); list.length = 4000; }
    clearTimeout(histSaveTimer);
    histSaveTimer = setTimeout(() => IOUtils.writeJSON(HIST_PATH, H, { tmpPath: HIST_PATH + ".tmp" }).catch(() => {}), 2000);
  }

  /* ---------- tabs <-> workspaces / pinned items ---------- */

  const getVal = (t, k) => { try { return SessionStore.getCustomTabValue(t, k) || ""; } catch { return ""; } };
  const setVal = (t, k, v) => { try { v ? SessionStore.setCustomTabValue(t, k, v) : SessionStore.deleteCustomTabValue(t, k); } catch (e) { log("setVal " + e); } };

  const tabItemId = t => getVal(t, ITEM_KEY);
  function tabItem(t) { const id = tabItemId(t); return id ? findItem(id) : null; }
  /* Where a tab lives: a workspace id, or "*<profile id>" for a favorite. */
  function tabWs(t) {
    const r = tabItem(t);
    if (r) return r.ws ? r.ws.id : "*" + r.profile.id;
    return getVal(t, WS_KEY) || "";
  }
  function tabProfile(t) {
    const w = tabWs(t);
    if (!w) return null;
    return w.startsWith("*") ? profById(w.slice(1)) : profOf(w);
  }
  /* Is the tab shown in this workspace? (its own tabs plus its profile's favorites) */
  function inView(t, wsId = activeWs) {
    const w = tabWs(t);
    return w === wsId || w === "*" + profOf(wsId).id;
  }
  const alive = t => t && t.isConnected && !t.closing;
  const tabUrl = t => t.linkedBrowser?.currentURI?.spec || "";
  function tabForItem(id) { for (const t of gBrowser.tabs) if (alive(t) && tabItemId(t) === id) return t; return null; }
  const tabIds = new WeakMap(), tabsById = new Map();
  function tabId(t) {
    let id = tabIds.get(t);
    if (!id) { id = uid(); tabIds.set(t, id); }
    tabsById.set(id, t);
    return id;
  }

  /* Placeholder tab kept behind the board when a workspace has nothing open (Firefox always needs a
     selected tab). It is never listed; the board is shown instead. The mark goes away once a page loads. */
  const EMPTY_URLS = new Set(["about:blank", "about:newtab", "about:home"]);
  function isBlank(t) {
    return alive(t) && getVal(t, BLANK_KEY) === "1" && EMPTY_URLS.has(tabUrl(t));
  }
  /* Firefox's own new tab page (opened e.g. after closing the last tab of the window) is a placeholder too.
     about:blank only counts at startup: a freshly opened tab is about:blank until its page starts loading. */
  function adoptEmptyTab(t, { startup = false } = {}) {
    const url = tabUrl(t);
    if (!alive(t) || getVal(t, BLANK_KEY) || t.hasAttribute("pending")) return false;
    if (!(url === "about:newtab" || url === "about:home" || (startup && url === "about:blank"))) return false;
    if (t.linkedBrowser?.canGoBack) return false;
    setVal(t, BLANK_KEY, "1");
    return true;
  }
  function placeholder(wsId) {
    const existing = gBrowser.tabs.find(t => isBlank(t) && tabWs(t) === wsId);
    if (existing) return existing;
    const t = addTab("about:blank", profOf(wsId).userContextId);
    setVal(t, WS_KEY, wsId);
    setVal(t, BLANK_KEY, "1");
    return t;
  }

  function todayTabs(wsId) {
    return gBrowser.tabs.filter(t => alive(t) && !tabItemId(t) && tabWs(t) === wsId && t !== glance?.tab);
  }

  /* Opens a tab in the given profile's container. */
  function addTab(url, ucid, { background = true } = {}) {
    return gBrowser.addTrustedTab(url, { inBackground: background, userContextId: ucid, skipAnimation: true });
  }

  /* A tab cannot change container: reopen it in the right one, at the same position. */
  function rehome(t, ucid) {
    if ((t.userContextId || 0) === ucid) return t;
    const n = addTab(tabUrl(t) || "about:blank", ucid);
    for (const k of [WS_KEY, ITEM_KEY]) setVal(n, k, getVal(t, k));
    gBrowser.moveTabAfter(n, t);
    const wasSelected = t.selected;
    if (wasSelected) { if (n.hidden) gBrowser.showTab(n); gBrowser.selectedTab = n; }
    gBrowser.removeTab(t, { animate: false });
    return n;
  }

  /* Tabs of other workspaces are hidden using Firefox's native tab hiding. */
  let switching = false;
  function applyVisibility() {
    if (little) return;
    for (const t of gBrowser.tabs) {
      if (!alive(t)) continue;
      const visible = inView(t);
      if (visible && t.hidden) gBrowser.showTab(t);
      else if (!visible && !t.hidden && !t.selected) gBrowser.hideTab(t);
    }
  }

  const lastSelected = new Map(); // wsId -> tab

  function switchWs(id, { tab = null, animate = true } = {}) {
    if (!wsById(id)) return;
    if (glance) closeGlance({ select: false });
    const from = activeWs;
    const cur = gBrowser.selectedTab;
    if (from && inView(cur, from)) lastSelected.set(from, cur);
    activeWs = id;
    D.lastWs = id;
    (D.lastWsByProfile ||= {})[wsById(id).profile] = id;
    let target = tab;
    if (!target) {
      const remembered = lastSelected.get(id);
      if (alive(remembered) && inView(remembered, id)) target = remembered;
    }
    if (!target) {
      // The workspace's own tabs (favorites only if they were the last thing open there).
      const mine = gBrowser.tabs.filter(t => alive(t) && tabWs(t) === id && !isBlank(t)).sort((a, b) => b.lastAccessed - a.lastAccessed);
      target = mine[0] || placeholder(id);
    }
    switching = true;
    try {
      if (target.hidden) gBrowser.showTab(target);
      gBrowser.selectedTab = target;
      applyVisibility();
    } finally { switching = false; }
    if (animate && from && from !== id) slide(D.workspaces.findIndex(w => w.id === id) > D.workspaces.findIndex(w => w.id === from));
    save();
    render();
    // The board belongs to the workspace it was opened in: it only shows in the new one when there is
    // nothing open there.
    if (isBlank(target)) openBoard();
    else if (boardOpen) closeBoard();
  }

  /* Previous / next workspace (no wrap-around). */
  function stepWs(dir) {
    const i = D.workspaces.findIndex(w => w.id === activeWs);
    const next = D.workspaces[i + dir];
    if (next) switchWs(next.id);
  }

  function selectTab(t) {
    // Clicking the tab that is already shown under the board goes back to it.
    if (boardOpen && t === gBrowser.selectedTab && !isBlank(t)) closeBoard();
    if (inView(t)) {
      if (t.hidden) gBrowser.showTab(t);
      gBrowser.selectedTab = t;
      return;
    }
    const w = tabWs(t);
    if (w.startsWith("*")) {
      // Favorite of another profile: switch to a workspace of that profile.
      const pid = w.slice(1);
      const ws = D.workspaces.find(x => x.id === D.lastWsByProfile?.[pid] && x.profile === pid) || D.workspaces.find(x => x.profile === pid);
      if (ws) switchWs(ws.id, { tab: t });
    } else if (wsById(w)) switchWs(w, { tab: t });
    else { if (t.hidden) gBrowser.showTab(t); gBrowser.selectedTab = t; }
  }

  /* ---------- Ctrl+Shift+→ / ←: recent tabs, Alt+Tab style ----------
     → goes back in time, ← comes back. Arrows only move a cursor in the switcher panel;
     the tab is opened when Ctrl+Shift is released (Escape cancels). */

  let mru = [], cycling = false, cycleList = [], cycleIdx = 0, switcher;

  /* The board takes part in the recent list like a tab: one entry per workspace. */
  const boardKeys = new Map();
  function boardKey(wsId = activeWs) {
    if (!boardKeys.has(wsId)) boardKeys.set(wsId, { boardWs: wsId });
    return boardKeys.get(wsId);
  }
  const isBoardKey = x => !!x?.boardWs;
  const liveEntry = x => (isBoardKey(x) ? !!wsById(x.boardWs) : alive(x));
  // What is on screen: the board when it is open, otherwise the selected tab.
  const shownEntry = () => (boardOpen ? boardKey() : gBrowser.selectedTab);

  function touchMru(t) {
    if (cycling || !liveEntry(t) || t === glance?.tab) return;
    mru = [t, ...mru.filter(x => x !== t && liveEntry(x))].slice(0, 100);
    if (!isBoardKey(t)) updateSuccessor();
  }

  /* Closing the active tab returns to the previously active tab (same workspace), not its neighbour. */
  function updateSuccessor() {
    const cur = gBrowser.selectedTab;
    const prev = mru.find(x => x !== cur && alive(x) && inView(x));
    try { gBrowser.setSuccessor(cur, prev || null); } catch (e) { log("successor " + e); }
  }

  function cycleStep(dir) {
    if (!cycling) {
      // Only the tabs of the current workspace (its own tabs and its profile's favorites).
      cycleList = mru.filter(t => (isBoardKey(t) ? t.boardWs === activeWs : alive(t) && !isBlank(t) && inView(t)));
      const cur = shownEntry();
      cycleList = [cur, ...cycleList.filter(t => t !== cur)];
      if (cycleList.length < 2) return;
      cycling = true;
      cycleIdx = 1; // first press, in either direction: the previous tab
    } else {
      cycleIdx = Math.max(0, Math.min(cycleList.length - 1, cycleIdx + dir));
    }
    drawSwitcher();
  }

  function endCycle({ cancel = false } = {}) {
    if (!cycling) return;
    const t = cycleList[cycleIdx];
    cycling = false;
    switcher.hidden = true;
    if (!cancel && cycleIdx > 0 && isBoardKey(t)) openBoard();
    else if (!cancel && cycleIdx > 0 && alive(t)) selectTab(t);
    else touchMru(shownEntry());
  }

  /* Thumbnails: captured while a tab is displayed, shown in the switcher. */
  const thumbs = new WeakMap();
  function captureThumb(t) {
    if (!alive(t) || !t.selected || t.hasAttribute("busy")) return;
    const wg = t.linkedBrowser?.browsingContext?.currentWindowGlobal;
    if (!wg) return;
    const box = t.linkedBrowser.getBoundingClientRect();
    if (!box.width) return;
    wg.drawSnapshot(null, 320 / box.width, "white").then(bmp => {
      const old = thumbs.get(t);
      old?.close?.();
      thumbs.set(t, bmp);
    }).catch(() => {});
  }
  function scheduleThumb(t) {
    for (const ms of [700, 3000]) setTimeout(() => captureThumb(t), ms);
  }

  /* Switcher: current tab on the left, older tabs towards the right. */
  function drawSwitcher() {
    const box = $("#tabbrowser-tabbox").getBoundingClientRect();
    switcher.style.setProperty("--sw-x", `${box.left + box.width / 2}px`);
    switcher.style.setProperty("--sw-y", `${box.top + 24}px`);
    const VISIBLE = Math.max(3, Math.min(7, Math.floor((box.width - 40) / 186)));
    const n = cycleList.length;
    const first = Math.max(0, Math.min(cycleIdx - Math.floor(VISIBLE / 2), n - VISIBLE));
    const cards = [];
    for (let i = first; i < Math.min(n, first + VISIBLE); i++) {
      const t = cycleList[i];
      if (isBoardKey(t)) {
        cards.push(h("div", { class: `sl-sw-card board${i === cycleIdx ? " sel" : ""}${i === 0 ? " origin" : ""}` },
          h("div", { class: "sl-sw-preview empty" },
            h("div", { class: "sl-sw-icon" }, h("img", { class: "sl-fav", src: "chrome://sillage/content/logo-mark.svg", alt: "" }))),
          h("span", { class: "sl-sw-title", text: "Board" })));
        continue;
      }
      const w = wsById(tabWs(t));
      const bmp = thumbs.get(t);
      let preview;
      if (bmp) {
        preview = h("canvas", { class: "sl-sw-thumb", width: bmp.width, height: bmp.height });
        try { preview.getContext("2d").drawImage(bmp, 0, 0); } catch { preview = null; }
      }
      cards.push(h("div", { class: `sl-sw-card${i === cycleIdx ? " sel" : ""}${i === 0 ? " origin" : ""}` },
        h("div", { class: `sl-sw-preview${preview ? "" : " empty"}` },
          preview,
          h("div", { class: "sl-sw-icon" }, favicon(tabUrl(t), tabIcon(t)))),
        h("span", { class: "sl-sw-title", text: t.label || host(tabUrl(t)) }),
        w && w.id !== activeWs && h("span", { class: "sl-sw-ws", title: w.name, text: w.icon })));
    }
    const more = Math.max(0, n - (first + VISIBLE));
    switcher.replaceChildren(
      h("div", { class: "sl-sw-cards" }, cards, more > 0 && h("div", { class: "sl-sw-more", text: `+${more}` })),
      h("div", { class: "sl-sw-footer" },
        h("span", { text: cycleIdx === 0 ? "Current tab — release to stay" : `${cycleIdx} tab${cycleIdx > 1 ? "s" : ""} back — release to open, Esc to cancel` }),
        h("span", { class: "sl-sw-dots" }, cycleList.slice(0, Math.min(n, 15)).map((_, i) => h("i", { class: i === cycleIdx ? "on" : "" })))));
    switcher.hidden = false;
  }

  /* ---------- Ctrl+Shift+↑ / ↓: walk through the sidebar ---------- */

  function sidebarEntries() {
    const ws = curWs(), out = [];
    for (const it of curProf().favorites) out.push({ item: it });
    const walk = list => { for (const n of list) n.type === "folder" ? n.open && walk(n.children) : out.push({ item: n }); };
    walk(ws.pinned);
    out.push({ board: true }); // the orb, between pinned items and today tabs
    for (const t of todayTabs(ws.id)) if (!isBlank(t)) out.push({ tab: t });
    return out;
  }

  function stepSidebar(dir) {
    const list = sidebarEntries();
    if (!list.length) return;
    const sel = gBrowser.selectedTab, selItem = tabItemId(sel);
    let i = list.findIndex(e => (e.board ? boardOpen : !boardOpen && (e.tab ? e.tab === sel : e.item.id === selItem)));
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    const e = list[i];
    if (e.board) openBoard();
    else if (e.tab) selectTab(e.tab);
    else openItem(e.item.id);
  }

  /* ---------- tab and pinned item actions ---------- */

  function newTab(url, { background = false, ws = activeWs } = {}) {
    const t = addTab(url, profOf(ws).userContextId, { background });
    setVal(t, WS_KEY, ws);
    const first = todayTabs(ws).find(x => x !== t);
    if (first) gBrowser.moveTabBefore(t, first);
    if (!background) selectTab(t);
    return t;
  }

  function openItem(id, { background = false } = {}) {
    const r = findItem(id);
    if (!r) return;
    let t = tabForItem(id);
    if (!t) {
      t = addTab(r.item.url, r.profile.userContextId);
      setVal(t, ITEM_KEY, id);
      if (r.ws) setVal(t, WS_KEY, r.ws.id);
    }
    if (!background) selectTab(t);
    render();
  }

  function itemFromTab(t) {
    return { type: "item", id: uid(), url: tabUrl(t), title: t.label };
  }

  function removeFromTree(id) {
    const r = findItem(id);
    if (r) r.list.splice(r.list.indexOf(r.item), 1);
    return r?.item;
  }

  function destList(dest) {
    const w = wsById(dest.wsId || activeWs);
    if (dest.list === "favorites") return profById(w.profile).favorites;
    return dest.folderId ? findFolder(dest.folderId)?.f.children : w.pinned;
  }

  /* Destination: { list: "favorites" | "pinned" | "today", wsId, folderId, index, beforeTab, afterTab } */
  function moveTab(t, dest) {
    const wsId = dest.wsId || activeWs;
    const r = tabItem(t);
    if (dest.list !== "today" && r) return moveItem(r.item.id, dest);
    t = rehome(t, profOf(wsId).userContextId);
    if (dest.list === "today") {
      if (r) { removeFromTree(r.item.id); setVal(t, ITEM_KEY, ""); }
      setVal(t, WS_KEY, wsId);
      if (dest.beforeTab && dest.beforeTab !== t && alive(dest.beforeTab)) gBrowser.moveTabBefore(t, dest.beforeTab);
      else if (dest.afterTab && dest.afterTab !== t && alive(dest.afterTab)) gBrowser.moveTabAfter(t, dest.afterTab);
      else if (!dest.beforeTab && !dest.afterTab) { const f = todayTabs(wsId).find(x => x !== t); if (f) gBrowser.moveTabBefore(t, f); }
    } else {
      const item = itemFromTab(t);
      insertItem(item, { ...dest, wsId });
      setVal(t, ITEM_KEY, item.id);
      setVal(t, WS_KEY, dest.list === "favorites" ? "" : wsId);
    }
    if (!inView(t)) leaveTab(t);
    applyVisibility();
    save();
    render();
    return t;
  }

  function insertItem(item, dest) {
    const arr = destList(dest);
    if (!arr) return;
    const i = dest.index ?? arr.length;
    arr.splice(Math.max(0, Math.min(i, arr.length)), 0, item);
  }

  function moveItem(id, dest) {
    const r = findItem(id);
    if (!r) return;
    const wsId = dest.wsId || activeWs;
    if (dest.list === "today") {
      let t = tabForItem(id);
      if (!t) { t = addTab(r.item.url, r.profile.userContextId); setVal(t, ITEM_KEY, id); }
      return moveTab(t, dest);
    }
    let i = dest.index;
    if (i != null && r.list === destList({ ...dest, wsId }) && r.list.indexOf(r.item) < i) i--;
    removeFromTree(id);
    insertItem(r.item, { ...dest, wsId, index: i });
    let t = tabForItem(id);
    if (t) {
      t = rehome(t, profOf(wsId).userContextId);
      setVal(t, WS_KEY, dest.list === "favorites" ? "" : wsId);
      if (!inView(t)) leaveTab(t);
    }
    applyVisibility();
    save();
    render();
  }

  /* Reorders workspaces (also the Ctrl+1…9 order; synced). */
  function moveWorkspace(id, index) {
    const i = D.workspaces.findIndex(w => w.id === id);
    if (i < 0) return;
    const [w] = D.workspaces.splice(i, 1);
    D.workspaces.splice(Math.min(i < index ? index - 1 : index, D.workspaces.length), 0, w);
    save();
    render();
  }

  /* Moves a folder within its workspace: dest = { folderId (null: top level), index } (or just an index). */
  function moveFolder(id, dest = {}) {
    if (typeof dest === "number") dest = { index: dest };
    const r = findFolder(id);
    if (!r) return;
    if (dest.folderId && folderWithin(dest.folderId, id)) return; // not into itself
    const target = dest.folderId ? findFolder(dest.folderId)?.f.children : r.w.pinned;
    if (!target) return;
    let i = dest.index ?? target.length;
    if (target === r.list && r.i < i) i--;
    r.list.splice(r.i, 1);
    target.splice(Math.max(0, Math.min(i, target.length)), 0, r.f);
    save();
    render();
  }

  /* A tab is leaving the current workspace: select another tab first. */
  function leaveTab(t) {
    if (!t.selected) return;
    const next = gBrowser.tabs.filter(x => alive(x) && x !== t && inView(x)).sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
    if (next) gBrowser.selectedTab = next;
    else gBrowser.selectedTab = placeholder(activeWs);
  }

  function togglePin(t) {
    const r = tabItem(t);
    if (r) moveTab(t, { list: "today", wsId: r.ws?.id || activeWs });
    else moveTab(t, { list: "pinned" });
  }
  function toggleFavorite(t) {
    const r = tabItem(t);
    if (r && !r.ws) moveTab(t, { list: "today" });
    else moveTab(t, { list: "favorites" });
  }

  function deleteItem(id) {
    const t = tabForItem(id);
    removeFromTree(id);
    if (t) gBrowser.removeTab(t);
    save();
    render();
  }

  function resetItem(id) {
    const r = findItem(id), t = tabForItem(id);
    if (r && t) t.linkedBrowser.fixupAndLoadURIString(r.item.url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  }

  /* Back to where the tab started: its pinned URL, or the first page of its history (skipping blank and
     new tab pages). Returns false when it is already there. */
  function backToStart(t) {
    if (!alive(t)) return false;
    const r = tabItem(t);
    if (r) {
      if (!r.item.url || tabUrl(t) === r.item.url) return false;
      resetItem(r.item.id);
      return true;
    }
    const sh = t.linkedBrowser.browsingContext?.sessionHistory;
    if (!sh || sh.index <= 0) return false;
    let i = 0;
    while (i < sh.index && /^about:(blank|newtab|home)/.test(sh.getEntryAtIndex(i).URI.spec)) i++;
    if (i >= sh.index) return false;
    t.linkedBrowser.gotoIndex(i);
    return true;
  }

  function createFolder(wsId = activeWs, name = "New folder", parentId = null) {
    const f = { type: "folder", id: uid(), name, open: true, children: [] };
    const parent = parentId && findFolder(parentId)?.f;
    if (parent) { parent.open = true; parent.children.push(f); }
    else wsById(wsId).pinned.push(f);
    save();
    render();
    return f;
  }

  function clearToday() {
    const tabs = todayTabs(activeWs);
    if (tabs.length) gBrowser.removeTabs(tabs);
  }

  /* Today tabs not viewed for N hours are closed (they remain in history). */
  function archive() {
    if (little) return;
    const hours = D.settings.archiveHours;
    if (!hours) return;
    const cutoff = Date.now() - hours * 3600e3;
    const old = gBrowser.tabs.filter(t => alive(t) && !t.selected && !tabItemId(t) && !t.pinned && t.lastAccessed && t.lastAccessed < cutoff);
    if (old.length) { gBrowser.removeTabs(old, { animate: false }); log(`archived ${old.length} tabs`); }
  }

  /* ---------- profiles & workspaces ---------- */

  const CONTAINER_COLORS = ["blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple"];

  function createProfile(name) {
    const ci = ContextualIdentityService.create(name, "fingerprint", CONTAINER_COLORS[D.profiles.length % CONTAINER_COLORS.length]);
    const p = { id: uid(), name, userContextId: ci.userContextId, favorites: [] };
    D.profiles.push(p);
    save();
    return p;
  }

  /* Containers created by older versions used "turquoise", a color Firefox has since renamed to "cyan":
     such containers had no color (grey label). */
  function fixContainerColors() {
    for (const p of D.profiles) {
      if (!p.userContextId) continue;
      try {
        const ci = ContextualIdentityService.getPublicIdentityFromId(p.userContextId);
        if (ci?.color === "turquoise") ContextualIdentityService.update(p.userContextId, ci.name, ci.icon, "cyan");
      } catch (e) { log("container color " + e); }
    }
  }

  function deleteProfile(id) {
    const p = profById(id);
    if (!p || p.userContextId === 0 || D.workspaces.some(w => w.profile === id)) return false;
    for (const t of gBrowser.tabs.filter(t => alive(t) && (t.userContextId || 0) === p.userContextId)) gBrowser.removeTab(t);
    try { ContextualIdentityService.remove(p.userContextId); } catch (e) { log("remove container " + e); }
    try {
      Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId: p.userContextId });
    } catch (e) { log("clear data " + e); }
    D.profiles.splice(D.profiles.indexOf(p), 1);
    delete shared.hist[id];
    SillageSync.noteDeletion(D, "profile", id);
    save();
    toast(`Profile “${p.name}” deleted`);
    return true;
  }

  /* A previous version ran each profile as a separate Firefox profile in its own window
     (<home>/profiles/<id>, listed in <home>/profiles.json). Everything comes back into this window: each
     such profile becomes a container profile again, with its workspaces, favorites, open tabs and sign-in
     cookies. Extensions, passwords and history stay in its directory, which is left on disk. */
  async function absorbSeparateProfiles() {
    const home = PathUtils.parent(PathUtils.profileDir);
    const regPath = PathUtils.join(home, "profiles.json");
    let reg;
    try { reg = await IOUtils.readJSON(regPath); } catch { return 0; }
    const own = PathUtils.filename(PathUtils.profileDir);
    let absorbed = 0;
    for (const entry of [...(reg.profiles || [])]) {
      if (!entry?.dir || entry.id === "default" || entry.dir === own) continue;
      const dir = PathUtils.join(home, ...entry.dir.split("/"));
      try {
        // Still running in its own window: try again at the next start.
        try { if (Date.now() - (await IOUtils.stat(PathUtils.join(dir, "sillage-alive"))).lastModified < 10e3) continue; } catch {}
        let data = null;
        try { data = await IOUtils.readJSON(PathUtils.join(dir, "sillage.json")); } catch {}
        let inbox = [];
        try { inbox = await IOUtils.readJSON(PathUtils.join(dir, "sillage-inbox.json")); } catch {}
        const tabs = await separateProfileTabs(dir);
        const workspaces = [...(data?.workspaces || []), ...inbox.filter(a => a.type === "workspace" && a.ws).map(a => a.ws)]
          .filter((w, i, all) => all.findIndex(x => x.id === w.id) === i)
          // Untouched default workspace of a fresh profile.
          .filter(w => w.pinned?.length || w.board?.notes?.length || tabs.some(t => t.ws === w.id) || w.name !== "Personal");
        const favorites = data?.profiles?.[0]?.favorites || [];
        if (workspaces.length || favorites.length) {
          const p = D.profiles.find(x => x.name.toLowerCase() === (entry.name || "").toLowerCase() && x.userContextId > 0)
            || createProfile(entry.name || entry.id);
          for (const w of workspaces) if (!wsById(w.id)) D.workspaces.push({ ...w, profile: p.id });
          for (const f of favorites) if (!p.favorites.some(x => x.url === f.url)) p.favorites.push(f);
          for (const t of tabs) {
            if (!wsById(t.ws) || !/^(https?|file):/.test(t.url)) continue;
            const tab = gBrowser.addTrustedTab(t.url, { inBackground: true, userContextId: p.userContextId, createLazyBrowser: true, title: t.title, skipAnimation: true });
            setVal(tab, WS_KEY, t.ws);
          }
          await importSeparateCookies(dir, p.userContextId);
        }
        if (await IOUtils.exists(dir)) await IOUtils.writeJSON(PathUtils.join(dir, "sillage-merged.json"), { into: PathUtils.profileDir, at: Date.now() });
        reg.profiles = reg.profiles.filter(x => x !== entry);
        absorbed++;
        log(`separate profile ${entry.dir} merged back: ${workspaces.length} workspaces, ${tabs.length} tabs`);
      } catch (e) { log("merge profile " + entry.dir + " " + e + "\n" + e.stack); }
    }
    if (absorbed) {
      if (reg.profiles.every(x => x.id === "default" || x.dir === own)) await IOUtils.remove(regPath, { ignoreAbsent: true });
      else await IOUtils.writeJSON(regPath, reg);
      save();
    }
    return absorbed;
  }

  /* Open tabs of a separate profile, from its saved session: [{ url, title, ws }]. */
  async function separateProfileTabs(dir) {
    for (const f of ["sessionstore.jsonlz4", "sessionstore-backups/recovery.jsonlz4", "sessionstore-backups/previous.jsonlz4"]) {
      let session;
      try { session = await IOUtils.readJSON(PathUtils.join(dir, ...f.split("/")), { decompress: true }); } catch { continue; }
      const out = [];
      for (const w of session.windows || []) {
        for (const t of w.tabs || []) {
          const e = t.entries?.[(t.index || t.entries.length) - 1];
          const ws = t.extData?.[WS_KEY];
          if (e?.url && ws && !t.extData?.[ITEM_KEY]) out.push({ url: e.url, title: e.title || "", ws });
        }
      }
      return out;
    }
    return [];
  }

  /* Sign-in cookies of a separate profile, added to a container. */
  async function importSeparateCookies(dir, userContextId) {
    const path = PathUtils.join(dir, "cookies.sqlite");
    if (!(await IOUtils.exists(path))) return 0;
    const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
    const db = await Sqlite.openConnection({ path, readOnly: true });
    let n = 0;
    try {
      const rows = await db.execute("SELECT * FROM moz_cookies WHERE originAttributes = ''");
      for (const r of rows) {
        const col = k => { try { return r.getResultByName(k); } catch { return null; } };
        try {
          Services.cookies.add(col("host"), col("path"), col("name"), col("value"), !!col("isSecure"), !!col("isHttpOnly"), false,
            col("expiry"), { userContextId }, col("sameSite") ?? 0, col("schemeMap") ?? 0, !!col("isPartitionedAttributeSet"));
          n++;
        } catch {}
      }
    } finally { await db.close(); }
    log(`imported ${n} cookies into container ${userContextId}`);
    return n;
  }

  function saveWs({ id, name, icon: ic, hue, profile }) {
    if (id) {
      const w = wsById(id);
      const changed = w.profile !== profile;
      Object.assign(w, { name, icon: ic, hue, profile });
      // Profile changed: reopen the workspace's tabs in the new container.
      if (changed) for (const t of gBrowser.tabs.filter(t => alive(t) && tabWs(t) === id)) rehome(t, profById(profile).userContextId);
      applyVisibility();
    } else {
      const w = { id: uid(), name, icon: ic, hue, profile, pinned: [] };
      D.workspaces.push(w);
      switchWs(w.id);
    }
    save();
    render();
  }

  async function deleteWs(id, { confirm = true } = {}) {
    const w = wsById(id);
    if (!w || D.workspaces.length < 2) return;
    const tabs = gBrowser.tabs.filter(t => alive(t) && tabWs(t) === id);
    if (confirm && !Services.prompt.confirm(window, "Sillage", `Delete “${w.name}”, its pinned items and its ${tabs.length} open tabs?`)) return;
    if (activeWs === id) switchWs(D.workspaces.find(x => x.id !== id).id);
    gBrowser.removeTabs(tabs);
    D.workspaces.splice(D.workspaces.indexOf(w), 1);
    SillageSync.noteDeletion(D, "workspace", id);
    save();
    render();
  }

  /* ---------- user interface ---------- */

  let side, scroll, favBox, pinBox, todayBox, wsBar, wsTitle, peekZone, toastEl, orb;

  function buildUi() {
    doc.documentElement.classList.add("sillage");
    const browserBox = $("#browser");

    favBox = h("div", { id: "sl-favorites", class: "sl-zone", "data-list": "favorites" });
    wsTitle = h("div", { id: "sl-ws-title" });
    pinBox = h("div", { id: "sl-pinned", class: "sl-zone", "data-list": "pinned" });
    orb = h("button", { id: "sl-orb", title: "Board — sticky notes for this workspace", onclick: toggleBoard },
      h("img", { src: "chrome://sillage/content/logo-mark.svg", alt: "" }), h("span", { class: "sl-orb-count" }));
    todayBox = h("div", { id: "sl-today", class: "sl-zone", "data-list": "today" });
    const newTabRow = h("div", { id: "sl-newtab", class: "sl-row", onclick: () => openPalette("new") },
      icon("plus"), h("span", { class: "sl-title", text: "New Tab" }), h("kbd", { text: IS_MAC ? "⌘T" : "Ctrl T" }));
    const divider = h("div", { class: "sl-divider" }, h("span", { class: "sl-line" }), orb, h("span", { class: "sl-line" }),
      h("button", { class: "sl-clear", text: "Clear", title: "Close today tabs", onclick: clearToday }));
    scroll = h("div", { id: "sl-scroll" }, favBox, wsTitle, pinBox, divider, newTabRow, todayBox);

    wsBar = h("div", { id: "sl-ws-bar" });
    const bottom = h("div", { id: "sl-bottom" },
      h("button", { class: "sl-btn", title: `Toggle sidebar (${IS_MAC ? "⌘S" : "Ctrl+S"})`, onclick: toggleSidebar }, icon("sidebar")),
      wsBar,
      h("button", { class: "sl-btn", title: "New workspace", onclick: () => openWsEditor(null) }, icon("plus")));
    const resizer = h("div", { id: "sl-resizer" });

    side = h("div", { id: "sl-sidebar" });
    browserBox.prepend(side);
    side.append(gNavToolbox, scroll, bottom, resizer);
    // The container label (shown by Firefox at the end of the address bar) would take the room of the URL
    // in the narrow sidebar: it moves to the free space of the toolbar's top row. Firefox still updates it.
    const ucIcons = $("#userContext-icons");
    if (ucIcons) $("#nav-bar").append(ucIcons);

    peekZone = h("div", { id: "sl-peek" });
    toastEl = h("div", { id: "sl-toast" });
    switcher = h("div", { id: "sl-switcher", hidden: true });
    doc.body.append(peekZone, toastEl, switcher);

    wireSidebar();
    wireResize(resizer);
    wirePeek();
    wireExtensionPins();
    migrateExtensionPins();
    buildPalette();
    buildWsEditor();
    buildBoard();
  }

  /* A site's icon: the given one, then the cached one, then Firefox's favicon database, then a letter.
     While loading, a known icon stays visible (dimmed); the spinner only shows when there is none yet. */
  function favicon(url, iconUrl, busy = false) {
    const web = /^https?:/.test(url);
    const known = iconUrl || cachedIcon(url);
    if (busy && !known) return h("span", { class: "sl-fav sl-spin" });
    const srcs = [...new Set([iconUrl, cachedIcon(url), web && `page-icon:${url}`].filter(Boolean))];
    const hs = host(url);
    const letter = () => h("span", { class: `sl-fav sl-letter${busy ? " loading" : ""}`, style: `--lh:${hueOf(hs)}`, text: (hs[0] || "?").toUpperCase() });
    if (!srcs.length) return web ? letter() : icon("globe", "sl-fav");
    let i = 0;
    const img = h("img", { class: `sl-fav${busy ? " loading" : ""}`, src: srcs[0] });
    img.addEventListener("error", () => { if (++i < srcs.length) img.src = srcs[i]; else img.replaceWith(letter()); });
    return img;
  }

  const tabIcon = t => t.getAttribute("image") || gBrowser.getIcon(t) || null;

  function btn(name, title, act) { return h("button", { class: "sl-rbtn", title, "data-act": act }, icon(name)); }

  function rowForTab(t, list, index, extra = {}) {
    const r = tabItem(t);
    const title = r?.item.customTitle || t.label || host(tabUrl(t));
    const drifted = r && r.item.url && tabUrl(t) && tabUrl(t) !== r.item.url && !t.hasAttribute("pending");
    const audio = t.hasAttribute("soundplaying") || t.hasAttribute("muted");
    const enter = freshTabs.delete(t);
    return h("div", {
      class: `sl-row sl-tab${t.selected ? " active" : ""}${t.hasAttribute("pending") ? " unloaded" : ""}${enter ? " sl-enter" : ""}`,
      draggable: "true", "data-tab": tabId(t), "data-item": r?.item.id, "data-list": list, "data-index": index,
      "data-folder": extra.folder, title: `${title}\n${tabUrl(t)}`,
    },
    favicon(tabUrl(t), tabIcon(t), t.hasAttribute("busy")),
    h("span", { class: "sl-title", text: title }),
    drifted && btn("back", "Back to pinned URL", "reset"),
    audio && h("button", { class: "sl-rbtn on", title: "Mute", "data-act": "mute" }, icon(t.hasAttribute("muted") ? "mute" : "sound")),
    btn("x", list === "today" ? "Close" : "Unload", "close"));
  }

  function rowForItem(item, list, index, folder) {
    const t = tabForItem(item.id);
    if (t) return rowForTab(t, list, index, { folder });
    return h("div", {
      class: "sl-row sl-tab unloaded", draggable: "true", "data-item": item.id, "data-list": list,
      "data-index": index, "data-folder": folder, title: `${item.customTitle || item.title}\n${item.url}`,
    },
    favicon(item.url, item.icon),
    h("span", { class: "sl-title", text: item.customTitle || item.title || host(item.url) }));
  }

  let renderQueued = false, renderPending = false, dragging = null, editing = false;
  const freshTabs = new WeakSet(); // opened since the last render: animated once
  const openedFolders = new Set(); // folders just opened: their content slides in once
  /* Changes coming from pages (titles, icons, loading, navigation) are grouped: at most a few renders
     per second, and none for tabs the sidebar does not show. User actions still render on the next frame. */
  let lastRender = 0, laterTimer = 0, renderCount = 0;
  function renderLater() {
    if (laterTimer || renderQueued) return;
    laterTimer = setTimeout(() => { laterTimer = 0; render(); }, Math.max(0, lastRender + 250 - performance.now()));
  }
  const SHOWN_ATTRS = new Set(["label", "image", "busy", "soundplaying", "muted", "pending", "activemedia-blocked", "crashed", "pictureinpicture"]);
  function onTabAttr(e) {
    const t = e.target;
    if (e.detail?.changed?.includes("image")) rememberIcon(t);
    if (!e.detail?.changed?.some(a => SHOWN_ATTRS.has(a))) return;
    if (little || inView(t) || t === glance?.tab) renderLater();
  }

  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (dragging || editing) { renderPending = true; return; }
      try { renderNow(); } catch (e) { log("render " + e + "\n" + e.stack); }
    });
  }

  function renderNow() {
    renderPending = false;
    lastRender = performance.now();
    renderCount++;
    if (little) return renderLittle();
    // Safety net: the sidebar and the window must never be scrolled.
    for (const el of [side, $("#browser"), doc.documentElement, doc.body]) if (el && el.scrollTop) el.scrollTop = 0;
    tabsById.clear();
    const ws = curWs(), prof = curProf();
    setHue(ws.hue);
    doc.documentElement.style.setProperty("--sl-w", D.settings.sidebarWidth + "px");
    doc.documentElement.classList.toggle("sl-hidden", !sidebarVisible);
    applyExtensionPins();
    updateGlanceTitle();

    favBox.replaceChildren(...prof.favorites.map((it, i) => {
      const t = tabForItem(it.id);
      return h("div", {
        class: `sl-fav-tile${t?.selected ? " active" : ""}${t ? " loaded" : ""}`, draggable: "true",
        "data-item": it.id, "data-tab": t ? tabId(t) : null, "data-list": "favorites", "data-index": i,
        title: it.customTitle || it.title,
      }, favicon(t ? tabUrl(t) : it.url, t ? tabIcon(t) : it.icon, t?.hasAttribute("busy")));
    }));

    const showProfile = D.profiles.length > 1;
    wsTitle.replaceChildren(h("span", { text: `${ws.icon}  ${ws.name}` }));
    if (showProfile) wsTitle.append(h("span", { class: "sl-prof", title: "Profile (cookies, history)" }, icon("user"), prof.name));

    const node = (n, i, parent) => {
      if (n.type !== "folder") return rowForItem(n, "pinned", i, parent);
      return h("div", { class: "sl-folder" },
        h("div", { class: `sl-row sl-folder-head${n.open ? " open" : ""}`, draggable: "true", "data-folder-id": n.id, "data-index": i, "data-parent": parent },
          icon("chev", "sl-chev"), icon("folder"), h("span", { class: "sl-title", text: n.name })),
        n.open && h("div", { class: `sl-folder-body${openedFolders.delete(n.id) ? " sl-enter" : ""}` }, n.children.map((c, k) => node(c, k, n.id))));
    };
    pinBox.replaceChildren(...ws.pinned.map((n, i) => node(n, i, null)));

    todayBox.replaceChildren(...todayTabs(ws.id).filter(t => !isBlank(t)).map((t, i) => rowForTab(t, "today", i)));

    // Orb badge: expired notes (red alert), otherwise the number of notes.
    const alerts = expiredCount(ws), notes = ws.board?.notes?.length || 0;
    orb.classList.toggle("active", boardOpen);
    orb.classList.toggle("alert", alerts > 0);
    orb.title = alerts ? `${alerts} expired note${alerts > 1 ? "s" : ""} on this board` : "Board — notes and drawings for this workspace";
    const badge = orb.querySelector(".sl-orb-count");
    badge.textContent = alerts || notes || "";
    badge.classList.toggle("alert", alerts > 0);
    if (boardOpen) refreshBoard();

    wsBar.replaceChildren(...D.workspaces.map((w, i) => h("button", {
      class: `sl-ws-dot${w.id === ws.id ? " active" : ""}${expiredCount(w) ? " alert" : ""}`, "data-ws": w.id, "data-index": i, draggable: "true",
      title: `${w.name}${showProfile ? " · " + profById(w.profile).name : ""} (Ctrl+${i + 1})`, text: w.icon,
    })));

    // Remember pinned items' titles for display when unloaded (icons: see the favicon cache).
    for (const { item } of walkItems()) {
      const t = tabForItem(item.id);
      if (!t) continue;
      if (!item.customTitle && t.label && t.label !== item.title && !t.hasAttribute("pending") && tabUrl(t) === item.url) item.title = t.label;
    }
  }

  /* Sets the workspace hue, taking the shortest way round the color wheel for the transition. */
  let shownHue = null;
  function setHue(hue) {
    hue = +hue || 0;
    if (shownHue != null) hue += Math.round((shownHue - hue) / 360) * 360;
    if (hue === shownHue) return;
    shownHue = hue;
    doc.documentElement.style.setProperty("--sl-h", hue);
  }

  function slide(right) {
    scroll.classList.remove("sl-slide-l", "sl-slide-r");
    void scroll.offsetWidth;
    scroll.classList.add(right ? "sl-slide-r" : "sl-slide-l");
  }

  function toast(text, ms = 1800) {
    toastEl.textContent = text;
    toastEl.classList.remove("show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  /* Animates layout changes of the sidebar for the duration of one transition. */
  function animateLayout() {
    const root = doc.documentElement;
    root.classList.add("sl-anim");
    clearTimeout(animateLayout.t);
    animateLayout.t = setTimeout(() => root.classList.remove("sl-anim"), 360);
  }

  function toggleSidebar() {
    // Pinning a peeked sidebar: it is already in view, no slide.
    const peeking = doc.documentElement.classList.contains("sl-peek");
    sidebarVisible = !sidebarVisible;
    D.settings.sidebarVisible = sidebarVisible;
    if (!peeking) animateLayout();
    doc.documentElement.classList.toggle("sl-hidden", !sidebarVisible);
    endPeek({ instant: true });
    save();
    render();
  }

  /* ---------- sidebar events ---------- */

  function rowTarget(e) { return e.target.closest(".sl-tab, .sl-fav-tile"); }
  function rowTab(el) { return el?.dataset.tab ? tabsById.get(el.dataset.tab) : null; }

  function wireSidebar() {
    // Hovering a sidebar row prepares its tab (as hovering a native tab does), so switching is instant.
    // Only after a short pause on the row: sweeping the mouse along the sidebar does not render every tab.
    let warmTimer;
    side.addEventListener("mouseover", e => {
      const t = rowTab(e.target.closest?.(".sl-tab, .sl-fav-tile"));
      clearTimeout(warmTimer);
      if (alive(t) && !t.selected) warmTimer = setTimeout(() => { if (alive(t) && !t.selected) try { gBrowser.warmupTab(t); } catch {} }, 120);
    });
    side.addEventListener("click", e => {
      const dot = e.target.closest(".sl-ws-dot");
      if (dot) return switchWs(dot.dataset.ws);
      const fh = e.target.closest(".sl-folder-head");
      if (fh) { const r = findFolder(fh.dataset.folderId); if (r) { r.f.open = !r.f.open; if (r.f.open) openedFolders.add(r.f.id); save(); render(); } return; }
      const row = rowTarget(e);
      if (!row) return;
      const t = rowTab(row);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close" && t) return gBrowser.removeTab(t, { animate: false });
      if (act === "mute" && t) return t.toggleMuteAudio();
      if (act === "reset") return resetItem(row.dataset.item);
      if (t) selectTab(t);
      else if (row.dataset.item) openItem(row.dataset.item);
    });

    side.addEventListener("auxclick", e => {
      if (e.button !== 1) return;
      const t = rowTab(rowTarget(e));
      if (t) gBrowser.removeTab(t);
    });

    // Double-click: back to the page the tab started on (its pinned URL, or the first page of a today tab).
    // A row that is already there is renamed instead (pinned items).
    side.addEventListener("dblclick", e => {
      if (e.target.closest("[data-act]")) return;
      const row = rowTarget(e);
      const t = rowTab(row);
      if (t && backToStart(t)) return;
      if (row?.dataset.item) return startRename(row, "item", row.dataset.item);
      const fh = e.target.closest(".sl-folder-head");
      if (fh) startRename(fh, "folder", fh.dataset.folderId);
    });

    side.addEventListener("contextmenu", e => {
      if (e.target.closest("#navigator-toolbox")) return;
      e.preventDefault();
      e.stopPropagation();
      const row = rowTarget(e);
      if (row) return tabMenu(e, row);
      const fh = e.target.closest(".sl-folder-head");
      if (fh) return folderMenu(e, fh);
      const dot = e.target.closest(".sl-ws-dot");
      wsMenu(e, dot ? dot.dataset.ws : activeWs);
    });

    // Horizontal swipe (touchpad) switches workspaces, one step per gesture.
    // macOS trackpads keep sending decaying momentum events after the fingers lift, and wheel events
    // carry no gesture phase. After a step, the momentum is ignored; a new gesture is recognised when
    // the events stop for a moment, change direction, or grow again after having decayed.
    let acc = 0, spent = false, lastWheel = 0, peak = 0, floor = 0, stepDir = 0;
    side.addEventListener("wheel", e => {
      const now = Date.now();
      if (now - lastWheel > 250) { acc = 0; spent = false; }
      lastWheel = now;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || e.target.closest("#navigator-toolbox")) return;
      e.preventDefault();
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX, mag = Math.abs(dx);
      if (spent) {
        // The gesture that made the step may still speed up: only a rise after a real decay counts.
        const decayed = floor < peak * 0.4;
        peak = Math.max(peak, mag);
        floor = decayed ? Math.min(floor, mag) : mag;
        const reversed = Math.sign(dx) !== stepDir && mag > 2;
        if (!reversed && !(decayed && mag > Math.max(floor * 2.5, floor + 6))) return;
        acc = 0;
        spent = false;
      }
      acc += dx;
      if (Math.abs(acc) < 120) return;
      spent = true;
      peak = floor = mag;
      stepDir = Math.sign(acc);
      stepWs(stepDir);
    }, { passive: false });

    wireDnd();
  }

  /* ---------- renaming ---------- */

  function startRename(row, kind, id) {
    const span = row.querySelector(".sl-title");
    if (!span) return;
    const input = h("input", { class: "sl-rename", value: span.textContent });
    span.replaceWith(input);
    // A draggable row swallows mouse selection (double-click on a word, drag-select) in the field.
    const wasDraggable = row.getAttribute("draggable");
    row.setAttribute("draggable", "false");
    // Clicking anywhere else commits (clicks on the sidebar do not move the focus in the browser window).
    const outside = e => { if (e.target !== input) finish(true); };
    window.addEventListener("pointerdown", outside, true);
    editing = true;
    input.focus();
    input.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      editing = false;
      window.removeEventListener("pointerdown", outside, true);
      if (wasDraggable) row.setAttribute("draggable", wasDraggable);
      if (commit) {
        const v = input.value.trim();
        if (kind === "folder") { const r = findFolder(id); if (r && v) r.f.name = v; }
        else { const r = findItem(id); if (r) r.item.customTitle = v && v !== r.item.title ? v : undefined; }
        save();
      }
      renderNow();
    };
    input.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    for (const ev of ["click", "dblclick", "mousedown"]) input.addEventListener(ev, e => e.stopPropagation());
  }

  /* ---------- drag and drop ---------- */

  let drop = null;
  function clearMarks() {
    for (const el of side.querySelectorAll(".sl-drop-before, .sl-drop-after, .sl-drop-into")) el.classList.remove("sl-drop-before", "sl-drop-after", "sl-drop-into");
  }

  function computeDrop(e) {
    const isFolder = dragging.kind === "folder";
    const dot = e.target.closest(".sl-ws-dot");
    // Reordering workspaces: drop on the left or right half of another workspace.
    if (dragging.kind === "ws") {
      if (!dot) return null;
      const r = dot.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
      return { el: dot, mark: before ? "sl-drop-before" : "sl-drop-after", dest: { index: +dot.dataset.index + (before ? 0 : 1) } };
    }
    if (dot) return isFolder ? null : { el: dot, mark: "sl-drop-into", dest: { list: "today", wsId: dot.dataset.ws } };

    const fh = e.target.closest(".sl-folder-head");
    if (fh) {
      const r = fh.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      // A folder cannot go into itself or one of its subfolders.
      const inside = id => isFolder && id && folderWithin(id, dragging.id);
      if (y > .25 && y < .75 && !inside(fh.dataset.folderId)) return { el: fh, mark: "sl-drop-into", dest: { list: "pinned", folderId: fh.dataset.folderId } };
      if (inside(fh.dataset.parent) || (isFolder && fh.dataset.folderId === dragging.id)) return null;
      const before = y < .5;
      return { el: fh, mark: before ? "sl-drop-before" : "sl-drop-after", dest: { list: "pinned", folderId: fh.dataset.parent || null, index: +fh.dataset.index + (before ? 0 : 1) } };
    }

    const row = rowTarget(e);
    if (row) {
      const list = row.dataset.list;
      if (isFolder && (list !== "pinned" || (row.dataset.folder && folderWithin(row.dataset.folder, dragging.id)))) return null;
      const r = row.getBoundingClientRect();
      const before = list === "favorites" ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
      const dest = { list, folderId: row.dataset.folder || null, index: +row.dataset.index + (before ? 0 : 1) };
      if (list === "today") {
        const t = rowTab(row);
        if (before) dest.beforeTab = t; else dest.afterTab = t;
      }
      return { el: row, mark: before ? "sl-drop-before" : "sl-drop-after", dest };
    }

    const zone = e.target.closest(".sl-zone");
    if (zone) return isFolder && zone.dataset.list !== "pinned" ? null : { el: zone, mark: null, dest: { list: zone.dataset.list } };
    if (e.target.closest("#sl-newtab, .sl-divider")) return isFolder ? null : { el: null, mark: null, dest: { list: "today" } };
    return null;
  }

  function wireDnd() {
    side.addEventListener("dragstart", e => {
      if (e.target.closest("#navigator-toolbox")) return;
      const fh = e.target.closest(".sl-folder-head");
      const row = rowTarget(e);
      const wsDot = e.target.closest(".sl-ws-dot");
      if (wsDot) {
        dragging = { kind: "ws", id: wsDot.dataset.ws };
        e.dataTransfer.setData("application/x-sillage", "1");
        e.dataTransfer.effectAllowed = "move";
        wsDot.classList.add("sl-dragging");
        return;
      }
      if (fh) dragging = { kind: "folder", id: fh.dataset.folderId };
      else if (row) dragging = { kind: row.dataset.tab ? "tab" : "item", tab: rowTab(row), item: row.dataset.item };
      else return;
      const url = dragging.tab ? tabUrl(dragging.tab) : dragging.item ? findItem(dragging.item)?.item.url : "";
      if (url) e.dataTransfer.setData("text/x-moz-url", url);
      e.dataTransfer.setData("application/x-sillage", "1");
      e.dataTransfer.effectAllowed = "move";
      (fh || row).classList.add("sl-dragging");
      doc.documentElement.classList.add("sl-is-dragging");
    });
    side.addEventListener("dragover", e => {
      if (!dragging) return;
      const d = computeDrop(e);
      clearMarks();
      drop = d;
      if (!d) return;
      e.preventDefault();
      if (d.el && d.mark) d.el.classList.add(d.mark);
    });
    side.addEventListener("drop", e => {
      if (!dragging || !drop) return;
      e.preventDefault();
      const dest = { wsId: drop.dest.wsId || activeWs, ...drop.dest };
      const dr = dragging;
      endDrag();
      if (dr.kind === "ws") moveWorkspace(dr.id, dest.index);
      else if (dr.kind === "folder") moveFolder(dr.id, { folderId: dest.folderId || null, index: dest.index });
      else if (dr.tab) moveTab(dr.tab, dest);
      else moveItem(dr.item, dest);
    });
    side.addEventListener("dragend", endDrag);
  }

  function endDrag() {
    dragging = null;
    drop = null;
    clearMarks();
    doc.documentElement.classList.remove("sl-is-dragging");
    for (const el of side.querySelectorAll(".sl-dragging")) el.classList.remove("sl-dragging");
    if (renderPending) render();
  }

  /* ---------- resizing & peek ---------- */

  function wireResize(resizer) {
    resizer.addEventListener("pointerdown", e => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      const move = ev => {
        D.settings.sidebarWidth = Math.round(Math.min(480, Math.max(200, ev.clientX)));
        doc.documentElement.style.setProperty("--sl-w", D.settings.sidebarWidth + "px");
      };
      const up = () => {
        resizer.removeEventListener("pointermove", move);
        resizer.removeEventListener("pointerup", up);
        save();
      };
      resizer.addEventListener("pointermove", move);
      resizer.addEventListener("pointerup", up);
    });
  }

  let peekTimer;
  function wirePeek() {
    peekZone.addEventListener("mouseenter", () => {
      clearTimeout(peekTimer);
      clearTimeout(peekOutTimer);
      doc.documentElement.classList.remove("sl-peek-out");
      doc.documentElement.classList.add("sl-peek");
    });
    side.addEventListener("mouseenter", () => {
      clearTimeout(peekTimer);
      if (!doc.documentElement.classList.contains("sl-peek-out")) return;
      clearTimeout(peekOutTimer);
      doc.documentElement.classList.remove("sl-peek-out");
    });
    side.addEventListener("mouseleave", () => {
      if (!doc.documentElement.classList.contains("sl-peek")) return;
      peekTimer = setTimeout(() => {
        // Keep it open while typing in the address bar or while a menu is open.
        if (gURLBar.focused || editing || side.querySelector("[open=true]")) return;
        endPeek();
      }, 280);
    });
  }
  let peekOutTimer;
  function endPeek({ instant = false } = {}) {
    const root = doc.documentElement;
    clearTimeout(peekOutTimer);
    if (instant || !root.classList.contains("sl-peek") || !root.classList.contains("sl-hidden")) {
      root.classList.remove("sl-peek", "sl-peek-out");
      return;
    }
    // Slides back out, then leaves the peek state.
    root.classList.add("sl-peek-out");
    peekOutTimer = setTimeout(() => root.classList.remove("sl-peek", "sl-peek-out"), 160);
  }

  /* ---------- context menus ---------- */

  function popup(e, items) {
    const build = (parent, list) => {
      for (const it of list.filter(Boolean)) {
        if (it === "-") { parent.append(doc.createXULElement("menuseparator")); continue; }
        if (it.submenu) {
          const m = doc.createXULElement("menu");
          m.setAttribute("label", it.label);
          const p = doc.createXULElement("menupopup");
          build(p, it.submenu);
          m.append(p);
          parent.append(m);
          continue;
        }
        const mi = doc.createXULElement("menuitem");
        mi.setAttribute("label", it.label);
        if (it.disabled) mi.setAttribute("disabled", "true");
        mi.addEventListener("command", () => it.fn());
        parent.append(mi);
      }
    };
    const p = doc.createXULElement("menupopup");
    build(p, items);
    for (const s of p.querySelectorAll(":scope > menuseparator")) {
      if (!s.previousElementSibling || !s.nextElementSibling || s.nextElementSibling.localName === "menuseparator") s.remove();
    }
    $("#mainPopupSet").append(p);
    p.addEventListener("popuphidden", ev => { if (ev.target === p) p.remove(); });
    p.openPopupAtScreen(e.screenX, e.screenY, true);
  }

  function tabMenu(e, row) {
    const t = rowTab(row);
    const r = row.dataset.item ? findItem(row.dataset.item) : null;
    const url = t ? tabUrl(t) : r?.item.url;
    const list = row.dataset.list;
    const others = D.workspaces.filter(w => w.id !== activeWs);
    popup(e, [
      { label: "Copy URL", fn: () => copyUrl(url) },
      t && { label: "Duplicate", fn: () => newTab(tabUrl(t), { background: true }) },
      r && { label: "Rename…", fn: () => startRename(row, "item", r.item.id) },
      r && t && tabUrl(t) !== r.item.url && { label: "Back to pinned URL", fn: () => resetItem(r.item.id) },
      !r && t?.linkedBrowser.canGoBack && { label: "Back to first page", fn: () => backToStart(t) },
      r && t && tabUrl(t) !== r.item.url && { label: "Replace pinned URL with current", fn: () => { r.item.url = tabUrl(t); save(); render(); } },
      "-",
      list === "today" && t && { label: "Pin", fn: () => togglePin(t) },
      list === "pinned" && { label: "Unpin", fn: () => (t ? togglePin(t) : moveItem(r.item.id, { list: "today" })) },
      list !== "favorites" && { label: "Add to Favorites", fn: () => (t ? moveTab(t, { list: "favorites" }) : moveItem(r.item.id, { list: "favorites" })) },
      list === "favorites" && { label: "Remove from Favorites", fn: () => (t ? toggleFavorite(t) : moveItem(r.item.id, { list: "today" })) },
      others.length && list !== "favorites" && {
        label: "Move to", submenu: others.map(w => ({
          label: `${w.icon}  ${w.name}`,
          fn: () => (t ? moveTab(t, { list: list === "pinned" ? "pinned" : "today", wsId: w.id }) : moveItem(r.item.id, { list: "pinned", wsId: w.id })),
        })),
      },
      t && { label: t.hasAttribute("muted") ? "Unmute" : "Mute", fn: () => t.toggleMuteAudio() },
      "-",
      t && !t.hasAttribute("pending") && !t.selected && { label: "Unload tab", fn: () => gBrowser.discardBrowser(t) },
      t && list !== "today" && { label: "Close tab (keep pinned)", fn: () => gBrowser.removeTab(t) },
      list === "today" ? { label: "Close", fn: () => gBrowser.removeTab(t) } : { label: "Delete pinned item", fn: () => deleteItem(r.item.id) },
    ]);
  }

  function folderMenu(e, fh) {
    const r = findFolder(fh.dataset.folderId);
    if (!r) return;
    popup(e, [
      { label: "Rename…", fn: () => startRename(fh, "folder", r.f.id) },
      { label: "New folder inside", fn: () => { const f = createFolder(r.w.id, "New folder", r.f.id); renameFolderSoon(f.id); } },
      { label: "Open all tabs", fn: () => [...walkTree(r.f.children, r.w)].forEach(x => openItem(x.item.id, { background: true })) },
      "-",
      { label: "Delete folder (keep its contents)", fn: () => { r.list.splice(r.list.indexOf(r.f), 1, ...r.f.children); save(); render(); } },
      { label: "Delete folder and its contents", fn: () => {
        [...walkTree(r.f.children, r.w)].forEach(x => deleteItem(x.item.id));
        r.list.splice(r.list.indexOf(r.f), 1);
        save();
        render();
      } },
    ]);
  }

  function wsMenu(e, id) {
    popup(e, [
      { label: "Edit workspace…", fn: () => openWsEditor(id) },
      { label: "New folder", fn: () => { if (id !== activeWs) switchWs(id); const f = createFolder(id); renameFolderSoon(f.id); } },
      { label: "New workspace…", fn: () => openWsEditor(null) },
      "-",
      D.workspaces.length > 1 && { label: "Delete workspace", fn: () => deleteWs(id) },
    ]);
  }

  function renameFolderSoon(id) {
    setTimeout(() => {
      renderNow();
      const fh = side.querySelector(`.sl-folder-head[data-folder-id="${id}"]`);
      if (fh) startRename(fh, "folder", id);
    }, 30);
  }

  function copyUrl(url = tabUrl(gBrowser.selectedTab)) {
    Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(url);
    toast("URL copied");
  }

  /* ---------- pinned extensions per workspace ----------
     Extensions are shared by all workspaces and profiles (one Firefox profile), but each workspace chooses
     which pinned extension icons it shows; hidden ones stay available in the extensions menu. */

  const pinnedExtensions = () => [...doc.querySelectorAll("#nav-bar-customization-target > [id$='-browser-action']")];
  function extensionName(el) {
    return el.querySelector(".unified-extensions-item-name")?.textContent?.trim()
      || el.querySelector("toolbarbutton")?.getAttribute("label") || el.getAttribute("label") || el.id.replace(/-browser-action$/, "");
  }
  function applyExtensionPins() {
    const hidden = new Set(curWs()?.hiddenExtensions || []);
    for (const el of pinnedExtensions()) el.toggleAttribute("sl-profile-hidden", hidden.has(el.id));
  }
  function setExtensionHidden(id, hide) {
    const w = curWs();
    const list = (w.hiddenExtensions || []).filter(x => x !== id);
    if (hide) list.push(id);
    w.hiddenExtensions = list;
    applyExtensionPins();
    save();
    const el = doc.getElementById(id), name = el ? extensionName(el) : "Extension";
    toast(hide ? `${name} hidden in ${w.name} — right-click the extensions menu or use the palette to show it again`
               : `${name} shown in ${w.name}`, hide ? 3500 : 1800);
  }
  /* Earlier versions stored hidden extensions per profile: each workspace of the profile takes them over. */
  function migrateExtensionPins() {
    for (const p of D.profiles) {
      if (!p.hiddenExtensions?.length) continue;
      for (const w of D.workspaces) if (w.profile === p.id) w.hiddenExtensions = [...new Set([...(w.hiddenExtensions || []), ...p.hiddenExtensions])];
      delete p.hiddenExtensions;
      save();
    }
  }
  function wireExtensionPins() {
    // Extensions are added to the toolbar while the window loads, and when pinned later.
    new MutationObserver(applyExtensionPins).observe($("#nav-bar-customization-target"), { childList: true });
    // Right-click on a pinned extension: hide it in the current profile.
    const menu = $("#toolbar-context-menu");
    if (!menu) return;
    const item = doc.createXULElement("menuitem");
    item.id = "sl-ext-hide";
    item.addEventListener("command", () => item._ext && setExtensionHidden(item._ext, true));
    const sep = doc.createXULElement("menuseparator");
    menu.prepend(item, sep);
    menu.addEventListener("popupshowing", e => {
      if (e.target !== menu) return;
      const el = menu.triggerNode?.closest?.("#nav-bar-customization-target > [id$='-browser-action']");
      item._ext = el?.id || null;
      item.hidden = sep.hidden = !el;
      if (el) item.setAttribute("label", `Hide in ${curWs().icon} ${curWs().name}`);
    });
    // Right-click on the extensions menu button: show icons hidden in this workspace again.
    const showMenu = doc.createXULElement("menu");
    showMenu.setAttribute("label", "Show hidden extensions");
    const showPopup = doc.createXULElement("menupopup");
    showMenu.append(showPopup);
    menu.prepend(showMenu);
    menu.addEventListener("popupshowing", e => {
      if (e.target !== menu) return;
      const onExtButton = menu.triggerNode?.closest?.("#unified-extensions-button");
      const hidden = pinnedExtensions().filter(el => (curWs().hiddenExtensions || []).includes(el.id));
      showMenu.hidden = !onExtButton || !hidden.length;
      showPopup.replaceChildren(...hidden.map(el => {
        const mi = doc.createXULElement("menuitem");
        mi.setAttribute("label", extensionName(el));
        mi.addEventListener("command", () => setExtensionHidden(el.id, false));
        return mi;
      }));
      if (onExtButton && hidden.length) sep.hidden = false;
    });
  }

  /* ---------- command palette ---------- */

  let pal, palInput, palList, palMode = "new", palResults = [], palSel = 0, palSeq = 0, palTouched = false;

  function buildPalette() {
    palInput = h("input", { id: "sl-pal-input", placeholder: "Search, enter a URL or a command…", spellcheck: "false" });
    palList = h("div", { id: "sl-pal-list" });
    pal = h("div", { id: "sl-pal-wrap", hidden: true },
      h("div", { id: "sl-pal-scrim", onmousedown: closePalette }),
      h("div", { id: "sl-pal" },
        h("div", { id: "sl-pal-box" }, icon("search"), palInput),
        palList,
        h("div", { id: "sl-pal-hint" },
          h("kbd", { text: "↑↓" }), " navigate ", h("kbd", { text: "Enter" }), " open ",
          h("kbd", { text: "Alt Enter" }), " in background ", h("kbd", { text: "Esc" }), " close")));
    doc.body.append(pal);
    palInput.addEventListener("input", () => query(palInput.value));
    palInput.addEventListener("keydown", e => {
      e.stopPropagation();
      if (["ArrowDown", "ArrowUp", "Tab"].includes(e.key)) palTouched = true;
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); palSel = Math.min(palSel + 1, palResults.length - 1); drawResults(); }
      else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); palSel = Math.max(palSel - 1, 0); drawResults(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(palResults[palSel], e.altKey); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    });
    palList.addEventListener("mousemove", e => {
      const el = e.target.closest(".sl-pr");
      if (el && +el.dataset.i !== palSel) { palTouched = true; palSel = +el.dataset.i; drawResults(); }
    });
    palList.addEventListener("mousedown", e => {
      const el = e.target.closest(".sl-pr");
      if (el) { e.preventDefault(); choose(palResults[+el.dataset.i], e.button === 1); }
    });
  }

  function openPalette(mode) {
    palMode = mode;
    endPeek();
    const box = $("#tabbrowser-tabbox").getBoundingClientRect();
    pal.style.setProperty("--pal-x", `${box.left + box.width / 2}px`);
    pal.style.setProperty("--pal-y", `${box.top + Math.min(140, box.height * .18)}px`);
    pal.style.setProperty("--pal-w", `${Math.min(660, box.width - 40)}px`);
    pal.hidden = false;
    const url = tabUrl(gBrowser.selectedTab);
    palInput.value = mode === "current" && url !== "about:blank" ? url : "";
    palInput.placeholder = mode === "current" ? "Go to…" : "Search, enter a URL or a command…";
    palInput.focus();
    palInput.select();
    query(mode === "current" ? "" : palInput.value);
  }

  function closePalette() {
    if (pal.hidden) return;
    pal.hidden = true;
    palSeq++;
    gBrowser.selectedBrowser.focus();
  }

  const COMMANDS = [
    { cmd: "new-ws", title: "New workspace", kw: "space create" },
    { cmd: "edit-ws", title: "Edit this workspace", kw: "rename color icon profile" },
    { cmd: "new-profile", title: "New profile", kw: "account container work" },
    { cmd: "new-folder", title: "New folder", kw: "pinned bookmarks" },
    { cmd: "toggle-sidebar", title: "Toggle sidebar", kw: "show hide" },
    { cmd: "board", title: "Board", kw: "notes sticky post-it canvas" },
    { cmd: "sync-now", title: "Sync now", kw: "firefox account synchronize" },
    { cmd: "new-note", title: "New sticky note", kw: "board post-it" },
    { cmd: "little-on", title: "Open links from other apps in a Little Sillage window", kw: "external little arc" },
    { cmd: "little-off", title: "Open links from other apps in the current workspace", kw: "external little arc" },
    { cmd: "glance-on", title: "Open links that would open a new tab in a card over the page", kw: "glance peek preview popup" },
    { cmd: "glance-off", title: "Open links in a new tab, as in Firefox", kw: "glance peek preview popup" },
    { cmd: "copy-url", title: "Copy URL", kw: "link" },
    { cmd: "clear-today", title: "Clear today tabs", kw: "close archive" },
    { cmd: "reopen", title: "Reopen closed tab", kw: "restore undo" },
    { cmd: "migrate", title: "Import from another browser (passwords, history, bookmarks)", kw: "chrome chromium safari import" },
    { cmd: "import-pins", title: "Import Chromium / Chrome / Brave bookmarks as pinned items", kw: "bookmarks import" },
    { cmd: "archive-12", title: "Auto-archive tabs after 12 hours", kw: "archive close" },
    { cmd: "archive-24", title: "Auto-archive tabs after 24 hours", kw: "archive close" },
    { cmd: "archive-168", title: "Auto-archive tabs after 7 days", kw: "archive close" },
    { cmd: "archive-0", title: "Never auto-archive tabs", kw: "archive close disable" },
    { cmd: "addons", title: "Extensions", kw: "add-ons ublock" },
    { cmd: "settings", title: "Settings", kw: "preferences options" },
    { cmd: "history", title: "History", kw: "" },
    { cmd: "downloads", title: "Downloads", kw: "" },
    { cmd: "passwords", title: "Passwords", kw: "logins credentials" },
    { cmd: "private", title: "New private window", kw: "incognito" },
    { cmd: "new-window", title: "New window", kw: "" },
  ];

  function dynamicCommands() {
    const out = D.workspaces.filter(w => w.id !== activeWs)
      .map(w => ({ cmd: "ws:" + w.id, title: `Go to workspace ${w.icon} ${w.name}`, kw: "space switch" }));
    for (const p of D.profiles) {
      if (p.userContextId !== 0 && !D.workspaces.some(w => w.profile === p.id)) {
        out.push({ cmd: "del-profile:" + p.id, title: `Delete profile ${p.name} (cookies and history)`, kw: "profile remove" });
      }
    }
    const ws = curWs();
    for (const el of pinnedExtensions()) {
      const hidden = (ws.hiddenExtensions || []).includes(el.id);
      out.push({ cmd: `ext-${hidden ? "show" : "hide"}:${el.id}`, kw: "extension toolbar pin workspace",
        title: `${hidden ? "Show" : "Hide"} extension ${extensionName(el)} in ${ws.icon} ${ws.name}` });
    }
    return out;
  }

  function runCommand(cmd) {
    if (cmd.startsWith("ws:")) return switchWs(cmd.slice(3));
    if (cmd.startsWith("ext-hide:")) return setExtensionHidden(cmd.slice(9), true);
    if (cmd.startsWith("ext-show:")) return setExtensionHidden(cmd.slice(9), false);
    if (cmd.startsWith("del-profile:")) return deleteProfile(cmd.slice(12));
    switch (cmd) {
      case "new-ws": return openWsEditor(null);
      case "edit-ws": return openWsEditor(activeWs);
      case "new-profile": {
        const name = { value: "" };
        if (!Services.prompt.prompt(window, "New profile", "Profile name (separate cookies, sessions and history):", name, null, {}) || !name.value.trim()) return;
        const p = createProfile(name.value.trim());
        toast(`Profile “${p.name}” created — assign it to a workspace`);
        return openWsEditor(null, p.id);
      }
      case "new-folder": { const f = createFolder(); if (!sidebarVisible) toggleSidebar(); return renameFolderSoon(f.id); }
      case "toggle-sidebar": return toggleSidebar();
      case "board": return openBoard();
      case "sync-now":
        toast("Syncing…");
        return SillageSync.syncNow().then(() => toast("Synced"), e => { log("sync now " + e); toast("Sync failed — are you signed in to Firefox Sync?"); });
      case "new-note": { openBoard(); return addNote(); }
      case "little-on": case "little-off":
        D.settings.littleWindow = cmd === "little-on";
        save();
        return toast(D.settings.littleWindow ? "Links from other apps open in a Little Sillage window" : "Links from other apps open in the current workspace");
      case "glance-on": case "glance-off":
        D.settings.glance = cmd === "glance-on";
        save();
        return toast(D.settings.glance ? "Links that would open a new tab show in a card over the page" : "Links open in a new tab");
      case "copy-url": return copyUrl();
      case "clear-today": return clearToday();
      case "reopen": return undoCloseTab();
      case "migrate": return ChromeUtils.importESModule("resource:///modules/MigrationUtils.sys.mjs").MigrationUtils.showMigrationWizard(window, {});
      case "import-pins": return importChromium();
      case "archive-12": case "archive-24": case "archive-168": case "archive-0":
        D.settings.archiveHours = +cmd.slice(8);
        save();
        return toast(D.settings.archiveHours ? `Today tabs are archived after ${D.settings.archiveHours >= 48 ? D.settings.archiveHours / 24 + " days" : D.settings.archiveHours + " hours"}` : "Auto-archiving disabled");
      case "addons": return BrowserAddonUI.openAddonsMgr();
      case "settings": return openPreferences();
      case "history": return newTab("about:history");
      case "downloads": return newTab("about:downloads");
      case "passwords": return newTab("about:logins");
      case "private": return OpenBrowserWindow({ private: true });
      case "new-window": return OpenBrowserWindow();
    }
  }

  const matches = (text, words) => { text = (text || "").toLowerCase(); return words.every(w => text.includes(w)); };

  function wsLabel(wsId) {
    if (!wsId || wsId === activeWs || wsId.startsWith("*")) return "";
    const w = wsById(wsId);
    return w ? ` · ${w.icon} ${w.name}` : "";
  }

  let searchService;
  function engine() {
    try {
      searchService ||= ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs").SearchService;
      return searchService.defaultEngine;
    } catch (e) { log("search " + e); return null; }
  }

  function fixup(q) {
    const flags = Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP | Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS;
    try {
      const info = Services.uriFixup.getFixupURIInfo(q, flags);
      let url = info.preferredURI.spec;
      // Address typed without a scheme: default to HTTPS (except for local networks).
      if (!info.keywordAsSent && !/^[a-z][a-z0-9+.-]*:/i.test(q) && url.startsWith("http://")
        && !/^http:\/\/(localhost|127\.|10\.|192\.168\.|\[::1\]|[^/]+\.local\b)/.test(url)) url = "https://" + url.slice(7);
      return { url, search: !!info.keywordAsSent };
    } catch {
      const e = engine();
      return { url: e ? e.getSubmission(q).uri.spec : "https://www.google.com/search?q=" + encodeURIComponent(q), search: true };
    }
  }

  /* Palette history, scoped to the current workspace's profile. */
  async function historyMatches(words, exclude) {
    const prof = curProf(), H = shared.hist;
    const own = (H[prof.id] || []).filter(e => matches(`${e.t} ${e.u}`, words));
    const now = Date.now();
    const score = (n, l) => Math.log2(1 + n) / (1 + (now - l) / 6048e5);
    const res = own.map(e => ({ url: e.u, title: e.t, s: score(e.n, e.l) * 2 }));
    // The default profile also uses Firefox's history (imports…), minus URLs only seen in other profiles.
    if (prof.userContextId === 0) {
      const mine = new Set((H[prof.id] || []).map(e => e.u));
      const elsewhere = new Set();
      for (const [pid, list] of Object.entries(H)) if (pid !== prof.id) for (const e of list) if (!mine.has(e.u)) elsewhere.add(e.u);
      const conn = await PlacesUtils.promiseDBConnection();
      const where = words.map((_, i) => `(url LIKE :w${i} ESCAPE '/' OR title LIKE :w${i} ESCAPE '/')`).join(" AND ");
      const params = {};
      words.forEach((w, i) => { params["w" + i] = "%" + w.replace(/[/%_]/g, "/$&") + "%"; });
      const rows = await conn.executeCached(
        `SELECT url, title, frecency FROM moz_places WHERE hidden = 0 AND frecency <> 0 AND ${where} ORDER BY frecency DESC LIMIT 15`, params);
      for (const r of rows) {
        const url = r.getResultByName("url");
        if (elsewhere.has(url) || mine.has(url)) continue;
        res.push({ url, title: r.getResultByName("title"), s: Math.log10(1 + Math.max(0, r.getResultByName("frecency"))) / 4 });
      }
    }
    const seen = new Set(exclude);
    return res.sort((a, b) => b.s - a.s).filter(r => /^(https?|file):/.test(r.url) && !seen.has(r.url) && seen.add(r.url)).slice(0, 6);
  }

  async function remoteSuggestions(q) {
    if (!Services.prefs.getBoolPref("browser.search.suggest.enabled", true)) return [];
    const e = engine();
    const sub = e?.getSubmission(q, "application/x-suggestions+json");
    if (!sub) return [];
    try {
      const res = await fetch(sub.uri.spec, { signal: AbortSignal.timeout(1500) });
      const j = await res.json();
      return (j[1] || []).filter(s => s.toLowerCase() !== q.toLowerCase()).slice(0, 4)
        .map(s => ({ kind: "search", title: s, url: e.getSubmission(s).uri.spec, badge: "Suggestion" }));
    } catch { return []; }
  }

  /* Autofill: a result whose address starts with the input ("git" → github.com) moves to the top and
     is selected, so Enter opens it directly. Preference order: open tab, pinned item, history. */
  function autofill(res, q) {
    const needle = q.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (!needle || /\s/.test(needle)) return;
    const bare = u => (u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    const rank = { tab: 0, item: 1, history: 2 };
    let best = -1;
    res.forEach((r, i) => {
      if (!(r.kind in rank) || !bare(r.sub).startsWith(needle)) return;
      if (best < 0 || rank[r.kind] < rank[res[best].kind]) best = i;
    });
    if (best > 0) res.unshift(...res.splice(best, 1));
  }

  function showResults(res, q) {
    if (!palTouched) { autofill(res, q); palSel = 0; }
    palResults = res;
    drawResults();
  }

  async function query(raw) {
    const seq = ++palSeq;
    palTouched = false;
    const q = raw.trim();
    const res = [];
    // The current workspace comes first, then the others, most recent first within each.
    const byRecency = (a, b) => (inView(b) - inView(a)) || b.lastAccessed - a.lastAccessed;
    if (!q) {
      gBrowser.tabs.filter(t => alive(t) && !t.selected && tabUrl(t) !== "about:blank")
        .sort(byRecency).slice(0, 8)
        .forEach(t => res.push({ kind: "tab", tab: t, title: t.label, sub: tabUrl(t), icon: tabIcon(t), badge: "Tab" + wsLabel(tabWs(t)) }));
      palResults = res;
      palSel = 0;
      return drawResults();
    }
    const words = q.toLowerCase().split(/\s+/);
    const fx = fixup(q);
    res.push(fx.search
      ? { kind: "search", title: q, sub: `Search with ${engine()?.name || "the default engine"}`, url: fx.url }
      : { kind: "go", title: fx.url, sub: "Open", url: fx.url });

    const seen = new Set();
    const tabs = gBrowser.tabs.filter(t => alive(t) && matches(`${t.label} ${tabUrl(t)}`, words))
      .sort(byRecency).slice(0, 5);
    for (const t of tabs) {
      seen.add(tabUrl(t));
      res.push({ kind: "tab", tab: t, title: t.label, sub: tabUrl(t), icon: tabIcon(t), badge: (tabItemId(t) ? "Pinned" : "Tab") + wsLabel(tabWs(t)) });
    }
    const local = r => (r.ws ? r.ws.id === activeWs : r.profile.id === curProf().id) ? 0 : 1;
    for (const { item, ws, profile } of [...walkItems()].sort((a, b) => local(a) - local(b))) {
      if (res.length > 9 || seen.has(item.url) || tabForItem(item.id)) continue;
      if (profile.id !== curProf().id && !ws) continue;
      if (!matches(`${item.customTitle || ""} ${item.title} ${item.url}`, words)) continue;
      seen.add(item.url);
      res.push({ kind: "item", id: item.id, title: item.customTitle || item.title, sub: item.url, icon: item.icon, badge: (ws ? "Pinned" : "Favorite") + wsLabel(ws?.id) });
    }
    const cmds = [...dynamicCommands(), ...COMMANDS].filter(c => matches(`${c.title} ${c.kw}`, words)).slice(0, 3)
      .map(c => ({ kind: "cmd", cmd: c.cmd, title: c.title, badge: "Command" }));
    // A command whose title contains every word ranks above the web search.
    if (fx.search && q.length >= 3 && cmds.length && matches(cmds[0].title, words)) res.unshift(cmds.shift());
    res.push(...cmds);
    showResults(res, q);

    const histRows = await historyMatches(words, seen).catch(e => { log("history " + e); return []; });
    if (seq !== palSeq) return;
    histRows.forEach(r => res.push({ kind: "history", title: r.title || r.url, sub: r.url, url: r.url, badge: "History" }));
    showResults(res, q);
    if (!fx.search) return;
    const sugg = await remoteSuggestions(q);
    if (seq !== palSeq) return;
    const known = new Set(res.map(r => r.title.toLowerCase()));
    res.push(...sugg.filter(s => !known.has(s.title.toLowerCase())));
    showResults(res, q);
  }

  function drawResults() {
    const kindIcon = { search: "search", go: "globe", cmd: "cmd", history: "clock" };
    palList.replaceChildren(...palResults.map((r, i) => h("div", { class: `sl-pr${i === palSel ? " sel" : ""}`, "data-i": i },
      r.kind === "tab" || r.kind === "item" || r.kind === "history" ? favicon(r.sub, r.icon) : icon(kindIcon[r.kind] || "globe"),
      h("div", { class: "sl-pr-txt" },
        h("span", { class: "sl-pr-title", text: r.title }),
        r.sub && h("span", { class: "sl-pr-sub", text: r.kind === "tab" || r.kind === "item" || r.kind === "history" ? host(r.sub) : r.sub })),
      r.badge && h("span", { class: "sl-pr-badge", text: r.badge }))));
    // Manual scrolling: scrollIntoView would also scroll the window's containers.
    const sel = palList.querySelector(".sel");
    if (sel) {
      if (sel.offsetTop < palList.scrollTop) palList.scrollTop = sel.offsetTop;
      else if (sel.offsetTop + sel.offsetHeight > palList.scrollTop + palList.clientHeight) palList.scrollTop = sel.offsetTop + sel.offsetHeight - palList.clientHeight;
    }
  }

  function choose(r, background = false) {
    const mode = palMode;
    closePalette();
    if (!r) return;
    if (r.kind === "tab") return selectTab(r.tab);
    if (r.kind === "item") return openItem(r.id, { background });
    if (r.kind === "cmd") return runCommand(r.cmd);
    const cur = gBrowser.selectedTab;
    const blank = tabUrl(cur) === "about:blank" && !cur.hasAttribute("busy");
    if ((mode === "current" || blank) && !background) {
      cur.linkedBrowser.fixupAndLoadURIString(r.url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      gBrowser.selectedBrowser.focus();
    } else newTab(r.url, { background });
  }

  /* ---------- workspace editor ---------- */

  const EMOJIS = ["🏠", "💼", "🎓", "🧪", "🎨", "🎮", "🎵", "📚", "💡", "🚀", "🌿", "🔥", "⭐", "🧠", "🛠️", "✈️", "💰", "❤️"];
  let wsEdit;

  function buildWsEditor() {
    const name = h("input", { id: "sl-wsf-name", maxlength: "30", spellcheck: "false" });
    const ic = h("input", { id: "sl-wsf-icon", maxlength: "4" });
    const hue = h("input", { id: "sl-wsf-hue", type: "range", min: "0", max: "359" });
    const preview = h("div", { id: "sl-wsf-preview" });
    // XUL menulist: HTML <select> elements have no dropdown in the main browser window.
    const prof = doc.createXULElement("menulist");
    prof.id = "sl-wsf-profile";
    const profPopup = doc.createXULElement("menupopup");
    prof.append(profPopup);
    let editingId = null;

    const fillProfiles = selected => {
      profPopup.replaceChildren();
      for (const p of D.profiles) {
        const mi = doc.createXULElement("menuitem");
        mi.setAttribute("label", p.name + (p.userContextId === 0 ? " (default)" : ""));
        mi.setAttribute("value", p.id);
        profPopup.append(mi);
      }
      const add = doc.createXULElement("menuitem");
      add.setAttribute("label", "New profile…");
      add.setAttribute("value", "__new__");
      profPopup.append(add);
      prof.value = selected;
    };
    prof.addEventListener("command", () => {
      if (prof.value !== "__new__") return;
      const n = { value: "" };
      if (Services.prompt.prompt(window, "New profile", "Profile name (separate cookies, sessions and history):", n, null, {}) && n.value.trim()) {
        fillProfiles(createProfile(n.value.trim()).id);
      } else fillProfiles(wsById(editingId)?.profile || curWs().profile);
    });

    const updatePreview = () => { preview.style.setProperty("--pv-h", hue.value); preview.textContent = ic.value || "·"; };
    const close = () => { wsEdit.hidden = true; gBrowser.selectedBrowser.focus(); };
    const submit = () => {
      if (!name.value.trim()) return name.focus();
      if (editingId && wsById(editingId).profile !== prof.value) {
        const n = gBrowser.tabs.filter(t => alive(t) && tabWs(t) === editingId).length;
        if (n && !Services.prompt.confirm(window, "Sillage", `Changing the profile reopens this workspace's ${n} tabs in the new profile (you may need to sign in again). Continue?`)) return;
      }
      close();
      saveWs({ id: editingId, name: name.value.trim(), icon: ic.value.trim() || "·", hue: +hue.value, profile: prof.value || curWs().profile });
    };
    hue.addEventListener("input", updatePreview);
    ic.addEventListener("input", updatePreview);
    const form = h("div", { id: "sl-wsf" },
      h("h2", { id: "sl-wsf-title" }),
      preview,
      h("label", {}, "Name", name),
      h("label", {}, "Icon", ic),
      h("div", { id: "sl-wsf-emojis" }, EMOJIS.map(em => h("button", { text: em, onclick: () => { ic.value = em; updatePreview(); } }))),
      h("label", {}, "Color", hue),
      h("div", { class: "sl-wsf-field" }, h("span", { text: "Profile — cookies, sessions and history are shared by workspaces using the same profile" }), prof),
      h("div", { class: "sl-actions" },
        h("button", { text: "Cancel", onclick: close }),
        h("button", { class: "primary", text: "Save", onclick: submit })));
    form.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter" && e.target.localName === "input") submit();
      if (e.key === "Escape") close();
    });
    wsEdit = h("div", { id: "sl-wsf-wrap", hidden: true, onmousedown: e => { if (e.target === wsEdit) close(); } }, form);
    doc.body.append(wsEdit);
    wsEdit.open = (id, profileId) => {
      editingId = id;
      const w = id && wsById(id);
      $("#sl-wsf-title").textContent = w ? "Edit workspace" : "New workspace";
      name.value = w ? w.name : "";
      ic.value = w ? w.icon : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      hue.value = w ? w.hue : Math.floor(Math.random() * 360);
      fillProfiles(profileId || (w ? w.profile : curWs().profile));
      updatePreview();
      wsEdit.hidden = false;
      name.focus();
    };
  }
  function openWsEditor(id, profileId) { endPeek(); closePalette(); wsEdit.open(id, profileId); }

  /* ---------- Chromium bookmark import ---------- */

  async function importChromium() {
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    const bases = IS_MAC
      ? ["Library/Application Support/Chromium", "Library/Application Support/Google/Chrome", "Library/Application Support/BraveSoftware/Brave-Browser"]
      : [".config/chromium", ".config/google-chrome", ".config/BraveSoftware/Brave-Browser"];
    let roots = null;
    for (const b of bases) {
      try { roots = (await IOUtils.readJSON(PathUtils.join(home, ...b.split("/"), "Default", "Bookmarks"))).roots; break; } catch {}
    }
    if (!roots) return toast("No bookmarks file found");
    const w = curWs();
    let count = 0;
    const mk = u => { count++; return { type: "item", id: uid(), url: u.url, title: u.name || u.url }; };
    // Folders keep their hierarchy; empty ones are skipped.
    const conv = n => n.type === "url" ? mk(n)
      : { type: "folder", id: uid(), name: n.name, open: false, children: (n.children || []).map(conv).filter(Boolean) };
    const nonEmpty = n => n.type !== "folder" || (n.children = n.children.filter(nonEmpty)).length > 0;
    for (const root of [roots.bookmark_bar, roots.other, roots.synced]) {
      if (!root?.children?.length) continue;
      const loose = [];
      for (const c of root.children) {
        if (c.type === "url") { loose.push(c); continue; }
        const f = conv(c);
        if (nonEmpty(f)) w.pinned.push(f);
      }
      if (loose.length) w.pinned.push({ type: "folder", id: uid(), name: root.name, open: false, children: loose.map(mk) });
    }
    save();
    render();
    toast(`${count} bookmarks imported into ${w.name}`);
  }

  /* ---------- Little Sillage: links from other apps open in a small, separate window ----------
     Like Arc's "Little Arc": nothing lands in a workspace unless asked; "Open in" moves the tab into the
     main window. Firefox hands external links to browserDOMWindow.openURI with OPEN_EXTERNAL. */

  function hookExternalLinks() {
    const orig = window.browserDOMWindow;
    if (!orig || orig.sillageWrapper) return;
    // Its methods are read-only, so wrap the whole object: openURI is intercepted, everything else is
    // forwarded to Firefox's implementation.
    const wrapper = { sillageWrapper: true, QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]) };
    const names = new Set();
    for (let o = orig; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const n of Object.getOwnPropertyNames(o)) names.add(n);
    for (const n of names) {
      if (n === "constructor" || n === "QueryInterface" || n === "openURI") continue;
      Object.defineProperty(wrapper, n, { get: () => (typeof orig[n] === "function" ? orig[n].bind(orig) : orig[n]), enumerable: true });
    }
    wrapper.openURI = (uri, openWindowInfo, where, flags, ...rest) => {
      if (D.settings.littleWindow && (flags & Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL) && /^https?:/.test(uri?.spec || "")) {
        openLittle(uri.spec);
        return null;
      }
      return orig.openURI(uri, openWindowInfo, where, flags, ...rest);
    };
    window.browserDOMWindow = wrapper;
  }

  /* With several profiles, the window first asks which one to open the link with (its container decides
     which accounts the page is signed in to); nothing is loaded before the choice. */
  function openLittle(url) {
    const pick = D.profiles.length > 1;
    const w = window.openDialog(AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,all,dialog=no,width=1000,height=720", pick ? "about:blank" : url);
    shared.littleWindows.add(w);
    if (pick) (shared.littlePick ||= new WeakMap()).set(w, url);
    return w;
  }

  /* The profile offered first: the last one chosen here, otherwise the main window's. */
  function defaultLittleProfile() {
    return D.profiles.find(p => p.id === D.settings.littleProfile) || profOf(D.lastWs);
  }

  let pickBox = null;
  function showProfilePick(url) {
    const def = defaultLittleProfile();
    const choose = p => {
      if (!pickBox) return;
      pickBox.remove();
      pickBox = null;
      window.removeEventListener("keydown", onKey, true);
      D.settings.littleProfile = p.id;
      save();
      const blank = gBrowser.selectedTab;
      const t = gBrowser.addTrustedTab(url, { userContextId: p.userContextId, inBackground: false, skipAnimation: true });
      gBrowser.selectedTab = t;
      if (blank !== t) gBrowser.removeTab(blank, { animate: false });
      gBrowser.selectedBrowser.focus();
      renderLittle();
    };
    const onKey = e => {
      const m = /^Digit([1-9])$/.exec(e.code);
      if (e.key === "Escape") window.close();
      else if (m && !e.ctrlKey && !e.metaKey && !e.altKey && D.profiles[+m[1] - 1]) choose(D.profiles[+m[1] - 1]);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const btns = [...pickBox.querySelectorAll(".sl-lp-btn")];
        const i = btns.indexOf(doc.activeElement);
        btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    pickBox = h("div", { id: "sl-little-pick" },
      h("div", { class: "sl-lp-card" },
        h("div", { class: "sl-lp-title", text: "Open with which profile?" }),
        h("div", { class: "sl-lp-url", text: host(url) || url, title: url }),
        h("div", { class: "sl-lp-list" }, D.profiles.map((p, i) => h("button", {
          class: `sl-lp-btn${p === def ? " default" : ""}`, "data-profile": p.id, onclick: () => choose(p),
        },
        h("kbd", { text: String(i + 1) }),
        h("span", { class: "sl-lp-name", text: p.name }),
        h("span", { class: "sl-lp-ws", text: D.workspaces.filter(w => w.profile === p.id).map(w => w.icon).join(" ") })))),
        h("div", { class: "sl-lp-hint", text: "Enter opens the highlighted profile · Esc cancels" })));
    doc.body.append(pickBox);
    window.addEventListener("keydown", onKey, true);
    setTimeout(() => pickBox?.querySelector(".sl-lp-btn.default")?.focus(), 0);
  }

  const tabProfileOf = t => D.profiles.find(p => p.userContextId === (t.userContextId || 0)) || null;

  function mainWindow() {
    for (const w of Services.wm.getEnumerator("navigator:browser")) {
      if (w !== window && !w.closed && w.Sillage && !w.Sillage.isLittle && w.toolbar.visible && !PrivateBrowsingUtils.isWindowPrivate(w)) return w;
    }
    return null;
  }

  let littleBar;
  function enterLittle() {
    little = true;
    SessionStore.setCustomWindowValue(window, "sillage-little", "1");
    doc.documentElement.classList.add("sl-little");
    // Window title prefix, so window managers can float these windows (e.g. a Hyprland rule on the title).
    const origTitle = gBrowser.getWindowTitleForBrowser.bind(gBrowser);
    gBrowser.getWindowTitleForBrowser = b => "Little Sillage — " + origTitle(b);
    gBrowser.updateTitlebar?.();
    littleBar = h("div", { id: "sl-little-bar" });
    $("#tabbrowser-tabbox").prepend(littleBar);
    renderLittle();
    const url = shared.littlePick?.get(window);
    if (url) { shared.littlePick.delete(window); showProfilePick(url); }
  }

  function renderLittle() {
    if (!littleBar) return;
    const t = gBrowser.selectedTab;
    const main = mainWindow();
    // "Open in": the main window's workspace, or the last used workspace of the tab's profile (moving the tab
    // into another profile's workspace would reload it signed out).
    const prof = tabProfileOf(t);
    let target = main?.Sillage?.activeWorkspace;
    if (prof && target && target.profile !== prof.id) {
      target = D.workspaces.find(w => w.id === D.lastWsByProfile?.[prof.id] && w.profile === prof.id) || D.workspaces.find(w => w.profile === prof.id) || target;
    }
    littleBar.replaceChildren(...[
      favicon(tabUrl(t), tabIcon(t), t.hasAttribute("busy")),
      h("span", { class: "sl-little-host", text: host(tabUrl(t)), title: tabUrl(t) }),
      h("span", { class: "sl-little-spacer" }),
      // Profile of the page; another one reopens it in that profile's container.
      D.profiles.length > 1 && prof && !pickBox && h("button", { class: "sl-little-prof", title: "Profile (cookies, sign-ins): click to reopen the page in another one",
        onclick: e => popup(e, D.profiles.map(p => ({ label: p.name, disabled: p === prof, fn: () => { D.settings.littleProfile = p.id; save(); rehome(gBrowser.selectedTab, p.userContextId); renderLittle(); } }))) },
        icon("user"), h("span", { text: prof.name })),
      h("button", { class: "sl-little-open", title: "Move this tab into the main window", onclick: () => moveToMain(target?.id) },
        target ? `Open in ${target.icon} ${target.name}` : "Open in Sillage"),
      main && D.workspaces.length > 1 && h("button", { class: "sl-little-more", title: "Choose a workspace", onclick: e => popup(e, D.workspaces.map(w => ({ label: `${w.icon}  ${w.name}`, fn: () => moveToMain(w.id) }))) }, icon("chev")),
      h("button", { class: "sl-little-close", title: "Close", onclick: () => window.close() }, icon("x")),
    ].filter(Boolean));
  }

  /* Moves the current tab into a workspace of the main window (or turns this window into a regular one). */
  function moveToMain(wsId) {
    const main = mainWindow();
    if (!main) {
      little = false;
      SessionStore.deleteCustomWindowValue(window, "sillage-little");
      doc.documentElement.classList.remove("sl-little");
      littleBar?.remove();
      littleBar = null;
      for (const t of gBrowser.tabs) setVal(t, WS_KEY, activeWs);
      applyVisibility();
      return render();
    }
    const t = gBrowser.selectedTab;
    const adopted = main.gBrowser.adoptTab(t, { selectTab: true });
    if (adopted) main.Sillage.adoptIntoWorkspace(adopted, wsId);
    main.focus();
    if (!gBrowser.tabs.some(x => alive(x) && x !== t)) window.close();
  }

  /* Called on the main window for a tab moved in from a Little Sillage window. */
  function adoptIntoWorkspace(t, wsId = activeWs) {
    if (!wsById(wsId)) wsId = activeWs;
    setVal(t, ITEM_KEY, "");
    setVal(t, WS_KEY, wsId);
    t = rehome(t, profOf(wsId).userContextId);
    const first = todayTabs(wsId).find(x => x !== t);
    if (first) gBrowser.moveTabBefore(t, first);
    selectTab(t);
    render();
    return t;
  }

  /* ---------- Glance: a link that would open a new tab shows in a card over the page ----------
     Like Arc's Peek. The card is a real tab shown with Firefox's split view (so both pages stay live,
     with their history, find bar and permissions), restyled as a floating card. Clicking beside it or
     Escape closes it; "Open as tab" keeps it as a regular tab. Shift+click opens any link this way. */

  let glance = null; // { tab, parent, split }
  const glanceEnabled = () => D.settings.glance !== false;

  function hookGlance() {
    const addTab = gBrowser.addTab;
    gBrowser.addTab = function (uri, opts = {}) {
      const opener = opts.openerBrowser && gBrowser.getTabForBrowser(opts.openerBrowser);
      // A link opened from inside the card: the card becomes a regular tab first.
      if (glance && opener === glance.tab) closeGlance({ keep: true });
      const want = glanceEnabled() && !little && !glance && !boardOpen && opener?.selected && !isBlank(opener)
        && !opts.inBackground && !opts.fromExternal && typeof gBrowser.addTabSplitView === "function";
      if (!want) return addTab.call(this, uri, opts);
      const t = addTab.call(this, uri, { ...opts, inBackground: true });
      try { openGlance(t, opener); } catch (e) { log("glance " + e + "\n" + e.stack); closeGlance({ keep: true }); }
      return t;
    };
    // Shift+click (a new window in Firefox) opens the link in a card.
    const openLinkIn = window.openLinkIn;
    if (openLinkIn) window.openLinkIn = function (url, where, params = {}) {
      if (where === "window" && params.openerBrowser && glanceEnabled() && !little) {
        where = "tab";
        params = { ...params, inBackground: false };
      }
      return openLinkIn.call(this, url, where, params);
    };
    // Escape closes the card when the page does not use the key itself (Escape is Firefox's "Stop").
    $("#Browser\\:Stop")?.addEventListener("command", e => {
      if (glance && e.sourceEvent instanceof KeyboardEvent) closeGlance();
    });
  }

  function openGlance(t, parent) {
    const split = gBrowser.addTabSplitView([parent, t], { insertBefore: parent });
    if (!split) throw new Error("no split view");
    glance = { tab: t, parent, split };
    gBrowser.setSuccessor(t, parent);
    doc.getElementById(parent.linkedPanel)?.setAttribute("sl-glance-base", "");
    doc.getElementById(t.linkedPanel)?.setAttribute("sl-glance-card", "");
    doc.documentElement.setAttribute("sl-glance", "");
    glanceBox.hidden = false;
    gBrowser.selectedTab = t;
    positionGlance();
    render();
  }

  /* keep: the card stays as a regular tab of the workspace (selected); otherwise it is closed.
     closing: one of the two tabs is being closed; Firefox's split view then undoes itself. */
  function closeGlance({ keep = false, select = true, closing = false } = {}) {
    if (!glance) return;
    const { tab, parent, split } = glance;
    glance = null;
    const unstyle = () => {
      doc.documentElement.removeAttribute("sl-glance");
      for (const el of doc.querySelectorAll("[sl-glance-base], [sl-glance-card]")) el.removeAttribute(el.hasAttribute("sl-glance-base") ? "sl-glance-base" : "sl-glance-card");
      glanceBox.hidden = true;
    };
    unstyle();
    setTimeout(() => sendToBackground(parent, tab), 0);
    if (closing) return render();
    try { if (split.isConnected) split.unsplitTabs(); } catch (e) { log("unsplit " + e); }
    if (keep && alive(tab)) { selectTab(tab); touchMru(tab); }
    else {
      if (select && alive(parent)) gBrowser.selectedTab = parent;
      if (alive(tab)) gBrowser.removeTab(tab, { animate: false, skipPermitUnload: false });
    }
    render();
  }

  /* Firefox's tab switcher keeps the pages of a split view rendering when another tab is chosen. Once the
     split view is gone nothing turns them off, and switching back later finds a page it believes is already
     painted: the tab shows nothing. Pages left in the background go back to the normal background state. */
  function sendToBackground(...tabs) {
    for (const t of tabs) {
      if (!alive(t) || t.selected || t.splitview || !t.linkedBrowser.docShellIsActive) continue;
      t.linkedBrowser.docShellIsActive = false;
    }
  }

  let glanceBox, glanceTitle;
  function buildGlance() {
    glanceTitle = h("span", { class: "sl-glance-title" });
    glanceBox = h("div", { id: "sl-glance", hidden: true },
      h("div", { class: "sl-glance-shade" }),
      h("div", { class: "sl-glance-bar" },
        glanceTitle,
        h("button", { class: "sl-glance-btn", "data-act": "copy", title: "Copy link" }, icon("link")),
        h("button", { class: "sl-glance-btn wide", "data-act": "keep", title: "Open as a tab" }, icon("expand"), h("span", { text: "Open as tab" })),
        h("button", { class: "sl-glance-btn", "data-act": "close", title: "Close (Esc)" }, icon("x"))));
    glanceBox.addEventListener("click", e => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "keep") closeGlance({ keep: true });
      else if (act === "copy") { if (glance) copyUrl(tabUrl(glance.tab)); }
      else if (act === "close" || e.target.closest(".sl-glance-shade")) closeGlance();
    });
    doc.body.append(glanceBox);
  }

  /* The card's place is computed here (not measured: it is animated), then used by the card's CSS and by
     the shade, which covers the page area except the card (a hole in its clip path lets clicks through). */
  function positionGlance() {
    if (!glance) return;
    const box = $("#tabbrowser-tabbox").getBoundingClientRect();
    const panels = gBrowser.tabpanels.getBoundingClientRect();
    const side = Math.max(24, panels.width * 0.08);
    const card = { l: panels.left - box.left + side, t: panels.top - box.top + 44, w: panels.width - 2 * side, h: panels.height - 44 - 14 };
    const root = doc.documentElement.style;
    root.setProperty("--gl-side", side + "px");
    for (const [k, v] of Object.entries({ x: box.left, y: box.top, w: box.width, h: box.height })) glanceBox.style.setProperty(`--gl-${k}`, v + "px");
    const l = card.l, t = card.t, r = l + card.w, b = t + card.h;
    glanceBox.querySelector(".sl-glance-shade").style.clipPath =
      `polygon(evenodd, 0 0, ${box.width}px 0, ${box.width}px ${box.height}px, 0 ${box.height}px, 0 0, ${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`;
    glanceBox.style.setProperty("--gl-card-l", l + "px");
    glanceBox.style.setProperty("--gl-card-r", box.width - r + "px");
    glanceBox.style.setProperty("--gl-card-t", t + "px");
    updateGlanceTitle();
  }
  function updateGlanceTitle() {
    if (!glance || !glanceTitle) return;
    const url = tabUrl(glance.tab);
    glanceTitle.textContent = glance.tab.label && glance.tab.label !== url ? glance.tab.label : host(url) || url;
    glanceTitle.title = url;
  }

  /* ---------- Board: an infinite canvas per workspace ----------
     Sticky notes, free text and basic shapes (line, arrow, rectangle, ellipse), with colors, fonts and sizes.
     Notes have a lifetime (7 days by default, adjustable per note). When it runs out a note is kept and
     raises a red alert, in the board and in the sidebar, until it is renewed, snoozed or deleted. */

  const DAY = 86400e3;
  const LIFETIMES = [[DAY, "1 day"], [3 * DAY, "3 days"], [7 * DAY, "7 days"], [14 * DAY, "2 weeks"], [30 * DAY, "1 month"], [0, "No expiry"]];
  const SNOOZES = [[3600e3, "In 1 hour"], [4 * 3600e3, "In 4 hours"], [DAY, "Tomorrow"], [3 * DAY, "In 3 days"], [7 * DAY, "In a week"]];
  const NOTE_COLORS = ["yellow", "pink", "blue", "green", "purple"];
  const INKS = ["ink", "gray", "red", "orange", "green", "blue", "purple", "pink"];
  const FILLS = ["none", ...INKS.slice(1)];
  const FONTS = {
    sans: ["Sans", "system-ui, sans-serif"],
    serif: ["Serif", "Georgia, 'Times New Roman', serif"],
    mono: ["Mono", "ui-monospace, 'DejaVu Sans Mono', monospace"],
    hand: ["Hand", "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', cursive"],
  };
  const SIZES = { S: 13, M: 16, L: 22, XL: 32 };
  const WIDTHS = { thin: 1.5, medium: 3, bold: 6 };
  const TOOLS = [
    ["select", "V", "Select and move", "cursor"], ["note", "N", "Sticky note", "board"], ["text", "T", "Text", "text"],
    ["line", "L", "Line", "line"], ["arrow", "A", "Arrow", "arrow"], ["rect", "R", "Rectangle", "rect"], ["ellipse", "O", "Ellipse", "ellipse"],
  ];
  const SHAPES = new Set(["line", "arrow", "rect", "ellipse"]);
  let boardOpen = false, boardWrap, boardView, boardWorld, boardSvg, boardStyleBar, boardTimer, boardHideTimer;
  let tool = "select", selectedId = null, boardBusy = 0; // boardBusy: a drag is in progress

  function board(ws = curWs()) {
    ws.board ||= { notes: [], view: { x: 0, y: 0, z: 1 } };
    ws.board.notes ||= [];
    ws.board.items ||= [];
    ws.board.view ||= { x: 0, y: 0, z: 1 };
    return ws.board;
  }
  const noteLifetime = () => D.settings.noteLifetime ?? 7 * DAY;
  /* Style for new items (also updated by the last style chosen, as in Excalidraw). */
  const boardStyle = () => (D.settings.boardStyle = { color: "ink", fill: "none", width: "medium", font: "sans", size: "M", noteColor: null, ...D.settings.boardStyle });
  const inkVar = c => `var(--bc-${INKS.includes(c) ? c : "ink"})`;
  const fillVar = c => (FILLS.includes(c) && c !== "none" ? `var(--bf-${c})` : "none");
  const fontOf = f => (FONTS[f] || FONTS.sans)[1];
  const sizeOf = s => SIZES[s] || SIZES.M;

  const isExpired = n => n.expires != null && n.expires <= Date.now();
  const expiredCount = ws => (ws.board?.notes || []).filter(isExpired).length;

  function span(ms) {
    const d = Math.floor(ms / DAY), hh = Math.floor(ms % DAY / 3600e3), mm = Math.floor(ms % 3600e3 / 60e3);
    return d ? `${d}d ${hh}h` : hh ? `${hh}h ${mm}m` : `${Math.max(1, mm)}m`;
  }
  function remaining(n) {
    if (n.expires == null) return { ms: Infinity, label: "No expiry", ratio: 1, expired: false };
    const ms = n.expires - Date.now();
    if (ms <= 0) return { ms, label: `Expired ${span(-ms)} ago`, ratio: 0, expired: true };
    if (n.snoozed) return { ms, label: `Reminder in ${span(ms)}`, ratio: 1, expired: false };
    const life = n.lifetime || Math.max(1, n.expires - (n.created || n.expires - 7 * DAY));
    return { ms, label: `${span(ms)} left`, ratio: Math.min(1, ms / life), expired: false };
  }

  /* Gives a note a new lifetime from now (0: no expiry). */
  function renewNote(n, lifetime = n.lifetime ?? noteLifetime()) {
    n.lifetime = lifetime;
    n.expires = lifetime ? Date.now() + lifetime : null;
    delete n.snoozed;
    save();
    renderBoard();
    render();
  }
  /* "Remind me later": silences the alert, which comes back after the delay. */
  function snoozeNote(n, delay) {
    n.expires = Date.now() + delay;
    n.snoozed = true;
    save();
    renderBoard();
    render();
  }
  function lifetimeMenu(e, n) {
    popup(e, [
      ...LIFETIMES.map(([ms, label]) => ({ label: `${n ? "Keep for" : "New notes last"} ${label.toLowerCase()}${ms === noteLifetime() && !n ? " ✓" : ""}`,
        fn: () => (n ? renewNote(n, ms) : (D.settings.noteLifetime = ms, save(), renderBoard())) })),
      n && "-",
      ...(n ? SNOOZES.map(([ms, label]) => ({ label: `Remind me ${label.toLowerCase()}`, fn: () => snoozeNote(n, ms) })) : []),
    ]);
  }

  const SVG = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs = {}) {
    const e = doc.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    return e;
  }

  function buildBoard() {
    boardSvg = svgEl("svg", { id: "sl-board-svg", width: "1", height: "1" });
    boardWorld = h("div", { id: "sl-board-world" });
    boardView = h("div", { id: "sl-board-view", tabindex: "-1" }, boardWorld);
    const title = h("span", { class: "sl-board-title" });
    const zoom = h("span", { class: "sl-board-zoom" });
    const tools = h("div", { class: "sl-board-tools" }, TOOLS.map(([id, key, label, ic]) =>
      h("button", { class: "sl-board-tool", "data-tool": id, title: `${label} (${key})`, onclick: () => setTool(id) }, icon(ic))));
    const lifeBtn = h("button", { class: "sl-board-btn sl-board-life", title: "Lifetime of new notes", onclick: e => lifetimeMenu(e, null) });
    const mod = IS_MAC ? "⌘" : "Ctrl+";
    const undoBtn = h("button", { class: "sl-board-btn", title: `Undo (${mod}Z)`, onclick: () => boardUndo() }, icon("undo"));
    const redoBtn = h("button", { class: "sl-board-btn", title: `Redo (${mod}${IS_MAC ? "⇧Z" : "Y"})`, onclick: () => boardUndo(true) }, icon("redo"));
    boardStyleBar = h("div", { id: "sl-board-style" });
    boardWrap = h("div", { id: "sl-board-wrap", hidden: true },
      h("div", { id: "sl-board-bar" },
        h("span", { class: "sl-orb-mini" }, h("img", { src: "chrome://sillage/content/logo-mark.svg", alt: "" })),
        title, tools, h("span", { class: "sl-board-spacer" }), undoBtn, redoBtn, lifeBtn, zoom,
        h("button", { class: "sl-board-btn", title: "Close (Esc)", onclick: closeBoard }, icon("x"))),
      boardStyleBar,
      boardView);
    Object.assign(boardWrap, { titleEl: title, zoomEl: zoom, toolsEl: tools, lifeEl: lifeBtn, undoEl: undoBtn, redoEl: redoBtn });
    doc.body.append(boardWrap);

    const view = () => board().view;
    const apply = () => {
      const v = view();
      boardWorld.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
      boardView.style.backgroundPosition = `${v.x}px ${v.y}px`;
      boardView.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
      zoom.textContent = `${Math.round(v.z * 100)}%`;
      boardWrap.style.setProperty("--bd-z", v.z);
    };
    boardWrap.apply = apply;
    const toWorld = (cx, cy) => {
      const r = boardView.getBoundingClientRect(), v = view();
      return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
    };
    const isBackground = t => t === boardView || t === boardWorld || t === boardSvg;
    // Last pointer position over the board: pasted items land there.
    let pointer = null;
    boardView.addEventListener("pointermove", e => { pointer = { x: e.clientX, y: e.clientY }; });
    boardView.addEventListener("pointerleave", () => { pointer = null; });
    // Pointer drags are captured by the view, so moves keep coming outside the element that started them.
    const track = (e, move, up) => {
      try { boardView.setPointerCapture(e.pointerId); } catch {}
      boardBusy++;
      const m = ev => move(ev), u = ev => {
        boardView.removeEventListener("pointermove", m);
        boardView.removeEventListener("pointerup", u);
        boardBusy--;
        up?.(ev);
      };
      boardView.addEventListener("pointermove", m);
      boardView.addEventListener("pointerup", u);
    };

    boardView.addEventListener("pointerdown", e => {
      if (e.target.closest(".sl-note") || e.target.closest(".sl-btext[contenteditable=true]")) return;
      const b = board(), p = toWorld(e.clientX, e.clientY);
      // Middle button, or Space held: pan whatever the tool.
      const pan = e.button === 1 || (e.button === 0 && tool === "select" && isBackground(e.target)) || boardView.classList.contains("space");
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      boardView.focus({ preventScroll: true });

      if (!pan && SHAPES.has(tool)) {
        const st = boardStyle();
        const it = { kind: tool, id: uid(), x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color, width: st.width };
        if (tool === "rect" || tool === "ellipse") it.fill = st.fill;
        b.items.push(it);
        select(it.id);
        track(e, ev => {
          const q = toWorld(ev.clientX, ev.clientY);
          it.x2 = q.x; it.y2 = q.y;
          if (ev.shiftKey) constrain(it);
          renderShapes();
        }, () => {
          // A simple click makes a default-sized shape.
          if (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 4) { it.x2 = it.x1 + 120; it.y2 = it.y1 + (SHAPES.has(tool) && /line|arrow/.test(tool) ? 0 : 80); }
          normalize(it);
          setTool("select");
          save();
          renderBoard();
        });
        return;
      }
      if (!pan && tool === "note") { const n = addNote(p.x - 110, p.y - 20); setTool("select"); select(n.id); return; }
      if (!pan && tool === "text") { addText(p.x, p.y - sizeOf(boardStyle().size) * .7); setTool("select"); return; }

      const handle = e.target.closest?.("[data-handle]");
      const itemEl = e.target.closest?.("[data-item]");
      if (!pan && handle) {
        const it = b.items.find(i => i.id === selectedId);
        if (!it) return;
        const [hx, hy] = handle.dataset.handle.split(",");
        track(e, ev => {
          const q = toWorld(ev.clientX, ev.clientY);
          it[hx] = q.x; it[hy] = q.y;
          if (ev.shiftKey && /line|arrow/.test(it.kind)) constrain(it, hx === "x1");
          renderShapes();
        }, () => { normalize(it); save(); renderBoard(); });
        return;
      }
      if (!pan && itemEl) {
        const it = b.items.find(i => i.id === itemEl.dataset.item);
        if (!it) return;
        select(it.id);
        const start = { x: p.x, y: p.y }, orig = { ...it };
        let moved = false;
        track(e, ev => {
          const q = toWorld(ev.clientX, ev.clientY), dx = q.x - start.x, dy = q.y - start.y;
          moved ||= Math.hypot(dx, dy) * view().z > 2;
          for (const k of ["x", "x1", "x2"]) if (k in it) it[k] = orig[k] + dx;
          for (const k of ["y", "y1", "y2"]) if (k in it) it[k] = orig[k] + dy;
          if (it.kind === "text" || it.kind === "link") { itemEl.style.left = it.x + "px"; itemEl.style.top = it.y + "px"; }
          else renderShapes();
        }, () => {
          if (moved) save();
          // A click (no move) on a link goes to its tab.
          else if (it.kind === "link") openLink(it);
        });
        return;
      }
      // Background: deselect and pan.
      select(null);
      const v = view(), start = { x: e.clientX - v.x, y: e.clientY - v.y };
      boardView.classList.add("panning");
      track(e, ev => { v.x = ev.clientX - start.x; v.y = ev.clientY - start.y; apply(); }, () => {
        boardView.classList.remove("panning");
        save();
      });
    });
    // Scroll pans, Ctrl+scroll zooms around the cursor.
    boardView.addEventListener("wheel", e => {
      if ((e.target.closest(".sl-note textarea") || e.target.closest(".sl-btext[contenteditable=true]")) && !e.ctrlKey) return;
      e.preventDefault();
      const v = view();
      if (e.ctrlKey || e.metaKey) {
        const p = toWorld(e.clientX, e.clientY);
        v.z = Math.min(2.5, Math.max(0.25, v.z * Math.exp(-e.deltaY / 400)));
        const r = boardView.getBoundingClientRect();
        v.x = e.clientX - r.left - p.x * v.z;
        v.y = e.clientY - r.top - p.y * v.z;
      } else { v.x -= e.deltaX; v.y -= e.deltaY; }
      apply();
      clearTimeout(boardWrap.saveT);
      boardWrap.saveT = setTimeout(save, 400);
    }, { passive: false });
    // Drop a tab, pinned item or link: it becomes a link block (the sidebar is left as it is).
    const dropUrl = dt => {
      const moz = dt.getData("text/x-moz-url");
      if (moz) { const [url, title] = moz.split("\n"); return { url, title }; }
      const uri = dt.getData("text/uri-list").split("\n").find(l => l && !l.startsWith("#"));
      if (uri) return { url: uri.trim() };
      const txt = dt.getData("text/plain").trim();
      return /^(https?|file):\/\/\S+$/.test(txt) ? { url: txt } : null;
    };
    const accepts = dt => ["text/x-moz-url", "text/uri-list", "text/plain"].some(t => dt.types.includes(t));
    boardView.addEventListener("dragover", e => {
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      // The effect must be one the source allows, or the drop is refused (sidebar rows only allow "move").
      const allowed = e.dataTransfer.effectAllowed;
      e.dataTransfer.dropEffect = /link|all|uninit/i.test(allowed) ? "link" : /copy/i.test(allowed) ? "copy" : "move";
      boardView.classList.add("drop-target");
    });
    boardView.addEventListener("dragleave", e => { if (e.target === boardView) boardView.classList.remove("drop-target"); });
    boardView.addEventListener("drop", e => {
      boardView.classList.remove("drop-target");
      const from = dragging; // from the sidebar: tab or pinned item
      const d = dropUrl(e.dataTransfer);
      if (!d?.url) return;
      e.preventDefault();
      e.stopPropagation();
      const p = toWorld(e.clientX, e.clientY);
      const t = from?.tab, r = from?.item ? findItem(from.item) : null;
      addLink(p.x - 20, p.y - 16, {
        url: d.url,
        title: t?.label || r?.item.customTitle || r?.item.title || d.title,
        icon: t ? tabIcon(t) : r?.item.icon,
        item: r?.item.id || (t && tabItemId(t)) || null,
      });
      if (from) endDrag();
    });
    boardView.addEventListener("dblclick", e => {
      if (!isBackground(e.target)) return;
      const p = toWorld(e.clientX, e.clientY);
      select(addNote(p.x - 110, p.y - 20).id);
    });
    boardWrap.addEventListener("keydown", e => {
      const typing = e.target.closest("textarea, input, [contenteditable=true]");
      if (e.key === " " && !typing) { boardView.classList.add("space"); return; }
      if (typing) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (tool !== "select") setTool("select");
        else if (selectedId) select(null);
        else closeBoard();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); deleteBoardItem(selectedId); return; }
      // Ctrl (⌘) + Z / Shift+Z / Y / C / X / V / D. e.key, not e.code: the letters move with the layout (AZERTY).
      if (accel(e) && !e.altKey) {
        const k = e.key.toLowerCase();
        const act = k === "z" ? (e.shiftKey ? () => boardUndo(true) : () => boardUndo())
          : e.shiftKey ? null
          : { y: () => boardUndo(true), c: () => boardCopy(), x: () => boardCopy(true), d: () => boardDuplicate(),
              v: () => boardPaste(pointer && toWorld(pointer.x, pointer.y)) }[k];
        if (act) { e.preventDefault(); e.stopPropagation(); act(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find(([, key]) => key === e.key.toUpperCase());
      if (t) { e.preventDefault(); setTool(t[0]); }
    });
    boardWrap.addEventListener("keyup", e => { if (e.key === " ") boardView.classList.remove("space"); });
  }

  /* Shift while drawing: horizontal / vertical / 45° lines, squares and circles. */
  function constrain(it, fromEnd = false) {
    const [ax, ay, bx, by] = fromEnd ? ["x2", "y2", "x1", "y1"] : ["x1", "y1", "x2", "y2"];
    const dx = it[bx] - it[ax], dy = it[by] - it[ay];
    if (it.kind === "rect" || it.kind === "ellipse") {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      it[bx] = it[ax] + Math.sign(dx || 1) * s; it[by] = it[ay] + Math.sign(dy || 1) * s;
    } else {
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
      it[bx] = it[ax] + Math.cos(a) * len; it[by] = it[ay] + Math.sin(a) * len;
    }
  }
  /* Rounds coordinates; rectangles and ellipses keep x1,y1 as their top-left corner. */
  function normalize(it) {
    if (it.kind === "rect" || it.kind === "ellipse") {
      [it.x1, it.x2] = [Math.min(it.x1, it.x2), Math.max(it.x1, it.x2)];
      [it.y1, it.y2] = [Math.min(it.y1, it.y2), Math.max(it.y1, it.y2)];
    }
    for (const k of ["x", "y", "x1", "y1", "x2", "y2"]) if (k in it) it[k] = Math.round(it[k]);
  }

  function setTool(t) {
    tool = t;
    if (t !== "select") select(null, { keepBar: true });
    boardWrap?.toolsEl.querySelectorAll(".sl-board-tool").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
    boardView?.classList.toggle("drawing", t !== "select");
    drawStyleBar();
  }

  /* Selection: a note, a text or a shape. Updates marks and the style bar without rebuilding the board. */
  function select(id) {
    selectedId = id;
    for (const el of boardWorld.querySelectorAll(".sl-selected")) el.classList.remove("sl-selected");
    if (id) boardWorld.querySelector(`[data-note="${id}"], .sl-btext[data-item="${id}"], .sl-blink[data-item="${id}"]`)?.classList.add("sl-selected");
    renderShapes();
    drawStyleBar();
  }
  function selectedObject() {
    if (!selectedId) return null;
    const b = board();
    const n = b.notes.find(x => x.id === selectedId);
    return n ? { kind: "note", obj: n } : (o => o && { kind: o.kind, obj: o })(b.items.find(x => x.id === selectedId));
  }

  function deleteBoardItem(id) {
    const b = board();
    b.notes = b.notes.filter(n => n.id !== id);
    b.items = b.items.filter(i => i.id !== id);
    if (selectedId === id) selectedId = null;
    save();
    renderBoard();
    render();
  }

  /* Undo / redo: snapshots of the board's notes and items (not of the view), taken whenever data is saved.
     One history per workspace, kept for this window's session. */
  const boardHist = new Map();
  const boardSnap = b => JSON.stringify({ notes: b.notes, items: b.items }, (k, v) => (k.startsWith("_") ? undefined : v));
  function boardCommit() {
    const ws = curWs();
    if (!ws?.board) return;
    const snap = boardSnap(board(ws)), hst = boardHist.get(ws.id);
    if (!hst) boardHist.set(ws.id, { last: snap, undo: [], redo: [] });
    else if (hst.last !== snap) {
      hst.undo.push(hst.last);
      if (hst.undo.length > 100) hst.undo.shift();
      hst.redo = [];
      hst.last = snap;
    }
    updateUndoButtons();
  }
  /* Changes that did not come from this board (sync, another window) are not undone as a step. */
  function boardRebase() {
    for (const [id, hst] of boardHist) { const w = wsById(id); if (w?.board) hst.last = boardSnap(w.board); else boardHist.delete(id); }
    updateUndoButtons();
  }
  function updateUndoButtons() {
    if (!boardWrap) return;
    const hst = boardHist.get(curWs()?.id);
    boardWrap.undoEl.disabled = !hst?.undo.length;
    boardWrap.redoEl.disabled = !hst?.redo.length;
  }
  function boardUndo(redo = false) {
    boardCommit(); // text typed since the last save
    const ws = curWs(), hst = boardHist.get(ws.id);
    const from = redo ? hst?.redo : hst?.undo, to = redo ? hst?.undo : hst?.redo;
    if (!from?.length) return false;
    to.push(hst.last);
    hst.last = from.pop();
    const st = JSON.parse(hst.last), b = board(ws);
    b.notes = st.notes;
    b.items = st.items;
    save();
    renderBoard();
    render();
    return true;
  }

  /* Copy / cut / paste / duplicate. The copied item stays in memory; its text (or URL) also goes to the
     system clipboard. Pasting brings back the item while the clipboard still holds what was copied;
     otherwise the clipboard's text becomes a text item, or a link block for a URL. */
  let boardClip = null;
  const plain = o => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith("_") ? undefined : v)));
  function readClipboard() {
    try {
      const tr = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
      tr.init(null);
      tr.addDataFlavor("text/plain");
      Services.clipboard.getData(tr, Ci.nsIClipboard.kGlobalClipboard);
      const out = {};
      tr.getTransferData("text/plain", out);
      return out.value?.QueryInterface(Ci.nsISupportsString).data || "";
    } catch { return ""; }
  }
  function boardCopy(cut = false) {
    const sel = selectedObject();
    if (!sel) return false;
    const text = sel.kind === "link" ? sel.obj.url : sel.obj.text || "";
    if (text) Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
    boardClip = { kind: sel.kind, obj: plain(sel.obj), text: text || readClipboard() };
    if (cut) deleteBoardItem(sel.obj.id);
    return true;
  }
  function boardPaste(at = null) {
    const text = readClipboard();
    if (boardClip && text === boardClip.text) return placeCopy(boardClip, at);
    const s = text.trim();
    if (!s) return null;
    const v = board().view, r = boardView.getBoundingClientRect();
    const p = at || { x: (r.width / 2 - v.x) / v.z - 60, y: (r.height / 2 - v.y) / v.z - 20 };
    if (/^(https?|file):\/\/\S+$/.test(s)) return addLink(p.x, p.y, { url: s });
    const it = addText(p.x, p.y, s);
    if (boardOpen) select(it.id);
    return it;
  }
  function boardDuplicate() {
    const sel = selectedObject();
    return sel ? placeCopy({ kind: sel.kind, obj: plain(sel.obj) }) : null;
  }
  /* Adds a copy of clip.obj, with its top-left corner at `at` (world coordinates), or offset from the
     original; repeated pastes cascade. */
  function placeCopy(clip, at = null) {
    const o = plain(clip.obj);
    o.id = uid();
    const ox = o.x ?? Math.min(o.x1, o.x2), oy = o.y ?? Math.min(o.y1, o.y2);
    const dx = at ? at.x - ox : 24, dy = at ? at.y - oy : 24;
    for (const k of ["x", "x1", "x2"]) if (k in o) o[k] += dx;
    for (const k of ["y", "y1", "y2"]) if (k in o) o[k] += dy;
    normalize(o);
    if (!at) clip.obj = plain(o);
    const b = board();
    if (clip.kind === "note") {
      const now = Date.now();
      o.created = now;
      o.expires = o.lifetime ? now + o.lifetime : null;
      delete o.snoozed;
      b.notes.push(o);
    } else b.items.push(o);
    save();
    renderBoard();
    if (boardOpen) select(o.id);
    render();
    return o;
  }

  /* Style bar: colors, fill, stroke width, font and size of the selection (or of the next item drawn). */
  function drawStyleBar() {
    if (!boardStyleBar) return;
    const sel = selectedObject();
    const kind = sel ? sel.kind : tool === "select" ? null : tool;
    boardStyleBar.hidden = !kind;
    if (!kind) return boardStyleBar.replaceChildren();
    const st = boardStyle();
    const cur = sel ? sel.obj : st;
    const set = (key, value) => {
      if (sel) { sel.obj[key] = value; }
      // The choice also becomes the default for new items.
      if (kind === "note" && key === "color") st.noteColor = value; else st[key] = value;
      save();
      if (sel) renderBoard(); else drawStyleBar();
    };
    const group = (label, ...kids) => h("div", { class: "sl-bs-group" }, h("span", { class: "sl-bs-label", text: label }), ...kids);
    const swatches = (key, list, varOf, value) => list.map(c => h("button", {
      class: `sl-bs-swatch${c === value ? " on" : ""}${c === "none" ? " none" : ""}`, title: c, style: c === "none" ? "" : `--sw:${varOf(c)}`,
      onclick: () => set(key, c),
    }));
    const choice = (key, entries, value) => entries.map(([v, label, style]) => h("button", {
      class: `sl-bs-choice${v === value ? " on" : ""}`, text: label, style, onclick: () => set(key, v),
    }));
    const parts = [];
    if (kind === "link") {
      parts.push(group("Link", h("button", { class: "sl-bs-choice", text: "Open", onclick: () => openLink(sel.obj) })));
    } else if (kind === "note") {
      parts.push(group("Color", ...swatches("color", NOTE_COLORS, c => `var(--bn-${c})`, sel ? cur.color : st.noteColor)));
    } else {
      parts.push(group(SHAPES.has(kind) ? "Stroke" : "Color", ...swatches("color", INKS, inkVar, cur.color || "ink")));
    }
    if (kind === "rect" || kind === "ellipse") parts.push(group("Fill", ...swatches("fill", FILLS, fillVar, cur.fill || "none")));
    if (kind === "link") {
      // No style for links.
    } else if (SHAPES.has(kind)) {
      parts.push(group("Width", ...choice("width", Object.entries(WIDTHS).map(([k, px]) => [k, "", `--lw:${Math.max(1.5, px)}px`]), cur.width || "medium")
        .map(b => (b.classList.add("sl-bs-width"), b))));
    } else {
      parts.push(group("Font", ...choice("font", Object.entries(FONTS).map(([k, [label, fam]]) => [k, label, `font-family:${fam}`]), cur.font || "sans")));
      parts.push(group("Size", ...choice("size", Object.keys(SIZES).map(k => [k, k]), cur.size || "M")));
    }
    if (sel) {
      if (kind === "note") parts.push(group("Lifetime", h("button", { class: "sl-bs-choice", text: remaining(sel.obj).label, onclick: e => lifetimeMenu(e, sel.obj) })));
      parts.push(h("button", { class: "sl-bs-choice sl-bs-delete", title: "Delete (Del)", onclick: () => deleteBoardItem(sel.obj.id) }, icon("trash")));
    }
    boardStyleBar.replaceChildren(...parts);
  }

  function addNote(x, y, text = "") {
    const b = board();
    if (x == null) {
      const r = boardView.getBoundingClientRect(), v = b.view;
      x = (r.width / 2 - v.x) / v.z - 110 + (b.notes.length % 5) * 18;
      y = (r.height / 2 - v.y) / v.z - 80 + (b.notes.length % 5) * 18;
    }
    const now = Date.now(), life = noteLifetime(), st = boardStyle();
    const n = {
      id: uid(), x: Math.round(x), y: Math.round(y), text, color: st.noteColor || NOTE_COLORS[b.notes.length % NOTE_COLORS.length],
      font: st.font, size: st.size, created: now, lifetime: life, expires: life ? now + life : null,
    };
    b.notes.push(n);
    save();
    if (boardOpen) {
      renderBoard();
      const el = boardWorld.querySelector(`[data-note="${n.id}"]`);
      el?.classList.add("sl-enter");
      el?.querySelector("textarea").focus();
      setTimeout(() => boardWorld.querySelector(`[data-note="${n.id}"] textarea`)?.focus(), 0);
    }
    render();
    return n;
  }

  function addText(x, y, text = "") {
    const st = boardStyle();
    const it = { kind: "text", id: uid(), x: Math.round(x), y: Math.round(y), text, color: st.color, font: st.font, size: st.size };
    board().items.push(it);
    if (boardOpen) {
      renderBoard();
      select(it.id);
      // After the click that created it: the click itself moves the focus to the canvas.
      if (!text) setTimeout(() => editText(boardWorld.querySelector(`.sl-btext[data-item="${it.id}"]`), it), 0);
    }
    save();
    return it;
  }

  function editText(el, it) {
    if (!el) return;
    el.contentEditable = "true";
    el.focus();
    doc.getSelection().selectAllChildren(el);
    const done = () => {
      el.contentEditable = "false";
      it.text = el.innerText.replace(/\n$/, "");
      if (!it.text.trim()) return deleteBoardItem(it.id);
      save();
    };
    el.addEventListener("blur", done, { once: true });
  }

  /* Link blocks: a tab, pinned item or link dropped on the board. Clicking one goes to its tab (or opens it);
     the sidebar is not changed. */
  function addLink(x, y, { url, title, icon: ic, item = null }) {
    const it = { kind: "link", id: uid(), x: Math.round(x), y: Math.round(y), url, title: title || host(url), icon: ic && !ic.startsWith("data:") ? ic : null, item };
    board().items.push(it);
    save();
    if (boardOpen) { renderBoard(); select(it.id); }
    return it;
  }
  function openLink(it) {
    const t = (it.item && tabForItem(it.item))
      || gBrowser.tabs.find(x => alive(x) && inView(x) && tabUrl(x) === it.url)
      || gBrowser.tabs.find(x => alive(x) && tabUrl(x) === it.url);
    if (t) return selectTab(t);
    if (it.item && findItem(it.item)) return openItem(it.item);
    newTab(it.url);
  }
  function linkEl(it) {
    return h("div", { class: `sl-blink${it.id === selectedId ? " sl-selected" : ""}`, "data-item": it.id, title: `${it.title}\n${it.url}`, style: `left:${it.x}px;top:${it.y}px` },
      favicon(it.url, it.icon), h("span", { class: "sl-blink-title", text: it.title }));
  }

  function textEl(it) {
    const el = h("div", {
      class: `sl-btext${it.id === selectedId ? " sl-selected" : ""}`, "data-item": it.id, text: it.text,
      style: `left:${it.x}px;top:${it.y}px;color:${inkVar(it.color)};font-family:${fontOf(it.font)};font-size:${sizeOf(it.size)}px`,
    });
    el.addEventListener("dblclick", e => { e.stopPropagation(); editText(el, it); });
    el.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") el.blur();
    });
    el.addEventListener("input", () => { it.text = el.innerText; clearTimeout(it._t); it._t = setTimeout(save, 400); });
    // Pasted content is inserted as plain text.
    el.addEventListener("paste", e => {
      e.preventDefault();
      doc.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    });
    return el;
  }

  /* Shapes are drawn in one SVG layer below notes and texts; each has a wider invisible outline for hit testing. */
  function shapeGeometry(it, attrs = {}) {
    const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), hgt = Math.abs(it.y2 - it.y1);
    if (it.kind === "rect") return svgEl("rect", { x, y, width: w, height: hgt, rx: 4, ...attrs });
    if (it.kind === "ellipse") return svgEl("ellipse", { cx: x + w / 2, cy: y + hgt / 2, rx: w / 2, ry: hgt / 2, ...attrs });
    let d = `M${it.x1} ${it.y1} L${it.x2} ${it.y2}`;
    if (it.kind === "arrow") {
      const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1), len = 10 + (WIDTHS[it.width] || 3) * 2.5;
      const p = da => `${it.x2 - len * Math.cos(a + da)} ${it.y2 - len * Math.sin(a + da)}`;
      d += ` M${p(0.45)} L${it.x2} ${it.y2} L${p(-0.45)}`;
    }
    return svgEl("path", { d, ...attrs });
  }
  function renderShapes() {
    if (!boardSvg) return;
    const b = board(), z = b.view.z;
    const out = [];
    for (const it of b.items) {
      if (!SHAPES.has(it.kind)) continue;
      const w = WIDTHS[it.width] || WIDTHS.medium, filled = it.fill && it.fill !== "none";
      const g = svgEl("g", { class: `sl-shape${it.id === selectedId ? " sl-selected" : ""}`, "data-item": it.id });
      g.append(
        shapeGeometry(it, { class: "sl-shape-line", style: `stroke:${inkVar(it.color)};stroke-width:${w}px;fill:${filled ? fillVar(it.fill) : "none"}` }),
        shapeGeometry(it, { class: `sl-hit${filled ? " filled" : ""}`, style: `stroke-width:${Math.max(14, w + 10) / Math.min(1, z)}px` }));
      out.push(g);
    }
    // Selection: dashed box and handles (endpoints for lines, corners for boxes).
    const sel = b.items.find(i => i.id === selectedId && SHAPES.has(i.kind));
    if (sel) {
      const r = 5 / z;
      const handles = /line|arrow/.test(sel.kind) ? [["x1", "y1"], ["x2", "y2"]] : [["x1", "y1"], ["x2", "y1"], ["x1", "y2"], ["x2", "y2"]];
      if (!/line|arrow/.test(sel.kind)) {
        out.push(svgEl("rect", { class: "sl-sel-box", x: Math.min(sel.x1, sel.x2) - 4 / z, y: Math.min(sel.y1, sel.y2) - 4 / z,
          width: Math.abs(sel.x2 - sel.x1) + 8 / z, height: Math.abs(sel.y2 - sel.y1) + 8 / z, style: `stroke-width:${1 / z}px;stroke-dasharray:${4 / z} ${3 / z}` }));
      }
      for (const [hx, hy] of handles) {
        out.push(svgEl("circle", { class: "sl-handle", "data-handle": `${hx},${hy}`, cx: sel[hx], cy: sel[hy], r, style: `stroke-width:${1.5 / z}px` }));
      }
    }
    boardSvg.replaceChildren(...out);
  }

  function noteEl(n) {
    const r = remaining(n);
    const text = h("textarea", { spellcheck: "false", placeholder: "Write something…", style: `font-family:${fontOf(n.font)};font-size:${sizeOf(n.size)}px` });
    text.value = n.text;
    const grow = () => { text.style.height = "auto"; text.style.height = text.scrollHeight + "px"; };
    text.addEventListener("input", () => {
      n.text = text.value;
      grow();
      clearTimeout(n._t);
      n._t = setTimeout(save, 400);
    });
    text.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") text.blur();
    });
    const head = h("div", { class: "sl-note-head" },
      h("span", { class: "sl-note-alert", title: "This note has expired" }),
      h("span", { class: "sl-note-time", text: r.label, title: n.expires ? `${r.expired ? "Expired" : "Expires"} ${new Date(n.expires).toLocaleString()}` : "This note never expires" }),
      h("button", { class: "sl-note-btn sl-note-remind", title: "Remind me later", onclick: e => popup(e, SNOOZES.map(([ms, label]) => ({ label: `Remind me ${label.toLowerCase()}`, fn: () => snoozeNote(n, ms) }))) }, icon("bell")),
      h("button", { class: "sl-note-btn", title: "Lifetime and reminders", onclick: e => lifetimeMenu(e, n) }, icon("clock")),
      h("button", { class: "sl-note-btn", title: "Delete", onclick: () => deleteBoardItem(n.id) }, icon("x")));
    // Drag the note by its header.
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const b = board(), z = b.view.z, sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
      const el = head.parentNode;
      el.classList.add("dragging");
      boardBusy++;
      const move = ev => {
        n.x = Math.round(ox + (ev.clientX - sx) / z);
        n.y = Math.round(oy + (ev.clientY - sy) / z);
        el.style.left = n.x + "px";
        el.style.top = n.y + "px";
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        el.classList.remove("dragging");
        boardBusy--;
        // Bring to front.
        b.notes.splice(b.notes.indexOf(n), 1);
        b.notes.push(n);
        save();
        renderBoard();
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    });
    const state = r.expired ? " expired" : r.ms < DAY && !n.snoozed ? " expiring" : "";
    const el = h("div", {
      class: `sl-note sl-note-${NOTE_COLORS.includes(n.color) ? n.color : "yellow"}${state}${n.id === selectedId ? " sl-selected" : ""}`,
      "data-note": n.id, style: `left:${n.x}px;top:${n.y}px`,
    },
    head, text,
    h("div", { class: "sl-note-life" }, h("div", { class: "sl-note-life-bar", style: `width:${(r.ratio * 100).toFixed(2)}%` })));
    // Clicking a note selects it (style bar), without stealing the focus from its text.
    el.addEventListener("pointerdown", () => { if (selectedId !== n.id) select(n.id); });
    setTimeout(grow, 0);
    return el;
  }

  function renderBoard() {
    if (!boardOpen) return;
    const ws = curWs(), b = board(ws);
    if (!boardHist.has(ws.id)) boardCommit();
    else updateUndoButtons();
    positionBoard();
    boardWrap.titleEl.textContent = `${ws.icon}  ${ws.name}`;
    boardWrap.lifeEl.textContent = `Notes: ${(LIFETIMES.find(([ms]) => ms === noteLifetime())?.[1] || span(noteLifetime())).toLowerCase()}`;
    boardWrap.classList.toggle("blank", isBlank(gBrowser.selectedTab));
    if (selectedId && !b.notes.some(n => n.id === selectedId) && !b.items.some(i => i.id === selectedId)) selectedId = null;
    const focused = doc.activeElement?.closest?.(".sl-note")?.dataset.note;
    renderShapes();
    boardWorld.replaceChildren(boardSvg, ...b.items.filter(i => i.kind === "text").map(textEl),
      ...b.items.filter(i => i.kind === "link").map(linkEl), ...b.notes.map(noteEl));
    if (focused) boardWorld.querySelector(`[data-note="${focused}"] textarea`)?.focus();
    boardWrap.apply();
    boardWrap.classList.toggle("empty", !b.notes.length && !b.items.length);
    drawStyleBar();
  }

  /* Sidebar renders refresh the board, except while something on it is being edited or dragged. */
  function refreshBoard() {
    const a = doc.activeElement;
    if (boardBusy || (a && boardWorld.contains(a) && (a.localName === "textarea" || a.isContentEditable))) {
      positionBoard();
      tickBoard();
      return;
    }
    renderBoard();
  }

  /* The board covers the page area exactly. */
  function positionBoard() {
    const box = $("#tabbrowser-tabbox").getBoundingClientRect();
    for (const [k, v] of Object.entries({ x: box.left, y: box.top, w: box.width, h: box.height })) boardWrap.style.setProperty(`--bd-${k}`, v + "px");
  }

  /* Refreshes countdowns and alerts without rebuilding (keeps typing undisturbed). */
  function tickBoard() {
    for (const n of board().notes) {
      const el = boardWorld.querySelector(`[data-note="${n.id}"]`);
      if (!el) continue;
      const r = remaining(n);
      el.querySelector(".sl-note-time").textContent = r.label;
      el.querySelector(".sl-note-life-bar").style.width = `${(r.ratio * 100).toFixed(2)}%`;
      el.classList.toggle("expiring", !r.expired && r.ms < DAY && !n.snoozed);
      el.classList.toggle("expired", r.expired);
    }
  }

  function openBoard() {
    if (little) return;
    endPeek();
    closePalette();
    boardOpen = true;
    clearTimeout(boardHideTimer);
    boardWrap.classList.remove("sl-closing");
    boardWrap.hidden = false;
    setTool("select");
    renderBoard();
    boardView.focus({ preventScroll: true });
    touchMru(boardKey());
    clearInterval(boardTimer);
    boardTimer = setInterval(tickBoard, 30e3);
    render();
  }

  function closeBoard() {
    if (!boardOpen) return;
    // No empty pages: on a blank tab, closing the board goes back to the last real tab instead.
    if (isBlank(gBrowser.selectedTab)) {
      const back = mru.find(t => alive(t) && !isBlank(t) && inView(t));
      if (back) selectTab(back);
      else boardWrap.classList.add("sl-nudge"), setTimeout(() => boardWrap.classList.remove("sl-nudge"), 400);
      return;
    }
    boardOpen = false;
    selectedId = null;
    // Fades out, then hides (unless it was reopened meanwhile).
    boardWrap.classList.add("sl-closing");
    clearTimeout(boardHideTimer);
    boardHideTimer = setTimeout(() => { if (!boardOpen) boardWrap.hidden = true; boardWrap.classList.remove("sl-closing"); }, 140);
    clearInterval(boardTimer);
    gBrowser.selectedBrowser.focus();
    touchMru(gBrowser.selectedTab);
    render();
  }

  function toggleBoard() { boardOpen ? closeBoard() : openBoard(); }

  /* ---------- keyboard shortcuts ---------- */

  const SHORTCUTS = [
    { mod: "accel", key: "S", fn: toggleSidebar, reserved: true },
    { mod: "accel", key: "B", fn: toggleSidebar, reserved: true },
    { mod: "accel", key: "T", fn: () => openPalette("new"), reserved: true },
    { mod: "accel", key: "L", fn: () => openPalette("current"), reserved: true },
    { mod: "accel", key: "D", fn: () => togglePin(gBrowser.selectedTab) },
    { mod: "accel,shift", key: "D", fn: () => toggleFavorite(gBrowser.selectedTab) },
    // Keeps the Glance card as a tab; without a card, Firefox's Open File as before.
    { mod: "accel", key: "O", fn: () => (glance ? closeGlance({ keep: true }) : $("#Browser\\:OpenFile")?.doCommand()) },
  ];
  // Handled by a direct listener (see installShortcuts), but their native equivalents must be disabled.
  const STOLEN = [
    { mod: "accel,shift", key: "C" },
    // Previous / next workspace: Ctrl+arrows, or ⌘⌥+arrows on macOS (as Arc does), since Ctrl+arrows
    // switches desktops there.
    { mod: IS_MAC ? "accel,alt" : "control", keycode: "VK_LEFT" },
    { mod: IS_MAC ? "accel,alt" : "control", keycode: "VK_RIGHT" },
  ];

  /* True when the user is typing: a chrome text field, or an editable element focused in the page
     (the content process enables IME only then). Shortcuts that clash with text editing skip it. */
  function chromeField(t) {
    return t?.localName === "input" || t?.localName === "textarea" || !!t?.isContentEditable || !!t?.closest?.("#urlbar");
  }
  function typingInField(e) {
    if (chromeField(e.target)) return true;
    try { return window.windowUtils.IMEStatus !== Ci.nsIDOMWindowUtils.IME_STATUS_DISABLED; } catch { return false; }
  }

  /* Many pages focus a text field on their own as they load (search engines, chat apps). Such a field
     only keeps Ctrl+arrows for itself once the user has clicked or typed in the page: until then the
     shortcut switches workspaces. Reset when another tab is selected or a new page is loaded. */
  let pageEngaged = false;
  const resetEngaged = () => { pageEngaged = false; };

  function normMods(m) { return (m || "").split(/[,\s]+/).filter(Boolean).map(x => (x === "control" && !IS_MAC ? "accel" : x)).sort().join(","); }

  function disableNativeKeys() {
    for (const k of doc.querySelectorAll("key")) {
      if (k.closest("#sillage-keyset")) continue;
      const kk = (k.getAttribute("key") || "").toUpperCase(), kc = k.getAttribute("keycode") || "";
      const m = normMods(k.getAttribute("modifiers"));
      if ([...SHORTCUTS, ...STOLEN].some(s => normMods(s.mod) === m && ((s.key && s.key === kk) || (s.keycode && s.keycode === kc)))) {
        k.setAttribute("disabled", "true");
        k.removeAttribute("command");
        k.removeAttribute("oncommand");
      }
    }
  }

  function installShortcuts() {
    disableNativeKeys();
    // Developer tools shortcuts may be registered later.
    setTimeout(disableNativeKeys, 3000);
    const keyset = doc.createXULElement("keyset");
    keyset.id = "sillage-keyset";
    for (const s of SHORTCUTS) {
      const k = doc.createXULElement("key");
      k.setAttribute("modifiers", s.mod);
      if (s.key) k.setAttribute("key", s.key);
      if (s.keycode) k.setAttribute("keycode", s.keycode);
      if (s.reserved) k.setAttribute("reserved", "true");
      // A <key> needs a command to be active: empty oncommand plus an event listener.
      k.setAttribute("oncommand", "void 0;");
      k.addEventListener("command", () => { try { s.fn(); } catch (err) { log("key " + err); } });
      keyset.append(k);
    }

    // Direct listener: more reliable for arrows and digits (physical key codes, any keyboard layout).
    window.addEventListener("keydown", e => {
      // Handled here, before the page sees the key: pages consume Ctrl+arrows (word navigation)
      // even when nothing is editable, so a regular <key> shortcut would never fire.
      const wsMods = IS_MAC ? e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey
                            : e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
      if (wsMods && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !cycling) {
        if (chromeField(e.target) || (pageEngaged && typingInField(e))) return;
        e.preventDefault();
        e.stopPropagation();
        return stepWs(e.key === "ArrowLeft" ? -1 : 1);
      }
      if (e.target === gBrowser.selectedBrowser && !["Control", "Shift", "Alt", "Meta"].includes(e.key)) pageEngaged = true;
      const editable = e.target !== gBrowser.selectedBrowser && chromeField(e.target);
      // Ctrl+1…9: workspace n (Ctrl on macOS too, like Arc).
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        const m = /^Digit([1-9])$/.exec(e.code);
        if (m) {
          e.preventDefault();
          e.stopPropagation();
          const w = D.workspaces[+m[1] - 1];
          if (w) switchWs(w.id);
          return;
        }
      }
      if (cycling && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return endCycle({ cancel: true });
      }
      if (!accel(e) || !e.shiftKey || e.altKey || (IS_MAC ? e.ctrlKey : e.metaKey)) {
        // Missed key release (focus elsewhere): the next key press ends the cycle.
        if (cycling && !["Control", "Meta", "Shift"].includes(e.key)) endCycle();
        return;
      }
      if (e.code === "KeyC" || e.key === "C" || e.key === "c") {
        e.preventDefault();
        e.stopPropagation();
        return copyUrl();
      }
      const arrows = { ArrowRight: () => cycleStep(1), ArrowLeft: () => cycleStep(-1), ArrowUp: () => stepSidebar(-1), ArrowDown: () => stepSidebar(1) };
      if (!arrows[e.key] || (editable && !cycling)) return;
      e.preventDefault();
      e.stopPropagation();
      arrows[e.key]();
    }, true);
    window.addEventListener("mousedown", e => { if (e.target === gBrowser.selectedBrowser) pageEngaged = true; }, true);
    gBrowser.tabContainer.addEventListener("TabSelect", resetEngaged);
    // Releasing Ctrl (⌘) or Shift confirms the choice, like Alt+Tab.
    window.addEventListener("keyup", e => {
      if (cycling && ["Control", "Meta", "Shift"].includes(e.key)) endCycle();
    }, true);

    const main = $("#mainKeyset");
    main.parentNode.insertBefore(keyset, main);
    // Re-inserting the main keyset makes Firefox rebuild its key handlers.
    main.parentNode.insertBefore(main, main.nextSibling);
  }

  /* ---------- updates (macOS: the bundled Firefox does not self-update) ---------- */

  async function checkFirefoxUpdate() {
    if (!IS_MAC || shared.updateChecked) return;
    shared.updateChecked = true;
    const last = D.settings.lastUpdateCheck || 0;
    if (Date.now() - last < 86400e3) return;
    try {
      const j = await (await fetch("https://product-details.mozilla.org/1.0/firefox_versions.json")).json();
      D.settings.lastUpdateCheck = Date.now();
      save();
      const latest = j.LATEST_FIREFOX_VERSION;
      if (latest && Services.vc.compare(latest, Services.appinfo.version) > 0) {
        toast(`Firefox ${latest} is available: run “make update” in the Sillage directory`, 12000);
      }
    } catch (e) { log("update check " + e); }
  }

  /* ---------- Firefox Sync: data arrived from another device ---------- */

  const syncObserver = {
    observe(subject, topic, data) {
      if (little) return render();
      let info = {};
      try { info = JSON.parse(data); } catch {}
      // Tabs of workspaces deleted on another device move to the current one.
      const removed = new Set(info.removedWorkspaces || []);
      if (removed.has(activeWs) || !wsById(activeWs)) activeWs = D.workspaces[0].id;
      for (const t of gBrowser.tabs) {
        if (alive(t) && removed.has(getVal(t, WS_KEY))) setVal(t, WS_KEY, activeWs);
      }
      // Profiles may have been created or removed: make sure tabs sit in the right container.
      for (const t of [...gBrowser.tabs]) {
        const want = tabProfile(t)?.userContextId;
        if (alive(t) && want != null && (t.userContextId || 0) !== want && !t.hasAttribute("pending")) rehome(t, want);
      }
      boardRebase();
      applyVisibility();
      render();
    },
  };

  /* ---------- startup ---------- */

  const containerCheck = new WeakSet();
  let started = false; // session restored and interface ready

  async function init() {
    D = await loadData();
    shared.windows.add(window);
    Services.obs.addObserver(syncObserver, "sillage-sync-applied");
    window.addEventListener("unload", () => {
      shared.windows.delete(window);
      Services.obs.removeObserver(syncObserver, "sillage-sync-applied");
    });
    SillageSync.init(shared).then(() => save()).catch(e => log("sync init " + e));
    activeWs = wsById(D.lastWs) ? D.lastWs : D.workspaces[0].id;
    fixContainerColors();
    sidebarVisible = D.settings.sidebarVisible;

    buildUi();
    installShortcuts();
    hookExternalLinks();
    buildGlance();
    hookGlance();
    if (shared.littleWindows.has(window)) enterLittle();
    window.addEventListener("resize", () => { if (boardOpen) renderBoard(); positionGlance(); });
    // The page area also changes size while the sidebar slides in or out.
    new ResizeObserver(() => { if (boardOpen) positionBoard(); positionGlance(); }).observe($("#tabbrowser-tabbox"));

    const tc = gBrowser.tabContainer;
    tc.addEventListener("TabOpen", e => {
      const t = e.target;
      if (little) return render();
      if (!getVal(t, WS_KEY) && !tabItemId(t)) setVal(t, WS_KEY, activeWs);
      containerCheck.add(t);
      if (started) freshTabs.add(t);
      render();
    });
    tc.addEventListener("TabSelect", () => {
      const t = gBrowser.selectedTab;
      if (little) return render();
      // Another tab chosen while a card is shown: the card goes away. Deferred: Firefox also moves the
      // selection away from a tab it is about to close, and then the card is already being torn down.
      if (glance && t !== glance.tab) {
        const g = glance;
        setTimeout(() => { if (glance === g) closeGlance({ select: false }); }, 0);
      }
      adoptEmptyTab(t);
      if (isBlank(t)) openBoard();
      else if (boardOpen && !switching) closeBoard();
      if (!switching && !inView(t)) {
        const w = tabWs(t);
        if (wsById(w)) switchWs(w, { tab: t });
        else if (w.startsWith("*")) selectTab(t);
      }
      touchMru(t);
      scheduleThumb(t);
      render();
    });
    tc.addEventListener("TabClose", e => {
      const t = e.target;
      // Little windows close with their last tab.
      if (little) { if (!gBrowser.tabs.some(x => x !== t && alive(x))) setTimeout(() => window.close(), 0); return; }
      // The card closed itself (window.close(), Ctrl+W): back to the page. Its page closed: the card stays as a tab.
      if (glance && (t === glance.tab || t === glance.parent)) closeGlance({ closing: true });
      if (!t.selected) return;
      // Last page of the workspace closed: land on the board (favorites stay where they are).
      const own = gBrowser.tabs.some(x => x !== t && alive(x) && tabWs(x) === activeWs && !isBlank(x));
      // (Last tab of the window: Firefox opens its own new tab, adopted as the placeholder.)
      const lastInWindow = !gBrowser.tabs.some(x => x !== t && alive(x));
      if (!own && !isBlank(t) && !lastInWindow) gBrowser.setSuccessor(t, placeholder(activeWs));
    });
    for (const ev of ["TabClose", "TabMove", "TabShow", "TabHide", "TabPinned", "TabUnpinned"]) tc.addEventListener(ev, render);
    tc.addEventListener("TabAttrModified", onTabAttr);
    tc.addEventListener("SSTabRestoring", () => { if (!little) applyVisibility(); render(); });
    gBrowser.addTabsProgressListener({
      onLocationChange(browser, webProgress, request, location, flags) {
        if (!webProgress.isTopLevel) return;
        const t = gBrowser.getTabForBrowser(browser);
        if (t?.selected && !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) resetEngaged();
        if (t) {
          const url = location?.spec || "";
          recordVisit(t, url);
          if (!EMPTY_URLS.has(url) && getVal(t, BLANK_KEY)) setVal(t, BLANK_KEY, "");
          else if (EMPTY_URLS.has(url) && adoptEmptyTab(t) && t.selected) openBoard();
          // A blank tab got a page (palette, link…): leave the board.
          if (boardOpen && t.selected && !isBlank(t) && url !== "about:blank") closeBoard();
          // Link opened from outside in the wrong container: reopen it in the workspace's container.
          if (containerCheck.has(t) && /^https?:/.test(url)) {
            containerCheck.delete(t);
            const want = tabProfile(t)?.userContextId ?? 0;
            if ((t.userContextId || 0) !== want) setTimeout(() => alive(t) && rehome(t, want), 0);
          }
        }
        if (!t || t.selected) render();
        else if (inView(t)) renderLater();
      },
    });

    await SessionStore.promiseAllWindowsRestored;
    // A Little Sillage window restored from the previous session.
    if (!little && SessionStore.getCustomWindowValue(window, "sillage-little")) enterLittle();
    if (little) { log("Little Sillage window ready"); return; }
    // Notes expire while Sillage runs: the alerts in the sidebar follow.
    setInterval(render, 60e3);
    for (const t of gBrowser.tabs) if (alive(t) && !tabWs(t)) setVal(t, WS_KEY, activeWs);
    // Split views (a card left open at the last quit) become regular tabs again.
    for (const sv of [...(gBrowser.splitViews || [])]) try { sv.unsplitTabs(); } catch (e) { log("unsplit " + e); }
    // Firefox's native pinned tabs cannot be hidden, so unpin them.
    for (const t of [...gBrowser.tabs]) if (t.pinned) gBrowser.unpinTab(t);
    if (!shared.absorbChecked) {
      shared.absorbChecked = true;
      const n = await absorbSeparateProfiles().catch(e => (log("merge profiles " + e), 0));
      if (n) toast("Profiles are back in this window, each in its own container", 5000);
    }
    const sel = gBrowser.selectedTab;
    if (!inView(sel)) {
      const w = tabWs(sel);
      if (wsById(w)) activeWs = w;
      else if (w.startsWith("*")) activeWs = D.workspaces.find(x => x.profile === w.slice(1))?.id || activeWs;
    }
    applyVisibility();
    mru = gBrowser.tabs.filter(alive).sort((a, b) => b.lastAccessed - a.lastAccessed);
    archive();
    setInterval(archive, 3600e3);
    // An empty start page (no history) becomes the placeholder: show the board instead.
    adoptEmptyTab(gBrowser.selectedTab, { startup: true });
    renderNow();
    started = true;
    if (isBlank(gBrowser.selectedTab)) openBoard();
    checkFirefoxUpdate();
    log("Sillage ready");
    const dbg = PathUtils.join(PathUtils.profileDir, "chrome", "debug.js");
    if (await IOUtils.exists(dbg)) Services.scriptloader.loadSubScript("chrome://sillage/content/debug.js", window);
  }

  window.Sillage = {
    render, switchWs, openPalette, toast, adoptIntoWorkspace,
    get isLittle() { return little; },
    get activeWorkspace() { return curWs(); },
    // Internals exposed for the automated tests (chrome/debug.js in the test profile).
    _t: {
      get D() { return D; }, get activeWs() { return activeWs; }, get palResults() { return palResults; },
      get mru() { return mru; }, get cycling() { return cycling; }, hist: () => shared.hist,
      renderNow, newTab, openItem, moveTab, moveItem, moveFolder, togglePin, toggleFavorite, deleteItem, createFolder,
      openGlance, closeGlance, glance: () => glance, get renderCount() { return renderCount; },
      saveWs, deleteWs, selectTab, switchWs, closePalette, query, choose, todayTabs, tabWs, tabItemId, tabForItem,
      archive, clearToday, runCommand, fixup, applyVisibility, cycleStep, endCycle, stepSidebar, createProfile, fixContainerColors, backToStart, tabId,
      deleteProfile, inView, profOf, copyUrl, get palSel() { return palSel; }, stepWs,
      favicon, plainIcon, cachedIcon,
      get sidebarVisible() { return sidebarVisible; },
      openBoard, closeBoard, boardUndo, boardCopy, boardPaste, boardDuplicate, readClipboard, addNote, addText, addLink, openLink, board, renewNote, snoozeNote, setTool, deleteBoardItem, select, expiredCount,
      get boardOpen() { return boardOpen; }, get selectedId() { return selectedId; },
      openLittle, moveToMain, enterLittle, defaultLittleProfile, sync: SillageSync, isBlank, moveWorkspace, absorbSeparateProfiles, dynamicCommands,
    },
  };
  doc.defaultView.windowUtils.loadSheetUsingURIString("chrome://sillage/content/sillage.css", doc.defaultView.windowUtils.AUTHOR_SHEET);
  init().catch(e => log("init " + e + "\n" + e.stack));
})();

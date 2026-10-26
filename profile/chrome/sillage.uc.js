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
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    sound: '<path d="M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6"/>',
    mute: '<path d="M4 10v4h4l5 4V6L8 10zM16 10l4 4M20 10l-4 4"/>',
    back: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
    cmd: '<path d="M5 7l5 5-5 5M12 17h7"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 3 2.5 14 0 17M12 3.5c-2.5 3-2.5 14 0 17"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    board: '<path d="M5 4h10l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 16h5"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>',
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

  /* Pinned tree: { type: "item", id, url, title, customTitle } | { type: "folder", id, name, open, children: [item] }
     Favorites (the top grid) belong to a profile; pinned items belong to a workspace. */
  function* walkItems() {
    for (const p of D.profiles) for (const it of p.favorites) yield { item: it, list: p.favorites, ws: null, profile: p, folder: null };
    for (const w of D.workspaces) {
      for (const n of w.pinned) {
        if (n.type === "folder") for (const it of n.children) yield { item: it, list: n.children, ws: w, profile: profById(w.profile), folder: n };
        else yield { item: n, list: w.pinned, ws: w, profile: profById(w.profile), folder: null };
      }
    }
  }
  function findItem(id) { for (const r of walkItems()) if (r.item.id === id) return r; return null; }
  function findFolder(id) {
    for (const w of D.workspaces) {
      const i = w.pinned.findIndex(n => n.id === id);
      if (i >= 0) return { w, i, f: w.pinned[i] };
    }
    return null;
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
    return gBrowser.tabs.filter(t => alive(t) && !tabItemId(t) && tabWs(t) === wsId);
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
    const from = activeWs;
    const cur = gBrowser.selectedTab;
    if (from && inView(cur, from)) lastSelected.set(from, cur);
    activeWs = id;
    D.lastWs = id;
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

  function touchMru(t) {
    if (cycling || !alive(t)) return;
    mru = [t, ...mru.filter(x => x !== t && alive(x))].slice(0, 100);
    updateSuccessor();
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
      cycleList = mru.filter(t => alive(t) && !isBlank(t) && inView(t));
      if (cycleList[0] !== gBrowser.selectedTab) cycleList.unshift(gBrowser.selectedTab);
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
    if (!cancel && cycleIdx > 0 && alive(t)) selectTab(t);
    else touchMru(gBrowser.selectedTab);
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
    for (const n of ws.pinned) {
      if (n.type === "folder") { if (n.open) for (const it of n.children) out.push({ item: it }); }
      else out.push({ item: n });
    }
    for (const t of todayTabs(ws.id)) if (!isBlank(t)) out.push({ tab: t });
    return out;
  }

  function stepSidebar(dir) {
    const list = sidebarEntries();
    if (!list.length) return;
    const sel = gBrowser.selectedTab, selItem = tabItemId(sel);
    let i = list.findIndex(e => (e.tab ? e.tab === sel : e.item.id === selItem));
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    const e = list[i];
    if (e.tab) selectTab(e.tab);
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
    return dest.folderId ? w.pinned.find(n => n.id === dest.folderId)?.children : w.pinned;
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

  function moveFolder(id, index) {
    const r = findFolder(id);
    if (!r) return;
    r.w.pinned.splice(r.i, 1);
    r.w.pinned.splice(Math.min(r.i < index ? index - 1 : index, r.w.pinned.length), 0, r.f);
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

  function createFolder(wsId = activeWs, name = "New folder") {
    const f = { type: "folder", id: uid(), name, open: true, children: [] };
    wsById(wsId).pinned.push(f);
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

  const CONTAINER_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];

  function createProfile(name) {
    const ci = ContextualIdentityService.create(name, "fingerprint", CONTAINER_COLORS[D.profiles.length % CONTAINER_COLORS.length]);
    const p = { id: uid(), name, userContextId: ci.userContextId, favorites: [] };
    D.profiles.push(p);
    save();
    return p;
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

    peekZone = h("div", { id: "sl-peek" });
    toastEl = h("div", { id: "sl-toast" });
    switcher = h("div", { id: "sl-switcher", hidden: true });
    doc.body.append(peekZone, toastEl, switcher);

    wireSidebar();
    wireResize(resizer);
    wirePeek();
    wireExtensionPins();
    buildPalette();
    buildWsEditor();
    buildBoard();
  }

  function favicon(url, iconUrl, busy = false) {
    if (busy) return h("span", { class: "sl-fav sl-spin" });
    const hs = host(url);
    const letter = () => h("span", { class: "sl-fav sl-letter", style: `--lh:${hueOf(hs)}`, text: (hs[0] || "?").toUpperCase() });
    const src = iconUrl || (/^https?:/.test(url) ? `page-icon:${url}` : null);
    if (!src) return /^https?:/.test(url) ? letter() : icon("globe", "sl-fav");
    const img = h("img", { class: "sl-fav", src });
    img.addEventListener("error", () => img.replaceWith(letter()), { once: true });
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
    if (little) return renderLittle();
    // Safety net: the sidebar and the window must never be scrolled.
    for (const el of [side, $("#browser"), doc.documentElement, doc.body]) if (el && el.scrollTop) el.scrollTop = 0;
    tabsById.clear();
    const ws = curWs(), prof = curProf();
    setHue(ws.hue);
    doc.documentElement.style.setProperty("--sl-w", D.settings.sidebarWidth + "px");
    doc.documentElement.classList.toggle("sl-hidden", !sidebarVisible);
    applyExtensionPins();

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

    pinBox.replaceChildren(...ws.pinned.map((n, i) => {
      if (n.type !== "folder") return rowForItem(n, "pinned", i, null);
      return h("div", { class: "sl-folder" },
        h("div", { class: `sl-row sl-folder-head${n.open ? " open" : ""}`, draggable: "true", "data-folder-id": n.id, "data-index": i },
          icon("chev", "sl-chev"), icon("folder"), h("span", { class: "sl-title", text: n.name })),
        n.open && h("div", { class: `sl-folder-body${openedFolders.delete(n.id) ? " sl-enter" : ""}` }, n.children.map((it, k) => rowForItem(it, "pinned", k, n.id))));
    }));

    todayBox.replaceChildren(...todayTabs(ws.id).filter(t => !isBlank(t)).map((t, i) => rowForTab(t, "today", i)));

    const notes = ws.board?.notes?.filter(n => n.expires > Date.now()).length || 0;
    orb.classList.toggle("active", boardOpen);
    orb.querySelector(".sl-orb-count").textContent = notes || "";
    if (boardOpen) renderBoard();

    wsBar.replaceChildren(...D.workspaces.map((w, i) => h("button", {
      class: `sl-ws-dot${w.id === ws.id ? " active" : ""}`, "data-ws": w.id, "data-index": i, draggable: "true",
      title: `${w.name}${showProfile ? " · " + profById(w.profile).name : ""} (Ctrl+${i + 1})`, text: w.icon,
    })));

    // Remember pinned items' favicons and titles for display when unloaded.
    for (const { item } of walkItems()) {
      const t = tabForItem(item.id);
      if (!t) continue;
      const ic = tabIcon(t);
      if (ic && !ic.startsWith("data:") && ic !== item.icon) { item.icon = ic; save(); }
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

    side.addEventListener("dblclick", e => {
      const row = rowTarget(e);
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

    // Horizontal swipe (touchpad) switches workspaces.
    // One step per gesture: after a step, wheel events are ignored until they stop for a moment
    // (macOS trackpads keep sending momentum events long after the fingers lift).
    let acc = 0, spent = false, lastWheel = 0;
    side.addEventListener("wheel", e => {
      const now = Date.now();
      if (now - lastWheel > 250) { acc = 0; spent = false; }
      lastWheel = now;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || e.target.closest("#navigator-toolbox")) return;
      e.preventDefault();
      if (spent) return;
      acc += e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      if (Math.abs(acc) < 120) return;
      spent = true;
      stepWs(Math.sign(acc));
    }, { passive: false });

    wireDnd();
  }

  /* ---------- renaming ---------- */

  function startRename(row, kind, id) {
    const span = row.querySelector(".sl-title");
    if (!span) return;
    const input = h("input", { class: "sl-rename", value: span.textContent });
    span.replaceWith(input);
    editing = true;
    input.focus();
    input.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      editing = false;
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
    input.addEventListener("click", e => e.stopPropagation());
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
      if (!isFolder && y > .25 && y < .75) return { el: fh, mark: "sl-drop-into", dest: { list: "pinned", folderId: fh.dataset.folderId } };
      const before = y < .5;
      return { el: fh, mark: before ? "sl-drop-before" : "sl-drop-after", dest: { list: "pinned", index: +fh.dataset.index + (before ? 0 : 1) } };
    }

    const row = rowTarget(e);
    if (row) {
      const list = row.dataset.list;
      if (isFolder && (list !== "pinned" || row.dataset.folder)) return null;
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
      else if (dr.kind === "folder") moveFolder(dr.id, dest.index ?? Infinity);
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
      { label: "Open all tabs", fn: () => r.f.children.forEach(it => openItem(it.id, { background: true })) },
      "-",
      { label: "Delete folder (keep items)", fn: () => { r.w.pinned.splice(r.i, 1, ...r.f.children); save(); render(); } },
      { label: "Delete folder and its items", fn: () => { [...r.f.children].forEach(it => deleteItem(it.id)); r.w.pinned.splice(r.w.pinned.indexOf(r.f), 1); save(); render(); } },
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

  /* ---------- extensions per profile ----------
     Extensions are shared by all profiles (one Firefox profile), but each profile chooses which pinned
     extension icons it shows; hidden ones stay available in the extensions menu. */

  const pinnedExtensions = () => [...doc.querySelectorAll("#nav-bar-customization-target > [id$='-browser-action']")];
  function extensionName(el) {
    return el.querySelector(".unified-extensions-item-name")?.textContent?.trim()
      || el.querySelector("toolbarbutton")?.getAttribute("label") || el.getAttribute("label") || el.id.replace(/-browser-action$/, "");
  }
  function applyExtensionPins() {
    const hidden = new Set(curProf()?.hiddenExtensions || []);
    for (const el of pinnedExtensions()) el.toggleAttribute("sl-profile-hidden", hidden.has(el.id));
  }
  function setExtensionHidden(id, hide) {
    const p = curProf();
    const list = (p.hiddenExtensions ||= []).filter(x => x !== id);
    if (hide) list.push(id);
    p.hiddenExtensions = list;
    applyExtensionPins();
    save();
    const el = doc.getElementById(id);
    toast(hide ? `${el ? extensionName(el) : "Extension"} hidden in the ${p.name} profile — show it again from the palette`
               : `${el ? extensionName(el) : "Extension"} shown in the ${p.name} profile`, hide ? 3500 : 1800);
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
      if (el) item.setAttribute("label", `Hide in the ${curProf().name} profile`);
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
    const prof = curProf();
    for (const el of pinnedExtensions()) {
      const hidden = (prof.hiddenExtensions || []).includes(el.id);
      out.push({ cmd: `ext-${hidden ? "show" : "hide"}:${el.id}`, kw: "extension toolbar pin profile",
        title: `${hidden ? "Show" : "Hide"} extension ${extensionName(el)} in the ${prof.name} profile` });
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
    if (!q) {
      gBrowser.tabs.filter(t => alive(t) && !t.selected && tabUrl(t) !== "about:blank")
        .sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, 8)
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
      .sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, 5);
    for (const t of tabs) {
      seen.add(tabUrl(t));
      res.push({ kind: "tab", tab: t, title: t.label, sub: tabUrl(t), icon: tabIcon(t), badge: (tabItemId(t) ? "Pinned" : "Tab") + wsLabel(tabWs(t)) });
    }
    for (const { item, ws, profile } of walkItems()) {
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
    const collect = (n, out) => (n.type === "url" ? out.push(n) : (n.children || []).forEach(c => collect(c, out)));
    for (const root of [roots.bookmark_bar, roots.other, roots.synced]) {
      if (!root?.children?.length) continue;
      const loose = [];
      for (const c of root.children) {
        if (c.type === "url") { loose.push(c); continue; }
        const urls = [];
        collect(c, urls);
        if (urls.length) w.pinned.push({ type: "folder", id: uid(), name: c.name, open: false, children: urls.map(mk) });
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

  function openLittle(url) {
    const w = window.openDialog(AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,all,dialog=no,width=1000,height=720", url);
    shared.littleWindows.add(w);
    return w;
  }

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
  }

  function renderLittle() {
    if (!littleBar) return;
    const t = gBrowser.selectedTab;
    const main = mainWindow();
    const target = main?.Sillage?.activeWorkspace;
    littleBar.replaceChildren(...[
      favicon(tabUrl(t), tabIcon(t), t.hasAttribute("busy")),
      h("span", { class: "sl-little-host", text: host(tabUrl(t)), title: tabUrl(t) }),
      h("span", { class: "sl-little-spacer" }),
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

  /* ---------- Board: an infinite canvas of sticky notes, one per workspace ----------
     Notes live for 7 days (countdown and shrinking bar), then disappear unless renewed. */

  const NOTE_LIFETIME = 7 * 86400e3;
  const NOTE_COLORS = ["yellow", "pink", "blue", "green", "purple"];
  let boardOpen = false, boardWrap, boardView, boardWorld, boardTimer, boardHideTimer;

  function board(ws = curWs()) {
    ws.board ||= { notes: [], view: { x: 0, y: 0, z: 1 } };
    return ws.board;
  }

  /* Removes expired notes everywhere; returns true if something changed. */
  function purgeNotes() {
    const now = Date.now();
    let changed = false;
    for (const w of D.workspaces) {
      const b = w.board;
      if (!b) continue;
      const kept = b.notes.filter(n => n.expires > now);
      if (kept.length !== b.notes.length) { b.notes = kept; changed = true; }
    }
    if (changed) save();
    return changed;
  }

  function remaining(n) {
    const ms = Math.max(0, n.expires - Date.now());
    const d = Math.floor(ms / 86400e3), hh = Math.floor(ms % 86400e3 / 3600e3), mm = Math.floor(ms % 3600e3 / 60e3);
    return { ms, label: d ? `${d}d ${hh}h left` : hh ? `${hh}h ${mm}m left` : `${mm}m left`, ratio: ms / NOTE_LIFETIME };
  }

  function buildBoard() {
    boardWorld = h("div", { id: "sl-board-world" });
    boardView = h("div", { id: "sl-board-view" }, boardWorld);
    const title = h("span", { class: "sl-board-title" });
    const zoom = h("span", { class: "sl-board-zoom" });
    boardWrap = h("div", { id: "sl-board-wrap", hidden: true },
      h("div", { id: "sl-board-bar" },
        h("span", { class: "sl-orb-mini" }, h("img", { src: "chrome://sillage/content/logo-mark.svg", alt: "" })),
        title,
        h("span", { class: "sl-board-hint", text: "Double-click to add a note · drag to pan · Ctrl+scroll to zoom" }),
        zoom,
        h("button", { class: "sl-board-btn", onclick: () => addNote() }, icon("plus"), "Note"),
        h("button", { class: "sl-board-btn", title: "Close (Esc)", onclick: closeBoard }, icon("x"))),
      boardView);
    boardWrap.titleEl = title;
    boardWrap.zoomEl = zoom;
    doc.body.append(boardWrap);

    const view = () => board().view;
    const apply = () => {
      const v = view();
      boardWorld.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
      boardView.style.backgroundPosition = `${v.x}px ${v.y}px`;
      boardView.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
      zoom.textContent = `${Math.round(v.z * 100)}%`;
    };
    boardWrap.apply = apply;
    const toWorld = (cx, cy) => {
      const r = boardView.getBoundingClientRect(), v = view();
      return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
    };

    // Pan by dragging the background.
    boardView.addEventListener("pointerdown", e => {
      if (e.target !== boardView && e.target !== boardWorld) return;
      e.preventDefault();
      boardView.setPointerCapture(e.pointerId);
      const v = view(), start = { x: e.clientX - v.x, y: e.clientY - v.y };
      boardView.classList.add("panning");
      const move = ev => { v.x = ev.clientX - start.x; v.y = ev.clientY - start.y; apply(); };
      const up = () => {
        boardView.removeEventListener("pointermove", move);
        boardView.removeEventListener("pointerup", up);
        boardView.classList.remove("panning");
        save();
      };
      boardView.addEventListener("pointermove", move);
      boardView.addEventListener("pointerup", up);
    });
    // Scroll pans, Ctrl+scroll zooms around the cursor.
    boardView.addEventListener("wheel", e => {
      if (e.target.closest(".sl-note textarea") && !e.ctrlKey) return;
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
    boardView.addEventListener("dblclick", e => {
      if (e.target !== boardView && e.target !== boardWorld) return;
      const p = toWorld(e.clientX, e.clientY);
      addNote(p.x - 110, p.y - 20);
    });
    boardWrap.addEventListener("keydown", e => {
      if (e.key === "Escape" && !e.target.closest("textarea")) { e.stopPropagation(); closeBoard(); }
    });
  }

  function addNote(x, y, text = "") {
    const b = board();
    if (x == null) {
      const r = boardView.getBoundingClientRect(), v = b.view;
      x = (r.width / 2 - v.x) / v.z - 110 + (b.notes.length % 5) * 18;
      y = (r.height / 2 - v.y) / v.z - 80 + (b.notes.length % 5) * 18;
    }
    const now = Date.now();
    const n = { id: uid(), x: Math.round(x), y: Math.round(y), text, color: NOTE_COLORS[b.notes.length % NOTE_COLORS.length], created: now, expires: now + NOTE_LIFETIME };
    b.notes.push(n);
    save();
    if (boardOpen) {
      renderBoard();
      const el = boardWorld.querySelector(`[data-note="${n.id}"]`);
      el?.classList.add("sl-enter");
      el?.querySelector("textarea").focus();
    }
    return n;
  }

  function noteEl(n) {
    const b = board();
    const r = remaining(n);
    const text = h("textarea", { spellcheck: "false", placeholder: "Write something…" });
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
      h("button", { class: "sl-note-color", title: "Change color", onclick: () => {
        n.color = NOTE_COLORS[(NOTE_COLORS.indexOf(n.color) + 1) % NOTE_COLORS.length];
        save();
        renderBoard();
      } }),
      h("span", { class: "sl-note-time", text: r.label, title: `Expires ${new Date(n.expires).toLocaleString()}` }),
      h("button", { class: "sl-note-btn", title: "Keep for 7 more days", onclick: () => { n.expires = Date.now() + NOTE_LIFETIME; save(); renderBoard(); } }, icon("clock")),
      h("button", { class: "sl-note-btn", title: "Delete", onclick: () => { b.notes.splice(b.notes.indexOf(n), 1); save(); renderBoard(); } }, icon("x")));
    // Drag the note by its header.
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const z = b.view.z, sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
      const el = head.parentNode;
      el.classList.add("dragging");
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
        // Bring to front.
        b.notes.splice(b.notes.indexOf(n), 1);
        b.notes.push(n);
        save();
        renderBoard();
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    });
    const el = h("div", { class: `sl-note sl-note-${n.color}${r.ms < 86400e3 ? " expiring" : ""}`, "data-note": n.id, style: `left:${n.x}px;top:${n.y}px` },
      head, text,
      h("div", { class: "sl-note-life" }, h("div", { class: "sl-note-life-bar", style: `width:${(r.ratio * 100).toFixed(2)}%` })));
    setTimeout(grow, 0);
    return el;
  }

  function renderBoard() {
    if (!boardOpen) return;
    purgeNotes();
    const ws = curWs(), b = board(ws);
    positionBoard();
    boardWrap.titleEl.textContent = `${ws.icon}  ${ws.name}`;
    boardWrap.classList.toggle("blank", isBlank(gBrowser.selectedTab));
    const focused = doc.activeElement?.closest?.(".sl-note")?.dataset.note;
    boardWorld.replaceChildren(...b.notes.map(noteEl));
    if (focused) boardWorld.querySelector(`[data-note="${focused}"] textarea`)?.focus();
    boardWrap.apply();
    boardWrap.classList.toggle("empty", !b.notes.length);
  }

  /* The board covers the page area exactly. */
  function positionBoard() {
    const box = $("#tabbrowser-tabbox").getBoundingClientRect();
    for (const [k, v] of Object.entries({ x: box.left, y: box.top, w: box.width, h: box.height })) boardWrap.style.setProperty(`--bd-${k}`, v + "px");
  }

  /* Refreshes countdowns without rebuilding (keeps typing undisturbed). */
  function tickBoard() {
    if (purgeNotes()) return renderBoard();
    for (const n of board().notes) {
      const el = boardWorld.querySelector(`[data-note="${n.id}"]`);
      if (!el) continue;
      const r = remaining(n);
      el.querySelector(".sl-note-time").textContent = r.label;
      el.querySelector(".sl-note-life-bar").style.width = `${(r.ratio * 100).toFixed(2)}%`;
      el.classList.toggle("expiring", r.ms < 86400e3);
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
    renderBoard();
    clearInterval(boardTimer);
    boardTimer = setInterval(tickBoard, 60e3);
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
    // Fades out, then hides (unless it was reopened meanwhile).
    boardWrap.classList.add("sl-closing");
    clearTimeout(boardHideTimer);
    boardHideTimer = setTimeout(() => { if (!boardOpen) boardWrap.hidden = true; boardWrap.classList.remove("sl-closing"); }, 140);
    clearInterval(boardTimer);
    gBrowser.selectedBrowser.focus();
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
        if (typingInField(e)) return;
        e.preventDefault();
        e.stopPropagation();
        return stepWs(e.key === "ArrowLeft" ? -1 : 1);
      }
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
    sidebarVisible = D.settings.sidebarVisible;

    buildUi();
    installShortcuts();
    hookExternalLinks();
    if (shared.littleWindows.has(window)) enterLittle();
    window.addEventListener("resize", () => { if (boardOpen) renderBoard(); });
    // The page area also changes size while the sidebar slides in or out.
    new ResizeObserver(() => { if (boardOpen) positionBoard(); }).observe($("#tabbrowser-tabbox"));

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
      if (!t.selected) return;
      // Last page of the workspace closed: land on the board (favorites stay where they are).
      const own = gBrowser.tabs.some(x => x !== t && alive(x) && tabWs(x) === activeWs && !isBlank(x));
      // (Last tab of the window: Firefox opens its own new tab, adopted as the placeholder.)
      const lastInWindow = !gBrowser.tabs.some(x => x !== t && alive(x));
      if (!own && !isBlank(t) && !lastInWindow) gBrowser.setSuccessor(t, placeholder(activeWs));
    });
    for (const ev of ["TabClose", "TabAttrModified", "TabMove", "TabShow", "TabHide", "TabPinned", "TabUnpinned"]) tc.addEventListener(ev, render);
    tc.addEventListener("SSTabRestoring", () => { if (!little) applyVisibility(); render(); });
    gBrowser.addTabsProgressListener({
      onLocationChange(browser, webProgress, request, location) {
        if (!webProgress.isTopLevel) return;
        const t = gBrowser.getTabForBrowser(browser);
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
        render();
      },
    });

    await SessionStore.promiseAllWindowsRestored;
    // A Little Sillage window restored from the previous session.
    if (!little && SessionStore.getCustomWindowValue(window, "sillage-little")) enterLittle();
    if (little) { log("Little Sillage window ready"); return; }
    purgeNotes();
    for (const t of gBrowser.tabs) if (alive(t) && !tabWs(t)) setVal(t, WS_KEY, activeWs);
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
      saveWs, deleteWs, selectTab, switchWs, closePalette, query, choose, todayTabs, tabWs, tabItemId, tabForItem,
      archive, clearToday, runCommand, fixup, applyVisibility, cycleStep, endCycle, stepSidebar, createProfile,
      deleteProfile, inView, profOf, copyUrl, get palSel() { return palSel; }, stepWs,
      get sidebarVisible() { return sidebarVisible; },
      openBoard, closeBoard, addNote, board, purgeNotes, get boardOpen() { return boardOpen; },
      openLittle, moveToMain, enterLittle, sync: SillageSync, isBlank, moveWorkspace, absorbSeparateProfiles, dynamicCommands,
    },
  };
  doc.defaultView.windowUtils.loadSheetUsingURIString("chrome://sillage/content/sillage.css", doc.defaultView.windowUtils.AUTHOR_SHEET);
  init().catch(e => log("init " + e + "\n" + e.stack));
})();

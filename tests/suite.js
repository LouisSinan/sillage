// Sillage test suite: runs inside the browser window of a headless Firefox on a throwaway profile.
(async () => {
  const L = sillageLog, S = Sillage._t;
  const { ContextualIdentityService } = ChromeUtils.importESModule("moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs");
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let pass = 0, fail = 0;
  const ok = (cond, name, extra = "") => { cond ? pass++ : fail++; L(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
  const sel = () => gBrowser.selectedTab;
  const url = t => t.linkedBrowser.currentURI.spec;
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); } return false; };
  const keydown = (opts) => window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts }));
  const xulKey = (mods, key) => [...document.querySelectorAll("#sillage-keyset key")].find(k => k.getAttribute("modifiers") === mods && k.getAttribute("key") === key);

  // Profiles created by the tests share this interface directory; only the default profile runs the suite.
  if (!Sillage._t.Profiles.current().isDefault) return;
  try {
    await wait(1500);
    const ws1 = S.activeWs;

    // --- structure
    ok(!!document.getElementById("sl-sidebar"), "sidebar injected");
    ok(gNavToolbox.parentNode.id === "sl-sidebar", "navigation toolbar moved into the sidebar");
    ok(getComputedStyle(document.getElementById("TabsToolbar")).display === "none", "native tab strip hidden");
    ok(S.D.workspaces.length === 1, "default workspace");

    // --- today tabs
    const a = S.newTab("https://example.com/");
    const b = S.newTab("https://example.org/");
    ok(sel() === b, "new tab is selected");
    ok(S.tabWs(a) === ws1 && S.tabWs(b) === ws1, "tabs belong to the workspace");
    ok(S.todayTabs(ws1)[0] === b, "new tab goes to the top of today tabs");
    await until(() => !b.hasAttribute("busy") && url(b).startsWith("https://example.org"));
    ok(url(b).startsWith("https://example.org"), "page loaded", url(b));

    // --- recent tabs, Alt+Tab style (→ goes back, ← comes back, opens on release)
    const a0 = S.newTab("https://example.com/?a0");
    S.selectTab(a); S.selectTab(b);
    const R = () => keydown({ key: "ArrowRight", code: "ArrowRight", ctrlKey: true, shiftKey: true });
    const Lk = () => keydown({ key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true, shiftKey: true });
    const release = () => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
    const sw = document.getElementById("sl-switcher");
    R();
    ok(S.cycling && sel() === b, "Ctrl+Shift+→: cursor on the previous tab, no tab switch yet");
    R();
    ok(sel() === b && !sw.hidden, "Ctrl+Shift+→ again: goes further back, still no switch");
    const cards = [...sw.querySelectorAll(".sl-sw-card")];
    ok(cards[0].classList.contains("origin") && cards[2].classList.contains("sel"), "switcher: current on the left, older to the right");
    Lk();
    ok(sw.querySelectorAll(".sl-sw-card")[1].classList.contains("sel"), "Ctrl+Shift+←: cursor moves back one step");
    release();
    ok(!S.cycling && sel() === a && S.mru[0] === a, "releasing opens the chosen tab");
    ok(sw.hidden, "switcher hides on release");
    R(); R();
    keydown({ key: "Escape", code: "Escape", ctrlKey: true, shiftKey: true });
    ok(!S.cycling && sel() === a && sw.hidden, "Escape cancels the cycle");
    R(); window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    ok(sel() === b, "quick press toggles between the last two tabs");
    gBrowser.removeTab(a0, { animate: false });
    // --- Ctrl+Shift+↑ / ↓: sidebar navigation
    S.renderNow();
    const order = S.todayTabs(S.activeWs);
    S.selectTab(order[0]);
    keydown({ key: "ArrowDown", code: "ArrowDown", ctrlKey: true, shiftKey: true });
    ok(sel() === order[1], "Ctrl+Shift+↓: next sidebar entry");
    keydown({ key: "ArrowUp", code: "ArrowUp", ctrlKey: true, shiftKey: true });
    ok(sel() === order[0], "Ctrl+Shift+↑: previous sidebar entry");
    // --- Ctrl+Shift+C
    keydown({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true });
    const clip = await navigator.clipboard?.readText?.().catch(() => null);
    const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
    trans.init(null); trans.addDataFlavor("text/plain");
    Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard);
    const out = {}; try { trans.getTransferData("text/plain", out); } catch {}
    const copied = clip || out.value?.QueryInterface(Ci.nsISupportsString).data;
    ok(copied === url(sel()), "Ctrl+Shift+C copies the URL", String(copied));
    S.selectTab(b);

    // --- pinning / favorites
    S.togglePin(b);
    const ws = () => S.D.workspaces.find(w => w.id === S.activeWs);
    ok(ws().pinned.length === 1 && !!S.tabItemId(b), "Ctrl+D pins the tab");
    ok(!S.todayTabs(ws1).includes(b), "pinned tab leaves today tabs");
    S.toggleFavorite(a);
    const favs = () => S.D.profiles[0].favorites;
    ok(favs().length === 1 && S.tabWs(a) === "*default", "favorite belongs to the profile");
    S.renderNow();
    ok(document.querySelectorAll("#sl-favorites .sl-fav-tile").length === 1, "favorite tile rendered");
    ok(document.querySelectorAll("#sl-pinned .sl-tab").length === 1, "pinned row rendered");

    // --- folders
    const f = S.createFolder();
    S.moveTab(b, { list: "pinned", folderId: f.id, wsId: ws1 });
    ok(ws().pinned.find(n => n.id === f.id).children.length === 1, "pinned item moved into a folder");
    S.moveTab(b, { list: "pinned", index: 0, wsId: ws1 });
    ok(ws().pinned[0].type === "item" && ws().pinned.length === 2, "pinned item moved out of the folder");

    // --- closing a pinned tab keeps the pinned item
    const bItem = S.tabItemId(b);
    gBrowser.removeTab(b, { animate: false });
    await wait(300);
    ok(!!S.D.workspaces[0].pinned.find(n => n.id === bItem), "closing a pinned tab keeps the item");
    S.openItem(bItem);
    const b2 = S.tabForItem(bItem);
    ok(!!b2 && sel() === b2, "clicking the item reopens the tab");

    // --- workspaces
    S.saveWs({ id: null, name: "Work", icon: "💼", hue: 140, profile: "default" });
    const ws2 = S.activeWs;
    S.closePalette();
    ok(ws2 !== ws1 && S.D.workspaces.length === 2, "new workspace is active");
    ok(b2.hidden, "first workspace's pinned tab hidden in the new one");
    ok(!a.hidden, "favorite visible in workspaces of the same profile");
    const c = S.newTab("https://example.net/");
    ok(S.tabWs(c) === ws2, "tab created in the new workspace");
    keydown({ key: "&", code: "Digit1", ctrlKey: true });
    ok(S.activeWs === ws1, "Ctrl+1 (physical key, any layout) → workspace 1");
    ok(c.hidden && !b2.hidden, "visibility swapped after switching");
    keydown({ key: "ArrowRight", code: "ArrowRight", ctrlKey: true, shiftKey: true });
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
    ok(S.activeWs === ws2 && sel() === c, "recent tabs work across workspaces");
    S.switchWs(ws1);
    const ctrlArrow = key => keydown({ key, code: key, ctrlKey: true });
    ctrlArrow("ArrowRight");
    ok(S.activeWs === ws2, "Ctrl+→ switches to the next workspace");
    ctrlArrow("ArrowRight");
    ok(S.activeWs === ws2, "Ctrl+→ on the last workspace stays there");
    ctrlArrow("ArrowLeft");
    ok(S.activeWs === ws1, "Ctrl+← switches to the previous workspace");
    // In a focused text field of a page, Ctrl+arrows must keep moving by word.
    const field = S.newTab("data:text/html,<input autofocus value='some words here'>");
    await until(() => url(field).startsWith("data:"));
    await wait(800);
    gBrowser.selectedBrowser.focus();
    const imeOk = await until(() => window.windowUtils.IMEStatus !== 0, 5000);
    ctrlArrow("ArrowRight");
    ok(S.activeWs === ws1, "Ctrl+→ inside a text field is left to the field");
    gBrowser.removeTab(field, { animate: false });
    ok(!!xulKey("accel", "B"), "Ctrl+B toggles the sidebar too");

    // --- moving a tab to another workspace
    const d = S.newTab("https://example.com/?d");
    S.moveTab(d, { list: "today", wsId: ws2 });
    ok(S.tabWs(d) === ws2 && d.hidden, "tab moved to the other workspace");
    ok(S.activeWs === ws1 && !sel().hidden, "current workspace keeps a visible tab");

    // --- palette
    Sillage.openPalette("new");
    const wrap = document.getElementById("sl-pal-wrap");
    ok(!wrap.hidden, "palette opens");
    await S.query("example");
    ok(S.palResults.some(r => r.kind === "tab"), "palette finds open tabs", S.palResults.map(r => r.kind).join(","));
    await S.query("github.com");
    ok(S.palResults[0]?.kind === "go" && S.palResults[0].url.startsWith("https://github.com"), "palette recognizes URLs", S.palResults[0]?.url);
    await S.query("weather paris tomorrow");
    ok(S.palResults[0]?.kind === "search", "palette: text becomes a web search", S.palResults[0]?.url);
    await S.query("new work");
    ok(S.palResults[0]?.kind === "cmd", "palette: matching command comes first");
    await S.query("");
    ok(S.palResults.every(r => r.kind === "tab"), "empty palette lists recent tabs");
    S.closePalette();
    ok(wrap.hidden, "palette closes");
    const xs = xulKey("accel", "T");
    ok(!!xs, "Ctrl+T shortcut installed");
    xs.doCommand?.() ?? xs.dispatchEvent(new Event("command"));
    ok(!wrap.hidden, "Ctrl+T opens the palette");
    S.closePalette();
    const native = document.getElementById("key_savePage");
    ok(native?.getAttribute("disabled") === "true", "native Ctrl+S (save page) disabled");

    // --- sidebar
    const vis = S.sidebarVisible;
    S.runCommand("toggle-sidebar");
    ok(S.sidebarVisible === !vis && document.documentElement.classList.contains("sl-hidden"), "Ctrl+S hides the sidebar");
    S.runCommand("toggle-sidebar");
    ok(!document.documentElement.classList.contains("sl-hidden"), "Ctrl+S shows it again");
    const sideEl = document.getElementById("sl-sidebar");
    ok(document.documentElement.classList.contains("sl-anim") && getComputedStyle(sideEl).transitionProperty.includes("margin-left"),
      "showing / hiding the sidebar slides");
    ok(await until(() => !document.documentElement.classList.contains("sl-anim"), 2000) && getComputedStyle(sideEl).transitionProperty === "all",
      "no layout animation outside a toggle (resizing stays immediate)");

    // --- the sidebar toggle only affects the active window
    const win2 = OpenBrowserWindow();
    await until(() => win2.Sillage?._t?.D, 15000);
    await wait(500);
    ok(!!win2.Sillage, "second window gets the Sillage interface");
    S.runCommand("toggle-sidebar");
    await wait(300);
    ok(document.documentElement.classList.contains("sl-hidden") && !win2.document.documentElement.classList.contains("sl-hidden"), "hiding the sidebar leaves other windows unchanged");
    S.runCommand("toggle-sidebar");
    win2.close();
    await wait(300);

    // --- last tab of a workspace
    S.switchWs(ws2);
    for (const t of gBrowser.tabs.filter(t => S.tabWs(t) === ws2)) gBrowser.removeTab(t, { animate: false });
    await wait(300);
    ok(S.activeWs === ws2 && S.tabWs(sel()) !== ws1, "closing the last tab stays in the workspace", S.tabWs(sel()));
    S.switchWs(ws1);

    // --- no empty pages: the board replaces them
    S.saveWs({ id: null, name: "Empty", icon: "🌿", hue: 90, profile: "default" });
    const wsEmpty = S.activeWs;
    await wait(200);
    ok(S.isBlank(sel()) && S.boardOpen, "empty workspace shows the board, not a blank page");
    S.renderNow();
    ok(![...document.querySelectorAll("#sl-today .sl-tab")].some(r => r.title.includes("about:blank")), "the blank placeholder tab is not listed");
    S.closeBoard();
    ok(!S.isBlank(sel()) && !S.boardOpen, "closing the board on an empty workspace goes back to the last tab", S.tabWs(sel()));
    await S.deleteWs(wsEmpty, { confirm: false });
    S.switchWs(ws1);
    // Closing the last page of a workspace lands on the board.
    const lone = S.newTab("https://example.com/?lone");
    S.saveWs({ id: null, name: "Lone", icon: "⭐", hue: 200, profile: "default" });
    const wsLone = S.activeWs;
    S.moveTab(lone, { list: "today", wsId: wsLone });
    S.selectTab(lone);
    gBrowser.removeTab(lone, { animate: false });
    await wait(300);
    ok(S.activeWs === wsLone && S.isBlank(sel()) && S.boardOpen, "closing the last page of a workspace shows its board");
    await S.deleteWs(wsLone, { confirm: false });
    S.switchWs(ws1);
    S.selectTab(S.mru.find(t => !S.isBlank(t) && S.inView(t)));
    ok(!S.boardOpen, "board closed on a real page");
    document.getElementById("sl-orb").click();
    ok(S.boardOpen, "clicking the orb opens the board");
    document.getElementById("sl-orb").click();
    ok(!S.boardOpen, "clicking it again closes the board");

    // --- auto-archiving
    const old = S.newTab("https://example.com/?old", { background: true });
    Object.defineProperty(old, "lastAccessed", { value: Date.now() - 200 * 3600e3 });
    S.archive();
    await wait(300);
    ok(!old.isConnected || old.closing, "old today tab archived");

    // --- fullscreen: the sidebar must not shift
    document.documentElement.setAttribute("inFullscreen", "true");
    gNavToolbox.style.marginTop = "-120px";
    S.renderNow();
    ok(getComputedStyle(gNavToolbox).marginTop === "0px", "fullscreen: navigation toolbar not shifted");
    ok(getComputedStyle(document.getElementById("sl-sidebar")).display !== "none" && document.getElementById("sl-sidebar").getBoundingClientRect().top >= 0, "fullscreen: sidebar in place");
    gNavToolbox.style.marginTop = "";
    document.documentElement.removeAttribute("inFullscreen");

    // --- toolbar items must not be moved to the overflow menu (Firefox measures them as one row)
    const navTarget = document.getElementById("nav-bar-customization-target");
    const before = [...navTarget.children].map(c => c.id).filter(id => id && !id.startsWith("customizableui-special"));
    for (const w of [700, 1100, 800]) { window.resizeTo(w, 800); window.dispatchEvent(new Event("resize")); await wait(400); }
    window.resizeTo(1400, 900);
    await wait(600);
    const overflowed = [...document.querySelectorAll("#nav-bar [overflowedItem], #widget-overflow-list > *, #unified-extensions-area > [overflowedItem]")].map(e => e.id);
    const after = [...navTarget.children].map(c => c.id);
    ok(!overflowed.length && before.every(id => after.includes(id)), "toolbar items stay in the sidebar (no overflow)", "overflowed: " + overflowed.join(","));

    // --- pinned extension icons never overlap the extensions menu button
    const fakeExt = document.createXULElement("toolbarbutton");
    fakeExt.id = "test-ext-browser-action";
    fakeExt.className = "toolbarbutton-1 webextension-browser-action";
    fakeExt.setAttribute("label", "Test");
    document.getElementById("nav-bar-customization-target").append(fakeExt);
    await wait(200);
    const er = fakeExt.getBoundingClientRect(), ur = document.getElementById("unified-extensions-button").getBoundingClientRect();
    ok(er.width > 0 && (er.right <= ur.left + 0.5 || er.left >= ur.right - 0.5) && Math.abs(er.top - ur.top) < 2,
      "pinned extension sits next to the extensions button, not under it", `ext ${Math.round(er.left)}-${Math.round(er.right)} menu ${Math.round(ur.left)}-${Math.round(ur.right)}`);
    fakeExt.remove();

    // --- mouse interactions (simulated events)
    S.runCommand("toggle-sidebar");
    document.getElementById("sl-peek").dispatchEvent(new MouseEvent("mouseenter"));
    ok(document.documentElement.classList.contains("sl-peek"), "hovering the left edge peeks the sidebar");
    S.runCommand("toggle-sidebar");
    ok(!document.documentElement.classList.contains("sl-peek"), "showing the sidebar ends the peek");

    S.renderNow();
    const row = document.querySelector("#sl-today .sl-tab");
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, screenX: 100, screenY: 100 }));
    const menu = document.querySelector("#mainPopupSet > menupopup:last-child");
    const labels = [...(menu?.children || [])].map(m => m.getAttribute("label")).filter(Boolean);
    ok(labels.includes("Pin") && labels.includes("Close"), "right-click opens the tab menu", labels.join(" | "));
    menu?.hidePopup?.();

    const e1 = S.newTab("https://example.com/?dnd1"), e2 = S.newTab("https://example.com/?dnd2");
    S.renderNow();
    const dt = new DataTransfer();
    const src = document.querySelector(`#sl-today .sl-tab:nth-child(1)`);
    const pinZone = document.getElementById("sl-pinned");
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    pinZone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    pinZone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    ok(!!S.tabItemId(e2), "dragging a tab onto pinned items pins it");
    S.renderNow();
    const dot = document.querySelector(`.sl-ws-dot:not(.active)`);
    const src2 = document.querySelector(`#sl-today .sl-tab[data-tab]`);
    const moved = [...gBrowser.tabs].find(t => src2 && S.todayTabs(S.activeWs).includes(t) && t.label === src2.querySelector(".sl-title").textContent);
    src2.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    dot.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    dot.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    src2.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    ok(moved && S.tabWs(moved) === dot.dataset.ws, "dragging a tab onto a workspace moves it there");

    // --- reorder workspaces by dragging their icons
    S.renderNow();
    const orderBefore = S.D.workspaces.map(w => w.id);
    const dots = [...document.querySelectorAll(".sl-ws-dot")];
    const dt2 = new DataTransfer();
    const firstRect = dots[0].getBoundingClientRect();
    dots[1].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt2 }));
    dots[0].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt2, clientX: firstRect.left + 2, clientY: firstRect.top + 5 }));
    dots[0].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt2, clientX: firstRect.left + 2, clientY: firstRect.top + 5 }));
    dots[1].dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt2 }));
    ok(S.D.workspaces[0].id === orderBefore[1] && S.D.workspaces[1].id === orderBefore[0], "dragging a workspace icon reorders workspaces");
    S.moveWorkspace(orderBefore[0], 0);
    ok(S.D.workspaces[0].id === orderBefore[0], "workspace order restored");

    // --- palette: workspace commands
    await S.query("work");
    ok(S.palResults[0]?.kind === "cmd" && S.palResults[0].cmd.startsWith("ws:"), "palette: go to workspace");

    // --- closing a tab returns to the previously active tab
    const f1 = S.newTab("https://example.com/?f1"), f2 = S.newTab("https://example.com/?f2"), f3 = S.newTab("https://example.com/?f3");
    S.selectTab(f1); S.selectTab(f3);
    // f2 is f3's neighbour, but f1 is the previously active tab
    gBrowser.removeTab(f3, { animate: false });
    await wait(200);
    ok(sel() === f1, "closing a tab returns to the previously active tab", url(sel()));

    // --- palette autofill
    await until(() => url(f2).includes("f2"));
    await S.query("example.com/?f2");
    ok(S.palResults[0]?.kind === "tab" && S.palResults[0].tab === f2 && S.palSel === 0, "autofill: matching tab moves to the top", S.palResults[0]?.kind);
    await S.query("exam");
    ok(S.palResults[0]?.kind === "tab" && S.palResults[0].sub.startsWith("https://example."), "autofill: \"exam\" → example.com");
    await S.query("exam ple");
    ok(S.palResults[0]?.kind === "search", "no autofill for multi-word searches");
    S.closePalette();

    // --- board: sticky notes with a 7-day lifetime
    S.openBoard();
    ok(S.boardOpen && !document.getElementById("sl-board-wrap").hidden, "board opens over the page");
    const note = S.addNote(40, 40, "Buy milk");
    S.renderNow();
    const noteDom = document.querySelector(`[data-note="${note.id}"]`);
    ok(!!noteDom && noteDom.querySelector("textarea").value === "Buy milk", "note rendered on the board");
    ok(/^6d 23h left$|^7d 0h left$/.test(noteDom.querySelector(".sl-note-time").textContent), "note shows its countdown", noteDom.querySelector(".sl-note-time").textContent);
    ok(parseFloat(noteDom.querySelector(".sl-note-life-bar").style.width) > 99, "lifetime bar starts full");
    const old2 = S.addNote(300, 40, "old");
    old2.expires = Date.now() - 1000;
    S.purgeNotes();
    ok(!S.board().notes.includes(old2) && S.board().notes.includes(note), "expired notes disappear");
    S.renderNow();
    const orb = document.getElementById("sl-orb");
    ok(!!orb && orb.closest(".sl-divider") && orb.querySelector(".sl-orb-count").textContent === "1", "orb sits on the divider and shows the note count");
    S.closeBoard();
    ok(!S.boardOpen && await until(() => document.getElementById("sl-board-wrap").hidden, 2000), "board closes (after fading out)");

    // --- Little Sillage: links from other apps open in a small window
    const before2 = [...Services.wm.getEnumerator("navigator:browser")].length;
    window.browserDOMWindow.openURI(Services.io.newURI("https://example.com/?little"), null,
      Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW, Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL, Services.scriptSecurityManager.getSystemPrincipal());
    let lw = null;
    await until(() => (lw = [...Services.wm.getEnumerator("navigator:browser")].find(w => w !== window && w.Sillage?.isLittle)), 15000);
    ok(!!lw, "external link opens a Little Sillage window", "windows: " + before2);
    if (lw) {
      ok(lw.document.documentElement.classList.contains("sl-little") && !!lw.document.getElementById("sl-little-bar"), "little window shows its compact bar");
      await until(() => lw.gBrowser.selectedBrowser.currentURI.spec.includes("little"));
      const mainTabsBefore = gBrowser.tabs.length;
      lw.Sillage._t.moveToMain(ws1);
      await until(() => lw.closed, 5000);
      const adopted = gBrowser.tabs.find(t => url(t).includes("?little"));
      ok(!!adopted && S.tabWs(adopted) === ws1 && sel() === adopted, "\"Open in\" moves the tab into the workspace", `tabs ${mainTabsBefore}→${gBrowser.tabs.length}`);
      ok(lw.closed, "little window closes after its last tab moves");
    }

    // --- persistence
    await wait(800);
    const saved = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "sillage.json"));
    ok(saved.workspaces.length >= 2 && saved.profiles[0].favorites.length === 1, "data saved to disk");
    ok(SessionStore.getCustomTabValue(a, "sillage-item") === favs()[0].id, "tab ↔ favorite link stored in the session");

    // --- real profiles: separate Firefox profiles, one instance (window) each
    const P = S.Profiles;
    const launched = [];
    P.setLauncher(async e => { launched.push(e.id); });
    const reg0 = await P.readRegistry();
    ok(reg0.profiles[0].id === "default", "registry lists the default profile");
    const { entry: acme, workspace: acmeWs } = await S.createProfile("Acme");
    const acmeDir = P.profileDir(acme);
    ok(await IOUtils.exists(PathUtils.join(acmeDir, "chrome", "sillage.uc.js")) && await IOUtils.exists(PathUtils.join(acmeDir, "sillage-profile.json")),
      "a new profile is a Firefox profile directory with the Sillage interface", acmeDir);
    S.renderNow();
    ok(!!document.querySelector(`.sl-ws-dot.foreign[data-ws="${acmeWs.id}"]`) && !!document.querySelector(".sl-ws-sep"),
      "the other profile's workspaces appear in the sidebar, grouped");
    S.goToWorkspace(acmeWs.id);
    await until(() => launched.includes(acme.id));
    const readInbox = async () => { try { return await IOUtils.readJSON(PathUtils.join(acmeDir, "sillage-inbox.json")); } catch { return []; } };
    ok(launched.includes(acme.id) && (await readInbox()).some(a => a.type === "switch" && a.ws === acmeWs.id),
      "choosing it hands over to that profile's instance");
    const tx = S.newTab("https://example.com/?tx");
    await until(() => url(tx).includes("tx"));
    S.sendTabsTo(acmeWs.id, [tx]);
    await until(async () => (await readInbox()).some(a => a.type === "open"));
    ok(!tx.isConnected && (await readInbox()).some(a => a.type === "open" && a.urls.includes("https://example.com/?tx")),
      "a tab moved to another profile reopens there");
    ok(!S.D.profiles.some(p => p.id === acme.id), "other profiles are not part of this instance's data");
    // Stepping through workspaces (keys, swipe) stays in this window's profile.
    const ownLast = S.D.workspaces[S.D.workspaces.length - 1].id;
    S.switchWs(ownLast);
    const nLaunched = launched.length;
    S.stepWs(1);
    await wait(300);
    ok(S.activeWs === ownLast && launched.length === nLaunched, "next workspace never jumps to another profile's window");
    // The workspace editor creates workspaces in this window, whatever profiles exist.
    S.runCommand("new-ws");
    const wsfField = document.getElementById("sl-wsf-profile").parentNode;
    ok(wsfField.style.display === "none", "new workspace: no profile choice");
    document.getElementById("sl-wsf-name").value = "Editor WS";
    [...document.querySelectorAll("#sl-wsf .sl-actions button")].find(b => b.textContent === "Save").click();
    await wait(300);
    const edWs = S.D.workspaces.find(w => w.name === "Editor WS");
    ok(!!edWs && S.activeWs === edWs.id && launched.length === nLaunched, "a new workspace opens in this window");
    await S.deleteWs(edWs.id, { confirm: false });

    // Hand-over received from another instance: workspace with tabs, and cookies.
    const selfEntry = { id: "default", dir: PathUtils.filename(PathUtils.profileDir) };
    await P.sendToInbox(selfEntry, { type: "workspace", ws: { id: "inboxws", name: "Inbox", icon: "📚", hue: 10, pinned: [] }, urls: ["https://example.com/?inbox"] });
    await P.sendToInbox(selfEntry, { type: "cookies", cookies: [{ host: "example.com", path: "/", name: "sillage_test", value: "1",
      isSecure: true, isHttpOnly: false, isSession: false, expiry: Date.now() + 86400e3, sameSite: 0, schemeMap: 2 }] });
    const tabsBefore = gBrowser.tabs.length;
    window.browserDOMWindow.openURI(Services.io.newURI(P.HANDOFF_URL), null, Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW,
      Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL, Services.scriptSecurityManager.getSystemPrincipal());
    await until(() => S.activeWs === "inboxws", 5000);
    ok(S.activeWs === "inboxws" && gBrowser.tabs.some(t => S.tabWs(t) === "inboxws" && !S.isBlank(t)),
      "hand-over: a workspace and its tabs arrive from another profile", `tabs ${tabsBefore}→${gBrowser.tabs.length}`);
    ok(Services.cookies.getCookiesFromHost("example.com", {}).some(c => c.name === "sillage_test"), "hand-over: cookies arrive from another profile");
    ok(!gBrowser.tabs.some(t => url(t).startsWith(P.HANDOFF_URL)), "the hand-over link never opens as a tab");
    await S.deleteWs("inboxws", { confirm: false });
    S.switchWs(ws1);

    // Older container-based profiles become real profiles.
    const ucid = ContextualIdentityService.create("Legacy", "fingerprint", "blue").userContextId;
    S.D.profiles.push({ id: "legacyp", name: "Legacy", userContextId: ucid, favorites: [] });
    S.D.workspaces.push({ id: "legacyws", name: "Legacy WS", icon: "🧪", hue: 40, profile: "legacyp", pinned: [] });
    const lt = gBrowser.addTrustedTab("https://example.com/?legacy", { userContextId: ucid, inBackground: true });
    SessionStore.setCustomTabValue(lt, "sillage-ws", "legacyws");
    Services.cookies.add("example.com", "/", "legacy_cookie", "1", true, false, false, Date.now() + 86400e3, { userContextId: ucid }, 0, 2, false);
    await until(() => url(lt).includes("legacy"));
    await S.migrateContainerProfiles();
    const regM = await P.readRegistry();
    const migrated = regM.profiles.find(p => p.name === "Legacy");
    const mdata = migrated && await IOUtils.readJSON(PathUtils.join(P.profileDir(migrated), "sillage.json"));
    let minbox = [];
    try { minbox = migrated ? await IOUtils.readJSON(PathUtils.join(P.profileDir(migrated), "sillage-inbox.json")) : []; } catch {}
    ok(!!migrated && mdata.workspaces.some(w => w.id === "legacyws"), "container profile migrated to a real profile with its workspaces");
    ok(minbox.some(a => a.type === "open" && a.urls.some(u => u.includes("legacy"))) && minbox.some(a => a.type === "cookies" && a.cookies.some(c => c.name === "legacy_cookie")),
      "its open tabs and sign-in cookies move over");
    ok(!S.D.profiles.some(p => p.id === "legacyp") && !S.D.workspaces.some(w => w.id === "legacyws") && !lt.isConnected,
      "the container profile is gone from this instance");
    P.setLauncher(null);

    // --- Firefox Sync: two simulated devices merging their states
    const Sync = S.sync;
    const clone = o => JSON.parse(JSON.stringify(o));
    const { Weave } = ChromeUtils.importESModule("resource://services-sync/main.sys.mjs");
    await until(() => !!Weave.Service.engineManager.get("sillage"), 10000);
    const engine = Weave.Service.engineManager.get("sillage");
    ok(!!engine && engine.enabled, "Sillage engine registered with Firefox Sync");
    ok(Services.prefs.getBoolPref("services.sync.engineStatusChanged.sillage", false),
      "engine marked as enabled by the user, so Sync adds it to the server instead of turning it off");
    const rec = await engine._store.createRecord(Sync._test.STATE_ID, "sillage");
    ok(rec.state?.v === 1 && Object.keys(rec.state.workspaces).length >= 2, "sync record carries the workspaces");

    // "Linux": the current data. "Mac": a fresh install that joins.
    const linux = clone(S.D);
    linux.workspaces[0].pinned.push({ type: "item", id: "syncpin", url: "https://example.com/sync", title: "Sync pin" });
    linux.workspaces[0].mod = Date.now();
    const mac = { profiles: [{ id: "default", name: "Personal", userContextId: 0, favorites: [] }],
      workspaces: [{ id: "macfresh", name: "Personal", icon: "🏠", hue: 250, profile: "default", pinned: [] }], settings: {} };
    Sync.initStamps(mac);
    const r1 = Sync.merge(mac, Sync.buildState(linux));
    ok(r1.changed && mac.workspaces.length === linux.workspaces.length && !mac.workspaces.some(w => w.id === "macfresh"),
      "joining device takes the remote workspaces and drops its untouched default", mac.workspaces.map(w => w.name).join(","));
    ok(mac.workspaces[0].pinned.some(i => i.id === "syncpin"), "pinned items arrive on the other device");
    ok(mac.profiles[0].favorites.length === linux.profiles[0].favorites.length, "favorites arrive on the other device");

    // Edit on the Mac, merge back into Linux.
    mac.workspaces[0].name = "Renamed on Mac";
    mac.workspaces[0].board.notes.push({ id: "n1", x: 0, y: 0, text: "from mac", color: "yellow", created: Date.now(), expires: Date.now() + 86400e3 });
    Sync.stamp(mac);
    mac.workspaces[0].mod = Date.now() + 1000;
    const r2 = Sync.merge(linux, Sync.buildState(mac));
    ok(r2.changed && linux.workspaces[0].name === "Renamed on Mac" && linux.workspaces[0].board.notes.some(n => n.id === "n1"), "remote edits (name, board notes) are applied");
    // An older remote change must not override a newer local one.
    const stale = Sync.buildState(mac);
    stale.workspaces[linux.workspaces[0].id].name = "stale";
    stale.workspaces[linux.workspaces[0].id].mod = 1;
    Sync.merge(linux, stale);
    ok(linux.workspaces[0].name === "Renamed on Mac", "older remote changes are ignored");
    // Deletion propagates.
    const gone = linux.workspaces[1].id;
    Sync.noteDeletion(mac, "workspace", gone);
    mac.workspaces.splice(mac.workspaces.findIndex(w => w.id === gone), 1);
    const r3 = Sync.merge(linux, Sync.buildState(mac));
    ok(r3.removedWorkspaces.includes(gone) && !linux.workspaces.some(w => w.id === gone), "workspace deletions propagate");
    // Profiles created on another device reach this device's registry (default profile).
    const regBefore = (await S.Profiles.readRegistry()).profiles.length;
    Sync.merge(linux, { v: 1, profiles: {}, workspaces: {}, registry: [{ id: "remotep", name: "Remote" }] });
    await until(async () => (await S.Profiles.readRegistry()).profiles.some(p => p.id === "remotep"), 3000);
    const regAfter = await S.Profiles.readRegistry();
    ok(regAfter.profiles.some(p => p.id === "remotep") && !linux.profiles.some(p => p.id === "remotep"),
      "a profile created on another device is added to the local registry", `${regBefore}→${regAfter.profiles.length}`);
    Sync.initStamps(S.D);

    // --- interface screenshot
    try {
      const cv = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      cv.width = window.innerWidth; cv.height = window.innerHeight;
      cv.getContext("2d").drawWindow(window, 0, 0, cv.width, cv.height, "rgb(0,0,0)");
      const blob = await new Promise(r => cv.toBlob(r, "image/png"));
      await IOUtils.write(PathUtils.join(PathUtils.profileDir, "capture.png"), new Uint8Array(await blob.arrayBuffer()));
      L("screenshot written");
    } catch (e) { L("screenshot failed: " + e); }
  } catch (e) {
    fail++;
    L("FAIL exception " + e + "\n" + e.stack);
  }
  L(`DONE: ${pass} passed, ${fail} failed`);
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
})();

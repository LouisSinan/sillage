// Sillage loader (Firefox ignores the first line of an autoconfig file).
try {
  // Appends a line to <profile>/sillage.log (UTF-8; write() takes a byte string).
  const log = msg => {
    try {
      const f = Services.dirsvc.get("ProfD", Ci.nsIFile);
      f.append("sillage.log");
      const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      s.init(f, 0x02 | 0x08 | 0x10, 0o644, 0);
      const t = unescape(encodeURIComponent(`${new Date().toISOString()} ${msg}\n`));
      s.write(t, t.length);
      s.close();
    } catch {}
  };
  // State shared by all browser windows (workspaces, pinned items, favorites).
  const shared = { data: null, ready: null, windows: new Set() };

  // Expose <profile>/chrome as chrome://sillage/content/ (privileged code must load from chrome://).
  const manifest = Services.dirsvc.get("UChrm", Ci.nsIFile);
  manifest.append("chrome.manifest");
  if (manifest.exists()) Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(manifest);

  Services.obs.addObserver(win => {
    try {
      win.sillageLog = log;
      win.sillageShared = shared;
      Services.scriptloader.loadSubScript("chrome://sillage/content/sillage.uc.js", win);
    } catch (e) { log("ERR " + e + "\n" + e.stack); }
  }, "browser-delayed-startup-finished");
} catch (e) { Cu.reportError(e); }

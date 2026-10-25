// Sillage — profiles.
//
// A Sillage profile is a real Firefox profile: its own extensions, passwords, history, cookies and
// Firefox Account. Each profile runs as its own Firefox instance; the sidebar of every instance lists the
// workspaces of all profiles, and choosing a workspace of another profile hands over to that instance.
//
// Layout (next to the default profile directory, "home"):
//   <home>/profile or Profile   the default profile (the one installed by `make install`)
//   <home>/profiles/<id>/       other profiles
//   <home>/profiles.json        local registry: [{ id, name, dir }], shared by all instances
// Each profile directory holds sillage-profile.json ({ id, home }) and may receive actions from other
// instances in sillage-inbox.json (open a workspace, move tabs in, import cookies…).

const REGISTRY = "profiles.json";
const IDENTITY = "sillage-profile.json";
const INBOX = "sillage-inbox.json";
const ALIVE = "sillage-alive"; // touched every second by a running instance
const ALIVE_WINDOW = 5000;
export const HANDOFF_URL = "https://sillage.invalid/handoff";

let self = null; // { id, home, dir, isDefault }

const join = (...p) => PathUtils.join(...p);

/* Identifies the current profile; the default profile writes its identity file on first run. */
export async function identify() {
  if (self) return self;
  const dir = PathUtils.profileDir;
  let ident = null;
  try { ident = await IOUtils.readJSON(join(dir, IDENTITY)); } catch {}
  if (!ident) {
    ident = { id: "default", home: PathUtils.parent(dir) };
    await IOUtils.writeJSON(join(dir, IDENTITY), ident);
  }
  self = { id: ident.id, home: ident.home, dir, isDefault: ident.id === "default" };
  return self;
}

export function current() { return self; }

/* ---------- registry ---------- */

export async function readRegistry() {
  await identify();
  let reg = null;
  try { reg = await IOUtils.readJSON(join(self.home, REGISTRY)); } catch {}
  if (!reg?.profiles?.length) {
    reg = { profiles: [{ id: "default", name: "Personal", dir: PathUtils.filename(self.isDefault ? self.dir : join(self.home, "profile")) }] };
    if (self.isDefault) await writeRegistry(reg);
  }
  return reg;
}

export async function writeRegistry(reg) {
  const path = join(self.home, REGISTRY);
  await IOUtils.writeJSON(path, reg, { tmpPath: path + ".tmp" });
}

export function profileDir(entry) {
  return join(self.home, ...entry.dir.split("/"));
}

/* Applies a change to the registry (read-modify-write, last writer wins). */
export async function updateRegistry(fn) {
  const reg = await readRegistry();
  fn(reg);
  await writeRegistry(reg);
  return reg;
}

/* ---------- creating a profile ---------- */

async function run(exe, args) {
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(exe);
  const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  proc.init(file);
  return new Promise(resolve => proc.runwAsync(args, args.length, { observe: () => resolve(proc.exitValue) }));
}

/* Creates the directory of a profile: identity, link to the Sillage interface and preferences. */
export async function ensureProfileDir(entry, { name, data } = {}) {
  const dir = profileDir(entry);
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  if (!(await IOUtils.exists(join(dir, IDENTITY)))) await IOUtils.writeJSON(join(dir, IDENTITY), { id: entry.id, home: self.home });
  // Same interface and preferences as this profile: link to the same targets.
  const chrome = Services.dirsvc.get("UChrm", Ci.nsIFile);
  const chromeTarget = chrome.isSymlink() ? chrome.target : chrome.path;
  const userJs = join(self.dir, "user.js");
  let userJsTarget = userJs;
  try {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(userJs);
    if (f.isSymlink()) userJsTarget = f.target;
  } catch {}
  if (!(await IOUtils.exists(join(dir, "chrome")))) await run("/bin/ln", ["-s", chromeTarget, join(dir, "chrome")]);
  if (!(await IOUtils.exists(join(dir, "user.js"))) && (await IOUtils.exists(userJsTarget))) await run("/bin/ln", ["-s", userJsTarget, join(dir, "user.js")]);
  if (data && !(await IOUtils.exists(join(dir, "sillage.json")))) await IOUtils.writeJSON(join(dir, "sillage.json"), data);
  return dir;
}

const slug = name => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "profile";

/* Registers and creates a new profile. `data` seeds its sillage.json (first workspace…). */
export async function createProfile(name, data) {
  const reg = await readRegistry();
  let id = slug(name);
  while (reg.profiles.some(p => p.id === id)) id += "-" + crypto.randomUUID().slice(0, 4);
  const entry = { id, name, dir: `profiles/${id}` };
  reg.profiles.push(entry);
  await writeRegistry(reg);
  await ensureProfileDir(entry, { data });
  return entry;
}

/* ---------- reading other profiles ---------- */

const foreignCache = new Map(); // id -> { mtime, data }

/* Workspaces of the other profiles (from their sillage.json), cached by modification time. */
export async function readForeign(reg) {
  const out = [];
  for (const entry of reg.profiles) {
    if (entry.id === self.id) continue;
    const path = join(profileDir(entry), "sillage.json");
    let mtime = 0;
    try { mtime = (await IOUtils.stat(path)).lastModified; } catch {}
    let cached = foreignCache.get(entry.id);
    if (!cached || cached.mtime !== mtime) {
      let data = null;
      try { data = mtime ? await IOUtils.readJSON(path) : null; } catch {}
      cached = { mtime, data };
      foreignCache.set(entry.id, cached);
    }
    const workspaces = (cached.data?.workspaces || []).map(w => ({ id: w.id, name: w.name, icon: w.icon, hue: w.hue }));
    out.push({ profile: entry, workspaces });
  }
  return out;
}

/* ---------- inbox: actions sent to another profile ---------- */

export async function sendToInbox(entry, action) {
  const dir = profileDir(entry);
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  const path = join(dir, INBOX);
  let list = [];
  try { list = await IOUtils.readJSON(path); } catch {}
  list.push({ ...action, at: Date.now() });
  await IOUtils.writeJSON(path, list, { tmpPath: path + ".tmp" });
}

/* Takes this profile's pending actions (and clears the inbox). */
export async function takeInbox() {
  const path = join(self.dir, INBOX);
  let list = [];
  try { list = await IOUtils.readJSON(path); } catch { return []; }
  await IOUtils.remove(path, { ignoreAbsent: true });
  return Array.isArray(list) ? list : [];
}

export async function inboxPending() {
  return IOUtils.exists(join(self.dir, INBOX));
}

/* ---------- liveness ---------- */

/* Marks this instance as running (called periodically). */
export async function heartbeat() {
  const path = join(self.dir, ALIVE);
  try { await IOUtils.setModificationTime(path, Date.now()); }
  catch { await IOUtils.writeUTF8(path, ""); }
}

export async function isRunning(entry) {
  try { return Date.now() - (await IOUtils.stat(join(profileDir(entry), ALIVE))).lastModified < ALIVE_WINDOW; }
  catch { return false; }
}

/* ---------- launching / raising another profile ---------- */

/* Starts the profile's Firefox instance unless it already runs: a running instance picks up its inbox
   within a second and raises its own window. */
let launcher = null; // replaced by the tests, so that no real instance is started
export function setLauncher(fn) { launcher = fn; }

export async function launch(entry) {
  if (launcher) return launcher(entry);
  if (await isRunning(entry)) return 0;
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
  const dir = profileDir(entry);
  // Firefox exports XRE_PROFILE_* for its own restarts; they would point the new process back at this
  // profile, so start it without them.
  const args = [
    "-u", "XRE_PROFILE_PATH", "-u", "XRE_PROFILE_LOCAL_PATH", "-u", "XRE_PROFILE_NAME",
    "-u", "XRE_RESTARTED_BY_PROFILE_MANAGER", "-u", "MOZ_LAUNCHED_CHILD",
    exe, "--profile", dir, "--name", "sillage",
  ];
  return run("/usr/bin/env", args);
}

/* Brings this instance's window to the front (Hyprland ignores plain focus requests from apps). */
export async function raise(win) {
  try { win.focus(); } catch {}
  const env = Services.env;
  if (env.exists("HYPRLAND_INSTANCE_SIGNATURE")) {
    const pid = Services.appinfo.processID;
    for (const hyprctl of ["/usr/bin/hyprctl", "/usr/local/bin/hyprctl"]) {
      if (!(await IOUtils.exists(hyprctl))) continue;
      // Lua configuration first, then the classic dispatcher syntax.
      await run(hyprctl, ["dispatch", `hl.dsp.focus({ window = "pid:${pid}" })`]);
      await run(hyprctl, ["dispatch", "focuswindow", `pid:${pid}`]);
      break;
    }
  }
}

export const _test = { slug };

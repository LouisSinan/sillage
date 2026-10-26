// Sillage — Firefox Sync engine.
//
// Workspaces (pinned items, folders, boards) and profiles (names, favorites) travel through the user's
// Firefox Account like bookmarks or passwords: end-to-end encrypted, in a "sillage" collection that
// regular Firefox clients ignore. The whole state is a single record; merging is per workspace and per
// profile, the most recently modified side wins, and deletions are kept as tombstones so they propagate.
//
// Per-device data is never synced: open tabs, sidebar width and visibility, board pan/zoom, and the
// Firefox container backing each profile (recreated locally when a profile arrives from another device).

import { SyncEngine, Store, Tracker } from "resource://services-sync/engines.sys.mjs";
import { CryptoWrapper } from "resource://services-sync/record.sys.mjs";
import { Svc, Utils } from "resource://services-sync/util.sys.mjs";
import { SCORE_INCREMENT_XLARGE } from "resource://services-sync/constants.sys.mjs";
import { ContextualIdentityService } from "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs";

const STATE_ID = "sillage-state";
const TOMBSTONE_TTL = 90 * 86400e3;
const CONTAINER_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];

let shared = null; // state shared with the browser windows (see firefox/config.js)
// Per data object: entity key -> serialized synced fields, to detect local changes.
const hashTables = new WeakMap();
const hashesOf = D => { let m = hashTables.get(D); if (!m) hashTables.set(D, (m = new Map())); return m; };

/* ---------- synced view of the data ---------- */

// Keys starting with "_" are runtime-only (timers…).
const serialize = o => JSON.stringify(o, (k, v) => (k.startsWith("_") ? undefined : v));

const profileFields = p => ({ name: p.name, favorites: p.favorites });
const workspaceFields = (w, order) => ({
  name: w.name, icon: w.icon, hue: w.hue, profile: w.profile, pinned: w.pinned,
  notes: w.board?.notes || [], items: w.board?.items || [], hiddenExtensions: w.hiddenExtensions || [], order,
});

/* A workspace or profile nobody has touched yet (fresh install defaults). */
function pristine(entity, kind) {
  if (entity.mod) return false;
  return kind === "profile" ? !entity.favorites.length : !entity.pinned.length && !entity.board?.notes?.length && !entity.board?.items?.length && !entity.hiddenExtensions?.length;
}

/* Stamps entities whose synced fields changed since the last call. Returns true if anything changed. */
export function stamp(D, { initial = false } = {}) {
  const hashes = hashesOf(D);
  const now = Date.now();
  let changed = false;
  const check = (key, fields, entity) => {
    const k = serialize(fields);
    if (hashes.get(key) === k) return;
    hashes.set(key, k);
    // Changed, or created since the last check (the initial pass only records what exists).
    if (!initial) { entity.mod = now; changed = true; }
  };
  D.profiles.forEach(p => check("p:" + p.id, profileFields(p), p));
  D.workspaces.forEach((w, i) => check("w:" + w.id, workspaceFields(w, i), w));
  return changed;
}

/* First run with sync support: existing data counts as modified now, untouched defaults stay at 0
   so that they never override real data from another device. */
export function initStamps(D) {
  if (!D.sync) {
    const now = Date.now();
    D.sync = { tombstones: {} };
    for (const p of D.profiles) if (!pristine(p, "profile")) p.mod ||= now;
    for (const w of D.workspaces) if (!pristine(w, "workspace")) w.mod ||= now;
  }
  D.sync.tombstones ||= {};
  hashesOf(D).clear();
  stamp(D, { initial: true });
}

export function noteDeletion(D, kind, id) {
  D.sync ||= { tombstones: {} };
  D.sync.tombstones[`${kind}:${id}`] = Date.now();
  hashesOf(D).delete((kind === "profile" ? "p:" : "w:") + id);
  changed();
}

/* The record uploaded to the server. Pristine defaults are left out. */
export function buildState(D) {
  const now = Date.now();
  const state = { v: 1, profiles: {}, workspaces: {} };
  for (const p of D.profiles) if (!pristine(p, "profile")) state.profiles[p.id] = { ...profileFields(p), mod: p.mod || 0 };
  D.workspaces.forEach((w, i) => { if (!pristine(w, "workspace")) state.workspaces[w.id] = { ...workspaceFields(w, i), mod: w.mod || 0 }; });
  for (const [key, time] of Object.entries(D.sync?.tombstones || {})) {
    if (now - time > TOMBSTONE_TTL) { delete D.sync.tombstones[key]; continue; }
    const [kind, id] = key.split(":");
    const bucket = kind === "profile" ? state.profiles : state.workspaces;
    if (!bucket[id]) bucket[id] = { deleted: true, mod: time };
  }
  return JSON.parse(serialize(state));
}

/* Merges a remote state into D. Returns { changed, removedWorkspaces, needsUpload }. */
export function merge(D, remote) {
  const hashes = hashesOf(D);
  const result = { changed: false, removedWorkspaces: [], needsUpload: false };
  if (!remote || remote.v !== 1) return result;
  const tomb = D.sync?.tombstones || {};
  const local = buildState(D);

  // Profiles first: workspaces refer to them.
  for (const [id, r] of Object.entries(remote.profiles || {})) {
    const p = D.profiles.find(x => x.id === id);
    const localMod = p ? p.mod || 0 : tomb["profile:" + id] || -1;
    if (r.mod <= localMod) continue;
    if (r.deleted) {
      if (p && p.userContextId !== 0) {
        for (const w of D.workspaces) if (w.profile === id) w.profile = D.profiles[0].id;
        try { ContextualIdentityService.remove(p.userContextId); } catch {}
        D.profiles.splice(D.profiles.indexOf(p), 1);
        hashes.delete("p:" + id);
        result.changed = true;
      }
      continue;
    }
    if (p) Object.assign(p, profileFields(r), { mod: r.mod });
    else {
      const ci = id === "default" ? { userContextId: 0 }
        : ContextualIdentityService.create(r.name, "fingerprint", CONTAINER_COLORS[D.profiles.length % CONTAINER_COLORS.length]);
      D.profiles.push({ id, ...profileFields(r), userContextId: ci.userContextId, mod: r.mod });
    }
    delete tomb["profile:" + id];
    hashes.set("p:" + id, serialize(profileFields(D.profiles.find(x => x.id === id))));
    result.changed = true;
  }

  let reorder = false;
  for (const [id, r] of Object.entries(remote.workspaces || {})) {
    const w = D.workspaces.find(x => x.id === id);
    const localMod = w ? w.mod || 0 : tomb["workspace:" + id] || -1;
    if (r.mod <= localMod) continue;
    if (r.deleted) {
      if (w && D.workspaces.length > 1) {
        D.workspaces.splice(D.workspaces.indexOf(w), 1);
        hashes.delete("w:" + id);
        result.removedWorkspaces.push(id);
        result.changed = true;
      }
      continue;
    }
    const profile = D.profiles.some(p => p.id === r.profile) ? r.profile : D.profiles[0].id;
    const fields = { name: r.name, icon: r.icon, hue: r.hue, profile, pinned: r.pinned || [], hiddenExtensions: r.hiddenExtensions || [], mod: r.mod, _order: r.order };
    if (w) {
      Object.assign(w, fields);
      w.board = { ...(w.board || { view: { x: 0, y: 0, z: 1 } }), notes: r.notes || [], items: r.items || [] };
    } else {
      D.workspaces.push({ id, ...fields, board: { notes: r.notes || [], items: r.items || [], view: { x: 0, y: 0, z: 1 } } });
      reorder = true;
    }
    delete tomb["workspace:" + id];
    result.changed = true;
  }

  // Joining from a fresh install: drop the untouched default workspace once real ones arrived.
  if (Object.values(remote.workspaces || {}).some(r => !r.deleted)) {
    for (const w of [...D.workspaces]) {
      if (pristine(w, "workspace") && !remote.workspaces[w.id] && D.workspaces.length > 1) {
        D.workspaces.splice(D.workspaces.indexOf(w), 1);
        result.removedWorkspaces.push(w.id);
        result.changed = true;
      }
    }
  }

  if (reorder || result.changed) {
    // Remote order for synced workspaces; local-only ones keep their place at the end.
    D.workspaces.forEach((w, i) => { if (w._order == null) w._order = 1000 + i; });
    D.workspaces.sort((a, b) => a._order - b._order);
    D.workspaces.forEach(w => delete w._order);
  }
  for (const w of D.workspaces) hashes.set("w:" + w.id, serialize(workspaceFields(w, D.workspaces.indexOf(w))));

  // Anything we know better than the server goes back up on the next sync.
  const merged = buildState(D);
  result.needsUpload = serialize(merged) !== serialize(remote) && serialize(local) !== serialize(remote);
  return result;
}

/* ---------- Sync engine ---------- */

function SillageRecord(collection, id) {
  CryptoWrapper.call(this, collection, id);
}
SillageRecord.prototype = { _logName: "Sync.Record.Sillage" };
Object.setPrototypeOf(SillageRecord.prototype, CryptoWrapper.prototype);
Utils.deferGetSet(SillageRecord, "cleartext", ["state"]);

function SillageStore(name, engine) {
  Store.call(this, name, engine);
}
SillageStore.prototype = {
  async getAllIDs() { return { [STATE_ID]: true }; },
  async changeItemID() {},
  async itemExists(id) { return id === STATE_ID; },
  async createRecord(id, collection) {
    const record = new SillageRecord(collection, id);
    if (id === STATE_ID && shared?.data) record.state = buildState(shared.data);
    else record.deleted = true;
    return record;
  },
  async create(record) { return this.update(record); },
  async update(record) {
    if (record.id !== STATE_ID || !shared?.data) return;
    const D = shared.data;
    const result = merge(D, record.state);
    if (result.changed) {
      await shared.persist?.();
      Services.obs.notifyObservers(null, "sillage-sync-applied", JSON.stringify(result));
    }
    if (result.needsUpload) this.engine._tracker.modified = true;
  },
  async remove() {},
  async wipe() {},
};
Object.setPrototypeOf(SillageStore.prototype, Store.prototype);

function SillageTracker(name, engine) {
  Tracker.call(this, name, engine);
}
SillageTracker.prototype = {
  get modified() { return Svc.PrefBranch.getBoolPref("engine.sillage.modified", false); },
  set modified(value) { Svc.PrefBranch.setBoolPref("engine.sillage.modified", value); },
  clearChangedIDs() { this.modified = false; },
  onStart() {},
  onStop() {},
};
Object.setPrototypeOf(SillageTracker.prototype, Tracker.prototype);

function SillageEngine(service) {
  SyncEngine.call(this, "Sillage", service);
}
SillageEngine.prototype = {
  _storeObj: SillageStore,
  _trackerObj: SillageTracker,
  _recordObj: SillageRecord,
  version: 1,
  syncPriority: 10,
  allowSkippedRecord: false,
  async getChangedIDs() {
    return this._tracker.modified ? { [STATE_ID]: Date.now() / 1000 } : {};
  },
  // The store merges incoming data itself, so incoming records are always applied
  // (the merged state is uploaded afterwards if it differs).
  async _reconcile() { return true; },
  async trackRemainingChanges() {
    if (this._modified.count() > 0) this._tracker.modified = true;
  },
};
Object.setPrototypeOf(SillageEngine.prototype, SyncEngine.prototype);

/* ---------- wiring ---------- */

let engineRef = null;

/* Local data changed: schedule an upload. */
function changed() {
  const t = engineRef?._tracker;
  if (!t) return;
  t.modified = true;
  t.score += SCORE_INCREMENT_XLARGE;
}

/* Called from save() in the browser windows. */
export function dataSaved(D) {
  if (stamp(D)) changed();
}

export async function init(sharedState) {
  if (shared) return engineRef;
  shared = sharedState;
  initStamps(shared.data);
  // Enable the engine as if the user had ticked it in the Sync settings. Without "engineStatusChanged",
  // Sync sees an engine enabled locally but missing from the server's engine list, concludes another
  // device disabled it, and turns it off before anything is uploaded.
  Services.prefs.setBoolPref("services.sync.engine.sillage", true);
  Services.prefs.setBoolPref("services.sync.engineStatusChanged.sillage", true);
  try {
    const { Weave } = ChromeUtils.importESModule("resource://services-sync/main.sys.mjs");
    await Weave.Service.whenLoaded?.();
    const manager = Weave.Service.engineManager;
    if (!manager.get("sillage")) await manager.register(SillageEngine);
    engineRef = manager.get("sillage");
    if (engineRef && !engineRef.enabled) engineRef.enabled = true;
    // Upload the current state soon: Sync may otherwise wait up to an hour with a single device.
    changed();
    try { Weave.Service.scheduler.scheduleNextSync(10_000); } catch {}
  } catch (e) {
    console.error("Sillage sync:", e);
  }
  return engineRef;
}

/* Palette "Sync now". */
export async function syncNow() {
  const { Weave } = ChromeUtils.importESModule("resource://services-sync/main.sys.mjs");
  changed();
  await Weave.Service.sync();
}

export const _test = { STATE_ID, SillageEngine };

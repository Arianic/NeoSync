'use strict';
function createSyncEngine(model) {
const { hash, pack, unpack, included, markerPath, rank, merge, validate, references, encode } = model;
class SyncEngine {
  constructor({ local, remote, apply = async fn => fn(), status = () => {}, stopped = () => false }) {
    this.local = local; this.remote = remote; this.apply = apply; this.status = status;
    this.running = null;
    this.stopped = stopped;
  }
  checkActive() { if (this.stopped()) throw new Error('Sync disconnected'); }
  run() {
    if (!this.running) this.running = this.cycle().finally(() => { this.running = null; });
    return this.running;
  }
  async cycle() {
    this.status('syncing');
    // Retry a competing PUT only after a fresh listing and reconciliation.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.reconcile(); }
      catch (err) { if (err.status !== 412 || attempt === 2) throw err; }
    }
  }
  async reconcile() {
    const { local, remote } = this, state = local.state;
    const snapshot = local.scan();
    // A failed/cancelled deletion or a restored file has no deletion authority.
    for (const p of Object.keys(snapshot)) delete state.deletions[p];
    const listing = await remote.list(); // errors never become an empty list
    const downloaded = {}, markers = {};
    // Stage the complete generation before applying any library file.
    for (const p of Object.keys(listing).sort()) {
      this.checkActive();
      const r = await remote.get(p, listing[p]);
      if (included(p)) { validate(p, r.data); downloaded[p] = r; }
      else {
        const m = JSON.parse(r.data);
        if (!included(m.path) || markerPath(m.path) !== p || typeof m.deleted !== 'boolean' || (m.deleted && (typeof m.hash !== 'string' || hash(unpack(m.content)) !== m.hash))) throw new Error('Invalid deletion record');
        markers[m.path] = { ...m, etag: r.etag };
      }
    }
    // Persist downloaded bytes before any upload, apply, or conflict decision.
    state.staged = Object.fromEntries(Object.entries(downloaded).map(([p, r]) => [p, { data: pack(r.data), etag: r.etag }]));
    local.save();
    const paths = [...new Set([...Object.keys(snapshot), ...Object.keys(downloaded), ...Object.keys(state.entries), ...Object.keys(markers)])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const insensitive = new Map();
    for (const p of paths) {
      if (insensitive.has(p.toLowerCase()) && insensitive.get(p.toLowerCase()) !== p) throw new Error('Library has filenames differing only by case');
      insensitive.set(p.toLowerCase(), p);
    }
    const plans = [], effectiveRemote = {}, desired = { ...snapshot };
    let blocked = false;
    for (const p of paths) {
      const l = snapshot[p] ?? null, raw = downloaded[p]?.data ?? null, entry = state.entries[p];
      const base = unpack(entry?.base), marker = markers[p];
      const etag = downloaded[p]?.etag ?? null;
      const tombstone = marker?.deleted;
      const r = tombstone && hash(raw) === marker.hash ? null : raw;
      effectiveRemote[p] = r;
      const conflict = (reason) => { local.conflict(p, l, r ?? (tombstone ? unpack(marker.content) : null), base, etag, reason, marker); blocked = true; };
      const unresolved = Object.values(state.conflicts).find(c => c.path === p && !c.resolved);
      if (unresolved) {
        if (unresolved.etag !== etag || hash(unpack(unresolved.local)) !== hash(l)) conflict(unresolved.reason);
        blocked = true; continue;
      }
      if (tombstone && raw && hash(raw) !== marker.hash) { conflict('deletion-versus-edit'); continue; }
      // A deletion is effective only with evidence this device saw its base.
      if (tombstone && !entry && l) { conflict('first-connection-deletion'); continue; }
      if (!l && !r) {
        if (!tombstone && state.deletions[p]) {
          this.checkActive();
          const deleted = state.deletions[p];
          await remote.put(markerPath(p), encode(JSON.stringify({ path: p, deleted: true, hash: hash(unpack(deleted.content)), content: deleted.content })), marker?.etag);
          state.entries[p] = { hash: null, base: null, etag: null };
          delete state.deletions[p];
          local.save();
        }
        if (tombstone) {
          state.entries[p] = { hash: null, base: null, etag };
          delete state.deletions[p];
          local.save();
        }
        continue;
      }
      if (!l && !state.deletions[p] && entry?.hash) {
        // Unexplained filesystem absence is restored, never propagated.
        if (!r) continue;
      }
      let next, upload = false, remove = false;
      if (hash(l) === hash(r)) next = l;
      else if (!entry) {
        if (l && r) { conflict('first-connection'); continue; }
        next = l || r; upload = !!l;
      } else if (!r && !tombstone) {
        // Remote absence has no deletion authority. A missing remote object
        // is safely recreated with If-None-Match, preserving current local text.
        next = l || base; upload = !!next;
      } else if (!l && state.deletions[p]) {
        if (hash(r) !== state.deletions[p].base) { conflict('deletion-versus-edit'); continue; }
        next = null; remove = true;
      } else if (hash(l) === entry.hash || (!l && !state.deletions[p])) next = r;
      else if (hash(r) === entry.hash) { next = l; upload = !!l; }
      else {
        next = merge(p, base, l, r);
        if (!next) { conflict(tombstone ? 'deletion-versus-edit' : 'both-edited'); continue; }
        upload = true;
      }
      validate(p, next);
      desired[p] = next;
      plans.push({ path: p, before: hash(l), old: pack(l), data: pack(next), next, etag, upload, remove, marker });
    }
    // Cross-file validation is fail-closed for all structural changes. Text
    // uploads can still proceed; metadata never points at a missing object.
    const exists = (files, p) => files[p] != null;
    for (const plan of plans) {
      const deps = references(plan.path, plan.next);
      plan.invalid = deps.some(p => !exists(desired, p));
      if (plan.invalid) blocked = true;
    }
    for (const plan of plans) {
      this.checkActive();
      if (plan.invalid) continue;
      if (plan.upload) {
        if (references(plan.path, plan.next).some(p => !exists(effectiveRemote, p))) { plan.invalid = true; blocked = true; continue; }
        plan.etag = await remote.put(plan.path, plan.next, plan.etag);
        effectiveRemote[plan.path] = plan.next;
        // Restoring an explicitly resolved deletion clears its marker only
        // after the file is durable remotely. Old bytes remain recoverable.
        if (plan.marker?.deleted) await remote.put(markerPath(plan.path), encode(JSON.stringify({ path: plan.path, deleted: false })), plan.marker.etag);
      }
      if (plan.remove) {
        if (Object.entries(effectiveRemote).some(([p, data]) => references(p, data).includes(plan.path))) { plan.invalid = true; blocked = true; continue; }
        const record = { path: plan.path, deleted: true, hash: hash(downloaded[plan.path]?.data), content: pack(downloaded[plan.path]?.data) };
        await remote.put(markerPath(plan.path), encode(JSON.stringify(record)), plan.marker?.etag);
        effectiveRemote[plan.path] = null;
      }
      plan.entry = { hash: hash(plan.next), base: pack(plan.next), etag: plan.etag };
      // Advance only to the uploaded snapshot. A save during the request will
      // therefore differ from this baseline and stay pending on the next run.
      if (hash(local.read(plan.path)) === hash(plan.next)) {
        state.entries[plan.path] = plan.entry;
        delete state.pending[plan.path];
        if (!plan.next) delete state.deletions[plan.path];
        local.save();
      } else if (plan.upload && plan.before === hash(plan.next)) {
        state.entries[plan.path] = plan.entry;
        state.pending[plan.path] = true;
        local.save();
      }
    }
    const changes = plans.filter(p => !p.invalid && p.entry && hash(local.read(p.path)) !== hash(p.next) && !(p.upload && p.before === hash(p.next)));
    if (changes.length) {
      // Validate against current disk again inside the main-process apply
      // lease. No network or await occurs between compare and durable writes.
      const applied = await this.apply(() => {
        if (changes.some(p => hash(local.read(p.path)) !== p.before)) return false;
        const final = local.scan();
        for (const p of changes) final[p.path] = p.next;
        if (Object.entries(final).some(([p, data]) => references(p, data).some(dep => !final[dep]))) return false;
        return local.apply(changes.map(({ path, before, old, data, entry }) => ({ path, before, old, data, entry })));
      });
      if (!applied) blocked = true;
    }
    const current = local.scan();
    state.pending = Object.fromEntries(Object.entries(current).filter(([p, data]) => hash(data) !== state.entries[p]?.hash).map(([p]) => [p, true]));
    state.staged = null;
    local.save();
    const conflict = Object.values(state.conflicts).some(c => !c.resolved);
    const status = conflict ? 'conflict' : blocked || Object.keys(state.pending).length ? 'pending' : 'synced';
    this.status(status);
    return status;
  }
}
return SyncEngine;
}
module.exports = { createSyncEngine };

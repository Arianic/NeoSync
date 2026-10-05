'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { included, hash, pack, unpack, rank, references } = require('./model');

function durable(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  if (process.platform !== 'win32') {
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}
class LocalStorage {
  constructor(root, stateDir) {
    this.root = path.resolve(root);
    this.dir = stateDir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.stateFile = path.join(this.dir, 'state.json');
    this.state = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) :
      { version: 1, entries: {}, pending: {}, deletions: {}, conflicts: {}, journal: null };
    if (this.state.version !== 1 || !this.state.entries || !this.state.conflicts) throw new Error('Unsupported sync state');
    this.recover();
  }
  save() { durable(this.stateFile, JSON.stringify(this.state)); }
  file(p) {
    if (!included(p)) throw new Error('Invalid library path');
    const parts = p.split('/');
    let cursor = this.root;
    for (const part of ['', ...parts]) {
      cursor = path.join(cursor, part);
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Symlinks cannot be synchronized'); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    return cursor;
  }
  read(p) {
    try { return fs.readFileSync(this.file(p)); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  }
  scan() {
    const files = {};
    const visit = (dir, prefix = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = prefix + entry.name;
        if (entry.isSymbolicLink()) throw new Error('Symlinks cannot be synchronized');
        if (entry.isDirectory() && ((!prefix && entry.name.startsWith('book-')) || (prefix.startsWith('book-') && entry.name === 'chapters' && prefix.split('/').length === 2))) visit(path.join(dir, entry.name), p + '/');
        else if (entry.isFile() && included(p)) files[p] = this.read(p);
      }
    };
    visit(this.root);
    return files;
  }
  changed(p) { this.state.pending[p] = true; this.save(); }
  prepareDeletion(paths) {
    this.state.history ||= {};
    for (const p of paths) {
      const data = this.read(p);
      if (data) {
        this.state.deletions[p] = { content: pack(data), base: this.state.entries[p]?.hash ?? null };
        this.state.history[hash(p + ':' + hash(data))] = { path: p, data: pack(data) };
      }
    }
    this.save(); // must succeed BEFORE the local deletion
  }
  conflict(p, local, remote, base, etag, reason, marker = null) {
    const id = hash(p + ':' + hash(local) + ':' + hash(remote) + ':' + JSON.stringify(marker));
    if (!this.state.conflicts[id]) {
      this.state.conflicts[id] = { id, path: p, local: pack(local), remote: pack(remote), base: pack(base), etag, reason, marker, resolved: false };
      this.save();
    }
    return id;
  }
  // A durable journal contains both sides before any replacement. Each entry
  // is replayed only if the file still equals the captured old or new version.
  apply(changes) {
    if (changes.some(c => hash(this.read(c.path)) !== c.before)) return false;
    this.state.history ||= {};
    for (const c of changes) {
      if (c.old != null) this.state.history[hash(c.path + ':' + c.before)] = { path: c.path, data: c.old };
    }
    this.state.journal = changes.sort((a, b) => (a.data == null ? 3 : rank(a.path)) - (b.data == null ? 3 : rank(b.path)));
    this.save();
    this.recover();
    return true;
  }
  recover() {
    if (!this.state.journal) return;
    for (const c of this.state.journal) {
      const now = this.read(c.path), next = unpack(c.data);
      if (references(c.path, next).some(p => this.read(p) == null)) {
        this.conflict(c.path, now, next, unpack(c.old), c.entry.etag, 'missing-dependency-during-recovery');
        continue;
      }
      if (hash(now) === c.before || hash(now) === hash(next)) {
        if (hash(now) !== hash(next)) {
          if (next == null) fs.unlinkSync(this.file(c.path));
          else durable(this.file(c.path), next);
        }
        this.state.entries[c.path] = c.entry;
      } else {
        this.conflict(c.path, now, next, unpack(c.old), c.entry.etag, 'local-edit-during-recovery');
      }
    }
    this.state.journal = null;
    this.save();
  }
}
module.exports = { LocalStorage, durable };

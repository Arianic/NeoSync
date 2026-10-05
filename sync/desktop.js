'use strict';
const { t } = require('../i18n');
const fs = require('node:fs');
const path = require('node:path');
const { LocalStorage, durable } = require('./storage');
const { SyncEngine } = require('./engine');
const { WebDAV, serverURL, sameServer, request, DavError } = require('./webdav');
const { Credentials } = require('./credentials');
const { included, hash, unpack, pack, markerPath, references } = require('./model');

class DesktopSync {
  constructor({ root, userData, safeStorage, send, shell, foreground }) {
    this.root = root; this.send = send; this.shell = shell; this.foreground = foreground;
    this.home = path.join(userData, 'nextcloud', hash(path.resolve(root)));
    const relative = path.relative(path.resolve(root), path.resolve(this.home));
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error(t('Sync state must be outside the library'));
    fs.mkdirSync(this.home, { recursive: true });
    this.credentials = new Credentials(path.join(this.home, 'credentials.bin'), safeStorage);
    this.configFile = path.join(this.home, 'connection.json');
    this.config = fs.existsSync(this.configFile) ? JSON.parse(fs.readFileSync(this.configFile)) : null;
    this.active = false; this.editing = true; this.failures = 0; this.nextTry = 0;
    this.current = { state: 'local', message: '' };
    this.recordConnection(this.config ? 'startup-saved' : 'startup-unconfigured');
    this.poll = setInterval(() => { if (this.foreground()) this.schedule(0); }, 60000);
    this.poll.unref();
    if (this.config) {
      try {
        const secret = this.credentials.read();
        if (!secret) throw new Error(t('No saved Nextcloud credential. Connect again.'));
        this.start(secret);
        this.recordConnection('restored');
      } catch (err) { this.recordConnection('restore-failed'); this.setStatus('error', err.message); }
    }
  }
  recordConnection(event) {
    // Bounded device-local diagnostics: no server, account, password or book
    // data. Failure to record diagnostics must never block local writing.
    try {
      const file = path.join(this.home, 'connection-events.json');
      let events = [];
      try { events = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
      if (!Array.isArray(events)) events = [];
      events.push({ event, time: new Date().toISOString() });
      durable(file, JSON.stringify(events.slice(-40)));
    } catch { /* diagnostics are best effort */ }
  }
  setStatus(state, message = '') { this.current = { state, message }; this.send({ type: 'syncStatus', ...this.info() }); }
  info() {
    return { ...this.current, connected: this.active, configured: !!this.config, editing: this.editing, server: this.config?.server || '', folder: this.config?.folder || 'NeoSync',
      credentials: this.credentials.protection(),
      conflicts: Object.values(this.local?.state.conflicts || {}).filter(c => !c.resolved).map(c => ({ id: c.id, path: c.path, reason: c.reason })) };
  }
  start(secret) {
    const key = hash(this.config.server + '/' + this.config.folder + '/' + secret.loginName);
    this.local = new LocalStorage(this.root, path.join(this.home, key));
    this.remote = new WebDAV({ ...this.config, ...secret });
    this.active = true;
    this.engine = new SyncEngine({ local: this.local, remote: this.remote, apply: fn => this.withApply(fn), status: state => this.setStatus(state), stopped: () => !this.active });
    this.setStatus('pending');
    this.schedule(1000);
  }
  async connect(options) {
    if (this.active) throw new Error(t('Disconnect before changing the connection.'));
    if (!options.singleSync) throw new Error(t('Confirm that this local folder uses only built-in sync.'));
    const protection = this.credentials.protection();
    if (!protection.available) throw new Error(protection.message);
    const server = serverURL(options.server), folder = options.folder;
    const secret = options.loginName && options.appPassword ? { loginName: options.loginName, appPassword: options.appPassword } : this.loginSecret;
    if (!secret || typeof secret.loginName !== 'string' || typeof secret.appPassword !== 'string' || !secret.appPassword) throw new Error(t('Log in or enter a generated app password.'));
    if (this.loginSecret === secret && this.loginServer !== server) throw new Error(t('Log in to the selected server again.'));
    const remote = new WebDAV({ server, folder, ...secret });
    await remote.initialize();
    await remote.list();
    this.credentials.save(secret);
    this.config = { server, folder };
    durable(this.configFile, JSON.stringify(this.config));
    this.recordConnection('connected');
    this.start(secret);
    this.loginSecret = null;
    return this.info();
  }
  async test(options) {
    if ((!options.loginName || !options.appPassword) && serverURL(options.server) !== (this.loginSecret ? this.loginServer : this.config?.server)) throw new Error(t('Log in to the selected server or enter its app password.'));
    const secret = options.loginName && options.appPassword ? options : this.loginSecret || this.credentials.read();
    if (!secret) throw new Error(t('Log in or enter a generated app password.'));
    const remote = new WebDAV({ ...options, loginName: secret.loginName, appPassword: secret.appPassword });
    await remote.discover();
    const r = await remote.call(remote.home, 'PROPFIND', { Depth: '0' });
    if (r.status !== 207) throw new DavError(r.status);
    return true;
  }
  async login(server) {
    this.loginSecret = null;
    this.loginServer = serverURL(server);
    const r = await request(fetch, this.loginServer + 'index.php/login/v2', { method: 'POST', headers: { 'User-Agent': 'NeoSync' } });
    if (r.status !== 200) throw new DavError(r.status);
    const value = JSON.parse(r.data);
    const login = sameServer(value.login, this.loginServer), endpoint = sameServer(value.poll.endpoint, this.loginServer);
    this.loginFlow = { endpoint, token: value.poll.token, expires: Date.now() + 20 * 60000 };
    await this.shell.openExternal(login);
    return true;
  }
  async loginPoll() {
    const flow = this.loginFlow;
    if (!flow || flow.expires < Date.now()) throw new Error(t('Login expired. Start again.'));
    const r = await request(fetch, flow.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: flow.token }).toString() });
    if (r.status === 404) return false;
    if (r.status !== 200) throw new DavError(r.status);
    const value = JSON.parse(r.data);
    if (serverURL(value.server) !== this.loginServer || typeof value.loginName !== 'string' || typeof value.appPassword !== 'string') throw new Error(t('Unexpected login response'));
    this.loginSecret = { loginName: value.loginName, appPassword: value.appPassword };
    this.loginFlow = null;
    return true;
  }
  async disconnect() {
    this.recordConnection('disconnect-requested');
    this.active = false;
    clearTimeout(this.timer);
    // Drain the bounded request already in flight before changing adapters.
    if (this.engine?.running) await this.engine.running.catch(() => {});
    this.credentials.remove();
    if (fs.existsSync(this.configFile)) fs.unlinkSync(this.configFile);
    this.config = null; this.loginSecret = null; this.loginFlow = null;
    this.recordConnection('disconnected');
    this.setStatus('local');
    return this.info();
  }
  changed(file) {
    if (!this.active) return;
    const p = path.relative(this.root, file).split(path.sep).join('/');
    if (!included(p)) return;
    try { this.local.changed(p); }
    catch { this.setStatus('error', t('Local file saved; sync journal could not be written.')); }
    if (this.current.state !== 'error') this.setStatus('pending');
    this.schedule(1800);
  }
  deleting(files) {
    if (!this.active) return;
    this.local.prepareDeletion(files.map(file => path.relative(this.root, file).split(path.sep).join('/')).filter(included));
    this.schedule(1800);
  }
  schedule(delay) {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), Math.max(delay, this.nextTry - Date.now()));
    this.timer.unref();
  }
  async run(manual = false) {
    // A Linux keyring can be locked when the app starts and unlocked later.
    // Retry the saved credential only on an explicit action; never prompt a
    // writer from the background or discard the encrypted file on failure.
    if (!this.active && manual && this.config) {
      try {
        const secret = this.credentials.read();
        if (!secret) throw new Error(t('No saved Nextcloud credential. Connect again.'));
        this.start(secret);
        clearTimeout(this.timer);
      } catch (err) { this.setStatus('error', err.message); return this.info(); }
    }
    if (!this.active || this.resolving) return this.info();
    if (this.deletionInProgress) { this.schedule(1000); return this.info(); }
    if (!manual && Date.now() < this.nextTry) return this.info();
    try {
      await this.engine.run();
      this.failures = 0; this.nextTry = 0;
    } catch (err) {
      if (!this.active) return this.info();
      this.failures++;
      this.nextTry = Date.now() + Math.min(15 * 60000, 5000 * 2 ** Math.min(this.failures, 8));
      this.setStatus(err.status === 0 ? 'offline' : 'error', err.message);
      this.schedule(this.nextTry - Date.now());
    }
    return this.info();
  }
  async withApply(fn) {
    if (!this.active || this.editing || this.lease) return false;
    const token = require('node:crypto').randomUUID();
    const allowed = await new Promise(resolve => {
      const timer = setTimeout(() => { this.lease = null; resolve(false); }, 4000);
      this.lease = { token, resolve: value => { clearTimeout(timer); resolve(value); } };
      this.send({ type: 'syncPrepare', token });
    });
    try { return allowed && this.active && !this.editing ? fn() : false; }
    finally { this.lease = null; this.send({ type: 'syncApplied', token }); }
  }
  ready(token, value) { if (this.lease?.token === token) this.lease.resolve(!!value); }
  setEditing(value) { this.editing = !!value; if (!this.editing) this.schedule(100); }
  async compare(id) {
    const c = this.local?.state.conflicts[id];
    if (!c) throw new Error(t('Conflict not found'));
    const dir = path.join(this.local.dir, 'recovery', c.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const key of ['local', 'remote', 'base']) {
      // Text copies open as text, never as active downloaded HTML.
      durable(path.join(dir, key + (c.path.match(/\.(png|jpg|jpeg|webp)$/i)?.[0] || '.txt')), unpack(c[key]) || Buffer.from('(file absent)'));
    }
    durable(path.join(dir, 'conflict.json'), JSON.stringify({ path: c.path, reason: c.reason }, null, 2));
    await this.shell.openPath(dir);
    return true;
  }
  async recovery() {
    if (!this.local) throw new Error(t('Connect to a library to open its recovery copies.'));
    const dir = path.join(this.local.dir, 'recovery');
    fs.mkdirSync(dir, { recursive: true });
    const versions = [
      ...Object.values(this.local.state.history || {}),
      ...Object.entries(this.local.state.deletions).map(([p, v]) => ({ path: p, data: v.content }))
    ];
    for (const version of versions) {
      if (version.data == null) continue;
      const target = path.join(dir, hash(version.path + ':' + hash(unpack(version.data))));
      durable(path.join(target, 'original-path.txt'), version.path);
      durable(path.join(target, 'content' + (version.path.match(/\.(png|jpg|jpeg|webp)$/i)?.[0] || '.txt')), unpack(version.data));
    }
    await this.shell.openPath(dir);
    return true;
  }
  async resolve(id, choice) {
    if (!['local', 'remote'].includes(choice) || !this.active) throw new Error(t('Invalid conflict choice'));
    if (this.editing) throw new Error(t('Return to the bookshelf before resolving conflicts.'));
    this.resolving = true;
    try {
      if (this.engine.running) await this.engine.running;
      const c = this.local.state.conflicts[id];
      if (!c || c.resolved) throw new Error(t('Conflict not found'));
      const listing = await this.remote.list();
      const r = listing[c.path] ? await this.remote.get(c.path, listing[c.path]) : { data: null, etag: null };
      if (r.etag !== c.etag) throw new Error(t('Remote version changed. Sync again and review the newer conflict.'));
      if (c.marker?.deleted) {
        // Both choices explicitly restore a file or reaffirm a local deletion.
        await this.remote.put(markerPath(c.path), Buffer.from(JSON.stringify({ path: c.path, deleted: false })), c.marker.etag);
      }
      const applied = await this.withApply(() => {
        const now = this.local.read(c.path);
        if (choice === 'remote') {
          const desired = this.local.scan(); desired[c.path] = r.data;
          if (Object.entries(desired).some(([p, data]) => references(p, data).some(dep => !desired[dep]))) throw new Error(t('Resolve the required chapter or asset conflicts first.'));
          this.local.conflict(c.path, now, r.data, unpack(c.base), r.etag, 'before-resolution');
          this.local.apply([{ path: c.path, before: hash(now), old: pack(now), data: pack(r.data), entry: { hash: hash(r.data), base: pack(r.data), etag: r.etag } }]);
        } else {
          this.local.state.entries[c.path] = { hash: hash(r.data), base: pack(r.data), etag: r.etag };
          if (!now) this.local.state.deletions[c.path] = { content: c.local, base: hash(r.data) };
        }
        for (const item of Object.values(this.local.state.conflicts)) if (item.path === c.path) item.resolved = true;
        this.local.save();
        return true;
      });
      if (!applied) throw new Error(t('Close open dialogs and return to the bookshelf, then try again.'));
    } finally { this.resolving = false; }
    return this.run(true);
  }
}
module.exports = { DesktopSync };

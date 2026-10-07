'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalStorage, durable } = require('../sync/storage');
const { SyncEngine } = require('../sync/engine');
const { WebDAV, DavError, listing, serverURL, sameServer } = require('../sync/webdav');
const { Credentials } = require('../sync/credentials');
const { DesktopSync } = require('../sync/desktop');
const { hash, included, markerPath, merge, unpack } = require('../sync/model');

class Server {
  constructor() { this.files = new Map(); this.n = 0; this.calls = []; }
  seed(p, data) { const item = { data: Buffer.from(data), etag: '"' + (++this.n) + '"' }; this.files.set(p, item); return item.etag; }
  async list() { if (this.listError) throw this.listError; return Object.fromEntries([...this.files].filter(([p]) => p !== this.omit).map(([p, v]) => [p, v.etag])); }
  async get(p, etag) {
    const v = this.files.get(p);
    if (!v) throw new DavError(404);
    if (etag && etag !== v.etag) throw new DavError(412);
    if (this.onGet) await this.onGet(p);
    return { data: Buffer.from(v.data), etag: v.etag };
  }
  async put(p, data, etag) {
    this.calls.push({ p, etag });
    if (this.beforePut) await this.beforePut(p);
    const v = this.files.get(p);
    if (etag ? v?.etag !== etag : !!v) throw new DavError(412);
    const next = this.seed(p, data);
    if (this.afterPut) await this.afterPut(p);
    return next;
  }
  text(p) { return this.files.get(p)?.data.toString(); }
}
function fixtures(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neosync-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = new Server();
  const device = name => {
    const root = path.join(dir, name, 'library'), state = path.join(dir, name, 'private');
    fs.mkdirSync(root, { recursive: true });
    const local = new LocalStorage(root, state);
    const engine = new SyncEngine({ local, remote: server });
    return { root, state, local, engine, write: (p, data) => { durable(local.file(p), Buffer.from(data)); local.changed(p); }, text: p => local.read(p)?.toString() ?? null };
  };
  return { server, device };
}
const chapter = 'book-a/chapters/a.html';
const other = 'book-a/chapters/b.html';
const metadata = 'book-a/book.json';
const meta = extra => JSON.stringify({ id: 'book-a', title: 'Book', chapterOrder: ['a'], ...extra });
const library = JSON.stringify({ shelves: [{ id: 's', name: 'Shelf', bookIds: ['book-a'] }] });
const conflicts = d => Object.values(d.local.state.conflicts).filter(c => !c.resolved);

test('two offline autosaves conflict against persistent sync base after restart', async t => {
  const { server, device } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'original'); await a.engine.run(); await b.engine.run();
  a.write(chapter, 'device A autosaved'); b.write(chapter, 'device B autosaved');
  await a.engine.run();
  const restarted = device('b');
  assert.equal(await restarted.engine.run(), 'conflict');
  assert.equal(restarted.text(chapter), 'device B autosaved');
  assert.equal(server.text(chapter), 'device A autosaved');
  const c = conflicts(restarted)[0];
  assert.equal(unpack(c.base).toString(), 'original');
  assert.equal(unpack(c.remote).toString(), 'device A autosaved');
  assert.equal(conflicts(device('b')).length, 1);
});
test('identical concurrent edits reconcile without conflict', async t => {
  const { device } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'base'); await a.engine.run(); await b.engine.run();
  a.write(chapter, 'same'); b.write(chapter, 'same');
  await a.engine.run(); await b.engine.run();
  assert.equal(conflicts(b).length, 0); assert.equal(b.local.state.entries[chapter].hash, hash('same'));
});
test('independent chapter edits and metadata fields merge on both devices', async t => {
  const { device, server } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'a'); a.write(other, 'b'); a.write(metadata, meta({ chapterOrder: ['a', 'b'] }));
  await a.engine.run(); await b.engine.run();
  a.write(chapter, 'A'); b.write(other, 'B');
  a.write(metadata, meta({ chapterOrder: ['a', 'b'], title: 'Renamed' }));
  b.write(metadata, meta({ chapterOrder: ['a', 'b'], subtitle: 'Subtitle' }));
  await a.engine.run(); await b.engine.run(); await a.engine.run();
  assert.equal(a.text(other), 'B'); assert.equal(b.text(chapter), 'A');
  assert.equal(JSON.parse(server.text(metadata)).title, 'Renamed');
  assert.equal(JSON.parse(server.text(metadata)).subtitle, 'Subtitle');
  assert.equal(a.text(metadata), b.text(metadata)); assert.equal(conflicts(b).length, 0);
});
test('upstream outline metadata syncs, merges independent cards, and preserves competing notes', async t => {
  const { device } = fixtures(t), a = device('a'), b = device('b');
  const outline = {
    format: 'screenplay', underlineHeadings: true, contd: false,
    sectionNotes: { a: [{ id: 'section-a', text: 'A section', dismissed: false }] },
    sceneNotes: { 'scene-a': 'A scene' },
    looseCards: [{ id: 'loose-a', text: 'An idea' }]
  };
  const html = '<p class="sp-heading" data-scene-id="scene-a" data-newpage="1">INT. ROOM - DAY</p><p data-sec-id="section-a">Words</p>';
  a.write(chapter, html); a.write(metadata, meta(outline));
  await a.engine.run(); await b.engine.run();
  assert.equal(b.text(chapter), html);
  assert.deepEqual(JSON.parse(b.text(metadata)).sceneNotes, outline.sceneNotes);
  assert.equal(JSON.parse(b.text(metadata)).underlineHeadings, true);
  assert.equal(JSON.parse(b.text(metadata)).contd, false);
  const left = JSON.parse(a.text(metadata)), right = JSON.parse(b.text(metadata));
  left.sceneNotes['scene-a'] = 'Revised scene';
  right.looseCards[0].text = 'Revised idea';
  right.sectionNotes.a[0].dismissed = true;
  a.write(metadata, JSON.stringify(left)); b.write(metadata, JSON.stringify(right));
  await a.engine.run(); await b.engine.run(); await a.engine.run();
  assert.equal(a.text(metadata), b.text(metadata));
  const combined = JSON.parse(a.text(metadata));
  assert.equal(combined.sceneNotes['scene-a'], 'Revised scene');
  assert.equal(combined.looseCards[0].text, 'Revised idea');
  assert.equal(combined.sectionNotes.a[0].dismissed, true);
  const competing = JSON.parse(b.text(metadata));
  combined.sceneNotes['scene-a'] = 'Local alternative';
  competing.sceneNotes['scene-a'] = 'Remote alternative';
  a.write(metadata, JSON.stringify(combined)); b.write(metadata, JSON.stringify(competing));
  await a.engine.run(); assert.equal(await b.engine.run(), 'conflict');
  assert.equal(JSON.parse(b.text(metadata)).sceneNotes['scene-a'], 'Remote alternative');
  assert.equal(JSON.parse(unpack(conflicts(b)[0].remote)).sceneNotes['scene-a'], 'Local alternative');
});
test('simultaneous appends combine but incompatible chapter moves preserve alternatives', () => {
  const bytes = s => Buffer.from(s);
  assert.deepEqual(JSON.parse(merge(metadata, bytes(meta({})), bytes(meta({ chapterOrder: ['a', 'b'] })), bytes(meta({ chapterOrder: ['a', 'c'] })))).chapterOrder, ['a', 'b', 'c']);
  assert.equal(merge(metadata, bytes(meta({ chapterOrder: ['a', 'b', 'c'] })), bytes(meta({ chapterOrder: ['b', 'a', 'c'] })), bytes(meta({ chapterOrder: ['c', 'a', 'b'] }))), null);
});
test('shelves merge by stable IDs and membership rather than losing independent books', () => {
  const data = ids => Buffer.from(JSON.stringify({ shelves: [{ id: 's', name: 'Shelf', bookIds: ids }] }));
  const merged = JSON.parse(merge('library.json', data(['book-a']), data(['book-a', 'book-b']), data(['book-a', 'book-c'])));
  assert.deepEqual(merged.shelves[0].bookIds, ['book-a', 'book-b', 'book-c']);
});
test('chapters and cover upload before book metadata, then shelves; new device receives all', async t => {
  const { server, device } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'words'); a.write('book-a/cover-1.png', 'image');
  a.write(metadata, meta({ coverImage: 'cover-1.png' })); a.write('library.json', library);
  await a.engine.run();
  const calls = server.calls.map(c => c.p);
  assert.ok(calls.indexOf(chapter) < calls.indexOf(metadata));
  assert.ok(calls.indexOf('book-a/cover-1.png') < calls.indexOf(metadata));
  assert.ok(calls.indexOf(metadata) < calls.indexOf('library.json'));
  await b.engine.run(); assert.equal(b.text(chapter), 'words'); assert.equal(b.text('book-a/cover-1.png'), 'image');
});
test('missing dependency does not publish metadata or expose an incomplete incoming book', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(metadata, meta({})); await a.engine.run(); assert.equal(server.text(metadata), undefined);
  server.seed(metadata, meta({}));
  const b = device('b'); await b.engine.run(); assert.equal(b.text(metadata), null);
});
test('delete versus edit preserves text and durable deletion records', async t => {
  const { server, device } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'base'); await a.engine.run(); await b.engine.run();
  a.local.prepareDeletion([chapter]); fs.unlinkSync(a.local.file(chapter));
  b.write(chapter, 'remote edit'); await b.engine.run();
  await a.engine.run();
  assert.equal(server.text(chapter), 'remote edit'); assert.equal(conflicts(a)[0].reason, 'deletion-versus-edit');
  assert.equal(unpack(device('a').local.state.deletions[chapter].content).toString(), 'base');
});
test('explicit deletion propagates via a recoverable tombstone; new device cannot delete anything', async t => {
  const { server, device } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'base'); await a.engine.run(); await b.engine.run();
  a.local.prepareDeletion([chapter]); fs.unlinkSync(a.local.file(chapter)); await a.engine.run();
  await b.engine.run();
  assert.equal(b.text(chapter), null); assert.equal(server.text(chapter), 'base');
  assert.equal(JSON.parse(server.text(markerPath(chapter))).deleted, true);
  assert.ok(Object.values(b.local.state.history).some(v => unpack(v.data).toString() === 'base'));
  const c = device('new'); await c.engine.run(); assert.equal(c.text(chapter), null);
});
test('edit after another device deletes becomes a recoverable conflict', async t => {
  const { device } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'base'); await a.engine.run(); await b.engine.run();
  a.local.prepareDeletion([chapter]); fs.unlinkSync(a.local.file(chapter)); await a.engine.run();
  b.write(chapter, 'new words'); await b.engine.run();
  assert.equal(b.text(chapter), 'new words'); assert.equal(conflicts(b).length, 1);
});
test('unexplained local absence is restored, not propagated as deletion', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'base'); await a.engine.run(); fs.unlinkSync(a.local.file(chapter));
  await a.engine.run(); assert.equal(a.text(chapter), 'base'); assert.equal(server.text(markerPath(chapter)), undefined);
});
test('text edited then deleted before upload stays archived after deletion commits', async t => {
  const { device } = fixtures(t), a = device('a');
  a.write(chapter, 'base'); await a.engine.run(); a.write(chapter, 'words never uploaded');
  a.local.prepareDeletion([chapter]); fs.unlinkSync(a.local.file(chapter)); await a.engine.run();
  assert.equal(a.local.state.deletions[chapter], undefined);
  assert.ok(Object.values(device('a').local.state.history).some(v => unpack(v.data).toString() === 'words never uploaded'));
});
test('failed local deletion does not authorize a later unexplained absence', async t => {
  const { device } = fixtures(t), a = device('a');
  a.write(chapter, 'base'); await a.engine.run();
  a.local.prepareDeletion([chapter]); await a.engine.run();
  assert.equal(a.local.state.deletions[chapter], undefined);
  fs.unlinkSync(a.local.file(chapter)); await a.engine.run(); assert.equal(a.text(chapter), 'base');
});
test('authentication, server and failed listings leave local content and baseline intact', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'local'); await a.engine.run();
  const state = JSON.stringify(a.local.state.entries);
  for (const status of [401, 403, 500, 0]) {
    server.listError = new DavError(status);
    await assert.rejects(a.engine.run()); assert.equal(a.text(chapter), 'local');
    assert.equal(JSON.stringify(a.local.state.entries), state);
  }
});
test('silently omitted remote file cannot cause deletion or blind overwrite', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'local'); await a.engine.run(); server.omit = chapter;
  await assert.rejects(a.engine.run(), /412/);
  assert.equal(a.text(chapter), 'local'); assert.equal(server.text(chapter), 'local');
  assert.ok(server.calls.slice(1).every(c => c.etag === null));
});
test('interrupted download applies no partial library', async t => {
  const { server, device } = fixtures(t), a = device('a');
  server.seed(chapter, 'words'); server.seed(metadata, meta({})); server.seed('library.json', library);
  server.onGet = p => { if (p === chapter) throw new DavError(0); };
  await assert.rejects(a.engine.run()); assert.deepEqual(a.local.scan(), {});
});
test('restart after server committed PUT but before baseline commit is idempotent', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'base'); await a.engine.run(); a.write(chapter, 'new');
  server.afterPut = () => { throw new DavError(0); };
  await assert.rejects(a.engine.run()); assert.equal(server.text(chapter), 'new');
  server.afterPut = null;
  const restarted = device('a'); await restarted.engine.run();
  assert.equal(conflicts(restarted).length, 0); assert.equal(restarted.local.state.entries[chapter].hash, hash('new'));
});
test('local edit during PUT remains queued and uploads in the next cycle', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'base'); await a.engine.run(); a.write(chapter, 'upload snapshot');
  server.beforePut = () => { a.write(chapter, 'typed during upload'); server.beforePut = null; };
  await a.engine.run();
  assert.equal(a.text(chapter), 'typed during upload'); assert.equal(server.text(chapter), 'upload snapshot');
  assert.equal(a.local.state.pending[chapter], true);
  await a.engine.run(); assert.equal(server.text(chapter), 'typed during upload');
});
test('local edit during GET is not overwritten by incoming data', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'base'); await a.engine.run(); server.seed(chapter, 'remote');
  server.onGet = () => { a.write(chapter, 'typed during download'); server.onGet = null; };
  await a.engine.run(); assert.equal(a.text(chapter), 'typed during download');
  await a.engine.run(); assert.equal(conflicts(a).length, 1);
});
test('412 fetches competing content and reconciles before retrying', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'base'); await a.engine.run(); a.write(chapter, 'mine');
  server.beforePut = () => { server.seed(chapter, 'competitor'); server.beforePut = null; };
  await a.engine.run(); assert.equal(server.text(chapter), 'competitor'); assert.equal(conflicts(a).length, 1);
});
test('first connection preserves colliding libraries and downloads independent books', async t => {
  const { server, device } = fixtures(t), a = device('a');
  server.seed(chapter, 'remote'); server.seed('book-z/chapters/z.html', 'other book');
  a.write(chapter, 'local'); await a.engine.run();
  assert.equal(a.text(chapter), 'local'); assert.equal(server.text(chapter), 'remote');
  assert.equal(a.text('book-z/chapters/z.html'), 'other book'); assert.equal(conflicts(a)[0].reason, 'first-connection');
});
test('apply lease defers all incoming files while editor is active', async t => {
  const { server, device } = fixtures(t), a = device('a'); server.seed(chapter, 'remote');
  a.engine.apply = async () => false;
  assert.equal(await a.engine.run(), 'pending'); assert.equal(a.text(chapter), null);
  a.engine.apply = async fn => fn(); await a.engine.run(); assert.equal(a.text(chapter), 'remote');
});
test('durable apply journal replays after interruption and preserves newer local edits', async t => {
  const { device } = fixtures(t), a = device('a'); a.write(chapter, 'base');
  a.local.state.journal = [{ path: chapter, before: hash('base'), old: Buffer.from('base').toString('base64'), data: Buffer.from('remote').toString('base64'), entry: { hash: hash('remote'), base: Buffer.from('remote').toString('base64'), etag: '"2"' } }];
  a.local.save();
  const restarted = device('a'); assert.equal(restarted.text(chapter), 'remote');
  restarted.local.state.journal = a.local.state.journal; restarted.local.save(); restarted.write(chapter, 'newer');
  const again = device('a'); assert.equal(again.text(chapter), 'newer'); assert.equal(conflicts(again).length, 1);
});
test('credential storage refuses plaintext fallback and can round-trip protected bytes', t => {
  const { device } = fixtures(t), a = device('a');
  const file = path.join(a.state, 'secret.bin');
  const bad = new Credentials(file, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' });
  assert.throws(() => bad.save({ appPassword: 'secret' }), /unavailable/); assert.equal(fs.existsSync(file), false);
  const good = new Credentials(file, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: s => Buffer.from(s).reverse(), decryptString: b => Buffer.from(b).reverse().toString() });
  good.save({ appPassword: 'secret' }); assert.equal(good.read().appPassword, 'secret');
  assert.equal(fs.readFileSync(file).includes('secret'), false); good.remove(); assert.equal(good.read(), null);
});
test('paths reject traversal, Windows aliases, backups and non-library files', () => {
  for (const p of ['../library.json', 'book-a/../secrets.json', 'book-a/CON.json', 'book-a/x:stream.json', 'book-a/book.json.bak', 'Backups/a.zip', 'Exports/book.pdf', 'neo-errors.log', '_catalog.txt']) assert.equal(included(p), false, p);
  assert.equal(included('book-a/stickies.json'), true); assert.equal(included('book-a/notes.html'), true);
  assert.equal(serverURL('https://example.com/cloud'), 'https://example.com/cloud/');
  assert.throws(() => sameServer('https://evil.test/login', 'https://example.com/cloud/'));
});
function multistatus(entries) {
  return `<d:multistatus xmlns:d="DAV:">${entries.map(e => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><d:resourcetype>${e.dir ? '<d:collection/>' : ''}</d:resourcetype>${e.dir ? '' : '<d:getetag>&quot;etag&quot;</d:getetag>'}</d:prop><d:status>HTTP/1.1 ${e.status || 200} OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
}
test('DAV XML handles namespaces and entities, rejects partial/malformed/escaped listings', () => {
  const root = 'https://example.com/cloud/remote.php/dav/files/uid/NeoSync/';
  const self = { href: new URL(root).pathname, dir: true };
  const child = { href: self.href + 'library.json' };
  assert.equal(listing(Buffer.from(multistatus([self, child])), root, root)[0].etag, '"etag"');
  for (const xml of [multistatus([child]), multistatus([self, { ...child, status: 403 }]), multistatus([self, { href: '/elsewhere/file' }]), '<d:multistatus>', '<!DOCTYPE test>' + multistatus([self])]) assert.throws(() => listing(Buffer.from(xml), root, root));
});
test('HTTP adapter discovers email login UID, preserves install subpath and uses conditional headers', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    if (url.includes('/ocs/')) return new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data: { id: 'actual-user' } } }));
    if (options.method === 'MKCOL') return new Response(null, { status: 201 });
    if (options.method === 'PUT') return new Response(null, { status: 201, headers: { ETag: '"next"' } });
    throw new Error('unexpected');
  };
  const remote = new WebDAV({ server: 'https://example.com/cloud', folder: 'Books/Neo', loginName: 'email@example.com', appPassword: 'token' }, fetcher);
  await remote.initialize(); await remote.put('library.json', Buffer.from(library), null); await remote.put('library.json', Buffer.from(library), '"previous"');
  const puts = calls.filter(c => c.method === 'PUT');
  assert.equal(puts[0].url, 'https://example.com/cloud/remote.php/dav/files/actual-user/Books/Neo/library.json');
  assert.equal(puts[0].headers['If-None-Match'], '*'); assert.equal(puts[1].headers['If-Match'], '"previous"');
  assert.ok(calls.every(c => c.redirect === 'error'));
});

function controller(t, device) {
  const control = new DesktopSync({ root: device.root, userData: path.join(device.state, 'app'), safeStorage: { isEncryptionAvailable: () => false },
    shell: { openPath: async () => '', openExternal: async () => {} }, foreground: () => false,
    send: message => { if (message.type === 'syncPrepare') queueMicrotask(() => control.ready(message.token, true)); } });
  control.local = device.local; control.remote = device.engine.remote; control.engine = device.engine;
  control.active = true; control.editing = false;
  control.engine.apply = fn => control.withApply(fn);
  control.engine.stopped = () => !control.active;
  t.after(() => { control.active = false; clearInterval(control.poll); clearTimeout(control.timer); });
  return control;
}
test('conflict resolution keeps local choice, and restores remote with an archived local copy', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'local'); server.seed(chapter, 'remote'); await a.engine.run();
  const control = controller(t, a);
  await control.resolve(conflicts(a)[0].id, 'local');
  assert.equal(server.text(chapter), 'local'); assert.equal(conflicts(a).length, 0);
  a.write(chapter, 'second local'); server.seed(chapter, 'second remote'); await a.engine.run();
  await control.resolve(conflicts(a)[0].id, 'remote');
  assert.equal(a.text(chapter), 'second remote');
  assert.ok(Object.values(a.local.state.conflicts).some(c => unpack(c.local)?.toString() === 'second local'));
  await control.recovery();
  assert.ok(fs.existsSync(path.join(a.local.dir, 'recovery')));
});
test('review cannot accept a stale remote conflict version', async t => {
  const { server, device } = fixtures(t), a = device('a');
  a.write(chapter, 'local'); server.seed(chapter, 'remote'); await a.engine.run();
  const c = conflicts(a)[0], control = controller(t, a);
  server.seed(chapter, 'newer remote');
  await assert.rejects(control.resolve(c.id, 'remote'), /changed/);
  assert.equal(a.text(chapter), 'local');
  await a.engine.run(); assert.ok(conflicts(a).some(item => unpack(item.remote).toString() === 'newer remote'));
});
test('restoring local text after deletion clears tombstone conditionally', async t => {
  const { device, server } = fixtures(t), a = device('a'), b = device('b');
  a.write(chapter, 'base'); await a.engine.run(); await b.engine.run();
  a.local.prepareDeletion([chapter]); fs.unlinkSync(a.local.file(chapter)); await a.engine.run();
  b.write(chapter, 'saved offline'); await b.engine.run();
  const control = controller(t, b); await control.resolve(conflicts(b)[0].id, 'local');
  assert.equal(server.text(chapter), 'saved offline');
  assert.equal(JSON.parse(server.text(markerPath(chapter))).deleted, false);
  await a.engine.run(); assert.equal(a.text(chapter), 'saved offline');
});
test('disconnect drains the current request and stops remaining transfers', async t => {
  const { device, server } = fixtures(t), a = device('a');
  a.write(chapter, 'first'); a.write(other, 'second');
  const control = controller(t, a);
  let disconnect;
  server.afterPut = () => { disconnect = control.disconnect(); };
  await control.run(); await disconnect;
  assert.equal(server.calls.length, 1); assert.equal(control.info().state, 'local');
});
test('case-colliding filenames fail before uploads or local replacement', async t => {
  const { device, server } = fixtures(t), a = device('a');
  a.write(chapter, 'local'); server.seed('book-a/chapters/A.html', 'remote');
  await assert.rejects(a.engine.run(), /case/); assert.equal(server.calls.length, 0); assert.equal(a.text(chapter), 'local');
});
test('Login Flow v2 keeps app password in main process and pins endpoints to installation', async t => {
  const { device } = fixtures(t), a = device('a'), control = controller(t, a);
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const calls = [], server = 'https://example.com/cloud/';
  let waiting = true;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/index.php/login/v2')) return new Response(JSON.stringify({ login: server + 'login/v2/flow/abc', poll: { endpoint: server + 'login/v2/poll', token: 'opaque' } }));
    if (waiting) { waiting = false; return new Response(null, { status: 404 }); }
    return new Response(JSON.stringify({ server, loginName: 'email@example.com', appPassword: 'private' }));
  };
  assert.equal(await control.login(server), true); assert.equal(await control.loginPoll(), false); assert.equal(await control.loginPoll(), true);
  assert.equal(control.loginSecret.appPassword, 'private'); assert.equal(JSON.stringify(control.info()).includes('private'), false);
  assert.equal(calls[1].options.body, 'token=opaque');
  await assert.rejects(control.test({ server: 'https://other.test', folder: 'Books' }), /selected server/);
});

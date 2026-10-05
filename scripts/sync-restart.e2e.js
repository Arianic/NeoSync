'use strict';
// Real Electron shutdown/restart and OS credential encryption, with a dummy
// Nextcloud transport and an isolated profile. Never contacts a real server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { hash } = require('../sync/model');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neosync-restart-test-'));
  const root = path.join(profile, 'NeoSync Library');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ firstRunDone: true, shelves: [] }));
  const home = path.join(profile, 'NeoSync', 'nextcloud', hash(path.resolve(root)));
  for (const phase of ['connect', 'reopen', 'disconnect']) {
    const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
      env: { ...process.env, NEOSYNC_RESTART_PROFILE: profile, NEOSYNC_RESTART_PHASE: phase },
      encoding: 'utf8', timeout: 45000
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.equal(result.status, 0, result.error?.message || phase + ' failed');
    assert.equal(fs.existsSync(path.join(home, 'connection.json')), phase !== 'disconnect', 'Only confirmed disconnection removes the connection');
    assert.equal(fs.existsSync(path.join(home, 'credentials.bin')), phase !== 'disconnect', 'Only confirmed disconnection removes the credential');
    if (phase !== 'disconnect') assert.equal(fs.readFileSync(path.join(home, 'credentials.bin')).includes('dummy-test-password'), false);
  }
  const events = JSON.parse(fs.readFileSync(path.join(home, 'connection-events.json')));
  assert.equal(events.filter(e => e.event === 'disconnect-requested').length, 1);
  assert.equal(events.filter(e => e.event === 'restored').length, 2);
  assert.equal(JSON.stringify(events).includes('dummy-test-password'), false);
  assert.equal(JSON.stringify(events).includes('nextcloud.invalid'), false);
  console.log('Restart passed: settings dismissal, window close, offline relaunch, and explicit disconnect confirmation.');
} else {
  const electron = require('electron');
  const { app, BrowserWindow } = electron;
  const profile = process.env.NEOSYNC_RESTART_PROFILE;
  const phase = process.env.NEOSYNC_RESTART_PHASE;
  assert.ok(profile && phase, 'Run this test through Node to create an isolated profile');
  app.setPath('appData', profile);
  app.setPath('documents', profile);
  global.fetch = async (url, options) => {
    assert.ok(url.startsWith('https://nextcloud.invalid/'), 'Only the dummy server is allowed');
    if (phase !== 'connect') throw new Error('Offline test');
    if (url.includes('/ocs/v1.php/')) return new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data: { id: 'writer' } } }));
    if (options.method === 'MKCOL') return new Response(null, { status: 201 });
    if (options.method === 'PROPFIND') return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>' + new URL(url).pathname + '</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>', { status: 207 });
    if (options.method === 'PUT') return new Response(null, { status: 201, headers: { ETag: '"dummy-etag"' } });
    throw new Error('Unexpected dummy request');
  };
  function HiddenWindow(options) {
    const win = new BrowserWindow({ ...options, show: false });
    win.loadFile = (file, opts) => BrowserWindow.prototype.loadFile.call(win, path.resolve(__dirname, '..', file), opts);
    return win;
  }
  Object.setPrototypeOf(HiddenWindow, BrowserWindow);
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function (id, parent, isMain) {
    if (id === 'electron' && parent?.filename === path.resolve(__dirname, '../main.js')) return { ...electron, BrowserWindow: HiddenWindow };
    return originalLoad.call(this, id, parent, isMain);
  };
  require('../main');
  Module._load = originalLoad;
  const timeout = setTimeout(() => { console.error('Restart test timed out'); app.exit(1); }, 30000);
  app.whenReady().then(async () => {
    try {
      const tick = () => new Promise(resolve => setTimeout(resolve, 50));
      let win;
      while (!(win = BrowserWindow.getAllWindows()[0])) await tick();
      const js = code => win.webContents.executeJavaScript(code, true);
      while (!(await js('typeof library !== "undefined" && !!library').catch(() => false))) await tick();
      if (phase === 'connect') {
        const info = await js('window.neo.sync("connect", {server:"https://nextcloud.invalid/",folder:"NeoSync",loginName:"writer",appPassword:"dummy-test-password",singleSync:true})');
        assert.equal(info.error, undefined);
        assert.equal(info.connected, true);
        assert.equal(info.state, 'pending');
        await js('showSyncSettings()');
        await js('[...document.querySelectorAll(".sync-modal button")].find(b => b.textContent === "Close").click()');
        assert.equal((await js('window.neo.sync("status")')).connected, true);
        await js('showSyncSettings()');
        await js('void [...document.querySelectorAll(".sync-modal button")].find(b => b.textContent === "Disconnect").click()');
        assert.equal(await js('document.querySelector(".modal-backdrop:last-child h2").textContent'), 'Disconnect Nextcloud?');
        assert.equal((await js('window.neo.sync("status")')).connected, true);
        await js('document.querySelector(".modal-backdrop:last-child .m-cancel").click()');
        assert.equal((await js('window.neo.sync("status")')).connected, true);
        await js('showSyncSettings()');
        await js('document.querySelector(".sync-dialog input").dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))');
        assert.equal((await js('window.neo.sync("status")')).connected, true);
      } else {
        const info = await js('window.neo.sync("status")');
        assert.equal(info.error, undefined);
        assert.equal(info.connected, true, 'Restores the account with real OS decryption in a new process');
        assert.equal(info.server, 'https://nextcloud.invalid/');
        assert.equal((await js('window.neo.sync("now")')).state, 'offline');
        if (phase === 'disconnect') {
          await js('showSyncSettings()');
          await js('window.disconnectTest = [...document.querySelectorAll(".sync-modal button")].find(b => b.textContent === "Disconnect").onclick(); void 0');
          await js('document.querySelector(".modal-backdrop:last-child .fr-choice").click()');
          await js('window.disconnectTest');
          assert.equal((await js('window.neo.sync("status")')).connected, false);
        }
      }
      await js('showSyncSettings()');
      console.log('App restart phase passed: ' + phase);
      clearTimeout(timeout);
      win.close(); // normal OS-window close, with settings still open
      if (process.platform === 'darwin') app.quit();
    } catch (err) { console.error(err); clearTimeout(timeout); app.exit(1); }
  });
}

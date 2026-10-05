'use strict';
// Real Electron/preload/editor smoke test. No credentials or network required.
// All app data, settings and manuscripts are confined to this temporary root.
const electron = require('electron');
const { app } = electron;
app.disableHardwareAcceleration(); // deterministic capture in hidden test windows
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neosync-desktop-test-'));
app.setPath('appData', tmp);
app.setPath('documents', tmp);
const OriginalWindow = electron.BrowserWindow;
function HiddenWindow(options) {
  const win = new OriginalWindow({ ...options, show: false });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer:', event.message); });
  win.webContents.on('did-fail-load', (_event, code, description) => console.error('Load:', code, description));
  win.loadFile = (file, opts) => OriginalWindow.prototype.loadFile.call(win, path.resolve(__dirname, '..', file), opts);
  return win;
}
Object.setPrototypeOf(HiddenWindow, OriginalWindow);
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'electron' && parent?.filename === path.resolve(__dirname, '../main.js')) return { ...electron, BrowserWindow: HiddenWindow };
  return originalLoad.call(this, id, parent, isMain);
};
const root = path.join(tmp, 'NeoSync Library');
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ firstRunDone: true, authorName: '', shelves: [{ id: 'shelf-1', name: 'Tests', bookIds: [] }] }));
require('../main');
Module._load = originalLoad;
const tick = () => new Promise(resolve => setTimeout(resolve, 50));
const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  try {
    console.log('Electron ready; profile:', tmp);
    let win;
    while (!(win = OriginalWindow.getAllWindows()[0])) await tick();
    console.log('Test window created');
    const js = code => win.webContents.executeJavaScript(code, true);
    let tries = 0;
    while (!(await js('typeof library !== "undefined" && !!library').catch(() => false))) {
      await tick();
      if (++tries === 100) console.log('Page state:', await js('({url: location.href, ready: document.readyState, bridge: !!window.neo, library: typeof library})').catch(err => err.message));
    }
    console.log('Library initialized');
    const output = path.resolve(__dirname, '../dist/sync-ui'); fs.mkdirSync(output, { recursive: true });
    win.setSize(1100, 900);
    let current = { state: 'local', connected: false, configured: false, server: '', folder: 'NeoSync', credentials: { available: true }, conflicts: [] };
    let loginPolls = 0, connects = 0, failLogin = false, failStatus = false;
    electron.ipcMain.removeHandler('sync:action');
    electron.ipcMain.handle('sync:action', async (_event, action, value) => {
      if (action === 'status' && failStatus) return { error: 'Sync could not initialize.' };
      if (action === 'login') return failLogin ? { error: 'Browser could not open. Try again.' } : true;
      if (action === 'loginPoll') { loginPolls++; return true; }
      if (action === 'connect') {
        assert.equal(value.singleSync, true); assert.equal(value.folder, 'NeoSync');
        assert.equal(value.appPassword, connects === 0 ? '' : 'dummy-manual-password'); connects++;
        current = { ...current, connected: true, configured: true, state: 'pending', server: value.server };
      }
      return current;
    });
    const shot = async name => {
      await tick();
      const rect = await js('(() => { const r=document.querySelector(".sync-modal").getBoundingClientRect(); return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}; })()');
      fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(rect)).toPNG());
    };
    const primary = '.sync-footer .btn-gold';
    const clickPrimary = () => js(`document.querySelector('${primary}').click()`);
    const status = value => js(`showSyncStatus(${JSON.stringify(value)})`);
    await js('showSyncSettings()');
    assert.equal(await js(`document.querySelector('${primary}').disabled`), true);
    assert.equal(await js('document.querySelector(".sync-disclosure").open'), false);
    await js('document.querySelector(".sync-dialog input[type=url]").value="https://cloud.example.com"; document.querySelector(".sync-dialog input[type=url]").dispatchEvent(new Event("input"))');
    await shot('setup-dark');
    await clickPrimary(); await tick();
    assert.equal(await js('document.querySelector(".sync-state strong").textContent'), 'Waiting for browser approval');
    await shot('browser-approval');
    await status(current); // background status cannot erase the browser step
    assert.equal(await js('document.querySelector(".sync-state strong").textContent'), 'Waiting for browser approval');
    while (await js(`document.querySelector('${primary}').textContent !== 'Connect'`)) await tick();
    assert.equal(loginPolls, 1);
    assert.equal(await js(`document.querySelector('${primary}').disabled`), true);
    await js('document.querySelector(".sync-check input").click()');
    assert.equal(await js(`document.querySelector('${primary}').disabled`), false);
    await shot('confirm-folder');
    await clickPrimary(); await tick();
    assert.equal(connects, 1);
    assert.equal(await js('document.querySelector(".sync-account").hidden'), false);
    assert.equal(await js(`document.querySelector('${primary}').textContent`), 'Sync now');
    current = { ...current, state: 'synced' }; await status(current); await shot('connected-dark');
    await js('document.body.classList.add("light")'); await shot('connected-light');
    await js('document.body.classList.remove("light")');
    const locked = { ...current, connected: false, state: 'error', message: 'Unlock the keyring.', credentials: { available: false, platform: 'linux', message: 'Unlock the keyring.' } };
    await status(locked); await shot('locked-keyring');
    assert.equal(await js(`document.querySelector('${primary}').disabled`), true);
    assert.equal(await js('document.querySelector(".sync-protection").hidden'), false);
    assert.equal(await js('document.querySelector(".sync-state p").textContent.includes("Unlock the keyring.")'), false);
    await js('document.querySelector(".sync-protection button").click()'); await tick();
    assert.equal(await js('document.querySelector(".sync-protection").hidden'), true);
    await status({ ...current, state: 'offline' }); await shot('offline');
    await status({ ...current, state: 'conflict', conflicts: [{ id: 'test', path: 'book-example/chapters/one.html' }] });
    await js('document.querySelector(".sync-conflict").open=true'); await shot('conflict');
    win.setSize(660, 620);
    await js('document.documentElement.style.setProperty("--ui-zoom", "1.3")');
    await tick();
    assert.equal(await js('(() => {const r=document.querySelector(".sync-modal").getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;})()'), true);
    await js('document.querySelector(".sync-dialog").close()');
    current = { state: 'local', connected: false, configured: false, server: '', folder: 'NeoSync', credentials: { available: true }, conflicts: [] };
    win.setSize(1100, 900); await js('document.documentElement.style.setProperty("--ui-zoom", "1")');
    await js('showSyncSettings()');
    await js('document.querySelector(".sync-dialog input[type=url]").value="https://cloud.example.com";document.querySelector(".sync-dialog input[type=url]").dispatchEvent(new Event("input"))');
    failLogin = true; await clickPrimary(); await tick();
    assert.match(await js('document.querySelector(".sync-notice").textContent'), /Browser could not open/);
    assert.equal(await js(`document.querySelector('${primary}').disabled`), false);
    await js('document.querySelector(".sync-disclosure").open=true'); await tick();
    await shot('manual-fallback');
    assert.equal(await js(`document.querySelector('${primary}').disabled`), true);
    await js('document.querySelector(".sync-dialog input[autocomplete=username]").value="writer";document.querySelector(".sync-dialog input[type=password]").value="dummy-manual-password";document.querySelector(".sync-dialog input[type=password]").dispatchEvent(new Event("input"))');
    await clickPrimary(); await tick();
    assert.equal(await js(`document.querySelector('${primary}').textContent`), 'Connect');
    await js('document.querySelector(".sync-check input").click()'); await clickPrimary(); await tick();
    assert.equal(connects, 2);
    assert.equal(await js('document.querySelector(".sync-dialog input[type=password]").value'), '');
    await js('document.querySelector(".sync-dialog").close()');
    failStatus = true;
    await js('showSyncSettings()');
    assert.equal(await js('document.querySelector(".sync-state strong").textContent'), 'Sync is unavailable');
    assert.equal(await js('document.querySelector(".sync-protection").hidden'), true);
    assert.equal(await js(`document.querySelector('${primary}').disabled`), true);
    await js('document.querySelector(".sync-dialog").close()');
    await js('document.querySelectorAll(".sync-dialog").forEach(dialog => dialog.close())');
    const dialogsBeforeUpdate = await js('document.querySelectorAll(".modal-backdrop").length');
    await js('updateMessage({state:"ready",ready:true,latestVersion:"99.0.0"})');
    assert.equal(await js('document.querySelectorAll(".modal-backdrop").length'), dialogsBeforeUpdate, 'Background updates do not open a dialog');
    assert.equal(await js('document.querySelector("#update-chip").textContent'), 'Update ready');
    electron.ipcMain.removeHandler('update:check');
    electron.ipcMain.handle('update:check', () => ({state:'ready',ready:true,canInstall:true,hasUpdate:true,latestVersion:'99.0.0',currentVersion:'1.3.3-beta.3'}));
    await js('document.querySelector("#update-chip").onclick()');
    assert.equal(await js('updateDialog.querySelector(".m-ok").textContent'), 'Restart to update');
    await tick();
    await js('updateDialog.close()');
    console.log('Sync and update UI passed: guided login, validation, status, keyring retry, manual fallback, viewport/themes, quiet update indicator and explicit restart.');
    clearTimeout(timeout); app.exit(0);
  } catch (err) { console.error(err); clearTimeout(timeout); app.exit(1); }
});

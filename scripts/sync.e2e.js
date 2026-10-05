'use strict';
// Real Electron/preload/editor smoke test. No credentials or network required.
// All app data, settings and manuscripts are confined to this temporary root.
const electron = require('electron');
const { app } = electron;
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
    assert.equal(await js('window.neo.libraryPath()'), root);
    assert.equal((await js('window.neo.checkForUpdate()')).disabled, true);
    assert.equal((await js('window.neo.sync("status")')).state, 'local');
    await js('showSyncSettings()');
    assert.equal(await js('document.querySelector(".sync-dialog h2").textContent'), 'Nextcloud Sync');
    assert.equal(await js('document.querySelector(".sync-dialog input[type=password]").type'), 'password');
    assert.equal(await js('document.querySelector(".sync-dialog input[type=checkbox]").checked'), false);
    await js('document.querySelector(".sync-dialog").close()');
    await js(`(async () => {
      await addImportedBooks([{ name: 'Temporary manuscript', chapters: [{ title: 'One', paras: [{ text: 'Original words' }] }] }], library.shelves[0]);
      await openBook(library.shelves[0].bookIds[0]);
      chapterHTML[book.chapterOrder[0]] = '<p>Offline autosave survives.</p>';
      await persistChapter(book.chapterOrder[0]);
    })()`);
    const ids = await js('({ book: book.id, chapter: book.chapterOrder[0] })');
    assert.equal(fs.readFileSync(path.join(root, ids.book, 'chapters', ids.chapter + '.html'), 'utf8'), '<p>Offline autosave survives.</p>');
    win.webContents.send('menu', { type: 'syncPrepare', token: 'editor-test' });
    await tick(); assert.equal(await js('document.body.inert'), false);
    await js('backToShelf()');
    win.webContents.send('menu', { type: 'syncPrepare', token: 'shelf-test' });
    await tick(); assert.equal(await js('document.body.inert'), true);
    win.webContents.send('menu', { type: 'syncApplied', token: 'shelf-test' });
    await tick(); assert.equal(await js('document.body.inert'), false);
    assert.ok(app.getPath('userData').startsWith(tmp + path.sep));
    console.log('Desktop smoke passed: identity, settings, preload, offline save, editor/shelf apply handoff.');
    console.log('Temporary profile retained until Electron exits: ' + tmp);
    clearTimeout(timeout); app.exit(0);
  } catch (err) { console.error(err); clearTimeout(timeout); app.exit(1); }
});

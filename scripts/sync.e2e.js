'use strict';
// Real Electron/preload/editor smoke test. No credentials or network required.
// All app data, settings and manuscripts are confined to this temporary root.
const electron = require('electron');
const { app } = electron;
const registered = new Map();
const register = electron.ipcMain.handle.bind(electron.ipcMain);
electron.ipcMain.handle = (channel, handler) => { registered.set(channel, handler); register(channel, handler); };
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
const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 120000);
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
    // A failed or slow save must never be overtaken by an update restart.
    await js(`openBook(${JSON.stringify(ids.book)})`);
    let installs = 0;
    electron.ipcMain.removeHandler('update:install');
    register('update:install', () => { installs++; return false; });
    const realWrite = registered.get('chapter:write');
    electron.ipcMain.removeHandler('chapter:write');
    register('chapter:write', async () => { throw new Error('Test disk failure'); });
    await js(`chapterHTML[book.chapterOrder[0]] = '<p>Words waiting for disk.</p>';
      updateDialog = updateDialogBox({latestVersion:'99.0.0',currentVersion:'1.3.3-beta.3'});
      updateDialogShow('ready');
      document.querySelector('.modal-backdrop .m-ok').onclick();`);
    assert.equal(installs, 0);
    assert.equal(await js('document.body.inert'), false);
    assert.match(await js('document.querySelector(".up-text").textContent'), /still open/);
    let finishWrite, startedWrite;
    const waitingForWrite = new Promise(resolve => { startedWrite = resolve; });
    electron.ipcMain.removeHandler('chapter:write');
    register('chapter:write', (...args) => new Promise(resolve => {
      finishWrite = async () => resolve(await realWrite(...args));
      startedWrite();
    }));
    await js('window.restartTest = document.querySelector(".modal-backdrop .m-ok").onclick(); void 0');
    await waitingForWrite;
    assert.equal(installs, 0);
    assert.equal(await js('document.body.inert'), true);
    await finishWrite(); await js('window.restartTest');
    electron.ipcMain.removeHandler('chapter:write');
    register('chapter:write', realWrite);
    assert.equal(installs, 1);
    assert.equal(fs.readFileSync(path.join(root, ids.book, 'chapters', ids.chapter + '.html'), 'utf8'), '<p>Words waiting for disk.</p>');
    assert.equal(await js('document.body.inert'), false);
    await js('updateDialog.close()');
    // Work already in a renderer queue must be awaited even when savedHTML
    // matches the latest text and a second flush creates no new chapter write.
    const holdWrite = channel => {
      const real = registered.get(channel);
      let release, begin;
      const began = new Promise(resolve => { begin = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      electron.ipcMain.removeHandler(channel);
      register(channel, async (...args) => { begin(); await gate; return real(...args); });
      return { began, release, restore() { electron.ipcMain.removeHandler(channel); register(channel, real); } };
    };
    const queuedChapter = holdWrite('chapter:write');
    await js(`chapterHTML[book.chapterOrder[0]] = '<p>A queued chapter save.</p>';
      window.queuedChapterSave = persistChapter(book.chapterOrder[0]); void 0;`);
    await queuedChapter.began;
    const readyDialog = `updateDialog = updateDialogBox({latestVersion:'99.0.0',currentVersion:'1.3.3-beta.6'}); updateDialogShow('ready');`;
    await js(readyDialog + 'window.restartTest = updateDialog.querySelector(".m-ok").onclick(); void 0;');
    await tick(); assert.equal(installs, 1);
    queuedChapter.release(); await js('window.restartTest'); queuedChapter.restore();
    assert.equal(installs, 2);
    await js('updateDialog.close()');

    // Notes and JSON sidecars are serialized per file and included in restart.
    await js('switchTab("notes")'); await tick();
    const notes = holdWrite('aux:write'), sidecar = holdWrite('json:write');
    await js(`document.querySelector('#aux-editor').innerHTML = '<p>First notes.</p>'; auxDirty = true;
      window.firstNotes = flushAux();
      window.firstSidecar = writeSidecar(book.id, 'darlings', [{id:'queue-test', text:'First copy'}]); void 0;`);
    await Promise.all([notes.began, sidecar.began]);
    await js(`document.querySelector('#aux-editor').innerHTML = '<p>Latest notes.</p>'; auxDirty = true;
      window.latestNotes = flushAux();
      window.latestSidecar = writeSidecar(book.id, 'darlings', [{id:'queue-test', text:'Latest copy'}]); void 0;`);
    await js(readyDialog + 'window.restartTest = updateDialog.querySelector(".m-ok").onclick(); void 0;');
    await tick(); assert.equal(installs, 2);
    notes.release(); await tick(); assert.equal(installs, 2);
    sidecar.release(); await js('window.restartTest'); notes.restore(); sidecar.restore();
    assert.equal(installs, 3);
    assert.equal(fs.readFileSync(path.join(root, ids.book, 'notes.html'), 'utf8'), '<p>Latest notes.</p>');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ids.book, 'darlings.json')))[0].text, 'Latest copy');
    await js('updateDialog.close()');

    // Failure keeps the draft queued, blocks leaving the book and blocks restart.
    electron.ipcMain.removeHandler('aux:write');
    register('aux:write', async () => { throw new Error('Test notes disk failure'); });
    await js(`document.querySelector('#aux-editor').innerHTML = '<p>Notes after retry.</p>'; auxDirty = true;`);
    assert.equal(await js('backToShelf().then(() => false, () => !!book)'), true);
    await js(readyDialog + 'updateDialog.querySelector(".m-ok").onclick();');
    assert.equal(installs, 3);
    assert.equal(await js('document.body.inert'), false);
    assert.equal(await js('Object.keys(auxPending).length > 0'), true);
    notes.restore();
    await js('updateDialog.querySelector(".m-ok").onclick();');
    assert.equal(installs, 4);
    assert.equal(fs.readFileSync(path.join(root, ids.book, 'notes.html'), 'utf8'), '<p>Notes after retry.</p>');
    await js('updateDialog.close()');

    // A real competing disk write reaches the new IPC expected-text check.
    fs.writeFileSync(path.join(root, ids.book, 'chapters', ids.chapter + '.html'), '<p>Competing device words.</p>');
    await js(`chapterHTML[book.chapterOrder[0]] = '<p>Our newer words.</p>'; persistChapter(book.chapterOrder[0]);`);
    const savedBook = JSON.parse(fs.readFileSync(path.join(root, ids.book, 'book.json'), 'utf8'));
    assert.equal(fs.readFileSync(path.join(root, ids.book, 'chapters', ids.chapter + '.html'), 'utf8'), '<p>Our newer words.</p>');
    assert.equal(savedBook.chapterOrder.length, 2);
    assert.equal(fs.readFileSync(path.join(root, ids.book, 'chapters', savedBook.chapterOrder[1] + '.html'), 'utf8'), '<p>Competing device words.</p>');
    // Upstream's new zoom belongs to this device, never a library sync write.
    const libraryBeforeZoom = fs.readFileSync(path.join(root, 'library.json'), 'utf8');
    await js('setPageZoom(1.4); switchTab("outline"); stepCardZoom(1);');
    await js('window.neo.syncDrain()');
    assert.equal(await js('activePageZoom()'), 1.4);
    assert.equal(await js('localStorage.getItem("neo.pageZoom.novel")'), '1.4');
    assert.equal(await js('localStorage.getItem("neo.cardZoom")'), '1.15');
    assert.equal(fs.readFileSync(path.join(root, 'library.json'), 'utf8'), libraryBeforeZoom);
    // Upstream outline cards must reach disk before the bookshelf permits sync.
    await js(`
      switchTab('outline');
      openCard(document.querySelector('#outline-board .ob-cell[data-kind="chapter"]'));
      cardEditor.text.textContent = 'Outline note before leaving the book';
      flushAllSaves('tick');
    `);
    assert.equal(await js('!!cardEditor'), true, 'Background saves must not close a card being edited');
    await js('backToShelf()');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ids.book, 'book.json'), 'utf8')).chapterNotes[ids.chapter], 'Outline note before leaving the book');
    await js(`(async () => {
      await openBook(${JSON.stringify(ids.book)});
      switchTab('outline');
      openCard(document.querySelector('#outline-board .ob-cell[data-kind="chapter"]'));
      cardEditor.text.textContent = 'Outline note before window close';
      flushAllSaves({ type: 'beforeunload' });
      await window.neo.syncDrain();
    })()`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ids.book, 'book.json'), 'utf8')).chapterNotes[ids.chapter], 'Outline note before window close');
    // Last-tab metadata must survive the fork's asynchronous save/exit barrier.
    await js('switchTab("manuscript"); focusChapterStart(book.chapterOrder[0]);');
    await js('new Promise(resolve => requestAnimationFrame(resolve))');
    await js('switchTab("notes"); flushAllSaves();');
    const position = JSON.parse(fs.readFileSync(path.join(root, ids.book, 'book.json'), 'utf8')).lastPosition;
    assert.equal(position.tab, 'notes');
    assert.equal(position.chapterId, ids.chapter);
    await js('backToShelf()');
    await js(`openBook(${JSON.stringify(ids.book)})`);
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await js('currentTab'), 'notes');
    assert.equal(await js('activePageZoom()'), 1.4);
    await js('backToShelf()');
    const prepareSync = token => new Promise(resolve => {
      const listener = (_e, responseToken, ready) => {
        if (responseToken !== token) return;
        electron.ipcMain.removeListener('sync:ready', listener); resolve(ready);
      };
      electron.ipcMain.on('sync:ready', listener);
      win.webContents.send('menu', { type: 'syncPrepare', token });
    });
    // A failed queued sidecar on the shelf must also block incoming sync.
    electron.ipcMain.removeHandler('json:write');
    register('json:write', async () => { throw new Error('Test sidecar disk failure'); });
    await js(`writeSidecar(${JSON.stringify(ids.book)}, 'darlings', [{id:'shelf-queued',text:'Keep this copy'}]).catch(() => {});`);
    assert.equal(await prepareSync('failed-sidecar'), false);
    win.webContents.send('menu', { type: 'syncApplied', token: 'failed-sidecar' }); await tick();
    sidecar.restore();
    assert.equal(await prepareSync('shelf-test'), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ids.book, 'darlings.json')))[0].text, 'Keep this copy');
    assert.equal(await js('document.body.inert'), true);
    win.webContents.send('menu', { type: 'syncApplied', token: 'shelf-test' });
    await tick(); assert.equal(await js('document.body.inert'), false);
    // The shelf export's read phase must exclude incoming sync and restart.
    const exportRead = holdWrite('book:readMeta');
    electron.ipcMain.removeHandler('export:save'); register('export:save', () => false);
    await js(`window.exportTest = exportFromShelf(${JSON.stringify(ids.book)}, 'txt'); void 0;`);
    await exportRead.began;
    assert.equal(await prepareSync('during-export'), false);
    await js(readyDialog + 'updateDialog.querySelector(".m-ok").onclick();');
    assert.equal(installs, 4);
    exportRead.release(); await js('window.exportTest'); exportRead.restore();
    await js('updateDialog.close()');
    assert.equal(await js('book === null && !shelfExport'), true);
    // Duplication waits for queued sidecars, and excludes incoming sync/restarts.
    const copyNotes = holdWrite('aux:write');
    await js(`auxPending[${JSON.stringify(ids.book)} + '/notes'] = {bookId:${JSON.stringify(ids.book)},kind:'notes',html:'<p>Latest notes in copy</p>',inFlight:false}; window.copyNoteSave = flushAux(); void 0;`);
    await copyNotes.began;
    await js(`window.copyTest = duplicateBook({id:${JSON.stringify(ids.book)},title:'Temporary manuscript'}); void 0;`);
    await tick();
    assert.equal(await js('duplicatingBook'), true);
    assert.equal(await prepareSync('during-copy'), false);
    await js(readyDialog + 'updateDialog.querySelector(".m-ok").onclick();');
    assert.equal(installs, 4);
    copyNotes.release(); await js('window.copyTest'); copyNotes.restore();
    await js('updateDialog.close()');
    const copiedId = await js(`library.shelves.flatMap(s => s.bookIds).find(id => id !== ${JSON.stringify(ids.book)})`);
    assert.ok(copiedId && copiedId !== ids.book);
    assert.equal(fs.readFileSync(path.join(root, copiedId, 'notes.html'), 'utf8'), '<p>Latest notes in copy</p>');
    assert.equal(await js('duplicatingBook'), false);
    // Paperback setup and rendering keep the book open and block restart.
    await js(`openBook(${JSON.stringify(ids.book)})`);
    electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(tmp, 'paperback.pdf') });
    await js('window.printTest = printPaperback(); void 0;');
    for (let i = 0; i < 100 && !(await js('!!document.querySelector(".print-modal")')); i++) await tick();
    assert.equal(await js('paperbackActive'), true);
    await js('backToShelf()');
    assert.equal(await js('!!book'), true);
    await js(readyDialog + 'updateDialog.querySelector(".m-ok").onclick();');
    assert.equal(installs, 4);
    await js('updateDialog.close(); document.querySelector(".print-modal .m-ok").click();');
    await js('window.printTest');
    assert.equal(await js('paperbackActive'), false);
    for (const file of ['paperback.pdf', 'paperback - cover template.pdf']) {
      const pdf = fs.readFileSync(path.join(tmp, file));
      assert.ok(pdf.length > 1000, file);
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    }
    await js('backToShelf()');
    assert.ok(app.getPath('userData').startsWith(tmp + path.sep));
    console.log('Desktop smoke passed: identity, queued saves/retries, conflict copies, restart/sync barriers, shelf export, outline-card flush, local zoom and last-tab restore.');
    console.log('Temporary profile retained until Electron exits: ' + tmp);
    clearTimeout(timeout); app.exit(0);
  } catch (err) { console.error(err); clearTimeout(timeout); app.exit(1); }
});

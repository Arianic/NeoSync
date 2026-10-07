const { contextBridge, ipcRenderer, webUtils } = require('electron');

const saves = new Set();
function invoke(channel, ...args) {
  const pending = ipcRenderer.invoke(channel, ...args);
  if (/^(library|book|chapter|aux|json|cover):/.test(channel)) {
    saves.add(pending);
    pending.then(() => saves.delete(pending), () => saves.delete(pending));
  }
  return pending;
}

contextBridge.exposeInMainWorld('neo', {
  sync: (action, value) => invoke('sync:action', action, value),
  syncReady: (token, value) => ipcRenderer.send('sync:ready', token, value),
  syncDrain: async () => { while (saves.size) await Promise.all([...saves]); },
  readLibrary: () => invoke('library:read'),
  writeLibrary: (data) => invoke('library:write', data),

  createBook: (meta) => invoke('book:create', meta),
  listBooks: () => invoke('library:listBooks'),
  readBookMeta: (bookId) => invoke('book:readMeta', bookId),
  writeBookMeta: (bookId, meta) => invoke('book:writeMeta', bookId, meta),
  deleteBook: (bookId, title) => invoke('book:delete', bookId, title),

  readChapter: (bookId, chId) => invoke('chapter:read', bookId, chId),
  chapterStamps: (bookId) => invoke('chapter:stamps', bookId),
  writeChapter: (bookId, chId, html, expected) => invoke('chapter:write', bookId, chId, html, expected),
  deleteChapter: (bookId, chId) => invoke('chapter:delete', bookId, chId),

  readAux: (bookId, name) => invoke('aux:read', bookId, name),
  writeAux: (bookId, name, html) => invoke('aux:write', bookId, name, html),

  readJSON: (bookId, name, fallback) => invoke('json:read', bookId, name, fallback),
  writeJSON: (bookId, name, data) => invoke('json:write', bookId, name, data),

  exportSave: (payload) => invoke('export:save', payload),
  emailDraft: (payload) => invoke('email:draft', payload),
  logError: (msg) => invoke('log:error', msg),
  importPick: () => invoke('import:pick'),
  libraryPath: () => invoke('library:path'),
  pickCover: () => invoke('cover:pick'),
  setCover: (bookId, srcPath) => invoke('cover:set', bookId, srcPath),
  removeCover: (bookId) => invoke('cover:remove', bookId),
  readCover: (bookId, fname) => invoke('cover:read', bookId, fname),
  paintCover: (bookId, text, options) => invoke('cover:paint', bookId, text, options),
  setSecret: (name, value) => invoke('secret:set', name, value),
  hasSecret: (name) => invoke('secret:has', name),
  importFiles: (paths) => invoke('import:files', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fullscreenEscape: () => invoke('fullscreen:escape'),
  fullscreenToggle: () => invoke('fullscreen:toggle'),
  checkForUpdate: () => invoke('update:check'),
  installUpdate: () => invoke('update:install'),
  spellCheckWords: (words) => invoke('spell:check', words),
  spellSuggest: (word) => invoke('spell:suggest', word),
  spellLearn: (word) => invoke('spell:learn', word),
  setSpellLanguage: (code) => invoke('spell:setLanguage', code),
  appVersion: () => invoke('app:version'),
  openRelease: () => invoke('update:openRelease'),

  poetryState: (on) => ipcRenderer.send('poetry:state', on),
  flushState: (on) => ipcRenderer.send('flush:state', on),
  scriptState: (st) => ipcRenderer.send('script:state', st),
  // sent (and waited for) as a script line is right-clicked, so the menu
  // that opens next can offer Page Break Here
  scriptContext: (st) => ipcRenderer.sendSync('script:context', st),
  typewriterState: (st) => ipcRenderer.send('typewriter:state', st),
  vimState: (on) => ipcRenderer.send('vim:state', on),
  uiZoomState: (z) => ipcRenderer.send('uizoom:state', z),
  // interface language, fetched once before the page's scripts run
  i18n: ipcRenderer.sendSync('i18n:get'),
  paper: ipcRenderer.sendSync('paper:get'),
  reloadForLanguage: () => invoke('i18n:reload'),

  writingStyleState: (st) => ipcRenderer.send('style:state', st),
  viewState: (st) => ipcRenderer.send('view:state', st),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});

'use strict';

// Keys the editor answers itself, shown in the Format menu (#372): macOS and
// Linux show them as the system shows a shortcut, unregistered so the key
// still reaches the page; Windows spells the key out after a tab. (Linux
// stands for both of the first two: they share one branch. macOS's menu is
// reached through the Objective-C runtime, which a test can't stand in for.)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function formatMenu(platform) {
  let menu = null;
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {}, name: 'NEO' },
    ipcMain: { on() {}, handle() {} },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu: (m) => { menu = m; } },
    MenuItem: function MenuItem() {},
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root, process: { platform, on() {}, env: {} }, console
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  vm.runInContext('buildMenu()', context);
  return menu.find((m) => m.label === 'Format').submenu;
}
const item = (items, start) => items.find((i) => i.label && i.label.startsWith(start));

describe('Format → Flush Paragraph and Poetry Paragraph', () => {
  for (const platform of ['linux']) {
    test(`${platform}: shown as shortcuts, not registered`, () => {
      const items = formatMenu(platform);
      const flush = item(items, 'Flush Paragraph');
      const poetry = item(items, 'Poetry Paragraph');
      assert.equal(flush.label, 'Flush Paragraph');
      assert.equal(flush.accelerator, 'Shift+Enter');
      assert.equal(flush.registerAccelerator, false);
      assert.equal(poetry.label, 'Poetry Paragraph');
      assert.equal(poetry.accelerator, 'CmdOrCtrl+Shift+Enter');
      assert.equal(poetry.registerAccelerator, false);
    });
  }
  test('win32: the key is spelled out after a tab, with no accelerator to register', () => {
    const items = formatMenu('win32');
    assert.equal(item(items, 'Flush Paragraph').label, 'Flush Paragraph\tShift+Enter');
    assert.equal(item(items, 'Poetry Paragraph').label, 'Poetry Paragraph\tCtrl+Shift+Enter');
    assert.equal(item(items, 'Flush Paragraph').accelerator, undefined);
  });
});

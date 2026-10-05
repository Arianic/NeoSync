'use strict';
// Run in a disposable Linux D-Bus/keyring session; see LINUX.md. Uses dummy
// credentials only and a distinct application key, never a Nextcloud server.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { Credentials } = require('../sync/credentials');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neosync-keyring-test-'));
app.setName('NeoSync Keyring Test');
app.setPath('userData', dir);
const timeout = setTimeout(() => { console.error('Keyring test timed out'); app.exit(1); }, 30000);
app.whenReady().then(() => {
  try {
    assert.equal(process.platform, 'linux', 'This integration test requires Linux');
    const expected = process.env.NEOSYNC_EXPECT_KEYRING || 'gnome_libsecret';
    assert.equal(safeStorage.getSelectedStorageBackend(), expected);
    const file = path.join(dir, 'credential.bin');
    const credentials = new Credentials(file, safeStorage);
    if (expected === 'basic_text') {
      assert.equal(credentials.available(), false);
      assert.throws(() => credentials.save({ appPassword: 'dummy-test-password' }), /unavailable/);
      assert.equal(fs.existsSync(file), false);
    } else {
      assert.equal(credentials.available(), true);
      credentials.save({ appPassword: 'dummy-test-password' });
      assert.equal(fs.readFileSync(file).includes('dummy-test-password'), false);
      assert.equal(new Credentials(file, safeStorage).read().appPassword, 'dummy-test-password');
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      credentials.remove();
    }
    console.log('Linux keyring test passed: ' + expected);
    clearTimeout(timeout); app.exit(0);
  } catch (err) { console.error(err); clearTimeout(timeout); app.exit(1); }
});

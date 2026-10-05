'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Credentials } = require('../sync/credentials');
const { DesktopSync } = require('../sync/desktop');
const { durable } = require('../sync/storage');
const { configurePasswordStore } = require('../sync/password-store');

test('unknown Linux desktops select Secret Service without changing native desktops or explicit choices', () => {
  function selected(platform, env, override) {
    const switches = new Map(override === undefined ? [] : [['password-store', override]]);
    configurePasswordStore({ commandLine: {
      hasSwitch: name => switches.has(name),
      appendSwitch: (name, value) => switches.set(name, value)
    } }, platform, env);
    return switches.get('password-store');
  }
  for (const env of [{}, { XDG_CURRENT_DESKTOP: 'NeoSyncTestWM' }, { DESKTOP_SESSION: 'custom-wayland' }]) {
    assert.equal(selected('linux', env), 'gnome-libsecret');
    for (const platform of ['win32', 'darwin']) assert.equal(selected(platform, env), undefined);
    for (const override of ['basic', 'gnome-libsecret', 'kwallet6', '']) assert.equal(selected('linux', env, override), override);
  }
  for (const env of [
    { XDG_CURRENT_DESKTOP: 'GNOME' }, { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' },
    { XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' },
    { XDG_CURRENT_DESKTOP: 'custom:KDE' }, { XDG_CURRENT_DESKTOP: 'LXQt' },
    { KDE_FULL_SESSION: 'true' }, { KDE_SESSION_VERSION: '5' },
    { DESKTOP_SESSION: 'plasmawayland' }, { DESKTOP_SESSION: 'kde4' },
    { DESKTOP_SESSION: 'mate' }, { DESKTOP_SESSION: 'xfce' }
  ]) assert.equal(selected('linux', env), undefined);
});

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neosync-linux-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const provider = backend => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => backend,
  encryptString: text => Buffer.from(text).reverse(),
  decryptString: bytes => Buffer.from(bytes).reverse().toString()
});

test('Linux accepts GNOME and each supported KDE Wallet backend', t => {
  const dir = directory(t);
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
    const file = path.join(dir, backend + '.bin');
    const credentials = new Credentials(file, provider(backend), 'linux');
    credentials.save({ appPassword: 'test-only-password' });
    assert.equal(credentials.protection().backend, backend);
    assert.equal(new Credentials(file, provider(backend), 'linux').read().appPassword, 'test-only-password');
    assert.equal(fs.readFileSync(file).includes('test-only-password'), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});
test('Linux rejects absent, unknown and plaintext providers without replacing existing credentials', t => {
  const dir = directory(t), file = path.join(dir, 'credential.bin');
  const good = new Credentials(file, provider('gnome_libsecret'), 'linux');
  good.save({ appPassword: 'retain-me' });
  const original = fs.readFileSync(file);
  for (const backend of ['basic_text', 'unknown', undefined, 'unexpected']) {
    const credentials = new Credentials(file, provider(backend), 'linux');
    assert.equal(credentials.available(), false);
    assert.match(credentials.protection().message, /GNOME Keyring or KDE Wallet/);
    assert.throws(() => credentials.save({ appPassword: 'replacement' }), /unavailable/);
    assert.throws(() => credentials.read(), /unavailable/);
    assert.deepEqual(fs.readFileSync(file), original);
  }
});
test('keyring exceptions report unavailability and never enable plaintext storage', t => {
  const file = path.join(directory(t), 'credential.bin');
  const credentials = new Credentials(file, { isEncryptionAvailable() { throw new Error('locked'); } }, 'linux');
  assert.equal(credentials.available(), false);
  assert.throws(() => credentials.save({ appPassword: 'private' }), /unavailable/);
  assert.equal(fs.existsSync(file), false);
  const failedBackend = new Credentials(file, { isEncryptionAvailable: () => true, getSelectedStorageBackend() { throw new Error('unavailable'); } }, 'linux');
  assert.equal(failedBackend.available(), false);
});
test('credential checks use the initialized backend and distinguish selection failure from access failure', t => {
  let backend = 'unknown';
  const safe = { ...provider('unused'),
    isEncryptionAvailable() { backend = 'gnome_libsecret'; return true; },
    getSelectedStorageBackend: () => backend
  };
  const credentials = new Credentials(path.join(directory(t), 'credential.bin'), safe, 'linux');
  assert.equal(credentials.available(), true);
  assert.equal(credentials.protection().backend, 'gnome_libsecret');
  safe.isEncryptionAvailable = () => false;
  assert.match(credentials.protection().message, /cannot access the selected keyring/);
  backend = 'basic_text';
  assert.match(credentials.protection().message, /could not select a keyring/);
  assert.match(credentials.protection().message, /may already be unlocked/);
});
test('Sync now retries an encrypted saved connection after the keyring unlocks', async t => {
  const dir = directory(t), root = path.join(dir, 'library');
  fs.mkdirSync(root);
  let unlocked = false;
  const safe = { ...provider('gnome_libsecret'), isEncryptionAvailable: () => unlocked };
  const control = new DesktopSync({ root, userData: path.join(dir, 'app'), safeStorage: safe, send() {}, shell: {}, foreground: () => false });
  t.after(() => { clearInterval(control.poll); clearTimeout(control.timer); });
  control.credentials.platform = 'linux';
  control.config = { server: 'https://example.test/', folder: 'Books' };
  const secret = { loginName: 'writer', appPassword: 'test-only' };
  durable(control.credentials.file, safe.encryptString(JSON.stringify(secret)));
  const encrypted = fs.readFileSync(control.credentials.file);
  let starts = 0, runs = 0;
  control.start = value => {
    assert.deepEqual(value, secret);
    starts++; control.active = true;
    control.engine = { run: async () => { runs++; control.setStatus('synced'); } };
  };
  assert.equal((await control.run(true)).state, 'error');
  assert.equal(starts, 0); assert.deepEqual(fs.readFileSync(control.credentials.file), encrypted);
  unlocked = true;
  await control.run(); // an automatic tick must not prompt the keyring
  assert.equal(starts, 0);
  assert.equal((await control.run(true)).state, 'synced');
  assert.equal(starts, 1); assert.equal(runs, 1);
  assert.equal(JSON.stringify(control.info()).includes('test-only'), false);
});
test('POSIX durable replacements survive reopen with private permissions', { skip: process.platform === 'win32' }, t => {
  const file = path.join(directory(t), 'state.json');
  durable(file, 'old'); durable(file, 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

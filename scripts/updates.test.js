'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Updates, REPOSITORY, RELEASES_API, selectRelease, updateTarget, assetNames } = require('../updates');
function release(version, options = {}) {
  const tag = 'neosync-v' + version;
  const names = assetNames(version, 'windows');
  return { tag_name: tag, html_url: REPOSITORY + '/releases/tag/' + tag, published_at: '2026-10-01', draft: false, prerelease: version.includes('-'),
    assets: Object.values(names).map(name => ({ name, state: 'uploaded', size: 5, browser_download_url: `${REPOSITORY}/releases/download/${tag}/${name}` })), ...options };
}
function fixture(options = {}) {
  const updater = new EventEmitter();
  const calls = [];
  const published = release('1.3.3-beta.4');
  updater.setFeedURL = value => calls.push(['feed', value]);
  updater.checkForUpdates = async () => ({ updateInfo: { version: '1.3.3-beta.4', files: [{ url: 'NeoSync-Setup-1.3.3-beta.4.exe', sha512: Buffer.alloc(64).toString('base64'), size: 5 }] } });
  updater.downloadUpdate = async () => { calls.push(['download']); };
  updater.quitAndInstall = () => calls.push(['install']);
  const manager = new Updates({ version: '1.3.3-beta.3', packaged: true, target: 'windows',
    fetch: async url => { assert.equal(url, RELEASES_API); return { ok: true, json: async () => [published] }; }, createUpdater: () => updater, ...options });
  return { manager, updater, calls, published };
}
test('release selection ignores drafts, upstream tags, wrong repositories, older versions and foreign beta channels', () => {
  const good = release('1.3.3-beta.10');
  const candidates = [release('9.0.0', { draft: true }), release('8.0.0', { published_at: null }), release('7.0.0', { tag_name: 'v7.0.0' }), release('6.0.0', { html_url: 'https://github.com/hughhowey/neo/releases/tag/v6.0.0' }), release('5.0.0-alpha.1'), good, release('1.3.3-beta.2')];
  assert.equal(selectRelease(candidates, '1.3.3-beta.3').version, good.tag_name.slice(9));
  assert.equal(selectRelease([release('1.4.0-beta.1')], '1.3.3'), null);
  assert.equal(selectRelease([release('1.3.3'), good], '1.3.3-beta.3').version, '1.3.3');
  assert.equal(selectRelease([release('1.3.3-beta.2')], '1.3.3-beta.3'), null);
});
test('only installed Windows x64 and Linux x64 AppImages self-update', () => {
  const base = { packaged: true, platform: 'win32', arch: 'x64', env: {}, installed: true };
  assert.equal(updateTarget(base), 'windows');
  for (const change of [{ packaged: false }, { installed: false }, { arch: 'arm64' }, { platform: 'darwin' }, { env: { PORTABLE_EXECUTABLE_FILE: 'app.exe' } }, { env: { PORTABLE_EXECUTABLE_DIR: 'portable' } }]) assert.equal(updateTarget({ ...base, ...change }), null);
  assert.equal(updateTarget({ ...base, platform: 'linux', env: { APPIMAGE: '/apps/NeoSync.AppImage' } }), 'linux');
  assert.equal(updateTarget({ ...base, platform: 'linux' }), null);
  assert.equal(updateTarget({ ...base, platform: 'linux', env: { APPIMAGE: '/app', APPIMAGE_EXTRACT_AND_RUN: '1' } }), null);
});
test('updates pin the selected NeoSync release and download without installing or allowing downgrades', async () => {
  const { manager, updater, calls } = fixture();
  await Promise.all([manager.check(), manager.check()]);
  await manager.downloading;
  assert.equal(calls.filter(c => c[0] === 'download').length, 1);
  assert.equal(calls[0][1].url, REPOSITORY + '/releases/download/neosync-v1.3.3-beta.4/');
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.autoDownload, false, 'Metadata is validated before download');
  assert.equal(manager.info().ready, true);
  assert.equal(calls.some(c => c[0] === 'install'), false);
});
test('missing metadata and unsupported installation types offer a release link', async () => {
  for (const target of [null, 'windows']) {
    const { manager, calls, published } = fixture({ target });
    published.assets = [];
    assert.equal((await manager.check()).state, 'release');
    assert.equal(manager.info().canInstall, false);
    assert.equal(calls.length, 0);
  }
});
test('foreign download paths, mismatched versions and missing checksums stop before downloading', async () => {
  for (const modify of [i => { i.files[0].url = 'https://example.org/installer.exe'; }, i => { i.version = '1.3.2'; }, i => { i.files[0].sha512 = ''; }]) {
    const { manager, updater, calls } = fixture();
    const original = updater.checkForUpdates;
    updater.checkForUpdates = async () => { const result = await original(); modify(result.updateInfo); return result; };
    assert.equal((await manager.check()).state, 'error');
    assert.equal(calls.some(c => c[0] === 'download'), false);
  }
});
test('offline checks and corrupt downloads leave the app running and permit retry', async () => {
  const { manager, updater, calls } = fixture();
  const fetch = manager.fetch;
  manager.fetch = async () => { throw new Error('Offline'); };
  assert.equal((await manager.check()).error, true);
  manager.fetch = fetch;
  updater.downloadUpdate = async () => { throw new Error('Checksum mismatch'); };
  await manager.check(); await manager.downloading;
  assert.equal(manager.info().ready, false);
  assert.equal(await manager.install(async () => {}), false);
  updater.downloadUpdate = async () => {};
  await manager.check(); await manager.downloading;
  assert.equal(manager.info().ready, true);
  assert.equal(calls.some(c => c[0] === 'install'), false);
});
test('restart waits for preparation, refuses failed saves, and resumes sync on installer failure', async () => {
  const { manager, updater, calls } = fixture();
  await manager.check(); await manager.downloading;
  await assert.rejects(manager.install(async () => { throw new Error('Save failed'); }), /Save failed/);
  assert.equal(calls.some(c => c[0] === 'install'), false);
  let prepared, resumed = false;
  const attempt = manager.install(() => new Promise(resolve => { prepared = () => resolve(() => { resumed = true; }); }));
  assert.equal(await manager.install(async () => {}), false, 'No duplicate install');
  assert.equal(calls.some(c => c[0] === 'install'), false);
  updater.quitAndInstall = () => updater.emit('error', new Error('Installer failed'));
  prepared();
  assert.equal(await attempt, false);
  assert.equal(resumed, true);
});

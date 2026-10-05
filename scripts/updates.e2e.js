'use strict';
// Exercise Electron's real updater HTTP transport and checksum validation.
// Payloads are inert text, never executed; profiles, feeds and caches are temporary.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');
const { NsisUpdater, AppImageUpdater } = require('electron-updater');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neosync-update-test-'));
app.setPath('userData', tmp);
const target = process.platform === 'win32' ? 'windows' : 'linux';
const timeout = setTimeout(() => { console.error('Updater test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const expected = Buffer.from('This is an inert update test payload, not an application.');
  const hash = createHash('sha512').update(expected).digest('base64');
  let version = '99.0.0', corrupt = false, payloadRequests = 0;
  const filename = () => target === 'windows' ? `NeoSync-Setup-${version}.exe` : `NeoSync-${version}-x86_64.AppImage`;
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0].endsWith('.yml')) {
      res.end(yaml.dump({ version, files: [{ url: filename(), sha512: hash, size: expected.length }], path: filename(), sha512: hash }));
    } else if (req.url === '/' + filename()) {
      payloadRequests++;
      const body = corrupt ? Buffer.alloc(expected.length, 120) : expected;
      res.writeHead(200, { 'Content-Length': body.length }); res.end(body);
    } else { res.writeHead(404); res.end(); }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const original = path.join(tmp, 'original.AppImage');
    fs.writeFileSync(original, 'The installed app is untouched.');
    if (target === 'linux') process.env.APPIMAGE = original;
    for (const broken of [false, true]) {
      corrupt = broken; version = broken ? '99.0.1' : '99.0.0';
      const updater = target === 'windows' ? new NsisUpdater() : new AppImageUpdater();
      Object.defineProperty(updater.app, 'baseCachePath', { value: path.join(tmp, 'cache') });
      updater.logger = null;
      updater.forceDevUpdateConfig = true;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.disableDifferentialDownload = true;
      const config = path.join(tmp, version + '.yml');
      fs.writeFileSync(config, yaml.dump({ provider: 'generic', url, updaterCacheDirName: version }));
      updater.updateConfigPath = config;
      updater.setFeedURL({ provider: 'generic', url, channel: 'latest', useMultipleRangeRequest: false });
      let downloaded = false;
      updater.on('update-downloaded', () => { downloaded = true; });
      const result = await updater.checkForUpdates();
      assert.equal(result.updateInfo.version, version);
      assert.equal(payloadRequests, broken ? 1 : 0, 'No download before validation');
      if (broken) {
        await assert.rejects(updater.downloadUpdate(), /checksum|sha512/i);
        assert.equal(downloaded, false);
      } else {
        const files = await updater.downloadUpdate();
        assert.equal(downloaded, true);
        assert.deepEqual(fs.readFileSync(files[0]), expected);
        assert.ok(files[0].startsWith(tmp + path.sep));
      }
    }
    assert.equal(fs.readFileSync(original, 'utf8'), 'The installed app is untouched.');
    console.log('Real updater passed: selected feed, inert payload download, checksum rejection, no installation.');
    clearTimeout(timeout); server.close(); app.exit(0);
  } catch (e) { console.error(e); clearTimeout(timeout); server.close(); app.exit(1); }
});

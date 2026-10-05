'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');
const { FEED, REPOSITORY, assetNames, validateUpdate } = require('../updates');
const version = require('../package.json').version;
const target = process.argv[2];
assert.ok(['windows', 'linux'].includes(target));
const dir = path.resolve(process.argv[3] || 'dist');
const names = assetNames(version, target);
const info = yaml.load(fs.readFileSync(path.join(dir, names.manifest), 'utf8'));
const tag = 'neosync-v' + version;
const release = { version, tag, assets: fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isFile()).map(name => ({
  name, size: fs.statSync(path.join(dir, name)).size, state: 'uploaded', browser_download_url: `${REPOSITORY}/releases/download/${tag}/${name}`
})) };
validateUpdate(info, release, target);
const config = yaml.load(fs.readFileSync(path.join(dir, target === 'windows' ? 'win-unpacked' : 'linux-unpacked', 'resources', 'app-update.yml'), 'utf8'));
for (const [key, value] of Object.entries(FEED)) assert.deepEqual(config[key], value, 'Packaged updater configuration: ' + key);
(async () => {
  for (const file of info.files) {
    const hash = createHash('sha512');
    for await (const data of fs.createReadStream(path.join(dir, file.url))) hash.update(data);
    assert.equal(hash.digest('base64'), file.sha512, 'Download checksum: ' + file.url);
    assert.equal(fs.statSync(path.join(dir, file.url)).size, file.size);
  }
  console.log('Verified ' + target + ' update metadata, packaged feed and installer checksums.');
})().catch(e => { console.error(e); process.exitCode = 1; });

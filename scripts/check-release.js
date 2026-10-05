'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
assert.equal(pkg.version, lock.version, 'Lockfile version must match');
assert.equal(pkg.version, lock.packages[''].version, 'Root lockfile version must match');
assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/);
assert.equal(pkg.name, 'neosync');
assert.equal(pkg.build.publish, null, 'App updates remain manual');
assert.equal(pkg.homepage, 'https://github.com/Arianic/NeoSync');
assert.ok(fs.existsSync(path.join(root, 'docs/releases', pkg.version + '.md')), 'Add release notes first');
if (process.env.GITHUB_REF?.startsWith('refs/tags/')) {
  assert.equal(process.env.GITHUB_REF, 'refs/tags/neosync-v' + pkg.version, 'Release tag must match the package version');
}
console.log('NeoSync release metadata verified: ' + pkg.version);

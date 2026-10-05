#!/usr/bin/env node
'use strict';
// CI builds a DRAFT. Never publish automatically or target upstream.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const loud = (...args) => execFileSync('git', args, { cwd: root, stdio: 'inherit' });
const stop = message => { console.error(message); process.exit(1); };
require('./check-release');
const version = require('../package.json').version;
if (process.argv[2] && process.argv[2] !== version) stop('Set the version with npm version --no-git-tag-version --ignore-scripts, add release notes, and commit before releasing.');
if (git('branch', '--show-current') !== 'main') stop('Release from the tested main branch.');
if (git('status', '--porcelain')) stop('Commit all changes (including new files) before releasing.');
const allowed = /^https:\/\/github\.com\/arianic\/neosync(?:\.git)?\/?$|^git@github\.com:arianic\/neosync(?:\.git)?$/i;
if (!allowed.test(git('remote', 'get-url', 'origin')) || !allowed.test(git('remote', 'get-url', '--push', 'origin'))) stop('origin must point to Arianic/NeoSync for both fetch and push.');
const tag = 'neosync-v' + version;
if (git('ls-remote', '--tags', 'origin', 'refs/tags/' + tag)) stop('That release tag already exists. Choose a new version; never replace a release tag.');
if (git('tag', '--list', tag)) stop('That tag already exists locally. Inspect it before retrying.');
loud('fetch', 'origin', 'main');
try { git('merge-base', '--is-ancestor', 'origin/main', 'HEAD'); }
catch { stop('GitHub main has changes missing locally. Integrate and test them first.'); }
loud('push', 'origin', 'main');
loud('tag', '-a', tag, '-m', 'NeoSync ' + version);
loud('push', 'origin', tag);
console.log('Build started. Review Actions, then the draft at https://github.com/Arianic/NeoSync/releases. Nothing has been published.');

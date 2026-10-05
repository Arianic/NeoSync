'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'release.js'), 'utf8');
function scenario(overrides = {}) {
  const calls = [], messages = [];
  const answers = {
    'branch --show-current': 'main',
    'status --porcelain': '',
    'remote get-url origin': 'https://github.com/Arianic/NeoSync.git',
    'remote get-url --push origin': 'https://github.com/Arianic/NeoSync.git',
    ...overrides
  };
  let stopped = false;
  const context = {
    __dirname,
    console: { log: text => messages.push(text), error: text => messages.push(text) },
    process: { argv: ['node', 'release.js'], exit() { stopped = true; throw new Error('stopped'); } },
    require(id) {
      if (id === 'node:path') return path;
      if (id === './check-release') return {};
      if (id === '../package.json') return { version: '1.3.3-beta.1' };
      if (id === 'node:child_process') return { execFileSync(command, args) {
        assert.equal(command, 'git'); calls.push(args.join(' '));
        const result = answers[args.join(' ')];
        if (result instanceof Error) throw result;
        return result || '';
      } };
      throw new Error('Unexpected dependency');
    }
  };
  try { vm.runInNewContext(source, context); } catch (err) { if (!stopped) throw err; }
  return { calls, messages, stopped };
}
test('release refuses dirty tracked or untracked files before network or pushes', () => {
  for (const status of [' M app.js', '?? sync/new.js']) {
    const result = scenario({ 'status --porcelain': status });
    assert.equal(result.stopped, true);
    assert.equal(result.calls.some(c => /^(push|fetch|ls-remote) /.test(c)), false);
  }
});
test('release refuses upstream fetch or push destinations', () => {
  for (const setting of ['remote get-url origin', 'remote get-url --push origin']) {
    const result = scenario({ [setting]: 'https://github.com/hughhowey/neo.git' });
    assert.equal(result.stopped, true);
    assert.equal(result.calls.some(c => c.startsWith('push ')), false);
  }
});
test('release refuses an existing remote tag or a diverged main branch', () => {
  for (const overrides of [
    { 'ls-remote --tags origin refs/tags/neosync-v1.3.3-beta.1': 'existing' },
    { 'merge-base --is-ancestor origin/main HEAD': new Error('diverged') }
  ]) {
    const result = scenario(overrides);
    assert.equal(result.stopped, true);
    assert.equal(result.calls.some(c => c.startsWith('push ')), false);
  }
});
test('clean release pushes only main and its own annotated NeoSync tag', () => {
  const result = scenario();
  assert.equal(result.stopped, false);
  assert.deepEqual(result.calls.filter(c => c.startsWith('push ')), ['push origin main', 'push origin neosync-v1.3.3-beta.1']);
  assert.ok(result.calls.includes('tag -a neosync-v1.3.3-beta.1 -m NeoSync 1.3.3-beta.1'));
  assert.match(result.messages.at(-1), /draft/);
});

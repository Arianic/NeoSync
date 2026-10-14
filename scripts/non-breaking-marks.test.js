'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the non-breaking mark rules from app.js, on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- non-breaking marks:');
const to = app.indexOf('// ---- end of non-breaking marks ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { NB_CHARS, nonBreakingRuns };', context);
const api = context.api;

// the runs come out of another realm, so they are compared as JSON
const runs = (text) => JSON.stringify(api.nonBreakingRuns(text));

test('the three characters are the ones a line must not break at', () => {
  assert.deepEqual([...api.NB_CHARS].sort(), ['\u00a0', '\u2011', '\u202f']);
});

test('plain text has no non-breaking runs', () => {
  assert.equal(runs('Dr. Müller and 5 km'), '[]');
});

test('a no-break space is found, and a streak of them is one run', () => {
  assert.equal(runs('Dr. Müller'), JSON.stringify([{ start: 3, end: 4 }]));
  assert.equal(runs('a   b'), JSON.stringify([{ start: 1, end: 4 }]));
});

test('the narrow no-break space and the no-break hyphen are found too', () => {
  assert.equal(runs('5 km'), JSON.stringify([{ start: 1, end: 2 }]));
  assert.equal(runs('n‑th'), JSON.stringify([{ start: 1, end: 2 }]));
});

test('runs keep their order and do not merge across different characters', () => {
  assert.equal(
    runs('a b c  d'),
    JSON.stringify([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 5, end: 6 },
      { start: 6, end: 7 },
    ]),
  );
});

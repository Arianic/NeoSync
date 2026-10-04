'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the screenplay rules from app.js, run on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- screenplay rules:');
const to = app.indexOf('// ---- end of screenplay rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext(`this.api = { SP_HEAD_RE, SP_AFTER, SP_EMPTY, spLooksLikeCharacter, spLooksLikeTransition,
  spParseHeading, spGhost, spContd, spPaginate, spEighths, spToFountain, spFromFountain };`, context);
const sp = context.api;
const L = (type, text) => ({ type, text });
const plain = (x) => JSON.parse(JSON.stringify(x));

test('INT. and EXT. make a scene heading; a word that starts the same does not', () => {
  for (const s of ['INT. HOUSE', 'ext. beach - day', 'I/E CAR', 'INT./EXT. CAR', 'EST. CITY', 'int house']) assert.ok(sp.SP_HEAD_RE.test(s), s);
  for (const s of ['Interior lights flicker.', 'Internal memo', 'Extra! Extra!', 'Estelle walks in.']) assert.ok(!sp.SP_HEAD_RE.test(s), s);
});

test('a short line in capitals is a character; a shout or a sentence is not', () => {
  for (const s of ['KIM', 'VERNON (V.O.)', 'MRS. HANLON', 'DEPUTY #2', 'KIM (CONT\'D)']) assert.ok(sp.spLooksLikeCharacter(s), s);
  for (const s of ['BOOM!', 'FADE IN:', 'Kim walks in.', 'THE WHOLE BUILDING SHAKES AND THEN STOPS', '', '1984']) assert.ok(!sp.spLooksLikeCharacter(s), s);
  assert.ok(sp.spLooksLikeTransition('CUT TO:'));
  assert.ok(sp.spLooksLikeTransition('FADE OUT.'));
  assert.ok(sp.spLooksLikeTransition('Cut to:'), 'the usual ones as typed (NEO capitalizes the first word)');
  assert.ok(!sp.spLooksLikeTransition('He points to:'));
  assert.ok(!sp.spLooksLikeTransition('FADE IN:'));
});

test('Enter: after a name comes speech, after speech action; empty lines change what they are', () => {
  assert.equal(sp.SP_AFTER.character, 'dialogue');
  assert.equal(sp.SP_AFTER.dialogue, 'action');
  assert.equal(sp.SP_AFTER.heading, 'action');
  assert.equal(sp.SP_AFTER.transition, 'heading');
  // Enter twice after a speech: action, then the next speaker
  assert.equal(sp.SP_EMPTY.action, 'character');
  assert.equal(sp.SP_EMPTY.character, 'action');
});

test('the gray suggestion offers only names and places the script already has', () => {
  const s = [
    L('heading', 'EXT. LEEVILLE MARINA - NIGHT'), L('action', 'Fog.'),
    L('heading', 'INT. HARBOR OFFICE - CONTINUOUS'),
    L('character', 'KIM'), L('dialogue', 'Third night.'),
    L('character', 'VERNON'), L('dialogue', 'Fourth.'),
    L('character', 'KIM'), L('dialogue', 'Not on the chart.'),
    L('action', 'He looks at her.'),
    L('character', '')
  ];
  assert.equal(sp.spGhost(s, 10), 'VERNON', 'an empty name line offers whoever is being answered');
  s[10].text = 'k';
  assert.equal(sp.spGhost(s, 10), 'IM', 'lowercase typing still finds the name');
  s[10].text = 'KIM (V';
  assert.equal(sp.spGhost(s, 10), '.O.)');
  s.push(L('heading', 'INT. H'));
  assert.equal(sp.spGhost(s, 11), 'ARBOR OFFICE');
  s[11].text = 'int. harbor office - n';
  assert.equal(sp.spGhost(s, 11), 'IGHT');
  s[11].text = 'INT. HARBOR OFFICE - C';
  assert.equal(sp.spGhost(s, 11), 'ONTINUOUS');
  s[11].text = 'INT. Q';
  assert.equal(sp.spGhost(s, 11), '', 'nothing invented');
  s.push(L('transition', 'SM'));
  assert.equal(sp.spGhost(s, 12), 'ASH CUT TO:');
  assert.deepEqual(plain(sp.spParseHeading('INT. HARBOR OFFICE - NIGHT')), { prefix: 'INT.', loc: 'HARBOR OFFICE', time: 'NIGHT' });
});

test('(CONT\'D) when the same voice comes back after action, in the same scene', () => {
  const s = [L('character', 'KIM'), L('dialogue', 'One.'), L('action', 'She waits.'), L('character', 'Kim'), L('dialogue', 'Two.')];
  assert.equal(sp.spContd(s, 3), true);
  s[2] = L('character', 'VERNON');
  assert.equal(sp.spContd(s, 3), false, 'someone else spoke');
  assert.equal(sp.spContd([L('character', 'KIM'), L('dialogue', 'One.'), L('character', 'KIM')], 2), false, 'no action between');
  assert.equal(sp.spContd([L('character', 'KIM'), L('heading', 'INT. X'), L('action', 'a'), L('character', 'KIM')], 3), false, 'a new scene');
  assert.equal(sp.spContd([L('character', 'KIM'), L('action', 'a'), L('character', 'KIM (V.O.)')], 2), false, 'an extension of its own');
});

test('pages: 54 lines, a heading never alone at the foot, a speech kept with its speaker', () => {
  const lines = (type, n) => ({ type, lines: n });
  // 1 + 26×(1 blank + 1) = 53 lines; the 28th action needs 2 more
  const many = Array.from({ length: 40 }, () => lines('action', 1));
  const pg = sp.spPaginate(many);
  assert.equal(pg.pages, 2);
  assert.equal(pg.at.findIndex((a) => a.brk), 27);
  assert.equal(pg.at[27].fill, 1);
  assert.equal(pg.at[27].before, 0, 'no blank line at the top of a page');
  const h = [...Array.from({ length: 26 }, () => lines('action', 1)), lines('heading', 1), lines('action', 1)];
  assert.ok(sp.spPaginate(h).at[26].brk, 'the heading goes over with its scene');
  const d = [...Array.from({ length: 26 }, () => lines('action', 1)), lines('character', 1), lines('dialogue', 1), lines('dialogue', 1)];
  assert.ok(sp.spPaginate(d).at[26].brk, 'the speech goes over with its speaker');
  const long = [lines('action', 120), lines('action', 1)];
  assert.equal(sp.spPaginate(long).pages, 3, 'a paragraph longer than a page runs on');
  assert.equal(sp.spEighths(54), 8);
  assert.equal(sp.spEighths(7), 1);
});

test('Fountain out: forced where Fountain would misread a line', () => {
  const out = sp.spToFountain([
    L('heading', 'int. kitchen - day'), L('action', 'KIM ENTERS'), L('character', 'kim'), L('paren', '(quietly)'),
    L('dialogue', 'Hi.'), L('transition', 'cut to:'), L('heading', 'FLASHBACK'), L('transition', 'BACK TO PRESENT'), L('shot', 'close on the bell')
  ], { title: 'No Wind', credit: 'Written by', author: 'Hugh Howey', contact: 'A\nB' });
  assert.equal(out, [
    'Title: No Wind', 'Credit: Written by', 'Author: Hugh Howey', 'Contact:', '    A', '    B', '',
    'INT. KITCHEN - DAY', '', '!KIM ENTERS', '', 'KIM', '(quietly)', 'Hi.', '', 'CUT TO:', '', '.FLASHBACK', '', '>BACK TO PRESENT', '', '!CLOSE ON THE BELL', ''
  ].join('\n'));
});

test('Fountain in: a pasted script comes back as its elements', () => {
  const src = [
    'Title: No Wind', 'Author: Hugh Howey', '',
    'EXT. MARINA - NIGHT', '', 'Fog. A bell rings.', '', 'KIM', '(quietly)', 'Three nights.', '',
    'VERNON ^', 'Four.', '', 'CUT TO:', '', '.FLASHBACK', '', '!LOUD NOISE', '', '[[a note]]', '/* gone */', '# Act One', '= synopsis', '===', '@McCLANE', 'Yippee.'
  ].join('\n');
  assert.deepEqual(plain(sp.spFromFountain(src)), [
    L('heading', 'EXT. MARINA - NIGHT'), L('action', 'Fog. A bell rings.'), L('character', 'KIM'), L('paren', '(quietly)'),
    L('dialogue', 'Three nights.'), L('character', 'VERNON'), L('dialogue', 'Four.'), L('transition', 'CUT TO:'),
    L('heading', 'FLASHBACK'), L('action', 'LOUD NOISE'), L('character', 'McCLANE'), L('dialogue', 'Yippee.')
  ]);
});

'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { check } = require('../grammar-hu.js');

// what each hint covers, its fix and its rule
const hints = (text) => check(text).map((h) => [text.substr(h.at, h.len), h.fix, h.rule]);

test('the article before a vowel is az', () => {
  assert.deepEqual(hints('Láttam a almát.'), [['a', 'az', 'article']]);
  assert.deepEqual(hints('A EU döntött.'), [['A', 'Az', 'article']]);
  assert.deepEqual(hints('Az alma és a ház.'), []);
});

test('a comma before conjunctions, but not after és, vagy, mint', () => {
  assert.deepEqual(hints('Mondta hogy menjünk mert késő van.'),
    [[' hogy', ', hogy', 'comma'], [' mert', ', mert', 'comma']]);
  assert.deepEqual(hints('Az ember aki jött.'), [[' aki', ', aki', 'comma']]);
  assert.deepEqual(hints('Nem tudom, hogy kié. És hogy miért? Több, mint ami kell.'), []);
  assert.deepEqual(hints('Nem tudom hogyan. Ott ült a bár előtt.'), []);
});

test('the question particle takes a hyphen', () => {
  assert.deepEqual(hints('Tudod e?'), [[' e', '-e', 'particle']]);
  assert.deepEqual(hints('Kérdezte, hogy jön-e. Ez e könyv.'), []);
});

test('repeated words, double spaces and a space before punctuation', () => {
  assert.deepEqual(hints('A a kertben ült .'), [[' a', '', 'repeat'], [' ', '', 'punct']]);
  assert.deepEqual(hints('Ez az az ember, akit láttam.'), []);
  assert.deepEqual(hints('Szép volt  nagyon.'), [['  ', ' ', 'spaces']]);
});

test('an empty paragraph has nothing to say', () => {
  assert.deepEqual(check(''), []);
  assert.deepEqual(check('   '), []);
});

test('a comma before mint in a comparison, but not in "több mint száz"', () => {
  assert.deepEqual(hints('Nagyobb mint a ház.'), [[' mint', ', mint', 'mint']]);
  assert.deepEqual(hints('Több mint száz ember jött.'), []);
});

test('"én" with the conditional of "they"', () => {
  assert.deepEqual(hints('Én megcsinálnák.'), [['ák', 'ám', 'mood']]);
  assert.deepEqual(hints('Én szeretnék egy kávét.'), []);
});

test('being somewhere takes -ban/-ben', () => {
  assert.deepEqual(hints('A könyv a táskába van.'), [['ba', 'ban', 'illative']]);
  assert.deepEqual(hints('A kép a dobozba van téve. A szoba van ott.'), []);
});

test('months and days are lowercase mid-sentence', () => {
  assert.deepEqual(hints('Találkozunk Hétfőn.'), [['H', 'h', 'calendar']]);
  assert.deepEqual(hints('Hétfőn jön. Szombat Ferenc jött.'), []);
});

test('dates, ordinals and abbreviations', () => {
  assert.deepEqual(hints('2026.10.06 és 1.3.9'), [['2026.10.06', '2026. 10. 06.', 'date']]);
  assert.deepEqual(hints('A 2-ik helyen.'), [['2-ik', '2.', 'ordinal']]);
  assert.deepEqual(hints('Alma, körte stb, a stb. jó.'), [['stb', 'stb.', 'abbrev']]);
});

test('words written as one, and easily swapped words', () => {
  assert.deepEqual(hints('Ugyan is nem rég jött.'), [['Ugyan is', 'Ugyanis', 'joined'], ['nem rég', 'nemrég', 'joined']]);
  assert.deepEqual(hints('Egyenlőre a ház mellet maradok, a mellet nem.'),
    [['Egyenlőre', 'Egyelőre', 'confused'], ['mellet', 'mellett', 'confused']]);
});

test('ordinary correct Hungarian prose gets no hints', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const lines = fs.readFileSync(path.join(__dirname, 'grammar-hu.correct.txt'), 'utf8').trim().split('\n');
  for (const line of lines) assert.deepEqual(hints(line), [], line);
});

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

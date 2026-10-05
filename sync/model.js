'use strict';
const { createHash } = require('node:crypto');
const hash = (data) => data == null ? null : createHash('sha256').update(data).digest('hex');
const pack = (data) => data == null ? null : Buffer.from(data).toString('base64');
const unpack = (data) => data == null ? null : Buffer.from(data, 'base64');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const encode = text => Buffer.from(text);
function segment(s) {
  return typeof s === 'string' && s.length > 0 && ![...s].some(c => c.charCodeAt(0) < 32) && !/[\\/:<>"|?*]/.test(s) &&
    !/[. ]$/.test(s) && s !== '.' && s !== '..' && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s);
}
function included(p) {
  const bits = p.split('/');
  if (!bits.every(segment)) return false;
  if (p === 'library.json') return true;
  if (!bits[0].startsWith('book-')) return false;
  if (bits.length === 3) return bits[1] === 'chapters' && /\.html$/.test(bits[2]);
  return bits.length === 2 && (/\.(html|json)$/.test(bits[1]) || /^(cover|art)-[^/]+\.(png|jpg|jpeg|webp)$/i.test(bits[1]));
}
function remotePath(p) { return included(p) || /^\.neosync\/deletions\/[a-f0-9]{64}\.json$/.test(p); }
const markerPath = (p) => '.neosync/deletions/' + hash(p) + '.json';
const rank = (p) => p === 'library.json' ? 2 : p.endsWith('/book.json') ? 1 : 0;

// Three-way merge: objects by key, records by stable ID, membership as sets.
// Order is only combined when both devices merely append. Competing moves,
// removals plus moves, scalar edits and text always require a human choice.
function mergeValue(base, local, remote, key = '') {
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  if (['modified', 'lastPosition', 'wordCount', 'dailyCounts'].includes(key)) return remote;
  if (Array.isArray(local) && Array.isArray(remote)) {
    const b = Array.isArray(base) ? base : [];
    if (['bookIds', 'customWords', 'penNames'].includes(key) && [...b, ...local, ...remote].every(x => typeof x === 'string')) {
      return [...new Set([...local, ...remote])].filter(x => !b.includes(x) || (local.includes(x) && remote.includes(x)));
    }
    if (key === 'chapterOrder') {
      if (![...b, ...local, ...remote].every(segment)) throw new Error('order');
      if (!equal(local.slice(0, b.length), b) || !equal(remote.slice(0, b.length), b)) throw new Error('order');
      return [...b, ...[...new Set([...local.slice(b.length), ...remote.slice(b.length)])].sort()];
    }
    if ([...b, ...local, ...remote].every(x => x && typeof x === 'object' && typeof x.id === 'string')) {
      if ([b, local, remote].some(xs => new Set(xs.map(x => x.id)).size !== xs.length)) throw new Error('duplicate record IDs');
      const map = xs => Object.fromEntries(xs.map(x => [x.id, x]));
      return Object.values(mergeValue(map(b), map(local), map(remote)));
    }
    throw new Error('array');
  }
  if (local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
    if (base != null && (typeof base !== 'object' || Array.isArray(base))) throw new Error('type');
    const out = Object.create(null);
    for (const k of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeValue(base?.[k], local[k], remote[k], k);
      if (value !== undefined) out[k] = value;
    }
    return out;
  }
  throw new Error('conflict');
}
function merge(p, base, local, remote) {
  if (!p.endsWith('.json') || !base || !local || !remote) return null;
  try { return Buffer.from(JSON.stringify(mergeValue(JSON.parse(base), JSON.parse(local), JSON.parse(remote)), null, 2)); }
  catch { return null; }
}
function validate(p, data) {
  if (!included(p)) throw new Error('Invalid library path');
  if (data == null) return;
  if (p.endsWith('.json')) {
    const value = JSON.parse(data.toString());
    if (p.endsWith('/book.json') && (!value || value.id !== p.split('/')[0] || !Array.isArray(value.chapterOrder) || !value.chapterOrder.every(segment) || new Set(value.chapterOrder).size !== value.chapterOrder.length)) throw new Error('Invalid book metadata');
    if (p === 'library.json' && (!value || !Array.isArray(value.shelves) || !value.shelves.every(s => s && Array.isArray(s.bookIds) && s.bookIds.every(id => segment(id) && id.startsWith('book-'))))) throw new Error('Invalid shelves');
  }
}
function references(p, data) {
  if (!data) return [];
  if (p === 'library.json') return JSON.parse(data).shelves.flatMap(s => s.bookIds.map(id => id + '/book.json'));
  if (p.endsWith('/art.json')) {
    const name = JSON.parse(data).file;
    if (!segment(name)) throw new Error('Invalid painted cover reference');
    return [p.split('/')[0] + '/' + name];
  }
  if (!p.endsWith('/book.json')) return [];
  const meta = JSON.parse(data), dir = p.split('/')[0];
  const refs = meta.chapterOrder.map(id => dir + '/chapters/' + id + '.html');
  if (meta.coverArt?.file) {
    if (!segment(meta.coverArt.file)) throw new Error('Invalid painted cover reference');
    refs.push(dir + '/' + meta.coverArt.file);
  }
  for (const key of ['cover', 'coverImage', 'artFile']) {
    if (typeof meta[key] === 'string' && meta[key]) {
      if (!segment(meta[key])) throw new Error('Invalid asset reference');
      refs.push(dir + '/' + meta[key]);
    }
  }
  return refs;
}
module.exports = { hash, pack, unpack, segment, included, remotePath, markerPath, rank, merge, validate, references, encode };

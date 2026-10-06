// NEO — Hungarian grammar hints
//
// A small, rule-based checker for the slips a spellchecker can't see,
// shown during the spellcheck pass (⌘;) when the writing language is
// Hungarian. It never rewrites anything on its own: each hint is a
// suggestion the writer accepts or ignores with a right-click.
//
// Every rule is a plain pattern over one paragraph's text, so it runs on
// the writer's computer, instantly, with nothing sent anywhere. A rule only
// fires where a mistake is very likely; a quiet checker is better than a
// nagging one.
//
//   NeoGrammarHu.check('Láttam a almát, de nem tudom hogy kié.')
//   → [{ at, len, fix: 'az', rule: 'article' }, { …, fix: ', hogy', rule: 'comma' }]
//
// at/len: the span of the paragraph's text the hint covers; fix: what
// replaces that span; rule: which rule spoke (app.js explains it);
// insert (optional): a smaller edit that gives the same fix — { at, text }
// to type at that place instead of retyping the whole span.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoGrammarHu = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const L = '\\p{L}\\p{M}';
  const VOWELS = 'aáeéiíoóöőuúüűAÁEÉIÍOÓÖŐUÚÜŰ';

  // Conjunctions and relative words a comma goes before (AkH. 12. 245–259)
  const CONJ = [
    'hogy', 'mert', 'de', 'hanem', 'mintha', 'holott', 'noha', 'habár',
    'mivel', 'miközben', 'mielőtt', 'miután', 'mihelyt', 'amíg', 'ameddig',
    'amikor', 'amint', 'amennyiben', 'ahol', 'ahova', 'ahová', 'ahonnan',
    'ami', 'amit', 'aminek', 'amire', 'amiről', 'amitől', 'amiben', 'amiből',
    'amibe', 'amin', 'amivel', 'amiért', 'amik', 'amiket', 'amiknek',
    'aki', 'akit', 'akinek', 'akire', 'akiről', 'akitől', 'akiben', 'akiből',
    'akibe', 'akin', 'akivel', 'akiért', 'akik', 'akiket', 'akiknek', 'akikkel',
    'amely', 'amelyet', 'amelynek', 'amelyre', 'amelyről', 'amelytől',
    'amelyben', 'amelyből', 'amelybe', 'amelyen', 'amellyel', 'amelyért',
    'amelyek', 'amelyeket', 'amelyeknek', 'amelyekben', 'amelyik', 'amelyiket'
  ];
  // after these no comma is wanted (és hogy, vagy ami, mint aki, a bár…)
  const NO_COMMA_AFTER = new Set([
    'és', 's', 'vagy', 'sem', 'se', 'meg', 'illetve', 'mint', 'sőt', 'hanem',
    'de', 'ha', 'hogy', 'mert', 'a', 'az', 'egy', 'ez', 'e', 'nem', 'csak',
    'pedig', 'tehát', 'akár', 'mind', 'ill'
  ]);
  // words that can stand twice on purpose
  const MAY_REPEAT = new Set(['az', 'egy', 'hogy', 'is', 'el', 'meg', 'ki', 'be', 'fel', 'le', 'át', 'ide', 'oda']);

  const lower = (s) => s.toLocaleLowerCase('hu');

  function check(text) {
    const out = [];
    if (!text || !text.trim()) return out;
    let m;

    // "a" before a vowel is "az": a alma → az alma (a number or a sign is
    // read aloud first, so those are left alone)
    const article = new RegExp(`(?<![${L}\\d'’-])([aA]) (?=[${VOWELS}][${L}]*)(?!az?(?![${L}]))`, 'gu');
    while ((m = article.exec(text))) {
      out.push({ at: m.index, len: 1, fix: m[1] === 'A' ? 'Az' : 'az', rule: 'article' });
    }

    // a comma before a conjunction: …tudom hogy… → …tudom, hogy…
    const comma = new RegExp(`(?<=[${L}])( )(${CONJ.join('|')})(?![${L}\\d-])`, 'giu');
    while ((m = comma.exec(text))) {
      const before = text.slice(0, m.index).match(new RegExp(`([${L}]+)$`, 'u'));
      if (!before || NO_COMMA_AFTER.has(lower(before[1]))) continue;
      // the whole word is underlined, but only the comma goes in, so the
      // word keeps any bold or italic it has
      out.push({ at: m.index, len: 1 + m[2].length, fix: ', ' + m[2], rule: 'comma', insert: { at: m.index, text: ',' } });
    }

    // the question particle -e takes a hyphen: tudod e? → tudod-e?
    const particle = new RegExp(`(?<=[${L}])( e)(?=[?,.!…;:]|$)`, 'gu');
    while ((m = particle.exec(text))) out.push({ at: m.index, len: 2, fix: '-e', rule: 'particle' });

    // the same word twice: a a ház, hogy hogy
    const twice = new RegExp(`(?<![${L}])([${L}]+)( +)([${L}]+)(?![${L}])`, 'gu');
    while ((m = twice.exec(text))) {
      if (lower(m[1]) === lower(m[3]) && !MAY_REPEAT.has(lower(m[1])) && !/\d/.test(m[1])) {
        out.push({ at: m.index + m[1].length, len: m[2].length + m[3].length, fix: '', rule: 'repeat' });
      }
      twice.lastIndex = m.index + m[1].length; // let "a a a" be seen pairwise
    }

    // two spaces between words, and a space before punctuation
    const spaces = /(?<=\S)( {2,})(?=\S)/g;
    while ((m = spaces.exec(text))) out.push({ at: m.index, len: m[1].length, fix: ' ', rule: 'spaces' });
    const punct = /(?<=[\p{L}\p{N}])( +)(?=[,.;:!?…](?![.\d]))/gu;
    while ((m = punct.exec(text))) out.push({ at: m.index, len: m[1].length, fix: '', rule: 'punct' });

    // one hint per place: the first rule to claim a span keeps it
    out.sort((a, b) => a.at - b.at);
    const kept = [];
    for (const h of out) {
      const last = kept[kept.length - 1];
      if (last && h.at < last.at + last.len) continue;
      kept.push(h);
    }
    return kept;
  }

  return { check };
});

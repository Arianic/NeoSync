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

  // being somewhere, not going there
  const STATE = [
    'van', 'vagyok', 'vagy', 'vagyunk', 'vagytok', 'vannak', 'volt', 'voltam', 'voltál',
    'voltunk', 'voltatok', 'voltak', 'lesz', 'leszek', 'leszünk', 'lesznek', 'marad',
    'maradt', 'maradok', 'maradtam', 'maradunk', 'lakik', 'lakom', 'lakunk', 'laknak',
    'lakott', 'ül', 'ült', 'ülök', 'ültem', 'áll', 'állt', 'állok', 'fekszik', 'feküdt',
    'dolgozik', 'dolgozom', 'dolgozott', 'található', 'találhatók'
  ];
  // words that end in -ba/-be on their own: a room, a mushroom, a foot…
  const NOT_ILLATIVE = new Set([
    'szoba', 'gomba', 'bomba', 'goromba', 'tromba', 'rumba', 'szamba', 'mamba',
    'kuba', 'aruba', 'kába', 'csibe', 'lába', 'sebe', 'zsebe', 'dobja', 'kebe', 'bébe'
  ]);
  const CALENDAR = [
    'január', 'február', 'március', 'április', 'május', 'június', 'július',
    'augusztus', 'szeptember', 'október', 'november', 'december',
    'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'
  ];
  const ABBREV = ['stb', 'pl', 'kb', 'ill', 'ún', 'vö', 'ld', 'ui'];
  const JOINED = [
    ['ugyan is', 'ugyanis'], ['egy általán', 'egyáltalán'], ['minden esetre', 'mindenesetre'],
    ['egy szer', 'egyszer'], ['nem rég', 'nemrég'], ['vala mi', 'valami'], ['vala ki', 'valaki']
  ];
  // [what was typed, what was likely meant, leave it be right after "a"/"az"]
  const CONFUSED = [
    ['egyenlőre', 'egyelőre', false],
    ['mellet', 'mellett', true]
  ];

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

    // a comma before "mint" in a comparison: nagyobb mint → nagyobb, mint
    // (but "több mint száz", where it means "over", takes none)
    const mint = new RegExp(`(?<![${L}])([${L}]+bb(?:an|en)?)( )(mint)(?![${L}])`, 'giu');
    while ((m = mint.exec(text))) {
      if (['több', 'kevesebb'].includes(lower(m[1]))) continue;
      const at = m.index + m[1].length;
      out.push({ at, len: 1 + m[3].length, fix: ', ' + m[3], rule: 'mint', insert: { at, text: ',' } });
    }

    // "én" with the conditional of "they": én megcsinálnák → megcsinálnám
    const mood = new RegExp(`(?<![${L}])[éÉ]n ([${L}]+?n)(ák)(?![${L}])`, 'gu');
    while ((m = mood.exec(text))) {
      out.push({ at: m.index + 3 + m[1].length, len: 2, fix: 'ám', rule: 'mood' });
    }

    // where something is takes -ban/-ben, not -ba/-be: a házba van → házban
    // (but "a dobozba van téve" is a state that came of a movement)
    const illative = new RegExp(`(?<![${L}])([${L}]{2,}?)(ba|be) (${STATE.join('|')})(?![${L}])(?! [${L}]+v[ae](?![${L}]))`, 'gu');
    while ((m = illative.exec(text))) {
      const word = lower(m[1] + m[2]);
      if (NOT_ILLATIVE.has(word)) continue;
      out.push({ at: m.index + m[1].length, len: 2, fix: m[2] + 'n', rule: 'illative' });
    }

    // months and days are lowercase: hétfőn, Januárban → januárban
    // (only mid-sentence, and not before another capital: a name or a title)
    const calendar = new RegExp(`(?<=[\\p{Ll},;] )(${CALENDAR.map((w) => w[0].toUpperCase() + w.slice(1)).join('|')})([${L}]*)(?![${L}])(?! \\p{Lu})`, 'gu');
    while ((m = calendar.exec(text))) {
      out.push({ at: m.index, len: 1, fix: lower(m[1][0]), rule: 'calendar' });
    }

    // dates take a space after each period: 2026.10.06 → 2026. 10. 06.
    const date = /(?<![\d.])((?:1[89]|20)\d\d)\.(\d{1,2})\.(\d{1,2})(\.?)(?![\d.])/g;
    while ((m = date.exec(text))) {
      out.push({ at: m.index, len: m[0].length, fix: `${m[1]}. ${m[2]}. ${m[3]}.`, rule: 'date' });
    }

    // ordinals take a period: 2-ik, 1-ső → 2., 1.
    const ordinal = new RegExp(`(?<![${L}\\d])(\\d+)-(?:ik|ső|odik|edik|adik|ödik)(?![${L}])`, 'gu');
    while ((m = ordinal.exec(text))) {
      out.push({ at: m.index, len: m[0].length, fix: m[1] + '.', rule: 'ordinal' });
    }

    // abbreviations that take a period: stb, pl, kb → stb., pl., kb.
    const abbrev = new RegExp(`(?<![${L}.])(${ABBREV.join('|')})(?![${L}.])`, 'gu');
    while ((m = abbrev.exec(text))) {
      out.push({ at: m.index, len: m[1].length, fix: m[1] + '.', rule: 'abbrev', insert: { at: m.index + m[1].length, text: '.' } });
    }

    // words written as one: ugyan is → ugyanis
    for (const [apart, joined] of JOINED) {
      const re = new RegExp(`(?<![${L}])(${apart})(?![${L}])`, 'giu');
      while ((m = re.exec(text))) {
        const fix = m[1][0] === m[1][0].toUpperCase() ? joined[0].toUpperCase() + joined.slice(1) : joined;
        out.push({ at: m.index, len: m[1].length, fix, rule: 'joined' });
      }
    }

    // two real words, easily swapped: egyenlőre (into equal parts) for
    // egyelőre (for now); a ház mellet (the breast) for mellett (beside)
    for (const [wrong, right, skipAfterArticle] of CONFUSED) {
      const re = new RegExp(`(?<![${L}])(${wrong})(?![${L}])`, 'giu');
      while ((m = re.exec(text))) {
        if (skipAfterArticle && /(?:^|[^\p{L}])az? $/iu.test(text.slice(0, m.index))) continue;
        const fix = m[1][0] === m[1][0].toUpperCase() ? right[0].toUpperCase() + right.slice(1) : right;
        out.push({ at: m.index, len: m[1].length, fix, rule: 'confused' });
      }
    }

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

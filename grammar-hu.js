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

  function check(text, morph) {
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

    if (typeof morph === 'function') out.push(...morphHints(text, morph));

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

  /* ---------- rules that need to know what a word is ----------
     morph(word) answers from the dictionary: { lemmas, verbs } — the
     word's dictionary forms, and which of them are verbs — or nothing for
     a word it doesn't know. A rule stays quiet unless every word it leans
     on is known. */

  // little words a dictionary might take for verbs (mi → mini)
  const NOT_VERBS = new Set(['mi', 'ki', 'ez', 'az', 'te', 'ti', 'ő', 'ők', 'én', 'a', 'egy', 'is', 'se',
    'ha', 'de', 's', 'és', 'mint', 'meg', 'el', 'be', 'le', 'fel', 'ki', 'át', 'nem', 'sem', 'mit', 'kit', 'vagy']);
  // forms the dictionary files under another verb (lesz under van)
  const IRREGULAR_FORMS = { lesz: ['3s'], volt: ['3s'], lenne: ['3s'], volna: ['3s'], legyen: ['3s'],
    leszek: ['1s'], leszel: ['2s'], leszünk: ['1p'], lesztek: ['2p'], lesznek: ['3p'],
    vagyok: ['1s'], vagyunk: ['1p'], vagytok: ['2p'], vannak: ['3p'] };
  const PRONOUNS = { 'én': '1s', 'te': '2s', 'ő': '3s', 'mi': '1p', 'ti': '2p', 'ők': '3p' };
  // between a subject pronoun and its verb: én is megyek, ők nem tudják
  const PARTICLES = new Set(['is', 'sem', 'se', 'nem', 'már', 'még', 'most', 'csak', 'pedig',
    'tényleg', 'mindig', 'soha', 'sosem', 'akkor', 'azonnal', 'végül', 'aztán', 'majd', 'egyszer', 'szintén']);
  const QUANT = new RegExp('^(?:(?:tizen|huszon|harminc|negyven|ötven|hatvan|hetven|nyolcvan|kilencven)?' +
    '(?:egy|két|kettő|három|négy|öt|hat|hét|nyolc|kilenc)|tíz|húsz|harminc|negyven|ötven|hatvan|hetven|' +
    'nyolcvan|kilencven|száz|ezer|millió|sok|kevés|néhány|egynéhány|számos|több|minden|valamennyi|' +
    'mindegyik|\\d+)$', 'u');
  // case endings a plural can carry (házak|ban); those that start with a
  // consonant go onto the singular just the same (ház|ban)
  const CASES = ['ban', 'ben', 'ba', 'be', 'ra', 're', 'ról', 'ről', 'tól', 'től', 'ból', 'ből',
    'nak', 'nek', 'hoz', 'hez', 'höz', 'nál', 'nél', 'ig', 'ért', 'kal', 'kel', 'on', 'en', 'ön',
    'at', 'et', 'ot', 'öt', 't'];
  const CONSONANT_CASES = new Set(['ban', 'ben', 'ba', 'be', 'ra', 're', 'ról', 'ről', 'tól', 'től',
    'ból', 'ből', 'nak', 'nek', 'hoz', 'hez', 'höz', 'nál', 'nél', 'ig', 'ért']);

  const ENDINGS = [
    // [ending of the verb form, who is speaking, definite (true) / indefinite (false) / either (null)]
    [/n[aá]nk$|n[eé]nk$/, ['1p'], null],
    [/n[aá]tok$|n[eé]tek$/, ['2p'], null],
    [/n[aá]nak$|n[eé]nek$/, ['3p'], false],
    [/nák$/, ['3p'], true],
    [/nék$/, ['1s', '3p'], null],
    [/n[aá]m$|n[eé]m$/, ['1s'], true],
    [/n[aá]l$|n[eé]l$/, ['2s'], false],
    [/n[aá]d$|n[eé]d$/, ['2s'], true],
    [/n[ae]$/, ['3s'], false],
    [/n[áé]$/, ['3s'], true],
    [/j?átok$|itek$|j?étek$/, ['2p'], true],
    [/l[ae]k$/, null, null], // látlak: me → you, left alone
    [/t[ae]k$/, ['2p', '3p'], false],
    [/[oeö]?tok$|tök$/, ['2p'], false],
    [/n[ae]k$/, ['3p'], false],
    [/j?[áé]k$/, ['3p'], true],
    [/ik$/, ['3s', '3p'], null],
    [/[uü]nk$/, ['1p'], false],
    [/j?[uü]k$/, ['1p'], true],
    [/t[ae]m$/, ['1s'], null],
    [/[oeöa]m$|[aeoö]?m$/, ['1s'], null],
    [/[oeö]k$|[^aeiouáéíóöőúüű]k$/, ['1s'], false],
    [/t[aá]l$|t[eé]l$/, ['2s'], false],
    [/sz$/, ['2s'], false],
    [/[oeö]l$/, ['2s'], false],
    [/t[aá]d$|t[eé]d$|[oeöa]d$/, ['2s'], true],
    [/t[ae]$|j?[ae]$|i$/, ['3s'], true],
    [/t$/, ['3s'], false]
  ];

  function morphHints(text, morph) {
    const out = [];
    const toks = [];
    const word = new RegExp(`[${L}]+(?:-[${L}]+)*`, 'gu');
    let m;
    while ((m = word.exec(text))) toks.push({ w: m[0], at: m.index, end: m.index + m[0].length });
    // two words side by side, with nothing but spaces between them
    const next = (i) => (toks[i + 1] && /^ +$/.test(text.slice(toks[i].end, toks[i + 1].at)) ? toks[i + 1] : null);
    const known = (w) => { const k = morph(w); return k && k.lemmas && k.lemmas.length ? k : null; };
    const verbLemma = (w) => {
      const k = known(w);
      if (!k || NOT_VERBS.has(lower(w))) return null;
      // the word's own form first: "lesz" is lesz, not a form of van
      const own = k.lemmas.findIndex((l, i) => k.verbs[i] && l === lower(w));
      const i = own >= 0 ? own : k.verbs.indexOf(true);
      return i < 0 ? null : k.lemmas[i];
    };
    const onlyNoun = (w) => { const k = known(w); return k && !k.verbs.includes(true) ? k : null; };
    const isVerbForm = (w) => { const lem = verbLemma(w); return lem && !onlyNounToo(w) ? lem : null; };
    // a word that is also a noun (fal, sír) isn't trusted as a verb
    const onlyNounToo = (w) => { const k = known(w); return k && k.verbs.includes(false) && k.lemmas.some((l, i) => !k.verbs[i] && l === lower(w)); };

    function form(w, lemma) {
      const lw = lower(w);
      if (lw === lemma) return { persons: ['3s'], definite: false };
      if (IRREGULAR_FORMS[lw]) return { persons: IRREGULAR_FORMS[lw], definite: null };
      // the ending alone, where the word is its lemma plus an ending (lát|ok,
      // not lá|tok); the whole word where it changed (megy → mennek)
      const end = lw.startsWith(lemma) ? lw.slice(lemma.length) : lw;
      for (const [re, persons, definite] of ENDINGS) {
        if (!re.test(end)) continue;
        if (!persons) return null;
        // -om/-em/-öm: definite, except for verbs in -ik (eszem egy almát)
        const def = definite === null && /[oeöa]?m$/.test(end) && !/t[ae]m$|n[aáeé]m$/.test(end) && !lemma.endsWith('ik') ? true : definite;
        return { persons, definite: def };
      }
      return null;
    }
    // a noun in the plural, maybe with a case ending: házak, almákban
    function plural(w) {
      const k = onlyNoun(w);
      if (!k) return null;
      const lw = lower(w);
      for (const c of ['', ...CASES]) {
        if (!lw.endsWith(c)) continue;
        const rest = lw.slice(0, lw.length - c.length);
        if (!/k$/.test(rest) || /[uü]nk$|[oeö]?tok$|tök$|tek$/.test(rest)) continue;
        const lemma = k.lemmas.find((l) => rest.length > l.length &&
          (rest.startsWith(l) || rest.startsWith(l.slice(0, -1) + ({ a: 'á', e: 'é' })[l.slice(-1)])));
        if (lemma) return { lemma, kase: c };
      }
      return null;
    }
    // an object in the accusative: házat, almát, ezt (not kert, mögött)
    function accusative(w) {
      const k = onlyNoun(w);
      const lw = lower(w);
      if (lw === 'azt' || lw === 'ezt') return true;
      return !!k && /t$/.test(lw) && !k.lemmas.includes(lw);
    }

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const lw = lower(t.w);

      // a pronoun and its verb: ők megy → ők mennek
      if (PRONOUNS[lw]) {
        let j = i;
        let v = next(j);
        while (v && PARTICLES.has(lower(v.w))) { j = toks.indexOf(v); v = next(j); }
        const lemma = v && isVerbForm(v.w);
        const f = lemma && form(v.w, lemma);
        if (f && !f.persons.includes(PRONOUNS[lw])) {
          // "mi" asks "what" too: mi történt?
          const asks = lw === 'mi' && f.persons.every((p) => p[0] === '3');
          if (!asks) out.push({ at: v.at, len: v.w.length, fix: null, rule: 'agree' });
        }
      }

      // a numeral takes the singular: három almák → három alma
      if (QUANT.test(lw)) {
        const n = next(i);
        const p = n && !/^\p{Lu}/u.test(n.w) && plural(n.w);
        if (p) {
          let fix = null;
          if (!p.kase || CONSONANT_CASES.has(p.kase)) {
            const stem = p.kase ? p.lemma.replace(/a$/, 'á').replace(/e$/, 'é') : p.lemma;
            fix = stem + p.kase;
          }
          out.push({ at: n.at, len: n.w.length, fix, rule: 'numeral' });
        }
      }

      // a plural subject with a verb in the singular: a gyerekek játszik
      if (lw === 'a' || lw === 'az') {
        const n = next(i);
        const p = n && plural(n.w);
        const v = p && !p.kase && next(toks.indexOf(n));
        const lemma = v && isVerbForm(v.w);
        if (lemma && lower(v.w) === lemma) out.push({ at: v.at, len: v.w.length, fix: null, rule: 'subject' });
      }

      // the verb agrees with its object: olvasok a könyvet → olvasom;
      // olvasom egy könyvet → olvasok
      const lemma = isVerbForm(t.w);
      const f = lemma && form(t.w, lemma);
      if (f && f.definite !== null && !lemma.endsWith('ik')) {
        const d = next(i);
        const det = d && lower(d.w);
        const obj = (start) => {
          let o = next(toks.indexOf(start));
          if (o && !accusative(o.w)) o = onlyNoun(o.w) ? next(toks.indexOf(o)) : null; // one word between: a régi könyvet
          return o && accusative(o.w) ? o : null;
        };
        if (det && (det === 'a' || det === 'az') && f.definite === false && obj(d)) {
          out.push({ at: t.at, len: t.w.length, fix: null, rule: 'definite' });
        } else if (det === 'egy' && f.definite === true && obj(d)) {
          out.push({ at: t.at, len: t.w.length, fix: null, rule: 'indefinite' });
        } else if ((det === 'azt' || det === 'ezt') && f.definite === false) {
          out.push({ at: t.at, len: t.w.length, fix: null, rule: 'definite' });
        }
      }
    }
    return out;
  }

  return { check };
});

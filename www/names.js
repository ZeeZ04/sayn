// Replaces words the speech engine mishears with names from the user's list.
// Matches by spelling and by a rough sound-alike key, so "abdel aziz" → "Abdul Azeez".
const STOP = new Set(('the and you are was were this that with have has had for not but his her she him they them then than there their ' +
  'what when where who why how can could would should will just also very from into your our out about some been being does did done ' +
  'here more most much only over such well yes yeah okay good like know think want need going come came make made said says time today').split(' '));

const norm = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}]/gu, '');

function soundKey(s) {
  if (!s) return '';
  let t = s.replace(/ph/g, 'f').replace(/ck|q|c/g, 'k').replace(/z/g, 's').replace(/dh|th/g, 't')
    .replace(/kh|gh/g, 'h').replace(/w/g, 'v').replace(/j/g, 'g');
  const first = /[aeiouy]/.test(t[0]) ? 'a' : t[0];
  return (first + t.slice(1).replace(/[aeiouyh]/g, '')).replace(/(.)\1+/g, '$1');
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = [...Array(n + 1).keys()];
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const ratio = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

export function nameScore(cand, name) {
  const a = norm(cand), b = norm(name);
  if (a.length < 3 || b.length < 3) return 0;
  if (a === b) return 1;
  const ka = soundKey(a), kb = soundKey(b);
  const sound = ka.length >= 2 && kb.length >= 2 ? ratio(ka, kb) * 0.95 : 0;
  return Math.max(ratio(a, b), sound);
}

/** @returns {{text:string, marks:Set<number>}} marks = word indexes that are corrected names */
export function fixNames(text, names) {
  const marks = new Set();
  if (!names.length) return { text, marks };
  const words = text.split(/\s+/).filter(Boolean), out = [];
  let i = 0;
  while (i < words.length) {
    let best = null;
    for (const n of names) {
      const nw = n.split(/\s+/).length;
      for (const span of [nw, nw + 1, nw - 1]) {
        if (span < 1 || i + span > words.length) continue;
        const slice = words.slice(i, i + span);
        if (span === 1 && STOP.has(norm(slice[0]))) continue;
        const sc = nameScore(slice.join(''), n);
        if (sc >= 0.78 && (!best || sc > best.sc)) {
          best = { n, span, sc, tail: (slice[slice.length - 1].match(/[^\p{L}\p{N}]+$/u) || [''])[0] };
        }
      }
    }
    if (best) {
      const parts = best.n.split(/\s+/);
      parts.forEach((t, k) => { marks.add(out.length); out.push(t + (k === parts.length - 1 ? best.tail : '')); });
      i += best.span;
    } else { out.push(words[i]); i++; }
  }
  return { text: out.join(' '), marks };
}

/** From several engine guesses, prefer one that already contains a known name. */
export function pickAlternative(alts, names) {
  if (names.length) {
    for (const t of alts) {
      const low = t.toLowerCase();
      if (names.some(n => low.includes(n.toLowerCase()))) return t;
    }
  }
  return alts[0] || '';
}

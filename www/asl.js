// Built-in ASL: A–Z fingerspelling (MLP trained on 36k real landmark samples), numbers 0–9 (finger rules),
// and an ASL-LEX word list for completing fingerspelled words.
let model = null, words = [];

export async function loadASL() {
  if (model) return model;
  const [m, w] = await Promise.all([fetch('asl/letters.json').then(r => r.json()), fetch('asl/words.json').then(r => r.json()).catch(() => [])]);
  model = m; words = w;
  return model;
}
export const aslReady = () => !!model;
export const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
export const NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Same preprocessing as training: pixel x,y relative to wrist, divided by largest absolute value. */
function letterFeatures(lm, vw, vh) {
  const bx = lm[0].x * vw, by = lm[0].y * vh, f = new Array(42);
  let m = 0;
  for (let i = 0; i < 21; i++) {
    const x = lm[i].x * vw - bx, y = lm[i].y * vh - by;
    f[2 * i] = x; f[2 * i + 1] = y;
    m = Math.max(m, Math.abs(x), Math.abs(y));
  }
  m = m || 1;
  for (let i = 0; i < 42; i++) f[i] /= m;
  return f;
}

/** @returns {{label:string|null, p:number}} */
export function readLetter(lm, vw, vh) {
  if (!model) return { label: null, p: 0 };
  let a = letterFeatures(lm, vw, vh);
  const L = model.W.length;
  for (let k = 0; k < L; k++) {
    const W = model.W[k], b = model.b[k], out = b.slice();
    for (let i = 0; i < a.length; i++) {
      const ai = a[i]; if (!ai) continue;
      const row = W[i];
      for (let j = 0; j < out.length; j++) out[j] += ai * row[j];
    }
    a = k < L - 1 ? out.map(v => (v > 0 ? v : 0)) : out;
  }
  const mx = Math.max(...a), ex = a.map(v => Math.exp(v - mx)), s = ex.reduce((x, y) => x + y, 0);
  let bi = 0; for (let i = 1; i < ex.length; i++) if (ex[i] > ex[bi]) bi = i;
  return { label: model.labels[bi], p: ex[bi] / s };
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);
/** Which fingers are straight: tip is clearly farther from the wrist than the middle joint. */
function fingers(lm) {
  const w = lm[0], ext = (tip, pip) => d2(lm[tip], w) > d2(lm[pip], w) * 1.12;
  const palm = d2(lm[5], lm[17]) || 1e-3;
  return {
    thumb: d2(lm[4], lm[5]) > palm * 0.6 && d2(lm[4], lm[17]) > d2(lm[3], lm[17]),
    index: ext(8, 6), middle: ext(12, 10), ring: ext(16, 14), pinky: ext(20, 18),
    touch: tip => d2(lm[4], lm[tip]) < palm * 0.35
  };
}

/** ASL numbers 0–9 from handshape. */
export function readNumber(lm, vw, vh) {
  const f = fingers(lm), up = [f.index, f.middle, f.ring, f.pinky];
  const n = up.filter(Boolean).length;
  let label = null;
  // 6–9: the thumb touches one fingertip while the other three stay up.
  if (n === 3 && !f.pinky && f.touch(20)) label = '6';
  else if (n === 3 && !f.ring && f.touch(16)) label = '7';
  else if (n === 3 && !f.middle && f.touch(12)) label = '8';
  else if (n === 3 && !f.index && f.touch(8)) label = '9';
  else if (n === 0 && f.touch(8)) label = '0';
  else if (f.index && !f.middle && !f.ring && !f.pinky) label = '1';
  else if (f.index && f.middle && !f.ring && !f.pinky) label = f.thumb ? '3' : '2';
  else if (n === 4) label = f.thumb ? '5' : '4';
  else if (n === 3 && !f.pinky) label = '6';
  else if (n === 3 && !f.ring) label = '7';
  else if (n === 3 && !f.middle) label = '8';
  else if (n === 3 && !f.index) label = '9';
  if (!label && model) { const l = readLetter(lm, vw, vh); if (l.label === 'O' && l.p > 0.6) label = '0'; }
  return { label, p: label ? 0.9 : 0 };
}

/** Word suggestions for a fingerspelled prefix. */
export function suggest(prefix, n = 5) {
  const p = prefix.toLowerCase();
  if (p.length < 2) return [];
  const exact = [], starts = [];
  for (const w of words) {
    if (w === p) exact.push(w);
    else if (w.startsWith(p)) starts.push(w);
    if (starts.length > 60) break;
  }
  starts.sort((a, b) => a.length - b.length);
  return [...exact, ...starts].slice(0, n);
}
export const wordCount = () => words.length;

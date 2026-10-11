import { createListener, speak, voicesFor, onSpeaking, isMobile, speechSupported } from './speech.js';
import { fixNames, pickAlternative } from './names.js';
import { camera, loadModel, modelReady, classify, setHold, stats } from './hands.js';
import { loadASL, aslReady, readLetter, readNumber, suggest, LETTERS, NUMBERS, wordCount } from './asl.js';

const VERSION = '1.1.0';
const $ = id => document.getElementById(id);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast('Storage is full. Delete old conversations or signs.'); return false; } };
const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = t => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

const LANGS = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['ar-AE', 'العربية · Arabic (UAE)'], ['ar-SA', 'العربية · Arabic (Saudi)'], ['ar-EG', 'العربية · Arabic (Egypt)'], ['ur-PK', 'اردو · Urdu'], ['hi-IN', 'हिन्दी · Hindi'], ['ml-IN', 'മലയാളം · Malayalam'], ['tl-PH', 'Filipino'], ['fr-FR', 'Français'], ['es-ES', 'Español']];
const DEFAULTS = { lang: 'en-US', size: 26, contrast: false, vibrate: true, wake: true, voice: '', auto: true, flip: false, hold: 14, thresh: 60, theme: 'system', onboarded: false, view: 'phone', mode: 'letters',
  phrases: ['Hello', 'Thank you', 'Please wait a moment', 'Can you repeat that?', 'I am deaf', 'Please write it down', 'How much is it?', 'Where is the bathroom?'] };
const PRESETS = ['HELLO', 'YES', 'NO', 'THANK YOU', 'HELP', 'WATER', 'PLEASE', 'STOP', 'SORRY', 'GOOD'];

const S = { ...DEFAULTS, ...load('sayn.settings', {}) };
let names = load('sayn.names', []);
let samples = load('sayn.samples', []);
let history = load('sayn.history', []);
const saveS = () => save('sayn.settings', S);

/* ---------- Toast ---------- */
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }
function pill(id, state) { $(id).className = 'pill' + (state ? ' ' + state : ''); }

/* ---------- Theme & display ---------- */
function applyTheme() {
  const r = document.documentElement;
  if (S.theme === 'system') delete r.dataset.theme; else r.dataset.theme = S.theme;
  const dark = S.theme === 'dark' || (S.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0B0E13' : '#F2F4F6';
  $$('#sTheme button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.theme));
}
function applyDisplay() {
  document.documentElement.style.setProperty('--cap-size', S.size + 'px');
  $('captions').classList.toggle('contrast', S.contrast);
}

/* ---------- Tabs ---------- */
let tab = 'talk';
function go(name) {
  tab = name;
  $$('.view').forEach(v => v.hidden = v.dataset.tab !== name);
  $$('#tabs button').forEach(b => b.dataset.tab === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  document.body.className = 'tab-' + name;
  if (name === 'history') renderHistory();
  placeCamera();
  if (location.hash !== '#' + name) history_replace('#' + name);
}
function history_replace(h) { try { window.history.replaceState(null, '', h); } catch {} }
$$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));

function setView(v) {
  S.view = v; saveS();
  $('talk').dataset.view = v;
  $$('#viewSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
  placeCamera();
}
$$('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.view));

/* ---------- Conversation sessions ---------- */
let session = null, saveT = null;
function ensureSession() {
  if (!session) { session = { id: Date.now().toString(36), start: Date.now(), end: Date.now(), entries: [] }; history.unshift(session); }
  return session;
}
function logEntry(k, text) {
  const s = ensureSession(); s.entries.push({ k, t: Date.now(), text }); s.end = Date.now();
  clearTimeout(saveT); saveT = setTimeout(persistHistory, 800);
}
function persistHistory() {
  history = history.filter(h => h.entries.length).slice(0, 60);
  save('sayn.history', history);
}
$('newConv').onclick = () => {
  if (session && session.entries.length) { persistHistory(); toast('Saved to History'); }
  session = null; lines.length = 0; renderCaptions(); words = []; renderSentence(false);
};

/* ---------- Captions ---------- */
const lines = []; // {text, marks}
function renderCaptions() {
  const box = $('captions'), interim = $('capInterim');
  box.querySelectorAll('.cap:not(.interim)').forEach(n => n.remove());
  $('capEmpty').hidden = lines.length > 0 || !!interim.textContent;
  lines.slice(-8).forEach((l, i, a) => box.insertBefore(capNode(l, i < a.length - 1), interim));
  box.scrollTop = box.scrollHeight;
  const g = $('gSubs'); g.innerHTML = '';
  lines.slice(-2).forEach((l, i, a) => { const p = el('p', i < a.length - 1 ? 'old' : '', l.text); g.append(p); });
}
function capNode(l, old) {
  const p = el('p', 'cap' + (old ? ' old' : ''));
  l.text.split(/\s+/).forEach((w, i) => {
    if (i) p.append(' ');
    if (l.marks.has(i)) p.append(el('span', 'nm', w)); else p.append(w);
  });
  return p;
}
function addCaption(alts) {
  const raw = pickAlternative(alts, names).trim(); if (!raw) return;
  const { text, marks } = fixNames(raw, names);
  lines.push({ text, marks }); if (lines.length > 60) lines.shift();
  renderCaptions(); logEntry('speech', text);
  if (S.vibrate && navigator.vibrate) navigator.vibrate(18);
  if (uttStart) { lags.push(performance.now() - uttStart); uttStart = 0; const r = lags.slice(-20); $('mLag').textContent = Math.round(r.reduce((a, b) => a + b, 0) / r.length); }
}

/* ---------- Listening ---------- */
let uttStart = 0, wakeLock = null, meter = null;
const lags = [];
const listener = createListener({
  lang: () => S.lang,
  onInterim: t => { if (t && !uttStart) uttStart = performance.now(); $('capInterim').textContent = t; $('capEmpty').hidden = lines.length > 0 || !!t; },
  onFinal: addCaption,
  onState: (s, msg) => {
    const on = listener.isOn();
    pill('pMic', s === 'on' ? 'on' : s === 'wait' ? 'wait' : s === 'err' ? 'err' : '');
    $('micBtn').setAttribute('aria-pressed', on); $('micBtn').setAttribute('aria-label', on ? 'Stop listening' : 'Start listening');
    $('micLabel').textContent = !on ? 'Tap to listen' : s === 'wait' ? 'Reconnecting…' : 'Listening';
    $('liveTag').hidden = !on; $('gHud').textContent = on ? 'LIVE · ' + S.lang.toUpperCase() : 'MIC OFF';
    if (msg) toast(msg);
  }
});
$('micBtn').onclick = () => listener.isOn() ? stopListening() : startListening();
function startListening() {
  if (!speechSupported()) { toast('Speech recognition is not available here. Try Chrome, Edge or Safari.'); return; }
  listener.start(); ensureSession();
  if (S.wake && 'wakeLock' in navigator) navigator.wakeLock.request('screen').then(w => wakeLock = w).catch(() => {});
  // Level meter only on desktop: on phones a second mic stream can break recognition.
  if (!isMobile && !listener.native) startMeter();
}
function stopListening() {
  listener.stop(); stopMeter();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  persistHistory();
}
async function startMeter() {
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 256;
    ac.createMediaStreamSource(st).connect(an);
    meter = { st, ac, an, d: new Uint8Array(an.frequencyBinCount), lvl: 0 };
    const tick = () => {
      if (!meter) return;
      an.getByteFrequencyData(meter.d); let sum = 0; for (let i = 0; i < 48; i++) sum += meter.d[i];
      meter.lvl += (Math.min(1, sum / 48 / 140) - meter.lvl) * .25;
      if (meter.lvl > .18) listener.markLoud();
      $('micBtn').style.setProperty('--lvl', meter.lvl.toFixed(3));
      requestAnimationFrame(tick);
    };
    tick();
  } catch {}
}
function stopMeter() { if (!meter) return; meter.st.getTracks().forEach(t => t.stop()); meter.ac.close(); meter = null; $('micBtn').style.setProperty('--lvl', 0); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && listener.isOn() && S.wake && 'wakeLock' in navigator) navigator.wakeLock.request('screen').then(w => wakeLock = w).catch(() => {});
});

/* ---------- Signed / typed sentence ---------- */
let words = [];
function renderSentence(animate) {
  const s = $('sentence'); s.innerHTML = '';
  words.slice(-14).forEach((w, i, a) => s.append(el('span', animate && i === a.length - 1 ? 'w' : null, (i ? ' ' : '') + w)));
  const g = $('gSign'); g.innerHTML = '';
  if (words.length) g.append(el('p', null, words.slice(-6).join(' ')));
}
function say(text) { if (!speak(text, S.lang, S.voice)) toast('Voice output is not available on this device.'); }
onSpeaking(on => $('speakBtn').classList.toggle('primary', on));
$('speakBtn').onclick = () => words.length ? say(words.join(' ')) : toast('Sign or type something first.');
$('undoBtn').onclick = () => { if (words.length) { words.pop(); lastCommitted = null; renderSentence(false); } };
$('clearBtn').onclick = () => { words = []; lastCommitted = null; renderSentence(false); };
$('typeForm').onsubmit = e => {
  e.preventDefault();
  const t = $('typeIn').value.trim(); if (!t) return;
  words = t.split(/\s+/); renderSentence(true); say(t); logEntry('typed', t); $('typeIn').value = '';
};
function renderPhrases() {
  const box = $('phrases'); box.innerHTML = '';
  S.phrases.forEach(p => { const b = el('button', null, p); b.type = 'button'; b.onclick = () => { words = p.split(/\s+/); renderSentence(true); say(p); logEntry('typed', p); }; box.append(b); });
}

/* Show to partner */
$('showBtn').onclick = () => {
  const t = words.join(' ');
  if (!t) { toast('Sign or type something first.'); return; }
  $('showText').textContent = t; $('show').classList.toggle('flip', S.flip); $('show').hidden = false;
};
$('showClose').onclick = () => $('show').hidden = true;
$('showSpeak').onclick = () => say($('showText').textContent);

/* ---------- Camera ---------- */
function placeCamera() {
  if (!camera.on) return;
  const target = tab === 'signs' ? $('teachCam') : tab === 'talk' ? (S.view === 'glasses' ? $('gCam') : $('talkCam')) : null;
  camera.attach(target);
}
async function cameraOn() {
  if (camera.on) return true;
  try { await camera.start(); }
  catch { pill('pCam', 'err'); toast('Camera blocked. Allow it in your settings, then try again.'); return false; }
  pill('pCam', modelReady() ? 'on' : 'wait');
  $('camToggle').classList.add('on'); $('flipCam').hidden = false; $('camMsg').textContent = 'Loading sign reader…';
  placeCamera(); updateCamUI();
  modelFailed = false;
  loadASL().then(() => { $('aslStatus').textContent = `A–Z · 0–9 · ${wordCount().toLocaleString()} words`; }).catch(() => { $('aslStatus').textContent = 'did not load'; });
  loadModel().then(() => { pill('pCam', 'on'); updateCamUI(); })
    .catch(() => { modelFailed = true; updateCamUI(); pill('pCam', 'err'); toast('Sign reader failed to load. It needs internet the first time.'); });
  return true;
}
function cameraOff() {
  camera.stop(); pill('pCam'); $('camToggle').classList.remove('on'); $('flipCam').hidden = true; setHold(null, 0); updateCamUI();
}
function updateCamUI() {
  $('recBtn').disabled = !(camera.on && modelReady()) || !!recording;
  $('recSub').textContent = !camera.on ? 'Turn on the camera to start.' : !modelReady() ? (modelFailed ? 'Sign reader did not load. Check the internet, then turn the camera off and on.' : 'Loading the sign reader…') : 'Type a word, then tap Record.';
}
$('camToggle').onclick = () => camera.on ? cameraOff() : cameraOn();
$('flipCam').onclick = async () => { try { await camera.flip(); placeCamera(); } catch { toast('Could not switch camera.'); } };
$$('[data-cam-on]').forEach(b => b.onclick = cameraOn);

/* ---------- Signs: teach, read, commit ---------- */
let modelFailed = false;
let recording = null, stable = { label: null, n: 0 }, lastCommitted = null, noHand = 0, readT = 0;
const REC_C = 175.9;
PRESETS.forEach(p => { const b = el('button', null, p); b.type = 'button'; b.onclick = () => { $('labelIn').value = p; }; $('presets').append(b); });
$('labelIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('recBtn').disabled) $('recBtn').click(); });
$('recBtn').onclick = () => {
  const label = $('labelIn').value.trim().toUpperCase().slice(0, 24);
  if (!label) { $('labelIn').focus(); toast('Type the word this sign means.'); return; }
  const t = performance.now();
  recording = { label, start: t + 900, until: t + 2900, got: 0 };
  $('rec').classList.add('prep'); $('recTitle').textContent = 'Get ready…'; $('recSub').textContent = 'Hold the sign for ' + label; updateCamUI();
};
function recTick(t) {
  const bar = $('recBar');
  if (t < recording.start) { bar.style.strokeDashoffset = REC_C * (1 - (t - (recording.start - 900)) / 900); return; }
  $('rec').classList.remove('prep');
  $('recTitle').textContent = 'Recording ' + recording.label; $('recSub').textContent = recording.got + ' frames';
  bar.style.strokeDashoffset = REC_C * (1 - Math.min(1, (t - recording.start) / 2000));
}
function finishRecording() {
  const r = recording; recording = null;
  // Keep at most 240 frames per sign so storage stays small.
  const mine = samples.filter(s => s.label === r.label);
  if (mine.length > 240) { const keep = new Set(mine.filter((_, i) => i % Math.ceil(mine.length / 240) === 0)); samples = samples.filter(s => s.label !== r.label || keep.has(s)); }
  saveSamples();
  $('recBar').style.strokeDashoffset = REC_C; updateCamUI();
  if (r.got) { $('recTitle').textContent = 'Saved ' + r.label; $('recSub').textContent = r.got + ' frames. Record it again from another angle.'; toast('Learned ' + r.label); if (navigator.vibrate) navigator.vibrate([20, 40, 20]); }
  else { $('recTitle').textContent = 'No hand seen'; $('recSub').textContent = 'Keep your whole hand in view and try again.'; }
}
function saveSamples() { save('sayn.samples', samples); renderLearned(); }
function renderLearned() {
  const counts = {}; samples.forEach(s => counts[s.label] = (counts[s.label] || 0) + 1);
  const box = $('learned'); box.innerHTML = '';
  const list = Object.entries(counts).sort();
  if (!list.length) box.append(el('span', 'muted', 'None yet. Built-in ASL letters and numbers work without these.'));
  list.forEach(([l, n]) => {
    const c = el('span', 's', l); c.append(el('em', null, n));
    const x = el('button', null, '✕'); x.setAttribute('aria-label', 'Delete ' + l);
    x.onclick = () => { samples = samples.filter(s => s.label !== l); saveSamples(); toast('Deleted ' + l); };
    c.append(x); box.append(c);
  });
  $('nSamples').textContent = samples.length + ' samples';
  $('camMsg').textContent = 'Turn on the camera and fingerspell, or use your own signs.';
}

function commit(label) {
  words.push(label); lastCommitted = label; renderSentence(true); logEntry('sign', label);
  if (S.auto) say(label);
  if (navigator.vibrate) navigator.vibrate(25);
  onTestCommit(label);
}

/* ---------- Spelling (built-in ASL) ---------- */
let spell = '';
function renderSpell(added) {
  const t = $('spellText'); t.innerHTML = '';
  [...spell].forEach((ch, i) => t.append(el('span', added && i === spell.length - 1 ? 'new' : null, ch)));
  t.scrollLeft = t.scrollWidth;
  const box = $('sugg'); box.innerHTML = '';
  if (/^[A-Z]+$/.test(spell)) suggest(spell).forEach(w => {
    const b = el('button', null, w); b.type = 'button'; b.onclick = () => commitWord(w.toUpperCase()); box.append(b);
  });
}
function commitLetter(ch) {
  spell += ch; renderSpell(true);
  if (navigator.vibrate) navigator.vibrate(12);
  const cell = document.querySelector(`#abc [data-k="${ch}"]`);
  if (cell) { cell.classList.add('hit'); setTimeout(() => cell.classList.remove('hit'), 450); }
  onTestCommit(ch);
}
function commitWord(w) {
  const word = (w || spell).trim(); spell = ''; renderSpell(false);
  if (!word) return;
  words.push(word); renderSentence(true); logEntry('sign', word);
  if (S.auto) say(word.toLowerCase());
}
$('spaceBtn').onclick = () => commitWord();
$('bkspBtn').onclick = () => { spell = spell.slice(0, -1); renderSpell(false); };
function setMode(m) {
  S.mode = m; saveS(); $('talk').dataset.mode = m; lastCommitted = null;
  $$('#signMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
}
$$('#signMode button').forEach(b => b.onclick = () => setMode(b.dataset.m));
function renderABC() {
  const box = $('abc'); box.innerHTML = '';
  [...LETTERS, ...NUMBERS].forEach(k => { const c = el('span', null, k); c.dataset.k = k; box.append(c); });
}

camera.onFrame((f, t, lm, vw, vh) => {
  if (recording) recTick(t);
  if (!f) {
    noHand++;
    if (noHand > 8) { lastCommitted = null; stable = { label: null, n: 0 }; setHold(null, 0); }
    if (noHand === 30 && spell) commitWord(); // hand lowered for ~1 s: the spelled word is done
    if (recording && t > recording.until) finishRecording();
    return;
  }
  noHand = 0;
  if (recording && t >= recording.start) {
    samples.push({ label: recording.label, f }); recording.got++;
    if (t > recording.until) finishRecording();
    setHold(null, 0); return '#FF6B6B';
  }
  if (recording) return;

  // Your own signs are checked first; then the built-in alphabet or numbers.
  let read = { label: null, kind: null, info: '' };
  if (samples.length) {
    const p = classify(f, samples, S.thresh / 100);
    if (p.label) read = { label: p.label, kind: 'custom', info: `your sign · distance ${p.dist.toFixed(2)}` };
  }
  if (!read.label && S.mode !== 'custom' && aslReady()) {
    const p = S.mode === 'numbers' ? readNumber(lm, vw, vh) : readLetter(lm, vw, vh);
    if (p.label && p.p >= 0.7) read = { label: p.label, kind: 'spell', info: `ASL · ${Math.round(p.p * 100)}% sure` };
    else if (p.label) read.info = `maybe ${p.label} (${Math.round(p.p * 100)}%)`;
  }
  if (t - readT > 150) {
    readT = t; const r = $('reading'); r.textContent = 'Reading: ';
    r.append(el('b', null, read.label || 'no match'), read.info ? ' · ' + read.info : '');
    $('mFps').textContent = stats.fps;
  }
  const key = read.label ? read.kind + ':' + read.label : null;
  if (key && key === stable.label) stable.n++; else stable = { label: key, n: 1 };
  if (!key) { lastCommitted = null; setHold(null, 0); return '#8FB8FF'; }
  const hold = read.kind === 'spell' ? Math.max(5, Math.round(S.hold * 0.8)) : S.hold;
  if (key !== lastCommitted) {
    setHold(read.label, stable.n / hold);
    if (stable.n >= hold) { read.kind === 'spell' ? commitLetter(read.label) : commit(read.label); lastCommitted = key; stable.n = 0; setHold(null, 0); }
  } else if (read.kind === 'spell') {
    // Double letters (the two Ls in HELLO): keep holding for another full beat.
    setHold(read.label, stable.n / (hold * 2));
    if (stable.n >= hold * 2) { commitLetter(read.label); stable.n = 0; setHold(null, 0); }
  } else setHold(null, 0);
  return read.kind === 'custom' ? '#FFB43D' : '#7CE0B4';
});

/* ---------- Accuracy test ---------- */
let test = null;
$('testBtn').onclick = async () => {
  if (test) { endTest(true); return; }
  const set = $('testSet').value;
  const labels = set === 'letters' ? LETTERS.filter(l => l !== 'J' && l !== 'Z') : set === 'numbers' ? NUMBERS : [...new Set(samples.map(s => s.label))];
  if (labels.length < 2) { toast('Teach at least two of your own signs first.'); return; }
  if (set !== 'custom') { setMode(set); spell = ''; renderSpell(false); }
  if (!(await cameraOn())) return;
  test = { round: 0, correct: 0, labels }; $('testBtn').textContent = 'Stop test'; $('testCall').hidden = false; nextRound();
};
function nextRound() {
  clearTimeout(test.timer);
  if (test.round >= 10) { endTest(false); return; }
  test.round++; test.answered = false; lastCommitted = null;
  test.target = test.labels[Math.floor(Math.random() * test.labels.length)];
  $('testCall').textContent = 'Sign: ' + test.target; $('testInfo').textContent = `Round ${test.round} of 10`;
  $('testFill').style.width = (test.round - 1) * 10 + '%';
  test.timer = setTimeout(() => { if (test) nextRound(); }, 5000);
}
function onTestCommit(label) {
  if (!test || test.answered) return;
  test.answered = true; if (label === test.target) test.correct++;
  if (spell) { spell = ''; renderSpell(false); }
  $('mAcc').textContent = Math.round(test.correct / test.round * 100) + '%';
  $('testCall').textContent = label === test.target ? '✓ Correct' : '✗ Read as ' + label;
  clearTimeout(test.timer); test.timer = setTimeout(() => { if (test) nextRound(); }, 900);
}
function endTest(stopped) {
  clearTimeout(test.timer);
  if (!stopped) { $('mAcc').textContent = test.correct * 10 + '%'; $('testFill').style.width = '100%'; toast(`${test.correct} of 10 correct`); }
  $('testInfo').textContent = stopped ? 'Stopped' : `${test.correct} of 10 correct`;
  test = null; $('testBtn').textContent = 'Start test'; $('testCall').hidden = true;
}

/* ---------- History ---------- */
function renderHistory() {
  const ul = $('historyList'); ul.innerHTML = '';
  const list = history.filter(h => h.entries.length);
  if (!list.length) { ul.append(el('li', 'empty', 'No conversations yet. They are saved here automatically.')); return; }
  list.forEach((h, i) => {
    const li = el('li'), b = el('button'); b.type = 'button'; b.style.animationDelay = Math.min(i, 8) * 40 + 'ms';
    const meta = el('span', 'meta'); meta.append(el('span', null, fmtDate(h.start) + ' · ' + fmtTime(h.start)), el('span', null, h.entries.length + ' lines'));
    b.append(meta, el('span', 'prev', h.entries.slice(0, 3).map(e => e.text).join(' · ')));
    b.onclick = () => openHistory(h); li.append(b); ul.append(li);
  });
}
let openH = null;
const LABEL = { speech: 'They said', sign: 'You signed', typed: 'You typed' };
function openHistory(h) {
  openH = h; $('histTitle').textContent = fmtDate(h.start) + ', ' + fmtTime(h.start);
  const ol = $('histBody'); ol.innerHTML = '';
  h.entries.forEach(e => { const li = el('li', 'bubble ' + e.k); li.append(el('small', null, LABEL[e.k] + ' · ' + fmtTime(e.t)), el('span', null, e.text)); ol.append(li); });
  $('histShare').hidden = !navigator.share; $('histDlg').showModal();
}
const histText = h => h.entries.map(e => `[${fmtTime(e.t)}] ${LABEL[e.k]}: ${e.text}`).join('\n');
$('histClose').onclick = () => $('histDlg').close();
$('histCopy').onclick = async () => { try { await navigator.clipboard.writeText(histText(openH)); toast('Copied'); } catch { toast('Copy is not allowed here.'); } };
$('histShare').onclick = () => navigator.share({ title: 'Sayn conversation', text: histText(openH) }).catch(() => {});
let delArmed = false;
$('histDelete').onclick = () => {
  if (!delArmed) { delArmed = true; $('histDelete').textContent = 'Tap again to delete'; setTimeout(() => { delArmed = false; $('histDelete').textContent = 'Delete'; }, 3000); return; }
  history = history.filter(h => h !== openH); if (session === openH) session = null;
  persistHistory(); $('histDlg').close(); renderHistory(); delArmed = false; $('histDelete').textContent = 'Delete'; toast('Deleted');
};

/* ---------- Names ---------- */
function renderNames() {
  const box = $('namesList'); box.innerHTML = '';
  if (!names.length) box.append(el('span', 'muted', 'No names yet.'));
  names.forEach(n => {
    const c = el('span', 's n', n), x = el('button', null, '✕'); x.setAttribute('aria-label', 'Remove ' + n);
    x.onclick = () => { names = names.filter(m => m !== n); save('sayn.names', names); renderNames(); };
    c.append(x); box.append(c);
  });
}
function addNames() {
  const add = $('nameIn').value.split(/[,\n]/).map(t => t.trim().replace(/\s+/g, ' ')).filter(t => t.length >= 2);
  add.forEach(t => { if (!names.some(n => n.toLowerCase() === t.toLowerCase())) names.push(t); });
  save('sayn.names', names); $('nameIn').value = ''; renderNames();
  if (add.length) toast(`Added ${add.length} name${add.length > 1 ? 's' : ''}`);
}
$('nameAdd').onclick = addNames;
$('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNames(); } });

/* ---------- Settings ---------- */
function fillLangs(sel) { sel.innerHTML = ''; LANGS.forEach(([v, l]) => sel.append(new Option(l, v))); sel.value = S.lang; }
function fillVoices() {
  const sel = $('sVoice'), vs = voicesFor(S.lang); sel.innerHTML = '';
  sel.append(new Option('Automatic', ''));
  vs.forEach(v => sel.append(new Option(`${v.name} (${v.lang})`, v.voiceURI)));
  sel.value = vs.some(v => v.voiceURI === S.voice) ? S.voice : '';
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
function bindSettings() {
  fillLangs($('sLang')); fillLangs($('obLang')); fillVoices();
  const setLang = v => { S.lang = v; saveS(); $('sLang').value = $('obLang').value = v; fillVoices(); if (listener.isOn()) { listener.stop(); listener.start(); } };
  $('sLang').onchange = e => setLang(e.target.value);
  $('obLang').onchange = e => setLang(e.target.value);
  $('sVoice').onchange = e => { S.voice = e.target.value; saveS(); say('This is my voice'); };
  $('sSize').value = S.size; $('sSize').oninput = e => { S.size = +e.target.value; applyDisplay(); saveS(); };
  const sw = (id, key, after) => { $(id).checked = S[key]; $(id).onchange = e => { S[key] = e.target.checked; saveS(); after && after(); }; };
  sw('sContrast', 'contrast', applyDisplay); sw('sVibrate', 'vibrate'); sw('sWake', 'wake'); sw('sAuto', 'auto'); sw('sFlip', 'flip');
  $('sPhrases').value = S.phrases.join('\n');
  $('sPhrases').onchange = e => { S.phrases = e.target.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 30); saveS(); renderPhrases(); };
  const showHold = () => $('holdV').textContent = S.hold + ' frames', showTh = () => $('threshV').textContent = (S.thresh / 100).toFixed(2);
  $('sHold').value = S.hold; $('sHold').oninput = e => { S.hold = +e.target.value; showHold(); saveS(); }; showHold();
  $('sThresh').value = S.thresh; $('sThresh').oninput = e => { S.thresh = +e.target.value; showTh(); saveS(); }; showTh();
  $$('#sTheme button').forEach(b => b.onclick = () => { S.theme = b.dataset.v; saveS(); applyTheme(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $('about').textContent = `Sayn ${VERSION} · ${window.Capacitor?.isNativePlatform?.() ? window.Capacitor.getPlatform() + ' app' : 'web app'}`;
}

/* Backup / restore / wipe */
$('exportBtn').onclick = async () => {
  const data = JSON.stringify({ app: 'sayn', version: VERSION, settings: S, names, samples, history }, null, 0);
  const file = new File([data], 'sayn-backup.json', { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Sayn backup' }); return; } catch {} }
  const a = el('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); toast('Backup saved');
};
$('importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'sayn') throw 0;
    if (Array.isArray(d.samples)) samples = d.samples.filter(s => typeof s.label === 'string' && Array.isArray(s.f) && s.f.length === 63);
    if (Array.isArray(d.names)) names = d.names.filter(n => typeof n === 'string');
    if (Array.isArray(d.history)) history = d.history;
    if (d.settings) Object.assign(S, d.settings);
    save('sayn.samples', samples); save('sayn.names', names); persistHistory(); saveS();
    toast('Restored. Reloading…'); setTimeout(() => location.reload(), 800);
  } catch { toast('That file is not a Sayn backup.'); }
};
let wipeArmed = false;
$('wipeBtn').onclick = () => {
  if (!wipeArmed) { wipeArmed = true; $('wipeBtn').textContent = 'Tap again to delete everything'; setTimeout(() => { wipeArmed = false; $('wipeBtn').textContent = 'Delete everything'; }, 3000); return; }
  ['sayn.settings', 'sayn.names', 'sayn.samples', 'sayn.history'].forEach(k => { try { localStorage.removeItem(k); } catch {} });
  location.reload();
};

/* ---------- Onboarding ---------- */
function onboarding() {
  const ob = $('onboard'), track = $('obTrack'), dots = [...$('obDots').children];
  ob.hidden = false;
  let i = 0;
  const sync = () => {
    i = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    $('obNext').textContent = i === 2 ? 'Allow and start' : 'Next';
  };
  track.addEventListener('scroll', () => requestAnimationFrame(sync)); sync();
  const done = () => { S.onboarded = true; saveS(); ob.hidden = true; };
  $('obSkip').onclick = done;
  $('obNext').onclick = async () => {
    if (i < 2) { track.scrollTo({ left: (i + 1) * track.clientWidth, behavior: 'smooth' }); return; }
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); st.getTracks().forEach(t => t.stop()); }
    catch { toast('You can allow the mic and camera later.'); }
    done();
  };
}

/* ---------- Boot ---------- */
function boot() {
  applyTheme(); applyDisplay(); bindSettings();
  renderPhrases(); renderLearned(); renderNames(); renderCaptions(); renderSentence(false);
  setView(S.view); setMode(S.mode); renderABC(); renderSpell(false);
  const start = (location.hash || '#talk').slice(1);
  go(['talk', 'signs', 'history', 'settings'].includes(start) ? start : 'talk');
  if (!S.onboarded) onboarding();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Warm the sign reader in the background once the app is idle.
  if (samples.length) (window.requestIdleCallback || setTimeout)(() => loadModel().catch(() => {}), 3000);
}
boot();
const fontsReady = document.fonts ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
fontsReady.then(() => window.__saynReady && window.__saynReady());
window.addEventListener('pagehide', persistHistory);

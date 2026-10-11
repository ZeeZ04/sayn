// Camera, MediaPipe hand tracking and a small nearest-neighbour sign classifier.
// One camera stream feeds a hidden video for detection and a visible "bundle" (video + skeleton + hold ring)
// that is moved into whichever screen is showing.

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

const src = document.getElementById('vSrc');
const bundle = document.createElement('div');
bundle.className = 'cam-live';
bundle.innerHTML = '<video muted playsinline></video><canvas></canvas><div class="hold"><svg viewBox="0 0 32 32"><circle class="trk" cx="16" cy="16" r="14"/><circle class="bar" cx="16" cy="16" r="14"/></svg><b></b></div>';
bundle.style.cssText = 'position:absolute;inset:0';
const view = bundle.querySelector('video'), cvs = bundle.querySelector('canvas'), ctx = cvs.getContext('2d');
const holdEl = bundle.querySelector('.hold'), holdBar = holdEl.querySelector('.bar'), holdTxt = holdEl.querySelector('b');

let stream = null, facing = 'user', landmarker = null, loading = null, raf = 0, lastT = -1;
let frameCb = null, host = null;
export const stats = { fps: 0 };
let frames = 0, fpsT = performance.now();

export const camera = {
  get on() { return !!stream; },
  get facing() { return facing; },
  async start(face = facing) {
    if (stream) this.stop(true);
    facing = face;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    src.srcObject = stream; view.srcObject = stream;
    await src.play().catch(() => {}); view.play().catch(() => {});
    if (host) host.classList.toggle('mirror', facing === 'user');
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    return stream;
  },
  stop(keepLoop) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; src.srcObject = null; view.srcObject = null;
    if (!keepLoop) cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, cvs.width, cvs.height); setHold(null, 0);
    bundle.remove(); host && host.classList.remove('live');
  },
  flip() { return this.start(facing === 'user' ? 'environment' : 'user'); },
  /** Show the live feed inside `el` (a .cam or .lens container). */
  attach(el) {
    if (!stream || !el) { bundle.remove(); host && host.classList.remove('live'); host = el; return; }
    if (host && host !== el) host.classList.remove('live');
    host = el; el.classList.add('live');
    if (bundle.parentElement !== el) el.prepend(bundle);
    el.classList.toggle('mirror', facing === 'user');
    view.play().catch(() => {});
  },
  onFrame(cb) { frameCb = cb; }
};

export function loadModel() {
  if (landmarker) return Promise.resolve(landmarker);
  if (loading) return loading;
  loading = (async () => {
    const { HandLandmarker, FilesetResolver } = await import(MP);
    const fs = await FilesetResolver.forVisionTasks(MP + '/wasm');
    const make = delegate => HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 1 });
    try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
    return landmarker;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
export const modelReady = () => !!landmarker;

export function setHold(label, p) {
  holdEl.classList.toggle('show', !!label);
  holdBar.style.strokeDashoffset = 88 * (1 - Math.min(1, p));
  holdTxt.textContent = label || '';
}

function draw(lm, color) {
  const w = bundle.clientWidth, h = bundle.clientHeight;
  if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
  ctx.clearRect(0, 0, w, h);
  if (!lm || !src.videoWidth || !w) return;
  const vw = src.videoWidth, vh = src.videoHeight, s = Math.max(w / vw, h / vh);
  const ox = (w - vw * s) / 2, oy = (h - vh * s) / 2;
  const P = p => [p.x * vw * s + ox, p.y * vh * s + oy];
  ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  for (const [a, b] of CONN) { const [x1, y1] = P(lm[a]), [x2, y2] = P(lm[b]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  ctx.shadowBlur = 0;
  for (const p of lm) { const [x, y] = P(p); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); }
}

function loop() {
  raf = requestAnimationFrame(loop);
  if (!stream || !landmarker || src.readyState < 2 || src.currentTime === lastT) return;
  lastT = src.currentTime;
  const t = performance.now();
  let res = null;
  try { res = landmarker.detectForVideo(src, t); } catch {}
  frames++;
  if (t - fpsT > 1000) { stats.fps = frames; frames = 0; fpsT = t; }
  const lm = res?.landmarks?.[0] || null;
  let color = '#8FB8FF';
  if (lm) {
    const hd = (res.handednesses || res.handedness || [])[0];
    // With the front camera the image is mirrored, so MediaPipe's "Left" is the signer's right hand.
    const left = hd?.[0]?.categoryName === 'Left';
    const f = features(lm, facing === 'user' ? left : !left);
    color = frameCb ? (frameCb(f, t, lm, src.videoWidth, src.videoHeight) || color) : color;
  } else if (frameCb) frameCb(null, t);
  draw(lm, color);
}

/** 21 landmarks relative to the wrist, scale-normalised; left hands mirrored so either hand works. */
export function features(lm, mirror) {
  const w = lm[0];
  let pts = lm.map(p => [p.x - w.x, p.y - w.y, p.z - w.z]);
  if (mirror) pts = pts.map(p => [-p[0], p[1], p[2]]);
  let s = 0; for (const p of pts) s = Math.max(s, Math.hypot(p[0], p[1]));
  s = s || 1;
  return pts.flatMap(p => [+(p[0] / s).toFixed(3), +(p[1] / s).toFixed(3), +(p[2] / s).toFixed(3)]);
}

/** k-nearest-neighbour vote. Returns label only when close enough and most neighbours agree. */
export function classify(f, samples, strict) {
  if (samples.length < 5) return { label: null, dist: Infinity, conf: 0 };
  const labels = new Set(); for (const s of samples) labels.add(s.label);
  if (labels.size < 2) return { label: null, dist: Infinity, conf: 0 };
  const d = new Array(samples.length);
  for (let k = 0; k < samples.length; k++) {
    const g = samples[k].f; let t = 0;
    for (let i = 0; i < 63; i++) { const q = f[i] - g[i]; t += q * q; }
    d[k] = [Math.sqrt(t), samples[k].label];
  }
  d.sort((a, b) => a[0] - b[0]);
  const k = Math.min(7, d.length), top = d.slice(0, k), votes = {};
  for (const [, l] of top) votes[l] = (votes[l] || 0) + 1;
  const [label, v] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const dist = top.filter(t => t[1] === label).reduce((a, t) => a + t[0], 0) / v;
  if (dist > strict || v / k < 0.6) return { label: null, dist, conf: v / k };
  return { label, dist, conf: v / k };
}

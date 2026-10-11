// Speech → text with one interface for the browser and for the native iOS/Android app.
// Browser: Web Speech API, restarted automatically because engines stop on pauses or go silent.
// Native (Capacitor): @capacitor-community/speech-recognition, also restarted after each phrase.

const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

export function speechSupported() {
  if (isNative()) return !!window.Capacitor.Plugins?.SpeechRecognition;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * @param {{lang:()=>string, onInterim:(t:string)=>void, onFinal:(alts:string[])=>void,
 *          onState:(s:'off'|'on'|'wait'|'err', msg?:string)=>void}} h
 */
export function createListener(h) {
  return isNative() ? nativeListener(h) : webListener(h);
}

function webListener(h) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, on = false, restartT = null, watchdog = null, netFails = 0;
  let lastHeard = 0, lastLoud = 0, interim = '';

  const flush = () => { if (interim.trim()) h.onFinal([interim.trim()]); interim = ''; h.onInterim(''); };

  function make() {
    const r = new SR();
    r.lang = h.lang(); r.continuous = true; r.interimResults = true; r.maxAlternatives = 5;
    r.onstart = () => { if (r === rec) { lastHeard = performance.now(); h.onState('on'); } };
    r.onresult = e => {
      if (r !== rec) return;
      lastHeard = performance.now(); netFails = 0;
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) { interim = ''; h.onFinal([...res].map(a => a.transcript.trim()).filter(Boolean)); }
        else live += res[0].transcript;
      }
      interim = live; h.onInterim(live.trim());
    };
    r.onerror = e => {
      if (r !== rec) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop(); h.onState('err', 'Microphone blocked. Allow it in your browser settings.'); }
      else if (e.error === 'audio-capture') { stop(); h.onState('err', 'No microphone found.'); }
      else if (e.error === 'network') { netFails++; if (netFails === 2) h.onState('wait', 'Speech service unreachable. Retrying…'); }
      else if (e.error === 'language-not-supported') { stop(); h.onState('err', 'This language is not supported on this device.'); }
    };
    r.onend = () => { if (r !== rec) return; flush(); if (on) schedule(netFails ? Math.min(5000, 500 * netFails) : 150); };
    return r;
  }
  function schedule(ms) {
    clearTimeout(restartT); h.onState('wait');
    restartT = setTimeout(() => {
      if (!on) return;
      rec = make();
      try { rec.start(); } catch { schedule(1000); }
    }, ms);
  }
  function force() { const old = rec; rec = null; flush(); try { old && old.abort(); } catch {} schedule(200); }

  function start() {
    if (!SR) { h.onState('err', 'Speech recognition is not available in this browser. Use Chrome, Edge or Safari.'); return; }
    on = true; netFails = 0;
    rec = make();
    try { rec.start(); } catch { schedule(500); }
    lastHeard = lastLoud = performance.now();
    clearInterval(watchdog);
    // Restart if you are clearly talking but nothing comes back for 4 s, or nothing at all for 45 s.
    watchdog = setInterval(() => {
      if (!on || !rec) return;
      const t = performance.now();
      const stuck = lastLoud - lastHeard > 4000 && t - lastLoud < 1500;
      if (stuck || t - lastHeard > 45000) force();
    }, 1000);
  }
  function stop() {
    on = false; clearTimeout(restartT); clearInterval(watchdog);
    const old = rec; rec = null; flush();
    try { old && old.stop(); } catch {}
    h.onState('off');
  }
  return { start, stop, isOn: () => on, markLoud: () => { lastLoud = performance.now(); }, native: false };
}

function nativeListener(h) {
  const SR = window.Capacitor.Plugins.SpeechRecognition;
  let on = false, restartT = null, last = [], subs = [];

  async function begin() {
    try {
      await SR.start({ language: h.lang(), maxResults: 5, partialResults: true, popup: false });
      h.onState('on');
    } catch (e) {
      if (on) { h.onState('wait'); clearTimeout(restartT); restartT = setTimeout(begin, 800); }
    }
  }
  async function start() {
    if (!SR) { h.onState('err', 'Speech plugin missing from this build.'); return; }
    try {
      const av = await SR.available();
      if (!av.available) { h.onState('err', 'Speech recognition is not available on this device.'); return; }
      const p = await SR.requestPermissions();
      if (p.speechRecognition !== 'granted') { h.onState('err', 'Allow speech recognition and the microphone in Settings.'); return; }
    } catch {}
    on = true;
    subs.push(await SR.addListener('partialResults', d => { last = d.matches || []; h.onInterim(last[0] || ''); }));
    subs.push(await SR.addListener('listeningState', d => {
      if (d.status !== 'stopped') return;
      if (last.length) h.onFinal(last.filter(Boolean));
      last = []; h.onInterim('');
      if (on) { h.onState('wait'); clearTimeout(restartT); restartT = setTimeout(begin, 120); }
    }));
    begin();
  }
  async function stop() {
    on = false; clearTimeout(restartT);
    try { await SR.stop(); } catch {}
    subs.forEach(s => s.remove && s.remove()); subs = [];
    if (last.length) h.onFinal(last.filter(Boolean));
    last = []; h.onInterim(''); h.onState('off');
  }
  return { start, stop, isOn: () => on, markLoud() {}, native: true };
}

// ---------- Text to speech ----------
let speakingCb = null;
export function onSpeaking(cb) { speakingCb = cb; }
export function voicesFor(lang) {
  if (!('speechSynthesis' in window)) return [];
  const base = (lang || 'en').slice(0, 2);
  return speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(base));
}
export function speak(text, lang, voiceURI) {
  if (!text || !('speechSynthesis' in window)) return false;
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const v = voices.find(x => x.voiceURI === voiceURI) || voicesFor(lang)[0];
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang;
  u.onstart = () => speakingCb && speakingCb(true);
  u.onend = u.onerror = () => speakingCb && speakingCb(false);
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  return true;
}

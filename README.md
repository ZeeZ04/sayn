# Sayn

Live subtitles for what people say, and text and voice for what a deaf person signs or types.
One codebase runs as a web app, an installable phone app (PWA), and native iOS / Android apps (Capacitor).

## What's in the app
- **Talk** – live subtitles (name correction, large text, high contrast), sign-to-text with voice, type-to-speak, quick phrases, a full-screen **Show** card for the other person (can flip upside down for across a table), and a **Glasses** preview of both lenses.
- **Signs** – teach your own signs, see what the reader sees, and run a 10-round accuracy test.
- **History** – every conversation saved on the device; copy, share or delete.
- **Settings** – language, names list, subtitle size, contrast, vibration, keep-screen-on, voice, quick phrases, sign tuning, theme, backup / restore.
- Works offline after the first load, except speech recognition in the browser (needs internet).

## 1. Run it on your computer
```
cd sayn
python -m http.server 8080 -d www
```
Open http://localhost:8080 in Chrome or Edge.

## 2. Put it on your phone (fastest: web app)
Phones only allow the mic and camera on **https** sites, so host the `www` folder:
1. Go to https://app.netlify.com/drop and drag the `www` folder onto the page. You get an https link.
2. Open the link on your phone.
   - **Android (Chrome):** menu ⋮ → *Add to Home screen* / *Install app*.
   - **iPhone (Safari):** Share → *Add to Home Screen*.

## 3. Build the native apps
Needs Node.js 18+.
```
cd sayn
npm install
```
**Android** (needs Android Studio):
```
npm run android
```
Android Studio opens. Plug in your phone with USB debugging on and press ▶ Run, or use *Build → Build APK(s)* to get an installable .apk.

**iPhone** (needs a Mac with Xcode):
```
npm run ios
```
Xcode opens. Choose your team under *Signing & Capabilities*, plug in your iPhone and press ▶ Run.

After changing anything in `www/`, run `npm run sync` to copy it into the native apps.

The native apps use the phone's built-in speech recognition through `@capacitor-community/speech-recognition`
(more reliable than the browser engine on phones). The required permission texts are added by `scripts/native-permissions.mjs`.

## Known limits
- Sign reading learns **still hand shapes** that you teach it. Moving signs and full sentences need a trained sequence model (next phase).
- Browser speech recognition sends audio to Google (Chrome) or Apple (Safari). The native apps can use on-device recognition where the phone supports it.
- On Android Chrome the system may beep each time listening restarts. The native app avoids most of this.

## Files
```
www/index.html     app shell + animated loading screen
www/styles.css     design (light + dark)
www/app.js         screens, conversation, history, settings
www/speech.js      speech recognition (browser + native) and text-to-speech
www/hands.js       camera, hand tracking, sign classifier
www/names.js       name correction
www/sw.js          offline cache
capacitor.config.json, android/   native project (iOS is created by `npm run ios`)
scripts/           icons, permissions, smoke test
```

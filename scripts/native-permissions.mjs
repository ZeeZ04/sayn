// Adds the camera, microphone and speech permissions to the native projects after `npx cap add`.
// Safe to run more than once.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest)) {
  let x = readFileSync(manifest, 'utf8');
  const perms = ['android.permission.RECORD_AUDIO', 'android.permission.CAMERA', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.INTERNET'];
  for (const p of perms) if (!x.includes(`"${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  if (!x.includes('android.speech.RecognitionService')) {
    x = x.replace('</manifest>', '    <queries>\n        <intent>\n            <action android:name="android.speech.RecognitionService" />\n        </intent>\n    </queries>\n</manifest>');
  }
  writeFileSync(manifest, x); console.log('Android permissions added');
}

const plist = 'ios/App/App/Info.plist';
if (existsSync(plist)) {
  let x = readFileSync(plist, 'utf8');
  const keys = {
    NSMicrophoneUsageDescription: 'Sayn listens to people around you to show subtitles.',
    NSSpeechRecognitionUsageDescription: 'Sayn turns speech into subtitles.',
    NSCameraUsageDescription: 'Sayn reads your signs with the camera. Video is never saved.'
  };
  for (const [k, v] of Object.entries(keys)) if (!x.includes(`<key>${k}</key>`)) x = x.replace(/<dict>/, `<dict>\n\t<key>${k}</key>\n\t<string>${v}</string>`);
  writeFileSync(plist, x); console.log('iOS permissions added');
}

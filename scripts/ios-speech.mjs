// Adds Sayn's built-in iOS speech plugin (Apple Speech framework) to the Xcode project.
// It lives in AppDelegate.swift so no project-file edits are needed, and it exposes the same
// JavaScript API as @capacitor-community/speech-recognition, which Android still uses.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const delegate = 'ios/App/App/AppDelegate.swift';
const board = 'ios/App/App/Base.lproj/Main.storyboard';
if (!existsSync(delegate)) { console.log('No iOS project yet. Run: npx cap add ios --packagemanager SPM'); process.exit(0); }

const MARK = '// --- Sayn speech plugin ---';
let d = readFileSync(delegate, 'utf8');
if (!d.includes(MARK)) {
  d = d.replace('import Capacitor', 'import Capacitor\nimport Speech\nimport AVFoundation');
  d += `
${MARK}
/// Main view controller: registers the in-app plugins.
class SaynViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SaynSpeechPlugin())
    }
}

/// Live speech recognition with partial results. JS name: SpeechRecognition.
@objc(SaynSpeechPlugin)
public class SaynSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SaynSpeechPlugin"
    public let jsName = "SpeechRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": SFSpeechRecognizer()?.isAvailable ?? false])
    }

    private func state() -> String {
        let s = SFSpeechRecognizer.authorizationStatus()
        let m = AVAudioSession.sharedInstance().recordPermission
        if s == .authorized && m == .granted { return "granted" }
        if s == .denied || s == .restricted || m == .denied { return "denied" }
        return "prompt"
    }
    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["speechRecognition": state()])
    }
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { _ in
            AVAudioSession.sharedInstance().requestRecordPermission { _ in
                call.resolve(["speechRecognition": self.state()])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        let lang = call.getString("language") ?? Locale.current.identifier
        let maxResults = call.getInt("maxResults") ?? 5
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)), recognizer.isAvailable else {
            call.reject("Speech recognition is not available for \\(lang)"); return
        }
        DispatchQueue.main.async {
            self.teardown()
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth, .duckOthers])
                try session.setActive(true, options: .notifyOthersOnDeactivation)
                let req = SFSpeechAudioBufferRecognitionRequest()
                req.shouldReportPartialResults = true
                if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = false }
                self.request = req
                let input = self.engine.inputNode
                let format = input.outputFormat(forBus: 0)
                input.removeTap(onBus: 0)
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
                self.engine.prepare()
                try self.engine.start()
                self.notifyListeners("listeningState", data: ["status": "started"])
                self.task = recognizer.recognitionTask(with: req) { result, error in
                    if let result = result {
                        let matches = result.transcriptions.prefix(maxResults).map { $0.formattedString }
                        self.notifyListeners("partialResults", data: ["matches": Array(matches)])
                        if result.isFinal { DispatchQueue.main.async { self.finish() } }
                    }
                    if error != nil { DispatchQueue.main.async { self.finish() } }
                }
                call.resolve()
            } catch {
                self.teardown()
                call.reject("Could not start listening: \\(error.localizedDescription)")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.finish(); call.resolve() }
    }

    private func finish() {
        guard request != nil || engine.isRunning else { return }
        teardown()
        notifyListeners("listeningState", data: ["status": "stopped"])
    }
    private func teardown() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
    }
}
`;
  writeFileSync(delegate, d);
  console.log('iOS speech plugin added');
}

if (existsSync(board)) {
  let b = readFileSync(board, 'utf8');
  if (!b.includes('customClass="SaynViewController"')) {
    b = b.replace(/customClass="CAPBridgeViewController" customModule="Capacitor"/, 'customClass="SaynViewController" customModule="App" customModuleProvider="target"');
    writeFileSync(board, b);
    console.log('Main view controller set');
  }
}

import UIKit
import Capacitor
import Speech
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// --- Sayn speech plugin ---
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
            call.reject("Speech recognition is not available for \(lang)"); return
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
                call.reject("Could not start listening: \(error.localizedDescription)")
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

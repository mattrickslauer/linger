import Foundation

/// Runtime switches. Emulator mode can be turned on three ways:
///  - scheme env var `USE_EMULATOR=1` (+ `EMULATOR_HOST`, default 127.0.0.1 for the simulator)
///  - launch arguments `-useEmulator YES -emulatorHost 192.168.1.20` (device on the same Wi-Fi)
///  - the toggle in Me > Developer (takes effect on next launch)
enum AppConfig {
  private static var env: [String: String] { ProcessInfo.processInfo.environment }

  static var useEmulator: Bool {
    if env["USE_EMULATOR"] == "1" { return true }
    return UserDefaults.standard.bool(forKey: "useEmulator")
  }

  static var emulatorHost: String {
    if let h = env["EMULATOR_HOST"], !h.isEmpty, env["USE_EMULATOR"] == "1" { return h }
    return UserDefaults.standard.string(forKey: "emulatorHost") ?? "127.0.0.1"
  }

  static let authEmulatorPort = 9099
  static let firestoreEmulatorPort = 8080
  static let functionsEmulatorPort = 5001
  static let storageEmulatorPort = 9199

  /// Remote Config key `cloud_model` (contract default).
  static let defaultCloudModel = "gemini-3.5-flash"

  static var appVersion: String {
    let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    return "\(v) (\(b))"
  }
}

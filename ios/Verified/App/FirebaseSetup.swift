@preconcurrency import FirebaseAppCheck
@preconcurrency import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseRemoteConfig

enum FirebaseSetup {
  /// Must run before any other Firebase call.
  static func configure() {
    #if DEBUG
      // Prints a debug token to the Xcode console; register it in Firebase console > App Check.
      AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
    #else
      AppCheck.setAppCheckProviderFactory(DeviceCheckProviderFactory())
    #endif

    guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
      fatalError("GoogleService-Info.plist missing: copy it into ios/Verified/ (see ios/README.md)")
    }
    FirebaseApp.configure()

    let db = Firestore.firestore()
    if AppConfig.useEmulator {
      let host = AppConfig.emulatorHost
      Auth.auth().useEmulator(withHost: host, port: AppConfig.authEmulatorPort)
      db.useEmulator(withHost: host, port: AppConfig.firestoreEmulatorPort)
    }
    // Offline-first: persistent local cache; writes queue while offline and sync later.
    let settings = db.settings
    settings.cacheSettings = PersistentCacheSettings()
    db.settings = settings

    let rc = RemoteConfig.remoteConfig()
    rc.setDefaults(["cloud_model": AppConfig.defaultCloudModel as NSObject])
    rc.fetchAndActivate { _, _ in }
  }

  /// Cloud model name from Remote Config (`cloud_model`), default gemini-3.5-flash.
  static var cloudModel: String {
    let v = RemoteConfig.remoteConfig().configValue(forKey: "cloud_model").stringValue
    return v.isEmpty ? AppConfig.defaultCloudModel : v
  }
}

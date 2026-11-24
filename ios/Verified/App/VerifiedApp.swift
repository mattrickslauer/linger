import GoogleSignIn
import SwiftUI

@main
struct VerifiedApp: App {
  @State private var app: AppModel

  init() {
    FirebaseSetup.configure()
    _app = State(initialValue: AppModel())
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(app)
        .onOpenURL { url in _ = GIDSignIn.sharedInstance.handle(url) }
    }
  }
}

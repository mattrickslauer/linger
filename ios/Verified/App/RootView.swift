import SwiftUI

/// No sign-in wall (docs/ARCHITECTURE.md v3.1): the app opens on the Feed as a guest. Sign-in is a sheet that appears
/// only when an action writes to the server, and the claim sheet offers guest Moments for upload after sign-in.
struct RootView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    @Bindable var app = app
    TabView(selection: $app.tab) {
      Tab("Feed", systemImage: "checkmark.seal", value: AppModel.AppTab.feed) { FeedView() }
      Tab("Record", systemImage: "record.circle", value: AppModel.AppTab.record) { RecordView() }
      Tab("Me", systemImage: app.isGuest ? "person.crop.circle.badge.questionmark" : "person.crop.circle",
          value: AppModel.AppTab.me) { MeView() }
    }
    .tint(Theme.lake)
    .sheet(item: $app.signInRequest) { req in
      SignInSheet(action: req.action.isEmpty ? nil : req.action)
        .presentationDetents([.medium, .large])
    }
    .sheet(isPresented: $app.claimOffer) {
      ClaimSheet()
        .presentationDetents([.medium, .large])
    }
    .task(id: "\(app.auth.ready)|\(app.auth.user?.uid ?? "guest")") {
      guard app.auth.ready else { return }
      app.userChanged()
    }
    // Raw vault: re-check on launch / becoming active, then every 30 s while the app is active.
    .task(id: scenePhase == .active) {
      guard scenePhase == .active else { return }
      while !Task.isCancelled {
        await app.vault.verifyAll()
        try? await Task.sleep(for: .seconds(30))
      }
    }
  }
}

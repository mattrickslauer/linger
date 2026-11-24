import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var app
  @State private var tab = AppTab.feed

  enum AppTab: Hashable { case feed, record, me }

  var body: some View {
    Group {
      if !app.auth.ready {
        ProgressView()
      } else if app.auth.user == nil {
        SignInView()
      } else {
        TabView(selection: $tab) {
          Tab("Feed", systemImage: "checkmark.seal", value: AppTab.feed) { FeedView() }
          Tab("Record", systemImage: "record.circle", value: AppTab.record) { RecordView() }
          Tab("Me", systemImage: "person.crop.circle", value: AppTab.me) { MeView() }
        }
      }
    }
    .tint(Theme.accent)
    .task(id: app.auth.user?.uid) { app.userChanged() }
  }
}

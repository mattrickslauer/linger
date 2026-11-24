import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var app
  @State private var emulatorName = "Test Angler"

  var body: some View {
    VStack(spacing: 28) {
      Spacer()
      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 72))
        .foregroundStyle(Theme.accent)
      VStack(spacing: 8) {
        Text("Verified").font(.largeTitle.bold())
        Text("Record a Moment. On-device AI coaches you live.\nThe cloud judges. Code seals it.")
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)
      }
      Spacer()
      Button {
        Task { await app.auth.signInWithGoogle() }
      } label: {
        Label("Sign in with Google", systemImage: "person.badge.key.fill")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .disabled(app.auth.busy)

      if AppConfig.useEmulator {
        VStack(spacing: 8) {
          Text("Emulator mode · \(AppConfig.emulatorHost)").font(.caption).foregroundStyle(.secondary)
          HStack {
            TextField("Name", text: $emulatorName).textFieldStyle(.roundedBorder)
            Button("Emulator sign-in") { Task { await app.auth.signInWithEmulator(name: emulatorName) } }
              .buttonStyle(.bordered)
          }
        }
      }
      if let error = app.auth.error {
        Text(error).font(.footnote).foregroundStyle(Theme.bad).multilineTextAlignment(.center)
      }
      if app.auth.busy { ProgressView() }
    }
    .padding(24)
  }
}

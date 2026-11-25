import SwiftUI
import VerifiedCore

/// "Sign in to <action>" (docs/ARCHITECTURE.md v3.1). Shown only when an action writes to the server; the action
/// resumes by itself once sign-in succeeds (`AppModel.requireSignIn`).
struct SignInSheet: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  /// "upload this Moment", "run a verification module", … (nil: plain sign-in from Me / Feed).
  let action: String?
  @State private var emulatorName = "Test Angler"

  var body: some View {
    VStack(spacing: 22) {
      Capsule().fill(.quaternary).frame(width: 40, height: 5).padding(.top, 8)
      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 54))
        .foregroundStyle(Theme.accent)
        .symbolEffect(.bounce, value: app.auth.busy)
      VStack(spacing: 8) {
        Text(action.map { "Sign in to \($0)" } ?? "Sign in to Verified")
          .font(.title2.bold()).multilineTextAlignment(.center)
        Text("Browsing and recording work without an account. Signing in lets the cloud check your Moments, seal them and put them on the public feed.")
          .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
      }
      VStack(alignment: .leading, spacing: 8) {
        bullet("iphone", "Moments you recorded as a guest stay on this phone until you upload them.")
        bullet("link", "Their SHA-256 chain only binds the Moment id, so nothing is re-recorded.")
      }
      .font(.footnote).foregroundStyle(.secondary)
      .padding(14)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))

      Spacer(minLength: 0)
      Button {
        Task { await app.auth.signIn() }
      } label: {
        Label("Sign in", systemImage: "person.badge.key.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
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
      Button("Not now") {
        app.signInRequest = nil
        dismiss()
      }
      .font(.subheadline)
      .disabled(app.auth.busy)
    }
    .padding(.horizontal, 24).padding(.bottom, 16)
    .onChange(of: app.auth.user?.uid) { _, uid in if uid != nil { dismiss() } }
  }

  private func bullet(_ icon: String, _ text: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: icon).frame(width: 18).foregroundStyle(Theme.accent)
      Text(text)
    }
  }
}

/// v3.1 claim: "You recorded N Moments as a guest. Upload them to your account to get them verified?"
struct ClaimSheet: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  /// Rows the user chose to keep on this phone (not uploaded by "Upload all").
  @State private var keep: Set<String> = []

  var body: some View {
    let items = app.claimable
    NavigationStack {
      List {
        Section {
          ForEach(items) { m in
            HStack(spacing: 12) {
              Image(systemName: (Category(rawValue: m.category) ?? .other).icon)
                .frame(width: 34, height: 34)
                .foregroundStyle(Theme.accent)
                .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
              VStack(alignment: .leading, spacing: 2) {
                Text(m.intention).font(.subheadline.weight(.semibold)).lineLimit(2)
                if let s = m.summary {
                  Text("\(formatDuration(ms: s.durationMs)) · \(formatDistance(s.distanceM)) · \(s.frameCount) frames")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
              }
              Spacer()
              if keep.contains(m.id) { Chip(text: "keep here", systemImage: "iphone", color: .secondary) }
            }
            .swipeActions(edge: .trailing) {
              Button(role: .destructive) { try? app.vault.forget(m.id) } label: { Label("Delete", systemImage: "trash") }
              Button { toggleKeep(m.id) } label: {
                Label(keep.contains(m.id) ? "Upload" : "Keep on this device", systemImage: "iphone")
              }
              .tint(.gray)
            }
          }
        } header: {
          Text("You recorded \(items.count) \(items.count == 1 ? "Moment" : "Moments") as a guest. Upload \(items.count == 1 ? "it" : "them") to your account to get \(items.count == 1 ? "it" : "them") verified?")
            .textCase(nil).font(.subheadline)
        } footer: {
          Text("Swipe a row to keep it on this device or delete it. The hash chain is unchanged: your account is bound at upload.")
        }
      }
      .navigationTitle("Guest Moments")
      .navigationBarTitleDisplayMode(.inline)
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 8) {
          let upload = items.map(\.id).filter { !keep.contains($0) }
          Button {
            app.claim(upload)
            dismiss()
          } label: {
            Label(upload.count == items.count ? "Upload all" : "Upload \(upload.count)", systemImage: "icloud.and.arrow.up")
              .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .disabled(upload.isEmpty)
          Button("Not now") { dismiss() }.font(.subheadline)
        }
        .padding(.horizontal, 20).padding(.vertical, 10)
        .background(.bar)
      }
      .onChange(of: items.isEmpty) { _, empty in if empty { dismiss() } }
    }
  }

  private func toggleKeep(_ id: String) {
    if keep.contains(id) { keep.remove(id) } else { keep.insert(id) }
  }
}

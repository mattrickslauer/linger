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
    ScrollView {
      VStack(spacing: 20) {
        ZStack {
          Circle().fill(Theme.gold).frame(width: 84, height: 84)
          Circle().strokeBorder(Color(hex: 0x10242B), lineWidth: 2.5).frame(width: 68, height: 68)
          Image(systemName: "checkmark").font(.system(size: 32, weight: .heavy)).foregroundStyle(Color(hex: 0x10242B))
        }
        .symbolEffect(.bounce, value: app.auth.busy)
        .accessibilityHidden(true)
        .padding(.top, 12)
        Text(action.map { "Sign in to \($0)" } ?? "Sign in to Verified")
          .font(.title2.bold()).multilineTextAlignment(.center)
        AdaptiveStack(spacing: 8) {
          GlyphTile(icon: Glyph.cloud, title: "Cloud checks", detail: "Judge, skeptic, scorer")
          GlyphTile(icon: "checkmark.seal.fill", title: "Sealed", detail: "On the public feed", tint: Theme.gold)
          GlyphTile(icon: Glyph.onDevice, title: "Guest kept", detail: "Same chain, no re-record", tint: Theme.ok)
        }
        .fixedSize(horizontal: false, vertical: true)

        Button {
          Task { await app.auth.signIn() }
        } label: {
          Label("Sign in", systemImage: "person.badge.key.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
        }
        .buttonStyle(.borderedProminent)
        .tint(Theme.lake)
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
          Label(error, systemImage: "exclamationmark.triangle.fill")
            .font(.footnote).foregroundStyle(Theme.bad).multilineTextAlignment(.center)
        }
        if app.auth.busy { ProgressView() }
        Button("Not now") {
          app.signInRequest = nil
          dismiss()
        }
        .font(.subheadline)
        .frame(minHeight: 44)
        .disabled(app.auth.busy)
      }
      .padding(.horizontal, 24).padding(.bottom, 16)
    }
    .background(Theme.paper)
    .presentationDragIndicator(.visible)
    .onChange(of: app.auth.user?.uid) { _, uid in if uid != nil { dismiss() } }
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
                .foregroundStyle(Theme.lake)
                .background(Theme.lake.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
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
          Label("\(items.count) guest \(items.count == 1 ? "Moment" : "Moments") to verify", systemImage: Glyph.onDevice)
            .textCase(nil).font(.subheadline.weight(.semibold))
        } footer: {
          Text("Swipe a row to keep it here or delete it. The chain is unchanged; your account is bound at upload.")
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
          .tint(Theme.lake)
          .controlSize(.large)
          .disabled(upload.isEmpty)
          Button("Not now") { dismiss() }.font(.subheadline).frame(minHeight: 44)
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

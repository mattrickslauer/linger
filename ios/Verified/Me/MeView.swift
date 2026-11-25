import SwiftUI
import VerifiedCore

/// Me tab: profile, my Moments (any status, with sync state), cloud judge status, developer switches.
struct MeView: View {
  @Environment(AppModel.self) private var app
  @AppStorage("useEmulator") private var useEmulator = false
  @AppStorage("emulatorHost") private var emulatorHost = "127.0.0.1"
  /// The Moment waiting for delete confirmation.
  @State private var pendingDelete: MomentCardData?
  @State private var deleteError: String?

  var body: some View {
    NavigationStack {
      List {
        if let user = app.auth.user {
          Section {
            HStack(spacing: 14) {
              Avatar(url: user.photoURL, name: user.name, size: 52)
              VStack(alignment: .leading, spacing: 4) {
                Text(user.name).font(.headline)
                Text(stats).font(.subheadline).foregroundStyle(.secondary)
              }
            }
            .padding(.vertical, 4)
            Text(rawData).font(.footnote).foregroundStyle(app.vault.held.isEmpty ? Theme.accent : Theme.warn)
            if let c = app.credits.credits {
              HStack {
                Label("\(c.balance) ladder \(c.balance == 1 ? "credit" : "credits")", systemImage: "circle.hexagongrid.fill")
                  .foregroundStyle(Theme.accent)
                Spacer()
                Text(c.justGranted ? "\(c.granted) free to start" : "free demo · \(c.spent) spent")
                  .font(.caption).foregroundStyle(.secondary)
              }
              .font(.subheadline.weight(.semibold))
            }
          }
        } else {
          Section {
            HStack(spacing: 14) {
              Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 44)).foregroundStyle(.secondary)
              VStack(alignment: .leading, spacing: 4) {
                Text("Guest").font(.headline)
                Text("Browse and record freely. Sign in to upload, verify and climb the ladder.")
                  .font(.subheadline).foregroundStyle(.secondary)
              }
            }
            .padding(.vertical, 4)
            Button {
              app.signIn()
            } label: {
              Label("Sign in", systemImage: "person.badge.key.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
          }
        }

        if !app.vault.guestMoments.isEmpty {
          Section {
            ForEach(app.vault.guestMoments) { m in
              NavigationLink {
                MomentDetailView(initial: m, fromMyMoments: true)
              } label: {
                MyMomentRow(item: m, judging: false)
              }
              .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if app.canDelete(m, fromMyMoments: true) {
                  Button { pendingDelete = m } label: { Label("Delete", systemImage: "trash") }
                    .tint(Theme.bad)
                }
                if m.status == "submitted" {
                  Button { app.upload(m) } label: { Label("Upload", systemImage: "icloud.and.arrow.up") }
                    .tint(Theme.accent)
                }
              }
            }
          } header: {
            Text("On this device")
          } footer: {
            Text("Recorded as a guest and kept only on this phone. Swipe to upload one, or sign in to upload them all.")
          }
        }

        if app.auth.user != nil {
        Section {
          if app.mine.items.isEmpty {
            Text("No Moments yet. Start one in Record.").foregroundStyle(.secondary)
          }
          ForEach(app.mine.items) { m in
            NavigationLink {
              MomentDetailView(initial: m, fromMyMoments: true)
            } label: {
              MyMomentRow(item: m, judging: app.judge.running.contains(m.id))
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
              if app.canDelete(m, fromMyMoments: true) {
                // No destructive role here: that animates the row away before the user has confirmed.
                Button { pendingDelete = m } label: { Label("Delete", systemImage: "trash") }
                  .tint(Theme.bad)
              }
            }
            .contextMenu {
              if app.canDelete(m, fromMyMoments: true) {
                Button(role: .destructive) { pendingDelete = m } label: { Label("Delete Moment", systemImage: "trash") }
              }
            }
          }
        } header: {
          Text("My Moments")
        } footer: {
          if let err = app.judge.lastError {
            VStack(alignment: .leading, spacing: 6) {
              Text(err).foregroundStyle(Theme.bad)
              Button("Retry cloud judge") { app.judge.retry() }
            }
          }
        }
        }

        Section("Hybrid AI") {
          LabeledContent("Live coach", value: LiveCoach.onDeviceAvailable ? "On-device first" : "Cloud fallback")
          Text(LiveCoach.availabilityNote).font(.footnote).foregroundStyle(.secondary)
          LabeledContent("Judge, skeptic, scorer", value: FirebaseSetup.cloudModel)
          LabeledContent("Network", value: app.network.isOnline ? "Online" : "Offline")
        }

        Section {
          Toggle("Use Firebase Emulator", isOn: $useEmulator)
          if useEmulator {
            TextField("Emulator host (your Mac's IP)", text: $emulatorHost)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .keyboardType(.numbersAndPunctuation)
          }
          LabeledContent("Now using", value: AppConfig.useEmulator ? "Emulator · \(AppConfig.emulatorHost)" : "Production")
        } header: {
          Text("Developer")
        } footer: {
          Text("Emulator settings take effect the next time the app launches. Version \(AppConfig.appVersion).")
        }

        if app.auth.user != nil {
          Section {
            Button("Sign out", role: .destructive) { app.auth.signOut() }
          } footer: {
            Text("Signing out never touches Moments kept on this phone.")
          }
        }
      }
      .navigationTitle("Me")
      .confirmationDialog(
        MomentDeletion.confirmTitle,
        isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
        titleVisibility: .visible, presenting: pendingDelete
      ) { m in
        Button("Delete Moment", role: .destructive) { delete(m) }
        Button("Cancel", role: .cancel) {}
      } message: { _ in
        Text(MomentDeletion.confirmMessage)
      }
      .alert("Could not delete", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(deleteError ?? "")
      }
    }
  }

  private func delete(_ m: MomentCardData) {
    pendingDelete = nil
    do { try app.deleteMoment(m) } catch { deleteError = error.localizedDescription }
  }

  private var stats: String {
    let items = app.mine.items
    let sealed = items.filter { $0.status == "sealed" }.count
    return "\(items.count) \(items.count == 1 ? "Moment" : "Moments") · \(sealed) verified"
  }

  /// Raw vault state (same wording as Android).
  private var rawData: String {
    let held = app.vault.held
    let conflicts = held.values.filter { $0 == .conflict }.count
    if held.isEmpty { return "Raw data: all safely stored on the server ✓" }
    if conflicts > 0 { return "Raw data: \(conflicts) Moment(s) differ from the server — kept on this phone" }
    return "Raw data: \(held.count) Moment(s) kept on this phone until the server confirms every chunk"
  }
}

private struct MyMomentRow: View {
  let item: MomentCardData
  let judging: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .top) {
        Text(item.intention).font(.subheadline.weight(.semibold)).lineLimit(2)
        Spacer()
        VerdictBadge(status: item.badgeStatus).scaleEffect(0.85)
      }
      HStack(spacing: 6) {
        if let s = item.summary {
          Text("\(formatDuration(ms: s.durationMs)) · \(formatDistance(s.distanceM)) · \(s.frameCount) frames")
            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        Spacer()
        if item.hasPendingWrites {
          Chip(text: "queued", systemImage: "icloud.slash", color: Theme.warn)
        } else if judging {
          Chip(text: "judging", systemImage: "brain", color: .blue)
        }
      }
      if let reason = item.sealReason, !reason.isEmpty {
        Text(reason).font(.caption2).foregroundStyle(item.isVerified ? Theme.accent : Theme.bad).lineLimit(2)
      }
    }
    .padding(.vertical, 2)
  }
}

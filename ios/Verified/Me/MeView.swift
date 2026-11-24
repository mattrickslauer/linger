import SwiftUI

/// Me tab: profile, my Moments (any status, with sync state), cloud judge status, developer switches.
struct MeView: View {
  @Environment(AppModel.self) private var app
  @AppStorage("useEmulator") private var useEmulator = false
  @AppStorage("emulatorHost") private var emulatorHost = "127.0.0.1"

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
          }
        }

        Section {
          if app.mine.items.isEmpty {
            Text("No Moments yet. Start one in Record.").foregroundStyle(.secondary)
          }
          ForEach(app.mine.items) { m in
            NavigationLink {
              MomentDetailView(initial: m)
            } label: {
              MyMomentRow(item: m, judging: app.judge.running.contains(m.id))
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

        Section("Hybrid AI") {
          LabeledContent("Live coach", value: LiveCoach.onDeviceAvailable ? "On-device first" : "Cloud fallback")
          Text(LiveCoach.availabilityNote).font(.footnote).foregroundStyle(.secondary)
          LabeledContent("Judge + skeptic", value: FirebaseSetup.cloudModel)
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

        Section {
          Button("Sign out", role: .destructive) { app.auth.signOut() }
        }
      }
      .navigationTitle("Me")
    }
  }

  private var stats: String {
    let items = app.mine.items
    let sealed = items.filter { $0.status == "sealed" }.count
    return "\(items.count) \(items.count == 1 ? "Moment" : "Moments") · \(sealed) verified"
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
        VerdictBadge(status: item.status).scaleEffect(0.85)
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

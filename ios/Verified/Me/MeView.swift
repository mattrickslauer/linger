import SwiftUI
import VerifiedCore

/// Me tab: profile header (credits pill, verified / not / pending tiles, raw-vault state), then Moments as a
/// two-column grid of proof-photo thumbnails with status badges. Hybrid AI info, developer switches and sign-out live
/// in Settings (gear). Guests get one sign-in card and their on-device Moments.
struct MeView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dynamicTypeSize) private var typeSize
  /// The Moment waiting for delete confirmation.
  @State private var pendingDelete: MomentCardData?
  @State private var deleteError: String?
  @State private var showingSettings = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          if let user = app.auth.user {
            profile(user)
          } else {
            guestCard
          }

          if let err = app.judge.lastError {
            HStack(spacing: 10) {
              Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.bad)
              Text(err).font(.footnote).lineLimit(2)
              Spacer(minLength: 4)
              Button("Retry") { app.judge.retry() }.font(.subheadline.weight(.semibold)).frame(minHeight: 44)
            }
            .surfaceCard(padding: 12)
          }

          if !app.vault.guestMoments.isEmpty {
            section(title: "On this device", icon: Glyph.onDevice, count: app.vault.guestMoments.count,
                    note: "Hold one to upload or delete") {
              grid(app.vault.guestMoments, guest: true)
            }
          }

          if app.auth.user != nil {
            section(title: "My Moments", icon: "square.grid.2x2", count: app.mine.items.count, note: nil) {
              if app.mine.items.isEmpty {
                ContentUnavailableView {
                  Label("No Moments yet", systemImage: Glyph.proof)
                } description: {
                  Text("Your recordings show up here.")
                } actions: {
                  Button { app.tab = .record } label: { Label("Record a Moment", systemImage: "record.circle.fill") }
                    .buttonStyle(.borderedProminent).tint(Theme.lake)
                }
              } else {
                grid(app.mine.items, guest: false)
              }
            }
          }
        }
        .padding(16)
      }
      .background(Theme.paper)
      .navigationTitle("Me")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button { showingSettings = true } label: { Label("Settings", systemImage: "gearshape") }
        }
      }
      .sheet(isPresented: $showingSettings) { MeSettings().presentationDetents([.medium, .large]) }
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

  // MARK: Header

  private func profile(_ user: SignedInUser) -> some View {
    let items = app.mine.items
    let sealed = items.filter { $0.status == "sealed" }.count
    let rejected = items.filter { $0.status == "rejected" }.count
    return VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 14) {
        Avatar(url: user.photoURL, name: user.name, size: 56)
        VStack(alignment: .leading, spacing: 4) {
          Text(user.name).font(.title3.weight(.bold)).lineLimit(1)
          vaultLine
        }
        Spacer(minLength: 4)
        if let c = app.credits.credits {
          Label("\(c.balance)", systemImage: Glyph.credits)
            .font(.headline.monospacedDigit())
            .padding(.horizontal, 10).padding(.vertical, 6)
            .foregroundStyle(Color(hex: 0x10242B))
            .background(Theme.gold, in: Capsule())
            .accessibilityLabel("\(c.balance) ladder \(c.balance == 1 ? "credit" : "credits"), "
                                + (c.justGranted ? "\(c.granted) free to start" : "free demo, \(c.spent) spent"))
        }
      }
      AdaptiveStack(spacing: 8) {
        StatTile(icon: "checkmark.seal.fill", value: "\(sealed)", label: "verified", tint: Theme.ok)
        StatTile(icon: "xmark.seal", value: "\(rejected)", label: "not", tint: Theme.bad)
        StatTile(icon: "hourglass", value: "\(items.count - sealed - rejected)", label: "pending", tint: Theme.ink2)
      }
    }
  }

  /// Raw vault state: one glyph line (the full sentence for VoiceOver).
  private var vaultLine: some View {
    let held = app.vault.held
    let conflicts = held.values.filter { $0 == .conflict }.count
    let (icon, text, tint, full): (String, String, Color, String) =
      if held.isEmpty { ("checkmark.shield.fill", "Raw data on server", Theme.ok, "Raw data: all safely stored on the server") }
      else if conflicts > 0 {
        ("exclamationmark.triangle.fill", "\(conflicts) differ · kept here", Theme.bad,
         "Raw data: \(conflicts) Moment(s) differ from the server, kept on this phone")
      } else {
        (Glyph.onDevice, "\(held.count) kept on phone", Theme.warn,
         "Raw data: \(held.count) Moment(s) kept on this phone until the server confirms every chunk")
      }
    return Label(text, systemImage: icon)
      .font(.caption.weight(.semibold))
      .foregroundStyle(tint)
      .lineLimit(1)
      .accessibilityLabel(full)
  }

  private var guestCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 12) {
        Image(systemName: "person.crop.circle.badge.questionmark")
          .font(.system(size: 40)).foregroundStyle(Theme.lake)
        VStack(alignment: .leading, spacing: 2) {
          Text("Guest").font(.title3.weight(.bold))
          Text("Sign in to verify and climb the ladder").font(.subheadline).foregroundStyle(.secondary)
        }
      }
      Button { app.signIn() } label: {
        Label("Sign in", systemImage: "person.badge.key.fill").font(.headline).frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent).tint(Theme.lake).controlSize(.large)
    }
    .surfaceCard(padding: 16, radius: 22)
  }

  // MARK: Grid

  private func section<Content: View>(title: String, icon: String, count: Int, note: String?,
                                      @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Label(title, systemImage: icon).font(.headline)
        Text("\(count)").font(.subheadline.weight(.bold).monospacedDigit()).foregroundStyle(.secondary)
        Spacer(minLength: 0)
        if let note { Text(note).font(.caption).foregroundStyle(.secondary) }
      }
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isHeader)
      content()
    }
  }

  private func grid(_ items: [MomentCardData], guest: Bool) -> some View {
    let columns = typeSize.isAccessibilitySize
      ? [GridItem(.flexible())]
      : [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
    return LazyVGrid(columns: columns, spacing: 10) {
      ForEach(items) { m in
        let canDelete = app.canDelete(m, fromMyMoments: true)
        NavigationLink {
          MomentDetailView(initial: m, fromMyMoments: true)
        } label: {
          MomentTile(item: m, judging: !guest && app.judge.running.contains(m.id))
        }
        .buttonStyle(.plain)
        .contextMenu {
          if guest && m.status == "submitted" {
            Button { app.upload(m) } label: { Label("Upload & verify", systemImage: "icloud.and.arrow.up") }
          }
          if canDelete {
            Button(role: .destructive) { pendingDelete = m } label: { Label("Delete Moment", systemImage: "trash") }
          }
        }
        .accessibilityActions {
          if guest && m.status == "submitted" {
            Button("Upload & verify") { app.upload(m) }
          }
          if canDelete {
            Button("Delete Moment") { pendingDelete = m }
          }
        }
      }
    }
  }
}

/// A Moment thumbnail: the proof photo with its status badge, score ring, intention and stats overlaid.
private struct MomentTile: View {
  let item: MomentCardData
  let judging: Bool

  var body: some View {
    HeroImage(b64: item.heroJpegB64, category: item.category)
      .frame(height: 210).frame(maxWidth: .infinity).clipped()
      .saturation(item.status == "rejected" ? 0.2 : 1)
      .overlay {
        LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: Theme.media.opacity(0.92), location: 1)],
                       startPoint: .top, endPoint: .bottom)
      }
      .overlay(alignment: .topLeading) {
        StatusBadge(status: item.badgeStatus, compact: true).padding(8)
      }
      .overlay(alignment: .topTrailing) {
        HStack(spacing: 4) {
          if item.hasPendingWrites {
            Image(systemName: "icloud.slash").font(.caption.weight(.bold))
              .padding(6).background(.ultraThinMaterial, in: Circle())
          } else if judging {
            Image(systemName: Glyph.ai).font(.caption.weight(.bold))
              .symbolEffect(.pulse, options: .repeating)
              .padding(6).background(.ultraThinMaterial, in: Circle())
          }
          if let p = item.displayScore {
            ScoreRing(p: p, bar: item.bar?.value, size: 38, caption: nil)
              .background(Circle().fill(.ultraThinMaterial))
          }
        }
        .padding(8)
      }
      .overlay(alignment: .bottomLeading) {
        VStack(alignment: .leading, spacing: 4) {
          Text(item.intention).font(.footnote.weight(.bold)).lineLimit(2).multilineTextAlignment(.leading)
          if let s = item.summary {
            HStack(spacing: 8) {
              Label(formatDuration(ms: s.durationMs), systemImage: Glyph.timing)
              Label(formatDistance(s.distanceM), systemImage: Glyph.gps)
            }
            .font(.caption2.weight(.semibold).monospacedDigit())
            .labelStyle(CompactLabelStyle())
            .opacity(0.85)
          }
        }
        .padding(10)
      }
      .foregroundStyle(.white)
      .environment(\.colorScheme, .dark)
      .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
      .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(item.intention), \(StatusBadge.style(item.badgeStatus).text)"
                          + (item.displayScore.map { ", \(Int(($0 * 100).rounded())) percent likely true" } ?? "")
                          + (item.hasPendingWrites ? ", queued" : judging ? ", judging" : ""))
      .accessibilityAddTraits(.isButton)
  }
}

/// Glyph and title with a tight gap (tile stats).
private struct CompactLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 3) {
      configuration.icon
      configuration.title
    }
  }
}

/// Settings: hybrid AI status, developer switches, sign-out. Standard list style.
private struct MeSettings: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @AppStorage("useEmulator") private var useEmulator = false
  @AppStorage("emulatorHost") private var emulatorHost = "127.0.0.1"

  var body: some View {
    NavigationStack {
      List {
        Section("Hybrid AI") {
          LabeledContent {
            HybridBadge(onDevice: LiveCoach.onDeviceAvailable,
                        text: LiveCoach.onDeviceAvailable ? "on device first" : "cloud fallback")
          } label: {
            Label("Live coach", systemImage: Glyph.shots)
          }
          Text(LiveCoach.availabilityNote).font(.footnote).foregroundStyle(.secondary)
          LabeledContent {
            Text(FirebaseSetup.cloudModel)
          } label: {
            Label("Judge, skeptic, scorer", systemImage: Glyph.cloud)
          }
          LabeledContent {
            Text(app.network.isOnline ? "Online" : "Offline")
          } label: {
            Label("Network", systemImage: app.network.isOnline ? "wifi" : "wifi.slash")
          }
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
            Button("Sign out", role: .destructive) {
              app.auth.signOut()
              dismiss()
            }
          } footer: {
            Text("Signing out never touches Moments kept on this phone.")
          }
        }
      }
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
  }
}

import SwiftUI

/// Feed tab: sealed (and rejected) Moments from `feed/*`, newest first.
struct FeedView: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let feed = app.feed
    NavigationStack {
      ScrollView {
        LazyVStack(spacing: 16) {
          LandingHeader()
          if let error = feed.error {
            Label(error, systemImage: "exclamationmark.triangle")
              .font(.footnote).foregroundStyle(Theme.bad).padding()
          }
          if feed.loaded && feed.items.isEmpty {
            ContentUnavailableView(
              "No sealed Moments yet", systemImage: "checkmark.seal",
              description: Text("Record one in the Record tab. Once the cloud judge, skeptic and scorer have run, the seal function publishes it here."))
              .padding(.top, 60)
          } else if !feed.loaded && feed.error == nil {
            ProgressView().padding(.top, 80)
          }
          ForEach(feed.items) { item in
            NavigationLink {
              MomentDetailView(initial: item)
            } label: {
              MomentCard(item: item)
            }
            .buttonStyle(.plain)
          }
        }
        .padding(16)
      }
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Verified")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          if let user = app.auth.user {
            Button { app.tab = .me } label: { Avatar(url: user.photoURL, name: user.name, size: 30) }
              .accessibilityLabel("Me")
          } else {
            Button("Sign in") { app.signIn() }.font(.subheadline.weight(.semibold))
          }
        }
      }
    }
  }
}

/// The landing IS the app (v3.1): one-line pitch, a big "Record a Moment" CTA, and the public feed right below.
private struct LandingHeader: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Proof that it really happened.")
        .font(.system(.title, design: .rounded, weight: .bold))
      Text("Recorded, chained and checked by AI.")
        .font(.title3).foregroundStyle(.secondary)
      Button {
        app.tab = .record
      } label: {
        HStack(spacing: 12) {
          Image(systemName: "record.circle.fill").font(.title2)
            .symbolEffect(.pulse, options: .repeating)
          Text("Record a Moment").font(.title3.bold())
          Spacer()
          Image(systemName: "arrow.right").font(.headline)
        }
        .padding(.horizontal, 18).padding(.vertical, 16)
        .foregroundStyle(.white)
        .background(
          LinearGradient(colors: [Theme.accent, Theme.accent.opacity(0.78)], startPoint: .topLeading, endPoint: .bottomTrailing),
          in: RoundedRectangle(cornerRadius: 18))
        .shadow(color: Theme.accent.opacity(0.35), radius: 12, y: 6)
      }
      .buttonStyle(.plain)
      HStack(spacing: 6) {
        Chip(text: "on-device coach", systemImage: "cpu", color: Theme.accent)
        Chip(text: "cloud judge", systemImage: "cloud", color: .blue)
        Chip(text: "code seals", systemImage: "lock.fill", color: .secondary)
      }
      if app.isGuest {
        Text("No account needed. Moments stay on this phone until you sign in to verify them.")
          .font(.footnote).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.bottom, 4)
  }
}

/// Moment card: hero frame, intention, owner, duration · distance · frames, verdict badge, platform chips.
struct MomentCard: View {
  let item: MomentCardData

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ZStack(alignment: .topTrailing) {
        HeroImage(b64: item.heroJpegB64, category: item.category)
          .frame(height: 210)
          .clipped()
        VerdictBadge(status: item.badgeStatus).padding(10)
      }
      VStack(alignment: .leading, spacing: 8) {
        Text(item.intention).font(.headline).lineLimit(2).multilineTextAlignment(.leading)
        HStack(spacing: 8) {
          Avatar(url: item.ownerPhotoURL, name: item.ownerName, size: 22)
          Text(item.ownerName).font(.subheadline).foregroundStyle(.secondary)
        }
        if let s = item.summary {
          Text("\(formatDuration(ms: s.durationMs)) · \(formatDistance(s.distanceM)) · \(s.frameCount) \(s.frameCount == 1 ? "frame" : "frames")")
            .font(.subheadline.monospacedDigit())
        }
        if let bar = item.bar {
          ScoreBarLine(score: item.displayScore, bar: bar.value, ladderCount: item.ladder.count, verified: item.isVerified)
        }
        if item.cheating && item.status == "rejected" {
          // v4.11: "Not verified · cheating detected"
          Label("Not verified · cheating detected", systemImage: "exclamationmark.octagon.fill")
            .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.bad)
        }
        HStack(spacing: 6) {
          if item.isV4 && item.claimsTotal > 0 && !item.claimScores.isEmpty {
            // v4.8: "2/2 claims backed"
            ClaimsBackedChip(backed: item.claimsBacked ?? 0, total: item.claimsTotal)
          }
          Chip(text: item.platform.isEmpty ? "?" : platformName(item.platform), systemImage: platformIcon(item.platform))
          if item.onDeviceMode == "on_device" {
            Chip(text: "checked on-device", systemImage: "cpu", color: Theme.accent)
          }
          if item.hasPendingWrites { Chip(text: "queued", systemImage: "icloud.slash", color: Theme.warn) }
        }
      }
      .padding(14)
    }
    .background(Theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 18))
    .shadow(color: .black.opacity(0.06), radius: 8, y: 3)
  }
}

/// "score 0.83 · bar 0.80" with a gauge and a ladder chip ("+2 checks") — v3.8 card line.
struct ScoreBarLine: View {
  let score: Double?
  let bar: Double
  var ladderCount = 0
  var verified = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        if let score {
          Text("score \(String(format: "%.2f", score))").foregroundStyle(score >= bar ? Theme.accent : Theme.bad)
          Text("·").foregroundStyle(.tertiary)
        }
        Text("bar \(String(format: "%.2f", bar))").foregroundStyle(Theme.warn)
        Spacer(minLength: 0)
        if ladderCount > 0 {
          Chip(text: "+\(ladderCount) \(ladderCount == 1 ? "check" : "checks")", systemImage: "stairs", color: .purple)
        }
      }
      .font(.subheadline.weight(.semibold).monospacedDigit())
      BarGauge(score: score, bar: bar).frame(height: 6)
    }
  }
}

struct HeroImage: View {
  let b64: String?
  let category: String

  var body: some View {
    if let b64, let cg = ProofFrame.cgImage(fromBase64: b64) {
      Image(decorative: cg, scale: 1).resizable().scaledToFill()
    } else {
      ZStack {
        LinearGradient(colors: [Theme.accent.opacity(0.35), Theme.accent.opacity(0.1)], startPoint: .top, endPoint: .bottom)
        Image(systemName: (Category(rawValue: category) ?? .other).icon)
          .font(.system(size: 54)).foregroundStyle(Theme.accent.opacity(0.7))
      }
    }
  }
}

struct VerdictBadge: View {
  let status: String
  var body: some View {
    let (text, color): (String, Color) = switch status {
    case "sealed": ("Verified ✓", Theme.accent)
    case "rejected": ("Not verified", Theme.bad)
    case "local": ("On this device", .indigo)
    case "submitted": ("Judging…", .blue)
    default: ("Recording", Theme.warn)
    }
    Text(text)
      .font(.caption.weight(.bold))
      .padding(.horizontal, 10).padding(.vertical, 6)
      .foregroundStyle(.white)
      .background(color, in: Capsule())
  }
}

struct Avatar: View {
  let url: String?
  let name: String
  var size: CGFloat = 28
  var body: some View {
    AsyncImage(url: url.flatMap(URL.init(string:))) { img in
      img.resizable().scaledToFill()
    } placeholder: {
      ZStack {
        Circle().fill(Theme.accent.opacity(0.2))
        Text(String(name.prefix(1))).font(.system(size: size * 0.5, weight: .bold)).foregroundStyle(Theme.accent)
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
  }
}

func platformName(_ p: String) -> String {
  switch p {
  case "ios": "iOS"
  case "android": "Android"
  case "web": "Web"
  default: p
  }
}

func platformIcon(_ p: String) -> String {
  switch p {
  case "ios": "iphone"
  case "android": "candybarphone"
  default: "globe"
  }
}

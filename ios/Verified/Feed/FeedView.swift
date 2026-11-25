import SwiftUI

/// Feed tab: sealed (and rejected) Moments from `feed/*`, newest first.
struct FeedView: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let feed = app.feed
    NavigationStack {
      ScrollView {
        LazyVStack(spacing: 16) {
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
      .navigationTitle("Feed")
    }
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
        VerdictBadge(status: item.status).padding(10)
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
        HStack(spacing: 6) {
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

import Charts
import MapKit
import SwiftUI
import VerifiedCore

/// Moment detail: map track, frame timeline, motion chart, judge/skeptic reasons, seal checklist.
struct MomentDetailView: View {
  @State private var model: MomentDetailModel
  @State private var selectedFrame: MomentDetailModel.Frame?

  init(initial: MomentCardData) {
    _model = State(initialValue: MomentDetailModel(initial: initial))
  }

  var body: some View {
    let m = model.card
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        header(m)
        section("Track", icon: "map") { TrackMap(track: model.track) }
        section("Proof frames", icon: "camera") { frameTimeline }
        section("Motion", icon: "waveform.path.ecg") { motionChart }
        section("AI opinions", icon: "brain") { opinions(m) }
        section("Seal", icon: "checkmark.seal") { SealChecklist(card: m, chainVerified: model.chainVerified, chunkCount: model.chunkCount) }
      }
      .padding(16)
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Moment")
    .navigationBarTitleDisplayMode(.inline)
    .task { model.start() }
    .onDisappear { model.stop() }
    .sheet(item: $selectedFrame) { f in FrameSheet(frame: f) }
  }

  private func header(_ m: MomentCardData) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      ZStack(alignment: .topTrailing) {
        HeroImage(b64: m.heroJpegB64, category: m.category)
          .frame(height: 240).clipped()
          .clipShape(RoundedRectangle(cornerRadius: 18))
        VerdictBadge(status: m.status).padding(10)
      }
      Text(m.intention).font(.title3.bold())
      HStack(spacing: 8) {
        Avatar(url: m.ownerPhotoURL, name: m.ownerName, size: 24)
        Text(m.ownerName).font(.subheadline).foregroundStyle(.secondary)
        Spacer()
        Chip(text: platformName(m.platform), systemImage: platformIcon(m.platform))
        if m.onDeviceMode == "on_device" { Chip(text: "checked on-device", systemImage: "cpu", color: Theme.accent) }
      }
      if let s = m.summary {
        HStack {
          stat(formatDuration(ms: s.durationMs), "duration")
          stat(formatDistance(s.distanceM), "distance")
          stat("\(s.frameCount)", "frames")
          stat("\(model.chunkCount)", "chunks")
        }
        .padding(.vertical, 10)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
      }
      if let reason = m.sealReason, !reason.isEmpty {
        Text(reason).font(.footnote).foregroundStyle(m.isVerified ? Theme.accent : Theme.bad)
      }
    }
  }

  private func stat(_ v: String, _ l: String) -> some View {
    VStack(spacing: 2) {
      Text(v).font(.headline).monospacedDigit()
      Text(l).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
  }

  @ViewBuilder private var frameTimeline: some View {
    if model.frames.isEmpty {
      Text(model.loading ? "Loading…" : "No proof frames").font(.footnote).foregroundStyle(.secondary)
    } else {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(alignment: .top, spacing: 10) {
          ForEach(model.frames) { f in
            Button { selectedFrame = f } label: {
              VStack(alignment: .leading, spacing: 4) {
                Group {
                  if let img = f.image { Image(decorative: img, scale: 1).resizable().scaledToFill() }
                  else { Color.gray.opacity(0.2) }
                }
                .frame(width: 120, height: 150).clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topLeading) {
                  if let c = f.check {
                    Image(systemName: c.ok ? "checkmark.circle.fill" : "arrow.counterclockwise.circle.fill")
                      .foregroundStyle(.white, c.ok ? Theme.accent : Theme.warn)
                      .font(.title3).padding(5)
                  }
                }
                Text("+\(formatDuration(ms: Int64(max(0, f.offsetS) * 1000)))").font(.caption.monospacedDigit().weight(.semibold))
                if let c = f.check {
                  Text(c.ok ? c.label : c.reason).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
              }
              .frame(width: 120)
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }

  @ViewBuilder private var motionChart: some View {
    if model.motion.isEmpty {
      Text(model.loading ? "Loading…" : "No motion samples").font(.footnote).foregroundStyle(.secondary)
    } else {
      Chart(model.motion) { p in
        LineMark(x: .value("Seconds", p.s), y: .value("|a| m/s²", p.mag))
          .foregroundStyle(Theme.accent)
          .lineStyle(StrokeStyle(lineWidth: 1.2))
      }
      .chartXAxisLabel("seconds")
      .chartYAxisLabel("|a| m/s²")
      .frame(height: 160)
    }
  }

  @ViewBuilder private func opinions(_ m: MomentCardData) -> some View {
    VStack(spacing: 10) {
      OpinionCard(title: "Judge", icon: "scalemass", opinion: m.judge,
                  fallbackReasons: m.judge == nil ? m.judgeReasons : [])
      OpinionCard(title: "Skeptic", icon: "eye.trianglebadge.exclamationmark", opinion: m.skeptic, fallbackReasons: [])
    }
  }

  private func section<Content: View>(_ title: String, icon: String, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(title, systemImage: icon).font(.headline)
      content()
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
  }
}

struct TrackMap: View {
  let track: [CLLocationCoordinate2D]

  var body: some View {
    if track.isEmpty {
      Text("No GPS fixes").font(.footnote).foregroundStyle(.secondary)
    } else {
      Map(initialPosition: .automatic) {
        MapPolyline(coordinates: track).stroke(Theme.accent, lineWidth: 4)
        if let s = track.first { Marker("Start", systemImage: "flag", coordinate: s).tint(.green) }
        if let e = track.last, track.count > 1 { Marker("End", systemImage: "flag.checkered", coordinate: e).tint(Theme.bad) }
      }
      .frame(height: 220)
      .clipShape(RoundedRectangle(cornerRadius: 12))
    }
  }
}

struct OpinionCard: View {
  let title: String
  let icon: String
  let opinion: AiOpinion?
  let fallbackReasons: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Label(title, systemImage: icon).font(.subheadline.bold())
        Spacer()
        if let o = opinion {
          Chip(text: "\(o.verdict) · \(Int((o.confidence * 100).rounded()))%", color: color(o.verdict))
        } else if fallbackReasons.isEmpty {
          Chip(text: "pending", systemImage: "hourglass")
        }
      }
      ForEach(Array((opinion?.reasons ?? fallbackReasons).enumerated()), id: \.offset) { item in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text("•")
          Text(item.element)
        }
        .font(.footnote)
      }
      if let o = opinion, !o.model.isEmpty {
        Text("\(o.model) · cloud (Firebase AI Logic)").font(.caption2).foregroundStyle(.tertiary)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
  }

  private func color(_ v: String) -> Color {
    switch v {
    case "consistent": Theme.accent
    case "inconsistent": Theme.bad
    default: Theme.warn
    }
  }
}

/// The five deterministic checks the Cloud Function runs (contract `Seal.checks`).
struct SealChecklist: View {
  let card: MomentCardData
  let chainVerified: Bool?
  let chunkCount: Int

  static let rows: [(key: String, title: String)] = [
    ("chain", "Hash chain intact"),
    ("timing", "Timing consistent (≥ 20 s, in order)"),
    ("physics", "Physics plausible (no GPS jumps)"),
    ("frames", "Proof frames match their hashes"),
    ("ai", "Judge consistent, skeptic found no fake"),
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Self.rows, id: \.key) { row in
        HStack(spacing: 10) {
          icon(card.checks[row.key])
          Text(row.title).font(.subheadline)
          Spacer()
        }
      }
      Divider()
      HStack(spacing: 10) {
        icon(chainVerified)
        Text(chainVerified == nil ? "Re-checking the chain on this phone…"
             : "Re-checked on this phone: \(chunkCount) chunks, SHA-256 chain \(chainVerified == true ? "valid" : "BROKEN")")
          .font(.footnote).foregroundStyle(.secondary)
      }
      if card.checks.isEmpty {
        Text(statusLine).font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  private var statusLine: String {
    switch card.status {
    case "recording": "Still recording."
    case "submitted":
      card.judge == nil ? "Waiting for the cloud judge and skeptic (runs when the owner's phone is online)."
        : "Waiting for the seal function."
    default: ""
    }
  }

  @ViewBuilder private func icon(_ ok: Bool?) -> some View {
    switch ok {
    case .some(true): Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
    case .some(false): Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.bad)
    case .none: Image(systemName: "circle.dotted").foregroundStyle(.secondary)
    }
  }
}

private struct FrameSheet: View {
  let frame: MomentDetailModel.Frame
  var body: some View {
    VStack(spacing: 14) {
      if let img = frame.image {
        Image(decorative: img, scale: 1).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 14))
      }
      Text("Frame at +\(formatDuration(ms: Int64(max(0, frame.offsetS) * 1000))) · chunk \(Chain.docId(frame.seq))")
        .font(.subheadline.monospacedDigit())
      if let c = frame.check {
        let mode = switch c.mode {
        case .onDevice: "on-device"
        case .cloud: "cloud"
        case .none: "offline heuristic"
        }
        Label(c.ok ? "Coach (\(mode)): keep going · \(c.label)" : "Coach (\(mode)): retake · \(c.reason)",
              systemImage: c.ok ? "checkmark.circle" : "arrow.counterclockwise.circle")
          .font(.footnote)
      }
    }
    .padding(20)
    .presentationDetents([.medium, .large])
  }
}

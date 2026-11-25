import Charts
import MapKit
import SwiftUI
import VerifiedCore

/// The evidence room (feed v5): the Moment detail regrouped under the feed's three waypoints, Intent / Proof /
/// Result, with the dashed track and dots down the left and a sticky jump bar. Nothing from the old detail is gone:
/// map track, frame timeline, motion chart, video review, judge/skeptic/score, claims, bar, ladder, seal checklist,
/// guest upload and owner delete. Follows the app theme.
struct MomentDetailView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var model: MomentDetailModel
  @State private var selectedFrame: MomentDetailModel.Frame?
  @State private var confirmingDelete = false
  @State private var deleteError: String?
  @State private var activeSection: Waypoint = .intent
  /// Opened from "My Moments": the only place delete is offered (never from the feed).
  private let fromMyMoments: Bool

  init(initial: MomentCardData, fromMyMoments: Bool = false) {
    _model = State(initialValue: MomentDetailModel(initial: initial))
    self.fromMyMoments = fromMyMoments
  }

  var body: some View {
    let m = model.card
    let muted = m.status == "rejected"
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          header(m)
          VStack(alignment: .leading, spacing: 30) {
            intentSection(m).id(Waypoint.intent)
            proofSection(m).id(Waypoint.proof)
            resultSection(m).id(Waypoint.result)
          }
          .scrollTargetLayout()
          .waypointTrack(muted ? Color.secondary.opacity(0.6) : FeedInk.orange)
        }
        .padding(16)
      }
      .onScrollTargetVisibilityChange(idType: Waypoint.self, threshold: 0.05) { visible in
        if let first = Waypoint.allCases.first(where: { visible.contains($0) }) { activeSection = first }
      }
      .safeAreaInset(edge: .top, spacing: 0) { jumpBar(proxy) }
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Evidence room")
    .navigationBarTitleDisplayMode(.inline)
    .task { model.start() }
    .onDisappear { model.stop() }
    .sheet(item: $selectedFrame) { f in FrameSheet(frame: f) }
    .toolbar {
      if !m.local {
        ToolbarItem(placement: .topBarTrailing) {
          ShareLink(item: momentShareURL(m.id), subject: Text("Verified"), message: Text(m.intention)) {
            Label("Share", systemImage: "square.and.arrow.up")
          }
        }
      }
      if app.canDelete(m, fromMyMoments: fromMyMoments) {
        ToolbarItem(placement: .topBarTrailing) {
          Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete Moment", systemImage: "trash") }
        }
      }
    }
    .confirmationDialog(MomentDeletion.confirmTitle, isPresented: $confirmingDelete, titleVisibility: .visible) {
      Button("Delete Moment", role: .destructive) { delete(m) }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(MomentDeletion.confirmMessage)
    }
    .alert("Could not delete", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(deleteError ?? "")
    }
  }

  private func delete(_ m: MomentCardData) {
    do {
      try app.deleteMoment(m)
      model.stop()
      dismiss()
    } catch {
      deleteError = error.localizedDescription
    }
  }

  /// Sticky Intent / Proof / Result jump bar.
  private func jumpBar(_ proxy: ScrollViewProxy) -> some View {
    HStack(spacing: 8) {
      ForEach(Waypoint.allCases) { w in
        Button {
          activeSection = w
          if reduceMotion {
            proxy.scrollTo(w, anchor: .top)
          } else {
            withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(w, anchor: .top) }
          }
        } label: {
          Text(w.title)
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14).padding(.vertical, 6)
            .foregroundStyle(activeSection == w ? Color.white : Color.primary)
            .background(activeSection == w ? AnyShapeStyle(FeedInk.orange) : AnyShapeStyle(Color(.tertiarySystemFill)),
                        in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(activeSection == w ? .isSelected : [])
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 16).padding(.vertical, 8)
    .background(.bar)
  }

  // MARK: Header (above the thread): the proof shot, the badge, and the guest upload box.

  private func header(_ m: MomentCardData) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      ZStack(alignment: .topTrailing) {
        HeroImage(b64: m.heroJpegB64, category: m.category)
          .frame(height: 240).frame(maxWidth: .infinity).clipped()
          .saturation(m.status == "rejected" ? 0.2 : 1)
          .clipShape(RoundedRectangle(cornerRadius: 18))
        VerdictBadge(status: m.badgeStatus).padding(10)
      }
      if m.local {
        HStack(alignment: .top, spacing: 12) {
          Image(systemName: "iphone").font(.title3).foregroundStyle(.indigo)
          VStack(alignment: .leading, spacing: 6) {
            Text(m.status == "recording" ? "Recording on this device" : "On this device · sign in to verify")
              .font(.subheadline.bold())
            Text("Recorded as a guest. The hash chain is complete; the cloud judge, skeptic, scorer and the seal run after upload.")
              .font(.caption).foregroundStyle(.secondary)
            if m.status == "submitted" {
              Button { app.upload(m) } label: {
                Label("Upload & verify", systemImage: "icloud.and.arrow.up").font(.subheadline.weight(.semibold))
              }
              .buttonStyle(.borderedProminent).controlSize(.small)
            }
          }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.indigo.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
      }
    }
  }

  // MARK: 1. Intent

  private func intentSection(_ m: MomentCardData) -> some View {
    let cat = Category(rawValue: m.category) ?? .other
    return waypointSection(.intent, m, detail: "what \(m.ownerName) said they would do, before starting") {
      VStack(alignment: .leading, spacing: 10) {
        Label(cat.label.uppercased(), systemImage: cat.icon)
          .font(.caption.weight(.bold)).kerning(1).foregroundStyle(FeedInk.orange)
        Text("\(Text("“").foregroundStyle(FeedInk.orange))\(m.intention)\(Text("”").foregroundStyle(FeedInk.orange))")
          .font(.title2.weight(.heavy))
          .fixedSize(horizontal: false, vertical: true)
        HStack(spacing: 8) {
          Avatar(url: m.ownerPhotoURL, name: m.ownerName, size: 24)
          Text(m.ownerName).font(.subheadline)
          if let when = startedText(m) { Text("· \(when)").font(.subheadline).foregroundStyle(.secondary) }
        }
        FlowChips {
          Chip(text: platformName(m.platform), systemImage: platformIcon(m.platform))
          if m.onDeviceMode == "on_device" { Chip(text: "checked on-device", systemImage: "cpu", color: Theme.accent) }
          if m.recordedAsGuest { Chip(text: "recorded as a guest", systemImage: "person.crop.circle.badge.questionmark") }
          if m.hasPendingWrites { Chip(text: "queued", systemImage: "icloud.slash", color: Theme.warn) }
        }
      }
      if let s = m.structured { card("Intention", icon: "text.quote") { IntentionDetails(intention: s) } }
      if !m.claims.isEmpty {
        card(m.claimsFromServer ? "What has to be shown" : "What has to be shown (draft)", icon: "checklist") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(m.claims) { c in
              Label(c.text, systemImage: c.kind.icon).font(.subheadline)
            }
          }
        }
      }
    }
  }

  // MARK: 2. Proof

  private func proofSection(_ m: MomentCardData) -> some View {
    let answered = max(m.witnessAnswered, model.witnessAnswers)
    return waypointSection(.proof, m, detail: "captured on the phone as it happened, hashed chunk by chunk") {
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
      card("Proof frames", icon: "camera") { frameTimeline }
      card("Motion", icon: "waveform.path.ecg") { motionChart }
      card("Track", icon: "map") { TrackMap(track: model.track) }
      if m.witnessAsked > 0 || answered > 0 {
        card("Witness", icon: "person.wave.2.fill") {
          VStack(alignment: .leading, spacing: 4) {
            Text(m.witnessAsked > 0
                 ? "\(answered) of \(m.witnessAsked) witness \(m.witnessAsked == 1 ? "question" : "questions") answered"
                 : "\(answered) witness \(answered == 1 ? "answer" : "answers") in the chain")
              .font(.subheadline)
            if m.witnessSkipped > 0 {
              Text("\(m.witnessSkipped) skipped").font(.caption).foregroundStyle(.secondary)
            }
          }
        }
      }
      if !m.local {
        VideoStatusLine(momentId: m.id, review: m.videoReview, status: m.status)
      }
      card("Hash chain", icon: "link") { ChainRecheckLine(chainVerified: model.chainVerified, chunkCount: model.chunkCount) }
    }
  }

  // MARK: 3. Result

  private func resultSection(_ m: MomentCardData) -> some View {
    waypointSection(.result, m, detail: "AIs propose, a Cloud Function decides") {
      verdictBox(m)
      if ClaimsSection.visible(m) { card("Claims", icon: "checklist") { ClaimsSection(model: model) } }
      if m.bar != nil || m.displayScore != nil || m.structured?.preview != nil {
        card("Bar & score", icon: "flag.checkered") { BarScoreCard(card: m) }
      }
      card("AI opinions", icon: "brain") { opinions(m) }
      if LadderSection.visible(m, uid: app.auth.user?.uid) {
        card("Verification ladder", icon: "chart.line.uptrend.xyaxis") { LadderSection(model: model) }
      }
      card("Seal", icon: "checkmark.seal") {
        SealChecklist(card: m, chainVerified: model.chainVerified, chunkCount: model.chunkCount, showsChain: false)
      }
    }
  }

  /// Stamp + seal reason + "n of 5 seal checks passed, p% likely true".
  private func verdictBox(_ m: MomentCardData) -> some View {
    let decided = m.status == "sealed" || m.status == "rejected"
    let passed = feedCheckOrder.filter { m.checks[$0.key] == true }.count
    let summary = [m.checks.isEmpty ? nil : "\(passed) of 5 seal checks passed",
                   percent(m.displayScore).map { "\($0)% likely true" }].compactMap { $0 }
    return VStack(alignment: .leading, spacing: 12) {
      SealStamp(verified: m.isVerified, pending: !decided, fontSize: 20).padding(.vertical, 4)
      if let reason = m.sealReason, !reason.isEmpty {
        Text(reason).font(.subheadline).foregroundStyle(m.isVerified ? Theme.accent : decided ? Theme.bad : Color.secondary)
      }
      if !summary.isEmpty {
        Text(summary.joined(separator: ", ")).font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
  }

  // MARK: Building blocks

  /// One waypoint: dot + title + subtitle, then its cards.
  private func waypointSection<Content: View>(_ w: Waypoint, _ m: MomentCardData, detail: String,
                                               @ViewBuilder _ content: () -> Content) -> some View {
    HStack(alignment: .top, spacing: 10) {
      WaypointDot(kind: w, muted: m.status == "rejected",
                  pending: w == .result && m.status != "sealed" && m.status != "rejected",
                  fill: Color(.systemGroupedBackground))
        .padding(.top, 4)
      VStack(alignment: .leading, spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(w.title).font(.title3.weight(.heavy))
          Text(detail).font(.footnote).foregroundStyle(.secondary)
        }
        content()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func startedText(_ m: MomentCardData) -> String? {
    let date = m.startedAt > 0 ? Date(timeIntervalSince1970: Double(m.startedAt) / 1000) : m.sealedAt
    return date?.formatted(date: .abbreviated, time: .shortened)
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
      ScoreCard(score: m.score, pending: m.status == "recording" || m.status == "submitted")
    }
  }

  private func card<Content: View>(_ title: String, icon: String, @ViewBuilder _ content: () -> Content) -> some View {
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

/// The scorer's P(claim true | evidence) under an adversarial prior.
struct ScoreCard: View {
  let score: VerificationScore?
  let pending: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Label("Verification score", systemImage: "percent").font(.subheadline.bold())
        Spacer()
        if score == nil {
          Chip(text: pending ? "pending" : "Not scored", systemImage: pending ? "hourglass" : nil)
        }
      }
      if let s = score {
        Text("\(Int((s.probability * 100).rounded()))%")
          .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(s.probability >= 0.5 ? Theme.accent : Theme.bad)
      }
      Text("Chance the claim is true given the evidence, assuming most submissions are cheating (prior 20%).")
        .font(.caption).foregroundStyle(.secondary)
      ForEach(Array((score?.reasons ?? []).enumerated()), id: \.offset) { item in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text("•")
          Text(item.element)
        }
        .font(.footnote)
      }
      if let model = score?.model, !model.isEmpty {
        Text("\(model) · cloud (Firebase AI Logic)").font(.caption2).foregroundStyle(.tertiary)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
  }
}

/// The five deterministic checks the Cloud Function runs (contract `Seal.checks`).
struct SealChecklist: View {
  let card: MomentCardData
  let chainVerified: Bool?
  let chunkCount: Int
  /// The evidence room shows the on-phone chain re-check under Proof instead.
  var showsChain = true

  /// Seal v3 moves the score gate from `ai` to the new `bar` check (docs/ARCHITECTURE.md v3.5); seal v4 adds
  /// `cheating` and makes `bar` per claim (v4.5).
  var rows: [(key: String, title: String)] {
    if (card.sealVersion ?? 0) >= 4 || card.checks["cheating"] != nil {
      return [
        ("chain", "Hash chain intact"),
        ("timing", "Timing consistent (≥ 20 s, in order)"),
        ("physics", "Physics plausible (no GPS jumps)"),
        ("frames", "Proof frames match their hashes"),
        ("ai", "Proof frames don't contradict the intention"),
        ("cheating", "No cheating detected"),
        ("bar", "Every claim reaches the bar" + (card.bar.map { String(format: " (%.2f)", $0.value) } ?? "")),
      ]
    }
    let v3 = (card.sealVersion ?? 0) >= 3 || card.checks["bar"] != nil
    var r: [(key: String, title: String)] = [
      ("chain", "Hash chain intact"),
      ("timing", "Timing consistent (≥ 20 s, in order)"),
      ("physics", "Physics plausible (no GPS jumps)"),
      ("frames", "Proof frames match their hashes"),
      ("ai", v3 ? "Judge consistent, skeptic found no fake" : "Judge consistent, skeptic found no fake, score ≥ 50%"),
    ]
    if v3 || card.bar != nil {
      r.append(("bar", "Score reaches the bar" + (card.bar.map { String(format: " (%.2f)", $0.value) } ?? "")))
    }
    return r
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(rows, id: \.key) { row in
        HStack(spacing: 10) {
          icon(card.checks[row.key])
          Text(row.title).font(.subheadline)
          Spacer()
        }
      }
      if showsChain {
        Divider()
        ChainRecheckLine(chainVerified: chainVerified, chunkCount: chunkCount)
      }
      if card.checks.isEmpty {
        Text(statusLine).font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  private var statusLine: String {
    if card.local { return "Kept on this device. The seal runs after you sign in and upload it." }
    return switch card.status {
    case "recording": "Still recording."
    case "submitted":
      card.judge == nil ? "Waiting for the cloud judge, skeptic and scorer (runs when the owner's phone is online)."
        : card.bar == nil ? "Waiting for the cloud to set the bar, then the seal."
        : card.videoReview?.status == "waiting" ? "Waiting for video upload."
        : card.videoReview?.status == "running" ? "Reviewing video, then the seal." : "Waiting for the seal function."
    default: ""
    }
  }

  private func icon(_ ok: Bool?) -> some View { CheckIcon(ok: ok) }
}

/// "Re-checked on this phone: 42 chunks, SHA-256 chain valid" (the evidence room shows it under Proof).
struct ChainRecheckLine: View {
  let chainVerified: Bool?
  let chunkCount: Int

  var body: some View {
    HStack(spacing: 10) {
      CheckIcon(ok: chainVerified)
      Text(chainVerified == nil ? "Re-checking the chain on this phone…"
           : "Re-checked on this phone: \(chunkCount) chunks, SHA-256 chain \(chainVerified == true ? "valid" : "BROKEN")")
        .font(.footnote).foregroundStyle(.secondary)
    }
  }
}

struct CheckIcon: View {
  let ok: Bool?
  var body: some View {
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

/// The structured intention (v3.2): goal, numbers, place, conditions, what the AI assumed.
struct IntentionDetails: View {
  let intention: StructuredIntention

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !intention.activity.isEmpty {
        Text(intention.activity.uppercased()).font(.caption.weight(.bold)).kerning(1).foregroundStyle(Theme.accent)
      }
      if !intention.goal.isEmpty { Text(intention.goal).font(.subheadline.weight(.semibold)) }
      if let place = intention.place?.label {
        Label(place, systemImage: "mappin.and.ellipse").font(.footnote).foregroundStyle(.secondary)
      }
      if !intention.quantities.isEmpty || !intention.conditions.isEmpty {
        FlowChips {
          ForEach(intention.quantities) { q in Chip(text: "\(q.label) · \(q.measuredBy)", systemImage: "ruler", color: Theme.accent) }
          ForEach(intention.conditions, id: \.self) { Chip(text: $0, systemImage: "cloud.sun") }
        }
      }
      if !intention.assumptions.isEmpty {
        Text("Assumed: " + intention.assumptions.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
      }
      if intention.mode != "typed" {
        Label("\(intention.turns)-answer voice interview · \(intention.mode.replacingOccurrences(of: "_", with: "-"))",
              systemImage: "waveform")
          .font(.caption2).foregroundStyle(.tertiary)
      }
    }
  }
}

/// Bar (set by the Cloud Function from the intention) vs the verification score (baseline → after the ladder).
struct BarScoreCard: View {
  let card: MomentCardData

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 18) {
        if let s = card.displayScore {
          metric(String(format: "%.2f", s), "score", color: card.bar.map { s >= $0.value ? Theme.accent : Theme.bad } ?? .primary)
        }
        if let b = card.bar { metric(String(format: "%.2f", b.value), "bar", color: Theme.warn) }
        if let d = card.bar?.difficulty { metric(String(format: "%.2f", d), "difficulty", color: .secondary) }
        Spacer()
        if let v = card.verifiedByScore {
          Chip(text: v ? "reaches the bar" : "below the bar", systemImage: v ? "checkmark" : "arrow.down", color: v ? Theme.accent : Theme.bad)
        }
      }
      if let b = card.bar { BarGauge(score: card.displayScore, bar: b.value).frame(height: 10) }
      if let base = card.baselineScore, let fin = card.finalScore, !card.ladder.isEmpty, abs(base - fin) > 0.0005 {
        Text(String(format: "Baseline %.2f → %.2f after %d ladder %@", base, fin, card.ladder.count,
                    card.ladder.count == 1 ? "module" : "modules"))
          .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
      }
      if let b = card.bar {
        if let r = b.rationale, !r.isEmpty { Text(r).font(.footnote) }
        if !b.factors.isEmpty {
          FlowChips { ForEach(b.factors, id: \.self) { Chip(text: $0, color: Theme.warn) } }
        }
        Text(b.source == "default" ? "Standard bar (the bar model was unavailable)."
             : "Set in the cloud from the intention: harder or more tempting claims need a higher score.")
          .font(.caption2).foregroundStyle(.tertiary)
      } else if card.local || card.status == "recording" || card.status == "submitted" {
        // Before the server sets the binding bar: the client's hybrid preview from the interview (v3.2 step 4).
        if let p = card.structured?.preview {
          HStack(spacing: 8) {
            Text(String(format: "Bar ≈ %.2f", p.bar)).font(.title3.bold().monospacedDigit()).foregroundStyle(Theme.warn)
            Text("preview").font(.caption).foregroundStyle(.secondary)
            Chip(text: p.mode == "on_device" ? "on-device" : "cloud", systemImage: p.mode == "on_device" ? "cpu" : "cloud",
                 color: p.mode == "on_device" ? Theme.accent : .blue)
          }
        }
        Text(card.local ? "The cloud sets the binding bar after you upload this Moment."
             : "The cloud sets the binding bar when the Moment is submitted.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private func metric(_ v: String, _ label: String, color: Color) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(v).font(.system(size: 28, weight: .bold, design: .rounded).monospacedDigit()).foregroundStyle(color)
      Text(label).font(.caption2).foregroundStyle(.secondary)
    }
  }
}

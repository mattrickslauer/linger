import Charts
import MapKit
import SwiftUI
import VerifiedCore

/// The evidence room (tight pass, 2026-11-28): a compact summary card (aspect-fit media thumbnail, intention, who /
/// when / platform, stamp + score ring + claims, check pips), one row of stats, then an "Evidence" grid of tiles
/// that each open the full view in a modal (video and proof shots full screen; route, motion, hash chain and
/// witness as sheets), then the Result: verdict, claims, bar, AI opinions, ladder. Nothing from the old detail is
/// gone; it moved behind a tap. Video plays with upright controls (the picture alone is turned by
/// `displayRotation`). Follows the app theme.
struct MomentDetailView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var model: MomentDetailModel
  @State private var confirmingDelete = false
  @State private var deleteError: String?
  @State private var opinion: OpinionKind?
  @State private var checksOpen = false
  @State private var media: MediaModal?
  @State private var evidenceSheet: EvidenceSheet?
  /// Opened from "My Moments": the only place delete is offered (never from the feed).
  private let fromMyMoments: Bool

  /// Full-screen media modals.
  enum MediaModal: Identifiable, Hashable {
    case clip(Int), photo, shots
    var id: String {
      switch self {
      case .clip(let i): "clip-\(i)"
      case .photo: "photo"
      case .shots: "shots"
      }
    }
  }

  /// Sheet modals (detents) for the non-media evidence.
  enum EvidenceSheet: String, Identifiable {
    case route, motion, chain, witness
    var id: String { rawValue }
  }

  init(initial: MomentCardData, fromMyMoments: Bool = false) {
    _model = State(initialValue: MomentDetailModel(initial: initial))
    self.fromMyMoments = fromMyMoments
  }

  var body: some View {
    let m = model.card
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        summaryCard(m)
        statsRow(m)
        if m.local { localBox(m) }
        if let s = m.structured { IntentionDetails(intention: s).surfaceCard(padding: 12) }
        evidenceSection(m)
        resultSection(m)
      }
      .padding(16)
    }
    .background(Theme.paper)
    .navigationTitle("Evidence")
    .navigationBarTitleDisplayMode(.inline)
    .task { model.start() }
    .onDisappear { model.stop() }
    .sheet(item: $opinion) { kind in OpinionSheet(kind: kind, card: m) }
    .sheet(item: $evidenceSheet) { kind in evidenceSheetView(kind, m) }
    .fullScreenCover(item: $media) { modal in mediaView(modal, m) }
    // The seal lands while the room is open: a success / error tap.
    .sensoryFeedback(trigger: m.status) { old, new in
      if new == "sealed" && old != "sealed" { return .success }
      if new == "rejected" && old != "rejected" { return .error }
      return nil
    }
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

  // MARK: Summary card

  /// Thumbnail left (opens the media viewer); intention, who / when / platform, stamp + ring + claims, pips right.
  private func summaryCard(_ m: MomentCardData) -> some View {
    let decided = m.status == "sealed" || m.status == "rejected"
    return HStack(alignment: .top, spacing: 12) {
      Button { media = m.videoClips.isEmpty ? .photo : .clip(playableClipIndex(m)) } label: { summaryThumb(m) }
        .buttonStyle(.plain)
        .accessibilityLabel(m.videoClips.isEmpty ? "Proof photo" : "Play video")
        .accessibilityHint("Opens full screen")
      VStack(alignment: .leading, spacing: 6) {
        Text(m.intention)
          .font(.headline.weight(.heavy))
          .lineLimit(4)
          .fixedSize(horizontal: false, vertical: true)
        Text(metaLine(m))
          .font(.caption).foregroundStyle(.secondary)
          .lineLimit(2)
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 10) { verdictRow(m, decided: decided) }
          VStack(alignment: .leading, spacing: 8) { verdictRow(m, decided: decided) }
        }
        .padding(.top, 2)
        CheckPips(checks: m.checks, size: 22)
          .accessibilityLabel(m.checks.isEmpty ? "Seal checks pending"
                              : "\(CheckPips.passed(m.checks)) of 5 seal checks passed")
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .surfaceCard(padding: 12)
  }

  @ViewBuilder private func verdictRow(_ m: MomentCardData, decided: Bool) -> some View {
    SealStamp(verified: m.isVerified, pending: !decided, fontSize: 13)
    if m.displayScore != nil || m.bar != nil {
      ScoreRing(p: m.displayScore, bar: m.bar?.value, pending: !decided && m.displayScore == nil, size: 44, caption: nil)
    }
    if m.claimsTotal > 0 {
      let text = m.claimsBacked.map { "\($0)/\(m.claimsTotal) claims" } ?? "\(m.claimsTotal) claims"
      Chip(text: text, systemImage: Glyph.claims, color: Theme.lake)
        .fixedSize()
        .accessibilityLabel(m.claimsBacked.map { "\($0) of \(m.claimsTotal) claims backed" } ?? "\(m.claimsTotal) claims")
    }
  }

  /// The hero photo turned by `displayRotation`, whole (aspect fit), with a play badge when there's video.
  private func summaryThumb(_ m: MomentCardData) -> some View {
    HeroImage(b64: m.heroJpegB64, category: m.category, rotation: m.displayRotation)
      .frame(width: 104, height: 138)
      .saturation(m.status == "rejected" ? 0.2 : 1)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay { if !m.videoClips.isEmpty { PlayBadge(size: 40) } }
      .overlay(alignment: .topLeading) {
        StatusBadge(status: m.badgeStatus, compact: true).padding(6)
      }
      .contentShape(Rectangle())
  }

  private func metaLine(_ m: MomentCardData) -> String {
    var parts = [m.ownerName]
    let date = m.sealedAt ?? (m.startedAt > 0 ? Date(timeIntervalSince1970: Double(m.startedAt) / 1000) : nil)
    if let date { parts.append(date.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))) }
    parts.append(platformName(m.platform))
    return parts.filter { !$0.isEmpty }.joined(separator: " · ")
  }

  /// The clip the thumbnail opens: the feed's (last with a good hash), else the first.
  private func playableClipIndex(_ m: MomentCardData) -> Int {
    if let f = m.feedClip, let i = m.videoClips.firstIndex(of: f) { return i }
    return 0
  }

  // MARK: Stats row

  private struct Stat: Identifiable {
    let icon: String
    let value: String
    let label: String
    var id: String { label }
  }

  /// Duration, distance, proof shots and where the coach ran, as one compact row (wraps when it must).
  private func statsRow(_ m: MomentCardData) -> some View {
    var stats: [Stat] = []
    if let s = m.summary {
      stats.append(Stat(icon: Glyph.timing, value: formatDuration(ms: s.durationMs), label: "duration"))
      stats.append(Stat(icon: Glyph.gps, value: formatDistance(s.distanceM), label: "distance"))
      stats.append(Stat(icon: Glyph.shots, value: "\(s.frameCount)", label: "proof shots"))
    }
    return FlowChips {
      ForEach(stats) { s in
        StatChip(icon: s.icon, value: s.value, tint: Theme.track)
          .accessibilityLabel("\(s.value) \(s.label)")
      }
      if m.onDeviceMode == "on_device" { HybridBadge(onDevice: true, text: "coach on device") }
      if m.onDeviceMode == "cloud" { HybridBadge(onDevice: false, text: "coach in cloud") }
      if m.recordedAsGuest { Chip(text: "guest", systemImage: "person.crop.circle.badge.questionmark") }
      if m.hasPendingWrites { Chip(text: "queued", systemImage: "icloud.slash", color: Theme.warn) }
    }
    .padding(.horizontal, 4)
  }

  /// Guest Moment: one line + the upload action.
  private func localBox(_ m: MomentCardData) -> some View {
    HStack(spacing: 12) {
      Image(systemName: Glyph.onDevice).font(.title3).foregroundStyle(Theme.lake)
      VStack(alignment: .leading, spacing: 2) {
        Text(m.status == "recording" ? "Recording on this device" : "On this device")
          .font(.subheadline.bold())
        Text("Chain complete. Cloud checks run after upload.").font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      if m.status == "submitted" {
        Button { app.upload(m) } label: {
          Label("Upload", systemImage: "icloud.and.arrow.up").font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.borderedProminent).tint(Theme.lake)
      }
    }
    .surfaceCard(padding: 12)
  }

  // MARK: Evidence grid

  private func evidenceSection(_ m: MomentCardData) -> some View {
    let answered = max(m.witnessAnswered, model.witnessAnswers)
    let retakes = model.frames.filter { $0.check?.ok == false }.count
    let shotCount = model.frames.isEmpty ? (m.summary?.frameCount ?? 0) : model.frames.count
    return VStack(alignment: .leading, spacing: 10) {
      sectionHeader("Evidence", icon: Glyph.proof)
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
        ForEach(Array(m.videoClips.enumerated()), id: \.element.id) { i, clip in
          Button { media = .clip(i) } label: {
            EvidenceTile(icon: Glyph.video,
                         title: m.videoClips.count > 1 ? "Video \(i + 1)" : "Video",
                         value: clip.durationMs > 0 ? formatDuration(ms: clip.durationMs) : "Clip",
                         detail: clip.hashOk == false ? "hash mismatch" : clip.hashOk == true ? "hash matches" : "hash pending",
                         status: clip.hashOk) {
              mediaPreview(m, play: true)
            }
          }
          .buttonStyle(.plain)
          .accessibilityHint("Plays the clip full screen")
        }
        Button { media = .shots } label: {
          EvidenceTile(icon: Glyph.shots, title: "Proof shots", value: "\(shotCount)",
                       detail: retakes > 0 ? "\(retakes) retake\(retakes == 1 ? "" : "s")" : model.loading ? "loading" : "no retakes",
                       status: nil) {
            mediaPreview(m, play: false)
          }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the proof shots full screen")
        Button { evidenceSheet = .route } label: {
          EvidenceTile(icon: Glyph.gps, title: "Route",
                       value: m.summary.map { formatDistance($0.distanceM) } ?? "–",
                       detail: model.track.isEmpty ? (model.loading ? "loading" : "no GPS fixes") : "\(model.track.count) GPS fixes",
                       status: nil) {
            TrackSketch(track: m.track.isEmpty ? model.track.map { LatLng(lat: $0.latitude, lng: $0.longitude) } : m.track,
                        width: 132, height: 80)
          }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the map")
        Button { evidenceSheet = .motion } label: {
          EvidenceTile(icon: Glyph.motion, title: "Motion",
                       value: model.motion.map(\.mag).max().map { String(format: "%.1f", $0) } ?? "–",
                       detail: model.motion.isEmpty ? (model.loading ? "loading" : "no samples") : "peak m/s²",
                       status: nil) {
            motionSparkline
          }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the motion chart")
        Button { evidenceSheet = .chain } label: {
          EvidenceTile(icon: Glyph.chain, title: "Hash chain", value: "\(model.chunkCount)",
                       detail: model.chainVerified == nil ? "re-checking" : model.chainVerified == true ? "links valid" : "BROKEN",
                       status: model.chainVerified) {
            chainLinks
          }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the chain re-check")
        if m.witnessAsked > 0 || answered > 0 {
          Button { evidenceSheet = .witness } label: {
            EvidenceTile(icon: Glyph.witness, title: "Witness",
                         value: m.witnessAsked > 0 ? "\(answered)/\(m.witnessAsked)" : "\(answered)",
                         detail: m.witnessSkipped > 0 ? "\(m.witnessSkipped) skipped" : "answered",
                         status: nil) {
              Image(systemName: Glyph.witness).font(.system(size: 30, weight: .semibold)).foregroundStyle(Theme.lake)
            }
          }
          .buttonStyle(.plain)
          .accessibilityHint("Shows the witness answers")
        }
      }
      if !m.local {
        // The video-coverage note: one small line.
        VideoStatusLine(momentId: m.id, review: m.videoReview, status: m.status)
          .padding(.horizontal, 4)
      }
    }
  }

  /// A tile preview: the hero photo, whole, optionally with a play badge.
  private func mediaPreview(_ m: MomentCardData, play: Bool) -> some View {
    HeroImage(b64: m.heroJpegB64, category: m.category, rotation: m.displayRotation)
      .overlay { if play { PlayBadge(size: 34) } }
  }

  @ViewBuilder private var motionSparkline: some View {
    if model.motion.isEmpty {
      Image(systemName: Glyph.motion).font(.system(size: 30, weight: .semibold)).foregroundStyle(.secondary)
    } else {
      Chart(model.motion) { p in
        LineMark(x: .value("Seconds", p.s), y: .value("|a| m/s²", p.mag))
          .foregroundStyle(Theme.lake)
          .lineStyle(StrokeStyle(lineWidth: 1.2))
      }
      .chartXAxis(.hidden)
      .chartYAxis(.hidden)
      .padding(8)
    }
  }

  /// A row of chain links tinted by the on-phone re-check.
  private var chainLinks: some View {
    HStack(spacing: -3) {
      let n = min(max(model.chunkCount, 1), 6)
      ForEach(0..<n, id: \.self) { _ in
        Image(systemName: Glyph.chain).font(.title3.weight(.heavy))
      }
      if model.chunkCount > 6 { Text("+").font(.title3.weight(.heavy)).padding(.leading, 4) }
    }
    .foregroundStyle(chainTint)
  }

  private var chainTint: Color {
    switch model.chainVerified {
    case .some(true): Theme.ok
    case .some(false): Theme.bad
    case .none: .secondary
    }
  }

  // MARK: Modals

  @ViewBuilder private func mediaView(_ modal: MediaModal, _ m: MomentCardData) -> some View {
    switch modal {
    case .clip(let i):
      ClipViewer(clips: m.videoClips, start: i, rotation: m.displayRotation)
    case .photo:
      PhotoViewer(b64: m.heroJpegB64, category: m.category, rotation: m.displayRotation)
    case .shots:
      ProofShotsViewer(model: model)
    }
  }

  @ViewBuilder private func evidenceSheetView(_ kind: EvidenceSheet, _ m: MomentCardData) -> some View {
    let answered = max(m.witnessAnswered, model.witnessAnswers)
    switch kind {
    case .route:
      EvidenceSheetFrame(title: "Route", detents: [.medium, .large]) {
        mapCard(m)
      }
    case .motion:
      EvidenceSheetFrame(title: "Motion", detents: [.medium]) {
        motionCard
      }
    case .chain:
      EvidenceSheetFrame(title: "Hash chain", detents: [.medium]) {
        VStack(alignment: .leading, spacing: 14) {
          chainLinks
          ChainRecheckLine(chainVerified: model.chainVerified, chunkCount: model.chunkCount)
          if let ok = m.checks["chain"] {
            HStack(spacing: 10) {
              CheckPip(check: .chain, ok: ok, size: 24)
              Text("Seal: hash chain \(ok ? "intact" : "broken")").font(.subheadline)
            }
            .accessibilityElement(children: .combine)
          }
        }
        .surfaceCard()
      }
    case .witness:
      EvidenceSheetFrame(title: "Witness", detents: [.medium]) {
        HStack(spacing: 10) {
          StatTile(icon: Glyph.witness, value: "\(answered)", label: "answered")
          if m.witnessAsked > 0 { StatTile(icon: "questionmark.bubble", value: "\(m.witnessAsked)", label: "asked") }
          if m.witnessSkipped > 0 { StatTile(icon: "forward", value: "\(m.witnessSkipped)", label: "skipped", tint: Theme.warn) }
        }
      }
    }
  }

  /// The GPS track with distance / time / fixes overlaid on the map.
  private func mapCard(_ m: MomentCardData) -> some View {
    TrackMap(track: model.track, height: 360)
      .overlay(alignment: .bottomLeading) {
        if !model.track.isEmpty, let s = m.summary {
          HStack(spacing: 6) {
            StatChip(icon: Glyph.gps, value: formatDistance(s.distanceM), tint: Theme.track, onMedia: true)
              .accessibilityLabel("\(formatDistance(s.distanceM)) moved")
            StatChip(icon: Glyph.timing, value: formatDuration(ms: s.durationMs), onMedia: true)
              .accessibilityLabel("\(formatDuration(ms: s.durationMs)) recorded")
          }
          .padding(10)
        }
      }
      .overlay(alignment: .topTrailing) {
        if !model.track.isEmpty {
          StatChip(icon: "dot.radiowaves.up.forward", value: "\(model.track.count)", label: "fixes", onMedia: true)
            .padding(10)
        }
      }
  }

  @ViewBuilder private var motionCard: some View {
    VStack(alignment: .leading, spacing: 8) {
      GlyphHeader(icon: Glyph.motion, title: "Acceleration") {
        if let peak = model.motion.map(\.mag).max() {
          Text(String(format: "peak %.1f m/s²", peak)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
      }
      if model.motion.isEmpty {
        Text(model.loading ? "Loading…" : "No motion samples").font(.footnote).foregroundStyle(.secondary)
      } else {
        Chart(model.motion) { p in
          AreaMark(x: .value("Seconds", p.s), y: .value("|a| m/s²", p.mag))
            .foregroundStyle(LinearGradient(colors: [Theme.lake.opacity(0.35), Theme.lake.opacity(0.02)],
                                            startPoint: .top, endPoint: .bottom))
          LineMark(x: .value("Seconds", p.s), y: .value("|a| m/s²", p.mag))
            .foregroundStyle(Theme.lake)
            .lineStyle(StrokeStyle(lineWidth: 1.2))
        }
        .chartYAxis(.hidden)
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
        .frame(height: 160)
        .accessibilityLabel("Motion over time")
      }
    }
    .surfaceCard()
  }

  // MARK: Result

  private func resultSection(_ m: MomentCardData) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      sectionHeader("Result", icon: Glyph.result)
      verdictCard(m)
      if ClaimsSection.visible(m) { ClaimsSection(model: model).surfaceCard(padding: 12) }
      if m.bar != nil || m.displayScore != nil || m.structured?.preview != nil {
        BarScoreCard(card: m).surfaceCard(padding: 12)
      }
      opinions(m)
      if LadderSection.visible(m, uid: app.auth.user?.uid) {
        VStack(alignment: .leading, spacing: 10) {
          GlyphHeader(icon: Glyph.ladder, title: "Ladder")
          LadderSection(model: model)
        }
        .surfaceCard(padding: 12)
      }
    }
  }

  /// Stamp + one line of why, then the labelled check pips; tap the pips for the full seal checklist.
  private func verdictCard(_ m: MomentCardData) -> some View {
    let decided = m.status == "sealed" || m.status == "rejected"
    return VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 14) {
        ScoreRing(p: m.displayScore, bar: m.bar?.value, pending: !decided && m.displayScore == nil, size: 72)
        VStack(alignment: .leading, spacing: 6) {
          SealStamp(verified: m.isVerified, pending: !decided, fontSize: 15)
          if let reason = m.sealReason, !reason.isEmpty {
            Text(reason).font(.footnote)
              .foregroundStyle(m.isVerified ? Theme.ok : decided ? Theme.bad : Color.secondary)
              .lineLimit(3)
          }
        }
      }
      Button { withAnimation(reduceMotion ? nil : .snappy) { checksOpen.toggle() } } label: {
        HStack(alignment: .center) {
          CheckPips(checks: m.checks, size: 28, labeled: true)
          Spacer(minLength: 4)
          Image(systemName: "chevron.down").font(.footnote.weight(.bold)).foregroundStyle(.secondary)
            .rotationEffect(.degrees(checksOpen ? 180 : 0))
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityElement(children: .combine)
      .accessibilityLabel(m.checks.isEmpty ? "Seal checks pending"
                          : "\(CheckPips.passed(m.checks)) of 5 seal checks passed")
      .accessibilityHint(checksOpen ? "Hide the checklist" : "Show the checklist")
      if checksOpen {
        SealChecklist(card: m, chainVerified: model.chainVerified, chunkCount: model.chunkCount, showsChain: true)
          .transition(.opacity)
      }
    }
    .surfaceCard(padding: 14, radius: 20)
  }

  /// Judge, skeptic and scorer side by side: verdict glyph + number + one line; "More" opens a sheet.
  private func opinions(_ m: MomentCardData) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      GlyphHeader(icon: Glyph.ai, title: "AI opinions") { HybridBadge(onDevice: false) }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(alignment: .top, spacing: 10) {
          ForEach(OpinionKind.allCases) { k in
            Button { opinion = k } label: { OpinionTile(kind: k, card: m) }
              .buttonStyle(.plain)
          }
        }
      }
      .scrollClipDisabled()
    }
  }

  // MARK: Building blocks

  private func sectionHeader(_ title: String, icon: String) -> some View {
    Label(title, systemImage: icon)
      .font(.title3.weight(.heavy))
      .labelStyle(SectionLabelStyle())
      .padding(.top, 6)
      .accessibilityAddTraits(.isHeader)
  }
}

private struct SectionLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 8) {
      configuration.icon.foregroundStyle(Theme.track).font(.headline.weight(.bold))
      configuration.title
    }
  }
}

/// A round play badge over a media preview.
private struct PlayBadge: View {
  var size: CGFloat = 40
  var body: some View {
    Image(systemName: "play.fill")
      .font(.system(size: size * 0.4, weight: .bold))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(.black.opacity(0.5), in: Circle())
      .accessibilityHidden(true)
  }
}

/// One evidence tile: a preview area on top, then glyph + title, the big value and a one-line detail.
private struct EvidenceTile<Preview: View>: View {
  let icon: String
  let title: String
  let value: String
  let detail: String
  /// ✓ / ✗ / nothing, shown next to the value.
  let status: Bool?
  @ViewBuilder var preview: Preview

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ZStack {
        Theme.raised
        preview
      }
      .frame(height: 88)
      .frame(maxWidth: .infinity)
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      Label(title, systemImage: icon)
        .font(.caption.weight(.bold)).foregroundStyle(Theme.lake)
        .lineLimit(1)
      HStack(spacing: 6) {
        Text(value).font(.title3.weight(.heavy).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.6)
        Spacer(minLength: 0)
        if let status { CheckIcon(ok: status) }
      }
      Text(detail).font(.caption).foregroundStyle(status == false ? Theme.bad : .secondary).lineLimit(1)
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .contentShape(Rectangle())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(title): \(value), \(detail)")
    .accessibilityAddTraits(.isButton)
  }
}

/// A sheet modal of the evidence room: title, Done, the content, the given detents.
private struct EvidenceSheetFrame<Content: View>: View {
  let title: String
  let detents: Set<PresentationDetent>
  @ViewBuilder var content: Content
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        content.padding(16)
      }
      .background(Theme.paper)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents(detents)
    .presentationDragIndicator(.visible)
  }
}

/// The hero photo full screen, whole, turned by `displayRotation`.
private struct PhotoViewer: View {
  let b64: String?
  let category: String
  var rotation = 0
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 12) {
      HStack {
        Text("Proof photo").font(.headline)
        Spacer()
        ModalCloseButton { dismiss() }
      }
      Spacer(minLength: 0)
      if let b64, let cg = ProofFrame.cgImage(fromBase64: b64, rotation: rotation) {
        Image(decorative: cg, scale: 1).resizable().scaledToFit()
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          .accessibilityLabel("Proof photo")
      } else {
        HeroImage(b64: nil, category: category).frame(height: 240)
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
      Spacer(minLength: 0)
    }
    .padding(16)
    .background(Theme.media.ignoresSafeArea())
    .environment(\.colorScheme, .dark)
  }
}

/// Proof shots full screen: the selected shot on a stage (whole, never cropped) with its time and coach verdict, a
/// scrubber across the shots, and the filmstrip.
private struct ProofShotsViewer: View {
  let model: MomentDetailModel
  @State private var index = 0
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let frames = model.frames
    VStack(spacing: 12) {
      HStack {
        Text(frames.isEmpty ? "Proof shots" : "Shot \(min(index, frames.count - 1) + 1) of \(frames.count)")
          .font(.headline.monospacedDigit())
        Spacer()
        ModalCloseButton { dismiss() }
      }
      if frames.isEmpty {
        Spacer()
        Label(model.loading ? "Loading…" : "No proof frames",
              systemImage: model.loading ? "hourglass" : "photo.badge.exclamationmark")
          .font(.footnote).foregroundStyle(.secondary)
        Spacer()
      } else {
        let f = frames[min(index, frames.count - 1)]
        Group {
          if let img = f.image {
            Image(decorative: img, scale: 1).resizable().scaledToFit()
              .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          } else {
            Theme.raised.clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel("Proof frame at \(formatDuration(ms: Int64(max(0, f.offsetS) * 1000)))")
        FrameInfo(frame: f)
        if frames.count > 1 {
          Slider(value: Binding(get: { Double(min(index, frames.count - 1)) }, set: { index = Int($0.rounded()) }),
                 in: 0...Double(frames.count - 1), step: 1)
            .tint(Theme.track)
            .accessibilityLabel("Proof shot")
            .accessibilityValue("\(index + 1) of \(frames.count)")
        }
        ScrollViewReader { proxy in
          ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 8) {
              ForEach(Array(frames.enumerated()), id: \.element.id) { i, frame in
                Button { index = i } label: {
                  FrameThumb(frame: frame)
                    .overlay {
                      RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(i == index ? Theme.track : .clear, lineWidth: 3)
                    }
                }
                .buttonStyle(.plain)
                .id(i)
              }
            }
          }
          .frame(height: 138)
          .onChange(of: index) { _, i in withAnimation { proxy.scrollTo(i, anchor: .center) } }
        }
      }
    }
    .padding(16)
    .background(Theme.media.ignoresSafeArea())
    .environment(\.colorScheme, .dark)
  }
}

/// A filmstrip thumbnail: the frame, its offset bottom-left, the coach's verdict top-right.
private struct FrameThumb: View {
  let frame: MomentDetailModel.Frame

  var body: some View {
    Group {
      if let img = frame.image { FitImage(cgImage: img) }
      else { Theme.raised }
    }
    .frame(width: 104, height: 138)
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay(alignment: .bottomLeading) {
      Text("+\(formatDuration(ms: Int64(max(0, frame.offsetS) * 1000)))")
        .font(.caption2.weight(.bold).monospacedDigit())
        .foregroundStyle(.white)
        .padding(.horizontal, 6).padding(.vertical, 3)
        .background(.black.opacity(0.55), in: Capsule())
        .padding(6)
    }
    .overlay(alignment: .topTrailing) {
      if let c = frame.check {
        Image(systemName: c.ok ? "checkmark.circle.fill" : "arrow.counterclockwise.circle.fill")
          .symbolRenderingMode(.palette)
          .foregroundStyle(.white, c.ok ? Color(hex: 0x2F7A4B) : Color(hex: 0x9A5B00))
          .font(.title3).padding(5)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Proof frame at \(formatDuration(ms: Int64(max(0, frame.offsetS) * 1000)))"
                        + (frame.check.map { $0.ok ? ", coach: keep going" : ", coach: retake" } ?? ""))
    .accessibilityAddTraits(.isButton)
  }
}

struct TrackMap: View {
  let track: [CLLocationCoordinate2D]
  var height: CGFloat = 220

  var body: some View {
    if track.isEmpty {
      Label("No GPS fixes", systemImage: "location.slash")
        .font(.footnote).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, minHeight: 80)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    } else {
      Map(initialPosition: .automatic) {
        MapPolyline(coordinates: track).stroke(Theme.track, lineWidth: 4)
        if let s = track.first { Marker("Start", systemImage: "flag", coordinate: s).tint(Theme.lake) }
        if let e = track.last, track.count > 1 { Marker("End", systemImage: "flag.checkered", coordinate: e).tint(Theme.gold) }
      }
      .frame(height: height)
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
  }
}

// MARK: - AI opinions

enum OpinionKind: String, CaseIterable, Identifiable {
  case judge, skeptic, scorer
  var id: String { rawValue }
  var title: String { rawValue.capitalized }
  var icon: String {
    switch self {
    case .judge: "scalemass"
    case .skeptic: "eye.trianglebadge.exclamationmark"
    case .scorer: "percent"
    }
  }
}

/// A compact opinion: glyph + title, verdict glyph + number, one line, "More".
private struct OpinionTile: View {
  let kind: OpinionKind
  let card: MomentCardData

  var body: some View {
    let info = summary
    let glyph = info.0
    let tint = info.1
    let number = info.2
    let line = info.3
    VStack(alignment: .leading, spacing: 8) {
      Label(kind.title, systemImage: kind.icon).font(.subheadline.weight(.bold))
      HStack(spacing: 6) {
        Image(systemName: glyph).font(.title2.weight(.semibold)).foregroundStyle(tint)
        Text(number).font(.title2.weight(.heavy).monospacedDigit())
      }
      Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        .frame(maxWidth: .infinity, minHeight: 32, alignment: .topLeading)
      Text("More").font(.caption.weight(.bold)).foregroundStyle(Theme.lake)
    }
    .frame(width: 168, alignment: .leading)
    .padding(12)
    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .contentShape(Rectangle())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(kind.title): \(number). \(line)")
    .accessibilityHint("Shows every reason")
    .accessibilityAddTraits(.isButton)
  }

  private var pending: Bool { card.status == "recording" || card.status == "submitted" }

  private var summary: (String, Color, String, String) {
    switch kind {
    case .judge, .skeptic:
      let o = kind == .judge ? card.judge : card.skeptic
      let fallback = kind == .judge && card.judge == nil ? card.judgeReasons : []
      guard let o else {
        if fallback.isEmpty { return ("hourglass", Color.secondary, "–", pending ? "Pending" : "No opinion") }
        return ("checkmark.circle.fill", Theme.ok, "", fallback.first ?? "")
      }
      let (g, c): (String, Color) = switch o.verdict {
      case "consistent": ("checkmark.circle.fill", Theme.ok)
      case "inconsistent": ("xmark.circle.fill", Theme.bad)
      default: ("questionmark.circle.fill", Theme.warn)
      }
      return (g, c, "\(Int((o.confidence * 100).rounded()))%", o.reasons.first ?? o.verdict)
    case .scorer:
      guard let s = card.score else { return ("hourglass", Color.secondary, "–", pending ? "Pending" : "Not scored") }
      let ok = s.probability >= (card.bar?.value ?? 0.5)
      return (ok ? "arrow.up.circle.fill" : "arrow.down.circle.fill", ok ? Theme.ok : Theme.bad,
              "\(Int((s.probability * 100).rounded()))%", s.reasons.first ?? "likely true")
    }
  }
}

/// Every reason of one AI, in a sheet.
private struct OpinionSheet: View {
  let kind: OpinionKind
  let card: MomentCardData
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        Group {
          switch kind {
          case .judge:
            OpinionCard(title: "Judge", icon: kind.icon, opinion: card.judge,
                        fallbackReasons: card.judge == nil ? card.judgeReasons : [])
          case .skeptic:
            OpinionCard(title: "Skeptic", icon: kind.icon, opinion: card.skeptic, fallbackReasons: [])
          case .scorer:
            ScoreCard(score: card.score, pending: card.status == "recording" || card.status == "submitted")
          }
        }
        .padding(16)
      }
      .background(Theme.paper)
      .navigationTitle(kind.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents([.medium, .large])
  }
}

struct OpinionCard: View {
  let title: String
  let icon: String
  let opinion: AiOpinion?
  let fallbackReasons: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Label(title, systemImage: icon).font(.headline)
        Spacer()
        if let o = opinion {
          Chip(text: "\(o.verdict) · \(Int((o.confidence * 100).rounded()))%", color: color(o.verdict))
        } else if fallbackReasons.isEmpty {
          Chip(text: "pending", systemImage: "hourglass")
        }
      }
      ForEach(Array((opinion?.reasons ?? fallbackReasons).enumerated()), id: \.offset) { item in
        Label { Text(item.element) } icon: { Image(systemName: "circle.fill").font(.system(size: 5)) }
          .font(.subheadline)
      }
      if let o = opinion, !o.model.isEmpty {
        HStack(spacing: 6) {
          HybridBadge(onDevice: false)
          Text(o.model).font(.caption2).foregroundStyle(.secondary)
        }
      }
    }
    .surfaceCard()
  }

  private func color(_ v: String) -> Color {
    switch v {
    case "consistent": Theme.ok
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
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 14) {
        ScoreRing(p: score?.probability, pending: score == nil, size: 72)
        VStack(alignment: .leading, spacing: 4) {
          Label("Verification score", systemImage: "percent").font(.headline)
          if score == nil { Chip(text: pending ? "pending" : "Not scored", systemImage: pending ? "hourglass" : nil) }
        }
        Spacer(minLength: 0)
        InfoButton(title: "Verification score",
                   text: "Chance the claim is true given the evidence, assuming most submissions are cheating (prior 20%).")
      }
      ForEach(Array((score?.reasons ?? []).enumerated()), id: \.offset) { item in
        Label { Text(item.element) } icon: { Image(systemName: "circle.fill").font(.system(size: 5)) }
          .font(.subheadline)
      }
      if let model = score?.model, !model.isEmpty {
        HStack(spacing: 6) {
          HybridBadge(onDevice: false)
          Text(model).font(.caption2).foregroundStyle(.secondary)
        }
      }
    }
    .surfaceCard()
  }
}

/// The deterministic checks the Cloud Function runs (contract `Seal.checks`), one glyph row each.
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
          CheckPip(check: SealCheck(rawValue: row.key) ?? .ai, ok: card.checks[row.key], size: 24)
          Text(row.title).font(.subheadline)
          Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.title + ", " + (card.checks[row.key] == true ? "passed"
                                                : card.checks[row.key] == false ? "failed" : "pending"))
      }
      if showsChain {
        Divider()
        ChainRecheckLine(chainVerified: chainVerified, chunkCount: chunkCount)
      }
      if card.checks.isEmpty {
        Label(statusLine, systemImage: "hourglass").font(.footnote).foregroundStyle(.secondary)
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
    case .some(true): Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ok).accessibilityLabel("passed")
    case .some(false): Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.bad).accessibilityLabel("failed")
    case .none: Image(systemName: "circle.dotted").foregroundStyle(.secondary).accessibilityLabel("pending")
    }
  }
}

/// Under the proof-shot stage: the shot's time and link, and the live coach's verdict.
private struct FrameInfo: View {
  let frame: MomentDetailModel.Frame
  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 12) {
        StatChip(icon: Glyph.timing, value: "+\(formatDuration(ms: Int64(max(0, frame.offsetS) * 1000)))")
        StatChip(icon: Glyph.chain, value: Chain.docId(frame.seq))
      }
      if let c = frame.check {
        HStack(spacing: 8) {
          Label(c.ok ? "Keep going" : "Retake", systemImage: c.ok ? "checkmark.circle.fill" : "arrow.counterclockwise.circle.fill")
            .font(.subheadline.weight(.bold))
            .foregroundStyle(c.ok ? Theme.ok : Theme.warn)
          switch c.mode {
          case .onDevice: HybridBadge(onDevice: true)
          case .cloud: HybridBadge(onDevice: false)
          case .none: Chip(text: "offline heuristic", systemImage: "wifi.slash")
          }
        }
        Text(c.ok ? c.label : c.reason).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
          .lineLimit(3)
      }
    }
  }
}

/// The structured intention (v3.2): goal, numbers, place, conditions, what the AI assumed.
struct IntentionDetails: View {
  let intention: StructuredIntention

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        if !intention.activity.isEmpty {
          Text(intention.activity.capitalized).font(.caption.weight(.bold)).foregroundStyle(Theme.lake)
        }
        Spacer(minLength: 0)
        if intention.mode != "typed" {
          Label("\(intention.turns)", systemImage: "waveform")
            .font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            .accessibilityLabel("\(intention.turns)-answer voice interview, \(intention.mode.replacingOccurrences(of: "_", with: " "))")
        }
      }
      if !intention.goal.isEmpty { Text(intention.goal).font(.subheadline.weight(.semibold)) }
      if let place = intention.place?.label {
        Label(place, systemImage: Glyph.place).font(.footnote).foregroundStyle(.secondary)
      }
      if !intention.quantities.isEmpty || !intention.conditions.isEmpty {
        FlowChips {
          ForEach(intention.quantities) { q in Chip(text: "\(q.label) · \(q.measuredBy)", systemImage: "ruler", color: Theme.lake) }
          ForEach(intention.conditions, id: \.self) { Chip(text: $0, systemImage: "cloud.sun") }
        }
      }
      if !intention.assumptions.isEmpty {
        Label(intention.assumptions.joined(separator: " · "), systemImage: "lightbulb")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}

/// Bar (set by the Cloud Function from the intention) vs the verification score (baseline → after the ladder).
/// Numbers and the gauge up front; the bar model's rationale behind the info button.
struct BarScoreCard: View {
  let card: MomentCardData

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 18) {
        Image(systemName: Glyph.bar).foregroundStyle(Theme.warn).accessibilityHidden(true)
        if let s = card.displayScore {
          metric(String(format: "%.2f", s), "score", color: card.bar.map { s >= $0.value ? Theme.ok : Theme.bad } ?? .primary)
        }
        if let b = card.bar { metric(String(format: "%.2f", b.value), "bar", color: Theme.warn) }
        if let d = card.bar?.difficulty { metric(String(format: "%.2f", d), "difficulty", color: .secondary) }
        Spacer(minLength: 0)
        if let b = card.bar {
          InfoButton(title: "The bar", text: [b.rationale ?? "",
                                              b.source == "default" ? "Standard bar (the bar model was unavailable)."
                                              : "Set in the cloud from the intention: harder or more tempting claims need a higher score."]
            .filter { !$0.isEmpty }.joined(separator: "\n\n"))
        }
      }
      if let b = card.bar { BarGauge(score: card.displayScore, bar: b.value).frame(height: 10) }
      if let base = card.baselineScore, let fin = card.finalScore, !card.ladder.isEmpty, abs(base - fin) > 0.0005 {
        Label(String(format: "%.2f → %.2f", base, fin), systemImage: Glyph.ladder)
          .font(.footnote.weight(.semibold).monospacedDigit()).foregroundStyle(fin >= base ? Theme.ok : Theme.bad)
          .accessibilityLabel(String(format: "Baseline %.2f, %.2f after %d ladder modules", base, fin, card.ladder.count))
      }
      if let b = card.bar {
        if let v = card.verifiedByScore {
          Chip(text: v ? "reaches the bar" : "below the bar", systemImage: v ? "checkmark" : "arrow.down", color: v ? Theme.ok : Theme.bad)
        }
        if !b.factors.isEmpty {
          FlowChips { ForEach(b.factors, id: \.self) { Chip(text: $0, color: Theme.warn) } }
        }
      } else if card.local || card.status == "recording" || card.status == "submitted" {
        // Before the server sets the binding bar: the client's hybrid preview from the interview (v3.2 step 4).
        if let p = card.structured?.preview {
          HStack(spacing: 8) {
            Text(String(format: "≈ %.2f", p.bar)).font(.title3.bold().monospacedDigit()).foregroundStyle(Theme.warn)
            Text("preview").font(.caption).foregroundStyle(.secondary)
            HybridBadge(onDevice: p.mode == "on_device")
          }
        }
        Label(card.local ? "Binding bar set after upload" : "Binding bar set at submit", systemImage: Glyph.cloud)
          .font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private func metric(_ v: String, _ label: String, color: Color) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(v).font(.system(.title2, design: .rounded).weight(.bold).monospacedDigit()).foregroundStyle(color)
      Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }
}

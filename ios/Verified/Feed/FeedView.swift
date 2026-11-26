import AVFoundation
import FirebaseCore
import SwiftUI
import VerifiedCore

// Feed v5 (docs/superpowers/specs/2026-11-25-feed-intent-proof-result.md): one Moment a screen, swiped up like
// TikTok. Every slide is the same template, read top to bottom as a thread with three waypoints: what they said
// they would do (intent), what the phone captured (proof), and what the seal decided (result). Tapping a slide
// (or Evidence) opens the Moment's evidence room. Always dark: the proof photo is the page.

/// Feed tab: the pager, the status tabs over it, and the push into the evidence room.
struct FeedView: View {
  @Environment(AppModel.self) private var app
  @State private var filter = FeedFilter.all
  @State private var current: String? = FeedPage.intro
  @State private var opened: MomentCardData?
  @State private var showingRoom = false

  var body: some View {
    NavigationStack {
      // v4.12: the feed clip pauses while the evidence room or another tab is showing.
      FeedPager(filter: $filter, current: $current, paused: showingRoom || app.tab != .feed) { item in
        opened = item
        showingRoom = true
      }
      .environment(\.colorScheme, .dark)
      .preferredColorScheme(app.tab == .feed && !showingRoom ? .dark : nil)
      .toolbar(.hidden, for: .navigationBar)
      // Declared outside the forced-dark environment: the evidence room follows the app theme.
      .navigationDestination(isPresented: $showingRoom) {
        if let opened { MomentDetailView(initial: opened) }
      }
    }
  }
}

enum FeedFilter: String, CaseIterable, Identifiable {
  case all, sealed, rejected
  var id: String { rawValue }
  var title: String {
    switch self {
    case .all: "All"
    case .sealed: "Verified"
    case .rejected: "Not verified"
    }
  }
  func matches(_ m: MomentCardData) -> Bool { self == .all || m.status == rawValue }
}

enum FeedPage {
  static let intro = "feed.intro"
  static let end = "feed.end"
}

/// The feed palette (always dark): the shared tokens' dark values. GPS orange track, gold seal, lake ink.
enum FeedInk {
  static let ink = Color(hex: 0x071419)
  static let ink2 = Color(hex: 0x10242B)
  static let orange = Color(hex: 0xFF8A4C)
  static let gold = Theme.gold
  static let ok = Color(hex: 0x7FD19B)
  static let bad = Color(hex: 0xF08A78)
  static let muted = Color(hex: 0x8FA3A0)
  static let lake = LinearGradient(
    colors: [Color(hex: 0x123540), ink, Color(hex: 0x040D10)],
    startPoint: .top, endPoint: .bottom)
}

/// The five deterministic seal checks, in slide order.
let feedCheckOrder: [(key: String, name: String)] = [
  ("chain", "Chain"), ("timing", "Timing"), ("physics", "Physics"), ("frames", "Frames"), ("ai", "AI"),
]

/// `https://<project>.web.app/m/{id}`: the web evidence room, which anyone can open.
func momentShareURL(_ id: String) -> URL {
  let project = FirebaseApp.app()?.options.projectID ?? "verified-99e74"
  let safe = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
  return URL(string: "https://\(project).web.app/m/\(safe)") ?? URL(string: "https://\(project).web.app")!
}

func percent(_ p: Double?) -> Int? { p.map { Int(($0 * 100).rounded()) } }

// MARK: - Pager

private struct FeedPager: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Binding var filter: FeedFilter
  @Binding var current: String?
  let paused: Bool
  let open: (MomentCardData) -> Void

  var body: some View {
    let feed = app.feed
    let shown = feed.items.filter { filter.matches($0) }
    GeometryReader { geo in
      let insets = geo.safeAreaInsets
      ScrollView(.vertical) {
        LazyVStack(spacing: 0) {
          FeedIntroPage(insets: insets) { go(to: shown.first?.id ?? FeedPage.end) }
            .containerRelativeFrame([.horizontal, .vertical])
            .id(FeedPage.intro)
          ForEach(shown) { item in
            FeedSlide(item: item, active: current == item.id, playing: current == item.id && !paused,
                      insets: insets) { open(item) }
              .containerRelativeFrame([.horizontal, .vertical])
              .id(item.id)
          }
          if feed.loaded || feed.error != nil {
            FeedEndPage(empty: shown.isEmpty, insets: insets) { go(to: FeedPage.intro) }
              .containerRelativeFrame([.horizontal, .vertical])
              .id(FeedPage.end)
          }
        }
        .scrollTargetLayout()
      }
      .scrollIndicators(.hidden)
      .scrollTargetBehavior(.paging)
      .scrollPosition(id: $current)
      .ignoresSafeArea()
    }
    .background(FeedInk.ink)
    .overlay(alignment: .top) { topBar }
    .onChange(of: filter) {
      // A new filter starts at its first Moment (or the end card when it has none).
      current = feed.items.first(where: filter.matches)?.id ?? FeedPage.end
    }
  }

  private func go(to id: String) {
    if reduceMotion { current = id } else { withAnimation(.easeInOut(duration: 0.35)) { current = id } }
  }

  private var topBar: some View {
    HStack(spacing: 8) {
      HStack(spacing: 2) {
        ForEach(FeedFilter.allCases) { f in
          Button { filter = f } label: {
            Text(f.title)
              .font(.subheadline.weight(.semibold))
              .lineLimit(1)
              .padding(.horizontal, 12)
              .frame(minHeight: 36)
              .foregroundStyle(filter == f ? FeedInk.ink : .white)
              .background(filter == f ? Color.white : Color.clear, in: Capsule())
              .contentShape(Capsule())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(filter == f ? .isSelected : [])
        }
      }
      .padding(4)
      .background(.ultraThinMaterial, in: Capsule())
      .animation(.snappy, value: filter)
      Spacer(minLength: 4)
      if let user = app.auth.user {
        Button { app.tab = .me } label: {
          Avatar(url: user.photoURL, name: user.name, size: 36)
            .frame(width: 44, height: 44)
            .contentShape(Circle())
        }
        .accessibilityLabel("Me")
      } else {
        Button { app.signIn() } label: {
          Image(systemName: "person.crop.circle")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sign in")
      }
    }
    .padding(.horizontal, 12).padding(.top, 2)
  }
}

// MARK: - Waypoints (shared with the evidence room)

enum Waypoint: String, CaseIterable, Identifiable, Hashable {
  case intent, proof, result
  var id: String { rawValue }
  var title: String { rawValue.capitalized }
}

/// The three dot styles: intent a hollow ring, proof filled orange, result filled gold with a halo.
/// `muted` = not verified (grey track, red result).
struct WaypointDot: View {
  let kind: Waypoint
  var muted = false
  var pending = false
  /// What shows through the hollow intent ring (the page behind it).
  var fill: Color = FeedInk.ink

  var body: some View {
    let line = muted ? FeedInk.muted : FeedInk.orange
    let c = pending ? FeedInk.muted : muted ? FeedInk.bad : FeedInk.gold
    ZStack {
      switch kind {
      case .intent:
        Circle().fill(fill).frame(width: 14, height: 14)
        Circle().strokeBorder(line, lineWidth: 2.5).frame(width: 14, height: 14)
      case .proof:
        Circle().fill(line).frame(width: 14, height: 14)
      case .result:
        Circle().fill(c.opacity(0.28)).frame(width: 28, height: 28)
        Circle().fill(c).frame(width: 16, height: 16)
      }
    }
    .frame(width: 18, height: 18)
    .anchorPreference(key: WaypointAnchorKey.self, value: .center) { [$0] }
    .accessibilityHidden(true)
  }
}

nonisolated struct WaypointAnchorKey: PreferenceKey {
  static var defaultValue: [Anchor<CGPoint>] { [] }
  static func reduce(value: inout [Anchor<CGPoint>], nextValue: () -> [Anchor<CGPoint>]) {
    value.append(contentsOf: nextValue())
  }
}

extension View {
  /// Draws the dashed track from the first `WaypointDot` inside this view down to the last one, behind them.
  func waypointTrack(_ color: Color, progress: CGFloat = 1, animation: Animation? = nil) -> some View {
    backgroundPreferenceValue(WaypointAnchorKey.self) { anchors in
      GeometryReader { g in
        let pts = anchors.map { g[$0] }
        if let a = pts.first, let b = pts.last, pts.count > 1 {
          Path { p in
            p.move(to: a)
            p.addLine(to: CGPoint(x: a.x, y: b.y))
          }
          .trim(from: 0, to: progress)
          .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [5, 6]))
          .animation(animation, value: progress)
        }
      }
    }
  }
}

/// "Intent  Matt set out to"
struct WaypointLabel: View {
  let title: String
  var detail: String? = nil
  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text(title.uppercased()).font(.caption.weight(.heavy)).kerning(1.2)
      if let detail { Text(detail).font(.caption).opacity(0.75) }
    }
  }
}

/// The seal stamp: the one loud element. Gold block with dark ink and an inset ring, rotated −4°; or a dashed red
/// outline "Not verified"; or a grey "Not sealed yet" before the seal has run.
struct SealStamp: View {
  let verified: Bool
  var pending = false
  var fontSize: CGFloat = 22

  var body: some View {
    let text = verified ? "Verified ✓" : pending ? "Not sealed yet" : "Not verified"
    Text(text)
      .font(.system(size: fontSize, weight: .heavy))
      .lineLimit(1).fixedSize()
      .padding(.horizontal, fontSize * 0.7).padding(.vertical, fontSize * 0.45)
      .foregroundStyle(verified ? FeedInk.ink2 : pending ? FeedInk.muted : FeedInk.bad)
      .background {
        if verified {
          RoundedRectangle(cornerRadius: 7).fill(FeedInk.gold)
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(FeedInk.ink2, lineWidth: 1.5).padding(3))
            .shadow(color: .black.opacity(0.45), radius: 12, y: 8)
        } else {
          RoundedRectangle(cornerRadius: 7).fill(FeedInk.ink.opacity(0.8))
            .overlay(RoundedRectangle(cornerRadius: 7)
              .strokeBorder(pending ? FeedInk.muted : FeedInk.bad, style: StrokeStyle(lineWidth: 2.5, dash: [6, 4])))
        }
      }
      .rotationEffect(.degrees(-4))
      .accessibilityLabel(text)
  }
}

/// A small sketch of the GPS track: dark box, orange line, gold end dot.
struct TrackSketch: View {
  let track: [LatLng]
  var width: CGFloat = 64
  var height: CGFloat = 48

  var body: some View {
    Canvas { ctx, size in
      let pts = Self.project(track, in: size.insetBy(5))
      guard pts.count > 1 else { return }
      var path = Path()
      path.addLines(pts)
      ctx.stroke(path, with: .color(FeedInk.orange), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
      if let first = pts.first {
        ctx.fill(Path(ellipseIn: CGRect(x: first.x - 2.5, y: first.y - 2.5, width: 5, height: 5)), with: .color(.white.opacity(0.8)))
      }
      if let end = pts.last {
        ctx.fill(Path(ellipseIn: CGRect(x: end.x - 4, y: end.y - 4, width: 8, height: 8)), with: .color(FeedInk.gold))
      }
    }
    .frame(width: width, height: height)
    .background(FeedInk.ink.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.white.opacity(0.15), lineWidth: 1))
    .accessibilityHidden(true)
  }

  /// Equirectangular projection into `size`, aspect kept, centred, 5 pt inset.
  nonisolated static func project(_ track: [LatLng], in size: CGSize) -> [CGPoint] {
    guard track.count > 1 else { return [] }
    let midLat = (track.map(\.lat).min()! + track.map(\.lat).max()!) / 2
    let k = cos(midLat * .pi / 180)
    let xs = track.map { $0.lng * k }, ys = track.map { $0.lat }
    let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
    let spanX = max(maxX - minX, 1e-9), spanY = max(maxY - minY, 1e-9)
    let scale = min(size.width / spanX, size.height / spanY)
    let offX = 5 + (size.width - spanX * scale) / 2, offY = 5 + (size.height - spanY * scale) / 2
    return zip(xs, ys).map { x, y in CGPoint(x: offX + (x - minX) * scale, y: offY + (maxY - y) * scale) }
  }
}

private extension CGSize {
  func insetBy(_ d: CGFloat) -> CGSize { CGSize(width: max(0, width - 2 * d), height: max(0, height - 2 * d)) }
}

// MARK: - Slide

private struct FeedSlide: View {
  let item: MomentCardData
  let active: Bool
  /// v4.12: current, and the feed is on screen: the feed clip may play.
  let playing: Bool
  let insets: EdgeInsets
  let open: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var revealed = false
  /// Made the first time this slide plays its feed clip (nil when it has none).
  @State private var clip: FeedClipPlayer?

  var body: some View {
    let ok = item.isVerified
    let shown = revealed || reduceMotion
    ZStack(alignment: .bottomTrailing) {
      SlideBackdrop(b64: item.heroJpegB64, desaturate: !ok, clip: clip)
      VStack(alignment: .leading, spacing: 0) {
        intent.arrive(shown, delay: 0.1, reduceMotion)
        Spacer(minLength: 18)
        proof.arrive(shown, delay: 0.35, reduceMotion).padding(.bottom, 20)
        result(shown)
      }
      .waypointTrack(ok ? FeedInk.orange : FeedInk.muted, progress: shown ? 1 : 0,
                     animation: reduceMotion ? nil : .easeOut(duration: 0.9).delay(0.05))
      .padding(.leading, 18).padding(.trailing, 86)
      .padding(.top, insets.top + 58).padding(.bottom, insets.bottom + 18)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      rail
        .padding(.trailing, 12)
        .padding(.bottom, insets.bottom + 150)
    }
    .foregroundStyle(.white)
    .clipped()
    .contentShape(Rectangle())
    .onTapGesture(perform: open)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(item.intention), \(ok ? "verified" : "not verified")")
    .accessibilityAction(named: "Inspect the evidence", open)
    .onChange(of: active, initial: true) { _, now in
      if now && !revealed { revealed = true }
    }
    // v4.12: muted, looping, on the current slide only; pauses off screen and in the background.
    .onChange(of: playing && scenePhase == .active, initial: true) { _, run in
      guard let feedClip = item.feedClip else { return }
      if run {
        let player = clip ?? FeedClipPlayer()
        clip = player
        player.play(path: feedClip.path)
      } else {
        clip?.pause()
      }
    }
    .onDisappear { clip?.pause() }
  }

  // 1. Intent
  private var intent: some View {
    HStack(alignment: .top, spacing: 12) {
      WaypointDot(kind: .intent, muted: !item.isVerified)
      VStack(alignment: .leading, spacing: 6) {
        WaypointLabel(title: "Intent", detail: "\(item.ownerName) set out to")
        Text("\(Text("“").foregroundStyle(FeedInk.orange))\(item.intention)\(Text("”").foregroundStyle(FeedInk.orange))")
          .font(.title.weight(.heavy))
          .lineLimit(5)
          .minimumScaleFactor(0.6)
          .frame(maxWidth: 290, alignment: .leading)
          .shadow(color: .black.opacity(0.5), radius: 6, y: 2)
      }
    }
  }

  // 2. Proof: track sketch + glyph stats, check pips, extras as glyph chips.
  private var proof: some View {
    HStack(alignment: .top, spacing: 12) {
      WaypointDot(kind: .proof, muted: !item.isVerified)
      VStack(alignment: .leading, spacing: 10) {
        WaypointLabel(title: "Proof", detail: agoText)
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .center, spacing: 14) {
            if item.track.count > 1 { TrackSketch(track: item.track) }
            stats
          }
          stats
          VStack(alignment: .leading, spacing: 6) { statViews }
        }
        CheckPips(checks: item.checks, size: 26)
        extrasRow
      }
    }
  }

  private var stats: some View {
    HStack(spacing: 14) { statViews }
  }

  @ViewBuilder private var statViews: some View {
    stat(Glyph.timing, item.summary.map { formatDuration(ms: $0.durationMs) } ?? "–", "time")
    stat(Glyph.gps, item.summary.map { formatDistance($0.distanceM) } ?? "–", "moved")
    stat(Glyph.shots, item.summary.map { "\($0.frameCount)" } ?? "–", "shots")
  }

  // 3. Result: the stamp and the score ring (bar tick on the ring), one line of why.
  private func result(_ shown: Bool) -> some View {
    let ok = item.isVerified
    return HStack(alignment: .top, spacing: 12) {
      WaypointDot(kind: .result, muted: !ok)
      VStack(alignment: .leading, spacing: 10) {
        WaypointLabel(title: "Result")
        HStack(alignment: .center, spacing: 18) {
          SealStamp(verified: ok)
            .scaleEffect(shown ? 1 : 1.9)
            .rotationEffect(.degrees(shown ? 0 : -8))
            .opacity(shown ? 1 : 0)
            .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.55).delay(0.8), value: shown)
          if item.displayScore != nil || item.bar != nil {
            ScoreRing(p: item.displayScore, bar: item.bar?.value, size: 62)
          }
        }
        if let reason, !reason.isEmpty {
          Text(reason).font(.footnote).lineLimit(2).opacity(0.85)
            .frame(maxWidth: 300, alignment: .leading)
        }
      }
      .arrive(shown, delay: 0.6, reduceMotion)
    }
  }

  private var rail: some View {
    VStack(spacing: 18) {
      Button(action: open) { RailLabel(title: "Evidence", systemImage: "magnifyingglass", primary: true) }
        .accessibilityLabel("Inspect the evidence")
      ShareLink(item: momentShareURL(item.id), subject: Text("Verified"), message: Text(item.intention)) {
        RailLabel(title: "Share", systemImage: "square.and.arrow.up", primary: false)
      }
      .accessibilityLabel("Share this Moment")
      if let clip, clip.ready {
        // v4.12: sound for this slide's clip (default muted).
        Button { clip.toggleMute() } label: {
          Image(systemName: clip.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(.ultraThinMaterial, in: Circle())
            .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
        }
        .accessibilityLabel(clip.muted ? "Turn sound on" : "Turn sound off")
      }
    }
    .buttonStyle(.plain)
  }

  private func stat(_ icon: String, _ value: String, _ label: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: icon).font(.caption.weight(.bold)).foregroundStyle(FeedInk.orange)
      Text(value).font(.headline.monospacedDigit()).lineLimit(1).fixedSize()
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(value) \(label)")
  }

  private var agoText: String? {
    let date = item.sealedAt ?? (item.startedAt > 0 ? Date(timeIntervalSince1970: Double(item.startedAt) / 1000) : nil)
    return date?.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
  }

  /// v4 extras as glyph chips: claims backed, ladder checks, witness answers, where the live coach ran.
  @ViewBuilder private var extrasRow: some View {
    let hasClaims = item.claimsTotal > 0 && item.claimsBacked != nil
    let coach = item.onDeviceMode == "on_device" || item.onDeviceMode == "cloud"
    if hasClaims || !item.ladder.isEmpty || item.witnessAsked > 0 || coach {
      HStack(spacing: 6) {
        if hasClaims, let backed = item.claimsBacked {
          extra(Glyph.claims, "\(backed)/\(item.claimsTotal)", "\(backed) of \(item.claimsTotal) claims backed",
                tint: backed >= item.claimsTotal ? FeedInk.ok : FeedInk.gold)
        }
        if !item.ladder.isEmpty {
          extra(Glyph.ladder, "+\(item.ladder.count)", "\(item.ladder.count) extra ladder checks")
        }
        if item.witnessAsked > 0 {
          extra(Glyph.witness, "\(item.witnessAnswered)/\(item.witnessAsked)",
                "\(item.witnessAnswered) of \(item.witnessAsked) witness requests answered")
        }
        if coach {
          let onDevice = item.onDeviceMode == "on_device"
          extra(onDevice ? Glyph.onDevice : Glyph.cloud, onDevice ? "on device" : "cloud",
                onDevice ? "Live coach ran on device" : "Live coach ran in the cloud")
        }
      }
    }
  }

  private func extra(_ icon: String, _ text: String, _ a11y: String, tint: Color = .white) -> some View {
    HStack(spacing: 4) {
      Image(systemName: icon).font(.caption2.weight(.bold)).foregroundStyle(tint)
      Text(text).font(.caption.weight(.bold).monospacedDigit())
    }
    .padding(.horizontal, 8).padding(.vertical, 4)
    .background(Color.black.opacity(0.35), in: Capsule())
    .overlay(Capsule().strokeBorder(.white.opacity(0.16), lineWidth: 1))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(a11y)
  }

  /// One reason: cheating → the first signal; sealed → the scorer's (or judge's) first reason; else the seal reason.
  private var reason: String? {
    if item.cheating, let s = item.cheatingSignals.first { return s }
    if item.isVerified { return item.score?.reasons.first ?? item.judgeReasons.first ?? item.sealReason }
    return item.sealReason
  }
}

private extension View {
  /// Waypoints arrive in order: fade up, once, when the slide becomes current.
  func arrive(_ shown: Bool, delay: Double, _ reduceMotion: Bool) -> some View {
    opacity(shown ? 1 : 0)
      .offset(y: shown ? 0 : 14)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.45).delay(delay), value: shown)
  }
}

private struct RailLabel: View {
  let title: String
  let systemImage: String
  let primary: Bool

  var body: some View {
    VStack(spacing: 5) {
      Image(systemName: systemImage)
        .font(.system(size: 20, weight: .bold))
        .foregroundStyle(primary ? FeedInk.ink : .white)
        .frame(width: 52, height: 52)
        .background(primary ? AnyShapeStyle(Color.white.opacity(0.94)) : AnyShapeStyle(.ultraThinMaterial), in: Circle())
        .shadow(color: .black.opacity(0.35), radius: 8, y: 3)
      Text(title).font(.caption.weight(.bold)).foregroundStyle(.white)
        .shadow(color: .black.opacity(0.6), radius: 3)
    }
    .contentShape(Rectangle())
  }
}

/// The proof photo, full-bleed, under a top and bottom ink scrim. Rejected Moments desaturate; no photo is a lake.
private struct SlideBackdrop: View {
  let b64: String?
  let desaturate: Bool
  /// v4.12: the feed clip plays over the photo, which stays as the poster until a frame can show.
  var clip: FeedClipPlayer? = nil

  var body: some View {
    ZStack {
      FeedInk.lake
      if let b64, let cg = ProofFrame.cgImage(fromBase64: b64) {
        Color.clear.overlay {
          Image(decorative: cg, scale: 1).resizable().scaledToFill()
            .saturation(desaturate ? 0.15 : 1)
        }
        .clipped()
      }
      if let clip {
        PlayerLayerView(player: clip.player) { clip.markReady() }
          .opacity(clip.ready ? 1 : 0)
          .animation(.easeIn(duration: 0.25), value: clip.ready)
      }
      VStack(spacing: 0) {
        LinearGradient(colors: [FeedInk.ink.opacity(0.9), FeedInk.ink.opacity(0)], startPoint: .top, endPoint: .bottom)
          .frame(height: 320)
        Spacer(minLength: 0)
        LinearGradient(colors: [FeedInk.ink.opacity(0), FeedInk.ink.opacity(0.75), FeedInk.ink.opacity(0.95)],
                       startPoint: .top, endPoint: .bottom)
          .frame(height: 460)
      }
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}

// MARK: - Intro and end pages

private struct FeedIntroPage: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dynamicTypeSize) private var typeSize
  let insets: EdgeInsets
  let next: () -> Void

  var body: some View {
    let feed = app.feed
    let sealed = feed.items.filter(\.isVerified).count
    ZStack {
      FeedInk.lake.ignoresSafeArea()
      VStack(alignment: .leading, spacing: 20) {
        Spacer(minLength: 0)
        Text("Proof it happened.")
          .font(.largeTitle.weight(.heavy))
          .minimumScaleFactor(0.7)
        Text("Recorded live. Argued by AI. Sealed by code.")
          .font(.headline).opacity(0.8)
        let tiles = typeSize.isAccessibilitySize
          ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
          : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
        tiles {
          tile(.intent, "Said first", badge: nil)
          tile(.proof, "Captured live", badge: true)
          tile(.result, "Sealed", badge: false)
        }
        .fixedSize(horizontal: false, vertical: true)
        Group {
          if let error = feed.error {
            Label("Feed unavailable: \(error)", systemImage: "wifi.exclamationmark").foregroundStyle(FeedInk.bad)
              .lineLimit(2)
          } else if !feed.loaded {
            HStack(spacing: 8) { ProgressView().tint(.white); Text("Connecting…") }
          } else {
            HStack(spacing: 14) {
              Label("\(sealed)", systemImage: "checkmark.seal.fill").foregroundStyle(FeedInk.gold)
                .accessibilityLabel("\(sealed) verified")
              Label("\(feed.items.count - sealed)", systemImage: "xmark.seal").foregroundStyle(FeedInk.bad)
                .accessibilityLabel("\(feed.items.count - sealed) not verified")
            }
          }
        }
        .font(.headline.monospacedDigit())
        HStack(spacing: 14) {
          RecordButton()
          Button(action: next) {
            Label("Swipe up", systemImage: "chevron.up").font(.subheadline.weight(.semibold))
              .symbolEffect(.bounce.up, options: .repeating.speed(0.4))
              .frame(minHeight: 44)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain).opacity(0.85)
        }
        if app.isGuest {
          Label("No account needed", systemImage: "person.crop.circle.badge.questionmark")
            .font(.footnote.weight(.semibold)).opacity(0.7)
        }
        Spacer(minLength: 0)
      }
      .foregroundStyle(.white)
      .padding(.horizontal, 20)
      .padding(.top, insets.top + 56).padding(.bottom, insets.bottom + 16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }

  /// One waypoint as a big tile: its dot, its word, and where the AI runs (true = on device, false = cloud).
  private func tile(_ w: Waypoint, _ text: String, badge onDevice: Bool?) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      WaypointDot(kind: w, fill: Color(hex: 0x10242B))
      VStack(alignment: .leading, spacing: 2) {
        Text(w.title).font(.headline)
        Text(text).font(.caption).opacity(0.75)
      }
      if let onDevice {
        Label(onDevice ? "on device" : "cloud", systemImage: onDevice ? Glyph.onDevice : Glyph.cloud)
          .font(.caption2.weight(.bold))
          .foregroundStyle(onDevice ? FeedInk.ok : Color(hex: 0x6CC3C6))
      }
    }
    .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
    .padding(12)
    .background(Color(hex: 0x10242B).opacity(0.85), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.1)))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(w.title): \(text)" + (onDevice.map { $0 ? ", AI on device" : ", AI in the cloud" } ?? ""))
  }
}

private struct FeedEndPage: View {
  let empty: Bool
  let insets: EdgeInsets
  let top: () -> Void

  var body: some View {
    ZStack {
      FeedInk.lake.ignoresSafeArea()
      VStack(alignment: .leading, spacing: 14) {
        Text(empty ? "Nothing here yet." : "That's every Moment.").font(.system(size: 30, weight: .heavy))
        Label(empty ? "Record the first one" : "Yours lands here once sealed", systemImage: "checkmark.seal")
          .font(.headline).opacity(0.85)
        HStack(spacing: 12) {
          RecordButton()
          if !empty {
            Button(action: top) {
              Label("Back to the top", systemImage: "arrow.up.to.line").font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(.ultraThinMaterial, in: Capsule())
            }
            .buttonStyle(.plain)
          }
        }
      }
      .foregroundStyle(.white)
      .padding(.horizontal, 22)
      .padding(.top, insets.top + 56).padding(.bottom, insets.bottom + 16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }
}

private struct RecordButton: View {
  @Environment(AppModel.self) private var app
  var body: some View {
    Button { app.tab = .record } label: {
      Label("Record a Moment", systemImage: "record.circle.fill")
        .font(.headline)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .foregroundStyle(FeedInk.ink)
        .background(FeedInk.gold, in: Capsule())
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Shared small views (also used by Me and the evidence room)

struct HeroImage: View {
  let b64: String?
  let category: String

  var body: some View {
    if let b64, let cg = ProofFrame.cgImage(fromBase64: b64) {
      Image(decorative: cg, scale: 1).resizable().scaledToFill()
    } else {
      ZStack {
        LinearGradient(colors: [Color(hex: 0x123540), Theme.media], startPoint: .top, endPoint: .bottom)
        Image(systemName: (Category(rawValue: category) ?? .other).icon)
          .font(.system(size: 44, weight: .semibold)).foregroundStyle(Color(hex: 0x6CC3C6).opacity(0.75))
      }
    }
  }
}

/// The Moment's status (kept name; draws the shared `StatusBadge`).
struct VerdictBadge: View {
  let status: String
  var compact = false
  var body: some View { StatusBadge(status: status, compact: compact) }
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
        Circle().fill(Theme.lake.opacity(0.25))
        Text(String(name.prefix(1))).font(.system(size: size * 0.5, weight: .bold)).foregroundStyle(Theme.lake)
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .accessibilityHidden(true)
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

import SwiftUI

// The shared visual vocabulary (spec 2026-11-25 "UI overhaul, visual first"): one glyph = one meaning on every
// platform. Score ring, check pips, stat chips, status badges, hybrid badges, info popovers, glyph tiles.

// MARK: - Glyphs

/// SF Symbols for the shared concepts (same meaning as the Material / SVG glyphs on Android and web).
nonisolated enum Glyph {
  static let intent = "quote.opening"
  static let proof = "record.circle"
  static let result = "checkmark.seal.fill"
  static let chain = "link"
  static let timing = "clock"
  static let physics = "gauge.with.dots.needle.67percent"
  static let frames = "photo"
  static let ai = "sparkles"
  static let witness = "eye"
  static let place = "mappin.and.ellipse"
  static let gps = "location.fill"
  static let motion = "waveform"
  static let ladder = "stairs"
  static let credits = "bolt.circle.fill"
  static let onDevice = "iphone"
  static let cloud = "cloud"
  static let claims = "checklist"
  static let video = "video.fill"
  static let shots = "camera.fill"
  static let distance = "point.topleft.down.to.point.bottomright.curvepath"
  static let bar = "flag.checkered"
}

// MARK: - Seal checks (pips)

/// The seal's deterministic checks, with their glyph, a ≤ 2-word name and the sentence behind a tap.
nonisolated enum SealCheck: String, CaseIterable, Identifiable {
  case chain, timing, physics, frames, ai, cheating, bar
  var id: String { rawValue }

  /// The five shown as pips everywhere.
  static let core: [SealCheck] = [.chain, .timing, .physics, .frames, .ai]

  var glyph: String {
    switch self {
    case .chain: Glyph.chain
    case .timing: Glyph.timing
    case .physics: Glyph.physics
    case .frames: Glyph.frames
    case .ai: Glyph.ai
    case .cheating: "hand.raised.slash"
    case .bar: Glyph.bar
    }
  }

  var name: String {
    switch self {
    case .chain: "Chain"
    case .timing: "Timing"
    case .physics: "Physics"
    case .frames: "Frames"
    case .ai: "AI"
    case .cheating: "No cheating"
    case .bar: "Bar"
    }
  }
}

/// Check pips: a row of small circles, each with its glyph. Filled green = passed, red ring = failed, grey = pending.
struct CheckPips: View {
  let checks: [String: Bool]
  var keys: [SealCheck] = SealCheck.core
  var size: CGFloat = 24
  /// Names under the pips (evidence room); the feed shows glyphs only.
  var labeled = false

  var body: some View {
    HStack(spacing: labeled ? 10 : 6) {
      ForEach(keys) { k in
        VStack(spacing: 4) {
          CheckPip(check: k, ok: checks[k.rawValue], size: size)
          if labeled {
            Text(k.name).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
              .lineLimit(1).minimumScaleFactor(0.7)
          }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.label(k, checks[k.rawValue]))
      }
    }
    .accessibilityElement(children: .contain)
  }

  static func label(_ k: SealCheck, _ ok: Bool?) -> String {
    "\(k.name) check " + (ok == true ? "passed" : ok == false ? "failed" : "pending")
  }

  static func passed(_ checks: [String: Bool]) -> Int { SealCheck.core.filter { checks[$0.rawValue] == true }.count }
}

struct CheckPip: View {
  let check: SealCheck
  let ok: Bool?
  var size: CGFloat = 24

  var body: some View {
    ZStack {
      switch ok {
      case .some(true): Circle().fill(Theme.ok)
      case .some(false): Circle().fill(Theme.bad.opacity(0.12)).overlay(Circle().strokeBorder(Theme.bad, lineWidth: 1.5))
      case .none: Circle().fill(Color.secondary.opacity(0.18))
      }
      Image(systemName: check.glyph)
        .font(.system(size: size * 0.46, weight: .bold))
        .foregroundStyle(ok == true ? Theme.onFill : ok == false ? Theme.bad : .secondary)
    }
    .frame(width: size, height: size)
  }
}

// MARK: - Score ring

/// P(true) as an arc, the big % in the middle, and a tick on the ring at the bar. Gold at or over the bar, red
/// below it, grey while pending. With no score but a bar (interview preview) it shows "≈ bar" instead.
struct ScoreRing: View {
  let p: Double?
  var bar: Double? = nil
  var pending = false
  var size: CGFloat = 64
  /// Small word under the number ("true", "bar"); nil hides it.
  var caption: String? = "true"
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shown = false

  private var color: Color {
    guard let p, !pending else { return Theme.ink2 }
    guard let bar else { return Theme.lake }
    return p >= bar ? Theme.gold : Theme.bad
  }

  var body: some View {
    let lw = max(4, size * 0.1)
    let r = size / 2 - lw / 2
    ZStack {
      Circle().inset(by: lw / 2).stroke(Color.primary.opacity(0.14), lineWidth: lw)
      if let p {
        Circle().inset(by: lw / 2)
          .trim(from: 0, to: shown ? clamp(p) : 0)
          .stroke(color, style: StrokeStyle(lineWidth: lw, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
      if let bar {
        Capsule()
          .fill(Color.primary)
          .frame(width: max(2.5, lw * 0.36), height: lw + 6)
          .offset(y: -r)
          .rotationEffect(.degrees(360 * clamp(bar)))
      }
      VStack(spacing: -size * 0.02) {
        number
        if let word = (p == nil && bar != nil) ? "bar" : caption {
          Text(word)
            .font(.system(size: max(9, size * 0.14), weight: .semibold))
            .foregroundStyle(.secondary)
        }
      }
      .lineLimit(1)
      .minimumScaleFactor(0.6)
      .padding(lw)
    }
    .frame(width: size, height: size)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.4), value: shown)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.4), value: p)
    .onAppear { shown = true }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(accessibilityText)
  }

  @ViewBuilder private var number: some View {
    let big = Font.system(size: size * 0.3, weight: .heavy, design: .rounded).monospacedDigit()
    let small = Font.system(size: size * 0.15, weight: .bold, design: .rounded)
    if let p {
      Text("\(Text("\(Int((p * 100).rounded()))").font(big))\(Text("%").font(small))")
    } else if let bar {
      Text("\(Text("≈").font(small))\(Text("\(Int((bar * 100).rounded()))").font(big))")
    } else {
      Text("–").font(big).foregroundStyle(.secondary)
    }
  }

  private var accessibilityText: String {
    var parts: [String] = []
    if let p { parts.append("\(Int((p * 100).rounded())) percent likely true") }
    else if pending { parts.append("Score pending") }
    if let bar { parts.append("bar \(Int((bar * 100).rounded())) percent") }
    if let p, let bar { parts.append(p >= bar ? "reaches the bar" : "below the bar") }
    return parts.isEmpty ? "No score" : parts.joined(separator: ", ")
  }

  private func clamp(_ v: Double) -> CGFloat { CGFloat(min(1, max(0, v))) }
}

// MARK: - Stats and badges

/// A glyph + number (+ optional short word). On media it sits on a material scrim.
struct StatChip: View {
  let icon: String
  let value: String
  var label: String? = nil
  var tint: Color? = nil
  /// Material capsule behind it (for stats overlaid on a photo, map or camera).
  var onMedia = false

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: icon).font(.caption.weight(.bold)).foregroundStyle(tint ?? .secondary)
      Text(value).font(.subheadline.weight(.bold).monospacedDigit()).lineLimit(1)
      if let label { Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
    }
    .padding(.horizontal, onMedia ? 10 : 0).padding(.vertical, onMedia ? 6 : 0)
    .background { if onMedia { Capsule().fill(.ultraThinMaterial) } }
    .accessibilityElement(children: .combine)
  }
}

/// A stat tile: big number over a glyph + word (Me header, evidence-room tiles).
struct StatTile: View {
  let icon: String
  let value: String
  let label: String
  var tint: Color = Theme.lake

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(value).font(.title2.weight(.heavy).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.6)
      Label(label, systemImage: icon).font(.caption.weight(.semibold)).foregroundStyle(tint).lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .accessibilityElement(children: .combine)
  }
}

/// Moment status as a compact badge: glyph + ≤ 2 words. `compact` drops the words (grid corners).
struct StatusBadge: View {
  let status: String
  var compact = false

  var body: some View {
    let s = Self.style(status)
    HStack(spacing: 4) {
      Image(systemName: s.icon).font(.caption.weight(.bold))
      if !compact { Text(s.text).font(.caption.weight(.bold)) }
    }
    .padding(.horizontal, compact ? 6 : 9).padding(.vertical, 5)
    .frame(minWidth: compact ? 26 : nil, minHeight: 26)
    .foregroundStyle(s.fg)
    .background(s.bg, in: Capsule())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(s.text)
  }

  static func style(_ status: String) -> (text: String, icon: String, fg: Color, bg: Color) {
    switch status {
    case "sealed": ("Verified", "checkmark.seal.fill", Color(hex: 0x10242B), Theme.gold)
    case "rejected": ("Not verified", "xmark.seal.fill", .white, Color(hex: 0xB8322A))
    case "local": ("On device", Glyph.onDevice, .white, Color(hex: 0x1F6F78))
    case "submitted": ("Judging", "hourglass", .white, Color(hex: 0x3F5459))
    default: ("Recording", "record.circle", .white, Color(hex: 0xD9480F))
    }
  }
}

/// "on device" / "cloud": makes the hybrid AI visible at a glance.
struct HybridBadge: View {
  let onDevice: Bool
  var text: String? = nil

  var body: some View {
    Label(text ?? (onDevice ? "on device" : "cloud"), systemImage: onDevice ? Glyph.onDevice : Glyph.cloud)
      .font(.caption2.weight(.bold))
      .padding(.horizontal, 7).padding(.vertical, 3)
      .foregroundStyle(onDevice ? Theme.ok : Theme.lake)
      .background((onDevice ? Theme.ok : Theme.lake).opacity(0.14), in: Capsule())
      .accessibilityLabel(text ?? (onDevice ? "Runs on device" : "Runs in the cloud"))
  }
}

/// An "i" button whose prose lives in a popover (the copy diet: sentences behind a tap).
struct InfoButton: View {
  let title: String
  let text: String
  @State private var showing = false

  var body: some View {
    Button { showing = true } label: {
      Image(systemName: "info.circle")
        .font(.body)
        .foregroundStyle(.secondary)
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("About \(title)")
    .popover(isPresented: $showing) {
      VStack(alignment: .leading, spacing: 8) {
        Text(title).font(.headline)
        Text(text).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
      .padding(16)
      .frame(idealWidth: 300, maxWidth: 340)
      .presentationCompactAdaptation(.popover)
    }
  }
}

/// A glyph tile: big glyph, ≤ 2-word title, optional one-liner (intro, sign-in, how it works).
struct GlyphTile: View {
  let icon: String
  let title: String
  var detail: String? = nil
  var tint: Color = Theme.lake

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Image(systemName: icon)
        .font(.title2.weight(.semibold))
        .foregroundStyle(tint)
        .frame(height: 30)
      Text(title).font(.subheadline.weight(.bold)).lineLimit(2).minimumScaleFactor(0.8)
      if let detail {
        Text(detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(12)
    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .accessibilityElement(children: .combine)
  }
}

/// Lays children out in a row, or a column at accessibility text sizes.
struct AdaptiveStack<Content: View>: View {
  var spacing: CGFloat = 10
  @ViewBuilder let content: Content
  @Environment(\.dynamicTypeSize) private var type

  var body: some View {
    let layout = type.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
      : AnyLayout(HStackLayout(alignment: .top, spacing: spacing))
    layout { content }
  }
}

extension View {
  /// The standard card: surface fill, continuous corners, full width.
  func surfaceCard(padding: CGFloat = 14, radius: CGFloat = 18) -> some View {
    self.padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
  }
}

/// Section header inside the evidence room / sheets: glyph + title, optional trailing accessory.
struct GlyphHeader<Trailing: View>: View {
  let icon: String
  let title: String
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: icon).font(.subheadline.weight(.bold)).foregroundStyle(Theme.lake)
      Text(title).font(.headline)
      Spacer(minLength: 4)
      trailing
    }
    .accessibilityElement(children: .contain)
  }
}

extension GlyphHeader where Trailing == EmptyView {
  init(icon: String, title: String) {
    self.init(icon: icon, title: title) { EmptyView() }
  }
}

// MARK: - Layout helpers

extension View {
  /// Keeps `visible` in step with the software keyboard, so a screen can drop chrome (the Start button, the shutter
  /// row) that would otherwise ride up on top of the keyboard and squeeze the field being typed into.
  func trackKeyboard(_ visible: Binding<Bool>) -> some View {
    onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
      visible.wrappedValue = true
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
      visible.wrappedValue = false
    }
  }
}

import SwiftUI
import UIKit

/// The shared design tokens (docs/superpowers/specs/2026-11-25-ui-overhaul-visual-first.md): deep-lake ink, lichen
/// paper, seal gold as the one loud element, GPS orange for tracks. Same hex values as web and Android, light + dark,
/// built as dynamic colours (no asset catalog entries needed).
nonisolated enum Theme {
  /// Page background ("paper").
  static let paper = Color(light: 0xE8ECE4, dark: 0x0F2127)
  /// Cards and sheets.
  static let surface = Color(light: 0xF5F7F2, dark: 0x17303A)
  /// A step above `surface` (rows inside cards, input fields).
  static let raised = Color(light: 0xE3E9E1, dark: 0x1F3D48)
  static let ink = Color(light: 0x10242B, dark: 0xE4EBE3)
  static let ink2 = Color(light: 0x3F5459, dark: 0xB4C4C0)
  /// Primary / interactive.
  static let lake = Color(light: 0x1F6F78, dark: 0x6CC3C6)
  static let ok = Color(light: 0x2F7A4B, dark: 0x7FD19B)
  static let bad = Color(light: 0xB8322A, dark: 0xF08A78)
  /// The seal. Same in both modes; never used for body text on paper.
  static let gold = Color(hex: 0xE7B425)
  /// GPS tracks and the dashed waypoint thread.
  static let track = Color(light: 0xD9480F, dark: 0xFF8A4C)
  /// Amber for "retake" / "queued" states (text-safe on paper in both modes).
  static let warn = Color(light: 0x9A5B00, dark: 0xF2B65A)
  /// Feed and camera backdrop (always dark).
  static let media = Color(hex: 0x071419)
  /// Text and glyphs drawn on `ok` / `lake` / `bad` fills.
  static let onFill = Color(light: 0xFFFFFF, dark: 0x0F2127)

  // Kept for call sites that mean "the app's primary colour".
  static let accent = lake
  static let card = surface
}

extension Color {
  /// `0xRRGGBB`, sRGB.
  nonisolated init(hex: UInt32, opacity: Double = 1) {
    self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255, opacity: opacity)
  }

  /// Resolves per trait collection, so it follows light/dark (and a forced `.colorScheme` environment).
  nonisolated init(light: UInt32, dark: UInt32) {
    self.init(uiColor: UIColor { trait in
      UIColor(rgb: trait.userInterfaceStyle == .dark ? dark : light)
    })
  }
}

extension UIColor {
  nonisolated convenience init(rgb: UInt32) {
    self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
              blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
  }
}

/// "12:03", "1:02:03"
func formatDuration(ms: Int64) -> String {
  let s = Int(ms / 1000)
  let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
  return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
}

/// "820 m", "1.24 km"
func formatDistance(_ m: Double) -> String {
  m < 1000 ? "\(Int(m.rounded())) m" : String(format: "%.2f km", m / 1000)
}

struct Chip: View {
  let text: String
  var systemImage: String? = nil
  var color: Color = .secondary
  var body: some View {
    HStack(spacing: 4) {
      if let systemImage { Image(systemName: systemImage) }
      Text(text)
    }
    .font(.caption.weight(.semibold))
    .padding(.horizontal, 8).padding(.vertical, 4)
    .foregroundStyle(color)
    .background(color.opacity(0.12), in: Capsule())
  }
}

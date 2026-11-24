import SwiftUI

enum Theme {
  static let accent = Color(red: 0.05, green: 0.62, blue: 0.47)  // verified green
  static let warn = Color(red: 0.93, green: 0.55, blue: 0.10)
  static let bad = Color(red: 0.85, green: 0.22, blue: 0.22)
  static let card = Color(.secondarySystemGroupedBackground)
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

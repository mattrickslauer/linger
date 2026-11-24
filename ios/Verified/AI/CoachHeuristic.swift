import Foundation
import VerifiedCore

/// Firebase-free parts of the live coach (also compiled by ios/scripts/mac-check.sh).
nonisolated enum LiveCoachHeuristic {
  /// Mode "none": nothing recognizable or an obvious screen -> retake; otherwise keep going.
  static func heuristic(_ labels: VisionLabeler.Labels) -> FrameCheck {
    let screenWords = ["screen", "monitor", "television", "display", "computer"]
    let looksLikeScreen = labels.objects.contains { o in screenWords.contains { o.lowercased().contains($0) } }
    if looksLikeScreen {
      return FrameCheck(ok: false, reason: "Looks like a screen, shoot the real thing", mode: .none, label: labels.shortLabel)
    }
    if labels.objects.isEmpty {
      return FrameCheck(ok: false, reason: "Nothing recognizable, try again", mode: .none, label: "unclear photo")
    }
    return FrameCheck(ok: true, reason: "keep going", mode: .none, label: labels.shortLabel)
  }
}

/// Lenient parser for `{ok, reason, label}`: models sometimes wrap JSON in prose or code fences.
nonisolated enum LiveJSON {
  struct Output: Decodable, Sendable { let ok: Bool; let reason: String; let label: String? }

  static func parse(_ text: String) -> Output? {
    guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start < end else { return nil }
    return try? JSONDecoder().decode(Output.self, from: Data(text[start...end].utf8))
  }
}


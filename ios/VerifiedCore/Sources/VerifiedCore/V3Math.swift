import Foundation

/// v3 arithmetic shared with the Cloud Functions (docs/ARCHITECTURE.md v3.3, v3.6; vectors in
/// shared/test-vectors-v3.json). Clients use it only for previews; the server's numbers are binding.
public enum V3Math {
  public static func clamp01(_ x: Double) -> Double { x.isFinite ? min(1, max(0, x)) : 0 }

  /// JS `Math.round(x * 100) / 100` (rounds .5 up).
  public static func round2(_ x: Double) -> Double { (x * 100 + 0.5).rounded(.down) / 100 }

  /// The bar a Moment's final score must reach: `round2(0.5 + 0.45 * clamp01(difficulty))`, 0.5…0.95.
  public static func bar(difficulty: Double) -> Double { round2(0.5 + 0.45 * clamp01(difficulty)) }

  /// One ladder step. Pass: `p + s(1 − p)`. Fail: `p(1 − s)`. No rounding.
  public static func step(_ p: Double, strength s: Double, passed: Bool) -> Double {
    passed ? p + s * (1 - p) : p * (1 - s)
  }

  /// A model result counts as a pass only when it says passed with confidence ≥ `passConfidence` (ladder.json).
  public static let passConfidence = 0.6
}

/// The witness events chained in `payload.events` (v3.4), in contract key order.
public enum WitnessEvents {
  public enum Kind: String, Sendable { case show, tell, `do` }
  public enum Via: String, Sendable { case frame, voice, text, done }

  public static func witness(t: Int64, wid: String, ask: String, kind: Kind, by: String) -> MomentEvent {
    MomentEvent(t: t, type: .witness,
                extras: [("wid", .string(wid)), ("ask", .string(ask)), ("kind", .string(kind.rawValue)), ("by", .string(by))])
  }

  public static func answer(t: Int64, wid: String, via: Via, text: String? = nil) -> MomentEvent {
    var extras: [(String, JSONValue)] = [("wid", .string(wid)), ("via", .string(via.rawValue))]
    if let text { extras.append(("text", .string(String(text.prefix(200))))) }
    return MomentEvent(t: t, type: .witnessAnswer, extras: extras)
  }

  public static func skip(t: Int64, wid: String, reason: String? = nil) -> MomentEvent {
    var extras: [(String, JSONValue)] = [("wid", .string(wid))]
    if let reason { extras.append(("reason", .string(reason))) }
    return MomentEvent(t: t, type: .witnessSkip, extras: extras)
  }
}

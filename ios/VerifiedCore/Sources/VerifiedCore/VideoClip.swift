import Foundation

/// A finished video clip. The clip stays on the phone (Photos, album "Verified"); the chain commits to the
/// SHA-256 of its file bytes via a `video` event. Same fields and key order as Android's `VideoClip`
/// (docs/ARCHITECTURE.md): {sha256, bytes, durationMs, startedAt, name}.
public struct VideoClip: Sendable, Equatable {
  public var name: String
  public var sha256: String
  public var bytes: Int64
  public var durationMs: Int64
  public var startedAt: Int64

  public init(name: String, sha256: String, bytes: Int64, durationMs: Int64, startedAt: Int64) {
    self.name = name; self.sha256 = sha256; self.bytes = bytes; self.durationMs = durationMs; self.startedAt = startedAt
  }

  /// Gallery file name, like Android's "verified-<first 8 of momentId>-<startedAt>" (plus the QuickTime extension).
  public static func fileName(momentId: String, startedAt: Int64) -> String {
    "verified-\(momentId.prefix(8))-\(startedAt).mov"
  }

  /// `video` event extras in contract key order.
  public var extras: [(String, JSONValue)] {
    [("sha256", .string(sha256)), ("bytes", .int(bytes)), ("durationMs", .int(durationMs)),
     ("startedAt", .int(startedAt)), ("name", .string(name))]
  }

  /// The `video` event at time `t` (the stop / poster-frame time).
  public func event(t: Int64) -> MomentEvent { MomentEvent(t: t, type: .video, extras: extras) }

  /// Milliseconds from a duration in seconds (AVAsset duration), rounded to whole ms like Android.
  public static func durationMs(seconds: Double) -> Int64 {
    seconds.isFinite && seconds > 0 ? Int64((seconds * 1000).rounded()) : 0
  }
}

/// How a clip is encoded, from how long it may run (v4.14; the same tiers as web `clip.ts` and Android `ClipProfile`).
/// The server's reviewer samples footage at <= 1 frame/s (far sparser past 2 min), so a long, still activity
/// (meditating, reading) loses nothing at 1-5 frames/s while the file shrinks ~10-30x. Time is not sped up: a
/// 30-minute clip plays for 30 minutes with continuous audio, so its duration and sound stay evidence.
///   live  cap <= 5 min   camera rate, <= 1280 px, 1.2 Mbit/s + 64 kbit/s audio
///   long  cap <= 20 min  5 fps, <= 960 px, 350 kbit/s + 32 kbit/s audio
///   slow  cap <= 2 h     1 fps, <= 720 px, 110 kbit/s + 24 kbit/s audio
public struct ClipProfile: Sendable, Equatable {
  public enum Tier: String, Sendable { case live, long, slow }
  public var tier: Tier
  /// nil: the camera's own rate.
  public var fps: Double?
  public var maxEdge: Int
  public var videoBps: Int
  public var audioBps: Int

  public static let live = ClipProfile(tier: .live, fps: nil, maxEdge: 1280, videoBps: 1_200_000, audioBps: 64_000)
  public static let long = ClipProfile(tier: .long, fps: 5, maxEdge: 960, videoBps: 350_000, audioBps: 32_000)
  public static let slow = ClipProfile(tier: .slow, fps: 1, maxEdge: 720, videoBps: 110_000, audioBps: 24_000)

  /// Default clip cap; a plan asking for a longer continuous video raises it.
  public static let minCapSeconds = 60.0
  /// Hard cap: two hours (a `slow` clip that long is ~120 MB, under the 200 MB upload limit).
  public static let maxCapSeconds = 7200.0

  public static func forCap(seconds: Double) -> ClipProfile {
    seconds <= 300 ? .live : seconds <= 1200 ? .long : .slow
  }

  /// Cap for a session: the longest `video` requirement plus 5 % and 15 s, between 60 s and 2 h.
  public static func capSeconds(plan: EvidencePlan?) -> Double {
    let need = (plan?.requirements ?? []).filter { $0.evidence == .video }.map { (($0.minSeconds ?? 0) * 1.05 + 15).rounded() }
    return min(maxCapSeconds, max(minCapSeconds, need.max() ?? 0))
  }
}

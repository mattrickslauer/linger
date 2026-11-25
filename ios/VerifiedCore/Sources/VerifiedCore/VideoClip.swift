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

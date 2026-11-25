import Foundation

/// One GPS sample: [t, lat, lng, accuracyM, altitudeM|null, speedMps|null].
public struct GPSSample: Sendable, Equatable {
  public var t: Int64, lat: Double, lng: Double, accuracyM: Double
  public var altitudeM: Double?, speedMps: Double?
  public init(t: Int64, lat: Double, lng: Double, accuracyM: Double, altitudeM: Double?, speedMps: Double?) {
    self.t = t; self.lat = lat; self.lng = lng; self.accuracyM = accuracyM
    self.altitudeM = altitudeM; self.speedMps = speedMps
  }
}

/// One motion sample: [t, ax, ay, az, gx, gy, gz] in m/s^2 and rad/s.
public struct MotionSample: Sendable, Equatable {
  public var t: Int64, ax: Double, ay: Double, az: Double, gx: Double, gy: Double, gz: Double
  public init(t: Int64, ax: Double, ay: Double, az: Double, gx: Double, gy: Double, gz: Double) {
    self.t = t; self.ax = ax; self.ay = ay; self.az = az; self.gx = gx; self.gy = gy; self.gz = gz
  }
}

/// An app event: {"t":..., "type":..., ...extras in order}.
public struct MomentEvent: Sendable, Equatable {
  public enum Kind: String, Sendable {
    case start, frame, check, retake, pause, resume, stop
    /// A video clip began recording (no extras).
    case videoStart = "video_start"
    /// A finished video clip: extras from `VideoClip.extras`, placed next to the clip's poster `frame` event.
    case video
  }
  public var t: Int64
  public var type: Kind
  public var extras: [(String, JSONValue)]
  public init(t: Int64, type: Kind, extras: [(String, JSONValue)] = []) {
    self.t = t; self.type = type; self.extras = extras
  }
  public static func == (a: MomentEvent, b: MomentEvent) -> Bool { a.json == b.json }
  var json: JSONValue { .object([("t", .int(t)), ("type", .string(type.rawValue))] + extras) }
}

/// Result of the live on-device coach check stored with a proof frame.
public struct FrameCheck: Sendable, Equatable {
  public enum Mode: String, Sendable { case onDevice = "on_device", cloud, none }
  public var ok: Bool, reason: String, mode: Mode, label: String
  public init(ok: Bool, reason: String, mode: Mode, label: String) {
    self.ok = ok; self.reason = reason; self.mode = mode; self.label = label
  }
}

/// Builds the chunk `payload` string deterministically, in contract key order:
/// gps, motion, events, frameSha, check. Output equals JS `JSON.stringify` of the same object.
public struct Payload: Sendable, Equatable {
  public var gps: [GPSSample] = []
  public var motion: [MotionSample] = []
  public var events: [MomentEvent] = []
  public var frameSha: String?
  public var check: FrameCheck?

  public init(gps: [GPSSample] = [], motion: [MotionSample] = [], events: [MomentEvent] = [],
              frameSha: String? = nil, check: FrameCheck? = nil) {
    self.gps = gps; self.motion = motion; self.events = events
    self.frameSha = frameSha; self.check = check
  }

  public var json: JSONValue {
    .object([
      ("gps", .array(gps.map {
        .array([.int($0.t), .double($0.lat), .double($0.lng), .double($0.accuracyM),
                .number($0.altitudeM), .number($0.speedMps)])
      })),
      ("motion", .array(motion.map {
        .array([.int($0.t), .double($0.ax), .double($0.ay), .double($0.az),
                .double($0.gx), .double($0.gy), .double($0.gz)])
      })),
      ("events", .array(events.map(\.json))),
      ("frameSha", frameSha.map { .string($0) } ?? .null),
      ("check", check.map {
        .object([("ok", .bool($0.ok)), ("reason", .string($0.reason)),
                 ("mode", .string($0.mode.rawValue)), ("label", .string($0.label))])
      } ?? .null),
    ])
  }

  public var string: String { json.serialized }
}

public extension Double {
  /// Rounds to `places` decimals so payloads stay compact (e.g. 6 for lat/lng, 3 for motion).
  func rounded(places: Int) -> Double {
    let m = pow(10.0, Double(places))
    return (self * m).rounded() / m
  }
}

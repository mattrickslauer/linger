import Foundation

public struct LatLng: Sendable, Equatable, Codable {
  public var lat: Double, lng: Double
  public init(lat: Double, lng: Double) { self.lat = lat; self.lng = lng }
}

/// `moments/{id}.summary` (contract). Computed by the client at submit; the seal recomputes it.
public struct MomentSummary: Sendable, Equatable {
  public var durationMs: Int64
  public var distanceM: Double
  public var frameCount: Int
  public var gpsCount: Int
  public var motionCount: Int
  public var start: LatLng?
  public var end: LatLng?
  public var heroFrameSeq: Int?

  /// Firestore-ready dictionary.
  public var firestoreData: [String: Any] {
    func ll(_ p: LatLng?) -> Any { p.map { ["lat": $0.lat, "lng": $0.lng] } ?? NSNull() }
    return [
      "durationMs": durationMs, "distanceM": distanceM, "frameCount": frameCount,
      "gpsCount": gpsCount, "motionCount": motionCount, "start": ll(start), "end": ll(end),
      "heroFrameSeq": heroFrameSeq.map { $0 as Any } ?? NSNull(),
    ]
  }

  /// Computes the summary from stored chunks (parsing each payload string).
  /// distanceM = haversine sum over consecutive GPS fixes, rounded to 0.1 m.
  /// heroFrameSeq = last chunk whose frame passed the live check, else the last chunk with a frame.
  public static func compute(startedAt: Int64, endedAt: Int64, chunks: [ChainedChunk]) -> MomentSummary {
    var points: [LatLng] = []
    var motionCount = 0
    var frameSeqs: [Int] = []
    var okFrameSeqs: [Int] = []
    for c in chunks {
      guard let obj = try? JSONSerialization.jsonObject(with: Data(c.payload.utf8)) as? [String: Any]
      else { continue }
      for row in (obj["gps"] as? [[Any]]) ?? [] where row.count >= 3 {
        if let lat = (row[1] as? NSNumber)?.doubleValue, let lng = (row[2] as? NSNumber)?.doubleValue {
          points.append(LatLng(lat: lat, lng: lng))
        }
      }
      motionCount += ((obj["motion"] as? [Any]) ?? []).count
      if obj["frameSha"] is String {
        frameSeqs.append(c.seq)
        if let check = obj["check"] as? [String: Any], (check["ok"] as? Bool) == true {
          okFrameSeqs.append(c.seq)
        }
      }
    }
    return MomentSummary(
      durationMs: endedAt - startedAt,
      distanceM: pathLength(points).rounded(places: 1),
      frameCount: frameSeqs.count,
      gpsCount: points.count,
      motionCount: motionCount,
      start: points.first, end: points.last,
      heroFrameSeq: okFrameSeqs.last ?? frameSeqs.last
    )
  }

  public static func pathLength(_ pts: [LatLng]) -> Double {
    zip(pts, pts.dropFirst()).reduce(0) { $0 + haversine($1.0, $1.1) }
  }

  /// Great-circle distance in metres (R = 6 371 000 m).
  public static func haversine(_ a: LatLng, _ b: LatLng) -> Double {
    let r = 6_371_000.0, rad = Double.pi / 180
    let dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
    let h = sin(dLat / 2) * sin(dLat / 2)
      + cos(a.lat * rad) * cos(b.lat * rad) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * r * asin(min(1, sqrt(h)))
  }
}

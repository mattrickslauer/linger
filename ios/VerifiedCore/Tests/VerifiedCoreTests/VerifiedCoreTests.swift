import Foundation
import Testing
@testable import VerifiedCore

/// Loads shared/test-vectors.json (the cross-platform contract) from the repo.
private struct Vectors: Decodable {
  struct C: Decodable {
    let seq: Int, t0: Int64, t1: Int64, prevHash: String, payload: String, payloadSha: String, hash: String
  }
  let momentId: String
  let chunks: [C]

  static func load() throws -> Vectors {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // VerifiedCoreTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // VerifiedCore
      .deletingLastPathComponent()  // ios
      .deletingLastPathComponent()  // repo root
      .appendingPathComponent("shared/test-vectors.json")
    return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
  }
}

@Suite struct ChainVectorTests {
  @Test func payloadShaAndHashMatchVectors() throws {
    let v = try Vectors.load()
    for c in v.chunks {
      #expect(sha256Hex(c.payload) == c.payloadSha)
      #expect(Chain.hash(seq: c.seq, t0: c.t0, t1: c.t1, prevHash: c.prevHash, payload: c.payload) == c.hash)
    }
  }

  @Test func builtPayloadsReproduceVectorsExactly() throws {
    let v = try Vectors.load()
    let p0 = Payload(
      gps: [GPSSample(t: 1764000000000, lat: 33.6189, lng: -117.6681, accuracyM: 5.2, altitudeM: nil, speedMps: 0.4)],
      motion: [MotionSample(t: 1764000000100, ax: 0.01, ay: 9.81, az: -0.2, gx: 0, gy: 0.001, gz: 0)],
      events: [MomentEvent(t: 1764000000000, type: .start)]
    )
    let p1 = Payload(
      events: [MomentEvent(t: 1764000006000, type: .stop)],
      frameSha: sha256Hex("aGVsbG8="),
      check: FrameCheck(ok: true, reason: "keep going", mode: .onDevice, label: "bass in hand")
    )
    #expect(p0.string == v.chunks[0].payload)
    #expect(p1.string == v.chunks[1].payload)

    var chain = Chain(momentId: v.momentId)
    #expect(chain.lastHash == nil)
    let c0 = chain.append(t0: 1764000000000, t1: 1764000005000, payload: p0.string)
    let c1 = chain.append(t0: 1764000005000, t1: 1764000006000, payload: p1.string)
    #expect(c0.prevHash == "GENESIS:" + v.momentId)
    #expect(c0.hash == v.chunks[0].hash)
    #expect(c1.prevHash == v.chunks[1].prevHash)
    #expect(c1.hash == v.chunks[1].hash)
    #expect(chain.lastHash == v.chunks[1].hash)
    #expect(c0.docId == "000000" && c1.docId == "000001")
    #expect(Chain.verify(momentId: v.momentId, chunks: [c0, c1]))
  }

  @Test func tamperingBreaksVerification() throws {
    let v = try Vectors.load()
    var chain = Chain(momentId: v.momentId)
    let c0 = chain.append(t0: 1, t1: 2, payload: v.chunks[0].payload)
    let c1 = chain.append(t0: 2, t1: 3, payload: v.chunks[1].payload)
    #expect(Chain.verify(momentId: v.momentId, chunks: [c0, c1]))
    #expect(!Chain.verify(momentId: v.momentId, chunks: [c1, c0]))
    #expect(!Chain.verify(momentId: v.momentId, chunks: [c1]))
    let forged = ChainedChunk(seq: 0, t0: 1, t1: 2, prevHash: c0.prevHash, payload: "{}", hash: c0.hash)
    #expect(!Chain.verify(momentId: v.momentId, chunks: [forged, c1]))
  }
}

@Suite struct JSONTests {
  @Test(arguments: [
    (0.0, "0"), (-0.0, "0"), (1.0, "1"), (1764000000000.0, "1764000000000"), (0.001, "0.001"),
    (33.6189, "33.6189"), (-117.6681, "-117.6681"), (9.81, "9.81"), (1e-7, "1e-7"),
    (0.000001, "0.000001"), (1.5e-7, "1.5e-7"), (1e21, "1e+21"), (1.2345e16, "12345000000000000"),
    (123.456, "123.456"), (0.1 + 0.2, "0.30000000000000004"), (-2.5e-8, "-2.5e-8"),
    (Double.nan, "null"),
  ])
  func jsNumberFormatting(_ input: Double, _ expected: String) {
    #expect(JSONValue.jsNumber(input) == expected)
  }

  @Test func stringEscaping() {
    let s = JSONValue.string("a\"b\\c\nd\u{01}é🐟").serialized
    #expect(s == "\"a\\\"b\\\\c\\nd\\u0001é🐟\"")
  }

  @Test func eventExtrasKeepOrder() {
    let e = MomentEvent(t: 5, type: .retake, extras: [("seq", .int(3)), ("reason", .string("too dark"))])
    #expect(Payload(events: [e]).string ==
      "{\"gps\":[],\"motion\":[],\"events\":[{\"t\":5,\"type\":\"retake\",\"seq\":3,\"reason\":\"too dark\"}],\"frameSha\":null,\"check\":null}")
  }
}

@Suite struct SummaryTests {
  @Test func summaryFromVectors() throws {
    let v = try Vectors.load()
    let chunks = v.chunks.map {
      ChainedChunk(seq: $0.seq, t0: $0.t0, t1: $0.t1, prevHash: $0.prevHash, payload: $0.payload, hash: $0.hash)
    }
    let s = MomentSummary.compute(startedAt: 1764000000000, endedAt: 1764000006000, chunks: chunks)
    #expect(s.durationMs == 6000)
    #expect(s.gpsCount == 1 && s.motionCount == 1 && s.frameCount == 1)
    #expect(s.distanceM == 0)
    #expect(s.start == LatLng(lat: 33.6189, lng: -117.6681))
    #expect(s.heroFrameSeq == 1)
  }

  @Test func haversineIsSane() {
    // 0.001 deg latitude ~ 111.2 m
    let d = MomentSummary.haversine(LatLng(lat: 33.0, lng: -117.0), LatLng(lat: 33.001, lng: -117.0))
    #expect(abs(d - 111.19) < 0.1)
  }
}

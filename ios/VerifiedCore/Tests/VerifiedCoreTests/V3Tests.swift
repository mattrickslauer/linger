import Foundation
import Testing
@testable import VerifiedCore

/// shared/test-vectors-v3.json: guest chain with witness events, bar mapping, ladder math.
private struct V3Vectors: Decodable {
  struct C: Decodable {
    let seq: Int, t0: Int64, t1: Int64, prevHash: String, payload: String, payloadSha: String, hash: String
  }
  struct Guest: Decodable { let momentId: String; let headHash: String; let chunks: [C] }
  struct BarV: Decodable { let difficulty: Double; let bar: Double }
  struct Step: Decodable { let module: String; let strength: Double; let passed: Bool; let before: Double; let after: Double }
  struct LadderV: Decodable { let baseline: Double; let bar: Double; let steps: [Step]; let score: Double; let verified: Bool }
  let guestChain: Guest
  let bars: [BarV]
  let ladders: [LadderV]

  static func load() throws -> V3Vectors {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("shared/test-vectors-v3.json")
    return try JSONDecoder().decode(V3Vectors.self, from: Data(contentsOf: url))
  }
}

@Suite struct V3VectorTests {
  @Test func guestChainWithWitnessEventsIsReproducedExactly() throws {
    let v = try V3Vectors.load()
    let p0 = Payload(
      gps: [GPSSample(t: 1764100000000, lat: 33.6189, lng: -117.6681, accuracyM: 5.2, altitudeM: nil, speedMps: 0.4)],
      motion: [MotionSample(t: 1764100000100, ax: 0.01, ay: 9.81, az: -0.2, gx: 0, gy: 0.001, gz: 0)],
      events: [
        MomentEvent(t: 1764100000000, type: .start),
        WitnessEvents.witness(t: 1764100003000, wid: "w1", ask: "Hold the fish next to the ruler", kind: .show, by: "on_device"),
      ])
    let p1 = Payload(
      events: [
        MomentEvent(t: 1764100008000, type: .frame, extras: [("wid", .string("w1"))]),
        WitnessEvents.answer(t: 1764100008000, wid: "w1", via: .frame),
      ],
      frameSha: "333d6b3a3c1f5db6c9bdda5939b136986d170f4649172a68368d54ecb44c2ff2",
      check: FrameCheck(ok: true, reason: "keep going", mode: .onDevice, label: "bass on ruler"))
    let p2 = Payload(
      gps: [GPSSample(t: 1764100029000, lat: 33.619, lng: -117.668, accuracyM: 5, altitudeM: nil, speedMps: 0.2)],
      events: [
        WitnessEvents.witness(t: 1764100020000, wid: "w2", ask: "Say the time on your watch", kind: .tell, by: "cloud"),
        WitnessEvents.answer(t: 1764100024000, wid: "w2", via: .voice, text: "it's six forty two"),
        WitnessEvents.witness(t: 1764100026000, wid: "w3", ask: "Pan slowly across the lake", kind: .show, by: "on_device"),
        WitnessEvents.skip(t: 1764100028000, wid: "w3"),
        MomentEvent(t: 1764100030000, type: .stop),
      ])
    let payloads = [p0.string, p1.string, p2.string]
    var chain = Chain(momentId: v.guestChain.momentId)
    for (i, c) in v.guestChain.chunks.enumerated() {
      #expect(payloads[i] == c.payload)
      #expect(sha256Hex(c.payload) == c.payloadSha)
      let built = chain.append(t0: c.t0, t1: c.t1, payload: payloads[i])
      #expect(built.prevHash == c.prevHash)
      #expect(built.hash == c.hash)
      // The chain binds only the momentId: no owner or uid anywhere (claim-on-upload needs no rewrite).
      #expect(!c.payload.contains("uid") && !c.payload.contains("owner"))
    }
    #expect(chain.lastHash == v.guestChain.headHash)
  }

  @Test func barMapping() throws {
    for b in try V3Vectors.load().bars {
      #expect(V3Math.bar(difficulty: b.difficulty) == b.bar)
    }
  }

  @Test func ladderMath() throws {
    for l in try V3Vectors.load().ladders {
      var p = l.baseline
      for s in l.steps {
        #expect(abs(p - s.before) < 1e-12)
        p = V3Math.step(p, strength: s.strength, passed: s.passed)
        #expect(abs(p - s.after) < 1e-12)
      }
      #expect(abs(p - l.score) < 1e-12)
      #expect((p >= l.bar) == l.verified)
    }
  }
}

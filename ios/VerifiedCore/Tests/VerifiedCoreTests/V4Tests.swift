import Foundation
import Testing
@testable import VerifiedCore

/// shared/test-vectors-v4.json: per-claim scoring (reference `scoreV4`) and a v4 chain with `rid` + a video clip.
private struct V4Vectors: Decodable {
  struct Case: Decodable { let name: String; let input: V4.Input; let expect: V4.Output }
  struct C: Decodable {
    let seq: Int, t0: Int64, t1: Int64, prevHash: String, payload: String, payloadSha: String, hash: String
  }
  struct VideoChain: Decodable { let momentId: String; let headHash: String; let clipSha: String; let chunks: [C] }
  let scoring: [Case]
  let videoChain: VideoChain

  static func load() throws -> V4Vectors {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("shared/test-vectors-v4.json")
    return try JSONDecoder().decode(V4Vectors.self, from: Data(contentsOf: url))
  }
}

private func close(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-9 }

@Suite struct V4VectorTests {
  @Test func scoringMatchesTheReference() throws {
    let cases = try V4Vectors.load().scoring
    #expect(cases.count == 21)
    for c in cases {
      let got = V4.score(c.input)
      let e = c.expect
      #expect(close(got.baselineUsed, e.baselineUsed), "\(c.name): baselineUsed")
      #expect(got.cheating == e.cheating, "\(c.name): cheating \(got.cheating)")
      #expect(got.claims.count == e.claims.count, "\(c.name): claims")
      for (g, x) in zip(got.claims, e.claims) {
        #expect(g.id == x.id && g.met == x.met && g.unmet == x.unmet && g.minimumMet == x.minimumMet, "\(c.name) \(x.id)")
        #expect(g.backedBy == x.backedBy, "\(c.name) \(x.id): backedBy \(g.backedBy) vs \(x.backedBy)")
        #expect(close(g.sealP, x.sealP) && close(g.p, x.p), "\(c.name) \(x.id): p \(g.p) vs \(x.p)")
      }
      #expect(got.ladder.count == e.ladder.count, "\(c.name): ladder")
      for (g, x) in zip(got.ladder, e.ladder) {
        #expect(g.module == x.module && g.passed == x.passed, "\(c.name) \(x.module)")
        #expect(close(g.before, x.before) && close(g.after, x.after), "\(c.name) \(x.module): \(g.before)->\(g.after)")
        #expect(g.claims.count == x.claims.count)
        for (gc, xc) in zip(g.claims, x.claims) {
          #expect(gc.id == xc.id && gc.passed == xc.passed && close(gc.before, xc.before) && close(gc.after, xc.after),
                  "\(c.name) \(x.module) \(xc.id)")
        }
      }
      #expect(close(got.score, e.score), "\(c.name): score \(got.score) vs \(e.score)")
      #expect(got.checks == e.checks, "\(c.name): checks")
      #expect(got.sealed == e.sealed && got.verified == e.verified, "\(c.name): sealed")
      #expect(got.ladderEligible == e.ladderEligible, "\(c.name): ladderEligible")
      #expect(got.claimsBacked == e.claimsBacked, "\(c.name): claimsBacked")
    }
  }

  @Test func videoChainWithRidIsReproducedExactly() throws {
    let v = try V4Vectors.load().videoChain
    let p0 = Payload(
      motion: [MotionSample(t: 1764200000100, ax: 0.3, ay: 9.7, az: 0.1, gx: 0.2, gy: 0.1, gz: 0)],
      events: [
        MomentEvent(t: 1764200000000, type: .start),
        MomentEvent(t: 1764200001000, type: .videoStart),
        WitnessEvents.witness(t: 1764200004000, wid: "w1", ask: "Keep both hands in frame", kind: .do, by: "on_device", rid: "r1"),
      ])
    let clip = VideoClip(name: "verified-clap.webm", sha256: v.clipSha, bytes: 15, durationMs: 35000, startedAt: 1764200001000)
    let p1 = Payload(
      events: [
        clip.event(t: 1764200036000),
        MomentEvent(t: 1764200036000, type: .frame),
        WitnessEvents.answer(t: 1764200036000, wid: "w1", via: .done),
        MomentEvent(t: 1764200036000, type: .stop),
      ],
      frameSha: sha256Hex("aGVsbG8="),
      check: FrameCheck(ok: true, reason: "keep going", mode: .onDevice, label: "hands clapping"))
    let payloads = [p0.string, p1.string]
    var chain = Chain(momentId: v.momentId)
    for (i, c) in v.chunks.enumerated() {
      #expect(payloads[i] == c.payload)
      let built = chain.append(t0: c.t0, t1: c.t1, payload: payloads[i])
      #expect(built.hash == c.hash)
    }
    #expect(chain.lastHash == v.headHash)
    // rid omitted when empty
    #expect(!WitnessEvents.witness(t: 1, wid: "w1", ask: "a", kind: .show, by: "cloud", rid: "").json.serialized.contains("rid"))
  }
}

@Suite struct V4NormalizeTests {
  @Test func claimsAreTrimmedFilteredCappedAndRenumbered() {
    let raw: [[String: Any]] = [
      ["id": "x", "kind": "bogus", "text": "dropped"],
      ["id": "a", "kind": "action", "text": "  clapping  ", "metric": "", "value": 0, "unit": ""],
      ["id": "b", "kind": "count", "text": "50 claps", "metric": "claps", "value": 50, "unit": "claps"],
      ["id": "c", "kind": "object", "text": "   "],
      ["id": "d", "kind": "measure", "text": String(repeating: "x", count: 100), "metric": "w", "value": 0, "unit": "lb"],
      ["id": "e", "kind": "place", "text": "p"], ["id": "f", "kind": "time", "text": "t"], ["id": "g", "kind": "outcome", "text": "o"],
    ]
    let (claims, remap) = V4.normalizeClaims(raw)
    #expect(claims.map(\.id) == ["c1", "c2", "c3", "c4", "c5"])
    #expect(claims[0].text == "clapping" && claims[0].metric == nil && claims[0].value == nil)
    #expect(claims[1].value == 50 && claims[1].unit == "claps")
    #expect(claims[2].text.count == 80 && claims[2].value == nil)  // value 0: quantity keys omitted
    #expect(claims[2].firestoreData["metric"] == nil)
    #expect(remap["b"] == "c2" && remap["e"] == "c4" && remap["g"] == nil)
  }

  @Test func planIsRemappedAndRenumbered() throws {
    let claims: [[String: Any]] = [
      ["id": "c2", "kind": "action", "text": "clapping"], ["id": "c3", "kind": "count", "text": "50 claps", "value": 50],
    ]
    let plan: [String: Any] = [
      "requirements": [
        ["id": "r9", "claimId": "c3", "evidence": "video", "ask": "all 50 claps", "minSeconds": 20],
        ["id": "r1", "claimId": "c9", "evidence": "video", "ask": "unknown claim"],
        ["id": "r2", "claimId": "c2", "evidence": "smell", "ask": "bad evidence"],
        ["id": "r3", "claimId": "c2", "evidence": "frames", "ask": "hands", "minSeconds": 5],
      ],
      "recordMode": "photo", "note": "n",
    ]
    let n = V4.normalize(claims: claims, plan: plan)
    let p = try #require(n.plan)
    #expect(p.requirements.map(\.id) == ["r1", "r2"])
    #expect(p.requirements[0].claimId == "c2" && p.requirements[0].minSeconds == 20)
    #expect(p.requirements[1].claimId == "c1" && p.requirements[1].minSeconds == nil)
    #expect(p.recordMode == "video")
    let removed = V4.removing("c1", claims: n.claims, plan: n.plan)
    #expect(removed.claims.map(\.text) == ["50 claps"] && removed.claims[0].id == "c1")
    #expect(removed.plan?.requirements.map(\.claimId) == ["c1"])
  }

  @Test func checklistTicksCapturedEvidence() {
    var e = V4.LocalEvidence()
    let video = Requirement(id: "r1", claimId: "c1", evidence: .video, ask: "", minSeconds: 20)
    let motion = Requirement(id: "r2", claimId: "c1", evidence: .motion, ask: "")
    let witness = Requirement(id: "r3", claimId: "c1", evidence: .witness, ask: "")
    let gps = Requirement(id: "r4", claimId: "c1", evidence: .gps, ask: "")
    e.clipDurationsMs = [12000]
    #expect(!V4.captured(video, e))
    e.clipDurationsMs.append(21000)
    #expect(V4.captured(video, e))
    e.addMotion(t: 1000, values: [0, 0, 0])
    e.addMotion(t: 2000, values: [0.1, 0, 0])
    e.addMotion(t: 11000, values: [0, 9.8, 0])
    #expect(!V4.captured(motion, e))
    e.addMotion(t: 12000, values: [0, 9.8, 0])
    #expect(V4.captured(motion, e))
    e.answeredRids = ["r2"]
    #expect(!V4.captured(witness, e))
    e.answeredRids.insert("r3")
    #expect(V4.captured(witness, e))
    e.addGPS(accuracyM: 150)
    #expect(!V4.captured(gps, e))
    e.addGPS(accuracyM: 8)
    #expect(V4.captured(gps, e))
  }
}

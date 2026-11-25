import Foundation

// v4 contract (docs/ARCHITECTURE.md v4.1–v4.5): claims, the evidence plan, the client's "captured" checklist and the
// per-claim scoring. The scoring is a port of the reference implementation `shared/make-test-vectors-v4.mjs`
// (`scoreV4`), checked against `shared/test-vectors-v4.json`. Clients use it only for previews and labels; the
// server's `verification` is binding.

public enum ClaimKind: String, Sendable, CaseIterable, Codable {
  case action, count, measure, place, time, object, outcome

  /// count/measure carry `metric`, `value`, `unit`.
  public var hasQuantity: Bool { self == .count || self == .measure }
}

public enum Evidence: String, Sendable, CaseIterable, Codable {
  case video, frames, gps, motion, witness
}

/// One checkable part of an intention: "clapping", "50 claps", "largemouth bass", "at least 6 lb".
public struct Claim: Sendable, Equatable, Identifiable, Codable {
  public var id: String
  public var kind: ClaimKind
  public var text: String
  public var metric: String?
  public var value: Double?
  public var unit: String?

  public init(id: String, kind: ClaimKind, text: String, metric: String? = nil, value: Double? = nil, unit: String? = nil) {
    self.id = id; self.kind = kind; self.text = text; self.metric = metric; self.value = value; self.unit = unit
  }

  /// Stored form: `metric/value/unit` only on count/measure claims with value > 0 (v4.1).
  public var firestoreData: [String: Any] {
    var d: [String: Any] = ["id": id, "kind": kind.rawValue, "text": text]
    if kind.hasQuantity, let value, value > 0 {
      d["metric"] = metric ?? ""
      d["value"] = value
      d["unit"] = unit ?? ""
    }
    return d
  }
}

/// The minimum evidence for one claim (v4.2).
public struct Requirement: Sendable, Equatable, Identifiable, Codable {
  public var id: String
  public var claimId: String
  public var evidence: Evidence
  public var ask: String
  public var minSeconds: Double?

  public init(id: String, claimId: String, evidence: Evidence, ask: String, minSeconds: Double? = nil) {
    self.id = id; self.claimId = claimId; self.evidence = evidence; self.ask = ask; self.minSeconds = minSeconds
  }

  public var firestoreData: [String: Any] {
    var d: [String: Any] = ["id": id, "claimId": claimId, "evidence": evidence.rawValue, "ask": ask]
    if let minSeconds, minSeconds > 0 { d["minSeconds"] = minSeconds }
    return d
  }
}

/// `intention.plan` / `moments/{id}.plan`.
public struct EvidencePlan: Sendable, Equatable, Codable {
  public var requirements: [Requirement]
  /// "video" | "photo"
  public var recordMode: String
  public var note: String
  /// Server copy only: "ai" | "client" | "default".
  public var source: String?

  public init(requirements: [Requirement], recordMode: String, note: String, source: String? = nil) {
    self.requirements = requirements; self.recordMode = recordMode; self.note = note; self.source = source
  }

  public var isVideo: Bool { recordMode == "video" }

  public var firestoreData: [String: Any] {
    ["requirements": requirements.map(\.firestoreData), "recordMode": recordMode, "note": note]
  }

  public func requirements(for claimId: String) -> [Requirement] { requirements.filter { $0.claimId == claimId } }
}

public enum V4 {
  public static let maxClaims = 5
  public static let maxRequirements = 6
  public static let defaultBaseline = 0.2
  public static let cheatingCap = 0.1
  public static let backedConfidence = 0.6
  public static let defaultMotionSeconds = 10.0
  public static let gpsFixMaxAccuracyM = 100.0
  public static let maxSignals = 6

  // MARK: - Normalization (v4.1, v4.2; client and server alike)

  private static func trimmed(_ v: Any?) -> String {
    (v as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func number(_ v: Any?) -> Double? {
    if let n = v as? NSNumber, !(v is Bool) { return n.doubleValue }
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    return nil
  }

  /// Trim, cut `text` to 80, drop unknown kinds and empty texts, keep the first 5, renumber `c1..cN`.
  /// `remap` maps each kept claim's original id to its new id (first occurrence wins), for the plan.
  public static func normalizeClaims(_ raw: Any?) -> (claims: [Claim], remap: [String: String]) {
    var out: [Claim] = []
    var remap: [String: String] = [:]
    for item in (raw as? [Any]) ?? [] {
      guard out.count < maxClaims, let d = item as? [String: Any],
            let kind = ClaimKind(rawValue: trimmed(d["kind"]).lowercased()) else { continue }
      let text = String(trimmed(d["text"]).prefix(80))
      guard !text.isEmpty else { continue }
      let id = "c\(out.count + 1)"
      let old = trimmed(d["id"])
      if !old.isEmpty, remap[old] == nil { remap[old] = id }
      var c = Claim(id: id, kind: kind, text: text)
      if kind.hasQuantity, let v = number(d["value"]), v > 0, v.isFinite {
        c.metric = trimmed(d["metric"])
        c.value = v
        c.unit = trimmed(d["unit"])
      }
      out.append(c)
    }
    return (out, remap)
  }

  /// Drops requirements whose claim is unknown (after `remap`) or whose evidence is invalid, keeps the first 6,
  /// renumbers `r1..rN`, keeps `minSeconds` only for video/motion and > 0, `recordMode = video` iff any video.
  /// nil when nothing is left.
  public static func normalizePlan(_ raw: Any?, remap: [String: String], claims: [Claim]) -> EvidencePlan? {
    guard let d = raw as? [String: Any] else { return nil }
    let known = Set(claims.map(\.id))
    var reqs: [Requirement] = []
    for item in (d["requirements"] as? [Any]) ?? [] {
      guard reqs.count < maxRequirements, let r = item as? [String: Any],
            let ev = Evidence(rawValue: trimmed(r["evidence"]).lowercased()) else { continue }
      let rawClaim = trimmed(r["claimId"])
      let claimId = remap[rawClaim] ?? rawClaim
      guard known.contains(claimId) else { continue }
      var min: Double?
      if ev == .video || ev == .motion, let m = number(r["minSeconds"]), m > 0, m.isFinite { min = m }
      reqs.append(Requirement(id: "r\(reqs.count + 1)", claimId: claimId, evidence: ev,
                              ask: String(trimmed(r["ask"]).prefix(120)), minSeconds: min))
    }
    guard !reqs.isEmpty else { return nil }
    return EvidencePlan(requirements: reqs, recordMode: reqs.contains { $0.evidence == .video } ? "video" : "photo",
                        note: String(trimmed(d["note"]).prefix(160)), source: (d["source"] as? String))
  }

  /// Both at once, from a model draft or a stored intention: `{claims: [...], plan: {...}}`.
  public static func normalize(claims rawClaims: Any?, plan rawPlan: Any?) -> (claims: [Claim], plan: EvidencePlan?) {
    let (claims, remap) = normalizeClaims(rawClaims)
    return (claims, normalizePlan(rawPlan, remap: remap, claims: claims))
  }

  /// Removes one claim (and its requirements) and renumbers both lists.
  public static func removing(_ claimId: String, claims: [Claim], plan: EvidencePlan?)
    -> (claims: [Claim], plan: EvidencePlan?) {
    let kept = claims.filter { $0.id != claimId }
    let raw = kept.map { c -> [String: Any] in
      var d = c.firestoreData
      d["id"] = c.id
      return d
    }
    let rawPlan: [String: Any]? = plan.map { p in
      ["requirements": p.requirements.filter { $0.claimId != claimId }.map(\.firestoreData),
       "recordMode": p.recordMode, "note": p.note]
    }
    return normalize(claims: raw, plan: rawPlan as Any?)
  }

  // MARK: - Client checklist ("captured", never "verified")

  /// What the recording phone holds locally, for the record screen's checklist (v4.2).
  public struct LocalEvidence: Sendable, Equatable {
    public var clipDurationsMs: [Int64] = []
    public var frameCount = 0
    /// GPS fixes with accuracy ≤ 100 m.
    public var goodGpsFixes = 0
    /// First/last time of a non-zero motion sample.
    public var motionFirstT: Int64?
    public var motionLastT: Int64?
    /// Requirement ids that an answered witness request targeted.
    public var answeredRids: Set<String> = []

    public init() {}

    public var motionSeconds: Double {
      guard let a = motionFirstT, let b = motionLastT else { return 0 }
      return Double(b - a) / 1000
    }

    public mutating func addGPS(accuracyM: Double) { if accuracyM >= 0 && accuracyM <= gpsFixMaxAccuracyM { goodGpsFixes += 1 } }

    public mutating func addMotion(t: Int64, values: [Double]) {
      guard values.contains(where: { $0 != 0 }) else { return }
      if motionFirstT == nil { motionFirstT = t }
      motionLastT = t
    }
  }

  public static func captured(_ r: Requirement, _ e: LocalEvidence) -> Bool {
    switch r.evidence {
    case .video:
      let min = (r.minSeconds ?? 0) * 1000
      return e.clipDurationsMs.contains { $0 > 0 && Double($0) >= min }
    case .frames: return e.frameCount >= 1
    case .gps: return e.goodGpsFixes >= 1
    case .motion: return e.motionSeconds >= ((r.minSeconds ?? 0) > 0 ? r.minSeconds! : defaultMotionSeconds)
    case .witness: return e.answeredRids.contains(r.id)
    }
  }

  // MARK: - Scoring (v4.5, port of scoreV4)

  public struct Verdict: Sendable, Equatable, Codable {
    public var id: String
    public var verdict: String
    public var confidence: Double?
    public init(id: String, verdict: String, confidence: Double?) { self.id = id; self.verdict = verdict; self.confidence = confidence }
  }

  public struct Integrity: Sendable, Equatable, Codable {
    public var chain, timing, physics, frames: Bool
    public init(chain: Bool, timing: Bool, physics: Bool, frames: Bool) {
      self.chain = chain; self.timing = timing; self.physics = physics; self.frames = frames
    }
  }

  public struct ClipFact: Sendable, Equatable, Codable {
    public var sha256: String?
    public var durationMs: Double
    public var uploaded: Bool
    public var hashOk: Bool?
    public init(sha256: String?, durationMs: Double, uploaded: Bool, hashOk: Bool?) {
      self.sha256 = sha256; self.durationMs = durationMs; self.uploaded = uploaded; self.hashOk = hashOk
    }
  }

  public struct WitnessFact: Sendable, Equatable, Codable {
    public var wid: String?
    public var rid: String?
    public var answered: Bool
    public init(wid: String?, rid: String?, answered: Bool) { self.wid = wid; self.rid = rid; self.answered = answered }
  }

  public struct Facts: Sendable, Equatable, Codable {
    public var integrity: Integrity
    public var frameCount: Int
    public var gpsFixes: Int
    public var motionSeconds: Double
    public var clips: [ClipFact]
    public var witness: [WitnessFact]
    public init(integrity: Integrity, frameCount: Int, gpsFixes: Int, motionSeconds: Double, clips: [ClipFact], witness: [WitnessFact]) {
      self.integrity = integrity; self.frameCount = frameCount; self.gpsFixes = gpsFixes
      self.motionSeconds = motionSeconds; self.clips = clips; self.witness = witness
    }
  }

  public struct Opinion: Sendable, Equatable, Codable {
    public var verdict: String
    public var confidence: Double
    public var reasons: [String]?
    public var claims: [Verdict]?
    public init(verdict: String, confidence: Double, reasons: [String]? = nil, claims: [Verdict]? = nil) {
      self.verdict = verdict; self.confidence = confidence; self.reasons = reasons; self.claims = claims
    }
  }

  public struct Cheating: Sendable, Equatable, Codable {
    public var detected: Bool
    public var signals: [String]
    public init(detected: Bool, signals: [String]) { self.detected = detected; self.signals = signals }
  }

  public struct VideoReviewInput: Sendable, Equatable, Codable {
    public var status: String
    public var claims: [Verdict]?
    public var cheating: Cheating?
    public init(status: String, claims: [Verdict]?, cheating: Cheating?) { self.status = status; self.claims = claims; self.cheating = cheating }
  }

  public struct ModuleRun: Sendable, Equatable, Codable {
    public var module: String
    public var strength: Double
    public var backs: [String]
    public var claims: [Verdict]?
    public var targetedOnly: Bool?
    public init(module: String, strength: Double, backs: [String], claims: [Verdict]?, targetedOnly: Bool? = nil) {
      self.module = module; self.strength = strength; self.backs = backs; self.claims = claims; self.targetedOnly = targetedOnly
    }
  }

  public struct Input: Sendable, Equatable, Codable {
    public var bar: Double
    public var baseline: Double?
    public var claims: [Claim]
    public var requirements: [Requirement]
    public var facts: Facts
    public var judge: Opinion?
    public var skeptic: Opinion?
    public var videoReview: VideoReviewInput?
    public var ladder: [ModuleRun]?
    public init(bar: Double, baseline: Double?, claims: [Claim], requirements: [Requirement], facts: Facts,
                judge: Opinion?, skeptic: Opinion?, videoReview: VideoReviewInput?, ladder: [ModuleRun]?) {
      self.bar = bar; self.baseline = baseline; self.claims = claims; self.requirements = requirements; self.facts = facts
      self.judge = judge; self.skeptic = skeptic; self.videoReview = videoReview; self.ladder = ladder
    }
  }

  public struct ClaimResult: Sendable, Equatable, Codable {
    public var id: String
    public var met: [String]
    public var unmet: [String]
    public var minimumMet: Bool
    public var backedBy: [String]
    public var sealP: Double
    public var p: Double
  }

  public struct MovedClaim: Sendable, Equatable, Codable {
    public var id: String
    public var passed: Bool
    public var before: Double
    public var after: Double
  }

  public struct LadderStep: Sendable, Equatable, Codable {
    public var module: String
    public var before: Double
    public var after: Double
    public var passed: Bool
    public var claims: [MovedClaim]
  }

  public struct Checks: Sendable, Equatable, Codable {
    public var chain, timing, physics, frames, ai, cheating, bar: Bool
  }

  public struct Output: Sendable, Equatable, Codable {
    public var baselineUsed: Double
    public var cheating: Cheating
    public var claims: [ClaimResult]
    public var ladder: [LadderStep]
    public var score: Double
    public var checks: Checks
    public var sealed: Bool
    public var verified: Bool
    public var ladderEligible: Bool
    public var claimsBacked: Int
  }

  public static func clamp01(_ x: Double) -> Double { V3Math.clamp01(x) }

  /// `verdict == "backed" && confidence ≥ 0.6`.
  public static func backs(_ v: Verdict?) -> Bool {
    guard let v, v.verdict == "backed", let c = v.confidence else { return false }
    return c >= backedConfidence
  }

  static func framesBack(_ input: Input, _ claimId: String) -> Bool {
    guard let j = input.judge, input.facts.frameCount >= 1 else { return false }
    if let cs = j.claims, !cs.isEmpty { return backs(cs.first { $0.id == claimId }) }
    return j.verdict == "consistent" && j.confidence >= backedConfidence
  }

  static func videoBacks(_ input: Input, _ claimId: String) -> Bool {
    guard let r = input.videoReview, r.status == "done" else { return false }
    guard input.facts.clips.contains(where: { $0.uploaded && $0.hashOk == true }) else { return false }
    return backs((r.claims ?? []).first { $0.id == claimId })
  }

  static func requirementMet(_ input: Input, _ req: Requirement) -> Bool {
    let f = input.facts
    switch req.evidence {
    case .video:
      let min = (req.minSeconds ?? 0) * 1000
      let long = f.clips.contains { $0.uploaded && $0.hashOk == true && $0.durationMs > 0 && $0.durationMs >= min }
      return long && videoBacks(input, req.claimId)
    case .frames: return framesBack(input, req.claimId)
    case .gps: return f.gpsFixes >= 1
    case .motion:
      let need = (req.minSeconds ?? 0) != 0 ? req.minSeconds! : defaultMotionSeconds
      return f.motionSeconds >= need
    case .witness: return f.witness.contains { $0.answered && ($0.rid == req.id || $0.rid == nil) }
    }
  }

  public static func cheating(_ input: Input) -> Cheating {
    var signals: [String] = []
    let i = input.facts.integrity
    if !i.chain { signals.append("chain: hashes do not link") }
    if !i.timing { signals.append("timing: clock does not add up") }
    if !i.physics { signals.append("physics: impossible movement") }
    if input.skeptic?.verdict == "inconsistent" {
      signals.append("skeptic: " + (input.skeptic?.reasons?.first ?? "fake signal"))
    }
    if input.facts.clips.contains(where: { $0.uploaded && $0.hashOk == false }) {
      signals.append("video: clip does not match the chain")
    }
    if input.videoReview?.status == "done", let rc = input.videoReview?.cheating, rc.detected {
      if rc.signals.isEmpty { signals.append("video: cheating detected") } else { signals += rc.signals.map { "video: " + $0 } }
    }
    return Cheating(detected: !signals.isEmpty, signals: Array(signals.prefix(maxSignals)))
  }

  /// Claims a module moves: kind in `backs`; `targetedOnly` (witness_review) only claims an answered request targeted,
  /// unless some answered request carries no `rid` (pre-v4 client): then every claim of a backed kind.
  public static func claimsBacked(byModule backs: [String], targetedOnly: Bool, claims: [Claim],
                                  requirements: [Requirement], witness: [WitnessFact]) -> [String] {
    var ids = claims.filter { backs.contains($0.kind.rawValue) }.map(\.id)
    if targetedOnly {
      let answered = witness.filter(\.answered)
      if !answered.contains(where: { $0.rid == nil }) {
        let targeted = Set(requirements.filter { r in answered.contains { $0.rid == r.id } }.map(\.claimId))
        ids = ids.filter { targeted.contains($0) }
      }
    }
    return ids
  }

  public static func score(_ input: Input) -> Output {
    let bar = input.bar
    let baseline = input.baseline.map(clamp01) ?? defaultBaseline
    let cheat = cheating(input)

    var claims: [ClaimResult] = input.claims.map { c in
      let reqs = input.requirements.filter { $0.claimId == c.id }
      let met = reqs.filter { requirementMet(input, $0) }.map(\.id)
      let unmet = reqs.filter { !met.contains($0.id) }.map(\.id)
      var backedBy: [String] = []
      if videoBacks(input, c.id) { backedBy.append("video_review") }
      if framesBack(input, c.id) { backedBy.append("frames_judge") }
      for ev in [Evidence.gps, .motion, .witness] where reqs.contains(where: { $0.evidence == ev && met.contains($0.id) }) {
        backedBy.append(ev.rawValue)
      }
      var p = baseline
      let minimumMet = !reqs.isEmpty && unmet.isEmpty
      if minimumMet && !cheat.detected { p = max(p, bar) }
      return ClaimResult(id: c.id, met: met, unmet: unmet, minimumMet: minimumMet, backedBy: backedBy, sealP: p, p: p)
    }
    func capped(_ p: Double) -> Double { cheat.detected ? min(p, cheatingCap) : p }
    func scoreOf() -> Double { claims.map { capped($0.p) }.min() ?? capped(baseline) }

    var ladder: [LadderStep] = []
    for mod in input.ladder ?? [] {
      let before = scoreOf()
      let backed = claimsBacked(byModule: mod.backs, targetedOnly: mod.targetedOnly ?? false, claims: input.claims,
                                requirements: input.requirements, witness: input.facts.witness)
      var moved: [MovedClaim] = []
      for i in claims.indices where backed.contains(claims[i].id) {
        let v = (mod.claims ?? []).first { $0.id == claims[i].id }
        let pass = backs(v)
        let b = capped(claims[i].p)
        claims[i].p = V3Math.step(claims[i].p, strength: mod.strength, passed: pass)
        if pass { claims[i].backedBy.append(mod.module) }
        moved.append(MovedClaim(id: claims[i].id, passed: pass, before: b, after: capped(claims[i].p)))
      }
      ladder.append(LadderStep(module: mod.module, before: before, after: scoreOf(),
                               passed: !moved.isEmpty && moved.allSatisfy(\.passed), claims: moved))
    }
    for i in claims.indices { claims[i].p = capped(claims[i].p) }

    let integ = input.facts.integrity
    let checks = Checks(
      chain: integ.chain, timing: integ.timing, physics: integ.physics, frames: integ.frames,
      ai: !(input.judge?.verdict == "inconsistent" && (input.judge?.confidence ?? 0) >= backedConfidence),
      cheating: !cheat.detected, bar: claims.allSatisfy { $0.p >= bar })
    let sealed = checks.chain && checks.timing && checks.physics && checks.frames && checks.ai && checks.cheating && checks.bar
    return Output(
      baselineUsed: baseline, cheating: cheat, claims: claims, ladder: ladder, score: scoreOf(), checks: checks,
      sealed: sealed, verified: sealed,
      ladderEligible: integ.chain && integ.timing && integ.physics && integ.frames && !cheat.detected,
      claimsBacked: claims.filter { $0.p >= bar }.count)
  }

  /// Detail-screen preview (v4.11): one module run on just this claim, from its current p.
  /// Returns the claim's p after a pass and after a fail.
  public static func preview(claimP p: Double, strength s: Double) -> (pass: Double, fail: Double) {
    (V3Math.step(p, strength: s, passed: true), V3Math.step(p, strength: s, passed: false))
  }
}

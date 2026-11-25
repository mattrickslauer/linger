import Foundation
import VerifiedCore

/// Field helpers for Firestore `[String: Any]` maps (numbers arrive as NSNumber).
extension Dictionary where Key == String, Value == Any {
  nonisolated func str(_ k: String) -> String? { self[k] as? String }
  nonisolated func dbl(_ k: String) -> Double? { (self[k] as? NSNumber)?.doubleValue }
  nonisolated func i64(_ k: String) -> Int64? { (self[k] as? NSNumber)?.int64Value }
  nonisolated func int(_ k: String) -> Int? { (self[k] as? NSNumber)?.intValue }
  nonisolated func bool(_ k: String) -> Bool? { self[k] as? Bool }
  nonisolated func obj(_ k: String) -> [String: Any]? { self[k] as? [String: Any] }
}

enum Category: String, CaseIterable, Identifiable, Sendable {
  case fishing, fitness, outdoors, making, other
  var id: String { rawValue }
  var label: String { rawValue.capitalized }
  var icon: String {
    switch self {
    case .fishing: "fish"
    case .fitness: "figure.run"
    case .outdoors: "mountain.2"
    case .making: "hammer"
    case .other: "sparkles"
    }
  }
}

struct AiOpinion: Sendable, Equatable {
  var verdict: String  // consistent | inconsistent | uncertain
  var confidence: Double
  var reasons: [String]
  var model: String
  var ranAt: Int64
  /// v4 judge only: per-claim verdicts (`judge.claims`), nil for the skeptic and pre-v4 judges.
  var claims: [V4.Verdict]?

  init(verdict: String, confidence: Double, reasons: [String], model: String, ranAt: Int64, claims: [V4.Verdict]? = nil) {
    self.verdict = verdict; self.confidence = confidence; self.reasons = reasons
    self.model = model; self.ranAt = ranAt; self.claims = claims
  }

  init?(_ d: [String: Any]?) {
    guard let d, let v = d.str("verdict") else { return nil }
    verdict = v
    confidence = d.dbl("confidence") ?? 0
    reasons = d["reasons"] as? [String] ?? []
    model = d.str("model") ?? ""
    ranAt = d.i64("ranAt") ?? 0
    claims = (d["claims"] as? [[String: Any]]).map { $0.compactMap(V4Parse.verdict) }
  }

  var firestoreData: [String: Any] {
    var d: [String: Any] = ["verdict": verdict, "confidence": confidence, "reasons": reasons, "model": model, "ranAt": ranAt]
    if let claims {
      d["claims"] = claims.map { ["id": $0.id, "verdict": $0.verdict, "confidence": $0.confidence ?? 0] as [String: Any] }
    }
    return d
  }
}

/// Parsing helpers for the v4 server fields (docs/ARCHITECTURE.md v4.4–v4.8).
nonisolated enum V4Parse {
  static func verdict(_ d: [String: Any]) -> V4.Verdict? {
    guard let id = d.str("id"), let v = d.str("verdict") else { return nil }
    return V4.Verdict(id: id, verdict: v, confidence: d.dbl("confidence"))
  }
}

/// One claim's score (`verification.claims[]` on the Moment, or the feed's `claims[]`).
struct ClaimScoreInfo: Sendable, Equatable {
  var p: Double
  var sealP: Double?
  var backedBy: [String]
  /// Requirement ids met / not met (Moment doc). The feed only has counts.
  var met: [String] = []
  var unmet: [String] = []
  var metCount: Int
  var total: Int
  var minimumMet: Bool?

  init?(_ d: [String: Any]) {
    guard let p = d.dbl("p") else { return nil }
    self.p = p
    sealP = d.dbl("sealP")
    backedBy = d["backedBy"] as? [String] ?? []
    met = d["met"] as? [String] ?? []
    unmet = d["unmet"] as? [String] ?? []
    // Moment: met/unmet are id lists; feed: met/total are numbers.
    metCount = d.int("met") ?? met.count
    total = d.int("total") ?? (met.count + unmet.count)
    minimumMet = d.bool("minimumMet")
  }
}

/// v4.12: one uploaded clip anyone who can see the Moment can play. From the feed's `video.clips[]`, or from
/// `moments/{id}.videoReview.clips[]` where `uploaded` (path = `clips/{ownerUid}/{momentId}/{sha256}.{ext}`).
struct SharedClip: Sendable, Equatable, Identifiable {
  var path: String
  var sha256: String
  var durationMs: Int64
  /// false = the uploaded bytes don't match the chained hash; nil = not checked yet.
  var hashOk: Bool?
  var id: String { path }

  init?(feed d: [String: Any]) {
    guard let path = d.str("path"), !path.isEmpty else { return nil }
    self.path = path
    sha256 = d.str("sha256") ?? ""
    durationMs = d.i64("durationMs") ?? 0
    hashOk = d.bool("hashOk")
  }

  init?(moment d: [String: Any], ownerUid: String, momentId: String) {
    guard d.bool("uploaded") == true, let sha = d.str("sha256"), let ext = d.str("ext"), !ext.isEmpty else { return nil }
    path = "clips/\(ownerUid)/\(momentId)/\(sha).\(ext)"
    sha256 = sha
    durationMs = d.i64("durationMs") ?? 0
    hashOk = d.bool("hashOk")
  }
}

/// `moments/{id}.videoReview` (server-only) or the feed's `video`.
struct VideoReviewInfo: Sendable, Equatable {
  struct ClaimVerdict: Sendable, Equatable {
    var verdict: V4.Verdict
    var reasons: [String]
    var measured: String?
  }
  var status: String  // waiting|running|done|failed|expired|none
  var summary: String?
  var reason: String?
  var clipsTotal = 0
  var clipsUploaded = 0
  var claims: [String: ClaimVerdict] = [:]
  var cheatingSignals: [String] = []

  init(status: String, summary: String?) { self.status = status; self.summary = summary }

  init?(_ d: [String: Any]?) {
    guard let d, let status = d.str("status") else { return nil }
    self.status = status
    summary = d.str("summary").flatMap { $0.isEmpty ? nil : $0 }
    reason = d.str("reason")
    let clips = d["clips"] as? [[String: Any]] ?? []
    clipsTotal = clips.count
    clipsUploaded = clips.filter { $0.bool("uploaded") == true }.count
    for c in d["claims"] as? [[String: Any]] ?? [] {
      guard let v = V4Parse.verdict(c) else { continue }
      let m = c.obj("measured")
      let measured = m.flatMap { m in
        m.dbl("value").map { "\(formatValue($0)) \(m.str("unit") ?? "")".trimmingCharacters(in: .whitespaces) }
      }
      claims[v.id] = ClaimVerdict(verdict: v, reasons: c["reasons"] as? [String] ?? [], measured: measured)
    }
    cheatingSignals = d.obj("cheating")?["signals"] as? [String] ?? []
  }
}

/// The scorer's P(claim true | evidence) under an adversarial prior. `moments/{id}.score`, or the feed's
/// `verificationScore` + `scoreReasons` (no model there).
struct VerificationScore: Sendable, Equatable {
  var probability: Double  // 0...1
  var reasons: [String]
  var model: String?
  var ranAt: Int64

  init(probability: Double, reasons: [String], model: String?, ranAt: Int64) {
    self.probability = min(1, max(0, probability)); self.reasons = Array(reasons.prefix(4))
    self.model = model; self.ranAt = ranAt
  }

  init?(_ d: [String: Any]?) {
    guard let d, let p = d.dbl("probability") else { return nil }
    self.init(probability: p, reasons: d["reasons"] as? [String] ?? [], model: d.str("model"), ranAt: d.i64("ranAt") ?? 0)
  }

  var firestoreData: [String: Any] {
    ["probability": probability, "reasons": reasons, "model": model ?? "", "ranAt": ranAt]
  }
}

struct SummaryInfo: Sendable, Equatable {
  var durationMs: Int64 = 0
  var distanceM: Double = 0
  var frameCount = 0
  var heroFrameSeq: Int?

  init(durationMs: Int64 = 0, distanceM: Double = 0, frameCount: Int = 0, heroFrameSeq: Int? = nil) {
    self.durationMs = durationMs; self.distanceM = distanceM
    self.frameCount = frameCount; self.heroFrameSeq = heroFrameSeq
  }

  init?(_ d: [String: Any]?) {
    guard let d else { return nil }
    durationMs = d.i64("durationMs") ?? 0
    distanceM = d.dbl("distanceM") ?? 0
    frameCount = d.int("frameCount") ?? 0
    heroFrameSeq = d.int("heroFrameSeq")
  }
}

/// `moments/{id}.bar` (v3.3, server-only) or the feed's `bar` + `barRationale` + `difficulty`.
struct BarInfo: Sendable, Equatable {
  var value: Double
  var difficulty: Double?
  var rationale: String?
  var factors: [String] = []
  var source: String?  // ai | default
  var model: String?

  init(value: Double, difficulty: Double?, rationale: String?, factors: [String] = [], source: String? = nil, model: String? = nil) {
    self.value = value; self.difficulty = difficulty; self.rationale = rationale
    self.factors = factors; self.source = source; self.model = model
  }

  init?(_ d: [String: Any]?) {
    guard let d, let v = d.dbl("value") else { return nil }
    self.init(value: v, difficulty: d.dbl("difficulty"), rationale: d.str("rationale"),
              factors: d["factors"] as? [String] ?? [], source: d.str("source"), model: d.str("model"))
  }
}

/// One verification-ladder result (v3.5 `LadderResult`, or the feed's short `ladder[]` entry).
struct LadderEntry: Sendable, Equatable, Identifiable {
  struct Measured: Sendable, Equatable { var metric: String; var value: Double; var unit: String }
  var runId: String
  var module: String
  var title: String
  var cost: Int?
  var strength: Double?
  var passed: Bool
  var confidence: Double?
  var before: Double
  var after: Double
  var reasons: [String]
  var measured: [Measured] = []
  var model: String?
  /// v4 `ModuleClaimOutcome[]`: which claims this module moved, and how.
  var claims: [ClaimOutcome] = []
  var id: String { runId.isEmpty ? module : runId }

  nonisolated struct ClaimOutcome: Sendable, Equatable, Identifiable {
    var id: String
    var verdict: String
    var confidence: Double
    var passed: Bool
    var before: Double
    var after: Double
    var reasons: [String]

    init?(_ d: [String: Any]) {
      guard let id = d.str("id") else { return nil }
      self.id = id
      verdict = d.str("verdict") ?? "missing"
      confidence = d.dbl("confidence") ?? 0
      passed = d.bool("passed") ?? false
      before = d.dbl("before") ?? 0
      after = d.dbl("after") ?? 0
      reasons = d["reasons"] as? [String] ?? []
    }
  }

  init?(_ d: [String: Any]) {
    guard let module = d.str("module") else { return nil }
    self.module = module
    runId = d.str("runId") ?? ""
    title = d.str("title") ?? LadderCatalog.shared.module(module)?.title ?? module
    cost = d.int("cost")
    strength = d.dbl("strength")
    passed = d.bool("passed") ?? false
    confidence = d.dbl("confidence")
    before = d.dbl("before") ?? 0
    after = d.dbl("after") ?? 0
    reasons = d["reasons"] as? [String] ?? []
    measured = (d["measured"] as? [[String: Any]] ?? []).compactMap { m in
      guard let metric = m.str("metric"), let v = m.dbl("value") else { return nil }
      return Measured(metric: metric, value: v, unit: m.str("unit") ?? "")
    }
    model = d.str("model")
    claims = (d["claims"] as? [[String: Any]] ?? []).compactMap(ClaimOutcome.init)
  }
}

/// What a Moment card needs; built from either `feed/{id}` or `moments/{id}`.
struct MomentCardData: Identifiable, Sendable, Equatable {
  var id: String
  /// Set from `moments/{id}` (owner view); nil from the feed. Delete is only offered when it is the signed-in uid.
  var ownerUid: String?
  var ownerName: String
  var ownerPhotoURL: String?
  var intention: String
  var category: String
  var platform: String
  var status: String  // recording | submitted | sealed | rejected
  var startedAt: Int64
  /// Feed only: `sealedAtServer` (set by FeedStore, which reads the Firestore Timestamp).
  var sealedAt: Date? = nil
  var summary: SummaryInfo?
  var onDeviceMode: String
  var heroJpegB64: String?
  var track: [LatLng] = []
  var sealReason: String?
  var checks: [String: Bool] = [:]
  var judgeReasons: [String] = []
  var judge: AiOpinion?
  var skeptic: AiOpinion?
  var score: VerificationScore?
  var hasPendingWrites = false
  /// A guest Moment kept only on this phone (raw-vault journal), not on the server (v3.1).
  var local = false
  // v3
  /// The structured intention (v3.2) when the Moment has one.
  var structured: StructuredIntention?
  var bar: BarInfo?
  /// Server-computed: the scorer's baseline and the final score after every ladder module (v3.5).
  var baselineScore: Double?
  var finalScore: Double?
  /// `verification.verified` (score ≥ bar).
  var verifiedByScore: Bool?
  var ladder: [LadderEntry] = []
  var ladderEligible = false
  var sealVersion: Int?
  var witnessAsked = 0
  var witnessAnswered = 0
  var witnessSkipped = 0
  var recordedAsGuest = false
  // v4
  /// Server claims (`moments/{id}.claims.items` / feed `claims`) when present, else the intention's draft claims.
  var claims: [Claim] = []
  var claimsFromServer = false
  /// Server plan (`moments/{id}.plan` / feed `plan`) when present, else the intention's draft plan.
  var plan: EvidencePlan?
  /// Feed only: which plan requirements the server counted as met.
  var planMet: Set<String> = []
  var claimScores: [String: ClaimScoreInfo] = [:]
  var claimsBacked: Int?
  var cheating = false
  var cheatingSignals: [String] = []
  var videoReview: VideoReviewInfo?
  /// v4.12: uploaded clips, chain order (feed `video.clips`, or the Moment's uploaded `videoReview.clips`).
  var videoClips: [SharedClip] = []

  /// v4.12: the clip the feed autoplays: the last one whose hash isn't known to mismatch.
  var feedClip: SharedClip? { videoClips.last { $0.hashOk != false } }

  /// Sealed (or being sealed) under the v4 rules: per-claim scores.
  var isV4: Bool { (sealVersion ?? 0) >= 4 || claimsFromServer }
  var claimsTotal: Int { claims.count }

  var isVerified: Bool { status == "sealed" }
  /// Score shown against the bar: the final (ladder) score, else the scorer's probability.
  var displayScore: Double? { finalScore ?? score?.probability }

  /// The badge: a finished guest Moment reads "On this device" (it has not been judged).
  var badgeStatus: String { local && status == "submitted" ? "local" : status }

  /// `feed/{momentId}` (public, written by the Cloud Function).
  static func fromFeed(id: String, _ d: [String: Any]) -> MomentCardData {
    let owner = d.obj("owner") ?? [:]
    let intention = d.obj("intention") ?? [:]
    // Firestore cannot store nested arrays, so the seal function writes `track` as [{lat,lng}];
    // the contract's [[lat,lng]] form is accepted too.
    let track: [LatLng] = (d["track"] as? [Any] ?? []).compactMap { p in
      if let m = p as? [String: Any], let lat = m.dbl("lat"), let lng = m.dbl("lng") { return LatLng(lat: lat, lng: lng) }
      if let a = p as? [NSNumber], a.count >= 2 { return LatLng(lat: a[0].doubleValue, lng: a[1].doubleValue) }
      return nil
    }
    return MomentCardData(
      id: d.str("momentId") ?? id, ownerName: owner.str("name") ?? "Someone",
      ownerPhotoURL: owner.str("photoURL"), intention: intention.str("text") ?? "",
      category: intention.str("category") ?? "other", platform: d.str("platform") ?? "",
      status: d.str("status") ?? "sealed", startedAt: 0, summary: SummaryInfo(d.obj("summary")),
      onDeviceMode: d.str("onDeviceMode") ?? "none", heroJpegB64: d.str("heroJpegB64"),
      track: track, sealReason: d.str("sealReason"),
      checks: d["checks"] as? [String: Bool] ?? [:], judgeReasons: d["judgeReasons"] as? [String] ?? [],
      score: d.dbl("verificationScore").map {
        VerificationScore(probability: $0, reasons: d["scoreReasons"] as? [String] ?? [], model: nil, ranAt: 0)
      }).withV3(feed: d, intention: intention)
  }

  /// Feed v3 (v3.8): bar, barRationale, difficulty, baselineScore, ladder[], witness, recordedAsGuest, sealVersion.
  private func withV3(feed d: [String: Any], intention: [String: Any]) -> MomentCardData {
    var c = self
    c.structured = Self.structured(intention)
    if let v = d.dbl("bar") { c.bar = BarInfo(value: v, difficulty: d.dbl("difficulty"), rationale: d.str("barRationale")) }
    c.baselineScore = d.dbl("baselineScore")
    c.finalScore = d.dbl("verificationScore")
    c.ladder = (d["ladder"] as? [[String: Any]] ?? []).compactMap(LadderEntry.init)
    c.sealVersion = d.int("sealVersion")
    c.recordedAsGuest = d.bool("recordedAsGuest") ?? false
    if let w = d.obj("witness") {
      c.witnessAsked = w.int("asked") ?? 0; c.witnessAnswered = w.int("answered") ?? 0; c.witnessSkipped = w.int("skipped") ?? 0
    }
    if let b = c.bar, let s = c.finalScore { c.verifiedByScore = s >= b.value }
    // v4.8
    if let fc = d["claims"] as? [[String: Any]], !fc.isEmpty {
      let n = V4.normalizeClaims(fc)
      c.claims = n.claims
      c.claimsFromServer = true
      for raw in fc {
        if let old = raw.str("id"), let id = n.remap[old], let score = ClaimScoreInfo(raw) { c.claimScores[id] = score }
      }
    } else {
      c.claims = c.structured?.claims ?? []
    }
    if let fp = d.obj("plan") {
      c.plan = V4.normalizePlan(fp, remap: [:], claims: c.claims)
      c.planMet = Set((fp["requirements"] as? [[String: Any]] ?? []).compactMap { $0.bool("met") == true ? $0.str("id") : nil })
    } else {
      c.plan = c.structured?.plan
    }
    c.claimsBacked = d.int("claimsBacked")
    c.cheating = d.bool("cheating") ?? false
    c.cheatingSignals = d["cheatingSignals"] as? [String] ?? []
    if let v = d.obj("video"), let st = v.str("status") { c.videoReview = VideoReviewInfo(status: st, summary: v.str("summary")) }
    // v4.12: absent on feed docs sealed before it (= no clips).
    c.videoClips = (d.obj("video")?["clips"] as? [[String: Any]] ?? []).compactMap { SharedClip(feed: $0) }
    return c
  }

  /// `moments/{id}` v3: bar, verification (server-only), seal v3 fields, witness, recordedAsGuest.
  private func withV3(moment d: [String: Any], intention: [String: Any]) -> MomentCardData {
    var c = self
    c.structured = Self.structured(intention)
    c.bar = BarInfo(d.obj("bar"))
    if let v = d.obj("verification") {
      c.baselineScore = v.dbl("baseline")
      c.finalScore = v.dbl("score")
      c.verifiedByScore = v.bool("verified")
      c.ladder = (v["modules"] as? [[String: Any]] ?? []).compactMap(LadderEntry.init)
    }
    let seal = d.obj("seal")
    c.ladderEligible = seal?.bool("ladderEligible") ?? false
    c.sealVersion = seal?.int("version")
    c.recordedAsGuest = d.bool("recordedAsGuest") ?? false
    if let w = d.obj("witness") {
      c.witnessAsked = w.int("asked") ?? 0; c.witnessAnswered = w.int("answered") ?? 0; c.witnessSkipped = w.int("skipped") ?? 0
    }
    // v4: server claims/plan (server-only), per-claim scores, cheating, video review.
    if let items = d.obj("claims")?["items"] as? [[String: Any]], !items.isEmpty {
      let n = V4.normalize(claims: items, plan: d.obj("plan"))
      c.claims = n.claims
      c.plan = n.plan ?? c.structured?.plan
      c.claimsFromServer = true
    } else {
      c.claims = c.structured?.claims ?? []
      c.plan = c.structured?.plan
    }
    if let v = d.obj("verification") {
      for raw in v["claims"] as? [[String: Any]] ?? [] {
        if let id = raw.str("id"), let score = ClaimScoreInfo(raw) { c.claimScores[id] = score }
      }
      c.claimsBacked = v.int("claimsBacked")
      if let ch = v.obj("cheating") {
        c.cheating = ch.bool("detected") ?? false
        c.cheatingSignals = ch["signals"] as? [String] ?? []
      }
    }
    if let sig = seal?["cheatingSignals"] as? [String], !sig.isEmpty { c.cheatingSignals = sig; c.cheating = true }
    if seal?.obj("checks")?.bool("cheating") == false { c.cheating = true }
    c.videoReview = VideoReviewInfo(d.obj("videoReview"))
    if let uid = c.ownerUid {
      let momentId = c.id
      c.videoClips = (d.obj("videoReview")?["clips"] as? [[String: Any]] ?? []).compactMap {
        SharedClip(moment: $0, ownerUid: uid, momentId: momentId)
      }
    }
    return c
  }

  static func structured(_ intention: [String: Any]) -> StructuredIntention? {
    guard (intention.int("v") ?? 0) >= 3 else { return nil }
    let place = intention.obj("place")
    let loc = place.flatMap { p in p.dbl("lat").flatMap { lat in p.dbl("lng").map { (lat: lat, lng: $0) } } }
    var s = StructuredIntention(json: intention, location: loc)
    if let iv = intention.obj("interview") {
      s?.turns = iv.int("turns") ?? 0
      s?.mode = iv.str("mode") ?? "typed"
    }
    if let pv = intention.obj("preview"), let bar = pv.dbl("bar") {
      s?.preview = .init(bar: bar, difficulty: pv.dbl("difficulty") ?? 0, mode: pv.str("mode") ?? "on_device",
                         rationale: "", factors: [])
    }
    if let w = intention.obj("window") { s?.expectedMinutes = w.dbl("expectedMinutes") }
    return s
  }

  /// `moments/{momentId}` (owner view, any status).
  static func fromMoment(id: String, _ d: [String: Any], pending: Bool) -> MomentCardData {
    let owner = d.obj("owner") ?? [:]
    let intention = d.obj("intention") ?? [:]
    let seal = d.obj("seal")
    let judge = AiOpinion(d.obj("judge"))
    return MomentCardData(
      id: id, ownerUid: d.str("ownerUid"), ownerName: owner.str("name") ?? "Me", ownerPhotoURL: owner.str("photoURL"),
      intention: intention.str("text") ?? "", category: intention.str("category") ?? "other",
      platform: d.str("platform") ?? "ios", status: d.str("status") ?? "recording",
      startedAt: d.i64("startedAt") ?? 0, summary: SummaryInfo(d.obj("summary")),
      onDeviceMode: d.obj("onDevice")?.str("mode") ?? "none", heroJpegB64: nil,
      sealReason: seal?.str("reason"), checks: seal?["checks"] as? [String: Bool] ?? [:],
      judgeReasons: judge?.reasons ?? [], judge: judge, skeptic: AiOpinion(d.obj("skeptic")),
      score: VerificationScore(d.obj("score")), hasPendingWrites: pending).withV3(moment: d, intention: intention)
  }
}

func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

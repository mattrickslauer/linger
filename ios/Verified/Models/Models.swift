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

  init(verdict: String, confidence: Double, reasons: [String], model: String, ranAt: Int64) {
    self.verdict = verdict; self.confidence = confidence; self.reasons = reasons
    self.model = model; self.ranAt = ranAt
  }

  init?(_ d: [String: Any]?) {
    guard let d, let v = d.str("verdict") else { return nil }
    verdict = v
    confidence = d.dbl("confidence") ?? 0
    reasons = d["reasons"] as? [String] ?? []
    model = d.str("model") ?? ""
    ranAt = d.i64("ranAt") ?? 0
  }

  var firestoreData: [String: Any] {
    ["verdict": verdict, "confidence": confidence, "reasons": reasons, "model": model, "ranAt": ranAt]
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
  var id: String { runId.isEmpty ? module : runId }

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
    return c
  }

  static func structured(_ intention: [String: Any]) -> StructuredIntention? {
    guard intention.int("v") == 3 else { return nil }
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

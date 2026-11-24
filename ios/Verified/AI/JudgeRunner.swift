@preconcurrency import FirebaseAILogic
@preconcurrency import FirebaseFirestore
import Foundation
import Observation

/// After a Moment is submitted and the phone is online, asks the cloud judge and skeptic
/// (ONLY_IN_CLOUD, with images) via Firebase AI Logic and writes both opinions to the moment.
/// The Cloud Function then seals it.
@Observable
final class JudgeRunner {
  private(set) var running: Set<String> = []
  var lastError: String?
  @ObservationIgnored private let network: NetworkMonitor
  @ObservationIgnored private var latest: [MomentCardData] = []
  @ObservationIgnored private var failed: Set<String> = []

  init(network: NetworkMonitor) {
    self.network = network
    network.whenOnline { [weak self] in
      guard let self else { return }
      self.failed.removeAll()  // retry everything once we're back online
      self.consider(self.latest)
    }
  }

  /// Called with every snapshot of the user's moments.
  func consider(_ moments: [MomentCardData]) {
    latest = moments
    guard network.isOnline else { return }
    for m in moments where m.status == "submitted" && m.judge == nil
      && !running.contains(m.id) && !failed.contains(m.id) {
      running.insert(m.id)
      Task {
        do {
          try await run(momentId: m.id)
          lastError = nil
        } catch {
          failed.insert(m.id)
          lastError = "Cloud judge: \(error.localizedDescription)"
          print("[Verified] judge failed for \(m.id):", error)
        }
        running.remove(m.id)
      }
    }
  }

  /// Manual retry from Me tab.
  func retry() {
    failed.removeAll()
    consider(latest)
  }

  private func run(momentId: String) async throws {
    let doc = try await MomentStore.moment(momentId).getDocument()
    guard let d = doc.data() else { return }
    let intention = d.obj("intention") ?? [:]
    let summary = d.obj("summary") ?? [:]
    let startedAt = d.i64("startedAt") ?? 0
    let heroSeq = summary.int("heroFrameSeq")

    let chunkSnap = try await MomentStore.chunks(momentId).order(by: "seq").getDocuments()
    var frames: [(seq: Int, t: Int64, jpeg: Data)] = []
    for c in chunkSnap.documents {
      let cd = c.data()
      guard let f = cd.obj("frame"), let b64 = f.str("jpegB64"), let data = Data(base64Encoded: b64) else { continue }
      frames.append((cd.int("seq") ?? 0, f.i64("t") ?? 0, data))
    }
    let picked = Self.pickFrames(frames, heroSeq: heroSeq)

    let values = [
      "intention": intention.str("text") ?? "",
      "category": intention.str("category") ?? "other",
      "summary": Self.describe(summary, onDevice: d.obj("onDevice")),
      "frameOffsets": picked.map { "\(max(0, ($0.t - startedAt) / 1000))s" }.joined(separator: ", "),
    ]
    let images = picked.map(\.jpeg)
    async let judge = Self.opinion(Prompts.shared.judge, values: values, images: images)
    async let skeptic = Self.opinion(Prompts.shared.skeptic, values: values, images: images)
    let (j, s) = try await (judge, skeptic)
    MomentStore.writeOpinions(momentId: momentId, judge: j, skeptic: s)
  }

  /// Hero frame first, then up to 3 more spread over the session, in time order.
  static func pickFrames(_ frames: [(seq: Int, t: Int64, jpeg: Data)], heroSeq: Int?)
    -> [(seq: Int, t: Int64, jpeg: Data)] {
    guard frames.count > 4 else { return frames }
    var chosen = Set<Int>()
    if let heroSeq, frames.contains(where: { $0.seq == heroSeq }) { chosen.insert(heroSeq) }
    let step = Double(frames.count - 1) / 3
    for i in 0...3 where chosen.count < 4 { chosen.insert(frames[Int((Double(i) * step).rounded())].seq) }
    return frames.filter { chosen.contains($0.seq) }
  }

  static func describe(_ s: [String: Any], onDevice: [String: Any]?) -> String {
    let dur = (s.i64("durationMs") ?? 0) / 1000
    var parts = [
      "duration \(dur / 60)m \(dur % 60)s",
      "distance \(Int((s.dbl("distanceM") ?? 0).rounded())) m",
      "GPS fixes \(s.int("gpsCount") ?? 0)",
      "motion samples \(s.int("motionCount") ?? 0)",
      "proof frames \(s.int("frameCount") ?? 0)",
    ]
    if let st = s.obj("start"), let lat = st.dbl("lat"), let lng = st.dbl("lng") {
      parts.append(String(format: "start %.4f,%.4f", lat, lng))
    }
    if let od = onDevice {
      parts.append("live coach (\(od.str("mode") ?? "none")): \(od.int("checks") ?? 0) checks, \(od.int("retakes") ?? 0) retakes")
    }
    return parts.joined(separator: "; ")
  }

  private static let opinionSchema = Schema.object(properties: [
    "verdict": .enumeration(values: ["consistent", "inconsistent", "uncertain"]),
    "confidence": .double(),
    "reasons": .array(items: .string()),
  ])

  /// One ONLY_IN_CLOUD call with images and a JSON response schema.
  static func opinion(_ p: Prompts.Prompt, values: [String: String], images: [Data]) async throws -> AiOpinion {
    let name = FirebaseSetup.cloudModel
    let model = FirebaseAI.firebaseAI(backend: .googleAI()).generativeModel(
      modelName: name,
      generationConfig: GenerationConfig(
        temperature: 0.2, responseMIMEType: "application/json", responseSchema: opinionSchema),
      systemInstruction: ModelContent(role: "system", parts: [TextPart(p.system)])
    )
    var parts: [any Part] = [TextPart(p.fill(values))]
    parts += images.map { InlineDataPart(data: $0, mimeType: "image/jpeg") }
    let response = try await model.generateContent([ModelContent(role: "user", parts: parts)])
    guard let text = response.text, let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}")
    else { throw URLError(.cannotParseResponse) }
    struct Raw: Decodable { let verdict: String; let confidence: Double; let reasons: [String] }
    let raw = try JSONDecoder().decode(Raw.self, from: Data(text[start...end].utf8))
    let verdict = ["consistent", "inconsistent", "uncertain"].contains(raw.verdict) ? raw.verdict : "uncertain"
    return AiOpinion(
      verdict: verdict, confidence: min(1, max(0, raw.confidence)),
      reasons: Array(raw.reasons.prefix(4)), model: name, ranAt: nowMs())
  }
}

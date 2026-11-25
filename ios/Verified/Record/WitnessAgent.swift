import Foundation
import Observation
import UIKit
import UserNotifications
import VerifiedCore

/// The realtime witness (docs/ARCHITECTURE.md v3.4): while a Moment records it asks, now and then, for the one piece
/// of evidence that would convince a skeptic ("Hold the fish next to the ruler"). It speaks the ask, shows a toast,
/// and posts a local notification when the app is in the background. Every ask and answer is chained by the
/// recorder (`witness`, `frame{wid}`, `witness_answer`, `witness_skip` events), so the evidence is hashed.
///
/// Drafts run through Firebase AI Logic hybrid inference (`witnessDraft`, PREFER_ON_DEVICE: Apple Foundation Models
/// first); online, `witnessRefine` (ONLY_IN_CLOUD, with the latest frames) may improve the draft within 4 s.
/// v4: both prompts get the evidence plan and the requirements still missing, ask for those first, and name the
/// requirement they serve (`requirementId` → the chained `rid`).
/// The witness can never verify anything: it only asks.
@Observable
final class WitnessAgent {
  struct Request: Identifiable, Equatable {
    let wid: String
    let ask: String
    let kind: WitnessEvents.Kind
    let why: String
    /// "on_device" | "cloud": which model produced the final ask.
    let by: String
    let askedAt: Int64
    /// v4.10: the plan requirement this request serves (chained as the witness event's `rid`), nil if none.
    var rid: String? = nil
    var outcome: Outcome?
    var id: String { wid }
  }

  enum Outcome: Equatable {
    case answered(WitnessEvents.Via, String?)
    case skipped(String?)
  }

  /// What the recorder knows about the session, for `{{session}}` and the refine frames.
  struct Context {
    var intention: [String: Any]
    var elapsedS: Int
    var distanceM: Double
    var frameCount: Int
    var frameLabels: [String]
    var gps: Bool
    var motion: Bool
    var clips: Int
    var online: Bool
    /// Up to 3 latest frames: (JPEG, offset s from start).
    var frames: [(Data, Int)]
    /// v4: the evidence plan (`{{plan}}`) and the requirements not captured yet (`{{unmet}}`, plan order).
    var plan: [String: Any]? = nil
    var unmet: [[String: Any]] = []
    /// Valid `requirementId`s (anything else from the model is dropped).
    var requirementIds: Set<String> = []
  }

  /// Pacing (contract v3.4).
  static let firstAfterMs: Int64 = 30_000
  static let gapMs: Int64 = 60_000
  static let maxRequests = 6
  static let minGain = 0.1

  private(set) var requests: [Request] = []
  /// Drafting a request right now (the "witness is thinking" chip).
  private(set) var thinking = false
  /// The open request's "Show" was tapped: the next proof shot answers it.
  private(set) var armed: String?
  /// The person can switch the witness off for this phone.
  var enabled = UserDefaults.standard.object(forKey: "witnessEnabled") as? Bool ?? true {
    didSet { UserDefaults.standard.set(enabled, forKey: "witnessEnabled") }
  }

  @ObservationIgnored private var startedAt: Int64 = 0
  @ObservationIgnored private var lastActivity: Int64 = 0
  @ObservationIgnored private var lastAttempt: Int64 = 0
  @ObservationIgnored private var draftTask: Task<Void, Never>?

  var open: Request? { requests.last.flatMap { $0.outcome == nil ? $0 : nil } }
  var armedRequest: Request? { armed.flatMap { a in requests.first { $0.wid == a && $0.outcome == nil } } }

  func reset(startedAt t: Int64) {
    draftTask?.cancel()
    draftTask = nil
    requests = []
    thinking = false
    armed = nil
    startedAt = t
    lastActivity = t
    lastAttempt = 0
  }

  func stop() {
    draftTask?.cancel()
    draftTask = nil
    thinking = false
    armed = nil
    WitnessNotifier.clear()
  }

  /// One open request at a time, the first ≥ 30 s after start, ≥ 60 s after the last ask/answer, ≤ 6 per Moment.
  /// A failed draft (offline, no on-device model) waits a full gap before trying again.
  func due(now: Int64) -> Bool {
    enabled && !thinking && open == nil && requests.count < Self.maxRequests
      && now - startedAt >= Self.firstAfterMs
      && now - lastActivity >= (requests.isEmpty ? 0 : Self.gapMs)
      && now - lastAttempt >= Self.gapMs
  }

  /// Drafts (and maybe refines) the next ask; `post` chains it and returns the request to deliver.
  func draft(_ ctx: Context, post: @escaping (String, WitnessEvents.Kind, String, String?) -> Request?) {
    thinking = true
    lastAttempt = nowMs()
    draftTask = Task { [weak self] in
      guard let self else { return }
      let result = await Self.propose(ctx, asked: self.askedJSON)
      self.thinking = false
      guard !Task.isCancelled, let result, self.open == nil, self.requests.count < Self.maxRequests else { return }
      guard let req = post(result.ask, result.kind, result.by, result.rid) else { return }
      self.requests.append(Request(wid: req.wid, ask: req.ask, kind: req.kind, why: result.why, by: req.by,
                                   askedAt: req.askedAt, rid: req.rid))
      self.lastActivity = req.askedAt
      self.deliver(req.ask)
    }
  }

  /// `w1`, `w2`, … (1-based per Moment).
  var nextWid: String { "w\(requests.count + 1)" }

  // MARK: - Answers (the recorder chains the events; this keeps the state)

  func arm(_ wid: String) { if open?.wid == wid { armed = wid } }
  func disarm() { armed = nil }

  func close(_ wid: String, _ outcome: Outcome) {
    guard let i = requests.firstIndex(where: { $0.wid == wid }), requests[i].outcome == nil else { return }
    requests[i].outcome = outcome
    if armed == wid { armed = nil }
    lastActivity = nowMs()
    VoiceIO.shared.stopSpeaking()
    WitnessNotifier.clear()
  }

  /// `moments/{id}.witness` at submit (informational; the server recounts from the chain).
  var summary: [String: Any] {
    let answered = requests.filter { if case .answered = $0.outcome { true } else { false } }.count
    let skipped = requests.filter { if case .skipped = $0.outcome { true } else { false } }.count
    let bys = Set(requests.map(\.by))
    let mode = bys.isEmpty ? "none" : bys.count > 1 ? "mixed" : (bys.first ?? "none")
    return ["asked": requests.count, "answered": answered, "skipped": skipped, "mode": mode]
  }

  // MARK: - Delivery

  private func deliver(_ ask: String) {
    if UIApplication.shared.applicationState == .active {
      Task { await VoiceIO.shared.speak(ask) }
    } else {
      WitnessNotifier.post(ask)
    }
  }

  /// The app went to the background with a request still open: remind with a local notification.
  func didEnterBackground() {
    if let open { WitnessNotifier.post(open.ask) }
  }

  // MARK: - Models

  private var askedJSON: String {
    HybridAI.jsonText(requests.map { r -> [String: Any] in
      var o: [String: Any] = ["ask": r.ask, "kind": r.kind.rawValue]
      switch r.outcome {
      case .answered(let via, let text)?:
        o["outcome"] = "answered by \(via.rawValue)"
        if let text { o["answer"] = text }
      case .skipped?: o["outcome"] = "skipped"
      case nil: o["outcome"] = "open"
      }
      return o
    })
  }

  private struct Proposal { let ask: String; let kind: WitnessEvents.Kind; let why: String; let by: String; let rid: String? }

  private static func propose(_ ctx: Context, asked: String) async -> Proposal? {
    let intention = HybridAI.jsonText(ctx.intention)
    let session = HybridAI.jsonText([
      "elapsedS": ctx.elapsedS, "distanceM": Int(ctx.distanceM.rounded()), "frames": ctx.frameCount,
      "frameLabels": Array(ctx.frameLabels.suffix(8)), "gps": ctx.gps, "motion": ctx.motion, "videoClips": ctx.clips,
    ] as [String: Any])
    let p = Prompts.shared.witnessDraft
    let values = [
      "intention": intention, "session": session, "asked": asked,
      "plan": ctx.plan.map { HybridAI.jsonText($0) } ?? "null", "unmet": HybridAI.jsonText(ctx.unmet),
    ]
    guard let draft = try? await HybridAI.preferOnDevice(
      system: p.system, prompt: p.fill(values) + "\n\n" + HybridAI.jsonInstruction("witnessDraft"),
      online: ctx.online, timeout: 20),
      let d = draft.json
    else { return nil }
    let ids = ctx.requirementIds
    var best = parse(d, by: draft.mode == .onDevice ? "on_device" : "cloud", ids: ids)

    // Online: let Gemini look at the latest frames and keep or improve the draft (4 s, else keep the draft).
    if ctx.online, !ctx.frames.isEmpty {
      let r = Prompts.shared.witnessRefine
      var rv = values
      rv["draft"] = HybridAI.jsonText(d)
      rv["frameOffsets"] = ctx.frames.map { "\($0.1)" }.joined(separator: ", ")
      if let refined = try? await HybridAI.cloud(system: r.system, prompt: r.fill(rv),
                                                 images: ctx.frames.map(\.0), timeout: 4),
         let rj = refined.json {
        best = parse(rj, by: "cloud", ids: ids) ?? best
      }
    }
    return best
  }

  private static func parse(_ j: [String: Any], by: String, ids: Set<String>) -> Proposal? {
    let ask = (j["ask"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let gain = (j["gain"] as? NSNumber)?.doubleValue ?? 0
    guard !ask.isEmpty, gain >= minGain else { return nil }
    let words = ask.split(separator: " ")
    let short = words.count > 14 ? words.prefix(14).joined(separator: " ") : ask
    let kind = WitnessEvents.Kind(rawValue: (j["kind"] as? String ?? "").lowercased()) ?? .show
    let rid = (j["requirementId"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    return Proposal(ask: String(short.prefix(120)), kind: kind, why: String((j["why"] as? String ?? "").prefix(100)), by: by,
                    rid: ids.contains(rid) ? rid : nil)
  }
}

/// Local notifications for the witness when the app is in the background (no FCM; contract v3.4).
enum WitnessNotifier {
  static let id = "witness"

  static func requestPermission() {
    let center = UNUserNotificationCenter.current()
    Task {
      let settings = await center.notificationSettings()
      guard settings.authorizationStatus == .notDetermined else { return }
      _ = try? await center.requestAuthorization(options: [.alert, .sound])
    }
  }

  static func post(_ ask: String) {
    let content = UNMutableNotificationContent()
    content.title = "Your witness asks"
    content.body = ask
    content.sound = .default
    let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(req) { err in
      if let err { print("[Verified] witness notification:", err.localizedDescription) }
    }
  }

  static func clear() {
    let c = UNUserNotificationCenter.current()
    c.removeDeliveredNotifications(withIdentifiers: [id])
    c.removePendingNotificationRequests(withIdentifiers: [id])
  }
}

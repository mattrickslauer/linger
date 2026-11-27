import CoreLocation
import Foundation
import MapKit
import Observation
import VerifiedCore

/// The voice interview (docs/ARCHITECTURE.md v3.2, v4.1–v4.2): a few spoken turns → a structured intention with its
/// claims and evidence plan → a bar preview.
///  - turns: `interviewTurn`, PREFER_ON_DEVICE (Apple Foundation Models first, Gemini fallback)
///  - final: `structureIntention`, ONLY_IN_CLOUD; offline or failing → the last on-device draft
///  - preview: `barPreview`, PREFER_ON_DEVICE → `bar = round2(0.5 + 0.45·difficulty)` (the binding bar is server-side)
/// Voice is optional: every answer can be typed, and "Skip — just type it" keeps the v1 form.
@Observable
final class InterviewModel {
  enum Phase: Equatable { case idle, locating, speaking, listening, waiting, thinking, structuring, previewing, done }

  struct Line: Identifiable, Equatable {
    let id = UUID()
    enum Role { case me, ai }
    let role: Role
    let text: String
    /// "on_device" / "cloud" for AI lines (shown as a chip).
    var mode: String?
  }

  private(set) var phase: Phase = .idle
  private(set) var lines: [Line] = []
  private(set) var result: StructuredIntention?
  private(set) var placeLabel: String?
  var typed = ""

  static let opener = "What are you about to do?"
  static let maxQuestions = 3

  @ObservationIgnored private let network: NetworkMonitor
  @ObservationIgnored private let voice = VoiceIO.shared
  @ObservationIgnored private var draft: [String: Any] = [:]
  @ObservationIgnored private var context: [String: Any] = [:]
  @ObservationIgnored private var location: (lat: Double, lng: Double)?
  @ObservationIgnored private var turnModes: [String] = []
  @ObservationIgnored private var questions = 0
  @ObservationIgnored private var run: Task<Void, Never>?
  @ObservationIgnored private var answer: CheckedContinuation<String, Never>?

  init(network: NetworkMonitor) { self.network = network }

  var active: Bool { phase != .idle && phase != .done }

  // MARK: - Flow

  func begin() {
    reset()
    run = Task { [weak self] in
      guard let self else { return }
      self.phase = .locating
      await self.loadContext()
      await self.say(Self.opener, mode: nil)
      await self.converse()
    }
  }

  func cancel() {
    run?.cancel()
    voice.stopListening()
    voice.stopSpeaking()
    answer?.resume(returning: "")
    answer = nil
    reset()
  }

  /// Typed answer (always available).
  func submitTyped() {
    let t = typed.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty, answer != nil else { return }
    typed = ""
    deliver(t)
  }

  /// Mic tapped: listen (again) for the current answer.
  func listen() {
    guard answer != nil, !voice.listening else { return }
    phase = .listening
    Task { [weak self] in
      let heard = await self?.voice.listen()
      guard let self else { return }
      if let heard { self.deliver(heard) } else if self.answer != nil { self.phase = .waiting }
    }
  }

  /// "Start" / "That's it": finish with what we have.
  func finishNow() {
    guard active else { return }
    if answer != nil { deliver("start") }
  }

  /// Edits on the result card.
  func removeAssumption(_ a: String) { result?.assumptions.removeAll { $0 == a } }
  func removeCondition(_ c: String) { result?.conditions.removeAll { $0 == c } }
  func removeQuantity(_ q: StructuredIntention.Quantity) { result?.quantities.removeAll { $0 == q } }
  /// v4: drop a claim the AI got wrong (and its requirements).
  func removeClaim(_ id: String) { result?.removeClaim(id) }

  private func reset() {
    phase = .idle
    lines = []
    result = nil
    draft = [:]
    turnModes = []
    questions = 0
    typed = ""
  }

  private func deliver(_ text: String) {
    voice.stopListening()
    let c = answer
    answer = nil
    c?.resume(returning: text)
  }

  private func nextAnswer() async -> String {
    await withCheckedContinuation { c in
      answer = c
      listen()
    }
  }

  private func converse() async {
    while !Task.isCancelled {
      let said = await nextAnswer()
      guard !Task.isCancelled, !said.isEmpty else { return }
      lines.append(Line(role: .me, text: said))
      if Self.isStartWord(said) && !draft.isEmpty { break }
      phase = .thinking
      guard let turn = await turn() else {
        // No model at all (offline, no on-device model): the first answer becomes the intention text.
        if draft.isEmpty { draft = ["text": said, "category": Self.guessCategory(said).rawValue, "goal": said] }
        break
      }
      if let d = turn.json?["draft"] as? [String: Any], !d.isEmpty { draft = groundCategory(d) }
      let done = (turn.json?["done"] as? Bool) ?? false
      let sayText = groundQuestion((turn.json?["say"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
      if !sayText.isEmpty { await say(sayText, mode: turn.mode.rawValue) }
      if done || questions >= Self.maxQuestions { break }
      questions += 1
    }
    guard !Task.isCancelled else { return }
    await finish()
  }

  private func say(_ text: String, mode: String?) async {
    lines.append(Line(role: .ai, text: text, mode: mode))
    phase = .speaking
    await voice.speak(text)
  }

  private var transcript: String {
    lines.map { "\($0.role == .me ? "me" : "ai"): \($0.text)" }.joined(separator: "\n")
  }

  private func turn() async -> HybridAI.Answer? {
    let p = Prompts.shared.interviewTurn
    let prompt = p.fill([
      "context": HybridAI.jsonText(context), "draft": HybridAI.jsonText(draft), "transcript": transcript,
    ]) + "\n\n" + HybridAI.jsonInstruction("interviewTurn")
    do {
      let a = try await HybridAI.preferOnDevice(system: p.system, prompt: prompt, online: network.isOnline)
      guard a.json != nil else { return nil }
      turnModes.append(a.mode.rawValue)
      return a
    } catch {
      print("[Verified] interview turn failed:", error.localizedDescription)
      return nil
    }
  }

  private func finish() async {
    phase = .structuring
    var structuredByCloud = false
    if network.isOnline {
      let p = Prompts.shared.structureIntention
      let prompt = p.fill([
        "context": HybridAI.jsonText(context), "transcript": transcript, "draft": HybridAI.jsonText(draft),
      ]) + "\n\n" + HybridAI.jsonInstruction("structureIntention")
      if let a = try? await HybridAI.cloud(system: p.system, prompt: prompt, timeout: 15), let j = a.json, !j.isEmpty {
        draft = groundCategory(j)
        structuredByCloud = true
      }
    }
    let first = lines.first(where: { $0.role == .me })?.text ?? ""
    let fallback: [String: Any] = ["text": first, "category": Self.guessCategory(first).rawValue, "goal": first]
    // A model draft without text or goal (e.g. only a category) would leave nothing to show: use the first answer.
    guard var r = StructuredIntention(json: draft, location: location)
            ?? StructuredIntention(json: fallback, location: location) else {
      // Nothing was said at all: back to the intro (the typed form below still works).
      reset()
      return
    }
    let modes = Set(turnModes + (structuredByCloud ? ["cloud"] : []))
    // No model ran at all (offline, no on-device model): the person's own words became the intention.
    r.mode = modes.count > 1 ? "mixed" : (modes.first ?? "typed")
    r.turns = lines.filter { $0.role == .me }.count
    result = r
    phase = .previewing
    await previewBar()
    phase = .done
  }

  /// v4.1: a typed intention (no interview) may be structured in the cloud before Start, to get claims and the
  /// evidence plan (`structureIntention`, ONLY_IN_CLOUD, the sentence as a one-line transcript). Optional: the server
  /// derives claims and a plan at submit either way.
  func structureTyped(_ text: String, category: Category) {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty, !active, network.isOnline else { return }
    reset()
    run = Task { [weak self] in
      guard let self else { return }
      self.phase = .locating
      await self.loadContext()
      self.phase = .structuring
      let p = Prompts.shared.structureIntention
      let draft: [String: Any] = ["text": t, "category": category.rawValue, "goal": t]
      let prompt = p.fill([
        "context": HybridAI.jsonText(self.context), "transcript": "me: \(t)", "draft": HybridAI.jsonText(draft),
      ]) + "\n\n" + HybridAI.jsonInstruction("structureIntention")
      let j = (try? await HybridAI.cloud(system: p.system, prompt: prompt, timeout: 15))?.json
      guard !Task.isCancelled else { return }
      guard var r = j.flatMap({ StructuredIntention(json: $0, location: self.location) }) else {
        self.reset()
        return
      }
      r.text = String(t.prefix(200))  // the person's own sentence stays the intention text
      r.category = category
      r.mode = "typed"
      r.turns = 0
      self.result = r
      self.phase = .previewing
      await self.previewBar()
      self.phase = .done
    }
  }

  /// Bar preview (PREFER_ON_DEVICE). Re-run after edits on the card.
  func previewBar() async {
    guard let r = result else { return }
    let p = Prompts.shared.barPreview
    let prompt = p.fill(["intention": HybridAI.jsonText(r.promptJSON), "context": HybridAI.jsonText(context)])
      + "\n\n" + HybridAI.jsonInstruction("barPreview")
    guard let a = try? await HybridAI.preferOnDevice(system: p.system, prompt: prompt, online: network.isOnline),
          let j = a.json, let d = (j["difficulty"] as? NSNumber)?.doubleValue
    else { return }
    let difficulty = V3Math.clamp01(d)
    result?.preview = StructuredIntention.Preview(
      bar: V3Math.bar(difficulty: difficulty), difficulty: difficulty, mode: a.mode == .onDevice ? "on_device" : "cloud",
      rationale: String((j["rationale"] as? String ?? "").prefix(160)),
      factors: Array(((j["factors"] as? [String]) ?? []).prefix(4)))
  }

  // MARK: - Context (v3.2 step 1)

  private func loadContext() async {
    let now = Date()
    let local = DateFormatter()
    local.locale = Locale(identifier: "en_US_POSIX")
    local.dateFormat = "yyyy-MM-dd'T'HH:mm EEE"
    var ctx: [String: Any] = [
      "localTime": local.string(from: now),
      "month": Calendar.current.component(.month, from: now),
      "platform": "ios",
      "lat": NSNull(), "lng": NSNull(), "place": NSNull(), "hemisphere": NSNull(),
    ]
    if let loc = await Self.oneShotLocation() {
      location = (loc.lat, loc.lng)
      ctx["lat"] = loc.lat.rounded(places: 4)
      ctx["lng"] = loc.lng.rounded(places: 4)
      ctx["hemisphere"] = loc.lat >= 0 ? "N" : "S"
      if let name = await Self.placeName(lat: loc.lat, lng: loc.lng) {
        ctx["place"] = name
        placeLabel = name
      }
    }
    context = ctx
  }

  nonisolated static func oneShotLocation() async -> LatLng? {
    let session = CLServiceSession(authorization: .whenInUse)
    defer { session.invalidate() }
    return try? await withTimeout(seconds: 6) {
      for try await update in CLLocationUpdate.liveUpdates() {
        if let l = update.location, l.horizontalAccuracy >= 0 {
          return LatLng(lat: l.coordinate.latitude, lng: l.coordinate.longitude)
        }
      }
      throw TimeoutError()
    }
  }

  /// "Lake Mission Viejo, Mission Viejo, CA" (MapKit reverse geocoding; nil offline).
  static func placeName(lat: Double, lng: Double) async -> String? {
    guard let req = MKReverseGeocodingRequest(location: CLLocation(latitude: lat, longitude: lng)),
          let item = try? await req.mapItems.first else { return nil }
    let parts = [item.name, item.addressRepresentations?.cityWithContext].compactMap { $0 }.filter { !$0.isEmpty }
    var seen = Set<String>()
    let out = parts.filter { seen.insert($0).inserted }.joined(separator: ", ")
    return out.isEmpty ? nil : out
  }

  // MARK: - Grounding (the small on-device model must not invent an activity)

  /// Everything the person has said so far.
  private var personSaid: String { lines.filter { $0.role == .me }.map(\.text).joined(separator: " ") }

  /// The model may only call it fishing when the person mentioned fishing; otherwise the category comes from the
  /// person's own words (usually `.other`).
  private func groundCategory(_ d: [String: Any]) -> [String: Any] {
    guard (d["category"] as? String) == Category.fishing.rawValue, !Self.mentionsFishing(personSaid) else { return d }
    var d = d
    d["category"] = Self.guessCategory(personSaid).rawValue
    if let a = d["activity"] as? String, Self.mentionsFishing(a) { d["activity"] = "" }
    return d
  }

  /// A question about catching fish when the person never mentioned fishing becomes a neutral one.
  private func groundQuestion(_ say: String) -> String {
    guard Self.mentionsFishing(say), !Self.mentionsFishing(personSaid) else { return say }
    return "What exactly counts as done for this?"
  }

  static func mentionsFishing(_ s: String) -> Bool {
    let t = s.lowercased()
    return ["fish", "catch", "bass", "trout", "angl", "bait", "lure", "species"].contains(where: t.contains)
  }

  static func isStartWord(_ s: String) -> Bool {
    let t = s.lowercased().trimmingCharacters(in: .punctuationCharacters.union(.whitespaces))
    return ["start", "go", "let's go", "lets go", "start moment", "that's it", "thats it", "done"].contains(t)
  }

  static func guessCategory(_ s: String) -> Category {
    let t = s.lowercased()
    if ["fish", "bass", "trout", "catch", "angl"].contains(where: t.contains) { return .fishing }
    if ["run", "gym", "push", "lift", "swim", "bike", "ride", "km", "rep"].contains(where: t.contains) { return .fitness }
    if ["hike", "climb", "summit", "trail", "ski", "camp"].contains(where: t.contains) { return .outdoors }
    if ["build", "make", "bake", "cook", "paint", "knit", "carve"].contains(where: t.contains) { return .making }
    return .other
  }
}

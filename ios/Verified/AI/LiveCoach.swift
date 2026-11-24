@preconcurrency import FirebaseAILogic
import Foundation
import VerifiedCore

/// The live per-frame coach (`liveCheck`, PREFER_ON_DEVICE).
///
/// Runs through Firebase AI Logic hybrid inference: Apple Foundation Models on-device first,
/// Gemini in the cloud as fallback. Foundation Models is text-only, so the frame is described
/// with Apple Vision first (see `VisionLabeler`) and those labels are the prompt's `{{frame}}`.
/// Offline with no on-device model -> mode "none" (a Vision-only heuristic; never blocks recording).
enum LiveCoach {
  static var onDeviceAvailable: Bool { FirebaseAI.SystemLanguageModel.default.isAvailable }

  /// Shown in Me > Developer.
  static var availabilityNote: String {
    switch FirebaseAI.SystemLanguageModel.default.availability {
    case .available: "Apple Foundation Models ready (on-device)"
    case .unavailable(.deviceNotEligible): "Device not eligible for Apple Intelligence: cloud fallback"
    case .unavailable(.appleIntelligenceNotEnabled): "Apple Intelligence is off: cloud fallback"
    case .unavailable(.modelNotReady): "On-device model still downloading: cloud fallback"
    default: "On-device model unavailable: cloud fallback"
    }
  }

  static func check(intention: String, labels: VisionLabeler.Labels, online: Bool) async -> FrameCheck {
    if !online && !onDeviceAvailable { return heuristic(labels) }
    do {
      return try await withTimeout(seconds: 15) { try await hybrid(intention: intention, labels: labels) }
    } catch {
      print("[Verified] live check failed, falling back to Vision-only:", error)
      return heuristic(labels)
    }
  }

  private static func hybrid(intention: String, labels: VisionLabeler.Labels) async throws -> FrameCheck {
    let ai = FirebaseAI.firebaseAI(backend: .googleAI())
    let systemModel = FirebaseAI.SystemLanguageModel.default
    let cloudModel = ai.geminiModel(name: FirebaseSetup.cloudModel)
    let session = ai.generativeModelSession(
      model: .hybridModel(primary: systemModel, secondary: cloudModel)
    )
    let p = Prompts.shared.liveCheck
    let prompt = """
      \(p.system)

      \(p.fill(["intention": intention, "frame": labels.description]))

      Answer with one JSON object only: {"ok": true|false, "reason": "...", "label": "2-4 words"}
      """
    let response = try await session.respond(to: prompt)
    let modelVersion: String? = response.rawResponse.modelVersion
    let onDevice = (modelVersion ?? "").contains("apple")
    let parsed = LiveJSON.parse(response.content)
    return FrameCheck(
      ok: parsed?.ok ?? true,
      reason: parsed.map { $0.ok ? "keep going" : $0.reason } ?? "keep going",
      mode: onDevice ? .onDevice : .cloud,
      label: parsed?.label ?? labels.shortLabel
    )
  }

  /// Mode "none": nothing recognizable or an obvious screen -> retake; otherwise keep going.
  static func heuristic(_ labels: VisionLabeler.Labels) -> FrameCheck {
    let screenWords = ["screen", "monitor", "television", "display", "computer"]
    let looksLikeScreen = labels.objects.contains { o in screenWords.contains { o.lowercased().contains($0) } }
    if looksLikeScreen {
      return FrameCheck(ok: false, reason: "Looks like a screen, shoot the real thing", mode: .none, label: labels.shortLabel)
    }
    if labels.objects.isEmpty {
      return FrameCheck(ok: false, reason: "Nothing recognizable, try again", mode: .none, label: "unclear photo")
    }
    return FrameCheck(ok: true, reason: "keep going", mode: .none, label: labels.shortLabel)
  }
}

/// Lenient parser for `{ok, reason, label}`: models sometimes wrap JSON in prose or code fences.
nonisolated enum LiveJSON {
  struct Output: Decodable, Sendable { let ok: Bool; let reason: String; let label: String? }

  static func parse(_ text: String) -> Output? {
    guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start < end else { return nil }
    return try? JSONDecoder().decode(Output.self, from: Data(text[start...end].utf8))
  }
}

struct TimeoutError: Error {}

/// Runs `work`, throwing `TimeoutError` if it takes longer than `seconds`.
func withTimeout<T: Sendable>(seconds: Double, _ work: @escaping @Sendable () async throws -> T) async throws -> T {
  try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask { try await work() }
    group.addTask {
      try await Task.sleep(for: .seconds(seconds))
      throw TimeoutError()
    }
    defer { group.cancelAll() }
    guard let first = try await group.next() else { throw TimeoutError() }
    return first
  }
}

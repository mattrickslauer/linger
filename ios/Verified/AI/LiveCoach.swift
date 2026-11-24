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
    if !online && !onDeviceAvailable { return LiveCoachHeuristic.heuristic(labels) }
    do {
      return try await withTimeout(seconds: 15) { try await hybrid(intention: intention, labels: labels) }
    } catch {
      print("[Verified] live check failed, falling back to Vision-only:", error)
      return LiveCoachHeuristic.heuristic(labels)
    }
  }

  private static func hybrid(intention: String, labels: VisionLabeler.Labels) async throws -> FrameCheck {
    let ai = FirebaseAI.firebaseAI(backend: .googleAI())
    let systemModel = FirebaseAI.SystemLanguageModel.default
    let cloudModel = ai.geminiModel(name: FirebaseSetup.cloudModel)
    let p = Prompts.shared.liveCheck
    // PREFER_ON_DEVICE: Apple Foundation Models first, Gemini in the cloud as the fallback.
    let session = ai.generativeModelSession(
      model: .hybridModel(primary: systemModel, secondary: cloudModel),
      instructions: p.system
    )
    let prompt = """
      \(p.fill(["intention": intention, "frame": labels.description]))

      Answer with one JSON object only: {"ok": true|false, "reason": "...", "label": "2-4 words"}
      """
    let response = try await session.respond(to: prompt)
    // `rawResponse.modelVersion` names the model that answered (docs: hybrid/ios/configuration-options).
    // Gemini reports "gemini-…"; anything else means Apple Foundation Models answered on-device.
    let modelVersion: String? = response.rawResponse.modelVersion
    let mv = (modelVersion ?? "").lowercased()
    let onDevice = mv.contains("gemini") ? false
      : (mv.contains("apple") || mv.contains("foundation") || mv.contains("system") || onDeviceAvailable)
    let parsed = LiveJSON.parse(response.content)
    return FrameCheck(
      ok: parsed?.ok ?? true,
      reason: parsed.map { $0.ok ? "keep going" : $0.reason } ?? "keep going",
      mode: onDevice ? .onDevice : .cloud,
      label: parsed?.label ?? labels.shortLabel
    )
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

import FoundationModels

/// Structured output of the live check (shared/prompts.json `liveCheck.schema`).
@Generable
nonisolated struct LiveCheckOutput: Sendable {
  @Guide(description: "true if the frame is usable evidence for the intention")
  var ok: Bool
  @Guide(description: "'keep going' if ok, else a retake instruction of at most 8 words")
  var reason: String
  @Guide(description: "2-4 word description of what is in the frame")
  var label: String
}

/// Apple Foundation Models (on-device, text-only). Fed Apple Vision labels of the frame.
enum OnDeviceCoach {
  static var isAvailable: Bool { SystemLanguageModel.default.isAvailable }

  /// Human-readable reason when the on-device model can't run (shown in Me > Developer).
  static var availabilityNote: String {
    switch SystemLanguageModel.default.availability {
    case .available: "Apple Foundation Models ready"
    case .unavailable(.deviceNotEligible): "Device not eligible for Apple Intelligence"
    case .unavailable(.appleIntelligenceNotEnabled): "Apple Intelligence is turned off"
    case .unavailable(.modelNotReady): "On-device model is still downloading"
    case .unavailable: "On-device model unavailable"
    }
  }

  /// Loads the model ahead of the first proof shot so the first check is fast.
  static func prewarm() {
    guard isAvailable else { return }
    LanguageModelSession(instructions: Prompts.shared.liveCheck.system).prewarm()
  }

  static func check(intention: String, frameDescription: String) async throws -> LiveCheckOutput {
    let p = Prompts.shared.liveCheck
    let session = LanguageModelSession(instructions: p.system)
    let prompt = p.user(["intention": intention, "frame": frameDescription])
    return try await session.respond(to: prompt, generating: LiveCheckOutput.self).content
  }
}

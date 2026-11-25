@preconcurrency import FirebaseAILogic
import Foundation
import VerifiedCore

/// Every client AI call goes through Firebase AI Logic (docs/ARCHITECTURE.md v3.10):
/// - `preferOnDevice`: hybrid inference, Apple Foundation Models on-device first, Gemini in the cloud as the fallback
///   (interview turns, bar preview, witness drafts, the live coach).
/// - `cloud`: ONLY_IN_CLOUD Gemini with images (final structuring, witness refine; the judge/skeptic/scorer use
///   `JudgeRunner`).
/// Nothing on the device can verify anything: these calls only coach, ask and preview.
nonisolated enum HybridAI {
  /// Which model answered.
  typealias Mode = FrameCheck.Mode

  struct Answer: Sendable {
    let text: String
    let mode: Mode
    let model: String
    /// The first JSON object in the reply, if any.
    var json: [String: Any]? { HybridAI.jsonObject(text) }
  }

  enum Failure: LocalizedError {
    case noModel
    var errorDescription: String? { "No on-device model and no connection" }
  }

  static var onDeviceAvailable: Bool { FirebaseAI.SystemLanguageModel.default.isAvailable }

  /// PREFER_ON_DEVICE through `generativeModelSession(.hybridModel(primary: SystemLanguageModel, secondary: Gemini))`.
  /// `rawResponse.modelVersion` names the model that answered; Gemini reports "gemini-…".
  static func preferOnDevice(system: String, prompt: String, online: Bool, timeout: Double = 20) async throws -> Answer {
    if !online && !onDeviceAvailable { throw Failure.noModel }
    return try await withTimeout(seconds: timeout) {
      let ai = FirebaseAI.firebaseAI(backend: .googleAI())
      let cloudName = await FirebaseSetup.cloudModel
      let session = ai.generativeModelSession(
        model: .hybridModel(primary: FirebaseAI.SystemLanguageModel.default, secondary: ai.geminiModel(name: cloudName)),
        instructions: system
      )
      let response = try await session.respond(to: prompt)
      let modelVersion: String? = response.rawResponse.modelVersion
      let mv = (modelVersion ?? "").lowercased()
      let onDevice = mv.contains("gemini") ? false
        : (mv.contains("apple") || mv.contains("foundation") || mv.contains("system") || onDeviceAvailable)
      return Answer(text: response.content, mode: onDevice ? .onDevice : .cloud,
                    model: onDevice ? "apple-foundation-models" : (modelVersion ?? cloudName))
    }
  }

  /// ONLY_IN_CLOUD: Gemini with optional JPEG images, JSON out.
  static func cloud(system: String, prompt: String, images: [Data] = [], timeout: Double = 25) async throws -> Answer {
    try await withTimeout(seconds: timeout) {
      let name = await FirebaseSetup.cloudModel
      let model = FirebaseAI.firebaseAI(backend: .googleAI()).generativeModel(
        modelName: name,
        generationConfig: GenerationConfig(temperature: 0.3, responseMIMEType: "application/json"),
        systemInstruction: ModelContent(role: "system", parts: system)
      )
      var parts: [any Part] = [TextPart(prompt)]
      parts += images.map { InlineDataPart(data: $0, mimeType: "image/jpeg") }
      let response = try await model.generateContent([ModelContent(role: "user", parts: parts)])
      guard let text = response.text else { throw URLError(.cannotParseResponse) }
      return Answer(text: text, mode: .cloud, model: name)
    }
  }

  /// Appended to prompts so text-only on-device models answer in the shared JSON shape.
  static func jsonInstruction(_ promptName: String) -> String {
    guard let schema = Prompts.schemaJSON(promptName) else { return "Reply with one JSON object only." }
    return "Reply with one JSON object only, no prose, matching this JSON schema:\n\(schema)"
  }

  /// The first `{ … }` object in a model reply (models sometimes wrap JSON in prose or code fences).
  nonisolated static func jsonObject(_ text: String) -> [String: Any]? {
    guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start < end else { return nil }
    return (try? JSONSerialization.jsonObject(with: Data(text[start...end].utf8))) as? [String: Any]
  }

  /// Compact JSON text for `{{placeholders}}`.
  nonisolated static func jsonText(_ obj: Any) -> String {
    guard JSONSerialization.isValidJSONObject(obj),
          let d = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes])
    else { return "{}" }
    return String(decoding: d, as: UTF8.self)
  }
}

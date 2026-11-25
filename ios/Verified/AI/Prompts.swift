import Foundation

/// shared/prompts.json (bundled as a resource) — the single source of prompt text for every platform.
nonisolated struct Prompts: Decodable, Sendable {
  struct Prompt: Decodable, Sendable {
    let mode: String
    let system: String
    let user: String

    /// Replaces `{{key}}` placeholders.
    func fill(_ values: [String: String]) -> String {
      values.reduce(user) { $0.replacingOccurrences(of: "{{\($1.key)}}", with: $1.value) }
    }
  }

  let liveCheck: Prompt
  let judge: Prompt
  let skeptic: Prompt
  let scorer: Prompt
  // v3 client prompts (docs/ARCHITECTURE.md v3.10)
  let interviewTurn: Prompt
  let structureIntention: Prompt
  let barPreview: Prompt
  let witnessDraft: Prompt
  let witnessRefine: Prompt

  /// The prompt's JSON `schema`, as compact JSON text (for models without a response schema, e.g. on-device).
  static func schemaJSON(_ name: String) -> String? { schemas[name] }

  private static let schemas: [String: String] = {
    guard let url = Bundle.main.url(forResource: "prompts", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let all = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return [:] }
    var out: [String: String] = [:]
    for (k, v) in all {
      guard let schema = (v as? [String: Any])?["schema"],
            let d = try? JSONSerialization.data(withJSONObject: schema, options: [.sortedKeys]) else { continue }
      out[k] = String(decoding: d, as: UTF8.self)
    }
    return out
  }()

  static let shared: Prompts = {
    guard let url = Bundle.main.url(forResource: "prompts", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let p = try? JSONDecoder().decode(Prompts.self, from: data)
    else { fatalError("prompts.json missing from bundle (shared/prompts.json)") }
    return p
  }()
}

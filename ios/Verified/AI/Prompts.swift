import Foundation

/// shared/prompts.json (bundled as a resource) — the single source of prompt text for every platform.
nonisolated struct Prompts: Decodable, Sendable {
  struct Prompt: Decodable, Sendable {
    let mode: String
    let system: String
    let user: String

    /// Replaces `{{key}}` placeholders.
    func user(_ values: [String: String]) -> String {
      values.reduce(user) { $0.replacingOccurrences(of: "{{\($1.key)}}", with: $1.value) }
    }
  }

  let liveCheck: Prompt
  let judge: Prompt
  let skeptic: Prompt

  static let shared: Prompts = {
    guard let url = Bundle.main.url(forResource: "prompts", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let p = try? JSONDecoder().decode(Prompts.self, from: data)
    else { fatalError("prompts.json missing from bundle (shared/prompts.json)") }
    return p
  }()
}

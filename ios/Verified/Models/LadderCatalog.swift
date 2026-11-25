import Foundation

/// shared/ladder.json (bundled): the verification-ladder modules, their cost and strength (docs/ARCHITECTURE.md v3.6).
/// Clients only show offers and previews; the `runLadderModule` Cloud Function runs a module and recomputes the score.
nonisolated struct LadderCatalog: Decodable, Sendable {
  struct Module: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let title: String
    let blurb: String
    let cost: Int
    let strength: Double
    let available: Bool
    let needs: [String]
  }

  let freeCredits: Int
  let passConfidence: Double
  let modules: [Module]
  /// Human-readable description of each `needs` key.
  let needs: [String: String]

  func module(_ id: String) -> Module? { modules.first { $0.id == id } }

  static let shared: LadderCatalog = {
    guard let url = Bundle.main.url(forResource: "ladder", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let c = try? JSONDecoder().decode(LadderCatalog.self, from: data)
    else { fatalError("ladder.json missing from bundle (shared/ladder.json)") }
    return c
  }()
}

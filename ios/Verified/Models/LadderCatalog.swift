import Foundation
import VerifiedCore

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
    /// v4: claim kinds this module can back (moves only those claims' scores).
    let backs: [String]?
    /// witness_review: only claims whose requirements an answered witness request targeted.
    let backsTargetedOnly: Bool?

    var backKinds: [String] { backs ?? ClaimKind.allCases.map(\.rawValue) }
  }

  /// A credit pack sold through pay.mattrickslauer.com (`buyCredits`); the function re-reads the price.
  struct CreditPack: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let credits: Int
    let priceCents: Int
    let label: String
  }

  let freeCredits: Int
  let creditPacks: [CreditPack]?
  let passConfidence: Double
  let modules: [Module]
  /// Human-readable description of each `needs` key.
  let needs: [String: String]

  func module(_ id: String) -> Module? { modules.first { $0.id == id } }
  var packs: [CreditPack] { creditPacks ?? [] }

  static let shared: LadderCatalog = {
    guard let url = Bundle.main.url(forResource: "ladder", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let c = try? JSONDecoder().decode(LadderCatalog.self, from: data)
    else { fatalError("ladder.json missing from bundle (shared/ladder.json)") }
    return c
  }()
}

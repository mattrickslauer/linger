@preconcurrency import FirebaseFirestore
import Foundation
import Observation

/// Proof-shot thumbnails for My Moments. `moments/{id}` docs carry no hero (only the public `feed/{id}` does), so a
/// tile resolves one like the web Me page: the feed's hero for a sealed Moment, else a proof frame from the chain
/// (the local vault first, then the server chunks). Same pick as the evidence room: the last frame the coach passed,
/// else the last frame.
@MainActor @Observable
final class HeroCache {
  static let shared = HeroCache()

  private(set) var heroes: [String: String] = [:]
  @ObservationIgnored private var tried: Set<String> = []

  func hero(for m: MomentCardData, feed: [MomentCardData]) -> String? {
    m.heroJpegB64 ?? heroes[m.id] ?? feed.first(where: { $0.id == m.id })?.heroJpegB64
  }

  /// The Moment's `displayRotation` for its hero: the `moments/{id}` value, else the feed's (both are server-set).
  func rotation(for m: MomentCardData, feed: [MomentCardData]) -> Int {
    m.displayRotation != 0 ? m.displayRotation : feed.first(where: { $0.id == m.id })?.displayRotation ?? 0
  }

  /// Loads a chain frame once per Moment (per launch); a miss is retried only after `forget`.
  func load(_ m: MomentCardData) async {
    let id = m.id
    guard heroes[id] == nil, !tried.contains(id) else { return }
    tried.insert(id)
    var rows = await Task.detached { Vault.localChunks(id).map { MomentDetailModel.ChunkRow($0) } }.value
    if !rows.contains(where: { $0.frameB64 != nil }) && !m.local {
      if let snap = try? await MomentStore.chunks(id).order(by: "seq").getDocuments() {
        rows = snap.documents.map { MomentDetailModel.ChunkRow($0.data()) }
      }
    }
    let pick = await Task.detached { Self.pick(rows) }.value
    if let pick { heroes[id] = pick } else { tried.remove(id) }
  }

  nonisolated static func pick(_ rows: [MomentDetailModel.ChunkRow]) -> String? {
    var okHero: String?
    var anyHero: String?
    for row in rows.sorted(by: { $0.seq < $1.seq }) {
      guard let b64 = row.frameB64 else { continue }
      anyHero = b64
      let obj = try? JSONSerialization.jsonObject(with: Data(row.payload.utf8)) as? [String: Any]
      if (obj?["check"] as? [String: Any])?["ok"] as? Bool == true { okHero = b64 }
    }
    return okHero ?? anyHero
  }
}

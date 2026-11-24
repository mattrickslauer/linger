@preconcurrency import FirebaseFirestore
import CoreGraphics
import CoreLocation
import Foundation
import Observation
import VerifiedCore

/// Loads `moments/{id}` (live) and its chunks for the detail screen. Readable by the owner,
/// or by anyone once the Moment is sealed/rejected (firestore.rules).
@Observable
final class MomentDetailModel {
  nonisolated struct Frame: Identifiable, @unchecked Sendable {  // CGImage is immutable
    let seq: Int
    let offsetS: Double
    let image: CGImage?
    let check: FrameCheck?
    var id: Int { seq }
  }

  nonisolated struct MotionPoint: Identifiable, Sendable {
    let id: Int
    let s: Double
    let mag: Double
  }

  private(set) var card: MomentCardData
  private(set) var track: [CLLocationCoordinate2D] = []
  private(set) var frames: [Frame] = []
  private(set) var motion: [MotionPoint] = []
  private(set) var chunkCount = 0
  private(set) var chainVerified: Bool?
  private(set) var loading = false
  var error: String?
  @ObservationIgnored private var listener: ListenerRegistration?
  @ObservationIgnored private var loadedStatus: String?

  init(initial: MomentCardData) {
    card = initial
    track = initial.track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
  }

  func start() {
    guard listener == nil else { return }
    listener = MomentStore.moment(card.id).addSnapshotListener(includeMetadataChanges: true) { [weak self] snap, err in
      guard let self else { return }
      if let err { self.error = err.localizedDescription }
      guard let snap, let d = snap.data() else {
        // Moment doc unreadable or missing (e.g. seed data): still try the chunks once.
        if self.loadedStatus == nil {
          self.loadedStatus = self.card.status
          Task { await self.loadChunks() }
        }
        return
      }
      var next = MomentCardData.fromMoment(id: snap.documentID, d, pending: snap.metadata.hasPendingWrites)
      next.heroJpegB64 = self.card.heroJpegB64
      if next.track.isEmpty { next.track = self.card.track }
      self.card = next
      if self.loadedStatus != next.status {
        self.loadedStatus = next.status
        Task { await self.loadChunks() }
      }
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }

  func loadChunks() async {
    loading = true
    defer { loading = false }
    do {
      let snap = try await MomentStore.chunks(card.id).order(by: "seq").getDocuments()
      let rows = snap.documents.map { ChunkRow($0.data()) }
      let startedAt = card.startedAt, momentId = card.id
      let parsed = await Task.detached { Self.parse(momentId: momentId, docs: rows, startedAt: startedAt) }.value
      chunkCount = parsed.chunkCount
      chainVerified = parsed.chainOK
      frames = parsed.frames
      motion = parsed.motion
      if !parsed.track.isEmpty { track = parsed.track }
      if card.heroJpegB64 == nil, let hero = parsed.heroB64 { card.heroJpegB64 = hero }
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: - Parsing (off the main actor)

  /// Sendable copy of a chunk document.
  nonisolated struct ChunkRow: Sendable {
    let seq: Int, t0: Int64, t1: Int64
    let prevHash: String, payload: String, hash: String
    let frameB64: String?, frameT: Int64?

    init(_ d: [String: Any]) {
      seq = d.int("seq") ?? -1
      t0 = d.i64("t0") ?? 0
      t1 = d.i64("t1") ?? 0
      prevHash = d.str("prevHash") ?? ""
      payload = d.str("payload") ?? ""
      hash = d.str("hash") ?? ""
      frameB64 = d.obj("frame")?.str("jpegB64")
      frameT = d.obj("frame")?.i64("t")
    }
  }

  nonisolated struct Parsed: @unchecked Sendable {  // CGImage is immutable
    var chunkCount = 0
    var chainOK = false
    var frames: [Frame] = []
    var motion: [MotionPoint] = []
    var track: [CLLocationCoordinate2D] = []
    var heroB64: String?
  }

  nonisolated static func parse(momentId: String, docs: [ChunkRow], startedAt: Int64) -> Parsed {
    var out = Parsed()
    out.chunkCount = docs.count
    let chunks = docs.map {
      ChainedChunk(seq: $0.seq, t0: $0.t0, t1: $0.t1, prevHash: $0.prevHash, payload: $0.payload, hash: $0.hash)
    }
    out.chainOK = !chunks.isEmpty && Chain.verify(momentId: momentId, chunks: chunks)
    let t0 = startedAt > 0 ? startedAt : (docs.first?.t0 ?? 0)

    var rawMotion: [(Double, Double)] = []
    var okHero: String?
    var anyHero: String?
    for row in docs {
      guard let obj = try? JSONSerialization.jsonObject(with: Data(row.payload.utf8)) as? [String: Any] else { continue }
      for g in (obj["gps"] as? [[Any]]) ?? [] where g.count >= 3 {
        if let lat = (g[1] as? NSNumber)?.doubleValue, let lng = (g[2] as? NSNumber)?.doubleValue {
          out.track.append(CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }
      }
      for m in (obj["motion"] as? [[Any]]) ?? [] where m.count >= 4 {
        let v = m.prefix(4).compactMap { ($0 as? NSNumber)?.doubleValue }
        guard v.count == 4 else { continue }
        rawMotion.append((Double(Int64(v[0]) - t0) / 1000, (v[1] * v[1] + v[2] * v[2] + v[3] * v[3]).squareRoot()))
      }
      if let b64 = row.frameB64 {
        var check: FrameCheck?
        if let c = obj["check"] as? [String: Any] {
          check = FrameCheck(
            ok: c["ok"] as? Bool ?? false, reason: c["reason"] as? String ?? "",
            mode: FrameCheck.Mode(rawValue: c["mode"] as? String ?? "none") ?? FrameCheck.Mode.none,
            label: c["label"] as? String ?? "")
        }
        let ft = row.frameT ?? row.t1
        out.frames.append(Frame(seq: row.seq, offsetS: Double(ft - t0) / 1000,
                                image: ProofFrame.cgImage(fromBase64: b64), check: check))
        anyHero = b64
        if check?.ok == true { okHero = b64 }
      }
    }
    out.heroB64 = okHero ?? anyHero
    // Downsample motion to ≤ 400 points for the chart.
    let step = max(1, rawMotion.count / 400)
    out.motion = stride(from: 0, to: rawMotion.count, by: step).map {
      MotionPoint(id: $0, s: rawMotion[$0].0, mag: rawMotion[$0].1)
    }
    return out
  }
}

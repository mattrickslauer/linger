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
  /// From the chain, for the ladder's `needs` (v3.6): answered witness requests and chained video clips.
  private(set) var witnessAnswers = 0
  private(set) var videos: [ChainVideo] = []
  /// v4: every witness request in the chain with its plan `rid` and whether it was answered (for witness_review).
  private(set) var witnessFacts: [V4.WitnessFact] = []
  private(set) var loading = false
  var error: String?
  @ObservationIgnored private var listener: ListenerRegistration?
  @ObservationIgnored private var loadedStatus: String?

  init(initial: MomentCardData) {
    card = initial
    track = initial.track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
  }

  func start() {
    if card.local {
      // Guest Moment: everything comes from the raw-vault journal on this phone (v3.1).
      if loadedStatus == nil {
        loadedStatus = card.status
        Task { await loadChunks() }
      }
      return
    }
    guard listener == nil else { return }
    listener = MomentStore.moment(card.id).addSnapshotListener(includeMetadataChanges: true) { [weak self] snap, err in
      MainActor.assumeIsolated { self?.apply(snap, err) }
    }
  }

  private func apply(_ snap: DocumentSnapshot?, _ err: Error?) {
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
    if next.videoClips.isEmpty { next.videoClips = self.card.videoClips }  // v4.12: the feed's `video.clips`
    // The feed doc (the card we were opened with) carries `displayRotation` too: keep it if this doc lacks one.
    if next.displayRotation == 0 { next.displayRotation = self.card.displayRotation }
    let rotationChanged = next.displayRotation != self.card.displayRotation
    self.card = next
    if self.loadedStatus != next.status {
      self.loadedStatus = next.status
      Task { await self.loadChunks() }
    } else if rotationChanged {
      // Frames are decoded already turned: redo them with the new rotation.
      Task { await self.loadChunks() }
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
      let rows: [ChunkRow]
      if card.local {
        let id = card.id
        rows = await Task.detached { Vault.localChunks(id).map { ChunkRow($0) } }.value
      } else {
        let snap = try await MomentStore.chunks(card.id).order(by: "seq").getDocuments()
        rows = snap.documents.map { ChunkRow($0.data()) }
      }
      let startedAt = card.startedAt, momentId = card.id, rotation = card.displayRotation
      let parsed = await Task.detached {
        Self.parse(momentId: momentId, docs: rows, startedAt: startedAt, rotation: rotation)
      }.value
      chunkCount = parsed.chunkCount
      chainVerified = parsed.chainOK
      frames = parsed.frames
      motion = parsed.motion
      witnessAnswers = parsed.witnessAnswers
      videos = parsed.videos
      witnessFacts = parsed.witness
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

  /// A `video` event in the chain: the clip itself stays on the phone that recorded it.
  nonisolated struct ChainVideo: Sendable, Equatable {
    let sha256: String
    let name: String
    let bytes: Int64
  }

  nonisolated struct Parsed: @unchecked Sendable {  // CGImage is immutable
    var witnessAnswers = 0
    var videos: [ChainVideo] = []
    var witness: [V4.WitnessFact] = []
    var chunkCount = 0
    var chainOK = false
    var frames: [Frame] = []
    var motion: [MotionPoint] = []
    var track: [CLLocationCoordinate2D] = []
    var heroB64: String?
  }

  /// `rotation`: the Moment's `displayRotation`; proof frames are decoded already turned by it.
  nonisolated static func parse(momentId: String, docs: [ChunkRow], startedAt: Int64, rotation: Int = 0) -> Parsed {
    var out = Parsed()
    out.chunkCount = docs.count
    let chunks = docs.map {
      ChainedChunk(seq: $0.seq, t0: $0.t0, t1: $0.t1, prevHash: $0.prevHash, payload: $0.payload, hash: $0.hash)
    }
    out.chainOK = !chunks.isEmpty && Chain.verify(momentId: momentId, chunks: chunks)
    let t0 = startedAt > 0 ? startedAt : (docs.first?.t0 ?? 0)

    var rawMotion: [(Double, Double)] = []
    var rids: [String: String?] = [:]
    var widOrder: [String] = []
    var answered = Set<String>()
    var okHero: String?
    var anyHero: String?
    for row in docs {
      guard let obj = try? JSONSerialization.jsonObject(with: Data(row.payload.utf8)) as? [String: Any] else { continue }
      for g in (obj["gps"] as? [[Any]]) ?? [] where g.count >= 3 {
        if let lat = (g[1] as? NSNumber)?.doubleValue, let lng = (g[2] as? NSNumber)?.doubleValue {
          out.track.append(CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }
      }
      for e in (obj["events"] as? [[String: Any]]) ?? [] {
        switch e["type"] as? String {
        case "witness":
          if let wid = e["wid"] as? String, rids[wid] == nil {
            widOrder.append(wid)
            let rid = (e["rid"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            rids[wid] = .some(rid)
          }
        case "witness_answer":
          out.witnessAnswers += 1
          if let wid = e["wid"] as? String { answered.insert(wid) }
        case "video":
          if let sha = e["sha256"] as? String {
            out.videos.append(ChainVideo(sha256: sha, name: e["name"] as? String ?? "",
                                         bytes: (e["bytes"] as? NSNumber)?.int64Value ?? 0))
          }
        default: break
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
                                image: ProofFrame.cgImage(fromBase64: b64, rotation: rotation), check: check))
        anyHero = b64
        if check?.ok == true { okHero = b64 }
      }
    }
    out.heroB64 = okHero ?? anyHero
    out.witness = widOrder.map { V4.WitnessFact(wid: $0, rid: rids[$0] ?? nil, answered: answered.contains($0)) }
    // Downsample motion to ≤ 400 points for the chart.
    let step = max(1, rawMotion.count / 400)
    out.motion = stride(from: 0, to: rawMotion.count, by: step).map {
      MotionPoint(id: $0, s: rawMotion[$0].0, mag: rawMotion[$0].1)
    }
    return out
  }
}

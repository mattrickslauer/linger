@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
import Foundation
import Observation
import VerifiedCore

/// Why a Moment's raw data is still on this phone.
nonisolated enum VaultState: Sendable, Equatable { case waiting, repairing, conflict }

/// The phone's own copy of every Moment's raw data, kept until the server provably has all of it
/// (docs/ARCHITECTURE.md "Raw vault"; Android reference: android/.../data/Vault.kt).
///
/// The Firestore cache is not a backup: if the server loses a document, the cache simply records that it is gone.
/// So `MomentStore` writes every Moment to an app-private journal first (atomic, file protection), then to Firestore:
///   Application Support/vault/{momentId}/moment.json          moment fields as created, then merged with submit fields
///   Application Support/vault/{momentId}/chunks/{000000}.json seq, t0, t1, prevHash, payload, hash, frame
/// `verifyAll` reads each submitted Moment back FROM THE SERVER (never the cache), re-uploads anything missing (the
/// whole Moment if the server lost it), and deletes the local copy only when `VaultCheck.compare` finds no problem.
/// Offline, an error, or any mismatch: the local copy stays.
@Observable
final class Vault {
  static let shared = Vault()

  /// Moments still held on this phone, with why. Empty = everything is safely on the server.
  private(set) var held: [String: VaultState] = [:]
  @ObservationIgnored private var running = false
  @ObservationIgnored private var again = false

  private init() {
    try? FileManager.default.createDirectory(at: VaultIO.root, withIntermediateDirectories: true)
    held = Dictionary(uniqueKeysWithValues: VaultIO.ids().map { ($0, VaultState.waiting) })
  }

  // MARK: - Journal (called by MomentStore before each Firestore write; throws rather than silently skipping)

  func saveMoment(_ id: String, _ fields: [String: Any]) throws {
    try VaultIO.write(VaultIO.momentFile(id), VaultIO.plain(fields))
    held[id] = .waiting
  }

  func updateMoment(_ id: String, _ fields: [String: Any]) throws {
    let url = VaultIO.momentFile(id)
    var m: [String: Any] = FileManager.default.fileExists(atPath: url.path) ? try VaultIO.readObject(url) : [:]
    for (k, v) in VaultIO.plain(fields) { m[k] = v }
    try VaultIO.write(url, m)
    held[id] = held[id] ?? .waiting
  }

  func saveChunk(_ id: String, seq: Int, _ chunk: [String: Any]) throws {
    try VaultIO.write(VaultIO.chunkFile(id, seq: seq), VaultIO.plain(chunk))
  }

  // MARK: - Verification

  /// Checks every held Moment against the server. Safe to call often: one pass at a time
  /// (a call during a pass schedules one more pass instead of running concurrently).
  func verifyAll() async {
    if running {
      again = true
      return
    }
    running = true
    defer { running = false }
    repeat {
      again = false
      guard let uid = Auth.auth().currentUser?.uid else { return }
      for id in VaultIO.ids() {
        let result = await Task.detached { () -> VaultState? in
          do {
            return try await VaultIO.verify(id, uid: uid) { s in await Vault.shared.mark(id, s) }
          } catch {
            print("[Verified] vault verify \(id): \(error.localizedDescription)")
            return .waiting  // offline or any error: keep
          }
        }.value
        if let result {
          if result == .conflict || held[id] == nil { held[id] = result }
        } else if (try? FileManager.default.removeItem(at: VaultIO.dir(id))) != nil {
          held[id] = nil
          print("[Verified] vault: verified on server, local copy removed: \(id)")
        }
      }
    } while again
  }

  private func mark(_ id: String, _ s: VaultState) { held[id] = s }
}

/// File and Firestore work for the vault, off the main actor. Every Firestore argument is built fresh from
/// Sendable journal bytes at the call site, so nothing non-Sendable crosses an isolation boundary.
nonisolated enum VaultIO {
  nonisolated enum Failure: LocalizedError {
    case notJSON(String)
    var errorDescription: String? {
      switch self { case .notJSON(let what): "Vault: \(what) is not valid JSON" }
    }
  }

  static let root: URL = URL.applicationSupportDirectory.appendingPathComponent("vault", isDirectory: true)
  static func dir(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }
  static func momentFile(_ id: String) -> URL { dir(id).appendingPathComponent("moment.json") }
  static func chunksDir(_ id: String) -> URL { dir(id).appendingPathComponent("chunks", isDirectory: true) }
  static func chunkFile(_ id: String, seq: Int) -> URL { chunksDir(id).appendingPathComponent(Chain.docId(seq) + ".json") }

  /// Moment ids with a journal.
  static func ids() -> [String] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
    return names.filter { FileManager.default.fileExists(atPath: momentFile($0).path) }.sorted()
  }

  static func write(_ url: URL, _ obj: [String: Any]) throws {
    guard JSONSerialization.isValidJSONObject(obj) else { throw Failure.notJSON(url.lastPathComponent) }
    let data = try JSONSerialization.data(withJSONObject: obj)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  static func readObject(_ url: URL) throws -> [String: Any] { try object(Data(contentsOf: url), url.lastPathComponent) }

  static func object(_ data: Data, _ what: String) throws -> [String: Any] {
    guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.notJSON(what) }
    return obj
  }

  /// Exactly what goes to Firestore, minus FieldValue sentinels (server timestamps are not data we own).
  static func plain(_ m: [String: Any]) -> [String: Any] {
    var out: [String: Any] = [:]
    for (k, v) in m where !(v is FieldValue) { out[k] = plainValue(v) }
    return out
  }

  private static func plainValue(_ v: Any) -> Any {
    if let m = v as? [String: Any] { return plain(m) }
    if let a = v as? [Any] { return a.map { plainValue($0) } }
    if v is FieldValue { return NSNull() }
    return v
  }

  static let submitFields = ["status", "endedAt", "chunkCount", "headHash", "summary", "onDevice", "submittedAtServer"]

  /// The moment as first created, for when the server lost it: `recording`, nothing judged or sealed yet.
  static func recreateFields(_ momentJSON: Data) throws -> [String: Any] {
    var m = try object(momentJSON, "moment.json")
    for k in submitFields { m[k] = nil }
    m["status"] = "recording"
    m["seal"] = NSNull()
    m["judge"] = NSNull()
    m["skeptic"] = NSNull()
    m["createdAtServer"] = FieldValue.serverTimestamp()
    return m
  }

  static func submitUpdate(_ momentJSON: Data) throws -> [String: Any] {
    let m = try object(momentJSON, "moment.json")
    var out: [String: Any] = [:]
    for k in submitFields { out[k] = k == "submittedAtServer" ? FieldValue.serverTimestamp() : (m[k] ?? NSNull()) }
    return out
  }

  static func checkChunk(_ d: [String: Any]) -> VaultCheck.Chunk {
    VaultCheck.Chunk(
      seq: (d["seq"] as? NSNumber)?.intValue ?? -1, hash: d["hash"] as? String ?? "",
      payload: d["payload"] as? String ?? "", frameB64: (d["frame"] as? [String: Any])?["jpegB64"] as? String)
  }

  /// nil only when the server provably has everything (the local copy may go); otherwise the state to keep it in.
  /// Throws when the server can't be reached (the caller keeps the copy).
  static func verify(_ id: String, uid: String, mark: @Sendable (VaultState) async -> Void) async throws -> VaultState? {
    let momentJSON = try Data(contentsOf: momentFile(id))
    let local = try object(momentJSON, "moment.json")
    guard local["ownerUid"] as? String == uid else { return .waiting }  // another account's Moment: keep, don't touch
    guard local["status"] as? String == "submitted" else { return .waiting }  // still recording
    let names = ((try? FileManager.default.contentsOfDirectory(atPath: chunksDir(id).path)) ?? [])
      .filter { $0.hasSuffix(".json") }.sorted()
    let chunkJSON = try names.map { try Data(contentsOf: chunksDir(id).appendingPathComponent($0)) }
    let localChunks = try zip(names, chunkJSON).map { try checkChunk(object($1, $0)) }
    let chunkCount = (local["chunkCount"] as? NSNumber)?.intValue ?? -1
    if localChunks.count != chunkCount {
      print("[Verified] vault \(id): journal has \(localChunks.count) chunks, moment says \(chunkCount); keeping")
      return .conflict
    }

    // A fresh reference per call: nothing non-Sendable is reused across Firestore's async calls.
    func ref() -> DocumentReference { Firestore.firestore().collection("moments").document(id) }
    func chunks() -> CollectionReference { ref().collection("chunks") }

    let server = try await ref().getDocument(source: .server)
    var serverStatus = server.data()?["status"] as? String
    if !server.exists {
      await mark(.repairing)
      print("[Verified] vault \(id): missing on server, re-creating from the journal")
      try await ref().setData(recreateFields(momentJSON))
      serverStatus = try await ref().getDocument(source: .server).data()?["status"] as? String
    }

    let serverChunks = try await chunks().getDocuments(source: .server)
    let present = Set(serverChunks.documents.map { checkChunk($0.data()).seq })
    let missing = zip(localChunks, chunkJSON).filter { !present.contains($0.0.seq) }
    if !missing.isEmpty {
      await mark(.repairing)
      print("[Verified] vault \(id): uploading \(missing.count) missing chunk(s)")
      // Chunks may be created while recording, or after submit when seq < chunkCount (firestore.rules).
      // Only missing seqs are written: chunks are append-only, an existing one is never overwritten.
      for (c, json) in missing {
        try await chunks().document(Chain.docId(c.seq)).setData(object(json, "chunk \(c.seq)"))
      }
    }
    if serverStatus == "recording" {
      try await ref().updateData(submitUpdate(momentJSON))
    }

    // Read everything back from the server and compare with the journal, byte for byte where it matters.
    let m = try await ref().getDocument(source: .server).data() ?? [:]
    let back = try await chunks().getDocuments(source: .server).documents.map { checkChunk($0.data()) }
    let problems = VaultCheck.compare(
      localHead: local["headHash"] as? String, localCount: chunkCount,
      serverHead: m["headHash"] as? String, serverCount: (m["chunkCount"] as? NSNumber)?.intValue,
      serverStatus: m["status"] as? String, local: localChunks, server: back)
    if !problems.isEmpty {
      print("[Verified] vault \(id): server copy differs from the journal, keeping local copy: \(problems.prefix(5))")
      return .conflict
    }
    return nil
  }
}

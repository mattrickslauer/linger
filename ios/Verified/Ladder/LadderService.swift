@preconcurrency import FirebaseFunctions
import Foundation
import Observation
import VerifiedCore

/// The v3.7 callables (`us-central1`, sign-in required). Credits and ladder results are written only by Cloud
/// Functions; the client never writes a score. Free demo credits only (no purchase).
nonisolated enum LadderService {
  struct Credits: Sendable, Equatable {
    var balance: Int
    var granted: Int
    var spent: Int
    var justGranted: Bool
  }

  struct RunResult: Sendable, Equatable {
    var module: String
    var passed: Bool
    var confidence: Double
    var before: Double
    var after: Double
    var score: Double
    var bar: Double
    var verified: Bool
    var status: String
    var cost: Int
    var balance: Int
    var reasons: [String]
    var measured: [Measured]
    /// v4 Moments: which claims the module moved (`claims: ModuleClaimOutcome[]`) and the new count backed.
    var claims: [LadderEntry.ClaimOutcome] = []
    var claimsBacked: Int?
  }

  struct Measured: Sendable, Equatable, Hashable { var metric: String; var value: Double; var unit: String }

  /// A callable error, keyed on `details.reason` (contract table v3.7).
  struct Failure: LocalizedError, Sendable {
    let code: String
    let reason: String
    let message: String
    var errorDescription: String? { Self.friendly(reason) ?? message }

    static func friendly(_ reason: String) -> String? {
      switch reason {
      case "sign_in": "Sign in to run verification modules."
      case "insufficient_credits": "Not enough credits for this module."
      case "already_run": "This module already ran on this Moment."
      case "not_sealed_yet": "The seal hasn't finished yet. Try again in a moment."
      case "not_eligible": "This Moment failed an integrity check, so the ladder can't raise it."
      case "unavailable_module": "This module is coming soon."
      case "needs_frames": "Needs at least one proof frame."
      case "needs_gps": "Needs GPS in the recording."
      case "needs_witness_answered": "Needs at least one answered witness request."
      case "needs_quantities": "Needs a count or measure claim."
      case "no_claims_backed": "This module can't back any of this Moment's claims."
      case "needs_video", "clip_missing": "Upload the chained video clip first."
      case "clip_hash_mismatch": "The uploaded clip doesn't match the hash in the chain. No credits were spent."
      case "model_failed": "The model couldn't finish. Your credits were refunded."
      case "not_owner": "Only the owner can run modules."
      case "moment_missing": "This Moment isn't on the server yet."
      case "in_progress": "This module is still running. Try again in a moment."
      case "bad_request", "bad_module": "The app sent a request the server didn't accept. Update the app and try again."
      default: nil
      }
    }
  }

  private static var functions: Functions { Functions.functions(region: "us-central1") }

  static func getCredits() async throws -> Credits {
    let d = try await call("getCredits", [:])
    return Credits(balance: d.int("balance") ?? 0, granted: d.int("granted") ?? 0, spent: d.int("spent") ?? 0,
                   justGranted: d.bool("justGranted") ?? false)
  }

  static func run(momentId: String, module: String, requestId: String, clipSha: String? = nil) async throws -> RunResult {
    var req: [String: Any] = ["momentId": momentId, "module": module, "requestId": requestId]
    if let clipSha { req["clipSha"] = clipSha }
    let d = try await call("runLadderModule", req)
    return RunResult(
      module: d.str("module") ?? module, passed: d.bool("passed") ?? false, confidence: d.dbl("confidence") ?? 0,
      before: d.dbl("before") ?? 0, after: d.dbl("after") ?? 0, score: d.dbl("score") ?? 0, bar: d.dbl("bar") ?? 0,
      verified: d.bool("verified") ?? false, status: d.str("status") ?? "", cost: d.int("cost") ?? 0,
      balance: d.int("balance") ?? 0, reasons: d["reasons"] as? [String] ?? [],
      measured: (d["measured"] as? [[String: Any]] ?? []).compactMap { m in
        guard let metric = m.str("metric"), let v = m.dbl("value") else { return nil }
        return Measured(metric: metric, value: v, unit: m.str("unit") ?? "")
      },
      claims: (d["claims"] as? [[String: Any]] ?? []).compactMap(LadderEntry.ClaimOutcome.init),
      claimsBacked: d.int("claimsBacked"))
  }

  /// Completion-based call so no non-Sendable `[String: Any]` crosses an isolation boundary: the request goes in
  /// as JSON text and the reply comes back as JSON bytes.
  private static func call(_ name: String, _ data: [String: Any]) async throws -> [String: Any] {
    let body = (try? JSONSerialization.data(withJSONObject: data)) ?? Data("{}".utf8)
    let reply: Data = try await withCheckedThrowingContinuation { c in
      let payload = (try? JSONSerialization.jsonObject(with: body)) ?? [:]
      functions.httpsCallable(name).call(payload) { result, error in
        if let error = error as NSError? {
          if error.domain == FunctionsErrorDomain {
            let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
            let code = FunctionsErrorCode(rawValue: error.code).map { "\($0)" } ?? "\(error.code)"
            c.resume(throwing: Failure(code: code, reason: details?.str("reason") ?? "", message: error.localizedDescription))
          } else {
            c.resume(throwing: Failure(code: "network", reason: "", message: error.localizedDescription))
          }
          return
        }
        let obj = result?.data ?? [:]
        let out = JSONSerialization.isValidJSONObject(obj) ? (try? JSONSerialization.data(withJSONObject: obj)) : nil
        c.resume(returning: out ?? Data("{}".utf8))
      }
    }
    return (try? JSONSerialization.jsonObject(with: reply)) as? [String: Any] ?? [:]
  }
}

/// The signed-in user's free demo credits (`getCredits`), refreshed on sign-in and after every module run.
@Observable
final class CreditsModel {
  private(set) var credits: LadderService.Credits?
  private(set) var loading = false
  var error: String?

  func refresh() async {
    loading = true
    defer { loading = false }
    do {
      credits = try await LadderService.getCredits()
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  func set(balance: Int) {
    if var c = credits {
      c.spent += max(0, c.balance - balance)
      c.balance = balance
      c.justGranted = false
      credits = c
    } else {
      credits = .init(balance: balance, granted: 0, spent: 0, justGranted: false)
    }
  }

  func clear() { credits = nil; error = nil }
}

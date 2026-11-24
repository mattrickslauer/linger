@preconcurrency import AuthenticationServices
import CryptoKit
import FirebaseCore
import Foundation
import Network
import UIKit

/// Sign-in goes through accounts.mattrickslauer.com (the shared Mattricks login), as the public client `verified-app`,
/// exactly like Android (android/.../auth/Auth.kt):
///   1. an ASWebAuthenticationSession opens the accounts login: OIDC authorization code + PKCE
///   2. the redirect lands on a loopback port served by this app (RFC 8252 §7.3; it is the redirect registered for
///      `verified-app`). That page sends the browser to com.mattrickslauer.verified://signed-in, which closes the sheet
///   3. the code is traded for an access token
///   4. accounts swaps that for a Firebase custom token: POST {issuer}/v1/firebase/{projectId}/token
///   5. the caller does signInWithCustomToken. The Firebase uid is the accounts user id.
enum AccountsSignIn {
  static let issuer = "https://accounts.mattrickslauer.com/t/mattricks"
  static let clientID = "verified-app"
  static let port: UInt16 = 47231
  static let redirect = "http://127.0.0.1:47231/auth"
  static let returnScheme = "com.mattrickslauer.verified"

  struct Tokens { let firebaseToken: String; let email: String? }

  nonisolated enum Failure: LocalizedError {
    case cancelled
    case declined
    case message(String)
    var errorDescription: String? {
      switch self {
      case .cancelled: "Sign-in was cancelled."
      case .declined: "Sign-in was declined."
      case .message(let m): m
      }
    }
  }

  static func run(anchor: ASPresentationAnchor) async throws -> Tokens {
    let verifier = randomB64(48)
    let challenge = b64(Data(SHA256.hash(data: Data(verifier.utf8))))
    let state = randomB64(16)
    var c = URLComponents(string: "\(issuer)/auth")!
    c.queryItems = [
      .init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: redirect),
      .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email"),
      .init(name: "state", value: state), .init(name: "code_challenge", value: challenge),
      .init(name: "code_challenge_method", value: "S256"),
    ]

    let catcher = try LoopbackCatcher(port: port, returnURL: "\(returnScheme)://signed-in")
    defer { catcher.stop() }
    let provider = AnchorProvider(anchor)
    let session = ASWebAuthenticationSession(url: c.url!, callback: .customScheme(returnScheme)) { _, error in
      // Sheet closed. If the code already arrived this is a no-op; otherwise the user backed out.
      if error != nil { catcher.cancel() }
    }
    session.presentationContextProvider = provider
    guard session.start() else { throw Failure.message("Couldn't open the sign-in page.") }
    let (code, gotState): (String?, String?)
    do {
      (code, gotState) = try await catcher.waitForRedirect()
    } catch {
      session.cancel()
      throw error
    }
    session.cancel()  // normally already closed by the page's redirect to the app scheme
    withExtendedLifetime(provider) {}

    guard gotState == state else { throw Failure.cancelled }
    guard let code else { throw Failure.declined }
    let tokens = try await post("\(issuer)/token", form: [
      "client_id": clientID, "grant_type": "authorization_code", "code": code,
      "redirect_uri": redirect, "code_verifier": verifier,
    ])
    guard let access = tokens["access_token"] as? String else { throw Failure.message("No access token from accounts.") }
    guard let project = FirebaseApp.app()?.options.projectID else { throw Failure.message("Firebase project id missing.") }
    let bridge = try await post("\(issuer)/v1/firebase/\(project)/token", bearer: access)
    guard let token = bridge["token"] as? String else { throw Failure.message("No Firebase token from accounts.") }
    return Tokens(firebaseToken: token, email: bridge["email"] as? String)
  }

  private static func post(_ url: String, form: [String: String]? = nil, bearer: String? = nil) async throws -> [String: Any] {
    var req = URLRequest(url: URL(string: url)!, timeoutInterval: 15)
    req.httpMethod = "POST"
    if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
    if let form {
      req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      var allowed = CharacterSet.alphanumerics
      allowed.insert(charactersIn: "-._~")
      req.httpBody = form.map { k, v in
        "\(k.addingPercentEncoding(withAllowedCharacters: allowed)!)=\(v.addingPercentEncoding(withAllowedCharacters: allowed)!)"
      }.joined(separator: "&").data(using: .utf8)
    }
    let (data, resp) = try await URLSession.shared.data(for: req)
    let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let msg = (json["message"] as? String) ?? (json["error_description"] as? String) ?? "Sign-in failed (HTTP \(status))"
      throw Failure.message(msg)
    }
    return json
  }

  private static func randomB64(_ n: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: n)
    _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
    return b64(Data(bytes))
  }

  private static func b64(_ d: Data) -> String {
    d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

private final class AnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
  let anchor: ASPresentationAnchor
  init(_ anchor: ASPresentationAnchor) { self.anchor = anchor }
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor }
}

/// Serves one request on 127.0.0.1:<port>: reads ?code=&state= and answers with a page that returns to the app.
nonisolated private final class LoopbackCatcher: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "verified.accounts.loopback")
  private let returnURL: String
  private var continuation: CheckedContinuation<(String?, String?), Error>?
  private var result: Result<(String?, String?), Error>?

  init(port: UInt16, returnURL: String) throws {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!)
    params.allowLocalEndpointReuse = true
    listener = try NWListener(using: params)
    self.returnURL = returnURL
    listener.newConnectionHandler = { [weak self] conn in self?.handle(conn) }
    listener.stateUpdateHandler = { [weak self] state in
      if case .failed(let e) = state { self?.finish(.failure(AccountsSignIn.Failure.message("Sign-in listener failed: \(e)"))) }
    }
    listener.start(queue: queue)
  }

  func waitForRedirect() async throws -> (String?, String?) {
    try await withCheckedThrowingContinuation { c in
      queue.async {
        if let r = self.result { c.resume(with: r) } else { self.continuation = c }
      }
    }
  }

  func cancel() { queue.async { self.finish(.failure(AccountsSignIn.Failure.cancelled)) } }
  func stop() { listener.cancel() }

  /// Runs on `queue`.
  private func finish(_ r: Result<(String?, String?), Error>) {
    guard result == nil else { return }
    result = r
    continuation?.resume(with: r)
    continuation = nil
  }

  private func handle(_ conn: NWConnection) {
    conn.start(queue: queue)
    conn.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, _, _ in
      guard let self else { conn.cancel(); return }
      let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      let firstLine = request.components(separatedBy: "\r\n").first ?? ""
      let path = firstLine.split(separator: " ").dropFirst().first.map(String.init) ?? ""
      guard path.hasPrefix("/auth") else {  // favicon or a stray request
        conn.send(content: Data("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8),
                  completion: .contentProcessed { _ in conn.cancel() })
        return
      }
      let items = URLComponents(string: "http://127.0.0.1\(path)")?.queryItems ?? []
      let body = """
        <!doctype html><meta name=viewport content="width=device-width">
        <body style="font-family:-apple-system,sans-serif;background:#14121a;color:#eee;text-align:center;padding:48px 16px">
        <h2>Signed in</h2><p><a href="\(self.returnURL)" style="color:#6fd6a0">Back to Verified</a></p>
        <script>location.replace("\(self.returnURL)")</script>
        """
      let bytes = Data(body.utf8)
      let head = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(bytes.count)\r\nConnection: close\r\n\r\n"
      conn.send(content: Data(head.utf8) + bytes, completion: .contentProcessed { _ in conn.cancel() })
      self.finish(.success((items.first { $0.name == "code" }?.value, items.first { $0.name == "state" }?.value)))
    }
  }
}

@preconcurrency import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
@preconcurrency import GoogleSignIn
import Observation
import UIKit

nonisolated struct SignedInUser: Equatable, Sendable {
  let uid: String
  let name: String
  let photoURL: String?
}

@Observable
final class AuthModel {
  private(set) var user: SignedInUser?
  private(set) var ready = false
  var busy = false
  var error: String?
  @ObservationIgnored private var handle: AuthStateDidChangeListenerHandle?

  init() {
    handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
      let info = user.map {
        SignedInUser(uid: $0.uid, name: $0.displayName ?? $0.email ?? "Anonymous",
                     photoURL: $0.photoURL?.absoluteString)
      }
      Task { @MainActor in
        self?.user = info
        self?.ready = true
      }
    }
  }

  /// Google sign-in -> Firebase Auth credential.
  func signInWithGoogle() async {
    error = nil
    guard let clientID = FirebaseApp.app()?.options.clientID else {
      error = "Google sign-in is not enabled yet. Enable it in the Firebase console and re-download GoogleService-Info.plist."
      return
    }
    guard let root = Self.rootViewController() else { return }
    busy = true
    defer { busy = false }
    do {
      GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
      let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: root)
      guard let idToken = result.user.idToken?.tokenString else {
        error = "Google did not return an ID token."
        return
      }
      let credential = GoogleAuthProvider.credential(
        withIDToken: idToken, accessToken: result.user.accessToken.tokenString)
      let authResult = try await Auth.auth().signIn(with: credential)
      writeUserDoc(authResult.user)
    } catch {
      if (error as NSError).code != GIDSignInError.Code.canceled.rawValue {
        self.error = error.localizedDescription
      }
    }
  }

  /// Emulator only: the Auth emulator accepts an unsigned JSON "Google ID token",
  /// so the full Google flow can be exercised without a real Google account.
  func signInWithEmulator(name: String) async {
    error = nil
    busy = true
    defer { busy = false }
    let slug = name.lowercased().filter { $0.isLetter || $0.isNumber }
    let claims: [String: Any] = [
      "sub": "emu-\(slug.isEmpty ? "tester" : slug)", "email": "\(slug.isEmpty ? "tester" : slug)@example.com",
      "email_verified": true, "name": name.isEmpty ? "Test Angler" : name,
    ]
    let json = (try? JSONSerialization.data(withJSONObject: claims)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    do {
      let cred = GoogleAuthProvider.credential(withIDToken: json, accessToken: "")
      let result = try await Auth.auth().signIn(with: cred)
      writeUserDoc(result.user)
    } catch {
      do {
        let result = try await Auth.auth().signInAnonymously()
        writeUserDoc(result.user)
      } catch { self.error = error.localizedDescription }
    }
  }

  func signOut() {
    GIDSignIn.sharedInstance.signOut()
    try? Auth.auth().signOut()
  }

  private func writeUserDoc(_ user: User) {
    Firestore.firestore().collection("users").document(user.uid).setData([
      "displayName": user.displayName ?? "Anonymous",
      "photoURL": user.photoURL?.absoluteString ?? NSNull(),
      "createdAtServer": FieldValue.serverTimestamp(),
    ], merge: true) { _ in }
  }

  private static func rootViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    var vc = scene?.keyWindow?.rootViewController
    while let presented = vc?.presentedViewController { vc = presented }
    return vc
  }
}

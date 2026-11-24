@preconcurrency import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
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

  /// accounts.mattrickslauer.com login (see AccountsSignIn) -> Firebase custom token.
  func signIn() async {
    error = nil
    guard let anchor = Self.keyWindow() else { return }
    busy = true
    defer { busy = false }
    do {
      let tokens = try await AccountsSignIn.run(anchor: anchor)
      let result = try await Auth.auth().signIn(withCustomToken: tokens.firebaseToken)
      let fbUser = result.user
      if (fbUser.displayName ?? "").isEmpty {
        let local = (tokens.email ?? "").split(separator: "@").first.map(String.init) ?? ""
        let name = local.replacingOccurrences(of: ".", with: " ").capitalized
        let change = fbUser.createProfileChangeRequest()
        change.displayName = name.isEmpty ? "Verified user" : name
        try await change.commitChanges()
        user = SignedInUser(uid: fbUser.uid, name: change.displayName ?? "Verified user",
                            photoURL: fbUser.photoURL?.absoluteString)
      }
      writeUserDoc(fbUser)
    } catch AccountsSignIn.Failure.cancelled {
      // closed the sheet: not an error
    } catch {
      self.error = error.localizedDescription
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
    try? Auth.auth().signOut()
  }

  private func writeUserDoc(_ user: User) {
    Firestore.firestore().collection("users").document(user.uid).setData([
      "displayName": user.displayName ?? "Anonymous",
      "photoURL": user.photoURL?.absoluteString ?? NSNull(),
      "createdAtServer": FieldValue.serverTimestamp(),
    ], merge: true) { _ in }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.keyWindow
  }
}

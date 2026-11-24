import Foundation

#if canImport(CryptoKit)
  import CryptoKit
#else
  import Crypto
#endif

/// Lowercase hex SHA-256 of the UTF-8 bytes of `string` (contract: docs/ARCHITECTURE.md).
public func sha256Hex(_ string: String) -> String {
  sha256Hex(Data(string.utf8))
}

/// Lowercase hex SHA-256 of raw bytes.
public func sha256Hex(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

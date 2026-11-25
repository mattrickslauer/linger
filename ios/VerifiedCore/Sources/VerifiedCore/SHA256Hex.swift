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

/// Lowercase hex SHA-256 of a file's bytes, read in 1 MB blocks (video clips can be large),
/// plus the byte count. Throws if the file cannot be read.
public func sha256HexOfFile(at url: URL) throws -> (sha256: String, bytes: Int64) {
  let handle = try FileHandle(forReadingFrom: url)
  defer { try? handle.close() }
  var hasher = SHA256()
  var bytes: Int64 = 0
  while let block = try handle.read(upToCount: 1 << 20), !block.isEmpty {
    hasher.update(data: block)
    bytes += Int64(block.count)
  }
  return (hasher.finalize().map { String(format: "%02x", $0) }.joined(), bytes)
}

// swift-tools-version: 6.0
// VerifiedCore: platform-neutral chain hashing, deterministic payload JSON and summary math.
// Builds on Apple platforms (CryptoKit) and on Linux (swift-crypto) so it can be tested anywhere.
import PackageDescription

let package = Package(
  name: "VerifiedCore",
  platforms: [.iOS("26.0"), .macOS("15.0")],
  products: [.library(name: "VerifiedCore", targets: ["VerifiedCore"])],
  dependencies: [
    .package(url: "https://github.com/apple/swift-crypto.git", "3.0.0" ..< "6.0.0"),
  ],
  targets: [
    .target(
      name: "VerifiedCore",
      dependencies: [
        .product(name: "Crypto", package: "swift-crypto", condition: .when(platforms: [.linux])),
      ]
    ),
    .testTarget(name: "VerifiedCoreTests", dependencies: ["VerifiedCore"]),
  ]
)

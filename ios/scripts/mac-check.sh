#!/usr/bin/env bash
# Checks everything that can be checked on a Mac WITHOUT Xcode.app (Command Line Tools only):
#   1. swift test for ios/VerifiedCore (hash chain, payload JSON, summary vs shared/test-vectors.json)
#   2. builds + runs a harness with the app's Firebase-free sources (ProofFrame: ImageIO resize/JPEG/sha,
#      Apple Vision labels, live-coach heuristic + JSON parsing) against the macOS SDK.
# Usage (on the Mac):            ios/scripts/mac-check.sh
#        (from Linux via ssh):   ios/scripts/mac-check.sh --remote studio
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ios="$(cd "$here/.." && pwd)"
repo="$(cd "$ios/.." && pwd)"

if [[ "${1:-}" == "--remote" ]]; then
  host="${2:?host}"
  rsync -az --delete --exclude .build --exclude .mac-check --exclude '*.xcodeproj' --exclude GoogleService-Info.plist "$ios/" "$host:verified-build/ios/"
  rsync -az --delete "$repo/shared/" "$host:verified-build/shared/"
  exec ssh "$host" 'bash ~/verified-build/ios/scripts/mac-check.sh'
fi

echo "== 1/2 VerifiedCore: swift test"
(cd "$ios/VerifiedCore" && swift test 2>&1 | grep -E "passed|failed|error" | tail -5)

echo "== 2/2 app sources harness (macOS SDK)"
work="$ios/.mac-check"
rm -rf "$work"
mkdir -p "$work/Sources/Harness"
cat > "$work/Package.swift" <<EOF
// swift-tools-version: 6.0
import PackageDescription
let package = Package(
  name: "Harness",
  platforms: [.macOS("15.0")],
  dependencies: [.package(path: "$ios/VerifiedCore")],
  targets: [.executableTarget(name: "Harness", dependencies: [.product(name: "VerifiedCore", package: "VerifiedCore")])]
)
EOF
# Swift 6.0 (CLT) predates `nonisolated` on type declarations (Swift 6.1+); strip it for this check only.
for f in Record/ProofFrame.swift AI/VisionLabeler.swift AI/CoachHeuristic.swift; do
  sed -E 's/^nonisolated (struct|enum|final class)/\1/' "$ios/Verified/$f" > "$work/Sources/Harness/$(basename "$f")"
done
cp "$here/mac-check/main.swift" "$work/Sources/Harness/main.swift"
(cd "$work" && swift build -c release 2>&1 | grep -E "error|warning: .*(Sendable|isolat)|Compiling|Build complete" | grep -v "^\[" | tail -20)
"$work/.build/release/Harness" "$repo/shared/sample-moments/frames"

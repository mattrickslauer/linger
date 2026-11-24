#!/usr/bin/env bash
# Builds the iOS app on a Mac over ssh, copies the result back here, then clears the Mac for the next build.
#
#   ios/scripts/remote-build.sh                # unsigned Release build on host "air"
#   ios/scripts/remote-build.sh --host studio  # another Mac (needs Xcode + xcodegen)
#   ios/scripts/remote-build.sh --purge        # also delete the cached Swift packages (~1.3 GB) afterwards
#
# Output: build/ios/<timestamp>-<git sha>/{Verified.app, build.log}   (build/ is git-ignored)
# On the Mac: source in ~/Code/verified, Swift packages cached in ~/Code/verified/SourcePackages
# (kept between builds unless --purge); DerivedData is deleted after every build, pass or fail.
set -euo pipefail

host=air
purge=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host="$2"; shift 2 ;;
    --purge) purge=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd)"
ios="$(cd "$here/.." && pwd)"
repo="$(cd "$ios/.." && pwd)"
# config/ is git-ignored and lives in the main checkout, not in worktrees.
main_repo="$(cd "$(git -C "$repo" rev-parse --git-common-dir)/.." && pwd)"
plist="$main_repo/config/GoogleService-Info.plist"
[[ -f "$plist" ]] || { echo "missing $plist" >&2; exit 1; }

sha="$(git -C "$repo" rev-parse --short HEAD)$(git -C "$repo" diff --quiet HEAD -- ios shared || echo -dirty)"
out="$main_repo/build/ios/$(date +%Y%m%d-%H%M%S)-$sha"
mkdir -p "$out"

remote=Code/verified
echo "==> Syncing ios/ and shared/ to $host:$remote"
ssh -o BatchMode=yes "$host" "mkdir -p $remote"
rsync -az --delete --exclude .build --exclude '*.xcodeproj' "$ios" "$repo/shared" "$host:$remote/"
rsync -az "$plist" "$host:$remote/ios/Verified/GoogleService-Info.plist"

echo "==> Building on $host (unsigned Release, generic iOS device)"
set +e
ssh -o BatchMode=yes "$host" bash -s <<EOF
set -uo pipefail
eval "\$(/opt/homebrew/bin/brew shellenv)"
cd ~/$remote/ios && xcodegen -q
xcodebuild -project Verified.xcodeproj -scheme Verified -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ~/$remote/DerivedData -clonedSourcePackagesDirPath ~/$remote/SourcePackages \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build > ~/$remote/build.log 2>&1
EOF
status=$?
set -e

echo "==> Copying results to $out"
rsync -az "$host:$remote/build.log" "$out/" || true
if [[ $status -eq 0 ]]; then
  rsync -az "$host:$remote/DerivedData/Build/Products/Release-iphoneos/Verified.app" "$out/"
fi

echo "==> Clearing $host for the next build"
clean="rm -rf ~/$remote/DerivedData ~/$remote/build.log ~/$remote/ios/Verified.xcodeproj"
[[ $purge -eq 1 ]] && clean="$clean ~/$remote/SourcePackages"
ssh -o BatchMode=yes "$host" "$clean; df -g /System/Volumes/Data | awk 'NR==2{print \$4\" GB free on $host\"}'"

grep -E "error:" "$out/build.log" | sort -u | head -40 || true
if [[ $status -eq 0 ]]; then
  echo "BUILD SUCCEEDED -> $out/Verified.app"
else
  echo "BUILD FAILED (exit $status) -> $out/build.log" >&2
  exit "$status"
fi

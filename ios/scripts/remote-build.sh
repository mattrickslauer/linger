#!/usr/bin/env bash
# Builds the iOS app on a Mac over ssh, copies the result back here, then clears the Mac for the next build.
#
#   ios/scripts/remote-build.sh                # unsigned Release build on host "air" (compile check)
#   ios/scripts/remote-build.sh --upload       # signed archive, uploaded to App Store Connect -> TestFlight
#   ios/scripts/remote-build.sh --host studio  # another Mac (needs Xcode + xcodegen)
#   ios/scripts/remote-build.sh --purge        # also delete the cached Swift packages (~1.3 GB) afterwards
#
# --upload needs (env vars, or a git-ignored config/asc.env with these lines):
#   ASC_TEAM_ID=XXXXXXXXXX        Apple Developer Team ID (developer.apple.com/account > Membership)
#   ASC_KEY_ID=XXXXXXXXXX         App Store Connect API key id (App Manager role)
#   ASC_ISSUER_ID=uuid            shown above the key list at appstoreconnect.apple.com/access/integrations/api
#   ASC_KEY_PATH=~/Documents/AuthCodes/AuthKey_<ASC_KEY_ID>.p8   (default)
# Signing needs the Mac's login keychain unlocked; over ssh it is locked, so --upload asks for the Mac's
# login password (read here, sent over ssh stdin, never stored).
#
# Output: build/ios/<timestamp>-<git sha>/{Verified.app or Verified.xcarchive, build.log} in the main checkout
# (build/ is git-ignored). On the Mac: source in ~/Code/verified, Swift packages cached in
# ~/Code/verified/SourcePackages (kept unless --purge); DerivedData, archive and key are deleted after every run.
set -euo pipefail

host=air
purge=0
upload=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host="$2"; shift 2 ;;
    --purge) purge=1; shift ;;
    --upload) upload=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd)"
ios="$(cd "$here/.." && pwd)"
repo="$(cd "$ios/.." && pwd)"
# config/ and build/ live in the main checkout (worktrees are temporary).
main_repo="$(cd "$(git -C "$repo" rev-parse --git-common-dir)/.." && pwd)"
plist="$main_repo/config/GoogleService-Info.plist"
[[ -f "$plist" ]] || { echo "missing $plist" >&2; exit 1; }

if [[ $upload -eq 1 ]]; then
  [[ -f "$main_repo/config/asc.env" ]] && source "$main_repo/config/asc.env"
  : "${ASC_TEAM_ID:?set ASC_TEAM_ID}" "${ASC_KEY_ID:?set ASC_KEY_ID}" "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
  ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/Documents/AuthCodes/AuthKey_${ASC_KEY_ID}.p8}"
  [[ -f "$ASC_KEY_PATH" ]] || { echo "missing $ASC_KEY_PATH" >&2; exit 1; }
  read -rsp "Login password for $host (unlocks its keychain for signing): " mac_pw; echo
fi

sha="$(git -C "$repo" rev-parse --short HEAD)$(git -C "$repo" diff --quiet HEAD -- ios shared || echo -dirty)"
out="$main_repo/build/ios/$(date +%Y%m%d-%H%M%S)-$sha"
mkdir -p "$out"
build_number="$(date -u +%Y%m%d%H%M)"  # always increases; App Store Connect needs a new one per upload

remote=Code/verified
echo "==> Syncing ios/ and shared/ to $host:$remote"
ssh -o BatchMode=yes "$host" "mkdir -p $remote"
rsync -az --delete --exclude .build --exclude '*.xcodeproj' "$ios" "$repo/shared" "$host:$remote/"
rsync -az "$plist" "$host:$remote/ios/Verified/GoogleService-Info.plist"

common="-project Verified.xcodeproj -scheme Verified -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath ~/$remote/DerivedData -clonedSourcePackagesDirPath ~/$remote/SourcePackages"

set +e
if [[ $upload -eq 0 ]]; then
  echo "==> Building on $host (unsigned Release, generic iOS device)"
  ssh -o BatchMode=yes "$host" bash -s <<EOF
set -uo pipefail
eval "\$(/opt/homebrew/bin/brew shellenv)"
cd ~/$remote/ios && xcodegen -q
xcodebuild $common CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build > ~/$remote/build.log 2>&1
EOF
  status=$?
else
  echo "==> Archiving on $host (signed, build $build_number) and uploading to App Store Connect"
  ssh -o BatchMode=yes "$host" "mkdir -p ~/$remote/keys && chmod 700 ~/$remote/keys"
  rsync -a --chmod=F600 "$ASC_KEY_PATH" "$host:$remote/keys/AuthKey_${ASC_KEY_ID}.p8"
  # First stdin line is the keychain password; the rest is the script.
  { printf '%s\n' "$mac_pw"; cat <<EOF
set -uo pipefail
eval "\$(/opt/homebrew/bin/brew shellenv)"
security unlock-keychain -p "\$pw" ~/Library/Keychains/login.keychain-db || { echo "keychain unlock failed" >&2; exit 3; }
cd ~/$remote/ios && xcodegen -q
auth="-allowProvisioningUpdates -authenticationKeyPath \$HOME/$remote/keys/AuthKey_${ASC_KEY_ID}.p8 \
  -authenticationKeyID ${ASC_KEY_ID} -authenticationKeyIssuerID ${ASC_ISSUER_ID}"
cat > ~/$remote/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${ASC_TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
{
  xcodebuild $common \$auth DEVELOPMENT_TEAM=${ASC_TEAM_ID} CURRENT_PROJECT_VERSION=${build_number} \
    -archivePath ~/$remote/Verified.xcarchive archive &&
  xcodebuild -exportArchive \$auth -archivePath ~/$remote/Verified.xcarchive \
    -exportOptionsPlist ~/$remote/ExportOptions.plist -exportPath ~/$remote/export
} > ~/$remote/build.log 2>&1
EOF
  } | ssh -o BatchMode=yes "$host" 'IFS= read -r pw; export pw; bash -s'
  status=$?
fi
set -e

echo "==> Copying results to $out"
rsync -az "$host:$remote/build.log" "$out/" || true
if [[ $status -eq 0 ]]; then
  if [[ $upload -eq 1 ]]; then
    rsync -az "$host:$remote/Verified.xcarchive" "$out/"  # keep dSYMs for crash symbolication
  else
    rsync -az "$host:$remote/DerivedData/Build/Products/Release-iphoneos/Verified.app" "$out/"
  fi
fi

echo "==> Clearing $host for the next build"
clean="rm -rf ~/$remote/DerivedData ~/$remote/build.log ~/$remote/ios/Verified.xcodeproj ~/$remote/Verified.xcarchive ~/$remote/export ~/$remote/ExportOptions.plist ~/$remote/keys"
[[ $purge -eq 1 ]] && clean="$clean ~/$remote/SourcePackages"
ssh -o BatchMode=yes "$host" "$clean; df -g /System/Volumes/Data | awk 'NR==2{print \$4\" GB free on $host\"}'"

grep -E "error:|Upload succeeded|EXPORT SUCCEEDED|ARCHIVE SUCCEEDED" "$out/build.log" | sort -u | head -40 || true
if [[ $status -ne 0 ]]; then
  echo "FAILED (exit $status) -> $out/build.log" >&2
  exit "$status"
elif [[ $upload -eq 1 ]]; then
  echo "UPLOADED build $build_number -> App Store Connect (TestFlight shows it after processing, ~5-15 min). Archive: $out"
else
  echo "BUILD SUCCEEDED -> $out/Verified.app"
fi

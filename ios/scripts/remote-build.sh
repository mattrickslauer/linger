#!/usr/bin/env bash
# Builds the iOS app on a Mac over ssh, copies the result back here, then clears the Mac for the next build.
#
#   ios/scripts/remote-build.sh                # unsigned Release build on host "air" (compile check)
#   ios/scripts/remote-build.sh --upload       # signed archive, uploaded to App Store Connect -> TestFlight
#   ios/scripts/remote-build.sh --host studio  # another Mac (needs Xcode + xcodegen)
#   ios/scripts/remote-build.sh --purge        # also delete the cached Swift packages (~1.3 GB) afterwards
#
# --upload needs (env vars, or config/asc.env in the main checkout; config/ is never committed):
#   ASC_TEAM_ID=XXXXXXXXXX        Apple Developer Team ID
#   ASC_KEY_ID=XXXXXXXXXX         App Store Connect API key id (App Manager or Admin role)
#   ASC_ISSUER_ID=uuid            shown above the key list at appstoreconnect.apple.com/access/integrations/api
#   ASC_KEY_PATH=~/Documents/AuthCodes/AuthKey_<ASC_KEY_ID>.p8   (default)
# Signing is passwordless: asc_signing.py (run here) makes/reuses an Apple Distribution certificate and an
# App Store profile through the API; on the Mac they go into a throwaway keychain with a random password,
# which is deleted (and the keychain search list restored) when the run ends. No devices or Mac password needed.
#
# Output: build/ios/<timestamp>-<git sha>/{Verified.app or Verified.xcarchive, build.log} in the main checkout
# (build/ is ignored). On the Mac: source in ~/Code/verified, Swift packages cached in
# ~/Code/verified/SourcePackages (kept unless --purge); everything else is deleted after every run.
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

sha="$(git -C "$repo" rev-parse --short HEAD)$(git -C "$repo" diff --quiet HEAD -- ios shared || echo -dirty)"
out="$main_repo/build/ios/$(date +%Y%m%d-%H%M%S)-$sha"
mkdir -p "$out"
build_number="$(date -u +%Y%m%d%H%M)"  # always increases; App Store Connect needs a new one per upload
remote=Code/verified

if [[ $upload -eq 1 ]]; then
  [[ -f "$main_repo/config/asc.env" ]] && source "$main_repo/config/asc.env"
  : "${ASC_TEAM_ID:?set ASC_TEAM_ID}" "${ASC_KEY_ID:?set ASC_KEY_ID}" "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
  export ASC_KEY_ID ASC_ISSUER_ID
  export ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/Documents/AuthCodes/AuthKey_${ASC_KEY_ID}.p8}"
  [[ -f "$ASC_KEY_PATH" ]] || { echo "missing $ASC_KEY_PATH" >&2; exit 1; }
  sign="$(mktemp -d)"
  trap 'rm -rf "$sign"' EXIT
  echo "==> Distribution certificate + App Store profile (App Store Connect API)"
  python3 "$here/asc_signing.py" "$sign" > "$sign/profile.json"
  profile_uuid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["profile_uuid"])' "$sign/profile.json")"
  cp "$ASC_KEY_PATH" "$sign/AuthKey_${ASC_KEY_ID}.p8"
fi

echo "==> Syncing ios/ and shared/ to $host:$remote"
ssh -o BatchMode=yes "$host" "mkdir -p $remote"
rsync -az --delete --exclude .build --exclude '*.xcodeproj' "$ios" "$repo/shared" "$host:$remote/"
rsync -az "$plist" "$host:$remote/ios/Verified/GoogleService-Info.plist"

# Google sign-in URL scheme comes from the plist (absent until Google sign-in has an iOS OAuth client).
reversed_client_id="$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb")).get("REVERSED_CLIENT_ID",""))' "$plist")"
[[ -n "$reversed_client_id" ]] || echo "note: $plist has no REVERSED_CLIENT_ID, so Google sign-in will not work in this build"
gid="${reversed_client_id:+GOOGLE_REVERSED_CLIENT_ID=$reversed_client_id}"

common="$gid -project Verified.xcodeproj -scheme Verified -configuration Release -destination 'generic/platform=iOS' \
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
  echo "==> Archiving on $host (signed for App Store, build $build_number) and uploading"
  ssh -o BatchMode=yes "$host" "rm -rf ~/$remote/keys && mkdir -p ~/$remote/keys && chmod 700 ~/$remote/keys"
  rsync -a --chmod=F600 "$sign/dist.p12" "$sign/dist.p12.pass" "$sign/profile.mobileprovision" \
    "$sign/AuthKey_${ASC_KEY_ID}.p8" "$host:$remote/keys/"
  ssh -o BatchMode=yes "$host" bash -s <<EOF
set -uo pipefail
eval "\$(/opt/homebrew/bin/brew shellenv)"
keys=~/$remote/keys
kc=\$keys/build.keychain-db
kcpw=\$(openssl rand -hex 24)
orig_list=\$(security list-keychains -d user | tr -d '"' | xargs)
profiles=("\$HOME/Library/MobileDevice/Provisioning Profiles" "\$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles")
cleanup() {
  security list-keychains -d user -s \$orig_list
  security delete-keychain "\$kc" 2>/dev/null
  for d in "\${profiles[@]}"; do rm -f "\$d/$profile_uuid.mobileprovision"; done
  rm -rf "\$keys"
}
trap cleanup EXIT
{
  # Throwaway keychain: random password, never locks during the run, codesign allowed without prompts.
  security create-keychain -p "\$kcpw" "\$kc" &&
  security set-keychain-settings "\$kc" &&
  security unlock-keychain -p "\$kcpw" "\$kc" &&
  curl -fsSL -o "\$keys/AppleWWDRCAG3.cer" https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer &&
  security import "\$keys/AppleWWDRCAG3.cer" -k "\$kc" -T /usr/bin/codesign &&
  security import "\$keys/dist.p12" -k "\$kc" -P "\$(cat "\$keys/dist.p12.pass")" -T /usr/bin/codesign -T /usr/bin/security &&
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "\$kcpw" "\$kc" > /dev/null &&
  security list-keychains -d user -s "\$kc" \$orig_list &&
  for d in "\${profiles[@]}"; do mkdir -p "\$d" && cp "\$keys/profile.mobileprovision" "\$d/$profile_uuid.mobileprovision"; done &&
  echo "signing identities:" && security find-identity -v -p codesigning "\$kc" &&
  cat > ~/$remote/ExportOptions.plist <<PLIST &&
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>${ASC_TEAM_ID:-}</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>com.mattrickslauer.verified</key><string>Verified App Store</string></dict>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
  cd ~/$remote/ios && xcodegen -q &&
  xcodebuild $common CURRENT_PROJECT_VERSION=$build_number OTHER_CODE_SIGN_FLAGS="--keychain \$kc" \
    -archivePath ~/$remote/Verified.xcarchive archive &&
  xcodebuild -exportArchive -archivePath ~/$remote/Verified.xcarchive \
    -exportOptionsPlist ~/$remote/ExportOptions.plist -exportPath ~/$remote/export &&
  echo "exported: \$(ls ~/$remote/export/*.ipa)" &&
  # Upload with the API key directly (xcodebuild's own upload wants an Apple ID signed into Xcode).
  API_PRIVATE_KEYS_DIR="\$keys" xcrun altool --upload-app -t ios -f ~/$remote/export/Verified.ipa \
    --apiKey ${ASC_KEY_ID:-} --apiIssuer ${ASC_ISSUER_ID:-} --output-format normal
} > ~/$remote/build.log 2>&1
EOF
  status=$?
fi
set -e

echo "==> Copying results to $out"
rsync -az "$host:$remote/build.log" "$out/" 2>/dev/null || echo "(no build.log: it failed before building)"
if [[ $status -eq 0 ]]; then
  if [[ $upload -eq 1 ]]; then
    rsync -az "$host:$remote/Verified.xcarchive" "$host:$remote/export/Verified.ipa" "$out/"  # dSYMs + the uploaded ipa
  else
    rsync -az "$host:$remote/DerivedData/Build/Products/Release-iphoneos/Verified.app" "$out/"
  fi
fi

echo "==> Clearing $host for the next build"
clean="rm -rf ~/$remote/DerivedData ~/$remote/build.log ~/$remote/ios/Verified.xcodeproj ~/$remote/Verified.xcarchive ~/$remote/export ~/$remote/ExportOptions.plist ~/$remote/keys"
[[ $purge -eq 1 ]] && clean="$clean ~/$remote/SourcePackages"
ssh -o BatchMode=yes "$host" "$clean; df -g /System/Volumes/Data | awk 'NR==2{print \$4\" GB free on $host\"}'"

[[ -f "$out/build.log" ]] && { grep -E "error:|ERROR|UPLOAD SUCCEEDED|No errors uploading|EXPORT SUCCEEDED|ARCHIVE SUCCEEDED" "$out/build.log" | sort -u | head -40 || true; }
if [[ $status -ne 0 ]]; then
  echo "FAILED (exit $status) -> $out/build.log" >&2
  exit "$status"
elif [[ $upload -eq 1 ]]; then
  echo "UPLOADED build $build_number -> App Store Connect (TestFlight shows it after processing, ~5-15 min). Archive: $out"
else
  echo "BUILD SUCCEEDED -> $out/Verified.app"
fi

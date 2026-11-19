#!/usr/bin/env bash
# Preconfigure Google Chrome on Linux for Gemini Nano, then launch it.
#
#   ./infra/chrome-nano.sh
#
# - Sets the three chrome://flags Linger needs (in Chrome's "Local State"), backing it up first:
#     Prompt API for Gemini Nano with multimodal input = Enabled
#     Override software rendering list (ignore-gpu-blocklist) = Enabled
#       (needed when on-device-internals says "GPU blocked", e.g. Intel iGPU on Mesa)
# - Launches Chrome with TMPDIR on your home disk. On distros where /tmp is a small RAM disk,
#   the multi-GB model download can fail there silently.
# Refuses to run while Chrome is open, because Chrome rewrites Local State on exit.

set -euo pipefail
profile="${CHROME_PROFILE_DIR:-$HOME/.config/google-chrome}"
state="$profile/Local State"
tmp="$HOME/.cache/chrome-tmp"

command -v google-chrome >/dev/null || { echo "error: Google Chrome is not installed (Chromium and Brave do not ship Gemini Nano)" >&2; exit 1; }
if pgrep -f '/opt/google/chrome/chrome' >/dev/null; then
  echo "error: quit Google Chrome completely first (all windows), then re-run." >&2
  exit 1
fi
[ -f "$state" ] || { echo "error: $state not found; open Chrome once first." >&2; exit 1; }

cp "$state" "$state.bak-$(date +%Y%m%d-%H%M%S)"
python3 -I - "$state" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path, encoding="utf-8"))
flags = d.setdefault("browser", {}).setdefault("enabled_labs_experiments", [])
# Internal names as Chrome 158 stores them (chrome://flags labels differ). Chrome silently drops
# names it doesn't know, so check chrome://flags after launch.
# optimization-guide-on-device-model (BypassPerfRequirement) no longer exists in 158; on an
# Intel iGPU, ignore-gpu-blocklist alone moved the performance class from "GPU blocked" to 5.
want = {
    "prompt-api-multimodal-input": "prompt-api-multimodal-input@1",
    "ignore-gpu-blocklist": "ignore-gpu-blocklist",
}
old = {"prompt-api-for-gemini-nano-multimodal-input", "optimization-guide-on-device-model"}
flags[:] = [f for f in flags if f.split("@")[0] not in want and f.split("@")[0] not in old]
flags.extend(want.values())
json.dump(d, open(path, "w", encoding="utf-8"))
print("flags now:", ", ".join(flags))
PY

mkdir -p "$tmp"
echo "Launching Chrome with TMPDIR=$tmp"
echo "Then: chrome://flags (check the three flags), chrome://on-device-internals (performance class),"
echo "      chrome://components → Optimization Guide On Device Model → Check for update."
TMPDIR="$tmp" nohup google-chrome "chrome://on-device-internals" >/dev/null 2>&1 &

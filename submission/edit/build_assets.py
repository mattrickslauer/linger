"""Extract every frame the compositor needs into WORK_DIR.

usage: python3 build_assets.py SUBMISSION_DIR WORK_DIR

SUBMISSION_DIR holds the raw footage (not in git, too big):
  VerifiedRollA.mov     founder speech, A-roll
  ScreenRecording.mp4   iPhone screen recording (VFR, 1206x2622)
  AndroidFeed.mp4       Android (Poco) feed scroll, adb screenrecord
  ChromeFeed.webm       live web app in Chrome, Playwright capture

All clips are written as 30 fps JPEG sequences, already sped up, so the page
just picks frame N for clip-local time N/30.
"""
import json
import os
import shutil
import subprocess
import sys

import qrcode
import qrcode.image.svg

FPS = 30
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from timeline import ROLL_IN, ROLL_OUT, CLIPS, STILLS  # noqa: E402

SUB, WORK = sys.argv[1], sys.argv[2]
FORCE = "--force" in sys.argv


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def seq(name):
    d = os.path.join(WORK, "frames", name)
    if os.path.isdir(d) and os.listdir(d) and not FORCE:
        return None
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    return d


# A-roll -------------------------------------------------------------------
d = seq("ra")
if d:
    ff("-ss", str(ROLL_IN), "-t", str(ROLL_OUT - ROLL_IN), "-i", f"{SUB}/VerifiedRollA.mov",
       "-vf", f"fps={FPS}", "-q:v", "3", f"{d}/%05d.jpg")

# Clips: list of (src_start, src_end, speed) segments, concatenated ----------
meta = {}
for name, c in CLIPS.items():
    d = seq(name)
    if d:
        n = 1
        for (s, e, sp) in c["segs"]:
            tmp = os.path.join(WORK, "frames", "_tmp")
            shutil.rmtree(tmp, ignore_errors=True)
            os.makedirs(tmp)
            scale = c.get("scale", "-2:1400")
            vf = f"setpts=(PTS-STARTPTS)/{sp},fps={FPS},scale={scale}:flags=lanczos"
            if c.get("crop"):
                vf = f"crop={c['crop']}," + vf
            ff("-ss", str(s), "-t", str(e - s), "-i", f"{SUB}/{c['src']}", "-an", "-vf", vf,
               "-q:v", "3", f"{tmp}/%05d.jpg")
            for f in sorted(os.listdir(tmp)):
                os.rename(os.path.join(tmp, f), os.path.join(d, f"{n:05d}.jpg"))
                n += 1
            shutil.rmtree(tmp)
    meta[name] = len(os.listdir(os.path.join(WORK, "frames", name)))
    print(name, meta[name], "frames")

# Stills -------------------------------------------------------------------
os.makedirs(os.path.join(WORK, "stills"), exist_ok=True)
for name, (src, t, scale) in STILLS.items():
    out = os.path.join(WORK, "stills", f"{name}.jpg")
    if FORCE or not os.path.exists(out):
        ff("-ss", str(t), "-i", f"{SUB}/{src}", "-frames:v", "1", "-vf", f"scale={scale}:flags=lanczos",
           "-q:v", "2", out)

# QR codes -----------------------------------------------------------------
for name, url in {"web": "https://verified-99e74.web.app",
                  "testflight": "https://testflight.apple.com/join/8SGF1Pqr"}.items():
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathFillImage, border=0,
                      error_correction=qrcode.constants.ERROR_CORRECT_M)
    img.save(os.path.join(WORK, f"qr-{name}.svg"))

# Page + assets -------------------------------------------------------------
for f in ("index.html", "words.json"):
    if os.path.exists(os.path.join(HERE, f)):
        shutil.copy(os.path.join(HERE, f), WORK)
shutil.copytree(os.path.join(HERE, "assets"), os.path.join(WORK, "assets"), dirs_exist_ok=True)
data = {
    "words": json.load(open(os.path.join(HERE, "words.json"))),
    "clipn": meta,
    "ran": len(os.listdir(os.path.join(WORK, "frames", "ra"))),
}
with open(os.path.join(WORK, "data.js"), "w") as f:
    f.write("window.DATA = " + json.dumps(data) + ";\n")
print("ok")

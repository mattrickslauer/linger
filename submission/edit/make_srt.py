"""Write YouTube captions (.srt) in output-video time from words.json.

usage: python3 make_srt.py OUT.srt
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import INTRO, ROLL_IN  # noqa: E402

words = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "words.json")))
chunks, cur = [], []
for w in words:
    if cur and w["s"] - cur[-1]["e"] > .5:
        chunks.append(cur); cur = []
    cur.append(w)
    if re.search(r"[.?!]$", w["w"]) or (w["w"].endswith(",") and len(cur) >= 4) or len(cur) >= 8:
        chunks.append(cur); cur = []
if cur:
    chunks.append(cur)


def ts(r):
    t = max(0.0, r - ROLL_IN + INTRO)
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


with open(sys.argv[1], "w") as f:
    for i, c in enumerate(chunks):
        end = min(c[-1]["e"] + .4, chunks[i + 1][0]["s"] if i + 1 < len(chunks) else 1e9)
        f.write(f"{i + 1}\n{ts(c[0]['s'])} --> {ts(end)}\n{' '.join(w['w'] for w in c)}\n\n")
print(len(chunks), "captions")

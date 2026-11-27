"""Turn the raw whisper word list into caption words (A-roll time), fixing mis-hearings.

usage: python3 fix_words.py RAW_WORDS.json OUT_WORDS.json
"""
import json
import sys

ROLL_OUT = 148.1  # whisper hallucinates an outro over the trailing silence; drop it

raw = json.load(open(sys.argv[1]))
out = []
i = 0
while i < len(raw):
    w = dict(raw[i])
    nxt = raw[i + 1]["w"] if i + 1 < len(raw) else ""
    if w["s"] >= ROLL_OUT:
        break
    # glue whisper's split hyphen words: "on -device", "push -ups", "AI -generated", "SHA -256"
    if nxt.startswith("-") and len(nxt) > 1:
        w["w"] = w["w"] + nxt
        w["e"] = raw[i + 1]["e"]
        i += 1
    if w["w"] == "on-app.":
        w["w"] = "one app."
    if w["w"] == "Chain":
        w["w"] = "Chained"
    if w["w"] == "ticks":
        w["w"] = "takes"
    if w["w"] == "verified." and w["s"] > 140:
        w["w"] = "Verified."
    if w["w"] in ("verified.", "verified") and w["s"] < 5:
        w["w"] = "Verified."
    w["w"] = w["w"].replace("pushups", "push-ups")
    if w["w"] == "function" and out and out[-1]["w"] == "cloud":
        out[-1]["w"] = "Cloud"
        w["w"] = "Function"
    if w["w"] == "logic":
        w["w"] = "Logic"
    if w["w"] == "Mattricks" or w["w"].startswith("Matrix"):
        w["w"] = "Mattricks"
    out.append(w)
    i += 1

# "But paying buys Never a score." -> whisper dropped "scrutiny,"
for k, w in enumerate(out):
    if w["w"] == "buys" and k + 1 < len(out) and out[k + 1]["w"] == "Never":
        nw = out[k + 1]
        out.insert(k + 1, {"w": "scrutiny,", "s": w["e"] + 0.05, "e": nw["s"] - 0.05})
        nw["w"] = "never"
        break

json.dump(out, open(sys.argv[2], "w"), indent=0)
print(" ".join(w["w"] for w in out))

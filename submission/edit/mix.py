"""Build the soundtrack: cleaned-up voice + synthesized UI sound effects + a quiet pad.

usage: python3 mix.py SUBMISSION_DIR WORK_DIR   ->  WORK/mix.wav (48 kHz stereo)
Needs WORK/cues.json (written by render.py --all).
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import INTRO, ROLL_IN, ROLL_OUT, OUTRO  # noqa: E402

SUB, WORK = sys.argv[1], sys.argv[2]
SR = 48000
TOTAL = INTRO + (ROLL_OUT - ROLL_IN) + OUTRO
N = int(TOTAL * SR)
rng = np.random.default_rng(7)

# ---- voice: high-pass, gentle denoise, compression, loudness to -16 LUFS ----
voice_wav = os.path.join(WORK, "voice.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(ROLL_IN), "-t", str(ROLL_OUT - ROLL_IN),
                "-i", f"{SUB}/VerifiedRollA.mov", "-vn",
                "-af", "highpass=f=80,afftdn=nr=10:nf=-45,acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=3,"
                       "loudnorm=I=-16:TP=-1.5:LRA=9,afade=t=out:st=%.2f:d=0.4" % (ROLL_OUT - ROLL_IN - 0.45),
                "-ar", str(SR), "-ac", "1", voice_wav], check=True)
with wave.open(voice_wav) as w:
    v = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
voice = np.zeros(N, np.float32)
o = int(INTRO * SR)
voice[o:o + len(v)] = v[: N - o]


# ---- sfx -----------------------------------------------------------------
def env(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)


def lp(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def whoosh():
    n = int(.55 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # sweep a moving-average "filter" from dull to bright to dull
    out = np.zeros(n)
    for k, (a, b) in enumerate([(0, .18), (.18, .36), (.36, .55)]):
        seg = slice(int(a * SR), int(b * SR))
        out[seg] = lp(noise, [24, 6, 18][k])[seg]
    shape = np.sin(np.pi * np.clip(t / .55, 0, 1)) ** 2
    return out * shape * .5


def pop():
    n = int(.09 * SR)
    t = np.arange(n) / SR
    f = 900 * np.exp(-t * 14)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, .002, .025) * .5


def tick():
    n = int(.04 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 2400 * t) * env(n, .0005, .008) * .45


def stamp():
    n = int(.4 * SR)
    t = np.arange(n) / SR
    thump = np.sin(2 * np.pi * 62 * t * (1 + .6 * np.exp(-t * 30))) * env(n, .002, .12)
    crack = lp(rng.standard_normal(n), 3) * env(n, .001, .03) * .6
    return (thump + crack) * .9


def ding():
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in
            [(1318.5, .5, 3.0), (1975.5, .3, 4.0), (2637, .15, 6.0), (659.25, .25, 2.5)])
    return x * env(n, .003, 10) * .5


SFX = {"whoosh": (whoosh(), .35), "pop": (pop(), .16), "tick": (tick(), .14), "stamp": (stamp(), .55), "ding": (ding(), .3)}
fx = np.zeros(N, np.float32)
cues = sorted(json.load(open(os.path.join(WORK, "cues.json"))), key=lambda c: c["t"])
last = {}
for c in cues:
    k, t = c["kind"], c["t"]
    if t < 0 or t >= TOTAL or t - last.get(k, -9) < .15:
        continue
    last[k] = t
    s, g = SFX[k]
    i = int(t * SR)
    j = min(N, i + len(s))
    fx[i:j] += s[: j - i] * g

# ---- pad: slow Am-F-C-G, soft saw through a low-pass, sidechained under the voice ----
chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 261.63, 329.63], [196.0, 246.94, 293.66]]
bar = 4.0
t = np.arange(N) / SR
pad = np.zeros(N, np.float32)
for ci in range(int(TOTAL / bar) + 1):
    a, b = int(ci * bar * SR), min(N, int((ci + 1) * bar * SR + .8 * SR))
    if a >= N:
        break
    tt = t[a:b] - ci * bar
    e = np.minimum(1, tt / 1.2) * np.minimum(1, np.maximum(0, (bar + .8 - tt) / .8))
    for f in chords[ci % 4]:
        for det in (-.6, .6):
            ph = 2 * np.pi * (f + det) * tt
            pad[a:b] += (np.sin(ph) + .3 * np.sin(2 * ph) + .12 * np.sin(3 * ph)) * e * .05
    pad[a:b] += np.sin(2 * np.pi * chords[ci % 4][0] / 2 * tt) * e * .06
pad = lp(pad, 40).astype(np.float32)
vol = np.abs(voice)
vol = np.convolve(vol, np.ones(SR // 5) / (SR // 5), mode="same")
duck = 1 - .55 * np.clip(vol / .05, 0, 1)
fade = np.clip(t / 2.0, 0, 1) * np.clip((TOTAL - t) / 2.5, 0, 1)
pad = pad * duck * fade * .28

mix = voice + fx + pad
peak = np.max(np.abs(mix))
if peak > .97:
    mix *= .97 / peak
st = np.stack([mix, mix], 1)
out = (np.clip(st, -1, 1) * 32767).astype(np.int16)
with wave.open(os.path.join(WORK, "mix.wav"), "w") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())
print("mix", TOTAL, "s, peak", peak)

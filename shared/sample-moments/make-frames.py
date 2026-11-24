#!/usr/bin/env python3
"""Draws the synthetic proof frames for the demo seed (no photos, no copyright).
Run: python3 shared/sample-moments/make-frames.py   (needs Pillow)
Writes 640x480 JPEGs, quality 60, into shared/sample-moments/frames/.
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

W, H = 640, 480
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frames")
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(img, y0, y1, c0, c1):
    d = ImageDraw.Draw(img)
    for y in range(y0, y1):
        d.line([(0, y), (W, y)], fill=lerp(c0, c1, (y - y0) / max(1, y1 - y0)))


def noise(img, amount=10, seed=0):
    rnd = random.Random(seed)
    px = img.load()
    for _ in range(W * H // 6):
        x, y = rnd.randrange(W), rnd.randrange(H)
        r, g, b = px[x, y]
        n = rnd.randint(-amount, amount)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img


def save(img, name):
    img.save(os.path.join(OUT, name), "JPEG", quality=60, optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, name)), "bytes")


# ───────────────────────── lake + bass

def lake(seed, horizon=210):
    img = Image.new("RGB", (W, H))
    vgrad(img, 0, horizon, (150, 190, 225), (220, 230, 235))
    vgrad(img, horizon, H, (70, 110, 120), (30, 60, 70))
    d = ImageDraw.Draw(img)
    rnd = random.Random(seed)
    # tree line + far hills
    d.polygon([(0, horizon)] + [(x, horizon - 40 - 25 * math.sin(x / 90 + seed)) for x in range(0, W + 20, 20)] + [(W, horizon)], fill=(110, 130, 120))
    for x in range(-10, W + 10, 14):
        h = rnd.randint(18, 42)
        d.polygon([(x, horizon), (x + 8, horizon - h), (x + 16, horizon)], fill=(40, 75, 50))
    # ripples
    for _ in range(70):
        y = rnd.randint(horizon + 8, H - 5)
        x = rnd.randint(0, W)
        L = rnd.randint(20, 80)
        d.line([(x, y), (x + L, y)], fill=(120, 160, 170), width=1)
    return img


def bass(d, cx, cy, s=1.0, angle_up=False):
    # body
    body = (70, 105, 45)
    belly = (205, 210, 160)
    d.ellipse([cx - 120 * s, cy - 42 * s, cx + 120 * s, cy + 42 * s], fill=body)
    d.ellipse([cx - 100 * s, cy + 0 * s, cx + 100 * s, cy + 40 * s], fill=belly)
    # lateral stripe blotches
    for i in range(7):
        x = cx - 90 * s + i * 28 * s
        d.ellipse([x, cy - 6 * s, x + 22 * s, cy + 8 * s], fill=(35, 55, 25))
    # tail
    d.polygon([(cx + 110 * s, cy), (cx + 175 * s, cy - 45 * s), (cx + 160 * s, cy), (cx + 175 * s, cy + 45 * s)], fill=(60, 90, 40))
    # dorsal fin
    d.polygon([(cx - 40 * s, cy - 38 * s), (cx + 10 * s, cy - 75 * s), (cx + 60 * s, cy - 38 * s)], fill=(55, 85, 35))
    # big mouth + eye
    d.pieslice([cx - 135 * s, cy - 20 * s, cx - 85 * s, cy + 25 * s], 140, 230, fill=(30, 30, 20))
    d.ellipse([cx - 92 * s, cy - 20 * s, cx - 74 * s, cy - 2 * s], fill=(230, 190, 40))
    d.ellipse([cx - 87 * s, cy - 15 * s, cx - 79 * s, cy - 7 * s], fill=(10, 10, 10))


def hand(d, cx, cy):
    skin = (214, 168, 130)
    d.rounded_rectangle([cx - 160, cy - 30, cx - 95, cy + 60], 22, fill=skin)
    for i in range(4):
        d.rounded_rectangle([cx - 170 + i * 6, cy - 28 + i * 20, cx - 110, cy - 10 + i * 20], 9, fill=(200, 150, 115))
    d.rectangle([cx - 170, cy + 55, cx - 90, H], fill=(60, 80, 120))  # sleeve


def bass_frames():
    img = lake(1)
    d = ImageDraw.Draw(img)
    d.line([(40, H), (470, 120)], fill=(40, 30, 20), width=6)  # rod
    d.line([(470, 120), (520, 330)], fill=(235, 235, 235), width=1)  # line
    d.ellipse([510, 322, 530, 338], outline=(240, 240, 240), width=2)
    save(noise(img, 8, 11), "bass-1-cast.jpg")

    img = lake(2, horizon=150)
    d = ImageDraw.Draw(img)
    bass(d, 330, 330, 0.9)
    # splash
    rnd = random.Random(5)
    for _ in range(60):
        x, y = 330 + rnd.randint(-200, 200), 300 + rnd.randint(-60, 60)
        d.ellipse([x, y, x + 5, y + 5], fill=(230, 240, 245))
    save(noise(img.filter(ImageFilter.GaussianBlur(0.6)), 8, 12), "bass-2-landing.jpg")

    img = lake(3, horizon=250)
    d = ImageDraw.Draw(img)
    bass(d, 360, 250, 1.15)
    hand(d, 360, 250)
    save(noise(img, 8, 13), "bass-3-hero.jpg")


# ───────────────────────── 5k run

def trail(seed, sky0, sky1, ground):
    img = Image.new("RGB", (W, H))
    vgrad(img, 0, 220, sky0, sky1)
    vgrad(img, 220, H, ground, tuple(max(0, c - 40) for c in ground))
    d = ImageDraw.Draw(img)
    rnd = random.Random(seed)
    # path converging to vanishing point
    vp = (W // 2 + rnd.randint(-60, 60), 220)
    d.polygon([vp, (W // 2 - 260, H), (W // 2 + 260, H)], fill=(170, 150, 120))
    d.line([vp, (W // 2, H)], fill=(235, 235, 220), width=3)
    # trees / lamp posts
    for i in range(10):
        side = -1 if i % 2 else 1
        t = (i + 1) / 11
        x = vp[0] + side * (40 + 300 * t)
        y = 220 + 260 * t
        h = 30 + 220 * t
        d.rectangle([x - 2 - 4 * t, y - h, x + 2 + 4 * t, y], fill=(70, 55, 40))
        d.ellipse([x - 30 * t - 8, y - h - 40 * t - 10, x + 30 * t + 8, y - h + 30 * t], fill=(50, 110, 60))
    return img


def runner(d, x, y, s):
    c = (230, 80, 60)
    d.ellipse([x - 9 * s, y - 70 * s, x + 9 * s, y - 52 * s], fill=(200, 150, 120))
    d.line([(x, y - 52 * s), (x, y - 20 * s)], fill=c, width=int(10 * s))
    d.line([(x, y - 20 * s), (x - 14 * s, y)], fill=(40, 40, 60), width=int(6 * s))
    d.line([(x, y - 20 * s), (x + 16 * s, y - 6 * s)], fill=(40, 40, 60), width=int(6 * s))
    d.line([(x, y - 45 * s), (x + 15 * s, y - 32 * s)], fill=c, width=int(4 * s))


def run_frames():
    img = trail(21, (120, 170, 230), (210, 225, 240), (90, 140, 70))
    runner(ImageDraw.Draw(img), 330, 420, 2.2)
    save(noise(img, 7, 21), "run-1-start.jpg")
    img = trail(22, (110, 160, 225), (205, 220, 240), (95, 145, 75))
    runner(ImageDraw.Draw(img), 300, 300, 1.0)
    save(noise(img, 7, 22), "run-2-mid.jpg")
    img = trail(23, (130, 175, 230), (215, 228, 240), (90, 140, 70))
    d = ImageDraw.Draw(img)
    # finish: watch face held to camera
    d.ellipse([200, 140, 440, 380], fill=(25, 25, 30))
    d.ellipse([215, 155, 425, 365], fill=(10, 12, 16))
    d.rectangle([250, 245, 390, 275], fill=(60, 200, 120))
    d.rectangle([250, 290, 330, 305], fill=(200, 200, 210))
    save(noise(img, 7, 23), "run-3-finish.jpg")


# ───────────────────────── sunrise hike

def ridge(seed, sun_y, warmth):
    img = Image.new("RGB", (W, H))
    vgrad(img, 0, H, lerp((20, 25, 60), (90, 120, 190), warmth), lerp((120, 60, 70), (250, 170, 90), warmth))
    d = ImageDraw.Draw(img)
    # sun with glow
    for r in range(110, 30, -8):
        a = (110 - r) / 80
        d.ellipse([W * 0.62 - r, sun_y - r, W * 0.62 + r, sun_y + r], fill=lerp((250, 150, 90), (255, 230, 170), a))
    rnd = random.Random(seed)
    for layer, (base, col) in enumerate([(300, (70, 50, 80)), (350, (45, 35, 60)), (410, (25, 20, 35))]):
        pts = [(0, H)]
        y = base
        for x in range(0, W + 30, 30):
            y = max(base - 90, min(base + 40, y + rnd.randint(-28, 28)))
            pts.append((x, y))
        pts.append((W, H))
        d.polygon(pts, fill=col)
    return img


def hike_frames():
    save(noise(ridge(31, 380, 0.15), 6, 31), "hike-1-predawn.jpg")
    save(noise(ridge(31, 300, 0.55), 6, 32), "hike-2-first-light.jpg")
    img = ridge(31, 210, 0.95)
    d = ImageDraw.Draw(img)
    # summit cairn
    for i, w in enumerate([70, 54, 40, 26]):
        y = 430 - i * 24
        d.ellipse([140 - w / 2, y - 14, 140 + w / 2, y + 12], fill=(110, 100, 95))
    save(noise(img, 6, 33), "hike-3-summit.jpg")


# ───────────────────────── the fake: bass photo on a laptop screen

def screen_shot_of(src_name, seed):
    src = Image.open(os.path.join(OUT, src_name)).convert("RGB")
    img = Image.new("RGB", (W, H))
    vgrad(img, 0, H, (95, 85, 75), (60, 52, 45))  # dim room
    d = ImageDraw.Draw(img)
    d.rectangle([0, 380, W, H], fill=(120, 90, 60))  # desk
    # bezel
    d.rounded_rectangle([70, 40, 570, 380], 14, fill=(20, 20, 22))
    inner = src.resize((460, 300))
    # scanlines + moire
    px = inner.load()
    for y in range(inner.height):
        for x in range(inner.width):
            r, g, b = px[x, y]
            k = 0.78 if y % 3 == 0 else 1.0
            m = 1.0 + 0.10 * math.sin((x * 0.9 + y * 0.35))
            px[x, y] = (min(255, int(r * k * m * 1.08)), min(255, int(g * k * m * 1.1)), min(255, int(b * k * m * 1.25)))
    img.paste(inner, (90, 60))
    # glare
    glare = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glare).polygon([(300, 60), (420, 60), (250, 360), (130, 360)], fill=70)
    img = Image.composite(Image.new("RGB", (W, H), (255, 255, 255)), img, glare.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    d.polygon([(40, 380), (600, 380), (640, 420), (0, 420)], fill=(170, 170, 175))  # keyboard deck
    return noise(img, 6, seed)


def fake_frames():
    save(screen_shot_of("bass-3-hero.jpg", 41), "fake-1-screen.jpg")
    img = Image.new("RGB", (W, H))
    vgrad(img, 0, H, (200, 190, 170), (150, 140, 120))
    d = ImageDraw.Draw(img)
    d.rectangle([380, 60, 560, 300], fill=(240, 240, 230))  # window/blind
    for y in range(70, 300, 14):
        d.line([(380, y), (560, y)], fill=(200, 200, 190), width=3)
    d.rectangle([0, 380, W, H], fill=(120, 90, 60))
    save(noise(img, 6, 42), "fake-2-room.jpg")


if __name__ == "__main__":
    bass_frames()
    run_frames()
    hike_frames()
    fake_frames()

"""Render the Devpost gallery: python3 render.py [out_dir] [slide ...]

Slides are drawn by slides.html (1500x1000 CSS px, 3:2) and screenshotted at 2x by headless
Chrome, so each image is 3000x2000 JPEG, well under Devpost's 5 MB limit.
Needs: playwright, qrcode, and the stills in shots/ (see README.md).
"""
import pathlib, sys
import qrcode, qrcode.image.svg
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "out"
ONLY = sys.argv[2:]

LINKS = {"web": "https://verified-99e74.web.app",
         "testflight": "https://testflight.apple.com/join/8SGF1Pqr",
         "github": "https://github.com/mattrickslauer/verified"}
for name, url in LINKS.items():
    qrcode.make(url, image_factory=qrcode.image.svg.SvgPathFillImage, border=0,
                error_correction=qrcode.constants.ERROR_CORRECT_M).save(HERE / f"assets/qr-{name}.svg")

OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page(viewport={"width": 1500, "height": 1000}, device_scale_factor=2)
    pg.goto((HERE / "slides.html").as_uri())
    ids = pg.evaluate("window.SLIDES")
    for i, sid in enumerate(ids):
        if ONLY and sid not in ONLY:
            continue
        pg.goto((HERE / "slides.html").as_uri() + "#" + sid)
        pg.reload()
        pg.evaluate("document.fonts.ready")
        pg.wait_for_load_state("networkidle")
        name = "00-thumbnail" if sid == "thumb" else f"{i:02d}-{sid}"
        pg.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=90)
        print(name)
    b.close()

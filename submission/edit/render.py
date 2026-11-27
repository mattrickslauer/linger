"""Render the compositor page frame by frame with headless Chrome.

usage:
  python3 render.py WORK_DIR --at 10 52.3 ...        preview stills (global seconds) -> WORK/preview/
  python3 render.py WORK_DIR --all [--workers 8]     every frame -> WORK/out/%05d.jpg, plus WORK/cues.json
"""
import argparse
import asyncio
import json
import os

from playwright.async_api import async_playwright

ap = argparse.ArgumentParser()
ap.add_argument("work")
ap.add_argument("--at", nargs="*", type=float)
ap.add_argument("--all", action="store_true")
ap.add_argument("--workers", type=int, default=8)
ap.add_argument("--start", type=int, default=0)
a = ap.parse_args()
WORK = os.path.abspath(a.work)


async def open_page(p):
    b = await p.chromium.launch(channel="chrome", args=["--allow-file-access-from-files", "--disable-gpu-vsync"])
    pg = await b.new_page(viewport={"width": 1920, "height": 1080})
    pg.on("console", lambda m: print("console:", m.text) if m.type in ("warning", "error") else None)
    pg.on("pageerror", lambda e: print("PAGE ERROR:", e))
    await pg.goto(f"file://{WORK}/index.html")
    await pg.evaluate("window.READY")
    return b, pg


async def shoot(pg, t, path):
    await pg.evaluate(f"renderFrame({t})")
    await pg.screenshot(path=path, type="jpeg", quality=93)


async def main():
    async with async_playwright() as p:
        if a.at:
            os.makedirs(f"{WORK}/preview", exist_ok=True)
            b, pg = await open_page(p)
            for t in a.at:
                await shoot(pg, t, f"{WORK}/preview/t{t:07.2f}.jpg")
            await b.close()
            return
        b, pg = await open_page(p)
        meta = await pg.evaluate("({total: META.TOTAL, fps: META.FPS, cues: META.cues()})")
        await b.close()
        json.dump(meta["cues"], open(f"{WORK}/cues.json", "w"))
        n = int(round(meta["total"] * meta["fps"]))
        os.makedirs(f"{WORK}/out", exist_ok=True)
        print("frames", n)

        async def worker(k):
            b, pg = await open_page(p)
            for i in range(a.start + k, n, a.workers):
                path = f"{WORK}/out/{i + 1:05d}.jpg"
                if os.path.exists(path):
                    continue
                await shoot(pg, i / meta["fps"], path)
                if i % 300 == 0:
                    print("frame", i, flush=True)
            await b.close()

        await asyncio.gather(*[worker(k) for k in range(a.workers)])


asyncio.run(main())

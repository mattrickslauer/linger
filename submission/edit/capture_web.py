"""Record the live web app (Chrome) scrolling its feed, for the three-platform frame.

usage: python3 -I capture_web.py OUT_DIR
Writes OUT_DIR/w*.png stills and a .webm screen video of the session.
"""
import asyncio
import sys
from playwright.async_api import async_playwright

URL = "https://verified-99e74.web.app/"


async def main(out):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome")
        ctx = await b.new_context(
            viewport={"width": 1280, "height": 800},
            record_video_dir=out,
            record_video_size={"width": 1280, "height": 800},
        )
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(7000)
        await pg.screenshot(path=f"{out}/w0.png")
        for i in range(6):
            await pg.mouse.move(640, 400)
            await pg.mouse.wheel(0, 800)
            await pg.wait_for_timeout(3500)
            await pg.screenshot(path=f"{out}/w{i + 1}.png")
        await ctx.close()
        await b.close()


asyncio.run(main(sys.argv[1]))

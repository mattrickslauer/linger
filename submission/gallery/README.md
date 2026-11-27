# Devpost gallery

`out/` holds the upload set: `00-thumbnail.jpg` (the project thumbnail) and `01`–`15` (the image
gallery, in order). Every image is 3000×2000 (3:2) JPEG, under 1 MB.

| # | Slide |
|---|---|
| 00 | Thumbnail: Say it. Do it. Prove it. + three platforms |
| 01 | Cover: on-device intent & evidence factory |
| 02 | The problem: a photo is no longer proof |
| 03 | The pipeline: intent → evidence → AI reads → seal |
| 04 | Say it: on-device interview → claims + evidence plan |
| 05 | Do it: session recording, SHA-256 chain every 5 s, offline-first |
| 06 | On-device coach: "retake", never "verified" |
| 07 | Live AI witness |
| 08 | Hybrid routing table (PREFER_ON_DEVICE / ONLY_IN_CLOUD per job and platform) |
| 09 | Cloud reads: video review, judge, skeptic, scorer |
| 10 | Deterministic seal |
| 11 | Catches fakes |
| 12 | Three native apps, one hybrid SDK |
| 13 | Verification ladder (business model) |
| 14 | Built on Firebase |
| 15 | Try it: QR codes for web, TestFlight, source |

## Rebuild

`shots/` are stills from the demo footage (`ScreenRecording.mp4`, `AndroidFeed.mp4`,
`ChromeFeed.webm`). Edit `slides.html` (one function per slide), then:

```bash
python3 render.py out            # all slides
python3 render.py out s8 thumb   # just some
```

Fonts and logos in `assets/` come from the demo video pipeline (`submission/edit/` on
`worktree-demo-video-edit`).

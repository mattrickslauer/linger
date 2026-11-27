# Demo video edit pipeline

The demo video is composited in code. One HTML page (`index.html`) draws any output frame from its
timestamp: the founder A-roll, the screen recordings in device frames, the animated callouts, the
hash-chain diagram, the Gemini, judge and Cloud Function cards, the three-platform frame, karaoke
captions, and the QR title and end cards. Headless Chrome screenshots every frame, and ffmpeg
encodes the frames with a cleaned-up voice track, synthesized UI sound effects and a quiet pad.

Overlay beats are tied to the spoken words (`W('seal', 110.2)` = the moment "seal" is said), so
re-timing the speech only needs a new `words.json`.

## Inputs (in `submission/`, not committed, too big)

| File | What |
|---|---|
| `VerifiedRollA.mov` | founder speech, 1080p 23.976 |
| `ScreenRecording.mp4` | iPhone screen recording of the app (10:36) |
| `AndroidFeed.mp4` | Android feed scroll (`adb shell screenrecord`) |
| `ChromeFeed.webm` | live web app in Chrome (`capture_web.py`) |

## Rebuild

```bash
WORK=/tmp/verified-edit; SUB=$PWD/submission; E=submission/edit
mkdir -p $WORK
# 1. captions: whisper word timestamps -> words.json (already committed; only redo if the A-roll changes)
#    python3 $E/fix_words.py raw_words.json $E/words.json
python3 $E/build_assets.py $SUB $WORK          # frames for every clip at 30 fps, QR codes, data.js
$E/preview.sh $WORK /tmp/p.jpg 10 60 113 130   # check a few stills (global seconds)
(cd $WORK && python3 $OLDPWD/$E/render.py . --all --workers 6)   # ~4,700 frames
python3 $E/mix.py $SUB $WORK                   # soundtrack (needs cues.json from the render)
$E/encode.sh $WORK $SUB/Verified-demo.mp4
python3 $E/make_srt.py $SUB/Verified-demo.srt  # YouTube captions
```

- `timeline.py`: which source seconds feed each clip and how fast (`segs: (start, end, speed)`).
- `index.html`: scene timings, layouts and animation (A-roll seconds, "r").
- Global time = 4 s title card + A-roll 1.2 to 149.0 s + 6 s end card = 2:37.8.

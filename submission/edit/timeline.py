"""Edit decision list. Times in the A-roll are seconds of VerifiedRollA.mov ("r").

Output timeline: INTRO seconds of title card, then the A-roll from ROLL_IN to ROLL_OUT,
then OUTRO seconds of end card.  Global t = INTRO + (r - ROLL_IN).
Overlay scene timings live in index.html (same r units); this file only says which
source footage to cut and how fast to play it.
"""
INTRO = 4.0
ROLL_IN = 1.2     # first word "Hi" starts at 1.70
ROLL_OUT = 149.0  # "Prove it." ends at 148.14
OUTRO = 6.0

IPHONE = "ScreenRecording.mp4"
# segs: (src_start, src_end, speed). Speeds chosen so each beat lands on its words.
CLIPS = {
    # r29.1-51.6 "It starts with intent": Talk it through -> "Do 10 push-ups" -> plan
    "intent": {"src": IPHONE, "segs": [(276, 288, 1.5), (288, 308, 6.0), (308, 318.4, 0.93)]},
    # r52.2-64.7 "Then the factory runs": recording HUD, timer, GPS, chain count
    "factory": {"src": IPHONE, "segs": [(316, 336, 1.6)]},
    # r67.4-80.2 design decision: on-device "Retake" toasts
    "retake": {"src": IPHONE, "segs": [(336, 352, 1.25)]},
    # r80.7-93.0 live witness: "Show the video of all 10 push-ups"
    "witness": {"src": IPHONE, "segs": [(350, 363, 1.05)]},
    # r93.9-111.5 cloud: upload -> judging -> Verified 84 lands on "write the seal" (r~110.5)
    "cloud": {"src": IPHONE, "segs": [(398, 414, 3.5), (414, 432, 1.0)]},
    # r111.0-117 fake: AI fish photographed off the laptop screen
    "fish": {"src": IPHONE, "segs": [(106, 119, 2.0)]},
    # r121.7-137 three platforms
    "ios_feed": {"src": IPHONE, "segs": [(0, 40, 2.6)]},
    "android_feed": {"src": "AndroidFeed.mp4", "segs": [(2.5, 31.5, 1.9)]},
    "chrome_feed": {"src": "ChromeFeed.webm", "segs": [(6.5, 36.3, 1.95)], "scale": "1280:800"},
    # r137.2-144.6 ladder sheet: buy extra checks
    "ladder": {"src": IPHONE, "segs": [(603, 636.5, 4.5)]},
}

# name: (source, time, ffmpeg scale)
STILLS = {
    "fish_screen": (IPHONE, 110.0, "-2:1400"),        # hook: "just photograph a screen"
    "android_fish": ("AndroidFeed.mp4", 14.0, "-2:1400"),  # rejected card on Android
    "web_fish": ("ChromeFeed.webm", 18.5, "1280:800"),
}

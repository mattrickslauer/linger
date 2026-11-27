# Demo video: founder speech + app overlays (target 2:50, hard cap 3:00)

**Format (the one that has worked before):** you on camera, as the developer and founder, giving a short speech
straight to the lens. That's the **A-roll**, and it runs under the whole video. Over it, the edit lays **visuals and
real app usage**: screen recordings in device frames, captions, a couple of diagrams and short real-world clips.

**Judges may score on the video alone.** Every overlay must show one of the four criteria (tech, design, impact,
idea), and the on-device/cloud split must be *visible on screen*, not just said.

**The pitch:** Verified is an **on-device intent and evidence factory**. You say what you're about to do; it turns
that into checkable claims and an evidence plan, collects the evidence on the phone, and the cloud and code seal
it. Push-ups, a fish, a song are only example intents. The demo intent is *"20 push-ups at the top of the hill"*.

The speech is in [`voiceover.txt`](voiceover.txt): 442 words, about 2:45 at a natural to-camera pace.

---

## Overlay layouts

Use these five layouts and nothing else, so the video reads as one design. Background is the app's dark
`#0f2127`; type is Bricolage Grotesque; the only accents are verified green `#7fd19b` and rejected red `#f08a78`.

| Layout | What's on screen | Use it for |
|---|---|---|
| **L1 Speaker** | You, full frame. Optional one-line caption, lower third | Hook, opinions, the "design decision" line, close |
| **L2 Split** | You on the left ~40 %, a device-framed screen recording on the right ~60 % | Walking through the app while you explain it |
| **L3 Cutaway** | App footage or real-world clip full frame; you in a round bubble, bottom-left, ~18 % of the height | Moments where the picture matters more than your face |
| **L4 Diagram** | A simple animated line on the dark background: **intent → claims → evidence → seal** | Explaining the factory and the trust model |
| **L5 Three platforms** | **iPhone, Android and Chrome side by side**, the same Moment open on each, each with its routing chip: **On-device · Apple FM** / **Cloud · no Nano on this phone** / **On-device · Gemini Nano**. Your bubble, small, or none | Hero frame, used **twice**: a 2-s teaser in the hook and a full 8-s hold in the platforms section |

**Building L5:** record each device separately showing the same Moment (Detail page, then a slow scroll), drop
each into a device frame, and line them up: phone, phone, laptop browser window. Keep all three in sync by
starting each scroll on a clap or a tap. This is the frame people will remember, so give it a slight push-in and
no other motion.

## Script

| # | Time | You say (first words) | Layout | Overlay |
|---|---|---|---|---|
| 1 | 0:00–0:06 | *"Hi, I'm [your name], and I built Verified."* | L1 → **L5 teaser** (2 s) | Name + "Founder & developer" lower third, then a flash of the three-platform frame with the title **Verified** |
| 2 | 0:06–0:20 | *"A photo used to be proof…"* | L3 | Montage, ≤ 1 s each: a fake trophy fish, a "50 push-up challenge" post, a giveaway post, each stamped with a red **?** |
| 3 | 0:20–0:30 | *"So I didn't build a better photo checker…"* | L1 → L4 | The factory line animates: **intent → claims → evidence → seal**, caption **An on-device intent & evidence factory** |
| 4 | 0:30–0:58 | *"It starts with intent…"* | L2 | iPhone: tap the mic, say the intent, interview bubble with the **On-device** chip, claim chips (`place` · `action` · `20 push-ups`), then the evidence plan under **"To get this verified"** and the bar ring |
| 5 | 0:58–1:10 | *"Then the factory runs…"* | L3 | You walking up the hill (wide), cut to the live HUD: timer, GPS dot, motion and chain indicators. Lower third: **Every 5 s: GPS · motion · video → SHA-256 chain** |
| 6 | 1:10–1:28 | *"Here's the design decision I care most about…"* | L1 → L2 | Back to you for the first sentence (it's your opinion, so look at the lens). Then split: airplane mode on, a bad shot → toast **"On-device: retake"**, retake → **"On-device: keep going."** Caption: **The device can only say "retake".** |
| 7 | 1:28–1:42 | *"While I record, a live AI witness…"* | L3 | Witness card *"Show me the view behind you."* → **Show** → the view → the shot lands in the filmstrip with a chain link. Then the push-ups, speed-ramped ~4× with a counter to 20 |
| 8 | 1:42–2:00 | *"Then the cloud takes over…"* | L2 → L4 | Upload ring → **Reviewing video** → cards flip in: **Video review**, **Judge**, **Skeptic**, **Scorer**. On "only that code can write the seal": the diagram's last box lights up, then the stamp **Verified ✓ · 3/3 claims backed** |
| 9 | 2:00–2:14 | *"And a fake?…"* | L3 | Phone filming the AI fish on your laptop → **Rejected** with the skeptic's reason. Split screen: fake rejected next to your hill Moment verified |
| 10 | 2:14–2:22 | *"Push-ups are just one example…"* | L3 | 1 s each: real sealed Moments (clap 50 times, sing the alphabet, a short run, cooking), each landing with a ✓ |
| 11 | 2:22–2:36 | *"And it's one app on three platforms…"* | **L5 full** (8 s), then L4 | The three-platform frame, held. Then a 2-s diagram: device ⇄ Firebase AI Logic ⇄ cloud |
| 12 | 2:36–2:46 | *"Proof is free…"* | L2 | The ladder sheet: **"Count & measure · if it passes → 0.92"**, then the credit packs |
| 13 | 2:46–2:52 | *"This is Verified. Say it. Do it. Prove it."* | L1 → end card | End card: **Verified**, **verified-99e74.web.app**, **iOS · Android · Web**, **#BuildHybridAI** |

**If a take runs long,** cut in this order: "So I didn't build a better photo checker." → the "any intent"
examples list → "and the image never leaves the phone".

## Filming the speech (A-roll)

- **One sitting, 20 minutes.** Record the whole speech 3–4 times, plus each paragraph on its own twice. The
  edit uses the best paragraph takes, hidden by cutaways at the joins.
- **Read from a teleprompter**: a free teleprompter app on a phone or tablet just under the lens, or a browser
  teleprompter on the laptop behind the camera. Keep your eyes within a few centimetres of the lens.
- **Camera:** the iPhone's back camera (not the selfie camera), 4K 30, at eye level on a tripod or a stack of
  books. Frame from mid-chest up, with you a third of the way in from the left so L2 has room on the right.
- **Light:** face a window (never back to it). Late morning or overcast is ideal. Turn off overhead lights.
- **Sound** matters more than picture: a lav or wired earphone mic clipped to your shirt, or a second phone
  recording voice memos in your shirt pocket. Clap once at the start to sync. Quiet room, soft furnishings.
- **Background:** tidy and a little personal: shelves, a plant, a lamp, *not* a blank wall. Nothing private on
  screens or paper.
- **Delivery:** speak to one person, a bit slower than feels natural, smile on the hook, and pause between
  paragraphs. The pauses are the edit points.

## Shot list: overlays (B-roll)

| Shot | Gear | Notes |
|---|---|---|
| A. Interview and evidence plan | iPhone screen recording (mic on) | Say the intent clearly; this audio can sit under the speech |
| B. Walking up the hill, wide | Second phone on a small tripod | 2–3 angles, 10 s each, golden hour |
| C. Live HUD while walking | iPhone screen recording, same Moment as A | Keep the Moment recording the whole time |
| D. Airplane-mode toggle | Close-up over the shoulder | Then the bad shot, retake, good shot |
| E. Witness "show me" | iPhone screen recording | Use whatever it really asks for |
| F. Push-ups | Phone propped low, side-on | One extra wide angle from the second phone |
| G. Result and evidence room | iPhone screen recording after sync | Slow scroll: map, filmstrip, claim rows, chain links |
| H. Fake fish Moment | Phone pointed at the laptop | Record ≥ 20 s so it reaches the seal |
| I. **Three platforms (L5)** | Screen recordings: iPhone, Poco, Chrome (OBS) | The same Moment, same scroll, chips visible; sync on a tap |
| J. "Any intent" Moments | Any device, over the week | 3–4 real sealed Moments; only the result screens are needed |
| K. Ladder + credit packs | iPhone or laptop screen recording | Ladder sheet, previews, pack picker |

**Screen recording:** iOS Control Centre → Screen Recording. Android: Quick Settings → Screen record. Laptop:
OBS at 1080p60.

## Edit and finish

- **Timeline:** speech on track 1, overlays on track 2, captions on track 3, music on track 4. Cut the speech
  first to 2:50, *then* lay overlays over it.
- **Format:** 1920×1080, 30 fps. Device frames at ~85 % of the frame height on L3; no raw vertical video with
  black bars.
- **Captions:** max 6 words, at least 1.5 s on screen. Also upload an `.srt` to YouTube; judges often watch muted.
- **Music:** one quiet track from the YouTube Audio Library, about −20 dB under your voice, lifting slightly on
  the push-ups and the L5 hold.
- **Editor (Linux):** DaVinci Resolve (free) or Kdenlive. Export H.264, 1080p, ~16 Mbit/s.

## Before filming: things that must work on production

Film nothing until each of these is checked on the real phones and the live site:

- [x] Storage rules deployed (anyone who can see a Moment can play its video).
- [x] PR #10 (web clip audio) and PR #8 ("End & verify" on mobile) merged and deployed.
- [ ] Fresh builds installed on the iPhone (latest TestFlight, public link https://testflight.apple.com/join/8SGF1Pqr) and the Poco.
- [ ] A dry run of the hero at home: say "20 push-ups in my living room", record ≥ 20 s, check it seals
      **Verified** with the video reviewed. If counting fails, the script still works with "10 push-ups".
- [ ] Airplane mode on the iPhone: does the coach answer **On-device** with no signal? (Apple Intelligence on.)
- [ ] Chrome on the laptop: Gemini Nano flags enabled and the model downloaded, so the chip says **On-device**.
- [ ] The fake-fish Moment comes back **Rejected** with a readable skeptic reason. Generate the fish image with
      any image model; don't use a real person's photo or a real tournament's name or logo in the opening montage (make
      generic mock-ups).
- [ ] App Check debug tokens registered for the builds on both phones, or the AI calls fail on camera.
- [ ] Notifications and personal info off screen: hide the status bar clock or set Do Not Disturb, and use an
      account with no private details showing.

## Backup plans

- **Witness asks for something awkward:** answer it anyway; a real request reads better than a staged one.
- **Rain or no hill:** a staircase or a footbridge works ("20 push-ups at the top of the stairs").
- **The seal takes longer than a minute:** cut on "Reviewing video" and dissolve to the result; say nothing
  about timing.
- **Android has no Nano:** that's the point of the three-platform frame. Show the **Cloud** chip proudly.
- **A speech take stumbles:** keep going and redo just that paragraph; the cutaways hide the join.

## After the edit

- [ ] Watch it once muted, once eyes-closed. Both must make sense.
- [ ] Under 3:00 (aim for 2:50).
- [ ] Upload to YouTube as **Public**, title *"Verified: proof that a moment really happened (#BuildHybridAI)"*,
      with the live URL and repo link in the description.
- [ ] Put the link in the README's links table and on Devpost.

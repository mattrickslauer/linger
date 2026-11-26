# Demo video: "Prove it happened" (target 2:50, hard cap 3:00)

**Judges may score on the video alone.** Every second has to show one of the four criteria (tech, design,
impact, idea), and the hybrid split must be *visible on screen*, not just narrated.

**The hero is doable solo, anywhere, in one afternoon:**
> *"20 push-ups at the top of the hill."*

That one sentence gives the app three claims: a **place** (GPS track up the hill), a **count** (20 push-ups on
video) and an **action**. It shows off the interview, live recording, the witness, offline mode and the seal.
Swap in any hill, bridge, park or rooftop you can reach. Anything with a view and a short walk works.

**Fishing stays the "why"** through the cold open: an AI-made trophy fish that the app rejects.

---

## The arc in one line

**Fake fish (the problem) → say it → do it, offline → sealed → the fake gets caught → three platforms, one
SDK → who it's for.**

## Script

Voice-over (VO) is 256 words, about 1:50 of speech at a calm pace. The rest is music, your own voice and on-screen action.
Lines in **bold** are burned-in captions or title cards.

| # | Time | Picture | Sound / VO |
|---|---|---|---|
| 1 | 0:00–0:10 | Full-screen photo of a huge bass held up on a dock, golden light. Slow push-in. Hold, then a small caption fades up: **"This fish doesn't exist."** | Music: soft pulse, no drums yet. VO: *"This fish doesn't exist. It took me ten seconds to make."* |
| 2 | 0:10–0:22 | Quick cuts (≤ 1 s each): a derby leaderboard, a "50 push-up challenge" post, a sponsor giveaway. Each gets a red **?** stamp. | VO: *"Fishing derbies pay prize money for a photo. Challenges, contests, sponsors: they all run on 'pics or it didn't happen.' And a picture can't prove anything any more."* |
| 3 | 0:22–0:28 | Black. App icon, then the wordmark **Verified**. Subtitle: **Proof that a moment really happened.** | Music drops to silence on the cut, then the beat comes in. VO: *"So I built Verified."* |
| 4 | 0:28–0:45 | **iPhone, screen recording.** Tap the mic. Speak: *"Twenty push-ups at the top of the hill."* The interview asks one follow-up; the bubble shows the **On-device** chip. Claim chips appear (`place` · `20 push-ups`), then the evidence plan ("One continuous video of all 20"), then the bar ring fills to its preview. | Your real voice from the recording, ducked under VO. VO: *"You say what you're about to do. Apple's on-device model runs the interview, so it works at a trailhead with no signal, and turns it into claims and an evidence plan."* |
| 5 | 0:45–1:05 | **Walk up the hill.** Cut between a wide shot of you walking (phone on a tripod or a friend's phone) and the live HUD: timer, GPS dot moving on the mini map, motion and chain indicators ticking. A lower-third pops in: **Every 5 s: GPS · motion · frames → SHA-256 chain**. | VO: *"Then you record the whole moment, not one frame. GPS, motion and video, hash-chained every five seconds, so nothing can be added or cut later."* |
| 6 | 1:05–1:18 | **Airplane mode.** Swipe down, tap airplane (close-up). Take a proof shot with your face half out of frame. Toast: **"On-device: retake, body not in frame."** Retake → **"On-device: keep going."** | VO: *"No signal? The coach runs on the phone. And it's on purpose that the on-device model is only allowed to say one thing: retake. It can never say verified."* |
| 7 | 1:18–1:30 | The witness card slides in: *"Show me the view behind you."* Tap **Show**, pan to the view. The shot lands in the filmstrip with a chain link. | VO: *"A live AI witness asks for what a skeptic would want to see."* |
| 8 | 1:30–1:45 | **Push-ups**, phone propped on the ground in Video mode. Speed-ramp to about 4×, with a counter overlay climbing to 20. The checklist pip ticks. Tap **End & verify**. | Music lifts. No VO; let the effort land. |
| 9 | 1:45–2:05 | Airplane mode off. The upload ring fills, then **Reviewing video**. Three cards flip in: **Judge**, **Skeptic**, **Scorer**, then **Video review**, each with a one-line reason. The score ring climbs past the bar tick. Stamp: **Verified ✓ · 3/3 claims backed.** | VO: *"Back online, it syncs by itself. In the cloud, Gemini watches the whole video and three separate models judge it, hunt for fakes and score it. But AI only proposes. A Cloud Function re-checks the chain, the physics and the hashes, and only code can write the seal."* |
| 10 | 2:05–2:25 | **Back to the fish.** Laptop showing the fake bass; point the phone at the screen and record a short Moment. Cut to the result: **Rejected**, skeptic reason *"photo of a screen: moiré, no motion, indoors."* Split screen: the fake, rejected, next to your hill Moment, verified. | VO: *"And the fish? Caught. Faking one frame is easy. Faking a session is hard."* |
| 11 | 2:25–2:40 | **Three devices side by side** (iPhone, Android, Chrome laptop) on a table, same feed, same Moment. Chips: **On-device · Apple FM** / **Cloud · no Nano on this phone** / **On-device · Gemini Nano**. Then a 3-second diagram: device ⇄ Firebase AI Logic ⇄ cloud. | VO: *"iOS, Android and Chrome. One Firebase AI Logic hybrid SDK. On-device when the phone has a model, cloud when it doesn't, and the app shows you which one answered."* |
| 12 | 2:40–2:52 | The ladder sheet: **"Count & measure · if it passes → 0.92."** Then the embed badge on a mock derby page. | VO: *"Derbies, challenges and sponsors can pay for more scrutiny when the stakes are high. Paying buys scrutiny, never a score."* |
| 13 | 2:52–2:58 | End card: **Verified**, **verified-99e74.web.app**, **iOS · Android · Web**, **#BuildHybridAI**. | VO: *"Verified. Prove it happened."* Music button ending. |

## Shot list (what you physically film)

Film on a dry day in the hour before sunset; golden light makes the hill shots look expensive.

| Shot | Gear | Notes |
|---|---|---|
| A. Interview, spoken at the bottom of the hill | iPhone screen recording | Speak clearly and slowly; this audio is used |
| B. Walking up, wide | Second phone on a small tripod, or a friend | 2–3 takes from different angles, 10 s each |
| C. Live HUD while walking | iPhone screen recording (the same Moment as A) | Keep recording the Moment running the whole time |
| D. Airplane-mode toggle | Close-up from the second phone, over the shoulder | Then the bad shot, retake, good shot |
| E. Witness "show me" | iPhone screen recording | If it asks for something else, use that; it's real |
| F. Push-ups | Phone propped low, side-on, landscape if possible | Also film one wide B-roll angle with the second phone |
| G. Result / evidence room | iPhone screen recording, after sync | Scroll slowly: map, filmstrip, claim rows, chain links |
| H. Fake fish Moment | Phone pointed at the laptop screen | Indoors, at a desk; record ≥ 20 s so it reaches the seal |
| I. Three devices | Overhead on a table, second phone or webcam | Same Moment open on all three; chips visible |
| J. Ladder + embed | Laptop screen recording (OBS) | `/embed` page and the ladder sheet |

**Screen recording:** iOS Control Centre → Screen Recording (long-press → mic on for shot A). Android: Quick
Settings → Screen record. Laptop: OBS at 1080p60.

## Making it look good

- **Format:** 1920×1080, 30 fps. Phone recordings sit centred in a simple device frame on the app's dark
  background (`#0f2127`), at about 85 % of the frame height. Never show a raw vertical video with
  black bars.
- **Type:** Bricolage Grotesque (the app's typeface, free on Google Fonts) for every caption and title. White, bottom third, max 6 words, on screen
  for at least 1.5 s.
- **Colour:** the app's verified green `#7fd19b` and rejected red `#f08a78` are the only accent colours in titles and stamps.
- **Motion:** gentle push-ins on stills, quick cuts in the montage (shot 2), real-time for UI moments, speed
  ramps only for the walk and the push-ups.
- **Music:** one track from the YouTube Audio Library (free, cleared for YouTube), building at shot 8 and
  ending on a button at shot 13. Keep it about −18 dB under the VO.
- **VO:** record it last, to picture, in a closet or under a blanket with a phone mic held 15 cm away. Read
  slowly; cut breaths in the edit.
- **Editor (Linux):** DaVinci Resolve (free) or Kdenlive. Export H.264, 1080p, ~16 Mbit/s.
- **Captions:** upload an `.srt` to YouTube as well. Judges often watch muted.

## Before filming: things that must work on production

Film nothing until each of these is checked on the real phones and the live site:

- [ ] **Deploy storage rules** (`infra/fb.sh deploy --only storage`), or nobody but the owner can play a
      Moment's video. Needed for shots 9–11.
- [ ] Decide on **PR #10** (web clip audio, continuous clip) and **PR #8** ("End & verify" on mobile); merge and
      deploy what's needed, then install fresh builds on the iPhone and the Poco.
- [ ] A dry run of the hero at home: say "20 push-ups in my living room", record ≥ 20 s, check it seals
      **Verified** with the video reviewed. If counting fails, the script still works with "10 push-ups".
- [ ] Airplane mode on the iPhone: does the coach answer **On-device** with no signal? (Apple Intelligence on.)
- [ ] Chrome on the laptop: Gemini Nano flags enabled and the model downloaded, so the chip says **On-device**.
- [ ] The fake-fish Moment comes back **Rejected** with a readable skeptic reason. Generate the fish image with
      any image model; don't use a real person's photo or a real tournament's name or logo in shot 2 (make
      generic mock-ups).
- [ ] App Check debug tokens registered for the builds on both phones, or the AI calls fail on camera.
- [ ] Notifications and personal info off screen: hide the status bar clock or set Do Not Disturb, and use an
      account with no private details showing.

## Backup plans

- **Witness asks for something awkward:** answer it anyway; a real request reads better than a staged one.
- **Rain or no hill:** a staircase or a footbridge works ("20 push-ups at the top of the stairs").
- **The seal takes longer than a minute:** cut on "Reviewing video" and dissolve to the result; say nothing
  about timing.
- **Android has no Nano:** that's the point of shot 11. Show the **Cloud** chip proudly.

## After the edit

- [ ] Watch it once muted, once eyes-closed. Both must make sense.
- [ ] Under 3:00 (aim for 2:50).
- [ ] Upload to YouTube as **Public**, title *"Verified: proof that a moment really happened (#BuildHybridAI)"*,
      with the live URL and repo link in the description.
- [ ] Put the link in the README's links table and on Devpost.

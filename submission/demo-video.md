# Demo video: "Prove it happened" (target 2:50, hard cap 3:00)

**Judges may score on the video alone.** Every second has to show one of the four criteria (tech, design,
impact, idea), and the hybrid split must be *visible on screen*, not just narrated.

**The pitch:** Verified is an **on-device intent and evidence factory**. You say what you're about to do; it turns
that into checkable claims and an evidence plan, collects the evidence on the phone, and the cloud and code seal
it. **No single use case is the product.** Push-ups, a fish, a song or a summit are all just intents going in.

**The demo intent is doable solo, anywhere, in one afternoon:**
> *"20 push-ups at the top of the hill."*

It yields three claims, a **place** (GPS track up the hill), a **count** (20 push-ups on video) and an
**action**, so it shows the interview, the evidence plan, live recording, the witness, offline mode and the
seal. Swap in any hill, bridge, park or rooftop you can reach.

Other intents appear only as **examples**: a montage in the opening, a fake fish that gets rejected, and a
quick "any intent" montage near the end.

---

## The arc in one line

**Photos can be faked → the factory: intent in → claims + evidence plan → evidence collected on the device,
offline → cloud reads + code seal → a fake rejected → any intent → three platforms, one SDK.**

## Script

The VO is in [`voiceover.txt`](voiceover.txt): 428 words, about 2:40 at a brisk read. Read it to picture after
the edit, and let the push-ups play *under* the witness and offline lines rather than in silence. Lines in
**bold** are burned-in captions or title cards.

| # | Time | Picture | VO (first words) |
|---|---|---|---|
| 1 | 0:00–0:14 | **"Proof" montage**, ≤ 1 s each: a trophy-fish photo, a "50 push-up challenge" post, a summit selfie, a giveaway post. Each gets a red **?** stamp. The last one glitches to show it's AI-made. | *"A photo used to be proof…"* |
| 2 | 0:14–0:22 | Black. App icon, wordmark **Verified**, subtitle **An on-device intent & evidence factory.** A simple animated line: **intent → claims → evidence → seal**. | *"Verified is an intent and evidence factory…"* |
| 3 | 0:22–0:38 | **iPhone screen recording.** Tap the mic, say the intent. The interview asks a follow-up; its bubble shows the **On-device** chip. Claim chips appear: `place` · `action` · `20 push-ups`. | *"It starts with intent…"* |
| 4 | 0:38–0:52 | The evidence plan under **"To get this verified"**, one row per claim; the bar-preview ring fills. Caption: **Claims → evidence plan → bar**. | *"For every claim it writes an evidence plan…"* |
| 5 | 0:52–1:06 | **Walk up the hill**: wide shot intercut with the live HUD (timer, GPS dot on the mini map, motion and chain indicators ticking). Lower third: **Every 5 s: GPS · motion · video → SHA-256 chain**. | *"Then the factory runs…"* |
| 6 | 1:06–1:22 | **Airplane mode on** (close-up). A proof shot with your body half out of frame → toast **"On-device: retake"**; retake → **"On-device: keep going."** Caption: **The device can only say "retake".** | *"The on-device model checks each shot…"* |
| 7 | 1:22–1:32 | Witness card: *"Show me the view behind you."* Tap **Show**, pan to the view; the shot lands in the filmstrip with a chain link. | *"A live AI witness asks…"* |
| 8 | 1:32–1:50 | **Push-ups**, phone propped low in Video mode, speed-ramped to about 4× with a counter overlay to 20; the checklist ticks; **End & verify**. Airplane mode off; the upload ring fills, then **Reviewing video**. | *"No signal? Everything waits in a local vault…"* |
| 9 | 1:50–2:05 | Cards flip in: **Video review**, **Judge**, **Skeptic**, **Scorer**, each with a one-line reason. The score ring climbs past the bar tick. Stamp: **Verified ✓ · 3/3 claims backed.** Quick scroll of the evidence room (map, filmstrip, chain links). | *"But AI only proposes…"* |
| 10 | 2:05–2:20 | **A fake.** Laptop showing an AI-made fish; the phone records it off the screen. Result: **Rejected**, with the skeptic's reason. Split screen: the fake rejected, the hill Moment verified. | *"Now a fake…"* |
| 11 | 2:20–2:30 | **"Any intent" montage**, 1 s each, real Moments from the feed: clapping 50 times, singing the alphabet, a run, a recipe. Each lands with a ✓ stamp. | *"Push-ups are just one example…"* |
| 12 | 2:30–2:42 | **Three devices** (iPhone, Android, Chrome laptop) on a table, same Moment open. Chips: **On-device · Apple FM** / **Cloud · no Nano on this phone** / **On-device · Gemini Nano**. Then a 2-s diagram: device ⇄ Firebase AI Logic ⇄ cloud. | *"It runs on iOS, Android and Chrome…"* |
| 13 | 2:42–2:52 | The ladder sheet: **"Count & measure · if it passes → 0.92"**, then the credit packs. | *"Proof is free…"* |
| 14 | 2:52–2:58 | End card: **Verified**, **Say it. Do it. Prove it.**, **verified-99e74.web.app**, **iOS · Android · Web**, **#BuildHybridAI**. | *"Verified. Say it. Do it. Prove it."* |

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
| K. "Any intent" Moments | Any device | 3–4 short real Moments (clap 50 times, sing the alphabet, a short run, cooking) recorded over the week; you only need the sealed result screens |
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
  ending on a button at shot 14. Keep it about −18 dB under the VO.
- **VO:** record it last, to picture, in a closet or under a blanket with a phone mic held 15 cm away. Read
  slowly; cut breaths in the edit.
- **Editor (Linux):** DaVinci Resolve (free) or Kdenlive. Export H.264, 1080p, ~16 Mbit/s.
- **Captions:** upload an `.srt` to YouTube as well. Judges often watch muted.

## Before filming: things that must work on production

Film nothing until each of these is checked on the real phones and the live site:

- [x] Storage rules deployed (anyone who can see a Moment can play its video).
- [x] PR #10 (web clip audio) and PR #8 ("End & verify" on mobile) merged and deployed.
- [ ] Fresh builds installed on the iPhone (latest TestFlight) and the Poco.
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

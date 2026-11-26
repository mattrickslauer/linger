# Feed v5: one Moment a screen, read as intent → proof → result

Owner ask (2026-11-25): "a TikTok style like takes.mattricks where we can inspect the evidence. Each
[post] should get an engaging overview where we explain intent -> proof -> result in a static
template like fashion where each post is congruent with a click into to view an evidence room of the
event." Then: ship it on web, iOS and Android.

Reference implementation: web (`web/src/pages/Feed.tsx`, `web/src/feed.css`, `web/src/pages/Detail.tsx`,
`web/src/room.css`). Native ports follow it; native idioms win over pixel-matching.

## The feed

- Full-screen vertical pager, one Moment per page, snapping (web: CSS scroll-snap; Android:
  `VerticalPager`; iOS: vertical `ScrollView` with `.scrollTargetBehavior(.paging)` or a rotated
  `TabView`). Always dark, whatever the app theme: the proof photo is the page.
- Page 0 is an intro page: "Proof it happened." + the three waypoints explained in one line each +
  live counts ("3 verified, 1 not") + Record a Moment + "Swipe up".
- Tabs over the pager: All / Verified / Not verified (status filter). The last page is an end card
  (Record a Moment, Back to the top).
- Returning from an evidence room lands on the page you left.

### The slide template (identical for every Moment)

Background: `heroJpegB64` full-bleed, `cover`, with a top and bottom dark scrim (#071419). Rejected
Moments desaturate the photo. No photo: a dark lake gradient.

Left edge: a dashed vertical track (GPS orange #FF8A4C; muted grey when not verified) joining three
waypoint dots. The intent block takes the slack so the photo shows between intent and proof; the
track stops at the result dot.

1. **Intent**: label "Intent" + "{owner} set out to"; then `intention.text` big (display weight,
   ~30sp, tight leading, max ~15 chars a line), wrapped in orange curly quotes.
   Dot: hollow ring.
2. **Proof**: label "Proof" + "captured live, {ago}"; a small track sketch (64×48, dark box, orange
   line, gold end dot) beside three stats `time`, `moved`, `shots` (value over label, no wrapping);
   then five pips Chain / Timing / Physics / Frames / AI (green dot = passed, red outline = failed).
   v4 extras as one more small line when present: "{claimsBacked}/{claimsTotal} claims backed",
   "+N checks" (ladder), "witness a/b". Dot: filled orange.
3. **Result**: label "Result"; the seal stamp (the ONE loud element: gold #E7B425 block, dark ink
   text "Verified ✓", rotated −4°, inset ring; or dashed red-outline "Not verified"); beside it
   "**81%** likely true" and, when `bar` is set, "bar 80%". Under it one reason, 2 lines max:
   cheating → `cheatingSignals[0]`; sealed → `scoreReasons[0] ?? judgeReasons[0]`; else `sealReason`.
   Dot: filled gold (red when not verified) with a soft halo.

Right rail, lower third: round **Evidence** button (light disc, magnifier) and **Share** (copies or
shares `https://<host>/m/{id}`). Tapping anywhere on the slide also opens the evidence room.

Motion: one reveal per slide as it becomes current: track segments draw, waypoints arrive in order,
the stamp lands (scale 1.9 → 1, −12° → −4°, ~0.4 s, 0.8 s delay). Respect reduce-motion.

## The evidence room (`/m/{id}`, Moment detail)

Same three waypoints, now as the page's sections, with the dashed track down the left and the same
dot styles; a sticky Intent / Proof / Result jump bar. Title "Evidence room". It follows the app
theme. Content is the existing detail content regrouped, nothing removed:

- **Intent** ("what {owner} said they would do, before starting"): category, intention text with
  quotes, owner/time/device, chips, the structured claim/plan bits v4 shows.
- **Proof** ("captured on the phone as it happened, hashed chunk by chunk"): stats, frame viewer +
  scrubber + motion + map, witness, video review, hash chain.
- **Result** ("AIs propose, a Cloud Function decides"): verdict box (stamp + seal reason + "n of 5
  seal checks passed, p% likely true"), claims, AI opinions (judge, skeptic, score), ladder, seal
  checks list, owner actions (ladder, delete) as before.

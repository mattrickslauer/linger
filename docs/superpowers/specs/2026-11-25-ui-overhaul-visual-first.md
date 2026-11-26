# UI overhaul: visual first, less text, less scrolling (web, Android, iOS)

Owner ask (2026-11-25): "Go page by page across all 3 platforms and design for visual, less text and
scrolling, more overlaid and cleverly laid-out information for instant visual understanding, and ensure
sizing and all store norms are achieved as well as best practices… completely fix up the UI to be modern
and instantly understandable and recognizable by the user."

Base: `feat/shared-video` (feed v5 pager + evidence room + shared video). This is a **UI-only** pass:
no change to data models, Firestore/Storage paths, hashing, sealing, AI prompts, auth or the
contract in `docs/ARCHITECTURE.md`. Every feature that exists today must still be reachable.

## Identity (keep it, sharpen it)

Keep the existing brand: deep-lake ink, lichen paper, **seal gold #E7B425** as the one loud element,
**GPS orange #FF8A4C** for tracks, dashed track + three waypoint dots (Intent → Proof → Result).
Display type: Bricolage Grotesque on web; system (SF Pro Rounded/Display, Roboto Flex / default
Material type) on native. Numbers in tabular/mono figures.

| Token | Light | Dark |
|---|---|---|
| bg (paper) | #E8ECE4 | #0F2127 |
| surface (sheet) | #F5F7F2 | #17303A |
| ink | #10242B | #E4EBE3 |
| ink-2 | #3F5459 | #B4C4C0 |
| lake (primary) | #1F6F78 | #6CC3C6 |
| ok | #2F7A4B | #7FD19B |
| bad | #B8322A | #F08A78 |
| gold (seal) | #E7B425 | #E7B425 |
| track | #D9480F | #FF8A4C |
| feed/media bg | #071419 | #071419 |

Native apps should **replace** stray greens (iOS `Theme.accent` 0.05/0.62/0.47, Android `Green`
#0F7A4A) with these tokens so all three platforms are recognisably the same product.

## One visual vocabulary on every platform

Same glyph = same meaning everywhere. Use SF Symbols on iOS, Material Symbols on Android, inline SVG
(or a small icon set) on web.

| Concept | Glyph | Notes |
|---|---|---|
| Intent | quote / target | hollow ring dot |
| Proof | record dot / camera | filled orange dot |
| Result | seal | gold dot with halo |
| Chain check | link | |
| Timing check | clock | |
| Physics check | speedometer / gauge | |
| Frames check | photo | |
| AI check | sparkles | |
| Witness | eye / person.wave | |
| GPS / place | location pin | |
| Motion | waveform | |
| Ladder / credits | stairs / bolt-coin | |
| On-device (hybrid) | iphone / smartphone chip | label "on device" |
| Cloud | cloud | label "cloud" |

**Check pips**: 5 small circles in a row, each with its glyph: filled ok-green = passed, red ring =
failed, grey = pending. Never a sentence where a pip will do; sentence lives behind a tap / tooltip.

**Score ring**: circular gauge showing P(true) as an arc, the big % in the middle, and a small
tick on the ring at the **bar** (AI-set threshold). Arc colour: gold if ≥ bar, ink-2 if pending,
bad if below. This replaces "81% likely true · bar 80%" text wherever there's room.

**Ladder preview**: per module, a mini bar showing current → pass / fail outcome as two arrows on
one track ("0.62 → 0.79 ↑ / 0.50 ↓"), not a sentence.

## Principles (apply page by page)

1. **Glance first.** Each screen answers its one question in < 1 s with one hero element
   (photo, score ring, live map, big record button). Everything else is secondary.
2. **Overlay, don't stack.** Put stats, pips and status *on* the media (photo/video/map) with
   scrims, chips and corner badges instead of stacking cards below it.
3. **Numbers + glyphs over sentences.** Labels ≤ 2 words. Long explanations move into an info
   button, a tooltip/popover, a bottom sheet, or disclosure ("Why?").
4. **Progressive disclosure.** Default view fits one screen on a 390×844 phone without scrolling
   where reasonable; detail behind tabs/segmented controls, expandable rows, or sheets.
5. **Horizontal for collections.** Frames, clips, claims and ladder modules as horizontal
   carousels/chips rather than long vertical lists.
6. **Status always visible.** Recording state, offline/sync state, guest vs signed-in, credits —
   as compact persistent indicators (pill in toolbar/top bar), not banners of prose.
7. **Empty / loading / error states** are visual: illustration-ish glyph + one line + one action.
   Skeletons/shimmer instead of spinners for content.
8. **Motion with purpose**, ≤ 400 ms, always honours reduce-motion.
9. **Copy diet.** Cut every paragraph to one line or remove it. Keep *meaning* (judges need to
   understand hybrid AI: "on device" vs "cloud" badges do this visually).

## Pages (each platform has its equivalents)

- **Feed**: already a full-screen pager. Tighten: score ring + stamp in the result block, check
  pips with glyphs, hybrid badges, intro page as 3 big glyph tiles instead of paragraphs, filter
  tabs as a compact segmented pill over the media.
- **Evidence room (detail)**: hero media (photo/video) with overlaid stamp + score ring + key stats
  (time, distance, shots, claims); sticky Intent/Proof/Result segmented jump bar; frames as a
  filmstrip; map with track overlaid stats; checks as a pip grid that expands; AI opinions as three
  compact cards side by side / horizontal (judge, skeptic, scorer) each with a verdict glyph + one
  line + "more"; hash chain as a visual chain of links (collapsed by default).
- **Record / interview**: conversational bubbles, big mic button, structured intention shown as
  claim chips (action / count / measure / place / time / object / outcome with glyphs) and a bar
  preview ring. Minimal text.
- **Live recording**: camera/map full-bleed, overlaid HUD: elapsed timer, GPS + motion live
  indicators, chunk counter with chain glyph, shots count, witness request as a floating card with
  a single "Show" action, coach result as a transient toast (green "keep going" / amber "retake").
  Big stop/shot buttons in the thumb zone.
- **Review / submit**: summary as a single card with track sketch + stats + upload progress ring.
- **Me**: profile header with credits pill + counts (verified / not / pending) as stat tiles; Moments
  as a 2-column grid of thumbnails with status badge overlay (not a text list); guest state = one
  card with sign-in CTA.
- **Ladder**: module cards in a horizontal carousel or compact grid, each with glyph, cost, and the
  pass/fail preview bar.
- **Sign-in / guest**: one hero line, one button, glyph-based value props (3 tiles).
- **Settings** (Android/iOS): standard platform list styles.
- **Embed** (web): compact badge card: stamp + score ring + intention + link.

## Store norms & best practices checklist

**iOS (HIG / App Store)**: touch targets ≥ 44×44 pt; respect safe areas & Dynamic Island; support
Dynamic Type (use text styles, no fixed font sizes for body text; layouts survive XXL); dark mode;
SF Symbols; standard `TabView`, `NavigationStack`, sheets with detents; `.accessibilityLabel` on
icon-only buttons and on pips/rings (`"Chain check passed"`); contrast ≥ 4.5:1; reduce motion;
haptics on record start/stop/seal (`.sensoryFeedback`); no custom back buttons that break swipe back.

**Android (Material 3 / Play)**: touch targets ≥ 48×48 dp; edge-to-edge with correct
`WindowInsets` padding (targetSdk 36 forces it); predictive back compatible (`BackHandler` not
blocking); Material 3 components (`NavigationBar`, `TopAppBar`, `ModalBottomSheet`,
`SegmentedButton`, `FilterChip`); dark theme; `contentDescription` on icon-only elements;
`sp` for text, honour font scale up to 200 % without clipping; contrast ≥ 4.5:1; adaptive +
monochrome (themed) launcher icon present.

**Web**: responsive 320 → 1440 px (phone layout = same visual language as native, desktop = centered
column or two-pane where useful), no horizontal scroll; WCAG AA contrast; visible `:focus-visible`;
keyboard reachable; `aria-label` on icon buttons, `role="img"` + label on rings/pips;
`prefers-reduced-motion`; `prefers-color-scheme` + `data-theme`; tap targets ≥ 44 px; correct
`<meta viewport>`, `theme-color`, web app manifest + icons (PWA installable); `safe-area-inset`
padding for iOS Safari; images lazy-loaded with explicit sizes (no CLS).

## Rules for implementers

- UI only. Do not change data, sync, hashing, seal, AI calls, auth flows, routes or public URLs.
  Keep all test ids / selectors that existing scripts or tests use (grep `scripts/` and tests).
- Keep every existing feature reachable; moving it behind a sheet/tab/disclosure is fine.
- Existing tests and type checks must pass.
- Commit in small, page-sized commits.

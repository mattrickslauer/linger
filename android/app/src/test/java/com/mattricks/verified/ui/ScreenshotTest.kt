package com.mattricks.verified.ui

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the redesigned screens to PNGs (Roborazzi). Not assertions: run with
 * `./gradlew :app:recordRoborazziDebug -Dshots.dir=/abs/dir` to look at them. Without the record flag they just compose.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = Application::class, sdk = [35], qualifiers = "w390dp-h844dp-xxhdpi")
class ScreenshotTest {
    @Test fun feedIntro() = shot("feed-intro") { MediaTheme { FeedIntro(null, listOf(fakeCard(), fakeCard("m2", "rejected")), {}) } }

    @Test fun feedSlideSealed() = shot("feed-slide-sealed") { MediaTheme { FeedSlide(fakeCard(), active = true, reduceMotion = true, player = null, onOpen = {}) } }

    @Test fun feedSlideRejected() = shot("feed-slide-rejected") {
        MediaTheme {
            FeedSlide(
                fakeCard(status = "rejected", score = 0.41, bar = 0.74, seed = 2, checks = mapOf("chain" to true, "timing" to true, "physics" to false, "frames" to true, "ai" to false)),
                active = true, reduceMotion = true, player = null, onOpen = {},
            )
        }
    }

    @Config(fontScale = 2.0f)
    @Test fun meGridFont200() = shot("me-grid-font200") { MeContent() }

    @Config(fontScale = 2.0f)
    @Test fun feedSlideFont200() = shot("feed-slide-font200") { MediaTheme { FeedSlide(fakeCard(), active = true, reduceMotion = true, player = null, onOpen = {}) } }

    @Config(fontScale = 2.0f)
    @Test fun liveFont200() { offlineMapsOnly = true; shot("live-font200", dark = true) {
        LiveHud(
            liveUi.copy(witness = null), com.mattricks.verified.data.Prefs.CaptureMode.Photo, null, false, false, {}, {},
            WitnessActions({}, {}, {}, {}, {}), {}, {}, {},
            media = { mini, full -> B64Image(fakePhoto(1), full); TrackMap(liveUi.track, mini, live = true, compact = true) },
        )
    } }

    @Test fun meGrid() = shot("me-grid") { MeContent() }
    @Test fun meGridDark() = shot("me-grid-dark", dark = true) { MeContent() }

    @androidx.compose.runtime.Composable
    private fun MeContent() = Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ProfileHeader(null)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile(4, "Verified", Glyph.Result, SealGold, Modifier.weight(1f))
            StatTile(1, "Not verified", Glyph.Warning, FillBad, Modifier.weight(1f))
            StatTile(2, "Pending", Glyph.Timing, FillLake, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) { MomentTile(fakeCard(), {}, onDelete = {}) }
            Column(Modifier.weight(1f)) { MomentTile(fakeCard("m2", "rejected", "Run 5 km along the lake trail", 0.41, seed = 1), {}) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) { MomentTile(fakeCard("m3", "submitted", "Build a birdhouse", null, 0.6, photo = false), {}) }
            Column(Modifier.weight(1f)) { MomentTile(fakeCard("m4", "submitted", "50 push-ups", null, null, seed = 2, local = true), {}, onUpload = {}) }
        }
    }

    @Test fun detail() { offlineMapsOnly = true; shot("detail") { DetailBody(fakeDetail(), {}, {}, {}) } }

    @Config(qualifiers = "w390dp-h3000dp-xxhdpi")
    @Test fun detailFull() { offlineMapsOnly = true; shot("detail-full") { DetailBody(fakeDetail(), {}, {}, {}) } }

    @Config(qualifiers = "w390dp-h3000dp-xxhdpi")
    @Test fun detailFullDark() { offlineMapsOnly = true; shot("detail-full-dark", dark = true) { DetailBody(fakeDetail("rejected"), {}, null, {}) } }

    private val liveUi = com.mattricks.verified.record.RecUi(
        phase = com.mattricks.verified.record.RecUi.Phase.Recording, momentId = "m1", intention = "Catch and release a largemouth bass",
        startedAt = 1_764_000_000_000, elapsedMs = 734_000, distanceM = 612.0, accuracyM = 6.0, frameCount = 3, chunksTotal = 9,
        sparkline = (0 until 30).map { 9.8f + kotlin.math.sin(it / 3.0).toFloat() }, heartRate = 112, witnessAsked = 1,
        track = fakeTrack.take(20),
        coach = com.mattricks.verified.chain.Check(true, "", "on_device", "fish"),
        witness = com.mattricks.verified.record.WitnessAsk("w1", "Show the fish next to the rod", "show", "Ties the catch to your gear", "on_device", 0.2, "r1"),
        plan = com.mattricks.verified.data.Plan(
            listOf(
                com.mattricks.verified.data.Requirement("r1", "c1", "frames", "Photo of the fish on the line"),
                com.mattricks.verified.data.Requirement("r2", "c1", "video", "10 s clip of landing it", 10.0),
                com.mattricks.verified.data.Requirement("r3", "c2", "gps", "GPS at the lake"),
            ),
            "photo", "",
        ),
        captured = mapOf("r3" to true),
    )

    @Test fun live() { offlineMapsOnly = true; shot("live", dark = true) {
        LiveHud(
            liveUi, com.mattricks.verified.data.Prefs.CaptureMode.Photo, null, false, false, {}, {},
            WitnessActions({}, {}, {}, {}, {}), {}, {}, {},
            media = { mini, full ->
                B64Image(fakePhoto(1), full)
                TrackMap(liveUi.track, mini, live = true, compact = true)
            },
        )
    } }

    @Test fun finished() = shot("finished") {
        FinishedContent(liveUi.copy(phase = com.mattricks.verified.record.RecUi.Phase.Finished, hasVideo = false), false, true, null, true, {}, {}, {})
    }

    @Test fun interview() = shot("interview") {
        val i = com.mattricks.verified.data.Intention(
            "Catch and release a largemouth bass at Lake Mission Viejo", "fishing", v = 4, activity = "fishing", goal = "Land a bass and release it",
            place = com.mattricks.verified.data.Place("Lake Mission Viejo", null, null, "CA", "US"), expectedMinutes = 45.0,
            assumptions = listOf("You are at the lake now", "Catch and release"), interviewTurns = 2, interviewMode = "on_device",
            preview = com.mattricks.verified.data.IntentionPreview(0.74, 0.53, "on_device", "Named place and species."),
            claims = listOf(com.mattricks.verified.data.Claim("c1", "action", "Catch a largemouth bass"), com.mattricks.verified.data.Claim("c2", "place", "At Lake Mission Viejo")),
            plan = liveUi.plan,
        )
        InterviewContent(
            com.mattricks.verified.record.InterviewUi(
                com.mattricks.verified.record.InterviewUi.Phase.Ready,
                listOf(
                    com.mattricks.verified.record.Turn(true, "going fishing"),
                    com.mattricks.verified.record.Turn(false, "Nice! Where, and what are you after?", "on_device"),
                    com.mattricks.verified.record.Turn(true, "Lake Mission Viejo, largemouth bass, catch and release"),
                ),
                i,
            ),
            "", 0f, {}, {}, {}, {}, {}, {}, {}, {}, {},
        )
    }

    @Test fun interviewStart() = shot("interview-start") {
        InterviewContent(com.mattricks.verified.record.InterviewUi(), "", 0f, {}, {}, {}, {}, {}, {}, {}, {}, {})
    }

    @Test fun launcherIcon() = shot("launcher-icon") {
        Row(Modifier.padding(24.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            androidx.compose.foundation.layout.Box(Modifier.size(144.dp).clip(androidx.compose.foundation.shape.CircleShape)) {
                androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(com.mattricks.verified.R.drawable.ic_launcher_background), null, Modifier.size(144.dp))
                androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(com.mattricks.verified.R.drawable.ic_launcher_foreground), null, Modifier.size(144.dp))
            }
            androidx.compose.foundation.layout.Box(Modifier.size(144.dp).clip(androidx.compose.foundation.shape.CircleShape).background(androidx.compose.ui.graphics.Color(0xFF2B4A5A))) {
                androidx.compose.foundation.Image(
                    androidx.compose.ui.res.painterResource(com.mattricks.verified.R.drawable.ic_launcher_monochrome), null, Modifier.size(144.dp),
                    colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(androidx.compose.ui.graphics.Color(0xFFCDEDEE)),
                )
            }
        }
    }

    @Test fun vocabulary() = shot("vocabulary") { Vocab() }
    @Test fun vocabularyDark() = shot("vocabulary-dark", dark = true) { Vocab() }

    @androidx.compose.runtime.Composable
    private fun Vocab() = Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ScoreRing(0.86, 0.74, size = 88.dp)
            ScoreRing(0.41, 0.74, size = 88.dp)
            ScoreRing(null, 0.74, size = 88.dp)
            ScoreRing(null, 0.62, size = 88.dp, centerText = "62", caption = "bar")
        }
        CheckPips(mapOf("chain" to true, "timing" to true, "physics" to false, "frames" to true), labels = true)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusBadge("sealed"); StatusBadge("rejected"); StatusBadge("submitted"); StatusBadge("x", local = true)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { HybridBadge("on_device"); HybridBadge("cloud"); HybridBadge("none") }
        PreviewBar(0.62, 0.79, 0.50, 0.74, Modifier.width(240.dp))
        GlyphTile(Glyph.Proof, "Proof", "GPS, motion, shots. Hash-chained live.", Modifier.fillMaxWidth())
    }
}

package com.mattricks.verified.ui

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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

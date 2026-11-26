package com.mattricks.verified.ui

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mattricks.verified.data.Prefs
import com.mattricks.verified.record.InterviewUi
import com.mattricks.verified.record.RecUi
import com.mattricks.verified.record.Turn
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The app shell + key screens on a small phone, a tall notched phone and the notched phone in landscape, with system
 * bar / cutout insets applied (magenta in the PNGs). Checks by eye: nothing readable or tappable under magenta, no
 * double gaps. `./gradlew :app:recordRoborazziDebug -Pshots.dir=/abs/dir --tests '*DeviceShotTest*'`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = Application::class, sdk = [35])
class DeviceShotTest {
    private fun each(name: String, dark: Boolean = false, imeDp: Int = 0, content: @Composable () -> Unit) =
        Dev.entries.forEach { deviceShot("dev-$name-${it.name.lowercase()}", it, dark, imeDp, content) }

    @Test fun feedIntro() = each("feed-intro", dark = true) {
        AppFrame(0, mediaTab = true, onTab = {}) {
            MediaTheme {
                Box(Modifier.fillMaxSize().background(TokBg)) {
                    FeedIntro(null, listOf(fakeCard(), fakeCard("m2", "rejected")), {})
                    FeedFilters("all", Modifier.align(Alignment.TopCenter)) {}
                }
            }
        }
    }

    @Test fun feedSlide() = each("feed-slide", dark = true) {
        AppFrame(0, mediaTab = true, onTab = {}) {
            MediaTheme {
                Box(Modifier.fillMaxSize().background(TokBg)) {
                    FeedSlide(fakeCard(), active = true, reduceMotion = true, player = null, onOpen = {})
                    FeedFilters("all", Modifier.align(Alignment.TopCenter)) {}
                }
            }
        }
    }

    @Test fun live() { offlineMapsOnly = true; each("live", dark = true) {
        AppFrame(1, mediaTab = true, onTab = {}) {
            LiveHud(
                liveUi, Prefs.CaptureMode.Photo, null, false, false, {}, {},
                WitnessActions({}, {}, {}, {}, {}), {}, {}, {},
                media = { mini, full -> B64Image(fakePhoto(1), full); TrackMap(liveUi.track, mini, live = true, compact = true) },
            )
        }
    } }

    @Test fun interview() = each("interview") {
        AppFrame(1, mediaTab = false, onTab = {}) {
            InterviewContent(
                InterviewUi(turns = listOf(Turn(true, "going fishing"), Turn(false, "Nice! Where, and what are you after?", "on_device"))),
                "", 0f, {}, {}, {}, {}, {}, {}, {}, {}, {},
            )
        }
    }

    /** The type-it row must ride on the keyboard, the chat shrinking above it. */
    @Test fun interviewKeyboard() = each("interview-ime", imeDp = 280) {
        AppFrame(1, mediaTab = false, onTab = {}) {
            InterviewContent(InterviewUi(), "", 0f, {}, {}, {}, {}, {}, {}, {}, {}, {})
        }
    }

    @Test fun finished() = each("finished") {
        AppFrame(1, mediaTab = false, onTab = {}) {
            FinishedContent(liveUi.copy(phase = RecUi.Phase.Finished, hasVideo = false), false, true, null, true, {}, {}, {})
        }
    }

    @Test fun me() = each("me") {
        AppFrame(2, mediaTab = false, onTab = {}) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
            }
        }
    }

    /** The evidence room is outside the tab shell: it insets itself. */
    @Test fun detail() { offlineMapsOnly = true; each("detail") { DetailBody(fakeDetail(), {}, {}, {}) } }

    private val liveUi = RecUi(
        phase = RecUi.Phase.Recording, momentId = "m1", intention = "Catch and release a largemouth bass",
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
}

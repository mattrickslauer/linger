package com.mattricks.verified.ui

import android.content.Intent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SyncProblem
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.media3.exoplayer.ExoPlayer
import com.google.firebase.auth.FirebaseUser
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.ai.Ai
import com.mattricks.verified.auth.Auth
import com.mattricks.verified.auth.Gate
import com.mattricks.verified.data.Claims
import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Store
import com.mattricks.verified.data.Vault
import com.mattricks.verified.judge.Judging
import com.mattricks.verified.record.RecordViewModel
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/** The last feed snapshot, so coming back from an evidence room draws the same pages at once (no loading flash). */
private var feedCache: List<MomentCard>? = null

private val FEED_FILTERS = listOf("all" to "All", "sealed" to "Verified", "rejected" to "Not verified")

/**
 * Feed v5: one Moment a screen in a vertical pager, each read as intent → proof → result
 * (docs/superpowers/specs/2026-11-25-feed-intent-proof-result.md). Page 0 is the intro, the last page the end card.
 * Always dark. MainActivity keeps this screen's saveable state while an evidence room is open, so back lands here.
 */
@Composable
fun FeedScreen(user: FirebaseUser?, onOpen: (String) -> Unit, onRecord: () -> Unit) = MediaTheme {
    val items by remember { Store.feed().onEach { feedCache = it } }.collectAsState(initial = feedCache)
    var filter by rememberSaveable { mutableStateOf("all") }
    var lastId by rememberSaveable { mutableStateOf<String?>(null) }
    val all = items
    val shown = remember(all, filter) { all.orEmpty().filter { filter == "all" || it.status == filter } }
    // intro + slides + end card (or a loading page while the first snapshot is on its way)
    val pager = rememberPagerState { 1 + (if (all == null) 1 else shown.size + 1) }
    val scope = rememberCoroutineScope()
    val reduceMotion = rememberReduceMotion()
    // v4.12: one player for the whole feed, lent to the current settled slide while the app is in the foreground.
    val player = rememberFeedPlayer()
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val foreground = lifecycleState.isAtLeast(Lifecycle.State.STARTED)

    // Back from an evidence room: land on the slide you left, even if the list moved meanwhile.
    LaunchedEffect(all != null) {
        val id = lastId ?: return@LaunchedEffect
        if (all == null) return@LaunchedEffect
        val i = shown.indexOfFirst { it.id == id }
        if (i >= 0 && pager.currentPage != i + 1) pager.scrollToPage(i + 1)
    }
    val open: (String) -> Unit = { id -> lastId = id; onOpen(id) }

    Box(Modifier.fillMaxSize().background(TokBg)) {
        VerticalPager(pager, Modifier.fillMaxSize(), beyondViewportPageCount = 1, key = { p ->
            when {
                p == 0 -> "intro"
                all == null -> "loading"
                p <= shown.size -> shown[p - 1].id
                else -> "end"
            }
        }) { p ->
            when {
                p == 0 -> FeedIntro(user, all, onRecord)
                all == null -> SlideSkeleton()
                p <= shown.size -> {
                    val c = shown[p - 1]
                    val active = pager.settledPage == p
                    FeedSlide(c, active = active, reduceMotion = reduceMotion, player = player.takeIf { active && foreground }, onOpen = { open(c.id) })
                }
                else -> FeedEnd(shown.isNotEmpty(), onRecord) {
                    scope.launch { if (reduceMotion) pager.scrollToPage(0) else pager.animateScrollToPage(0) }
                }
            }
        }
        FeedFilters(filter, Modifier.align(Alignment.TopCenter)) { k -> filter = k; lastId = null; scope.launch { pager.scrollToPage(0) } }
    }
}

/** Filter: a compact segmented pill over the media, clear of the status bar / cutout. Each segment is a 48dp target. */
@Composable
internal fun FeedFilters(filter: String, modifier: Modifier, onPick: (String) -> Unit) {
    Row(
        modifier.safeTopAndSides().padding(top = 6.dp)
            .clip(RoundedCornerShape(50)).background(TokBg.copy(alpha = 0.55f)).border(1.dp, TokLine.copy(alpha = 0.4f), RoundedCornerShape(50))
            .padding(horizontal = 4.dp),
    ) {
        FEED_FILTERS.forEach { (k, label) ->
            val on = filter == k
            Box(
                Modifier.heightIn(min = 48.dp).semantics { selected = on }
                    .clickable(role = Role.Tab) { if (filter != k) onPick(k) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label, color = if (on) TokBg else TokInk, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) TokInk else Color.Transparent)
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                )
            }
        }
    }
}

/** Loading page: the slide's shape in still blocks, no spinner. */
@Composable
private fun SlideSkeleton() {
    val block = TokInk.copy(alpha = 0.08f)
    Column(Modifier.fillMaxSize().safeTopAndSides().padding(start = 20.dp, end = 84.dp, top = 72.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.fillMaxWidth(0.4f).height(16.dp).clip(RoundedCornerShape(8.dp)).background(block))
        Box(Modifier.fillMaxWidth().height(34.dp).clip(RoundedCornerShape(8.dp)).background(block))
        Box(Modifier.fillMaxWidth(0.7f).height(34.dp).clip(RoundedCornerShape(8.dp)).background(block))
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { repeat(5) { Box(Modifier.size(26.dp).clip(CircleShape).background(block)) } }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(120.dp, 48.dp).clip(RoundedCornerShape(7.dp)).background(block))
            Box(Modifier.size(60.dp).clip(CircleShape).background(block))
        }
    }
}

/** Page 0: one hero line, the three waypoints as glyph tiles, live counts, Record a Moment. */
@Composable
internal fun FeedIntro(user: FirebaseUser?, all: List<MomentCard>?, onRecord: () -> Unit) {
    // Centred when it fits; scrolls (inside the page) on short screens instead of clipping the Record button.
    BoxWithConstraints(Modifier.fillMaxSize().safeTopAndSides()) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = maxHeight).padding(start = 24.dp, end = 24.dp, top = 64.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Proof it happened.", color = TokInk, fontSize = 38.sp, lineHeight = 40.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.8).sp)
            Spacer(Modifier.height(8.dp))
            Text("Recorded live. Argued by AI. Sealed by code.", color = TokInk2, fontSize = 16.sp, lineHeight = 22.sp)
            Spacer(Modifier.height(22.dp))
            IntroStep(Wp.Intent, Glyph.Intent, "Intent", "Said before starting.")
            IntroStep(Wp.Proof, Glyph.Proof, "Proof", "GPS, motion, shots. Hash-chained live.", badge = "on_device")
            IntroStep(Wp.Result, Glyph.Result, "Result", "Judge, skeptic, scorer. Code seals.", badge = "cloud", last = true)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val sealed = all?.count { it.status == "sealed" }
                IntroCount(sealed?.toString() ?: "–", "verified", SealGold, Modifier.weight(1f))
                IntroCount(all?.let { (it.size - (sealed ?: 0)).toString() } ?: "–", "not verified", TokBad, Modifier.weight(1f))
            }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                RecordButton(onRecord)
                Spacer(Modifier.width(8.dp))
                if (user == null) TextButton(onClick = { Gate.signIn() }) { Text("Sign in", color = TokInk) }
                Spacer(Modifier.weight(1f))
                Icon(Icons.Filled.KeyboardArrowUp, "Swipe up for Moments", tint = TokInk2, modifier = Modifier.size(32.dp))
            }
        }
    }
}

@Composable
private fun IntroStep(kind: Wp, icon: ImageVector, title: String, line: String, badge: String? = null, last: Boolean = false) {
    SlideWaypoint(kind, ok = true, last = last) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = if (kind == Wp.Result) SealGold else TrackOrange, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(title, color = TokInk, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            if (badge != null) { Spacer(Modifier.width(8.dp)); HybridBadge(badge, onMedia = true) }
        }
        Spacer(Modifier.height(2.dp))
        Text(line, color = TokInk2, fontSize = 14.sp, lineHeight = 19.sp)
    }
}

@Composable
private fun IntroCount(n: String, label: String, accent: Color, modifier: Modifier) {
    Row(
        modifier.clip(RoundedCornerShape(16.dp)).background(TokInk.copy(alpha = 0.07f)).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(accent))
        Spacer(Modifier.width(8.dp))
        Text(n, color = TokInk, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, style = Tnum)
        Spacer(Modifier.width(6.dp))
        Text(label, color = TokInk2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun FeedEnd(any: Boolean, onRecord: () -> Unit, onTop: () -> Unit) {
    Column(Modifier.fillMaxSize().safeTopAndSides().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(84.dp).clip(CircleShape).background(TokInk.copy(alpha = 0.08f)), contentAlignment = Alignment.Center) {
            Icon(if (any) Glyph.Result else Glyph.Proof, null, tint = if (any) SealGold else TrackOrange, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(if (any) "That's every Moment." else "Nothing here yet.", color = TokInk, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(6.dp))
        Text(if (any) "Yours shows up here once sealed." else "Record the first one.", color = TokInk2)
        Spacer(Modifier.height(20.dp))
        RecordButton(onRecord)
        if (any) TextButton(onClick = onTop, modifier = Modifier.padding(top = 6.dp)) {
            Icon(Icons.Filled.VerticalAlignTop, null, tint = TokInk, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Back to the top", color = TokInk)
        }
    }
}

@Composable
private fun RecordButton(onRecord: () -> Unit) = Button(
    onClick = onRecord, shape = RoundedCornerShape(28.dp), modifier = Modifier.heightIn(min = 52.dp),
    colors = ButtonDefaults.buttonColors(containerColor = TokInk, contentColor = TokBg),
) {
    Icon(Icons.Filled.FiberManualRecord, null, tint = FillBad, modifier = Modifier.size(16.dp))
    Spacer(Modifier.width(8.dp))
    Text("Record a Moment", fontWeight = FontWeight.Bold)
}

private val textShadow = Shadow(Color(0x99000000), Offset(0f, 2f), 6f)

/**
 * One waypoint on the slide thread: its dot in a 14dp gutter, and (unless [last]) the dashed track from under the dot
 * to the bottom of the block, drawn [line] of the way. [arrive] fades the dot and the text in.
 */
@Composable
private fun SlideWaypoint(
    kind: Wp, ok: Boolean, modifier: Modifier = Modifier, last: Boolean = false, line: Float = 1f, arrive: Float = 1f,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(
        modifier.fillMaxWidth().drawBehind {
            if (!last) dashedTrack(7.dp.toPx(), 14.dp.toPx() + 12.dp.toPx(), size.height - 4.dp.toPx(), if (ok) TrackOrange else TokInk2, line)
        },
    ) {
        Canvas(Modifier.padding(top = 4.dp).size(14.dp).arrive(arrive)) { waypointDot(kind, ok, center) }
        Column(Modifier.padding(start = 28.dp, bottom = 22.dp).arrive(arrive), content = content)
    }
}

@Composable
private fun WpLabel(label: String, sub: String?, trailing: (@Composable () -> Unit)? = null) = Row(verticalAlignment = Alignment.CenterVertically) {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = TokInk)) { append(label) }
            if (!sub.isNullOrBlank()) withStyle(SpanStyle(color = TokInk2)) { append("  "); append(sub) }
        },
        fontSize = 15.sp, style = TextStyle(shadow = textShadow), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
    )
    if (trailing != null) { Spacer(Modifier.width(8.dp)); trailing() }
}

/** The slide template, identical for every Moment: intent → proof → result over the proof photo. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FeedSlide(c: MomentCard, active: Boolean, reduceMotion: Boolean, player: ExoPlayer?, onOpen: () -> Unit) {
    val ok = c.status == "sealed" && !c.cheating
    val ctx = LocalContext.current
    // The one reveal, played once when the slide first settles: track segments draw, waypoints arrive in order, the
    // stamp lands (ms timeline). Reduce motion: everything is already in place.
    val t = remember(c.id) { Animatable(if (reduceMotion) 1300f else 0f) }
    LaunchedEffect(active) {
        if (active && t.value < 1300f) t.animateTo(1300f, tween((1300 - t.value).toInt(), easing = LinearEasing))
    }
    val ms = t.value
    val ease = FastOutSlowInEasing
    val stampP = OvershootEasing.transform(seg(ms, 800f, 1220f))

    BoxWithConstraints(Modifier.fillMaxSize().clickable(onClickLabel = "Inspect the evidence", onClick = onOpen)) {
        // Landscape / split screen: too short for the three blocks stacked to fit, so the text scrolls (inside the
        // page; the pager takes over at either end) and the rail sits low.
        val short = maxHeight < SHORT_SLIDE
        val bmp = remember(c.heroJpegB64) { decodeB64(c.heroJpegB64)?.asImageBitmap() }
        if (bmp != null) Image(
            bmp, "Proof shot: ${c.intention}", Modifier.fillMaxSize(), contentScale = ContentScale.Crop,
            colorFilter = if (ok) null else ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.3f) }),
        ) else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF10343B), TokBg))))
        // v4.12: the feed clip plays over the photo on the current slide only (muted, looping, no controls).
        val clip = c.feedClip
        var muted by remember(c.id) { mutableStateOf(true) }
        if (clip != null && player != null) FeedVideo(clip, player, muted, Modifier.fillMaxSize())
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to TokBg.copy(alpha = 0.9f), 0.26f to TokBg.copy(alpha = 0.4f), 0.40f to Color.Transparent,
                    0.46f to Color.Transparent, 0.62f to TokBg.copy(alpha = 0.7f), 1f to TokBg.copy(alpha = 0.95f),
                ),
            ),
        )

        Column(
            Modifier.fillMaxSize().safeTopAndSides().then(if (short) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                .padding(start = 20.dp, end = 84.dp, top = 64.dp, bottom = 20.dp),
        ) {
            // 1. Intent: takes the slack, so the photo shows between it and the proof.
            SlideWaypoint(Wp.Intent, ok, if (short) Modifier else Modifier.weight(1f), line = ease.transform(seg(ms, 100f, 600f)), arrive = ease.transform(seg(ms, 0f, 450f))) {
                WpLabel("Intent", c.ownerName.ifBlank { "Someone" })
                Spacer(Modifier.height(6.dp))
                val quote = if (ok) TrackOrange else TokInk2
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = quote)) { append("“") }
                        append(c.intention)
                        withStyle(SpanStyle(color = quote)) { append("”") }
                    },
                    color = TokInk, fontSize = 30.sp, lineHeight = 32.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp,
                    style = TextStyle(shadow = textShadow), maxLines = 4, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 300.dp),
                )
            }
            // 2. Proof: numbers + glyphs, the five pips, the hybrid badge.
            SlideWaypoint(Wp.Proof, ok, line = ease.transform(seg(ms, 350f, 850f)), arrive = ease.transform(seg(ms, 250f, 700f))) {
                WpLabel("Proof", agoText(c.sealedAt).ifBlank { "live" }) { HybridBadge(c.onDeviceMode, onMedia = true) }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (c.track.size > 1) { TrackSketch(c.track, Modifier.size(56.dp, 44.dp)); Spacer(Modifier.width(12.dp)) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        StatOverlay(Glyph.Time, fmtDuration(c.summary.durationMs))
                        StatOverlay(Glyph.Distance, fmtDistance(c.summary.distanceM))
                        StatOverlay(Glyph.Frames, "${c.summary.frameCount}")
                    }
                }
                Spacer(Modifier.height(10.dp))
                CheckPips(c.checks, onMedia = true)
                val extras = listOfNotNull(
                    c.claimsTotal?.takeIf { it > 0 && c.claimsBacked != null }?.let { Triple(Glyph.Result, "${c.claimsBacked}/$it", "claims backed") },
                    c.ladderCount.takeIf { it > 0 }?.let { Triple(Glyph.Ladder, "+$it", "extra checks") },
                    c.witnessAsked.takeIf { it > 0 }?.let { Triple(Glyph.Witness, "${c.witnessAnswered}/$it", "witness answers") },
                )
                if (extras.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        extras.forEach { (icon, v, what) ->
                            ScrimChip(Modifier.semantics(mergeDescendants = true) { contentDescription = "$v $what" }) { StatOverlay(icon, v) }
                        }
                    }
                }
            }
            // 3. Result: the stamp and the score ring (tick = the AI-set bar).
            SlideWaypoint(Wp.Result, ok, last = true, arrive = ease.transform(seg(ms, 500f, 950f))) {
                WpLabel("Result", null)
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SealStamp(
                        ok,
                        Modifier.graphicsLayer {
                            alpha = seg(ms, 800f, 900f)
                            val s = 1.9f - 0.9f * stampP
                            scaleX = s; scaleY = s
                            rotationZ = -12f + 8f * stampP
                        },
                    )
                    Spacer(Modifier.width(14.dp))
                    if (c.score != null || c.bar != null) ScoreRing(c.score, c.bar, size = 60.dp, onMedia = true)
                }
                val reason = when {
                    c.cheating -> c.cheatingSignals.firstOrNull() ?: "Cheating detected"
                    c.status == "sealed" -> c.scoreReasons.firstOrNull() ?: c.judgeReasons.firstOrNull()
                    else -> c.sealReason
                }
                if (!reason.isNullOrBlank()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        reason, color = TokInk2, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        style = TextStyle(shadow = textShadow), modifier = Modifier.widthIn(max = 300.dp),
                    )
                }
            }
        }

        // Right rail, lower third (thumb zone).
        Column(
            Modifier.align(Alignment.BottomEnd).safeSides().padding(end = 12.dp, bottom = if (short) 16.dp else 170.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (clip != null && player != null) MuteButton(muted) { muted = !muted }
            RailButton(Icons.Filled.Search, "Evidence", primary = true, onClick = onOpen)
            RailButton(Icons.Filled.Share, "Share") {
                val url = "$SHARE_HOST/m/${c.id}"
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"; putExtra(Intent.EXTRA_SUBJECT, c.intention); putExtra(Intent.EXTRA_TEXT, url)
                }
                runCatching { ctx.startActivity(Intent.createChooser(send, "Share this Moment")) }
            }
        }
    }
}

/** Public web host for share links (`/m/{id}` opens the Moment's evidence room). */
private const val SHARE_HOST = "https://verified-99e74.web.app"

/** Below this the slide's blocks don't fit stacked (phone in landscape, split screen). */
private val SHORT_SLIDE = 520.dp

private val OvershootEasing = CubicBezierEasing(0.3f, 1.5f, 0.5f, 1f)

@Composable
private fun RailButton(icon: ImageVector, label: String, primary: Boolean = false, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onClick).padding(4.dp),
    ) {
        Box(
            Modifier.size(52.dp).clip(CircleShape).background(if (primary) TokInk else TokBg.copy(alpha = 0.6f))
                .border(1.dp, TokLine, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, null, tint = if (primary) TokBg else TokInk, modifier = Modifier.size(24.dp)) }
        Spacer(Modifier.height(4.dp))
        Text(label, color = TokInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, style = TextStyle(shadow = textShadow))
    }
}

// ───────────────────────── Me

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MeScreen(user: FirebaseUser?, onOpen: (String) -> Unit) {
    val items by remember(user?.uid) { user?.let { Store.myMoments(it.uid) } ?: flowOf(emptyList()) }.collectAsState(initial = null)
    val guests by Vault.guests.collectAsState()
    val uploading by Claims.uploading.collectAsState()
    val judging by Judging.status.collectAsState()
    val nano by Ai.onDeviceState.collectAsState()
    val held by Vault.held.collectAsState()
    val recordingId by RecordViewModel.recording.collectAsState()
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val local = guests.map { Store.localCard(it) }
    val all = items?.let { local + it }
    val full = GridItemSpan(2)

    LazyVerticalGrid(
        GridCells.Fixed(2), Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(span = { full }, key = "profile") { ProfileHeader(user) }
        item(span = { full }, key = "stats") {
            val list = all.orEmpty()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatTile(list.count { it.status == "sealed" && !it.cheating }, "Verified", Glyph.Result, SealGold, Modifier.weight(1f))
                StatTile(list.count { it.status == "rejected" || it.cheating }, "Not verified", Icons.Filled.Block, FillBad, Modifier.weight(1f))
                StatTile(list.count { it.status == "submitted" || it.status == "recording" || it.local }, "Pending", Icons.Filled.HourglassTop, FillLake, Modifier.weight(1f))
            }
        }
        item(span = { full }, key = "status") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val (nanoText, nanoMode) = when (nano) {
                    "available" -> "Nano ready" to "on_device"
                    "downloading" -> "Nano downloading" to "on_device"
                    "checking" -> "Nano…" to "on_device"
                    else -> "cloud only" to "cloud"
                }
                StripChip(if (nanoMode == "on_device") Glyph.OnDevice else Glyph.Cloud, nanoText)
                if (user != null) {
                    val conflicts = held.count { it.value == Vault.State.Conflict }
                    when {
                        held.isEmpty() -> StripChip(Icons.Filled.CloudDone, "all synced", Ok)
                        conflicts > 0 -> StripChip(Icons.Filled.SyncProblem, "$conflicts differ · kept here", Bad)
                        else -> StripChip(Glyph.OnDevice, "${held.size} held on phone", Warn)
                    }
                }
                if (local.isNotEmpty()) StripChip(Glyph.OnDevice, "${local.size} guest on phone", Warn)
                if (uploading.isNotEmpty()) StripChip(Icons.Filled.CloudUpload, "uploading ${uploading.size}", Lake)
                judging?.let { StripChip(Glyph.Ai, it, Lake) }
                if (BuildConfig.USE_EMULATOR) StripChip(Icons.Filled.SyncProblem, "emulator ${BuildConfig.EMULATOR_HOST}", Warn)
            }
        }
        if (user != null && local.any { it.status == "submitted" && it.id !in uploading }) item(span = { full }, key = "upload") {
            FilledTonalButton(onClick = { Claims.claim(local.filter { it.status == "submitted" }.map { it.id }) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Filled.CloudUpload, null); Spacer(Modifier.width(8.dp)); Text("Upload guest Moments")
            }
        }
        when {
            all == null -> items(4) { Skeleton(Modifier.fillMaxWidth().aspectRatio(0.78f)) }
            all.isEmpty() -> item(span = { full }, key = "empty") { EmptyState(Glyph.Proof, "Your Moments show up here.") }
            else -> items(all, key = { it.id }) { c ->
                val canDelete = (c.local || canDeleteMoment(c, user?.uid, recordingId)) && c.id != recordingId
                val canUpload = c.local && c.status == "submitted" && c.id !in uploading
                MomentTile(
                    c, onClick = { onOpen(c.id) },
                    onDelete = if (canDelete) ({ confirmDelete = c.id }) else null,
                    onUpload = if (canUpload) ({ Gate.require("verify this Moment") { Claims.claim(listOf(c.id)) } }) else null,
                    uploading = c.id in uploading,
                )
            }
        }
    }
    confirmDelete?.let { id ->
        DeleteMomentDialog(
            onConfirm = { confirmDelete = null; Store.deleteMoment(id) },
            onDismiss = { confirmDelete = null },
        )
    }
}

/** Avatar, name, credits pill; guest = one card with the sign-in CTA. */
@Composable
internal fun ProfileHeader(user: FirebaseUser?) {
    if (user == null) {
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(24.dp)) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                    Icon(Glyph.OnDevice, null, tint = MaterialTheme.colorScheme.onPrimary)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Guest", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Text("Moments stay on this phone", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
                Button(onClick = { Gate.signIn() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Sign in") }
            }
        }
        return
    }
    var menu by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        val name = user.displayName?.takeIf { it.isNotBlank() } ?: "Signed in"
        Box(Modifier.size(52.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
            Text(name.first().uppercase(), color = MaterialTheme.colorScheme.onPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(user.email ?: if (user.isAnonymous) "test user" else "", style = MaterialTheme.typography.bodySmall, color = Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        CreditsPill()
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Account") }
            DropdownMenu(menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text("Sign out") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, null) },
                    onClick = { menu = false; Auth.signOut() },
                )
            }
        }
    }
}

@Composable
internal fun StatTile(n: Int, label: String, icon: ImageVector, accent: Color, modifier: Modifier) {
    Surface(modifier.semantics(mergeDescendants = true) {}, color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(22.dp).clip(CircleShape).background(accent), contentAlignment = Alignment.Center) {
                    Icon(icon, null, Modifier.size(13.dp), tint = contentOn(accent))
                }
                Spacer(Modifier.width(8.dp))
                Text("$n", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, style = Tnum)
            }
            Text(label, style = MaterialTheme.typography.labelMedium, color = Ink2, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun StripChip(icon: ImageVector, text: String, tint: Color = Ink2) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(50)) {
        Row(Modifier.padding(start = 8.dp, end = 10.dp, top = 5.dp, bottom = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(14.dp), tint = tint)
            Spacer(Modifier.width(5.dp))
            Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A Moment as a thumbnail: proof photo, status badge and score ring overlaid, intention on a scrim. */
@Composable
fun MomentTile(c: MomentCard, onClick: () -> Unit, onDelete: (() -> Unit)? = null, onUpload: (() -> Unit)? = null, uploading: Boolean = false) {
    var menu by remember { mutableStateOf(false) }
    val ok = c.status == "sealed" && !c.cheating
    Box(
        Modifier.fillMaxWidth().aspectRatio(0.78f).clip(RoundedCornerShape(18.dp)).background(MediaBg)
            .clickable(onClickLabel = "Open the evidence room", onClick = onClick)
            .semantics(mergeDescendants = true) {},
    ) {
        val bmp = remember(c.heroJpegB64) { decodeB64(c.heroJpegB64)?.asImageBitmap() }
        if (bmp != null) Image(
            bmp, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop,
            colorFilter = if (ok || c.status != "rejected") null else ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.3f) }),
        ) else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF10343B), MediaBg))), contentAlignment = Alignment.Center) {
            if (c.track.size > 1) TrackSketch(c.track, Modifier.size(90.dp, 70.dp)) else Icon(Glyph.Proof, null, tint = TokInk2, modifier = Modifier.size(32.dp))
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to MediaBg.copy(alpha = 0.55f), 0.3f to Color.Transparent, 0.5f to Color.Transparent, 1f to MediaBg.copy(alpha = 0.92f))))
        StatusBadge(c.status, c.local, c.cheating, Modifier.align(Alignment.TopStart).padding(8.dp))
        if (onDelete != null || onUpload != null) Box(Modifier.align(Alignment.TopEnd)) {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Moment actions", tint = TokInk) }
            DropdownMenu(menu, onDismissRequest = { menu = false }) {
                if (onUpload != null) DropdownMenuItem(
                    text = { Text("Upload & verify") }, leadingIcon = { Icon(Icons.Filled.CloudUpload, null) },
                    onClick = { menu = false; onUpload() },
                )
                if (onDelete != null) DropdownMenuItem(
                    text = { Text("Delete", color = Bad) }, leadingIcon = { Icon(Icons.Filled.Delete, null, tint = Bad) },
                    onClick = { menu = false; onDelete() },
                )
            }
        }
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                c.intention, color = TokInk, fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 18.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
                style = TextStyle(shadow = textShadow),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    StatOverlay(Glyph.Time, fmtDuration(c.summary.durationMs))
                    when {
                        uploading -> StatOverlay(Icons.Filled.CloudUpload, "uploading")
                        c.pendingWrites -> StatOverlay(Icons.Filled.CloudUpload, "queued")
                        c.claimsTotal != null && c.claimsTotal > 0 && c.claimsBacked != null -> StatOverlay(Glyph.Result, "${c.claimsBacked}/${c.claimsTotal}")
                        else -> StatOverlay(Glyph.Frames, "${c.summary.frameCount}")
                    }
                }
                if (c.score != null) ScoreRing(c.score, c.bar ?: c.previewBar, size = 44.dp, onMedia = true)
            }
        }
    }
}

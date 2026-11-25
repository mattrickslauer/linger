package com.mattricks.verified.ui

import android.app.Activity
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
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.onEach
import kotlin.math.roundToInt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseUser
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.ai.Ai
import com.mattricks.verified.auth.Auth
import com.mattricks.verified.auth.Gate
import com.mattricks.verified.data.Claims
import com.mattricks.verified.data.Vault
import kotlinx.coroutines.flow.flowOf
import androidx.compose.ui.text.font.FontWeight
import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Store
import com.mattricks.verified.judge.Judging
import com.mattricks.verified.record.RecordViewModel
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
fun FeedScreen(user: FirebaseUser?, onOpen: (String) -> Unit, onRecord: () -> Unit) {
    val items by remember { Store.feed().onEach { feedCache = it } }.collectAsState(initial = feedCache)
    var filter by rememberSaveable { mutableStateOf("all") }
    var lastId by rememberSaveable { mutableStateOf<String?>(null) }
    val all = items
    val shown = remember(all, filter) { all.orEmpty().filter { filter == "all" || it.status == filter } }
    // intro + slides + end card (or a loading page while the first snapshot is on its way)
    val pager = rememberPagerState { 1 + (if (all == null) 1 else shown.size + 1) }
    val scope = rememberCoroutineScope()
    val reduceMotion = rememberReduceMotion()

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
                all == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = TokInk) }
                p <= shown.size -> {
                    val c = shown[p - 1]
                    FeedSlide(c, active = pager.settledPage == p, reduceMotion = reduceMotion, onOpen = { open(c.id) })
                }
                else -> FeedEnd(shown.isNotEmpty(), onRecord) {
                    scope.launch { if (reduceMotion) pager.scrollToPage(0) else pager.animateScrollToPage(0) }
                }
            }
        }
        Row(
            Modifier.align(Alignment.TopCenter).padding(top = 12.dp).clip(RoundedCornerShape(50)).background(TokBg.copy(alpha = 0.55f)).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            FEED_FILTERS.forEach { (k, label) ->
                val on = filter == k
                Text(
                    label, color = if (on) TokBg else TokInk, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) TokInk else Color.Transparent)
                        .clickable { if (filter != k) { filter = k; lastId = null; scope.launch { pager.scrollToPage(0) } } }
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                )
            }
        }
    }
}

/** Page 0: what the feed is, the three waypoints in one line each, live counts, Record a Moment. */
@Composable
private fun FeedIntro(user: FirebaseUser?, all: List<MomentCard>?, onRecord: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(start = 24.dp, end = 24.dp, top = 76.dp, bottom = 24.dp), verticalArrangement = Arrangement.Center) {
        Text("Proof it happened.", color = TokInk, fontSize = 38.sp, lineHeight = 40.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.8).sp)
        Spacer(Modifier.height(12.dp))
        Text(
            "Every post here was recorded live, argued over by AI, and sealed by code. Each one reads the same way:",
            color = TokInk2, fontSize = 16.sp, lineHeight = 22.sp,
        )
        Spacer(Modifier.height(20.dp))
        listOf(
            Triple(Wp.Intent, "Intent", "What the person said they would do, before they started."),
            Triple(Wp.Proof, "Proof", "GPS, motion and proof shots, hashed into a chain as it happened. Gemini Nano coaches on the phone; it can never verify."),
            Triple(Wp.Result, "Result", "A judge, a skeptic and a scorer weigh it in the cloud. Then a Cloud Function checks the chain and alone writes the seal."),
        ).forEach { (kind, label, text) ->
            SlideWaypoint(kind, ok = true, last = kind == Wp.Result) {
                Text(label, color = TokInk, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Spacer(Modifier.height(2.dp))
                Text(text, color = TokInk2, fontSize = 14.sp, lineHeight = 19.sp)
            }
        }
        Text(
            if (all == null) "Connecting…" else all.count { it.status == "sealed" }.let { s -> "$s verified, ${all.size - s} not" },
            color = TokInk, fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            RecordButton(onRecord)
            Spacer(Modifier.width(12.dp))
            if (user == null) TextButton(onClick = { Gate.signIn() }) { Text("Sign in", color = TokInk) }
            Spacer(Modifier.weight(1f))
            Text("Swipe up ↑", color = TokInk2, fontSize = 13.sp)
        }
    }
}

@Composable
private fun FeedEnd(any: Boolean, onRecord: () -> Unit, onTop: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (any) "That's every Moment." else "Nothing here yet.", color = TokInk, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(8.dp))
        Text(
            if (any) "Record one of your own and it shows up here once it's sealed." else "Record the first one and it shows up here once it's sealed.",
            color = TokInk2, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        RecordButton(onRecord)
        if (any) TextButton(onClick = onTop) { Text("Back to the top", color = TokInk) }
    }
}

@Composable
private fun RecordButton(onRecord: () -> Unit) = Button(
    onClick = onRecord, shape = RoundedCornerShape(28.dp),
    colors = ButtonDefaults.buttonColors(containerColor = TokInk, contentColor = TokBg),
) {
    Icon(Icons.Filled.FiberManualRecord, null, tint = Red, modifier = Modifier.size(16.dp))
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
        Column(Modifier.padding(start = 28.dp, bottom = 24.dp).arrive(arrive), content = content)
    }
}

@Composable
private fun WpLabel(label: String, sub: String?) = Text(
    buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = TokInk)) { append(label) }
        if (!sub.isNullOrBlank()) withStyle(SpanStyle(color = TokInk2)) { append("  "); append(sub) }
    },
    fontSize = 15.sp, style = TextStyle(shadow = textShadow), maxLines = 1, overflow = TextOverflow.Ellipsis,
)

/** The slide template, identical for every Moment: intent → proof → result over the proof photo. */
@Composable
private fun FeedSlide(c: MomentCard, active: Boolean, reduceMotion: Boolean, onOpen: () -> Unit) {
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

    Box(Modifier.fillMaxSize().clickable(onClickLabel = "Inspect the evidence", onClick = onOpen)) {
        val bmp = remember(c.heroJpegB64) { decodeB64(c.heroJpegB64)?.asImageBitmap() }
        if (bmp != null) Image(
            bmp, "Proof shot: ${c.intention}", Modifier.fillMaxSize(), contentScale = ContentScale.Crop,
            colorFilter = if (ok) null else ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.3f) }),
        ) else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF10343B), TokBg))))
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to TokBg.copy(alpha = 0.9f), 0.26f to TokBg.copy(alpha = 0.4f), 0.40f to Color.Transparent,
                    0.46f to Color.Transparent, 0.62f to TokBg.copy(alpha = 0.7f), 1f to TokBg.copy(alpha = 0.95f),
                ),
            ),
        )

        Column(Modifier.fillMaxSize().padding(start = 20.dp, end = 84.dp, top = 72.dp, bottom = 20.dp)) {
            // 1. Intent: takes the slack, so the photo shows between it and the proof.
            SlideWaypoint(Wp.Intent, ok, Modifier.weight(1f), line = ease.transform(seg(ms, 100f, 600f)), arrive = ease.transform(seg(ms, 0f, 450f))) {
                WpLabel("Intent", "${c.ownerName.ifBlank { "Someone" }} set out to")
                Spacer(Modifier.height(6.dp))
                val quote = if (ok) TrackOrange else TokInk2
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = quote)) { append("“") }
                        append(c.intention)
                        withStyle(SpanStyle(color = quote)) { append("”") }
                    },
                    color = TokInk, fontSize = 30.sp, lineHeight = 32.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp,
                    style = TextStyle(shadow = textShadow), maxLines = 5, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 280.dp),
                )
            }
            // 2. Proof
            SlideWaypoint(Wp.Proof, ok, line = ease.transform(seg(ms, 350f, 850f)), arrive = ease.transform(seg(ms, 250f, 700f))) {
                WpLabel("Proof", "captured live" + agoText(c.sealedAt).let { if (it.isBlank()) "" else ", $it" })
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (c.track.size > 1) { TrackSketch(c.track, Modifier.size(64.dp, 48.dp)); Spacer(Modifier.width(12.dp)) }
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat(fmtDuration(c.summary.durationMs), "time")
                        Stat(fmtDistance(c.summary.distanceM), "moved")
                        Stat("${c.summary.frameCount}", "shots")
                    }
                }
                Spacer(Modifier.height(10.dp))
                CheckPips(c.checks)
                listOfNotNull(
                    c.claimsTotal?.takeIf { it > 0 && c.claimsBacked != null }?.let { "${c.claimsBacked}/$it claims backed" },
                    c.ladderCount.takeIf { it > 0 }?.let { "+$it check${if (it == 1) "" else "s"}" },
                    c.witnessAsked.takeIf { it > 0 }?.let { "witness ${c.witnessAnswered}/$it" },
                ).takeIf { it.isNotEmpty() }?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it.joinToString(" · "), color = TokInk2, fontSize = 12.sp, style = TextStyle(shadow = textShadow))
                }
            }
            // 3. Result
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
                    Spacer(Modifier.width(16.dp))
                    Column {
                        c.score?.let { p ->
                            Text(
                                buildAnnotatedString {
                                    withStyle(SpanStyle(color = TokInk, fontWeight = FontWeight.Bold, fontSize = 22.sp)) { append("${(p * 100).roundToInt()}%") }
                                    append(" likely true")
                                },
                                color = TokInk2, fontSize = 15.sp,
                            )
                        }
                        c.bar?.let { Text("bar ${(it * 100).roundToInt()}%", color = TokInk2, fontSize = 13.sp) }
                    }
                }
                val reason = when {
                    c.cheating -> c.cheatingSignals.firstOrNull() ?: "Cheating detected"
                    c.status == "sealed" -> c.scoreReasons.firstOrNull() ?: c.judgeReasons.firstOrNull()
                    else -> c.sealReason
                }
                if (!reason.isNullOrBlank()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        reason, color = TokInk2, fontSize = 14.5.sp, lineHeight = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        style = TextStyle(shadow = textShadow), modifier = Modifier.widthIn(max = 300.dp),
                    )
                }
            }
        }

        // Right rail, lower third.
        Column(
            Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 180.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally,
        ) {
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

private val OvershootEasing = CubicBezierEasing(0.3f, 1.5f, 0.5f, 1f)

@Composable
private fun Stat(value: String, label: String) = Column {
    Text(value, color = TokInk, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false, style = TextStyle(shadow = textShadow))
    Text(label, color = TokInk2, fontSize = 12.sp, maxLines = 1)
}

@Composable
private fun RailButton(icon: ImageVector, label: String, primary: Boolean = false, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(4.dp)) {
        Box(
            Modifier.size(52.dp).clip(CircleShape).background(if (primary) TokInk else TokBg.copy(alpha = 0.6f))
                .border(1.dp, TokLine, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, null, tint = if (primary) TokBg else TokInk, modifier = Modifier.size(24.dp)) }
        Spacer(Modifier.height(4.dp))
        Text(label, color = TokInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, style = TextStyle(shadow = textShadow))
    }
}

@Composable
fun MeScreen(user: FirebaseUser?, onOpen: (String) -> Unit) {
    val items by remember(user?.uid) { user?.let { Store.myMoments(it.uid) } ?: flowOf(emptyList()) }.collectAsState(initial = null)
    val guests by Vault.guests.collectAsState()
    val uploading by Claims.uploading.collectAsState()
    val judging by Judging.status.collectAsState()
    val nano by Ai.onDeviceState.collectAsState()
    val recordingId by RecordViewModel.recording.collectAsState()
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val local = guests.map { Store.localCard(it) }
    val all = items?.let { local + it }
    CardList(
        all, empty = "Your Moments will show up here.", onOpen = onOpen,
        onDelete = { c ->
            val mine = c.local || canDeleteMoment(c, user?.uid, recordingId)
            if (mine && c.id != recordingId) ({ confirmDelete = c.id }) else null
        },
        onUpload = { c ->
            if (c.local && c.status == "submitted" && c.id !in uploading) ({
                Gate.require("verify this Moment") { Claims.claim(listOf(c.id)) }
            }) else null
        },
        header = {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (user == null) {
                        Text("You're browsing as a guest", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(
                            "Moments you record stay on this phone. Sign in to upload them, run the cloud review and get them sealed.",
                            style = MaterialTheme.typography.bodySmall, color = Color.Gray,
                        )
                    } else {
                        Text(user.displayName ?: "Signed in", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(user.email ?: if (user.isAnonymous) "test user" else "", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "On-device model (Gemini Nano): " + when (nano) {
                            "available" -> "ready"
                            "downloading" -> "downloading…"
                            "checking" -> "checking…"
                            else -> "not on this phone — checks run in the cloud"
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (BuildConfig.USE_EMULATOR) Text("Emulator mode · ${BuildConfig.EMULATOR_HOST}", style = MaterialTheme.typography.bodySmall, color = Amber)
                    judging?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Green) }
                    if (uploading.isNotEmpty()) Text("Uploading ${uploading.size} guest Moment(s)…", style = MaterialTheme.typography.bodySmall, color = Green)
                    if (user != null) {
                        val held by Vault.held.collectAsState()
                        val conflicts = held.count { it.value == Vault.State.Conflict }
                        Text(
                            when {
                                held.isEmpty() -> "Raw data: all safely stored on the server ✓"
                                conflicts > 0 -> "Raw data: $conflicts Moment(s) differ from the server — kept on this phone"
                                else -> "Raw data: ${held.size} Moment(s) kept on this phone until the server confirms every chunk"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (held.isEmpty()) Green else Amber,
                        )
                    }
                    if (local.isNotEmpty()) Text(
                        "${local.size} guest Moment(s) on this phone only",
                        style = MaterialTheme.typography.bodySmall, color = Amber,
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (user == null) Button(onClick = { Gate.signIn() }) { Text("Sign in") }
                        else {
                            if (local.any { it.status == "submitted" }) Button(onClick = { Claims.claim(local.filter { it.status == "submitted" }.map { it.id }) }) {
                                Text("Upload guest Moments")
                            }
                            OutlinedButton(onClick = { Auth.signOut() }) { Text("Sign out") }
                        }
                    }
                }
            }
            if (user != null) CreditsRow()
        },
    )
    confirmDelete?.let { id ->
        DeleteMomentDialog(
            onConfirm = { confirmDelete = null; Store.deleteMoment(id) },
            onDismiss = { confirmDelete = null },
        )
    }
}

@Composable
private fun CardList(
    items: List<MomentCard>?, empty: String, onOpen: (String) -> Unit,
    header: (@Composable () -> Unit)? = null,
    onDelete: (MomentCard) -> (() -> Unit)? = { null },
    onUpload: (MomentCard) -> (() -> Unit)? = { null },
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (header != null) item { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { header() } }
        when {
            items == null -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            items.isEmpty() -> item {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Text(empty, textAlign = TextAlign.Center, color = Color.Gray) }
            }
            else -> items(items, key = { it.id }) { MomentCardView(it, onDelete = onDelete(it), onUpload = onUpload(it)) { onOpen(it.id) } }
        }
    }
}

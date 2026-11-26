package com.mattricks.verified.ui

import android.text.format.DateUtils
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FitnessCenter
import androidx.compose.material.icons.filled.Handyman
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Phishing
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.filled.Terrain
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.data.MomentDetail
import com.mattricks.verified.data.Opinion
import com.mattricks.verified.data.Store
import com.mattricks.verified.data.V3Math
import com.mattricks.verified.record.RecordViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun DetailScreen(momentId: String, fromMe: Boolean = false, onBack: () -> Unit) {
    var detail by remember { mutableStateOf<MomentDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var confirmDelete by remember { mutableStateOf(false) }
    val recordingId by RecordViewModel.recording.collectAsState()
    LaunchedEffect(momentId, refresh) {
        runCatching { Store.detail(momentId) }.onSuccess { detail = it; error = null }.onFailure { error = it.message }
        // While it is being judged/sealed, poll so the checklist fills in live.
        val st = detail?.card?.status
        if (st == "recording" || st == "submitted") { delay(4_000); refresh++ }
    }
    if (confirmDelete) DeleteMomentDialog(
        onConfirm = { confirmDelete = false; Store.deleteMoment(momentId); onBack() },
        onDismiss = { confirmDelete = false },
    )
    val d = detail
    // Only from "my Moments", only the owner's own, never the one being recorded (ARCHITECTURE.md).
    val canDelete = d != null && fromMe && canDeleteMoment(d.card, Firebase.auth.currentUser?.uid, recordingId)
    var ladderOpen by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    // full_video: the chained clip must still be on this phone (it never left it).
    val clipRef = d?.videos?.lastOrNull()
    var clipUri by remember { mutableStateOf<android.net.Uri?>(null) }
    LaunchedEffect(clipRef?.sha256, ladderOpen) { clipUri = clipRef?.let { com.mattricks.verified.data.Clips.find(ctx, it) } }
    val runVideo: (suspend (String) -> com.mattricks.verified.data.Ladder.Run)? = clipRef?.let { ref ->
        clipUri?.let { uri ->
            { requestId: String ->
                val uid = Firebase.auth.currentUser?.uid ?: throw com.mattricks.verified.data.Ladder.RunError("sign_in", "Sign in first.")
                val sha = com.mattricks.verified.data.Clips.upload(ctx, uid, momentId, ref, uri)
                com.mattricks.verified.data.Ladder.run(momentId, "full_video", clipSha = sha, requestId = requestId)
            }
        }
    }
    if (ladderOpen && d != null) LadderSheet(
        d, clipOnPhone = clipUri != null, runVideo = runVideo,
        onDone = { refresh++ }, onDismiss = { ladderOpen = false; refresh++ },
    )
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        when {
            d != null -> DetailBody(d, onBack, if (canDelete) ({ confirmDelete = true }) else null) {
                com.mattricks.verified.auth.Gate.require("run a verification module") { ladderOpen = true }
            }
            error != null -> {
                EmptyState(Glyph.Warning, "Couldn't open this Moment.", Modifier.align(Alignment.Center)) {
                    Text(error ?: "", color = Ink2, style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { error = null; refresh++ }) { Icon(Icons.Filled.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Retry") }
                }
                RoomChrome(collapsed = true, current = -1, onJump = null, onBack = onBack, onDelete = null)
            }
            else -> {
                Column(Modifier.fillMaxSize()) {
                    Skeleton(Modifier.fillMaxWidth().height(420.dp))
                    Spacer(Modifier.height(16.dp))
                    repeat(3) { Skeleton(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().height(72.dp)) }
                }
                RoomChrome(collapsed = false, current = -1, onJump = null, onBack = onBack, onDelete = null)
            }
        }
    }
}

private val SECTIONS = listOf(Triple(Wp.Intent, "Intent", Glyph.Intent), Triple(Wp.Proof, "Proof", Glyph.Proof), Triple(Wp.Result, "Result", Glyph.Result))

/**
 * The evidence room (feed v5 + visual-first): hero proof shot with the stamp, score ring and key stats overlaid; a
 * filmstrip; then Intent / Proof / Result behind a segmented jump bar. Prose lives in sheets. Follows the app theme.
 */
@Composable
internal fun DetailBody(d: MomentDetail, onBack: () -> Unit, onDelete: (() -> Unit)?, onOpenLadder: () -> Unit) {
    var selected by remember(d.frames.size) { mutableIntStateOf((d.frames.size - 1).coerceAtLeast(0)) }
    val ok = d.card.status == "sealed" && !d.card.cheating
    val checks = d.seal?.checks?.takeIf { it.isNotEmpty() } ?: d.feedChecks
    val isOwner = d.ownerUid.isNotEmpty() && d.ownerUid == runCatching { Firebase.auth.currentUser?.uid }.getOrNull()

    val intent = buildList<@Composable ColumnScope.() -> Unit> {
        if (d.local) add { LocalBanner(d) }
        add { IntentionChips(d) }
    }

    val proof = buildList<@Composable ColumnScope.() -> Unit> {
        add { MapWithStats(d) }
        // v4: the free video review sits with the evidence it reviewed.
        if (isV4(d)) add { VideoReviewCard(d) }
        else if (!d.local && d.card.status == "recording" && d.videos.isNotEmpty()) add { VideoUploadLine(d.card.id) }
        // v4.12: every uploaded clip, playable by anyone who can see the Moment.
        if (d.sharedClips.isNotEmpty()) add { SharedVideoSection(d) }
        if (d.witness.isNotEmpty()) add { WitnessStrip(d) }
        if (d.motion.isNotEmpty()) add { MotionBlock(d) }
        add { ChainBlock(d) }
    }

    val result = buildList<@Composable ColumnScope.() -> Unit> {
        add { RoomVerdict(d, ok, checks) }
        // v4: one row per claim (docs/ARCHITECTURE.md v4.11).
        if (isV4(d)) add { ClaimsSection(d) { c, s -> ClaimOffers(d, c, s) } }
        add { OpinionStrip(d) }
        add { LadderSection(d, isOwner = isOwner, onOpenLadder = onOpenLadder) }
    }

    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var chromePx by remember { mutableIntStateOf(0) }
    // Items: hero, filmstrip (may be empty), jump bar, then the three sections in order.
    val first = 3
    val starts = listOf(first, first + intent.size, first + intent.size + proof.size)
    val collapsed by remember { derivedStateOf { list.firstVisibleItemIndex > 0 } }
    val current by remember(starts) {
        derivedStateOf {
            val firstIdx = list.firstVisibleItemIndex + if (list.firstVisibleItemScrollOffset > 0) 1 else 0
            when {
                !list.canScrollForward && list.firstVisibleItemIndex > 0 -> 2
                firstIdx >= starts[2] -> 2
                firstIdx >= starts[1] -> 1
                else -> 0
            }
        }
    }
    val jump: (Int) -> Unit = { i -> scope.launch { list.animateScrollToItem(starts[i], -chromePx) } }
    val nav = WindowInsets.navigationBars.asPaddingValues()

    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = 32.dp + nav.calculateBottomPadding())) {
        item(key = "hero") { Hero(d, ok, selected) }
        item(key = "film") { if (d.frames.size > 1) Filmstrip(d, selected) { selected = it } }
        item(key = "jump") { JumpBar(current, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), jump) }
        listOf(intent, proof, result).forEachIndexed { si, body ->
            val (kind, title, _) = SECTIONS[si]
            itemsIndexed(body, key = { i, _ -> "${kind.name}-$i" }) { i, block ->
                RoomRow(kind, ok, header = i == 0) {
                    if (i == 0) Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    block()
                }
            }
        }
    }
    Box(Modifier.onSizeChanged { chromePx = it.height }) { RoomChrome(collapsed, current, jump, onBack, onDelete) }
}

/** Back (and delete) floating over the hero; once scrolled, a solid bar carrying the segmented jump bar. */
@Composable
private fun RoomChrome(collapsed: Boolean, current: Int, onJump: ((Int) -> Unit)?, onBack: () -> Unit, onDelete: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().then(if (collapsed) Modifier.background(MaterialTheme.colorScheme.surfaceContainer) else Modifier)
            .statusBarsPadding().padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val btn = if (collapsed) IconButtonDefaults.iconButtonColors()
        else IconButtonDefaults.iconButtonColors(containerColor = MediaBg.copy(alpha = 0.55f), contentColor = TokInk)
        IconButton(onClick = onBack, colors = btn) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Box(Modifier.weight(1f).padding(horizontal = 4.dp)) {
            if (collapsed && onJump != null) JumpBar(current, Modifier.fillMaxWidth(), onJump, compact = true)
            else if (collapsed) Text("Evidence room", style = MaterialTheme.typography.titleMedium)
        }
        if (onDelete != null) IconButton(onClick = onDelete, colors = btn) { Icon(Icons.Filled.Delete, "Delete Moment") }
    }
}

@Composable
private fun JumpBar(current: Int, modifier: Modifier, onJump: (Int) -> Unit, compact: Boolean = false) {
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        SECTIONS.forEachIndexed { i, (_, label, icon) ->
            SegmentedButton(
                selected = current == i, onClick = { onJump(i) }, shape = SegmentedButtonDefaults.itemShape(i, SECTIONS.size),
                icon = { if (!compact) Icon(icon, null, Modifier.size(SegmentedButtonDefaults.IconSize)) },
            ) { Text(label, maxLines = 1) }
        }
    }
}

/** The proof shot full-bleed, with status, intention, the score ring and the key stats overlaid. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Hero(d: MomentDetail, ok: Boolean, selected: Int) {
    val frame = d.frames.getOrNull(selected)
    val b64 = frame?.jpegB64?.takeIf { it.isNotEmpty() } ?: d.card.heroJpegB64
    val p = d.verification?.score ?: d.score?.probability ?: d.card.score
    val bar = barOf(d) ?: d.intention?.preview?.bar
    Box(Modifier.fillMaxWidth().heightIn(min = 440.dp).background(MediaBg)) {
        val bmp = remember(b64) { decodeB64(b64)?.asImageBitmap() }
        if (bmp != null) FitImage(
            bmp, "Proof shot", Modifier.matchParentSize(),
            colorFilter = if (d.card.status != "rejected" && !d.card.cheating) null else ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.3f) }),
        ) else Box(Modifier.matchParentSize().background(Brush.linearGradient(listOf(Color(0xFF10343B), MediaBg))), contentAlignment = Alignment.Center) {
            if (d.track.size > 1) TrackSketch(d.track, Modifier.size(180.dp, 130.dp))
        }
        Box(
            Modifier.matchParentSize().background(
                Brush.verticalGradient(0f to MediaBg.copy(alpha = 0.7f), 0.2f to Color.Transparent, 0.42f to Color.Transparent, 1f to MediaBg.copy(alpha = 0.95f)),
            ),
        )
        // The selected frame's own on-device coach result, as chips on the photo.
        Column(
            Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 60.dp, end = 12.dp),
            horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            frame?.check?.let { c ->
                ScrimChip(Modifier.semantics(mergeDescendants = true) {}) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (c.ok) Icons.Filled.CheckCircle else Glyph.Warning, null, Modifier.size(15.dp), tint = if (c.ok) TokOk else TokBad)
                        Spacer(Modifier.width(5.dp))
                        Text(
                            (if (c.ok) "keep going" else "retake: ${c.reason}") + (c.label.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
                            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 200.dp),
                        )
                    }
                }
                HybridBadge(c.mode, onMedia = true)
            }
            frame?.witnessAsk?.let { ask ->
                ScrimChip {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Glyph.Witness, "Witness asked", Modifier.size(15.dp)); Spacer(Modifier.width(5.dp))
                        Text(ask, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 200.dp))
                    }
                }
            }
        }
        Column(
            Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 150.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusBadge(d.card.status, d.local, d.card.cheating)
                if (!d.local) HybridBadge(d.card.onDeviceMode, onMedia = true)
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = if (ok) TrackOrange else TokInk2)) { append("“") }
                            append(d.card.intention)
                            withStyle(SpanStyle(color = if (ok) TrackOrange else TokInk2)) { append("”") }
                        },
                        color = TokInk, fontSize = 24.sp, lineHeight = 27.sp, fontWeight = FontWeight.ExtraBold, maxLines = 4, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        listOfNotNull(
                            d.card.ownerName.ifBlank { "Someone" },
                            d.startedAt.takeIf { it > 0 }?.let {
                                DateUtils.formatDateTime(LocalContext.current, it, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH)
                            },
                        ).joinToString(" · "),
                        color = TokInk2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (p != null || bar != null) { Spacer(Modifier.width(12.dp)); ScoreRing(p, bar, size = 76.dp, onMedia = true) }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                StatOverlay(Glyph.Time, fmtDuration(d.card.summary.durationMs))
                StatOverlay(Glyph.Distance, fmtDistance(d.card.summary.distanceM))
                StatOverlay(Glyph.Frames, "${d.frames.size}", "shots")
                d.v4?.takeIf { isV4(d) }?.let { v4 ->
                    val backed = v4.claimsBacked ?: barOf(d)?.let { b -> v4.claimScores.count { it.p >= b } }
                    StatOverlay(Glyph.Result, "${backed ?: "–"}/${v4.claims.size}", "claims")
                }
            }
        }
    }
}

/** Frames as a filmstrip under the hero; tap shows it above. Red dot = the coach asked for a retake. */
@Composable
private fun Filmstrip(d: MomentDetail, selected: Int, onSelect: (Int) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(d.frames) { i, fr ->
            val on = i == selected
            val label = if (d.startedAt > 0 && fr.t > 0) "+${(fr.t - d.startedAt) / 1000}s" else "#${fr.seq}"
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.size(64.dp).clip(RoundedCornerShape(12.dp))
                        .border(if (on) 3.dp else 0.dp, if (on) SealGold else Color.Transparent, RoundedCornerShape(12.dp))
                        .clickable(onClickLabel = "Show frame $label") { onSelect(i) },
                ) {
                    B64Image(fr.jpegB64, Modifier.matchParentSize())
                    if (fr.check?.ok == false) Box(
                        Modifier.align(Alignment.TopEnd).padding(4.dp).size(10.dp).clip(CircleShape).background(FillBad).border(1.5.dp, Color.White, CircleShape),
                    )
                    if (fr.witnessAsk != null) Icon(Glyph.Witness, "Witness", Modifier.align(Alignment.BottomStart).padding(3.dp).size(14.dp), tint = Color.White)
                }
                Text(
                    label, fontSize = 11.sp, style = Tnum, color = if (fr.check?.ok == false) Bad else Ink2,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
    }
}

/**
 * One row of the evidence room: a 28dp gutter carrying the dashed track (Intent and Proof only; it stops at the result
 * dot) and, on a section's first row, the waypoint dot beside its title.
 */
@Composable
private fun RoomRow(kind: Wp, ok: Boolean, header: Boolean, content: @Composable ColumnScope.() -> Unit) {
    val muted = MaterialTheme.colorScheme.outline
    val hole = MaterialTheme.colorScheme.background
    val badC = Bad
    val trackC = Track
    Row(
        Modifier.fillMaxWidth().drawBehind {
            val x = 16.dp.toPx() + 7.dp.toPx()
            val dotY = 24.dp.toPx()
            if (kind != Wp.Result) dashedTrack(x, if (header) dotY + 14.dp.toPx() else 0f, size.height, if (ok) trackC else muted)
            if (header) waypointDot(kind, ok, Offset(x, dotY), hole = hole, muted = muted, bad = badC)
        }.padding(start = 16.dp + 28.dp, end = 16.dp),
    ) {
        Column(
            Modifier.weight(1f).padding(top = if (header) 10.dp else 7.dp, bottom = 7.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp), content = content,
        )
    }
}

/** A block title: glyph + ≤ 2 words, with an optional trailing element. */
@Composable
fun BlockTitle(icon: ImageVector, title: String, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(18.dp), tint = Lake)
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

// ───────────────────────── Intent

/** v3.2 structured intention as glyph chips (frozen once the Moment is submitted); prose behind (i). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IntentionChips(d: MomentDetail) {
    val i = d.intention?.takeIf { it.structured }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        IntentChip(categoryGlyph(d.card.category), d.card.category)
        if (i != null) {
            i.activity.takeIf { it.isNotBlank() }?.let { IntentChip(claimGlyph("action"), it) }
            i.place?.label()?.takeIf { it.isNotBlank() }?.let { IntentChip(Glyph.Place, it) }
            i.expectedMinutes?.let { IntentChip(Glyph.Time, "~${it.toInt()} min") }
            i.quantities.forEach { q -> IntentChip(claimGlyph("count"), "${q.metric} ${fmtNum(q.value)} ${q.unit}") }
            i.conditions.forEach { IntentChip(Icons.Filled.Check, it) }
        }
    }
    if (i == null) return
    if (i.goal.isNotBlank()) Text(i.goal, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
    measuredHint(i, d.card.summary.distanceM)?.let {
        GlyphPill(Glyph.Place, it, MaterialTheme.colorScheme.primaryContainer, fg = MaterialTheme.colorScheme.onPrimaryContainer)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(if (i.interviewMode == "typed") Icons.Filled.TextFields else Icons.Filled.Mic, null, Modifier.size(15.dp), tint = Ink2)
        Spacer(Modifier.width(6.dp))
        Text("${i.interviewTurns} answers", style = MaterialTheme.typography.labelMedium, color = Ink2)
        Spacer(Modifier.width(8.dp))
        HybridBadge(i.interviewMode)
        Spacer(Modifier.weight(1f))
        InfoButton("The intention") {
            i.quantities.forEach { q -> Bullet("${q.metric}: ${fmtNum(q.value)} ${q.unit} (measured by ${q.measuredBy})") }
            if (i.conditions.isNotEmpty()) Bullet("Conditions: " + i.conditions.joinToString(", "))
            if (i.assumptions.isNotEmpty()) {
                Text("Assumed by the witness", style = MaterialTheme.typography.titleSmall)
                i.assumptions.forEach { Bullet(it) }
            }
            Text("Interview: ${i.interviewTurns} answer(s) · ${modeChip(i.interviewMode)}", color = Ink2, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun IntentChip(icon: ImageVector, text: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(10.dp)) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(16.dp), tint = Lake)
            Spacer(Modifier.width(6.dp))
            Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 240.dp))
        }
    }
}

fun categoryGlyph(c: String): ImageVector = when (c) {
    "fishing" -> Icons.Filled.Phishing
    "fitness" -> Icons.Filled.FitnessCenter
    "outdoors" -> Icons.Filled.Terrain
    "making" -> Icons.Filled.Handyman
    else -> Icons.Filled.Category
}

/**
 * Sensor-countable numbers measured deterministically on this phone (distance from GPS). The count_measure module
 * re-measures them server-side; this is only a preview next to the claim.
 */
fun measuredHint(i: com.mattricks.verified.data.Intention, distanceM: Double): String? {
    val q = i.quantities.firstOrNull { it.metric.equals("distance", true) } ?: return null
    if (distanceM <= 0) return null
    val claimedM = when (q.unit.lowercase()) {
        "km", "kilometers", "kilometres" -> q.value * 1000
        "mi", "mile", "miles" -> q.value * 1609.344
        "m", "meters", "metres" -> q.value
        else -> return "GPS measured ${fmtDistance(distanceM)}"
    }
    val pct = (100 * distanceM / claimedM).toInt()
    return "GPS measured ${fmtDistance(distanceM)} · $pct% of the claimed ${fmtNum(q.value)} ${q.unit}"
}

/** A guest Moment on this phone only (v3.1): nothing is on the server yet. */
@Composable
private fun LocalBanner(d: MomentDetail) {
    val uploading by com.mattricks.verified.data.Claims.uploading.collectAsState()
    val guest = remember(d.card.id, uploading) { com.mattricks.verified.data.Vault.isGuest(d.card.id) }
    if (!guest) {
        // A signed-in Moment the server doesn't have yet: the raw vault uploads it by itself, no claim needed.
        GlyphPill(Glyph.OnDevice, "On this phone · syncs online", FillInk)
        return
    }
    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(18.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Glyph.OnDevice, null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
            Spacer(Modifier.width(10.dp))
            Text("Only on this phone", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.weight(1f))
            InfoButton("Recorded as a guest", tint = MaterialTheme.colorScheme.onPrimaryContainer) {
                Text("The hash chain binds only this Moment's id, so it uploads unchanged to your account. Sign in to upload it, run the cloud review and get it sealed.")
            }
            when {
                d.card.id in uploading -> GlyphPill(Icons.Filled.CloudUpload, "Uploading", FillLake)
                d.card.status == "submitted" -> Button(onClick = {
                    com.mattricks.verified.auth.Gate.require("verify this Moment") { com.mattricks.verified.data.Claims.claim(listOf(d.card.id)) }
                }) { Text("Upload & verify") }
            }
        }
    }
}

// ───────────────────────── Proof

/** The track on the map with the numbers overlaid on it. */
@Composable
private fun MapWithStats(d: MomentDetail) {
    Box(Modifier.fillMaxWidth().height(240.dp).clip(RoundedCornerShape(18.dp))) {
        TrackMap(d.track, Modifier.matchParentSize())
        Row(Modifier.align(Alignment.TopStart).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ScrimChip { StatOverlay(Glyph.Distance, fmtDistance(d.card.summary.distanceM)) }
            ScrimChip(Modifier.semantics(mergeDescendants = true) { contentDescription = "${d.track.size} GPS fixes" }) { StatOverlay(Glyph.Place, "${d.track.size}", "fixes") }
        }
        ScrimChip(Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = 30.dp)) { StatOverlay(Glyph.Time, fmtDuration(d.card.summary.durationMs)) }
    }
}

/** v3.4 witness requests read back from the hash chain: a horizontal strip, one card per ask. */
@Composable
private fun WitnessStrip(d: MomentDetail) {
    val answered = d.witness.count { it.outcome != null && it.outcome != "skipped" }
    BlockTitle(Glyph.Witness, "Witness") { Text("$answered/${d.witness.size}", style = Tnum.merge(MaterialTheme.typography.titleMedium), color = Ink2) }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(d.witness) { w ->
            val (icon, tint) = when (w.outcome) {
                null -> Icons.AutoMirrored.Filled.HelpOutline to Ink2
                "skipped" -> Icons.Filled.RemoveCircleOutline to Warn
                else -> Icons.Filled.CheckCircle to Ok
            }
            Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp), modifier = Modifier.width(220.dp)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(icon, null, Modifier.size(18.dp), tint = tint)
                        Spacer(Modifier.width(6.dp))
                        Text(
                            when (w.outcome) {
                                "frame" -> "proof shot"; "voice" -> "by voice"; "text" -> "in text"; "done" -> "done"; "skipped" -> "skipped"; else -> w.kind
                            },
                            style = MaterialTheme.typography.labelMedium, color = Ink2, modifier = Modifier.weight(1f),
                        )
                        HybridBadge(w.by)
                    }
                    Text(w.ask, fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    w.answer?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, color = Ink2, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
    }
}

@Composable
private fun MotionBlock(d: MomentDetail) {
    Box {
        MotionChart(d.motion, d.frames.map { it.t }, Modifier.fillMaxWidth().height(110.dp))
        Row(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GlyphPill(Glyph.Motion, "${d.motion.size}", MaterialTheme.colorScheme.surfaceContainerHighest, fg = MaterialTheme.colorScheme.onSurface)
            GlyphPill(Glyph.Frames, "shots", SealGold, fg = SealInk)
        }
        InfoButton("Motion", Modifier.align(Alignment.TopEnd)) {
            Text("|acceleration| in m/s² over the Moment, ${d.motion.size} samples. Gold lines mark the proof shots.")
        }
    }
}

/** The hash chain as a chain of links (collapsed); tap for what it means. */
@Composable
private fun ChainBlock(d: MomentDetail) {
    var open by remember { mutableStateOf(false) }
    val state = d.chainOk
    val tint = when (state) { true -> Ok; false -> Bad; null -> Ink2 }
    Surface(
        onClick = { open = !open }, color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().semantics {
            contentDescription = "Hash chain: ${d.chunkCount} chunks, " + when (state) { true -> "intact"; false -> "does not verify"; null -> "not checked on this phone" }
        },
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Glyph.Chain, null, tint = tint)
                Spacer(Modifier.width(8.dp))
                Text("${d.chunkCount}", style = Tnum.merge(MaterialTheme.typography.titleMedium), fontWeight = FontWeight.Bold)
                Text(" chunks", color = Ink2, modifier = Modifier.weight(1f))
                when (state) {
                    true -> Icon(Icons.Filled.CheckCircle, null, tint = Ok)
                    false -> Icon(Icons.Filled.Close, null, tint = Bad)
                    null -> {}
                }
                Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = Ink2)
            }
            if (d.chunkCount > 0) ChainLinks(d.chunkCount, tint)
            AnimatedVisibility(open) {
                Text(
                    when {
                        d.chunkCount == 0 -> "Chunks stay with the owner; the seal records the server's chain check."
                        state == true -> "Each chunk is hashed into the next. Checked on this phone: intact."
                        state == false -> "The chain does not verify on this phone."
                        else -> "Each chunk is hashed into the next."
                    },
                    style = MaterialTheme.typography.bodySmall, color = if (state == false) Bad else Ink2,
                )
            }
        }
    }
}

@Composable
private fun ChainLinks(n: Int, tint: Color) {
    val shown = n.coerceAtMost(12)
    Row(verticalAlignment = Alignment.CenterVertically) {
        repeat(shown) { i ->
            if (i > 0) Box(Modifier.width(5.dp).height(2.dp).background(tint.copy(alpha = 0.6f)))
            Box(Modifier.size(width = 14.dp, height = 10.dp).clip(RoundedCornerShape(5.dp)).border(2.dp, tint, RoundedCornerShape(5.dp)))
        }
        if (n > shown) Text("  +${n - shown}", style = Tnum.merge(MaterialTheme.typography.labelMedium), color = Ink2)
    }
}

// ───────────────────────── Result

/** The verdict: the stamp beside a big score ring (tick = bar), the pips (tap to expand), one line of reason. */
@Composable
private fun RoomVerdict(d: MomentDetail, ok: Boolean, checks: Map<String, Boolean>) {
    val decided = d.card.status == "sealed" || d.card.status == "rejected"
    val p = d.verification?.score ?: d.score?.probability ?: d.card.score
    val bar = barOf(d)
    var expanded by remember { mutableStateOf(false) }
    var why by remember { mutableStateOf(false) }
    val reason = (d.seal?.reason ?: d.feedReason)?.takeIf { it.isNotBlank() }
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = RoundedCornerShape(22.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (decided) SealStamp(ok, Modifier.padding(vertical = 4.dp).graphicsLayer { rotationZ = -4f }, big = false)
                    else StatusBadge(d.card.status, d.local)
                    val v4 = d.v4?.takeIf { isV4(d) }
                    if (v4 != null && decided) {
                        val backed = v4.claimsBacked ?: bar?.let { b -> v4.claimScores.count { it.p >= b } }
                        if (backed != null) GlyphPill(Glyph.Result, "$backed/${v4.claims.size} claims backed", if (backed == v4.claims.size) FillOk else FillInk)
                    }
                    if (!decided) Text(
                        when {
                            isV4(d) -> sealingWords(d)
                            d.card.status == "submitted" -> "Judge, skeptic + scorer are running."
                            else -> "Not sealed yet."
                        },
                        style = MaterialTheme.typography.bodySmall, color = Ink2,
                    )
                }
                ScoreRing(p, bar, size = 96.dp)
            }
            if (d.card.cheating || d.v4?.cheatingDetected == true) CheatingBanner(d.v4?.cheatingSignals.orEmpty().ifEmpty { d.card.cheatingSignals })
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                    .clickable(onClickLabel = if (expanded) "Hide the checks" else "Show the checks") { expanded = !expanded }
                    .heightIn(min = 48.dp).padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CheckPips(checks, labels = expanded, modifier = Modifier.weight(1f))
                Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = Ink2)
            }
            AnimatedVisibility(expanded) { SealCheckList(d, checks) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(reason ?: "", style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                TextButton(onClick = { why = true }) { Text(if (reason != null) "Why?" else "The bar") }
            }
        }
    }
    if (why) InfoSheet("The verdict", { why = false }, icon = Glyph.Result) {
        reason?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
        BarDetails(d)
    }
}

/** Every seal check with its full label (v3 / v4 wording). */
@Composable
private fun SealCheckList(d: MomentDetail, checks: Map<String, Boolean>) {
    val labels = if (d.sealVersion >= 4) linkedMapOf(
        "chain" to "Hash chain intact", "timing" to "Timing consistent", "physics" to "Physics plausible",
        "frames" to "Proof frames match",
        "ai" to "The proof frames don't contradict the intention",
        "cheating" to "No cheating detected",
        "bar" to "Every claim reaches the bar" + (barOf(d)?.let { " (${V3Math.fmt(it)})" } ?: ""),
    ) else linkedMapOf(
        "chain" to "Hash chain intact", "timing" to "Timing consistent", "physics" to "Physics plausible",
        "frames" to "Proof frames match",
        "ai" to if (d.sealVersion >= 3) "Judge consistent, skeptic found nothing" else "Judge consistent, skeptic found nothing, score ≥ 50%",
        "bar" to "Score reaches the bar" + (d.bar?.let { " (${V3Math.fmt(it.value)})" } ?: ""),
    )
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (checks.isEmpty()) {
            Text(
                if (d.card.status == "submitted") "Waiting for judge, skeptic + scorer, then the Cloud Function seals." else "Not sealed yet.",
                color = Ink2, style = MaterialTheme.typography.bodySmall,
            )
            d.chainOk?.let { CheckRow("chain", "Hash chain (checked on this phone, ${d.chunkCount} chunks)", it) }
        } else labels.forEach { (k, label) -> checks[k]?.let { CheckRow(k, label, it) } }
    }
}

@Composable
private fun CheckRow(key: String, label: String, ok: Boolean) = Row(
    verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) {},
) {
    Icon(checkGlyph(key), null, Modifier.size(16.dp), tint = Ink2)
    Spacer(Modifier.width(8.dp))
    Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    Icon(if (ok) Icons.Filled.CheckCircle else Icons.Filled.Close, if (ok) "passed" else "failed", Modifier.size(18.dp), tint = if (ok) Ok else Bad)
}

/** The AI-set bar (v3.3, server-side) against the final score (v3.5), in the "why" sheet. */
@Composable
private fun BarDetails(d: MomentDetail) {
    val bar = d.bar
    val preview = d.intention?.preview
    val score = d.verification?.score ?: d.score?.probability
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Glyph.Ladder, null, tint = Lake)
        Spacer(Modifier.width(8.dp))
        Text("The bar", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        when {
            bar != null -> if (bar.source == "default") GlyphPill(null, "standard", FillInk) else HybridBadge("cloud")
            preview != null -> HybridBadge(preview.mode)
        }
    }
    when {
        bar != null -> {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ScoreRing(score, bar.value, size = 72.dp)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text("bar ${V3Math.fmt(bar.value)}" + (score?.let { " · score ${V3Math.fmt(it)}" } ?: ""), style = Tnum.merge(MaterialTheme.typography.titleMedium))
                    Text(if (bar.source == "default") "standard bar" else "set by AI in the cloud", color = Ink2, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (bar.rationale.isNotBlank()) Text(bar.rationale, style = MaterialTheme.typography.bodyMedium)
            bar.factors.forEach { Bullet(it) }
            Text(
                "Difficulty ${V3Math.fmt(bar.difficulty)} → bar = 0.5 + 0.45 × difficulty. The score must reach it to be Verified.",
                style = MaterialTheme.typography.bodySmall, color = Ink2,
            )
        }
        preview != null -> {
            Text("Bar ≈ ${V3Math.fmt(preview.bar)} (preview)", style = MaterialTheme.typography.titleMedium)
            Text("The binding bar is set in the cloud once the Moment is submitted.", style = MaterialTheme.typography.bodySmall, color = Ink2)
        }
        else -> Text(if (d.local) "Set in the cloud once you sign in and upload." else "Set in the cloud once the Moment is submitted.", color = Ink2)
    }
}

/** Judge, skeptic and scorer side by side: verdict glyph + one line; the rest behind "More". */
@Composable
private fun OpinionStrip(d: MomentDetail) {
    var open by remember { mutableStateOf<String?>(null) }
    BlockTitle(Glyph.Ai, "AI opinions") { HybridBadge("cloud") }
    val bar = d.bar?.value ?: 0.5
    val baseline = d.verification?.modules?.isNotEmpty() == true
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item { OpinionCard("Judge", d.judge?.verdict, d.judge?.confidence, (d.judge?.reasons ?: d.judgeReasons).firstOrNull()) { open = "Judge" } }
        item { OpinionCard("Skeptic", d.skeptic?.verdict, d.skeptic?.confidence, d.skeptic?.reasons?.firstOrNull()) { open = "Skeptic" } }
        item {
            val s = d.score
            OpinionCard(
                if (baseline) "Baseline" else "Scorer", s?.let { if (it.probability >= bar) "consistent" else "inconsistent" }, null,
                s?.reasons?.firstOrNull(), scoreText = s?.let { pct(it.probability) },
            ) { open = "Scorer" }
        }
    }
    open?.let { which ->
        InfoSheet(if (which == "Scorer" && baseline) "Baseline score (before the ladder)" else which, { open = null }, icon = Glyph.Ai) {
            when (which) {
                "Judge" -> OpinionDetail(d.judge, d.judgeReasons)
                "Skeptic" -> OpinionDetail(d.skeptic, emptyList())
                else -> {
                    val s = d.score
                    if (s == null) Text("Not scored", color = Ink2)
                    else {
                        Text(pct(s.probability), style = MaterialTheme.typography.displaySmall, color = if (s.probability >= bar) Ok else Bad)
                        Text(
                            "Chance the claim is true given the evidence, assuming most submissions are cheating (prior 20%).",
                            style = MaterialTheme.typography.bodySmall, color = Ink2,
                        )
                        s.reasons.forEach { Bullet(it) }
                        if (s.model.isNotBlank()) Text(s.model + " · in the cloud", style = MaterialTheme.typography.labelSmall, color = Ink2)
                    }
                }
            }
        }
    }
}

@Composable
private fun OpinionCard(title: String, verdict: String?, confidence: Double?, line: String?, scoreText: String? = null, onMore: () -> Unit) {
    val (icon, tint) = when (verdict) {
        "consistent" -> Icons.Filled.CheckCircle to Ok
        "inconsistent" -> Icons.Filled.Close to Bad
        null -> Icons.AutoMirrored.Filled.HelpOutline to Ink2
        else -> Icons.AutoMirrored.Filled.HelpOutline to Warn
    }
    Surface(
        onClick = onMore, color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp),
        modifier = Modifier.width(176.dp).semantics { contentDescription = "$title: ${verdict ?: "pending"}" + ((scoreText ?: confidence?.let { pct(it) })?.let { ", $it" } ?: "") },
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, Modifier.size(20.dp), tint = tint)
                Spacer(Modifier.width(6.dp))
                Text(title, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                (scoreText ?: confidence?.let { pct(it) })?.let { Text(it, style = Tnum.merge(MaterialTheme.typography.labelLarge), color = tint) }
            }
            Text(
                line ?: "Runs in the cloud once synced.", style = MaterialTheme.typography.bodySmall, color = Ink2, maxLines = 3,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.heightIn(min = 48.dp),
            )
            Text("More", style = MaterialTheme.typography.labelLarge, color = Lake)
        }
    }
}

@Composable
private fun OpinionDetail(o: Opinion?, fallbackReasons: List<String>) {
    if (o != null) GlyphPill(null, "${o.verdict} · ${pct(o.confidence)}", when (o.verdict) { "consistent" -> FillOk; "inconsistent" -> FillBad; else -> FillInk })
    val reasons = o?.reasons ?: fallbackReasons
    if (reasons.isEmpty()) Text(if (o == null) "Runs in the cloud once the Moment is synced." else "No reasons given.", color = Ink2)
    reasons.forEach { Bullet(it) }
    if (o != null && o.model.isNotBlank()) Text(o.model + " · in the cloud", style = MaterialTheme.typography.labelSmall, color = Ink2)
}

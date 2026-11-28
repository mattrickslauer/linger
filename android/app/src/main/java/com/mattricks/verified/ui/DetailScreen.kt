package com.mattricks.verified.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Slider
import androidx.compose.runtime.key
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mattricks.verified.data.SharedClip
import kotlin.math.roundToInt
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
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
            error != null -> Column(Modifier.fillMaxSize()) {
                RoomChrome(onBack = onBack, onDelete = null)
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    EmptyState(Glyph.Warning, "Couldn't open this Moment.", Modifier.align(Alignment.Center)) {
                        Text(error ?: "", color = Ink2, style = MaterialTheme.typography.bodySmall)
                        Button(onClick = { error = null; refresh++ }) { Icon(Icons.Filled.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Retry") }
                    }
                }
            }
            else -> Column(Modifier.fillMaxSize()) {
                RoomChrome(onBack = onBack, onDelete = null)
                Skeleton(Modifier.padding(16.dp).fillMaxWidth().height(160.dp))
                repeat(3) { Skeleton(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().height(72.dp)) }
            }
        }
    }
}

private val SECTIONS = listOf(Triple(Wp.Intent, "Intent", Glyph.Intent), Triple(Wp.Proof, "Evidence", Glyph.Proof), Triple(Wp.Result, "Result", Glyph.Result))

/** What the summary thumbnail or an evidence tile opens: media in a full-screen modal, the rest in a sheet. */
internal sealed interface Viewer {
    data class Clip(val path: String) : Viewer
    data class Shots(val index: Int) : Viewer
    data object Route : Viewer
    data object Motion : Viewer
    data object Chain : Viewer
    data object Witness : Viewer
}

/**
 * The evidence room, tight: a compact summary card (aspect-fit thumbnail, the intention, stamp + score + claims, the
 * pips) over one row of stats; then Intent; Evidence as a grid of tiles, each opening the full view in a modal; then
 * the Result. Follows the app theme.
 */
@Composable
internal fun DetailBody(d: MomentDetail, onBack: () -> Unit, onDelete: (() -> Unit)?, onOpenLadder: () -> Unit) {
    val ok = d.card.status == "sealed" && !d.card.cheating
    val checks = d.seal?.checks?.takeIf { it.isNotEmpty() } ?: d.feedChecks
    val isOwner = d.ownerUid.isNotEmpty() && d.ownerUid == runCatching { Firebase.auth.currentUser?.uid }.getOrNull()
    var viewer by remember(d.card.id) { mutableStateOf<Viewer?>(null) }

    val intent = buildList<@Composable ColumnScope.() -> Unit> {
        if (d.local) add { LocalBanner(d) }
        add { IntentionChips(d) }
    }

    val evidence = buildList<@Composable ColumnScope.() -> Unit> {
        // v4: the free video review sits with the evidence it reviewed.
        if (isV4(d)) add { VideoReviewCard(d) }
        else if (!d.local && d.card.status == "recording" && d.videos.isNotEmpty()) add { VideoUploadLine(d.card.id) }
        val cov = videoCoverage(d)
        if (cov.short) add { CoverageNote(cov) }
        add { EvidenceGrid(d) { viewer = it } }
    }

    val result = buildList<@Composable ColumnScope.() -> Unit> {
        add { RoomVerdict(d, ok, checks) }
        // v4: one row per claim (docs/ARCHITECTURE.md v4.11).
        if (isV4(d)) add { ClaimsSection(d) { c, s -> ClaimOffers(d, c, s) } }
        add { OpinionStrip(d) }
        add { LadderSection(d, isOwner = isOwner, onOpenLadder = onOpenLadder) }
    }

    val nav = WindowInsets.safeBars.asPaddingValues()
    Column(Modifier.fillMaxSize()) {
        RoomChrome(onBack, onDelete)
        // Sides clear of a landscape cutout / side nav bar; the bottom scrolls under the gesture bar but ends above it.
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth().safeSides(),
            contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp + nav.calculateBottomPadding()),
        ) {
            item(key = "summary") { SummaryCard(d, ok, checks) { viewer = it } }
            item(key = "stats") { StatsRow(d) }
            listOf(intent, evidence, result).forEachIndexed { si, body ->
                val (kind, title, _) = SECTIONS[si]
                itemsIndexed(body, key = { i, _ -> "${kind.name}-$i" }) { i, block ->
                    RoomRow(kind, ok, header = i == 0) {
                        if (i == 0) Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                        block()
                    }
                }
            }
        }
    }
    viewer?.let { EvidenceViewer(d, it) { viewer = null } }
}

/** Back (and delete, on my own Moments) in a solid bar. */
@Composable
private fun RoomChrome(onBack: () -> Unit, onDelete: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).safeTopAndSides().padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text("Evidence room", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).padding(horizontal = 4.dp))
        if (onDelete != null) IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, "Delete Moment") }
    }
}

// ───────────────────────── Summary

/** The hero proof shot: the card's hero, else the last frame. */
private fun heroB64(d: MomentDetail): String? = d.card.heroJpegB64?.takeIf { it.isNotEmpty() } ?: d.frames.lastOrNull()?.jpegB64

/** The frame the hero is (to open the proof viewer on it), else the last. */
private fun heroFrameIndex(d: MomentDetail): Int =
    d.frames.indexOfFirst { it.jpegB64.isNotEmpty() && it.jpegB64 == d.card.heroJpegB64 }.takeIf { it >= 0 } ?: (d.frames.size - 1).coerceAtLeast(0)

/** The clip the summary thumbnail plays: the last one whose hash is not known to mismatch (like the feed), else any. */
private fun heroClip(d: MomentDetail): SharedClip? = d.sharedClips.lastOrNull { it.hashOk != false } ?: d.sharedClips.lastOrNull()

private fun dimmed(d: MomentDetail): ColorFilter? =
    if (d.card.status != "rejected" && !d.card.cheating) null else ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.3f) })

private fun platformLabel(p: String): String = when (p.lowercase()) {
    "android" -> "Android"
    "ios" -> "iPhone"
    "web" -> "Web"
    else -> p.replaceFirstChar { it.uppercase() }
}

/** Session time against recorded video time (web videoCoverage): the chained clips, else the uploaded ones. */
internal data class VideoCoverage(val videoMs: Long, val sessionMs: Long) {
    val ratio: Float get() = if (sessionMs > 0) minOf(1f, videoMs.toFloat() / sessionMs) else if (videoMs > 0) 1f else 0f
    /** Worth a note: there is video, but it covers under 80% of the session. */
    val short: Boolean get() = videoMs > 0 && sessionMs > 0 && ratio < 0.8f
}

internal fun videoCoverage(d: MomentDetail): VideoCoverage = VideoCoverage(
    (d.videos.takeIf { it.isNotEmpty() }?.sumOf { maxOf(0L, it.durationMs) } ?: d.sharedClips.sumOf { maxOf(0L, it.durationMs) }),
    d.card.summary.durationMs,
)

/** The compact header: thumbnail (tap = media viewer), the quoted intention, who/when/where, stamp + ring + claims, pips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SummaryCard(d: MomentDetail, ok: Boolean, checks: Map<String, Boolean>, onOpen: (Viewer) -> Unit) {
    val p = d.verification?.score ?: d.score?.probability ?: d.card.score
    val bar = barOf(d) ?: d.intention?.preview?.bar
    val decided = d.card.status == "sealed" || d.card.status == "rejected"
    val clip = heroClip(d)
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer, shape = RoundedCornerShape(20.dp),
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row {
                MediaThumb(
                    d, play = clip != null, modifier = Modifier.width(104.dp),
                    onClickLabel = if (clip != null) "Play the video" else "View the proof shots",
                ) { onOpen(clip?.let { Viewer.Clip(it.path) } ?: Viewer.Shots(heroFrameIndex(d))) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = if (ok) TrackOrange else Ink2)) { append("“") }
                            append(d.card.intention)
                            withStyle(SpanStyle(color = if (ok) TrackOrange else Ink2)) { append("”") }
                        },
                        fontSize = 18.sp, lineHeight = 22.sp, fontWeight = FontWeight.ExtraBold, maxLines = 4, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        listOfNotNull(
                            d.card.ownerName.ifBlank { "Someone" },
                            agoText(d.startedAt.takeIf { it > 0 } ?: d.card.startedAt).takeIf { it.isNotBlank() },
                            d.card.platform.takeIf { it.isNotBlank() }?.let(::platformLabel),
                        ).joinToString(" · "),
                        color = Ink2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
                        itemVerticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (decided) SealStamp(ok, Modifier.padding(vertical = 2.dp).graphicsLayer { rotationZ = -4f }, big = false)
                        else StatusBadge(d.card.status, d.local, d.card.cheating)
                        if (p != null || bar != null) ScoreRing(p, bar, size = 52.dp)
                        val v4 = d.v4?.takeIf { isV4(d) }
                        val total = v4?.claims?.size ?: d.card.claimsTotal
                        val backed = v4?.let { it.claimsBacked ?: barOf(d)?.let { b -> it.claimScores.count { s -> s.p >= b } } } ?: d.card.claimsBacked
                        if (total != null && total > 0) GlyphPill(Glyph.Result, "${backed ?: "–"}/$total claims", if (backed == total) FillOk else FillInk)
                    }
                }
            }
            CheckPips(checks, pip = 22.dp)
        }
    }
}

/** The hero proof shot, aspect-fit (never cropped), turned by displayRotation; a play badge when there is a clip. */
@Composable
private fun MediaThumb(d: MomentDetail, play: Boolean, modifier: Modifier, onClickLabel: String, onClick: () -> Unit) {
    val bmp = rememberB64Bitmap(heroB64(d), d.card.displayRotation)
    val aspect = bmp?.let { it.width.toFloat() / it.height.coerceAtLeast(1) }?.coerceIn(0.66f, 1.34f) ?: 0.75f
    Box(
        modifier.aspectRatio(aspect).clip(RoundedCornerShape(14.dp)).background(MediaBg).clickable(onClickLabel = onClickLabel, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (bmp != null) FitImage(bmp, "Proof shot", Modifier.matchParentSize(), colorFilter = dimmed(d))
        else if (d.track.size > 1) TrackSketch(d.track, Modifier.matchParentSize())
        else Icon(Glyph.Frames, "No proof shot", tint = TokInk2)
        if (play) PlayBadge(36.dp)
    }
}

@Composable
private fun PlayBadge(size: androidx.compose.ui.unit.Dp) {
    Box(Modifier.size(size).clip(CircleShape).background(TokInk.copy(alpha = 0.9f)), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.PlayArrow, null, tint = MediaBg, modifier = Modifier.size(size * 0.62f))
    }
}

/** Session, on video, moved, shots, live checks: one compact row (scrolls sideways if it must). */
@Composable
private fun StatsRow(d: MomentDetail) {
    val cov = videoCoverage(d)
    val checked = d.frames.count { it.check != null }
    val retakes = d.frames.count { it.check?.ok == false }
    val ink = MaterialTheme.colorScheme.onSurface
    val sub = Ink2
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        StatOverlay(Glyph.Time, fmtDuration(d.card.summary.durationMs), "session", tint = ink, sub = sub)
        if (cov.videoMs > 0) StatOverlay(Glyph.Video, fmtDuration(cov.videoMs), "on video", tint = ink, sub = sub)
        StatOverlay(Glyph.Distance, fmtDistance(d.card.summary.distanceM), "moved", tint = ink, sub = sub)
        StatOverlay(Glyph.Frames, "${d.frames.size.takeIf { it > 0 } ?: d.card.summary.frameCount}", "shots", tint = ink, sub = sub)
        if (checked > 0) StatOverlay(Glyph.OnDevice, if (retakes > 0) "$checked · $retakes↻" else "$checked", "live checks", tint = ink, sub = sub)
    }
}

/** One small line when the video covers under 80% of the session. */
@Composable
private fun CoverageNote(c: VideoCoverage) {
    Row(Modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Icon(Glyph.Video, null, Modifier.size(14.dp), tint = Ink2)
        Spacer(Modifier.width(6.dp))
        Text(
            "Video covers ${fmtDuration(c.videoMs)} of the ${fmtDuration(c.sessionMs)} session (${(c.ratio * 100).roundToInt()}%); only that part can back claims over time.",
            style = MaterialTheme.typography.bodySmall, color = Ink2, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
    }
}

// ───────────────────────── Evidence grid + modals

private class Tile(
    val icon: ImageVector, val title: String, val stat: String, val clickLabel: String, val open: Viewer,
    val status: Boolean? = null, val media: Boolean = false, val preview: @Composable BoxScope.() -> Unit,
)

/** Every kind of evidence as a small tile (2 columns on a phone, 3 when wide); a tap opens the full view. */
@Composable
private fun EvidenceGrid(d: MomentDetail, onOpen: (Viewer) -> Unit) {
    val rot = d.card.displayRotation
    val hero = rememberB64Bitmap(heroB64(d), rot)
    val dim = dimmed(d)
    val mediaPreview: @Composable BoxScope.(Boolean) -> Unit = { play ->
        if (hero != null) FitImage(hero, null, Modifier.matchParentSize(), colorFilter = dim)
        else Icon(Glyph.Frames, null, tint = TokInk2)
        if (play) PlayBadge(30.dp)
    }
    val tiles = buildList {
        d.sharedClips.forEachIndexed { i, c ->
            val hash = when (c.hashOk) { true -> "hash ✓"; false -> "hash ✗"; null -> "uploaded" }
            add(
                Tile(
                    Glyph.Video, if (d.sharedClips.size > 1) "Video ${i + 1}" else "Video",
                    listOfNotNull(c.durationMs.takeIf { it > 0 }?.let(::fmtDuration), hash).joinToString(" · "),
                    "Play clip ${i + 1}", Viewer.Clip(c.path), status = c.hashOk, media = true,
                ) { mediaPreview(true) },
            )
        }
        if (d.frames.isNotEmpty()) {
            val retakes = d.frames.count { it.check?.ok == false }
            add(
                Tile(
                    Glyph.Frames, "Proof shots", "${d.frames.size} shots" + if (retakes > 0) " · $retakes retake${if (retakes > 1) "s" else ""}" else "",
                    "View the proof shots", Viewer.Shots(heroFrameIndex(d)), media = true,
                ) { mediaPreview(false) },
            )
        }
        add(
            Tile(Glyph.Place, "Route", "${fmtDistance(d.card.summary.distanceM)} · ${d.track.size} fixes", "Open the route map", Viewer.Route, media = true) {
                if (d.track.size > 1) TrackSketch(d.track, Modifier.matchParentSize()) else Icon(Glyph.Place, null, tint = TokInk2)
            },
        )
        if (d.motion.isNotEmpty()) add(
            Tile(Glyph.Motion, "Motion", "${d.motion.size} samples", "Open the motion chart", Viewer.Motion) {
                MotionChart(d.motion, d.frames.map { it.t }, Modifier.matchParentSize())
            },
        )
        add(
            Tile(
                Glyph.Chain, "Hash chain",
                "${d.chunkCount} links · " + when (d.chainOk) { true -> "intact"; false -> "doesn't verify"; null -> "not checked" },
                "Open the hash chain", Viewer.Chain, status = d.chainOk,
            ) { if (d.chunkCount > 0) ChainLinks(d.chunkCount, when (d.chainOk) { true -> Ok; false -> Bad; null -> Ink2 }, max = 5) else Icon(Glyph.Chain, null, tint = Ink2) },
        )
        if (d.witness.isNotEmpty()) {
            val answered = d.witness.count { it.outcome != null && it.outcome != "skipped" }
            add(
                Tile(Glyph.Witness, "Witness", "$answered/${d.witness.size} answered", "Open the witness requests", Viewer.Witness) {
                    Text(
                        "“${d.witness.first().ask}”", style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(8.dp),
                    )
                },
            )
        }
    }
    val cols = if (LocalConfiguration.current.screenWidthDp >= 600) 3 else 2
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        tiles.chunked(cols).forEach { row ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { t -> EvidenceTile(t, Modifier.weight(1f).fillMaxHeight()) { onOpen(t.open) } }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun EvidenceTile(t: Tile, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClickLabel = t.clickLabel, onClick = onClick).semantics(mergeDescendants = true) {}.padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(10.dp))
                .background(if (t.media) MediaBg else MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center, content = t.preview,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(t.icon, null, Modifier.size(16.dp), tint = Lake)
            Spacer(Modifier.width(6.dp))
            Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            when (t.status) {
                true -> Icon(Icons.Filled.CheckCircle, "verified", Modifier.size(16.dp), tint = Ok)
                false -> Icon(Glyph.Warning, "mismatch", Modifier.size(16.dp), tint = Bad)
                null -> {}
            }
        }
        Text(t.stat, style = Tnum.merge(MaterialTheme.typography.bodySmall), color = Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The full view behind a tile: clip player, proof shots and route in a full-screen modal; motion, chain, witness in a sheet. */
@Composable
private fun EvidenceViewer(d: MomentDetail, v: Viewer, onDismiss: () -> Unit) {
    when (v) {
        is Viewer.Clip -> ClipViewer(d, v.path, onDismiss)
        is Viewer.Shots -> MediaDialog("Proof shots", onDismiss) { ProofViewer(d, v.index) }
        Viewer.Route -> MediaDialog("Route", onDismiss) { MapWithStats(d, Modifier.fillMaxWidth().weight(1f)) }
        Viewer.Motion -> InfoSheet("Motion", onDismiss, icon = Glyph.Motion) { MotionBlock(d) }
        Viewer.Chain -> InfoSheet("Hash chain", onDismiss, icon = Glyph.Chain) { ChainBlock(d) }
        Viewer.Witness -> InfoSheet("Witness", onDismiss, icon = Glyph.Witness) { WitnessStrip(d, title = false) }
    }
}

/** A full-screen modal on the dark media background: title + close on top, [content] filling the rest. */
@Composable
private fun MediaDialog(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        MediaTheme {
            Surface(Modifier.fillMaxSize(), color = MediaBg, contentColor = TokInk) {
                Column(Modifier.fillMaxSize().safeDrawingPadding().padding(bottom = 12.dp)) {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(title, style = MaterialTheme.typography.titleMedium, color = TokInk, modifier = Modifier.weight(1f).semantics { heading() })
                        IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, "Close", tint = TokInk) }
                    }
                    Column(
                        Modifier.fillMaxWidth().weight(1f).padding(horizontal = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
                        horizontalAlignment = Alignment.CenterHorizontally, content = content,
                    )
                }
            }
        }
    }
}

/** One uploaded clip with controls, at its oriented aspect; other clips of the Moment one tap away. */
@Composable
private fun ClipViewer(d: MomentDetail, initial: String, onDismiss: () -> Unit) {
    var path by remember(initial) { mutableStateOf(initial) }
    val i = d.sharedClips.indexOfFirst { it.path == path }
    val clip = d.sharedClips.getOrNull(i) ?: return
    MediaDialog(if (d.sharedClips.size > 1) "Video ${i + 1} of ${d.sharedClips.size}" else "Video", onDismiss) {
        key(clip.path) { ClipPlayer(clip, d.card.displayRotation, Modifier.fillMaxWidth().weight(1f)) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            d.sharedClips.forEachIndexed { j, c ->
                val on = j == i
                val (icon, tint, what) = when (c.hashOk) {
                    true -> Triple(Glyph.Chain, TokOk, "hash matches the chain")
                    false -> Triple(Glyph.Warning, TokBad, "Hash does not match the chain")
                    null -> Triple(Glyph.Cloud, TokInk2, "uploaded")
                }
                ScrimChip(
                    Modifier.clip(RoundedCornerShape(50)).border(if (on) 2.dp else 0.dp, if (on) SealGold else Color.Transparent, RoundedCornerShape(50))
                        .clickable(onClickLabel = "Play clip ${j + 1}") { path = c.path }
                        .semantics(mergeDescendants = true) { contentDescription = "Clip ${j + 1}, $what" },
                    color = TokInk.copy(alpha = 0.12f),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (d.sharedClips.size > 1) { Text("${j + 1}", fontWeight = FontWeight.Bold, fontSize = 13.sp); Spacer(Modifier.width(6.dp)) }
                        if (c.durationMs > 0) { StatOverlay(Glyph.Time, fmtDuration(c.durationMs)); Spacer(Modifier.width(6.dp)) }
                        Icon(icon, null, Modifier.size(14.dp), tint = tint)
                        if (c.hashOk == false) { Spacer(Modifier.width(4.dp)); Text("mismatch", fontSize = 11.sp, color = tint) }
                    }
                }
            }
        }
    }
}

/** The proof-shot stage (aspect-fit, the frame's own coach result on it), the filmstrip, and a scrubber. */
@Composable
private fun ColumnScope.ProofViewer(d: MomentDetail, initial: Int) {
    val n = d.frames.size
    var selected by remember(initial) { mutableIntStateOf(initial.coerceIn(0, (n - 1).coerceAtLeast(0))) }
    val frame = d.frames.getOrNull(selected)
    Box(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(16.dp))) {
        val bmp = rememberB64Bitmap(frame?.jpegB64?.takeIf { it.isNotEmpty() } ?: d.card.heroJpegB64, d.card.displayRotation)
        if (bmp != null) FitImage(bmp, "Proof shot ${selected + 1} of $n", Modifier.matchParentSize(), colorFilter = dimmed(d))
        else Box(Modifier.matchParentSize(), contentAlignment = Alignment.Center) { Icon(Glyph.Frames, "No frame", tint = TokInk2) }
        frame?.let { FrameChips(it, Modifier.align(Alignment.TopEnd).padding(8.dp)) }
    }
    if (n > 1) {
        Filmstrip(d, selected) { selected = it }
        Slider(
            value = selected.toFloat(), onValueChange = { selected = it.roundToInt().coerceIn(0, n - 1) },
            valueRange = 0f..(n - 1).toFloat(), steps = (n - 2).coerceAtLeast(0),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp).semantics { contentDescription = "Proof shot ${selected + 1} of $n" },
        )
    }
}

/** The frame's on-device coach result (and the witness ask it answered), as chips on the photo. */
@Composable
private fun FrameChips(frame: com.mattricks.verified.data.Frame, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        frame.check?.let { c ->
            ScrimChip(Modifier.semantics(mergeDescendants = true) {}) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (c.ok) Icons.Filled.CheckCircle else Glyph.Warning, null, Modifier.size(15.dp), tint = if (c.ok) TokOk else TokBad)
                    Spacer(Modifier.width(5.dp))
                    Text(
                        (if (c.ok) "keep going" else "retake: ${c.reason}") + (c.label.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
                        fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 220.dp),
                    )
                }
            }
            HybridBadge(c.mode, onMedia = true)
        }
        frame.witnessAsk?.let { ask ->
            ScrimChip {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Glyph.Witness, "Witness asked", Modifier.size(15.dp)); Spacer(Modifier.width(5.dp))
                    Text(ask, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 220.dp))
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
                    B64Image(fr.jpegB64, Modifier.matchParentSize(), rotation = d.card.displayRotation)
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
            val dotY = 20.dp.toPx()
            if (kind != Wp.Result) dashedTrack(x, if (header) dotY + 14.dp.toPx() else 0f, size.height, if (ok) trackC else muted)
            if (header) waypointDot(kind, ok, Offset(x, dotY), hole = hole, muted = muted, bad = badC)
        }.padding(start = 16.dp + 28.dp, end = 16.dp),
    ) {
        Column(
            Modifier.weight(1f).padding(top = if (header) 8.dp else 4.dp, bottom = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp), content = content,
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
private fun MapWithStats(d: MomentDetail, modifier: Modifier = Modifier.fillMaxWidth().height(240.dp)) {
    Box(modifier.clip(RoundedCornerShape(18.dp))) {
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
private fun WitnessStrip(d: MomentDetail, title: Boolean = true) {
    val answered = d.witness.count { it.outcome != null && it.outcome != "skipped" }
    if (title) BlockTitle(Glyph.Witness, "Witness") { Text("$answered/${d.witness.size}", style = Tnum.merge(MaterialTheme.typography.titleMedium), color = Ink2) }
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
private fun ChainLinks(n: Int, tint: Color, max: Int = 12) {
    val shown = n.coerceAtMost(max)
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
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
                ScoreRing(p, bar, size = 80.dp)
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

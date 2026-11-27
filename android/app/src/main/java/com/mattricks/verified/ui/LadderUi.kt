package com.mattricks.verified.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Straighten
import androidx.compose.material3.TextButton
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Toll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.data.Ladder
import com.mattricks.verified.data.LadderLogic
import com.mattricks.verified.data.LadderResult
import com.mattricks.verified.data.MomentDetail
import com.mattricks.verified.data.V3Math
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

/** The score the next module starts from: the final score so far, else the scorer's baseline. */
fun currentScore(d: MomentDetail): Double? = d.verification?.score ?: d.verification?.baseline ?: d.score?.probability

/** What the Moment has for the modules' `needs` (v3.6), with the v4 meanings on v4 Moments (v4.6). */
fun ladderEvidence(d: MomentDetail, clipOnPhone: Boolean): LadderLogic.Evidence {
    val v4 = d.v4?.takeIf { isV4(d) }
    val vr = v4?.videoReview
    return LadderLogic.Evidence(
        frames = d.frames.count { it.jpegB64.isNotEmpty() }, gps = d.track.size,
        witnessAnswered = d.witness.count { it.outcome != null && it.outcome != "skipped" },
        quantities = if (v4 != null) v4.claims.count { it.kind == "count" || it.kind == "measure" } else d.intention?.quantities?.size ?: 0,
        video = d.videos.isNotEmpty(), clipOnPhone = clipOnPhone, v4 = v4 != null,
        clipUploaded = vr != null && (vr.clips.any { it.uploaded && it.hashOk != false } || (vr.clips.isEmpty() && vr.status == "done")),
    )
}

/** Claim ids a module backs on this v4 Moment (empty on v3 Moments). */
fun backedBy(d: MomentDetail, m: LadderLogic.Module): List<String> {
    val v4 = d.v4?.takeIf { isV4(d) } ?: return emptyList()
    return LadderLogic.backedClaims(m, v4.claims, v4.plan?.requirements.orEmpty(), d.witnessRids)
}

/** One glyph per ladder module. */
fun moduleGlyph(id: String): ImageVector = when (id) {
    "second_look" -> Glyph.Ai
    "place_time" -> Glyph.Place
    "witness_review" -> Glyph.Witness
    "count_measure" -> Icons.Filled.Straighten
    "full_video" -> Glyph.Video
    "human_review" -> Icons.Filled.Person
    else -> Glyph.Ladder
}

/**
 * Under a claim (v4.11): the modules that can still back it, each as a preview bar ("0.40 → 0.58 ↑ / 0.28 ↓").
 * Only once the seal is ready and the ladder is open.
 */
@Composable
fun ClaimOffers(d: MomentDetail, c: com.mattricks.verified.data.Claim, s: com.mattricks.verified.data.ClaimScore?) {
    if (s == null || !d.ladderEligible || d.card.status !in setOf("sealed", "rejected")) return
    val scores = d.v4?.claimScores.orEmpty()
    val ran = d.verification?.modules.orEmpty().map { it.module }.toSet()
    val e = ladderEvidence(d, clipOnPhone = false)
    val offers = Ladder.modules.filter { m ->
        m.id !in ran && m.available && c.id in backedBy(d, m) && LadderLogic.unmet(m, e, Ladder.needsText) == null
    }
    if (offers.isEmpty()) return
    Text("Can still back it", style = MaterialTheme.typography.titleSmall)
    offers.forEach { m ->
        val pv = com.mattricks.verified.data.V4Score.preview(scores, c.id, m.strength) ?: return@forEach
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(moduleGlyph(m.id), null, Modifier.size(18.dp), tint = Lake)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(m.title, fontWeight = FontWeight.SemiBold)
                PreviewBar(s.p, pv.passP, pv.failP, barOf(d))
            }
        }
    }
}

fun claimText(d: MomentDetail): (String) -> String = { id -> d.v4?.claims?.firstOrNull { it.id == id }?.text ?: id }

/** Public: every ladder result on the post as chips (v3.5/v3.8); tap for the details. Owner: the way into the ladder sheet. */
@Composable
fun LadderSection(d: MomentDetail, isOwner: Boolean, onOpenLadder: () -> Unit) {
    val results = d.verification?.modules.orEmpty()
    val canClimb = isOwner && d.card.status in setOf("sealed", "rejected") && d.sealVersion >= 3
    if (results.isEmpty() && !isOwner) return
    var open by remember { mutableStateOf<LadderResult?>(null) }
    BlockTitle(Glyph.Ladder, "Ladder") {
        InfoButton("Verification ladder") {
            Text("Paying never buys a score: it buys more scrutiny. Modules that fail lower the score.")
            Text("Credits start free; buy more from the credits pill (checkout on pay.mattrickslauer.com).", style = MaterialTheme.typography.bodySmall, color = Ink2)
        }
    }
    d.verification?.let { v ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${v.baseline?.let(V3Math::fmt) ?: "–"} → ${v.score?.let(V3Math::fmt) ?: "–"}",
                style = Tnum.merge(MaterialTheme.typography.titleMedium), modifier = Modifier.semantics {
                    contentDescription = "Baseline ${v.baseline?.let(V3Math::fmt) ?: "none"}, score now ${v.score?.let(V3Math::fmt) ?: "none"}"
                },
            )
            Spacer(Modifier.width(8.dp))
            Text("bar ${V3Math.fmt(v.bar)}", style = Tnum.merge(MaterialTheme.typography.labelLarge), color = Ink2, modifier = Modifier.weight(1f))
            if (v.verified) StatusBadge("sealed") else GlyphPill(null, "below bar", FillInk)
        }
        v.score?.let { BarMeter(it, v.bar, Modifier.fillMaxWidth(), height = 6.dp) }
    }
    if (results.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(results) { r ->
            Surface(
                onClick = { open = r }, color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(14.dp),
                modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = "${r.title.ifBlank { r.module }} ${if (r.passed) "passed" else "failed"}" },
            ) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(moduleGlyph(r.module), null, Modifier.size(18.dp), tint = Lake)
                    Spacer(Modifier.width(6.dp))
                    Text(r.title.ifBlank { r.module }, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    Spacer(Modifier.width(8.dp))
                    Icon(if (r.passed) Icons.Filled.CheckCircle else Icons.Filled.Cancel, null, Modifier.size(18.dp), tint = if (r.passed) Ok else Bad)
                    Text(" ${V3Math.fmt(r.after)}", style = Tnum.merge(MaterialTheme.typography.labelLarge), color = Ink2)
                }
            }
        }
    } else Text("No extra checks yet.", style = MaterialTheme.typography.bodySmall, color = Ink2)
    when {
        canClimb && d.ladderEligible -> Button(onClick = onOpenLadder, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(26.dp)) {
            Icon(Glyph.Ladder, null); Spacer(Modifier.width(8.dp)); Text("Verify further")
        }
        canClimb -> Text("The ladder is closed: an integrity check failed or there is no score.", style = MaterialTheme.typography.bodySmall, color = Ink2)
        isOwner && d.card.status == "submitted" -> Text("The ladder opens once the seal is ready.", style = MaterialTheme.typography.bodySmall, color = Ink2)
    }
    open?.let { r ->
        InfoSheet(r.title.ifBlank { r.module }, { open = null }, icon = moduleGlyph(r.module)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (r.passed) Icons.Filled.CheckCircle else Icons.Filled.Cancel, null, tint = if (r.passed) Ok else Bad)
                Spacer(Modifier.width(8.dp))
                Text(
                    "${if (r.passed) "passed" else "failed"} · ${V3Math.fmt(r.before)} → ${V3Math.fmt(r.after)}" +
                        (if (r.confidence > 0) " · confidence ${pct(r.confidence)}" else ""),
                    style = Tnum.merge(MaterialTheme.typography.titleMedium),
                )
            }
            r.measured.forEach { Bullet("measured ${it.metric}: ${fmtNum(it.value)} ${it.unit}") }
            ClaimOutcomes(r.claims, claimText(d))
            r.reasons.forEach { Bullet(it) }
        }
    }
}

/** v4.6 per-claim outcomes of a module: "50 claps ✓ 0.40 → 0.58 · counted 50 claps". */
@Composable
fun ClaimOutcomes(claims: List<com.mattricks.verified.data.ClaimVerdict>, claimText: (String) -> String, color: Color = Color.Unspecified) {
    claims.forEach { o ->
        val passed = o.passed ?: (o.verdict == "backed" && o.confidence >= com.mattricks.verified.data.V4Score.BACKED_CONFIDENCE)
        Row(verticalAlignment = Alignment.Top) {
            Icon(if (passed) Icons.Filled.CheckCircle else Icons.Filled.Cancel, null, Modifier.size(16.dp).padding(top = 2.dp), tint = if (passed) Ok else Bad)
            Spacer(Modifier.width(6.dp))
            Text(
                buildString {
                    append(claimText(o.id)).append("  ")
                    if (o.before != null && o.after != null) append("${V3Math.fmt(o.before)} → ${V3Math.fmt(o.after)}")
                    else append(o.verdict.replace('_', ' '))
                    o.measured?.let { (v, u) -> append(" · measured ${fmtNum(v)} $u") }
                    o.reasons.firstOrNull()?.let { append(" · ").append(it) }
                },
                style = MaterialTheme.typography.bodySmall, color = if (color != Color.Unspecified) color else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * The owner's ladder (v3.6): score ring + credits on top, then the modules as a horizontal carousel of cards (glyph,
 * cost, pass/fail preview bar, Run), disabled with a reason when `needs` are not met.
 * [runVideo] uploads the chained clip on this phone and runs full_video.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LadderSheet(
    d: MomentDetail,
    clipOnPhone: Boolean,
    runVideo: (suspend (requestId: String) -> Ladder.Run)?,
    onDone: () -> Unit,
    onDismiss: () -> Unit,
) {
    val uid = Firebase.auth.currentUser?.uid
    val live by remember(uid) { uid?.let { Ladder.credits(it) } ?: flowOf(null) }.collectAsState(initial = null)
    var granted by remember { mutableStateOf<Ladder.Credits?>(null) }
    var creditsError by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf<String?>(null) }
    var progress by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<Ladder.Run?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var buying by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    if (buying) BuyCreditsSheet { buying = false }
    LaunchedEffect(uid) {
        // First use grants the free demo credits (server-side, idempotent).
        runCatching { Ladder.getCredits() }.onSuccess { granted = it }.onFailure { creditsError = Ladder.errorMessage(it) }
    }
    val balance = live?.balance ?: granted?.balance
    val p = result?.score ?: currentScore(d)
    val bar = result?.bar ?: d.verification?.bar ?: d.bar?.value
    val ran = d.verification?.modules.orEmpty().map { it.module }.toSet() + listOfNotNull(result?.module)
    val evidence = ladderEvidence(d, clipOnPhone)
    val v4 = isV4(d)
    // v4: every claim's current score (after this sheet's last run, if any), for per-claim previews.
    val scores = result?.claimScores?.takeIf { it.isNotEmpty() } ?: d.v4?.claimScores.orEmpty()

    ModalBottomSheet(onDismissRequest = { if (running == null) onDismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 20.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                ScoreRing(p, bar, size = 72.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.card.intention, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text("score ${p?.let(V3Math::fmt) ?: "–"} · bar ${bar?.let(V3Math::fmt) ?: "–"}", style = Tnum.merge(MaterialTheme.typography.labelLarge), color = Ink2)
                }
                Surface(
                    onClick = { buying = true }, enabled = running == null,
                    color = MaterialTheme.colorScheme.tertiaryContainer, shape = RoundedCornerShape(50),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Glyph.Credits, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onTertiaryContainer)
                        Spacer(Modifier.width(4.dp))
                        Text(
                            when { balance != null -> "$balance"; creditsError != null -> "–"; else -> "…" },
                            fontWeight = FontWeight.Bold, style = Tnum, color = MaterialTheme.colorScheme.onTertiaryContainer,
                            modifier = Modifier.semantics { contentDescription = (balance?.let { "$it credits" } ?: "credits unavailable") + ". Buy credits" },
                        )
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Filled.Add, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onTertiaryContainer)
                    }
                }
            }
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (granted?.justGranted == true) GlyphPill(Glyph.Credits, "+${Ladder.freeCredits} free demo credits", FillOk)
                creditsError?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall) }
                result?.let { r -> ResultBanner(r, claimText(d)) }
                error?.let { Text(it, color = Bad) }
                running?.let { id ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(progress ?: "Running ${Ladder.modules.firstOrNull { it.id == id }?.title ?: id}", color = Ink2)
                        Spacer(Modifier.width(6.dp))
                        HybridBadge("cloud")
                    }
                }
            }
            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(Ladder.modules.filter { it.id !in ran }, key = { it.id }) { m ->
                    val backed = if (v4) backedBy(d, m) else emptyList()
                    val unmet = if (v4) LadderLogic.unmetV4(m, evidence, Ladder.needsText, backed) else LadderLogic.unmet(m, evidence, Ladder.needsText)
                    val poor = balance != null && balance < m.cost
                    val v4Preview = if (v4) LadderLogic.previewsV4(scores, backed, m.strength) else null
                    val backsLine = backed.takeIf { it.isNotEmpty() }?.joinToString(" · ") { claimText(d)(it) }
                    ModuleCard(
                        m, p, bar, unmet ?: if (poor) "Not enough credits" else null, enabled = running == null && unmet == null && !poor && p != null,
                        previews = v4Preview, backsLine = backsLine,
                    ) {
                        view.hapticConfirm()
                        error = null; result = null; running = m.id
                        scope.launch {
                            val requestId = java.util.UUID.randomUUID().toString()
                            runCatching {
                                when {
                                    // v4: the clip went up at submit; the module reviews it again, deeper.
                                    m.id == "full_video" && v4 && evidence.clipUploaded ->
                                        Ladder.run(d.card.id, m.id, clipSha = d.videos.lastOrNull()?.sha256, requestId = requestId)
                                    m.id == "full_video" && runVideo != null -> { progress = "Uploading the clip…"; runVideo(requestId) }
                                    else -> Ladder.run(d.card.id, m.id, requestId = requestId)
                                }
                            }.onSuccess { result = it; onDone() }.onFailure { error = Ladder.errorMessage(it) }
                            running = null; progress = null
                        }
                    }
                }
            }
            Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Fails lower the score. Credits are spent either way.", style = MaterialTheme.typography.bodySmall, color = Ink2, modifier = Modifier.weight(1f))
                TextButton(onClick = onDismiss, enabled = running == null) { Text("Close") }
            }
        }
    }
}

@Composable
private fun ResultBanner(r: Ladder.Run, claimText: (String) -> String) {
    Surface(color = if (r.passed) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(16.dp)) {
        val fg = if (r.passed) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onErrorContainer
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (r.passed) Icons.Filled.CheckCircle else Icons.Filled.Cancel, null, tint = fg)
                Spacer(Modifier.width(6.dp))
                Text("${if (r.passed) "Passed" else "Failed"}  ${V3Math.fmt(r.before)} → ${V3Math.fmt(r.after)}", fontWeight = FontWeight.Bold, color = fg, style = Tnum)
                Spacer(Modifier.weight(1f))
                if (r.verified) GlyphPill(Glyph.Result, "Verified", SealGold, fg = SealInk)
            }
            Text(
                if (r.verified) "score ${V3Math.fmt(r.score)} ≥ bar ${V3Math.fmt(r.bar)}" else "Still below the bar (${V3Math.fmt(r.score)} < ${V3Math.fmt(r.bar)})",
                color = fg, style = MaterialTheme.typography.bodySmall,
            )
            r.claimsBacked?.let { k -> Text("$k/${r.claimScores.size.takeIf { it > 0 } ?: k} claims backed", color = fg, fontWeight = FontWeight.SemiBold) }
            ClaimOutcomes(r.claims, claimText, color = fg)
            r.measured.forEach { Text("measured ${it.metric}: ${fmtNum(it.value)} ${it.unit}", color = fg, style = MaterialTheme.typography.bodySmall) }
            r.reasons.take(3).forEach { Text("• $it", color = fg, style = MaterialTheme.typography.bodySmall) }
            Text("${r.cost} credit${if (r.cost == 1) "" else "s"} spent · ${r.balance} left", style = MaterialTheme.typography.labelSmall, color = fg)
        }
    }
}

@Composable
private fun ModuleCard(
    m: LadderLogic.Module, p: Double?, bar: Double?, disabledReason: String?, enabled: Boolean,
    previews: Pair<Double, Double>? = null, backsLine: String? = null, onRun: () -> Unit,
) {
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.width(250.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
                    Icon(moduleGlyph(m.id), null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                }
                Spacer(Modifier.width(10.dp))
                Text(m.title, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                GlyphPill(Glyph.Credits, "${m.cost}", MaterialTheme.colorScheme.tertiaryContainer, fg = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.semantics { contentDescription = "${m.cost} credits" })
            }
            Text(m.blurb, style = MaterialTheme.typography.bodySmall, color = Ink2, maxLines = 3, overflow = TextOverflow.Ellipsis)
            backsLine?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Glyph.Result, null, Modifier.size(14.dp), tint = Lake); Spacer(Modifier.width(4.dp))
                    Text(it, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (p != null && m.available && (previews != null || backsLine == null)) {
                val (up, down) = previews ?: LadderLogic.previews(p, m.strength)
                PreviewBar(p, up, down, bar)
            }
            disabledReason?.let { Text(it, color = Ink2, style = MaterialTheme.typography.labelMedium, maxLines = 2) }
            Button(onClick = onRun, enabled = enabled, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Run") }
        }
    }
}

/** Me: the credit balance (server-written, owner-readable) as a compact pill; tap to buy more. */
@Composable
fun CreditsPill() {
    val uid = Firebase.auth.currentUser?.uid ?: return
    val c by remember(uid) { Ladder.credits(uid) }.collectAsState(initial = null)
    var buying by remember { mutableStateOf(false) }
    Surface(
        onClick = { buying = true }, color = MaterialTheme.colorScheme.tertiaryContainer, shape = RoundedCornerShape(50),
        modifier = Modifier.heightIn(min = 48.dp).padding(vertical = 4.dp)
            .semantics { contentDescription = (c?.let { "${it.balance} credits" } ?: "${Ladder.freeCredits} free credits waiting") + ". Buy credits" },
    ) {
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Glyph.Credits, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onTertiaryContainer)
            Spacer(Modifier.width(6.dp))
            Text(c?.balance?.toString() ?: "${Ladder.freeCredits}", fontWeight = FontWeight.Bold, style = Tnum, color = MaterialTheme.colorScheme.onTertiaryContainer)
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Filled.Add, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onTertiaryContainer)
        }
    }
    if (buying) BuyCreditsSheet { buying = false }
}

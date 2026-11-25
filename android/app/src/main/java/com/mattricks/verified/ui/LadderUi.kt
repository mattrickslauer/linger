package com.mattricks.verified.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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

/** Public: every ladder result on the post (v3.5/v3.8). Owner: the way into the ladder sheet. */
@Composable
fun LadderSection(d: MomentDetail, isOwner: Boolean, onOpenLadder: () -> Unit) {
    val results = d.verification?.modules.orEmpty()
    val canClimb = isOwner && d.card.status in setOf("sealed", "rejected") && d.sealVersion >= 3
    if (results.isEmpty() && !isOwner) return
    Text("Verification ladder", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            d.verification?.let { v ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "baseline ${v.baseline?.let(V3Math::fmt) ?: "–"} → score ${v.score?.let(V3Math::fmt) ?: "–"} · bar ${V3Math.fmt(v.bar)}",
                        fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                    )
                    if (v.verified) Pill("Verified ✓", Green) else Pill("below bar", Amber)
                }
            }
            if (results.isEmpty()) Text("No extra checks yet.", color = Color.Gray)
            results.forEach { ResultRow(it) }
            when {
                canClimb && d.ladderEligible -> Button(onClick = onOpenLadder, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp)) {
                    Text("Verify further")
                }
                canClimb -> Text("The ladder is closed: an integrity check failed or there is no score.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                isOwner && d.card.status == "submitted" -> Text("The ladder opens once the seal is ready.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
            Text("Paying never buys a score: it buys more scrutiny. Modules that fail lower the score.", fontSize = 11.sp, color = Color.Gray)
        }
    }
}

@Composable
private fun ResultRow(r: LadderResult) {
    Row(verticalAlignment = Alignment.Top) {
        Text(if (r.passed) "✓" else "✗", color = if (r.passed) Green else Red, fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp))
        Column(Modifier.weight(1f)) {
            Text(r.title.ifBlank { r.module }, fontWeight = FontWeight.SemiBold)
            Text(
                "${if (r.passed) "passed" else "failed"} · ${V3Math.fmt(r.before)} → ${V3Math.fmt(r.after)}" +
                    (if (r.confidence > 0) " · confidence ${(r.confidence * 100).toInt()}%" else ""),
                fontSize = 12.sp, color = Color.Gray,
            )
            r.measured.forEach { Text("measured ${it.metric}: ${fmtNum(it.value)} ${it.unit}", style = MaterialTheme.typography.bodySmall) }
            r.reasons.take(2).forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
        }
    }
}

/**
 * The owner's ladder (v3.6): modules with cost and both previews, disabled with a reason when `needs` are not met.
 * [clipFor] resolves the chained clip on this phone (full_video); [runVideo] uploads it and runs the module.
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
    val scope = rememberCoroutineScope()
    LaunchedEffect(uid) {
        // First use grants the free demo credits (server-side, idempotent).
        runCatching { Ladder.getCredits() }.onSuccess { granted = it }.onFailure { creditsError = Ladder.errorMessage(it) }
    }
    val balance = live?.balance ?: granted?.balance
    val p = result?.score ?: currentScore(d)
    val bar = result?.bar ?: d.verification?.bar ?: d.bar?.value
    val ran = d.verification?.modules.orEmpty().map { it.module }.toSet() + listOfNotNull(result?.module)
    val evidence = LadderLogic.Evidence(
        frames = d.frames.count { it.jpegB64.isNotEmpty() }, gps = d.track.size,
        witnessAnswered = d.witness.count { it.outcome != null && it.outcome != "skipped" },
        quantities = d.intention?.quantities?.size ?: 0, video = d.videos.isNotEmpty(), clipOnPhone = clipOnPhone,
    )

    ModalBottomSheet(onDismissRequest = { if (running == null) onDismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(d.card.intention, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 2)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "score ${p?.let(V3Math::fmt) ?: "–"} · bar ${bar?.let(V3Math::fmt) ?: "–"}",
                    fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f),
                )
                Icon(Icons.Filled.Toll, null, tint = Amber, modifier = Modifier.size(18.dp))
                Text(
                    " " + when {
                        balance != null -> "$balance credits"
                        creditsError != null -> "credits unavailable"
                        else -> "…"
                    },
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (p != null && bar != null) BarMeter(p, bar, Modifier.fillMaxWidth())
            if (granted?.justGranted == true) Text("${Ladder.freeCredits} free demo credits added to your account.", color = Green, style = MaterialTheme.typography.bodySmall)
            creditsError?.let { Text(it, color = Red, style = MaterialTheme.typography.bodySmall) }

            result?.let { r -> ResultBanner(r) }
            error?.let { Text(it, color = Red) }
            running?.let { id ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text("  " + (progress ?: "Running ${Ladder.modules.firstOrNull { it.id == id }?.title ?: id} in the cloud…"), color = Color.Gray)
                }
            }

            Ladder.modules.filter { it.id !in ran }.forEach { m ->
                val unmet = LadderLogic.unmet(m, evidence, Ladder.needsText)
                val poor = balance != null && balance < m.cost
                ModuleRow(m, p, unmet ?: if (poor) "Not enough credits" else null, enabled = running == null && unmet == null && !poor && p != null) {
                    error = null; result = null; running = m.id
                    scope.launch {
                        val requestId = java.util.UUID.randomUUID().toString()
                        runCatching {
                            if (m.id == "full_video" && runVideo != null) { progress = "Uploading the clip…"; runVideo(requestId) }
                            else Ladder.run(d.card.id, m.id, requestId = requestId)
                        }.onSuccess { result = it; onDone() }.onFailure { error = Ladder.errorMessage(it) }
                        running = null; progress = null
                    }
                }
            }
            Text("Modules that fail lower the score. Credits are spent either way.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            Text("Free demo credits only during the hackathon — no purchases.", fontSize = 11.sp, color = Color.Gray)
            OutlinedButton(onClick = onDismiss, enabled = running == null, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Close") }
        }
    }
}

@Composable
private fun ResultBanner(r: Ladder.Run) {
    Card(colors = CardDefaults.cardColors(containerColor = if (r.passed) Color(0xFFD4F0E1) else Color(0xFFFCE4E2))) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                (if (r.passed) "Passed ✓  " else "Failed ✗  ") + "${V3Math.fmt(r.before)} → ${V3Math.fmt(r.after)}",
                fontWeight = FontWeight.Bold, color = if (r.passed) GreenDark else Red,
            )
            Text(if (r.verified) "Now Verified ✓ (score ${V3Math.fmt(r.score)} ≥ bar ${V3Math.fmt(r.bar)})" else "Still below the bar (${V3Math.fmt(r.score)} < ${V3Math.fmt(r.bar)})", color = Color.DarkGray)
            r.measured.forEach { Text("measured ${it.metric}: ${fmtNum(it.value)} ${it.unit}", color = Color.DarkGray, style = MaterialTheme.typography.bodySmall) }
            r.reasons.take(3).forEach { Text("• $it", color = Color.DarkGray, style = MaterialTheme.typography.bodySmall) }
            Text("${r.cost} credit${if (r.cost == 1) "" else "s"} spent · ${r.balance} left", fontSize = 11.sp, color = Color.Gray)
        }
    }
}

@Composable
private fun ModuleRow(m: LadderLogic.Module, p: Double?, disabledReason: String?, enabled: Boolean, onRun: () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(m.title, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Pill("${m.cost} credit${if (m.cost == 1) "" else "s"}", Amber)
            }
            Text(m.blurb, style = MaterialTheme.typography.bodySmall)
            if (p != null && m.available) {
                val (up, down) = LadderLogic.previews(p, m.strength)
                Text("if it passes → ${V3Math.fmt(up)} · if it fails → ${V3Math.fmt(down)}", fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = GreenDark)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                disabledReason?.let { Text(it, color = Color.Gray, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)) }
                    ?: Spacer(Modifier.weight(1f))
                Button(onClick = onRun, enabled = enabled, shape = RoundedCornerShape(20.dp)) { Text("Run") }
            }
        }
    }
}

/** Me: the credit balance (server-written, owner-readable). */
@Composable
fun CreditsRow() {
    val uid = Firebase.auth.currentUser?.uid ?: return
    val c by remember(uid) { Ladder.credits(uid) }.collectAsState(initial = null)
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Toll, null, tint = Amber)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(c?.let { "${it.balance} credits" } ?: "${Ladder.freeCredits} free credits waiting", fontWeight = FontWeight.Bold)
                Text(
                    c?.let { "${it.granted} granted · ${it.spent} spent on verification" } ?: "Granted the first time you open the verification ladder.",
                    style = MaterialTheme.typography.bodySmall, color = Color.Gray,
                )
            }
        }
    }
}

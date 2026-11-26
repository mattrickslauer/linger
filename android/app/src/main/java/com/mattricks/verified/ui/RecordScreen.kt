package com.mattricks.verified.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.delay
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Base64
import android.util.Log
import android.view.OrientationEventListener
import android.view.Surface
import androidx.compose.ui.graphics.toArgb
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.pm.PackageManager
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.MediaStore
import android.widget.Toast
import androidx.camera.core.UseCase
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.zIndex
import com.mattricks.verified.data.Prefs
import com.mattricks.verified.devices.Devices
import com.mattricks.verified.record.VideoClip
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.FlashAuto
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.firebase.auth.FirebaseUser
import com.mattricks.verified.data.CATEGORIES
import com.mattricks.verified.judge.Judging
import com.mattricks.verified.record.RecUi
import com.mattricks.verified.record.RecordViewModel
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

@Composable
fun RecordScreen(user: FirebaseUser?, onOpen: (String) -> Unit) {
    // Guests record too (v3.1): the Moment stays in this phone's journal until they sign in and claim it.
    val vm: RecordViewModel = viewModel()
    val ui by vm.ui.collectAsState()
    when (ui.phase) {
        RecUi.Phase.Idle -> SetupView(ui, vm)
        RecUi.Phase.Recording -> LiveView(ui, vm)
        RecUi.Phase.Finished -> FinishedView(ui, vm, user, onOpen)
    }
}

/** Witness answers, as plain callbacks (so the HUD can be drawn without a view model). */
internal class WitnessActions(
    val onShow: () -> Unit, val onVoice: () -> Unit, val onText: (String) -> Unit, val onDone: () -> Unit, val onSkip: () -> Unit,
)

@Composable
private fun LiveView(ui: RecUi, vm: RecordViewModel) {
    val view = LocalView.current
    DisposableEffect(Unit) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val cam = remember { CaptureController() }
    val defaultMode by Prefs.captureMode.collectAsState()
    // v4.11: the record screen opens in the plan's recordMode ("Video" / "Photo"); no plan → the Settings default.
    var mode by remember {
        mutableStateOf(
            when (ui.plan?.recordMode) {
                "video" -> Prefs.CaptureMode.Video
                "photo" -> Prefs.CaptureMode.Photo
                else -> defaultMode
            },
        )
    }
    var shooting by remember { mutableStateOf(false) }
    var mapBig by remember { mutableStateOf(false) }
    // Set when a clip lands: the moment people most often don't realise they still need to end the session.
    var clipSaved by remember { mutableStateOf(false) }
    val recording = cam.recordingSince != null
    DisposableEffect(Unit) { onDispose { cam.stopVideo() } }

    LiveHud(
        ui, mode, recordingSince = cam.recordingSince, shooting = shooting, mapBig = mapBig,
        onMode = { mode = it }, onSwap = { mapBig = !mapBig },
        witness = WitnessActions(
            onShow = { mode = Prefs.CaptureMode.Photo; mapBig = false; vm.armWitnessShot() },
            onVoice = vm::answerWitnessByVoice, onText = { vm.answerWitnessText(it) }, onDone = vm::witnessDone, onSkip = vm::skipWitness,
        ),
        onShutter = {
            when {
                mode == Prefs.CaptureMode.Photo -> {
                    shooting = true
                    takeProof(ctx, cam.image) { bmp, b64 ->
                        shooting = false
                        if (bmp != null && b64 != null) { view.hapticConfirm(); vm.proofShot(bmp, b64) }
                    }
                }
                !recording -> if (cam.startVideo(ctx, ui.momentId ?: "moment")) { clipSaved = false; view.hapticConfirm(); vm.videoStarted() }
                else -> {
                    shooting = true
                    view.hapticStop()
                    cam.stopVideo { uri, startedAt, endedAt ->
                        scope.launch {
                            val r = if (uri != null) withContext(Dispatchers.IO) { finishClip(ctx, uri, startedAt, endedAt) } else null
                            shooting = false
                            if (r != null) { vm.videoClip(r.clip, r.poster, r.posterB64); clipSaved = true }
                            else Toast.makeText(ctx, "Video clip failed to save", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        },
        onFinish = { view.hapticStop(); vm.finish() },
        clipSaved = clipSaved,
        cameraButtons = { CameraButtons(cam, mode, flipEnabled = !recording && !ui.checking && !shooting) },
        media = { mini, full ->
            // Both always composed in the same order, so swapping never rebinds the camera or reloads the map.
            CameraPreview(cam, mode, if (mapBig) mini else full)
            TrackMap(ui.track, if (mapBig) full else mini, live = true, compact = !mapBig)
        },
    )
}

/**
 * The live recording screen: camera (or map) full-bleed, a HUD over it (timer, GPS / motion / chain / shots
 * indicators, the evidence checklist as pips, coach toasts, the witness card) and big thumb-zone controls.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LiveHud(
    ui: RecUi, mode: Prefs.CaptureMode, recordingSince: Long?, shooting: Boolean, mapBig: Boolean,
    onMode: (Prefs.CaptureMode) -> Unit, onSwap: () -> Unit, witness: WitnessActions,
    onShutter: () -> Unit, onFinish: () -> Unit,
    cameraButtons: @Composable () -> Unit,
    media: @Composable BoxScope.(mini: Modifier, full: Modifier) -> Unit,
    clipSaved: Boolean = false,
) = MediaTheme {
    val recording = recordingSince != null
    val planComplete = ui.plan?.requirements?.let { rs -> rs.isNotEmpty() && rs.all { ui.captured[it.id] == true } } == true
    // Nudge toward ending the session once there's something worth verifying and nothing in flight.
    val readyToFinish = !recording && !shooting && !ui.checking && ui.witness == null && ui.elapsedMs >= 20_000 && (clipSaved || planComplete)
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        // Landscape / split screen: one row of controls (mode toggle beside the shutter), the mini window beside the
        // HUD instead of under it, the witness card on the start side.
        val short = maxHeight < 480.dp
        // Everything under the HUD is placed from its measured height (below the status bar inset, which is applied
        // live on its own), so it never overlaps at large font scales or when the insets change.
        var hudPx by remember { mutableIntStateOf(0) }
        val hudH = with(LocalDensity.current) { hudPx.toDp() }
        var thumbPx by remember { mutableIntStateOf(0) }
        val thumbH = with(LocalDensity.current) { thumbPx.toDp() }
        val miniPos = Modifier.align(Alignment.TopEnd).then(if (short) Modifier.safeTopAndSides().padding(top = 64.dp, end = 12.dp) else Modifier.safeTopAndSides().padding(top = hudH + 8.dp, end = 12.dp))
            .size(width = 104.dp, height = 136.dp)
        val mini = miniPos.zIndex(2f).clip(RoundedCornerShape(16.dp)).border(2.dp, TokInk, RoundedCornerShape(16.dp))
        val full = Modifier.fillMaxSize().zIndex(1f)
        media(mini, full)
        // Tap the small window to swap camera ↔ map (also keeps the mini map from eating pan gestures).
        Box(miniPos.zIndex(3f).clip(RoundedCornerShape(16.dp)).clickable(onClickLabel = if (mapBig) "Show the camera" else "Show the map", onClick = onSwap))

        // Scrims so the HUD reads on any picture.
        Box(Modifier.fillMaxWidth().height(200.dp).zIndex(4f).background(Brush.verticalGradient(listOf(MediaBg.copy(alpha = 0.75f), Color.Transparent))))
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(260.dp).zIndex(4f).background(Brush.verticalGradient(listOf(Color.Transparent, MediaBg.copy(alpha = 0.85f)))))

        // ── top HUD
        Column(Modifier.zIndex(5f).fillMaxWidth().safeTopAndSides().onSizeChanged { hudPx = it.height }.padding(horizontal = 14.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RecDot()
                Spacer(Modifier.width(8.dp))
                Text(
                    fmtDuration(ui.elapsedMs), color = TokInk, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, style = Tnum,
                    modifier = Modifier.semantics { contentDescription = "Recording, ${fmtDuration(ui.elapsedMs)}" },
                )
                Spacer(Modifier.width(10.dp))
                Text(fmtDistance(ui.distanceM), color = TokInk2, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, style = Tnum)
                Spacer(Modifier.weight(1f))
                SyncChip(ui)
            }
            Text(ui.intention, color = TokInk2, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val gpsOk = ui.accuracyM != null && ui.accuracyM < 25
                ScrimChip(Modifier.semantics(mergeDescendants = true) { contentDescription = ui.accuracyM?.let { "GPS plus or minus ${it.roundToInt()} metres" } ?: "Waiting for GPS" }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(if (gpsOk) TokOk else if (ui.accuracyM != null) SealGold else TokInk2))
                        Spacer(Modifier.width(5.dp))
                        StatOverlay(Glyph.Place, ui.accuracyM?.let { "±${it.roundToInt()} m" } ?: "…")
                    }
                }
                ScrimChip(Modifier.semantics(mergeDescendants = true) { contentDescription = "Motion" }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Glyph.Motion, null, Modifier.size(15.dp), tint = TokInk2)
                        Spacer(Modifier.width(5.dp))
                        Sparkline(ui.sparkline, Modifier.size(width = 44.dp, height = 16.dp))
                    }
                }
                ScrimChip { StatOverlay(Glyph.Frames, "${ui.frameCount}") }
                if (ui.videoCount > 0) ScrimChip { StatOverlay(Glyph.Video, "${ui.videoCount}") }
                if (ui.witnessAsked > 0) ScrimChip { StatOverlay(Glyph.Witness, "${ui.witnessAnswered}/${ui.witnessAsked}") }
                ui.heartRate?.let { ScrimChip(Modifier.semantics(mergeDescendants = true) { contentDescription = "Heart rate $it" }) { StatOverlay(Icons.Filled.Favorite, "$it", tint = TokInk, sub = TokBad) } }
            }
            ui.plan?.takeIf { it.requirements.isNotEmpty() }?.let { EvidencePips(it, ui.captured) }
        }

        // ── coach toast + video REC pill, under the HUD
        Column(
            Modifier.zIndex(6f).align(Alignment.TopStart).safeTopAndSides().padding(start = 14.dp, end = 128.dp, top = hudH + 8.dp),
            horizontalAlignment = Alignment.Start, verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            recordingSince?.let { since ->
                GlyphPill(Icons.Filled.FiberManualRecord, "REC ${fmtDuration(max(0L, ui.elapsedMs - (since - ui.startedAt)))}", FillBad)
            }
            CoachToast(ui)
        }

        // ── witness card, floating above the controls
        ui.witness?.let { w ->
            WitnessCard(
                w, ui, witness,
                // Right above the measured controls (or the keyboard, for a typed answer); never over the timer row: on
                // a short screen the card scrolls inside instead.
                Modifier.zIndex(7f).align(if (short) Alignment.BottomStart else Alignment.BottomCenter).safeTopAndSides().imePadding()
                    .padding(start = 12.dp, end = if (short) 136.dp else 12.dp, top = 64.dp, bottom = if (WindowInsets.isImeVisible) 8.dp else thumbH + 8.dp)
                    .then(if (short) Modifier.widthIn(max = 520.dp) else Modifier),
                compact = short,
            )
        }

        // ── camera buttons on the right edge, thumb height
        // (short: beside the mini window, which takes the edge)
        if (!mapBig) Box(
            Modifier.zIndex(5f).then(
                if (short) Modifier.align(Alignment.TopEnd).safeTopAndSides().padding(top = 64.dp, end = 128.dp)
                else Modifier.align(Alignment.CenterEnd).safeSides().padding(end = 12.dp),
            ),
        ) { cameraButtons() }

        // ── thumb zone
        Column(
            Modifier.zIndex(5f).align(Alignment.BottomCenter).fillMaxWidth().safeSides().onSizeChanged { thumbPx = it.height }.padding(bottom = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (readyToFinish) FinishNudge(if (clipSaved) "Video saved." else "Everything on the plan is captured.", onFinish)
            val modeToggle = @Composable { ModeToggle(mode, enabled = !recording && !ui.checking && !shooting, onChange = onMode) }
            if (!short) modeToggle()
            Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    FinishButton(ui.elapsedMs, enabled = !ui.checking && !recording && !shooting, ready = readyToFinish, onFinish)
                }
                Shutter(mode = mode, recording = recording, busy = shooting || ui.checking, onClick = onShutter)
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    if (short) modeToggle()
                    HudButton(if (mapBig) Glyph.Proof else Glyph.Place, if (mapBig) "Show the camera" else "Show the map", onClick = onSwap)
                }
            }
        }
    }
}

@Composable
private fun RecDot() {
    val reduce = rememberReduceMotion()
    val pulse = if (reduce) 1f else {
        val t = rememberInfiniteTransition(label = "rec")
        t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "rec").value
    }
    Box(Modifier.size(14.dp).graphicsLayer { alpha = pulse }.clip(CircleShape).background(FillBad))
}

/**
 * End & verify: a 60dp round button whose ring fills over the first 20 s (shorter Moments can't be sealed),
 * then turns gold so it never reads as another capture button; it pulses while [ready].
 */
@Composable
private fun FinishButton(elapsedMs: Long, enabled: Boolean, ready: Boolean, onClick: () -> Unit) {
    val progress = (elapsedMs / 20_000f).coerceIn(0f, 1f)
    val armed = progress >= 1f
    val reduce = rememberReduceMotion()
    val halo = if (!ready || reduce) 0f else {
        val t = rememberInfiniteTransition(label = "finish")
        t.animateFloat(0f, 1f, infiniteRepeatable(tween(1600)), label = "finish").value
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            if (ready) Box(
                Modifier.size(60.dp).graphicsLayer { val sc = 1f + 0.5f * halo; scaleX = sc; scaleY = sc; alpha = if (reduce) 0.4f else 0.8f * (1f - halo) }
                    .clip(CircleShape).background(SealGold),
            )
            Box(
                Modifier.size(60.dp).clip(CircleShape).background(if (armed) SealGold else TokInk.copy(alpha = 0.14f))
                    .clickable(enabled = enabled, role = Role.Button, onClickLabel = "End session and verify", onClick = onClick),
                contentAlignment = Alignment.Center,
            ) {
                if (!armed) CircularProgressIndicator(progress = { progress }, Modifier.size(60.dp), color = SealGold, trackColor = Color.Transparent, strokeWidth = 3.dp)
                Icon(
                    if (armed) Icons.Filled.Check else Icons.Filled.Stop, null,
                    tint = (if (armed) MediaBg else TokInk).copy(alpha = if (enabled) 1f else 0.4f), modifier = Modifier.size(30.dp),
                )
            }
        }
        Text(if (armed) "End & verify" else "20 s min", color = if (armed) SealGold else TokInk, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

/** Shown once a clip lands (or the plan is fully captured): people otherwise don't realise they still need to end the session. */
@Composable
private fun FinishNudge(lead: String, onFinish: () -> Unit) {
    Row(
        Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(SealGold)
            .padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Check, null, tint = MediaBg, modifier = Modifier.size(20.dp))
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                append("$lead ")
                pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Bold)); append("All done?"); pop()
                append(" End the session to verify it.")
            },
            color = MediaBg, fontSize = 14.sp, modifier = Modifier.weight(1f),
        )
        Button(
            onClick = onFinish,
            colors = ButtonDefaults.buttonColors(containerColor = MediaBg, contentColor = TokInk),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 6.dp),
        ) { Text("End & verify", fontSize = 13.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun HudButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(60.dp).clip(CircleShape).background(TokInk.copy(alpha = 0.14f)).clickable(role = Role.Button, onClickLabel = label, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, label, tint = TokInk, modifier = Modifier.size(26.dp)) }
        Text(if (icon == Glyph.Place) "Map" else "Camera", color = TokInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * v4.2/v4.11 live checklist as pips: one glyph pip per requirement, filled once this phone has captured it ("captured"
 * only: the server decides "met"). Tap for the list with the asks.
 */
@Composable
private fun EvidencePips(plan: com.mattricks.verified.data.Plan, captured: Map<String, Boolean>) {
    var open by remember { mutableStateOf(false) }
    val done = plan.requirements.count { captured[it.id] == true }
    val next = plan.requirements.firstOrNull { captured[it.id] != true }
    Surface(
        onClick = { open = !open }, color = MediaBg.copy(alpha = 0.62f), shape = RoundedCornerShape(18.dp), contentColor = TokInk,
        modifier = Modifier.semantics { contentDescription = "Evidence: $done of ${plan.requirements.size} captured" + (next?.let { ". Next: ${it.ask}" } ?: "") },
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                plan.requirements.forEach { r ->
                    val ok = captured[r.id] == true
                    Box(
                        Modifier.padding(end = 5.dp).size(24.dp).clip(CircleShape)
                            .then(if (ok) Modifier.background(TokOk) else Modifier.border(1.5.dp, TokInk2, CircleShape)),
                        contentAlignment = Alignment.Center,
                    ) { Icon(evidenceIcon(r.evidence), null, Modifier.size(13.dp), tint = if (ok) MediaBg else TokInk2) }
                }
                Spacer(Modifier.width(4.dp))
                Text("$done/${plan.requirements.size}", fontWeight = FontWeight.Bold, style = Tnum, color = if (next == null) TokOk else TokInk)
                if (!open && next != null) {
                    Spacer(Modifier.width(8.dp))
                    Text(next.ask, fontSize = 13.sp, color = TokInk2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                }
                Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = TokInk2)
            }
            if (open) plan.requirements.forEach { r ->
                val ok = captured[r.id] == true
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (ok) Icons.Filled.CheckCircle else evidenceIcon(r.evidence), null, Modifier.size(16.dp), tint = if (ok) TokOk else TokInk2)
                    Spacer(Modifier.width(8.dp))
                    Text(r.ask + (r.minSeconds?.let { " (≥ ${fmtNum(it)} s)" } ?: ""), fontSize = 13.sp, maxLines = 2, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/** The witness's open request (v3.4): spoken + this floating card. Show → next proof shot answers it; Answer → voice/typed; Done; Skip. */
@Composable
private fun WitnessCard(w: com.mattricks.verified.record.WitnessAsk, ui: RecUi, act: WitnessActions, modifier: Modifier, compact: Boolean = false) {
    var typing by remember(w.wid) { mutableStateOf(false) }
    var text by remember(w.wid) { mutableStateOf("") }
    var why by remember(w.wid) { mutableStateOf(false) }
    Surface(modifier.fillMaxWidth(), color = Color(0xF20F2127), shape = RoundedCornerShape(22.dp), shadowElevation = 8.dp, contentColor = TokInk) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(32.dp).clip(CircleShape).background(SealGold), contentAlignment = Alignment.Center) {
                    Icon(Glyph.Witness, null, Modifier.size(18.dp), tint = SealInk)
                }
                Spacer(Modifier.width(10.dp))
                Text("Witness", color = SealGold, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                HybridBadge(w.by, onMedia = true)
                if (w.why.isNotBlank()) IconButton(onClick = { why = !why }) { Icon(Icons.Filled.Info, "Why", tint = TokInk2) }
            }
            Text(w.ask, fontSize = 19.sp, lineHeight = 24.sp, fontWeight = FontWeight.Bold)
            if (why) Text(w.why, color = TokInk2, fontSize = 13.sp)
            // compact (landscape): the ask and the buttons only; the requirement line is in the pips above.
            if (!compact) ui.plan?.requirements?.firstOrNull { it.id == w.rid }?.let { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(evidenceIcon(r.evidence), null, Modifier.size(14.dp), tint = TokInk2); Spacer(Modifier.width(5.dp))
                    Text(r.ask, color = TokInk2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (ui.witnessArmed) GlyphPill(Glyph.Proof, "Take the proof shot now", SealGold, fg = SealInk)
            if (typing) Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = text, onValueChange = { text = it.take(200) }, singleLine = true, modifier = Modifier.weight(1f),
                    placeholder = { Text("Type your answer") }, shape = RoundedCornerShape(24.dp),
                )
                IconButton(enabled = text.isNotBlank(), onClick = { act.onText(text) }) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                val btn = ButtonDefaults.buttonColors(containerColor = SealGold, contentColor = SealInk)
                val big = Modifier.heightIn(min = 52.dp)
                when (w.kind) {
                    "show" -> if (!ui.witnessArmed) Button(onClick = act.onShow, colors = btn, modifier = big) {
                        Icon(Icons.Filled.CameraAlt, null); Spacer(Modifier.width(6.dp)); Text("Show", fontWeight = FontWeight.Bold)
                    }
                    "tell" -> {
                        Button(onClick = act.onVoice, enabled = !ui.witnessListening, colors = btn, modifier = big) {
                            Icon(Icons.Filled.Mic, null); Spacer(Modifier.width(6.dp)); Text(if (ui.witnessListening) "Listening…" else "Answer", fontWeight = FontWeight.Bold)
                        }
                        if (!typing) IconButton(onClick = { typing = true }) { Icon(Icons.Filled.Keyboard, "Type the answer", tint = TokInk) }
                    }
                    else -> Button(onClick = act.onDone, colors = btn, modifier = big) { Icon(Icons.Filled.Check, null); Spacer(Modifier.width(6.dp)); Text("Done", fontWeight = FontWeight.Bold) }
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = act.onSkip, modifier = big) { Text("Skip", color = TokInk2) }
            }
        }
    }
}

@Composable
private fun ModeToggle(mode: Prefs.CaptureMode, enabled: Boolean, onChange: (Prefs.CaptureMode) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(MediaBg.copy(alpha = 0.6f)).padding(horizontal = 4.dp)) {
        Prefs.CaptureMode.entries.forEach { m ->
            val sel = m == mode
            Box(
                Modifier.heightIn(min = 48.dp).clickable(enabled = enabled && !sel, role = Role.Tab) { onChange(m) }.semantics { selected = sel },
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    Modifier.clip(RoundedCornerShape(50)).background(if (sel) TokInk else Color.Transparent).padding(horizontal = 14.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val c = if (sel) MediaBg else TokInk.copy(alpha = if (enabled) 1f else 0.5f)
                    Icon(if (m == Prefs.CaptureMode.Photo) Glyph.Proof else Glyph.Video, null, Modifier.size(16.dp), tint = c)
                    Spacer(Modifier.width(6.dp))
                    Text(if (m == Prefs.CaptureMode.Photo) "Photo" else "Video", color = c, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }
        }
    }
}

/** Flash (only when the lens has one) and front/back flip, as round buttons over the camera. */
@Composable
private fun CameraButtons(cam: CaptureController, mode: Prefs.CaptureMode, flipEnabled: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (cam.hasFlash) {
            val (icon, label) = when {
                cam.flash == Flash.On -> Icons.Filled.FlashOn to "Flash on"
                cam.flash == Flash.Auto && mode == Prefs.CaptureMode.Photo -> Icons.Filled.FlashAuto to "Flash auto"
                else -> Icons.Filled.FlashOff to "Flash off"
            }
            RoundIconButton(icon, label, enabled = true, onClick = cam::cycleFlash)
        }
        if (cam.canFlip) {
            RoundIconButton(Icons.Filled.Cameraswitch, if (cam.front) "Switch to back camera" else "Switch to front camera", enabled = flipEnabled) {
                cam.front = !cam.front
            }
        }
    }
}

@Composable
private fun RoundIconButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(CircleShape).background(MediaBg.copy(alpha = 0.6f))
            .clickable(enabled = enabled, onClick = onClick, role = Role.Button, onClickLabel = label),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = TokInk.copy(alpha = if (enabled) 1f else 0.5f)) }
}

/** Big round shutter: camera disc for photo, red disc for video, red rounded square while recording. */
@Composable
private fun Shutter(mode: Prefs.CaptureMode, recording: Boolean, busy: Boolean, onClick: () -> Unit) {
    val label = when { recording -> "Stop video"; mode == Prefs.CaptureMode.Video -> "Start video"; else -> "Take a proof shot" }
    Box(
        Modifier.size(84.dp).clip(CircleShape).border(4.dp, TokInk, CircleShape)
            .clickable(enabled = !busy, onClick = onClick, role = Role.Button, onClickLabel = label)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        when {
            busy -> CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 3.dp, color = TokInk)
            recording -> Box(Modifier.size(30.dp).clip(RoundedCornerShape(7.dp)).background(FillBad))
            mode == Prefs.CaptureMode.Video -> Box(Modifier.size(64.dp).clip(CircleShape).background(FillBad))
            else -> Box(Modifier.size(64.dp).clip(CircleShape).background(TokInk), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.CameraAlt, null, tint = MediaBg, modifier = Modifier.size(28.dp))
            }
        }
    }
}

/** Chain status pill: link glyph + chunk count; colour = guest / offline / synced. */
@Composable
private fun SyncChip(ui: RecUi) {
    val (icon, text, bg) = when {
        ui.guest -> Triple(Glyph.OnDevice, "${ui.chunksTotal}", FillInk)
        ui.chunksPending > 0 -> Triple(Icons.Filled.CloudOff, "${ui.chunksPending} queued", Color(0xFF8A6100))
        ui.chunksTotal > 0 -> Triple(Glyph.Chain, "${ui.chunksTotal}", FillOk)
        else -> Triple(Glyph.Chain, "5 s", FillInk)
    }
    val desc = when {
        ui.guest -> "On this phone, ${ui.chunksTotal} chunks"
        ui.chunksPending > 0 -> "Offline, ${ui.chunksPending} chunks queued"
        ui.chunksTotal > 0 -> "Synced, ${ui.chunksTotal} chunks"
        else -> "First chunk in 5 seconds"
    }
    GlyphPill(icon, text, bg, Modifier.semantics { contentDescription = desc })
}

/** Coach result as a transient toast: green "keep going" / amber "retake"; checking shows a spinner chip. */
@Composable
private fun CoachToast(ui: RecUi) {
    val c = ui.coach
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(c) { if (c != null) { visible = true; delay(4_000); visible = false } }
    when {
        ui.checking -> ScrimChip {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), color = TokInk, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp)); Text("Checking", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }
        c == null -> ScrimChip { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Glyph.Proof, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Take a proof shot", fontSize = 14.sp) } }
        else -> AnimatedVisibility(visible, enter = fadeIn() + slideInVertically(), exit = fadeOut()) {
            val (bg, icon, text) = when {
                c.mode == "none" -> Triple(FillInk, Glyph.Frames, "Saved · ${c.reason}")
                !c.ok -> Triple(Color(0xFFB26A00), Icons.Filled.Refresh, "Retake: ${c.reason}")
                else -> Triple(FillOk, Icons.Filled.CheckCircle, "Keep going")
            }
            Surface(color = bg, shape = RoundedCornerShape(50), contentColor = Color.White) {
                Row(Modifier.padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                    Text(text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(6.dp))
                    if (c.mode != "none") HybridBadge(c.mode, onMedia = true)
                }
            }
        }
    }
}

/** Flash: photo cycles Off → Auto → On (ImageCapture flash); video uses the torch (Auto acts as Off). */
private enum class Flash { Off, Auto, On }

/** CameraX use cases for the live view: Preview + (ImageCapture | VideoCapture), rebound when the mode or lens changes. */
private class CaptureController {
    val image: ImageCapture = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
    var front by mutableStateOf(false)
    var flash by mutableStateOf(Flash.Off)
    /** Whether the bound lens has a flash unit (front cameras usually don't). */
    var hasFlash by mutableStateOf(false)
        private set
    /** Whether the device has both a front and a back camera. */
    var canFlip by mutableStateOf(false)
        private set
    private var camera: androidx.camera.core.Camera? = null
    private var mode = Prefs.CaptureMode.Photo

    fun bind(provider: ProcessCameraProvider, lifecycle: androidx.lifecycle.LifecycleOwner, preview: Preview, mode: Prefs.CaptureMode) {
        canFlip = provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) && provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)
        if (!canFlip) front = provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) && !provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)
        val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        val capture: UseCase = if (mode == Prefs.CaptureMode.Video) video else image
        provider.unbindAll()
        this.mode = mode
        camera = provider.bindToLifecycle(lifecycle, selector, preview, capture)
        hasFlash = camera?.cameraInfo?.hasFlashUnit() == true
        applyFlash()
    }

    fun cycleFlash() {
        flash = when (mode) {
            Prefs.CaptureMode.Video -> if (flash == Flash.On) Flash.Off else Flash.On
            else -> Flash.entries[(flash.ordinal + 1) % Flash.entries.size]
        }
        applyFlash()
    }

    private fun applyFlash() {
        val on = hasFlash && flash == Flash.On
        image.flashMode = when {
            !hasFlash -> ImageCapture.FLASH_MODE_OFF
            flash == Flash.On -> ImageCapture.FLASH_MODE_ON
            flash == Flash.Auto -> ImageCapture.FLASH_MODE_AUTO
            else -> ImageCapture.FLASH_MODE_OFF
        }
        // Torch is a continuous light: only in video mode, so photo flash isn't fighting it.
        camera?.cameraControl?.enableTorch(mode == Prefs.CaptureMode.Video && on)
    }
    val video: VideoCapture<Recorder> = VideoCapture.withOutput(
        Recorder.Builder().setQualitySelector(QualitySelector.from(Quality.HD, FallbackStrategy.lowerQualityOrHigherThan(Quality.SD))).build(),
    )
    private var recording: Recording? = null
    var recordingSince by mutableStateOf<Long?>(null)
        private set
    private var onDone: ((Uri?, Long, Long) -> Unit)? = null

    /** Records to the gallery (Movies/Verified); audio only if enabled in Settings and permitted. */
    @SuppressLint("MissingPermission")
    fun startVideo(ctx: Context, momentId: String): Boolean {
        if (recording != null) return false
        val t = System.currentTimeMillis()
        val cv = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, "verified-${momentId.take(8)}-$t")
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/Verified")
        }
        val out = MediaStoreOutputOptions.Builder(ctx.contentResolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI).setContentValues(cv).build()
        var pending = video.output.prepareRecording(ctx, out)
        val mic = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (Prefs.videoAudio.value && mic) pending = pending.withAudioEnabled()
        recording = runCatching {
            pending.start(ContextCompat.getMainExecutor(ctx)) { ev ->
                if (ev is VideoRecordEvent.Finalize) {
                    val since = recordingSince ?: t
                    recording = null; recordingSince = null
                    val ok = !ev.hasError() || ev.error == VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE
                    if (!ok) Log.e("VerifiedCam", "video finalize error ${ev.error}", ev.cause)
                    val uri = ev.outputResults.outputUri.takeIf { ok && it != Uri.EMPTY }
                    onDone?.invoke(uri, since, System.currentTimeMillis()); onDone = null
                }
            }
        }.onFailure { Log.e("VerifiedCam", "video start", it) }.getOrNull()
        if (recording != null) recordingSince = t
        return recording != null
    }

    fun stopVideo(done: ((Uri?, Long, Long) -> Unit)? = null) {
        val r = recording ?: return
        onDone = done
        r.stop()
    }
}

@Composable
private fun CameraPreview(cam: CaptureController, mode: Prefs.CaptureMode, modifier: Modifier) {
    val lifecycle = LocalLifecycleOwner.current
    val ctx = LocalContext.current
    // FIT_CENTER: the viewfinder shows the whole sensor frame, exactly what is saved (no hidden cropped edges).
    val pv = remember {
        PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FIT_CENTER; setBackgroundColor(MediaBg.toArgb()) }
    }
    AndroidView(modifier = modifier, factory = { pv })
    // Auto-rotate the capture: follow how the phone is physically held (even with system auto-rotate off or while the
    // activity stays in portrait), so a sideways-held phone saves an upright landscape photo/clip.
    DisposableEffect(cam) {
        val listener = object : OrientationEventListener(ctx) {
            override fun onOrientationChanged(orientation: Int) {
                val r = surfaceRotationFor(orientation) ?: return
                if (cam.image.targetRotation != r) cam.image.targetRotation = r
                if (cam.video.targetRotation != r) cam.video.targetRotation = r
            }
        }
        if (listener.canDetectOrientation()) listener.enable()
        onDispose { listener.disable() }
    }
    // Bind Preview + one capture use case; rebinding per mode works on every hardware level (3 use cases may not).
    LaunchedEffect(mode, cam.front) {
        val future = ProcessCameraProvider.getInstance(ctx)
        future.addListener({
            runCatching {
                val preview = Preview.Builder().build().also { it.surfaceProvider = pv.surfaceProvider }
                cam.bind(future.get(), lifecycle, preview, mode)
            }.onFailure { Log.e("VerifiedCam", "bind failed", it) }
        }, ContextCompat.getMainExecutor(ctx))
    }
}

private class ClipResult(val clip: VideoClip, val poster: Bitmap?, val posterB64: String?)

/** Hashes the saved clip (SHA-256 of the file bytes) and pulls its middle frame as the proof poster. IO thread. */
private fun finishClip(ctx: Context, uri: Uri, startedAt: Long, endedAt: Long): ClipResult? = runCatching {
    val md = MessageDigest.getInstance("SHA-256")
    var bytes = 0L
    ctx.contentResolver.openInputStream(uri)!!.use { ins ->
        val buf = ByteArray(1 shl 16)
        while (true) {
            val n = ins.read(buf)
            if (n < 0) break
            md.update(buf, 0, n); bytes += n
        }
    }
    val sha = md.digest().joinToString("") { "%02x".format(it) }
    val mmr = MediaMetadataRetriever()
    val (durationMs, frame) = try {
        mmr.setDataSource(ctx, uri)
        val d = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: (endedAt - startedAt)
        val f = mmr.getFrameAtTime(d * 500, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) // middle frame (µs)
        d to f?.let { it to frameRotationFix(mmr, it) }
    } finally { mmr.release() }
    val name = ctx.contentResolver.query(uri, arrayOf(MediaStore.Video.Media.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    } ?: uri.lastPathSegment ?: "clip"
    val encoded = frame?.let { (bmp, rot) -> encodeProof(bmp, rot) }
    ClipResult(VideoClip(name, sha, bytes, durationMs, startedAt), encoded?.first, encoded?.second)
}.onFailure { Log.e("VerifiedCam", "clip", it) }.getOrNull()

/**
 * Sensor angle (degrees clockwise from natural, [OrientationEventListener]) → the Surface.ROTATION_* for capture
 * targetRotation, in 45° buckets; null for ORIENTATION_UNKNOWN (flat on a table) so the last rotation is kept.
 */
internal fun surfaceRotationFor(orientation: Int): Int? = when {
    orientation == OrientationEventListener.ORIENTATION_UNKNOWN || orientation < 0 -> null
    orientation >= 315 || orientation < 45 -> Surface.ROTATION_0
    orientation < 135 -> Surface.ROTATION_270
    orientation < 225 -> Surface.ROTATION_180
    else -> Surface.ROTATION_90
}

/**
 * Extra rotation the poster frame still needs. The platform's getFrameAtTime applies the track's rotation metadata,
 * but verify rather than trust: if the clip is tagged 90/270° and the frame still has the coded (unrotated)
 * orientation, rotate it ourselves so the poster comes out upright either way.
 */
private fun frameRotationFix(mmr: MediaMetadataRetriever, frame: Bitmap): Int {
    val rot = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull()?.let { ((it % 360) + 360) % 360 } ?: 0
    if (rot == 0) return 0
    val w = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: return 0
    val h = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: return 0
    if (w == h) return 0
    val codedLandscape = w > h
    val frameLandscape = frame.width > frame.height
    return when (rot) {
        90, 270 -> if (frameLandscape == codedLandscape) rot else 0 // still in coded orientation → not yet rotated
        else -> 0 // 180° can't be detected from the size; the platform applies it
    }
}

/** Upright Bitmap, longest side 640 px → JPEG q0.6 (stepping down to keep < 120 KB base64) → base64 (NO_WRAP). */
private fun encodeProof(raw: Bitmap, rotationDegrees: Int): Pair<Bitmap, String> {
    val s = 640f / max(raw.width, raw.height)
    val m = Matrix().apply { if (s < 1f) postScale(s, s); postRotate(rotationDegrees.toFloat()) }
    val bmp = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
    var q = 60
    var b64: String
    do {
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
        b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        q -= 15
    } while (b64.length > 120_000 && q >= 30)
    return bmp to b64
}

/** Captures a frame → upright Bitmap, longest side 640 px → JPEG q0.6 → base64 (NO_WRAP). */
private fun takeProof(ctx: Context, capture: ImageCapture, done: (Bitmap?, String?) -> Unit) {
    capture.takePicture(ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: ImageProxy) {
            val result = runCatching { encodeProof(image.toBitmap(), image.imageInfo.rotationDegrees) }
                .onFailure { Log.e("VerifiedCam", "encode", it) }.getOrNull()
            image.close()
            done(result?.first, result?.second)
        }
        override fun onError(e: ImageCaptureException) { Log.e("VerifiedCam", "capture", e); done(null, null) }
    })
}

/** v4.11 Finish/sync words ("Uploading video · 34 MB" → "Video uploaded") with an upload progress ring. */
@Composable
fun VideoUploadLine(momentId: String?) {
    val uploads by com.mattricks.verified.data.Clips.uploads.collectAsState()
    val u = momentId?.let { uploads[it] }
    val mb = { b: Long -> "${(b + 512 * 1024) / (1024 * 1024)} MB" }
    val (text, color) = when {
        u == null -> (if (Judging.online()) "Uploading video…" else "Video waits for a connection") to Warn
        u.finished -> "Video uploaded" to Ok
        u.error != null -> "Upload paused · retrying · ${mb(u.totalBytes - u.sentBytes)} left" to Warn
        else -> "Uploading video · ${mb(u.totalBytes)}" to Lake
    }
    val frac = if (u != null && u.totalBytes > 0) (u.sentBytes.toFloat() / u.totalBytes).coerceIn(0f, 1f) else null
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) {}) {
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            when {
                u?.finished == true -> Icon(Icons.Filled.CheckCircle, null, tint = Ok, modifier = Modifier.size(32.dp))
                frac != null -> {
                    CircularProgressIndicator(progress = { frac }, Modifier.size(40.dp), color = color, strokeWidth = 4.dp)
                    Text("${(frac * 100).roundToInt()}", style = Tnum, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                else -> CircularProgressIndicator(Modifier.size(28.dp), color = color, strokeWidth = 3.dp)
            }
        }
        Spacer(Modifier.width(10.dp))
        Icon(Glyph.Video, null, Modifier.size(16.dp), tint = color)
        Spacer(Modifier.width(6.dp))
        Text(text, color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Review / submit: one card with the track sketch, the stats, sync and upload state; then the two actions. */
@Composable
private fun FinishedView(ui: RecUi, vm: RecordViewModel, user: FirebaseUser?, onOpen: (String) -> Unit) {
    val judging by Judging.status.collectAsState()
    val guests by com.mattricks.verified.data.Vault.guests.collectAsState()
    val stillLocal = ui.guest && guests.any { it.id == ui.momentId }
    FinishedContent(
        ui, stillLocal = stillLocal, signedIn = user != null, judging = judging, online = Judging.online(),
        onVerify = {
            ui.momentId?.let { id -> com.mattricks.verified.auth.Gate.require("verify this Moment") { com.mattricks.verified.data.Claims.claim(listOf(id)) } }
        },
        onOpen = { ui.momentId?.let(onOpen) }, onNew = vm::reset,
    )
}

@Composable
internal fun FinishedContent(
    ui: RecUi, stillLocal: Boolean, signedIn: Boolean, judging: String?, online: Boolean,
    onVerify: () -> Unit, onOpen: () -> Unit, onNew: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().safeTopAndSides().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(if (ui.guest) FillInk else FillLake), contentAlignment = Alignment.Center) {
            Icon(if (ui.guest) Glyph.OnDevice else Icons.Filled.CloudUpload, null, tint = Color.White, modifier = Modifier.size(36.dp))
        }
        Text(if (ui.guest) "Moment saved" else "Moment submitted", style = MaterialTheme.typography.headlineMedium)
        Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(96.dp, 80.dp)) { TrackCanvas(ui.track, Modifier.matchParentSize()) }
                    Spacer(Modifier.width(14.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val ink = MaterialTheme.colorScheme.onSurface
                        StatOverlay(Glyph.Time, fmtDuration(ui.elapsedMs), tint = ink, sub = Ink2, big = true)
                        StatOverlay(Glyph.Distance, fmtDistance(ui.distanceM), tint = ink, sub = Ink2, big = true)
                        StatOverlay(Glyph.Frames, "${ui.frameCount}", "shots", tint = ink, sub = Ink2, big = true)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SyncChip(ui)
                    if (ui.witnessAsked > 0) GlyphPill(Glyph.Witness, "${ui.witnessAnswered}/${ui.witnessAsked}", FillInk)
                    if (ui.videoCount > 0) GlyphPill(Glyph.Video, "${ui.videoCount}", FillInk)
                }
                if (!ui.guest && ui.hasVideo) VideoUploadLine(ui.momentId)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (ui.guest) Glyph.OnDevice else Glyph.Ai, null, Modifier.size(18.dp), tint = Lake)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        when {
                            ui.guest && stillLocal -> "On this phone, hash chain and all. Sign in to verify."
                            ui.guest -> "Uploading to your account — the cloud review runs next."
                            judging != null -> judging
                            online -> "Judge, skeptic + scorer run next, then the seal."
                            else -> "Offline — judging runs when you're back online."
                        },
                        style = MaterialTheme.typography.bodyMedium, color = Ink2, modifier = Modifier.weight(1f),
                    )
                    if (!ui.guest) HybridBadge("cloud")
                }
            }
        }
        if (ui.guest && stillLocal) Button(onClick = onVerify, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(28.dp)) {
            Icon(Icons.Filled.CloudUpload, null); Spacer(Modifier.width(8.dp)); Text(if (!signedIn) "Sign in to verify" else "Upload & verify", fontWeight = FontWeight.Bold)
        }
        if (ui.momentId != null) {
            val primary = !(ui.guest && stillLocal)
            val mod = Modifier.fillMaxWidth().heightIn(min = 56.dp)
            if (primary) Button(onClick = onOpen, modifier = mod, shape = RoundedCornerShape(28.dp)) { Icon(Glyph.Result, null); Spacer(Modifier.width(8.dp)); Text("View Moment", fontWeight = FontWeight.Bold) }
            else OutlinedButton(onClick = onOpen, modifier = mod, shape = RoundedCornerShape(28.dp)) { Text("View Moment") }
        }
        OutlinedButton(onClick = onNew, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(28.dp)) {
            Icon(Icons.Filled.FiberManualRecord, null, tint = FillBad); Spacer(Modifier.width(8.dp)); Text("New Moment")
        }
    }
}

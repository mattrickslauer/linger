package com.mattricks.verified.ui

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Base64
import android.util.Log
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

@Composable
private fun LiveView(ui: RecUi, vm: RecordViewModel) {
    val view = LocalView.current
    DisposableEffect(Unit) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val cam = remember { CaptureController() }
    val defaultMode by Prefs.captureMode.collectAsState()
    var mode by remember { mutableStateOf(defaultMode) }
    var shooting by remember { mutableStateOf(false) }
    var mapBig by remember { mutableStateOf(false) }
    val recording = cam.recordingSince != null
    DisposableEffect(Unit) { onDispose { cam.stopVideo() } }

    Column(Modifier.fillMaxSize()) {
        // Compact stats bar: the camera gets the rest of the screen.
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(ui.intention, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(fmtDuration(ui.elapsedMs), fontSize = 30.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(10.dp))
                    Text(fmtDistance(ui.distanceM), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 4.dp))
                }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SyncBadge(ui)
                ui.heartRate?.let { Pill("♥ $it bpm", Red) }
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp).clip(RoundedCornerShape(20.dp)).background(Color.Black)) {
            val miniPos = Modifier.align(Alignment.TopEnd).padding(top = 56.dp, end = 10.dp).size(width = 116.dp, height = 150.dp)
            val mini = miniPos.zIndex(2f).clip(RoundedCornerShape(14.dp)).border(2.dp, Color.White, RoundedCornerShape(14.dp))
            val full = Modifier.fillMaxSize().zIndex(1f)
            // Both always composed in the same order, so swapping never rebinds the camera or reloads the map.
            CameraPreview(cam, mode, if (mapBig) mini else full)
            TrackMap(ui.track, if (mapBig) full else mini, live = true, compact = !mapBig)
            // Tap the small window to swap camera ↔ map (also keeps the mini map from eating pan gestures).
            Box(miniPos.zIndex(3f).clickable { mapBig = !mapBig })

            CoachBanner(ui, Modifier.align(Alignment.TopCenter).padding(8.dp).zIndex(4f))
            cam.recordingSince?.let { since ->
                Pill(
                    "● REC ${fmtDuration(max(0L, ui.elapsedMs - (since - ui.startedAt)))}", Red,
                    modifier = Modifier.align(Alignment.TopStart).padding(start = 10.dp, top = 56.dp).zIndex(4f),
                )
            }
            ModeToggle(mode, enabled = !recording && !ui.checking && !shooting, Modifier.align(Alignment.BottomCenter).padding(12.dp).zIndex(4f)) {
                mode = it
            }
            if (!mapBig) CameraButtons(cam, mode, flipEnabled = !recording && !ui.checking && !shooting, Modifier.align(Alignment.BottomEnd).padding(12.dp).zIndex(4f))
        }

        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Sparkline(ui.sparkline, Modifier.fillMaxWidth().height(28.dp))
                Text(
                    buildString {
                        append("${ui.frameCount} frames")
                        if (ui.videoCount > 0) append(" · ${ui.videoCount} clips")
                        append(" · ").append(ui.accuracyM?.let { "GPS ±${it.roundToInt()} m" } ?: "GPS…")
                    },
                    style = MaterialTheme.typography.bodySmall, color = Color.Gray, maxLines = 2,
                )
            }
            Spacer(Modifier.width(12.dp))
            Shutter(
                mode = mode, recording = recording, busy = shooting || ui.checking,
                onClick = {
                    when {
                        mode == Prefs.CaptureMode.Photo -> {
                            shooting = true
                            takeProof(ctx, cam.image) { bmp, b64 -> shooting = false; if (bmp != null && b64 != null) vm.proofShot(bmp, b64) }
                        }
                        !recording -> if (cam.startVideo(ctx, ui.momentId ?: "moment")) vm.videoStarted()
                        else -> {
                            shooting = true
                            cam.stopVideo { uri, startedAt, endedAt ->
                                scope.launch {
                                    val r = if (uri != null) withContext(Dispatchers.IO) { finishClip(ctx, uri, startedAt, endedAt) } else null
                                    shooting = false
                                    if (r != null) vm.videoClip(r.clip, r.poster, r.posterB64)
                                    else Toast.makeText(ctx, "Video clip failed to save", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                },
            )
            Spacer(Modifier.width(12.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                OutlinedButton(enabled = !ui.checking && !recording && !shooting, onClick = vm::finish, modifier = Modifier.height(52.dp)) { Text("Finish") }
            }
        }
        if (ui.elapsedMs < 20_000) Text(
            "Moments shorter than 20 s can't be sealed.", style = MaterialTheme.typography.bodySmall, color = Color.Gray,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 6.dp),
        )
    }
}

@Composable
private fun ModeToggle(mode: Prefs.CaptureMode, enabled: Boolean, modifier: Modifier, onChange: (Prefs.CaptureMode) -> Unit) {
    Surface(modifier, color = Color(0x99000000), shape = RoundedCornerShape(50)) {
        Row(Modifier.padding(4.dp)) {
            Prefs.CaptureMode.entries.forEach { m ->
                val sel = m == mode
                Box(
                    Modifier.clip(RoundedCornerShape(50)).background(if (sel) Color.White else Color.Transparent)
                        .clickable(enabled = enabled && !sel) { onChange(m) }.padding(horizontal = 16.dp, vertical = 7.dp),
                ) {
                    Text(
                        m.name.uppercase(), color = if (sel) Color.Black else Color.White.copy(alpha = if (enabled) 1f else 0.5f),
                        fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.sp,
                    )
                }
            }
        }
    }
}

/** Flash (only when the lens has one) and front/back flip, as round buttons over the camera. */
@Composable
private fun CameraButtons(cam: CaptureController, mode: Prefs.CaptureMode, flipEnabled: Boolean, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
        Modifier.size(44.dp).clip(CircleShape).background(Color(0x99000000))
            .clickable(enabled = enabled, onClick = onClick, role = Role.Button, onClickLabel = label),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = Color.White.copy(alpha = if (enabled) 1f else 0.5f)) }
}

/** Big round shutter: green camera disc for photo, red disc for video, red rounded square while recording. */
@Composable
private fun Shutter(mode: Prefs.CaptureMode, recording: Boolean, busy: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(78.dp).clip(CircleShape).border(4.dp, MaterialTheme.colorScheme.onSurface, CircleShape)
            .clickable(enabled = !busy, onClick = onClick, role = Role.Button),
        contentAlignment = Alignment.Center,
    ) {
        when {
            busy -> CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 3.dp)
            recording -> Box(Modifier.size(28.dp).clip(RoundedCornerShape(6.dp)).background(Red))
            mode == Prefs.CaptureMode.Video -> Box(Modifier.size(58.dp).clip(CircleShape).background(Red))
            else -> Box(Modifier.size(58.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.CameraAlt, "Proof shot", tint = Color.White)
            }
        }
    }
}

@Composable
private fun SyncBadge(ui: RecUi) {
    val (text, color) = when {
        ui.guest -> "On this phone · ${ui.chunksTotal} chunks" to Color(0xFF3D5A4C)
        ui.chunksPending > 0 -> "Offline · ${ui.chunksPending} chunks queued" to Amber
        ui.chunksTotal > 0 -> "Synced · ${ui.chunksTotal} chunks" to Green
        else -> "Recording · first chunk in 5 s" to Color.DarkGray
    }
    Pill(text, color)
}

@Composable
private fun CoachBanner(ui: RecUi, modifier: Modifier) {
    val c = ui.coach
    val (text, color) = when {
        ui.checking -> "Checking frame…" to Color(0xCC333333)
        c == null -> "Take a proof shot of your progress" to Color(0x99333333)
        c.mode == "none" -> "Frame saved · ${c.reason}" to Color(0xCC555555)
        !c.ok -> "Retake: ${c.reason}" to Red.copy(alpha = 0.9f)
        c.mode == "on_device" -> "On-device: keep going" to Green.copy(alpha = 0.92f)
        else -> "Keep going · checked in the cloud (no on-device model)" to Green.copy(alpha = 0.92f)
    }
    Surface(modifier, color = color, shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (ui.checking) { CircularProgressIndicator(Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
            Text(text, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
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
    val pv = remember { PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    AndroidView(modifier = modifier, factory = { pv })
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
        d to mmr.getFrameAtTime(d * 500, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) // middle frame (µs), already upright
    } finally { mmr.release() }
    val name = ctx.contentResolver.query(uri, arrayOf(MediaStore.Video.Media.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    } ?: uri.lastPathSegment ?: "clip"
    val encoded = frame?.let { encodeProof(it, 0) }
    ClipResult(VideoClip(name, sha, bytes, durationMs, startedAt), encoded?.first, encoded?.second)
}.onFailure { Log.e("VerifiedCam", "clip", it) }.getOrNull()

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

@Composable
private fun FinishedView(ui: RecUi, vm: RecordViewModel, user: FirebaseUser?, onOpen: (String) -> Unit) {
    val judging by Judging.status.collectAsState()
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(24.dp))
        Text(if (ui.guest) "Moment saved" else "Moment submitted", style = MaterialTheme.typography.headlineSmall)
        Text("${fmtDuration(ui.elapsedMs)} · ${fmtDistance(ui.distanceM)} · ${ui.frameCount} frames")
        SyncBadge(ui)
        if (ui.guest) {
            val guests by com.mattricks.verified.data.Vault.guests.collectAsState()
            val stillLocal = guests.any { it.id == ui.momentId }
            Text(
                if (stillLocal) "Saved on this phone, hash chain and all. Sign in to upload it, run the cloud review and get it sealed."
                else "Uploading to your account — the cloud review runs next.",
                color = Color.Gray, style = MaterialTheme.typography.bodyMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            if (stillLocal) Button(onClick = {
                val id = ui.momentId ?: return@Button
                com.mattricks.verified.auth.Gate.require("verify this Moment") { com.mattricks.verified.data.Claims.claim(listOf(id)) }
            }) { Text(if (user == null) "Sign in to verify" else "Upload & verify") }
        } else Text(
            judging ?: if (Judging.online()) "Judge, skeptic + scorer run in the cloud, then the seal is computed." else "Offline — judging will run when you're back online.",
            color = Color.Gray, style = MaterialTheme.typography.bodyMedium,
        )
        ui.momentId?.let { id -> Button(onClick = { onOpen(id) }) { Text("View Moment") } }
        OutlinedButton(onClick = vm::reset, colors = ButtonDefaults.outlinedButtonColors()) { Text("New Moment") }
    }
}

package com.mattricks.verified.ui

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Base64
import android.util.Log
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
    if (user == null) { SignInCard(); return }
    val vm: RecordViewModel = viewModel()
    val ui by vm.ui.collectAsState()
    when (ui.phase) {
        RecUi.Phase.Idle -> SetupView(ui, vm)
        RecUi.Phase.Recording -> LiveView(ui, vm)
        RecUi.Phase.Finished -> FinishedView(ui, vm, onOpen)
    }
}

@Composable
private fun SetupView(ui: RecUi, vm: RecordViewModel) {
    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.start() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Declare your intention", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(
            value = ui.intention, onValueChange = vm::setIntention, modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Catch and release a largemouth bass at Lake Mission Viejo") }, minLines = 2,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            CATEGORIES.take(3).forEach { c -> FilterChip(selected = ui.category == c, onClick = { vm.setCategory(c) }, label = { Text(c) }) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            CATEGORIES.drop(3).forEach { c -> FilterChip(selected = ui.category == c, onClick = { vm.setCategory(c) }, label = { Text(c) }) }
        }
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { perms.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) },
            enabled = ui.intention.isNotBlank(), modifier = Modifier.fillMaxWidth().height(64.dp),
            shape = RoundedCornerShape(32.dp),
        ) { Text("Start Moment", fontSize = 20.sp, fontWeight = FontWeight.Bold) }
        Text(
            "GPS, motion and proof shots are hash-chained as you go. Works offline — it syncs when you're back online.",
            style = MaterialTheme.typography.bodySmall, color = Color.Gray,
        )
    }
}

@Composable
private fun LiveView(ui: RecUi, vm: RecordViewModel) {
    val view = LocalView.current
    DisposableEffect(Unit) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
    val ctx = LocalContext.current
    val capture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }
    var shooting by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(ui.intention, style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(fmtDuration(ui.elapsedMs), fontSize = 40.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End) {
                Text(fmtDistance(ui.distanceM), style = MaterialTheme.typography.titleMedium)
                Text("${ui.frameCount} frames · ${ui.gpsCount} fixes", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
        }
        SyncBadge(ui)
        Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(16.dp))) {
            CameraPreview(capture)
            CoachBanner(ui, Modifier.align(Alignment.TopCenter).padding(8.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            TrackCanvas(ui.track, Modifier.size(96.dp), live = true)
            Column(Modifier.weight(1f)) {
                Text("Motion", style = MaterialTheme.typography.labelMedium, color = Color.Gray)
                Sparkline(ui.sparkline, Modifier.fillMaxWidth().height(48.dp))
                Text(ui.accuracyM?.let { "GPS ±${it.roundToInt()} m" } ?: "Waiting for GPS…", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                enabled = !ui.checking && !shooting,
                onClick = {
                    shooting = true
                    takeProof(ctx, capture) { bmp, b64 -> shooting = false; if (bmp != null && b64 != null) vm.proofShot(bmp, b64) }
                },
                modifier = Modifier.weight(1f).height(56.dp),
            ) {
                Icon(Icons.Filled.CameraAlt, null); Spacer(Modifier.width(8.dp)); Text("Proof shot")
            }
            OutlinedButton(enabled = !ui.checking, onClick = vm::finish, modifier = Modifier.weight(1f).height(56.dp)) { Text("Finish") }
        }
        if (ui.elapsedMs < 20_000) Text("Moments shorter than 20 s can't be sealed.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
    }
}

@Composable
private fun SyncBadge(ui: RecUi) {
    val (text, color) = when {
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

@Composable
private fun CameraPreview(capture: ImageCapture) {
    val lifecycle = LocalLifecycleOwner.current
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val pv = PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
            val future = ProcessCameraProvider.getInstance(ctx)
            future.addListener({
                runCatching {
                    val provider = future.get()
                    val preview = Preview.Builder().build().also { it.surfaceProvider = pv.surfaceProvider }
                    provider.unbindAll()
                    provider.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, capture)
                }.onFailure { Log.e("VerifiedCam", "bind failed", it) }
            }, ContextCompat.getMainExecutor(ctx))
            pv
        },
    )
}

/** Captures a frame → upright Bitmap, longest side 640 px → JPEG q0.6 → base64 (NO_WRAP). */
private fun takeProof(ctx: Context, capture: ImageCapture, done: (Bitmap?, String?) -> Unit) {
    capture.takePicture(ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: ImageProxy) {
            val result = runCatching {
                val raw = image.toBitmap()
                val rot = image.imageInfo.rotationDegrees
                val s = 640f / max(raw.width, raw.height)
                val m = Matrix().apply { if (s < 1f) postScale(s, s); postRotate(rot.toFloat()) }
                val bmp = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
                var q = 60
                var b64: String
                do {
                    val out = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
                    b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                    q -= 15
                } while (b64.length > 120_000 && q >= 30)
                bmp to b64
            }.onFailure { Log.e("VerifiedCam", "encode", it) }.getOrNull()
            image.close()
            done(result?.first, result?.second)
        }
        override fun onError(e: ImageCaptureException) { Log.e("VerifiedCam", "capture", e); done(null, null) }
    })
}

@Composable
private fun FinishedView(ui: RecUi, vm: RecordViewModel, onOpen: (String) -> Unit) {
    val judging by Judging.status.collectAsState()
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(24.dp))
        Text("Moment submitted", style = MaterialTheme.typography.headlineSmall)
        Text("${fmtDuration(ui.elapsedMs)} · ${fmtDistance(ui.distanceM)} · ${ui.frameCount} frames")
        SyncBadge(ui)
        Text(
            judging ?: if (Judging.online()) "Judge + skeptic run in the cloud, then the seal is computed." else "Offline — judging will run when you're back online.",
            color = Color.Gray, style = MaterialTheme.typography.bodyMedium,
        )
        ui.momentId?.let { id -> Button(onClick = { onOpen(id) }) { Text("View Moment") } }
        OutlinedButton(onClick = vm::reset, colors = ButtonDefaults.outlinedButtonColors()) { Text("New Moment") }
    }
}

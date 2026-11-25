package com.mattricks.verified.ui

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseUser
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.auth.Auth
import com.mattricks.verified.auth.Gate
import com.mattricks.verified.data.Claims
import com.mattricks.verified.data.Store
import com.mattricks.verified.data.Vault
import kotlinx.coroutines.launch

const val PITCH = "Proof that it really happened. Recorded, chained and checked by AI."

/** Feed header: the app IS the landing page (v3.1). Pitch, big Record CTA, quiet sign-in. */
@Composable
fun FeedHero(user: FirebaseUser?, onRecord: () -> Unit) {
    Surface(
        Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), color = Color.Transparent,
    ) {
        Box(Modifier.background(Brush.linearGradient(listOf(GreenDark, Green, Color(0xFF2FA36B))))) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Verified, null, tint = Color.White, modifier = Modifier.size(26.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Verified", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    if (user == null) TextButton(onClick = { Gate.signIn() }) { Text("Sign in", color = Color.White) }
                    else Pill(user.displayName?.substringBefore(' ') ?: "Signed in", Color(0x33FFFFFF))
                }
                Text(PITCH, color = Color.White, fontSize = 17.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium)
                Button(
                    onClick = onRecord, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(28.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = GreenDark),
                ) {
                    Icon(Icons.Filled.FiberManualRecord, null, tint = Red, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Record a Moment", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
                Text(
                    if (user == null) "No account needed to record. Your Moments stay on this phone until you sign in to verify them."
                    else "GPS, motion and proof shots are hash-chained, coached on-device and judged in the cloud.",
                    color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp,
                )
            }
        }
    }
}

/** "Sign in to <action>" (v3.1), shown by [Gate]. Resumes the action after sign-in (MainActivity watches the user). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInSheet(ask: Gate.Ask) {
    val activity = LocalContext.current as Activity
    val scope = rememberCoroutineScope()
    val state by Auth.signIn.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val working = busy || state == Auth.SignIn.InBrowser || state == Auth.SignIn.Finishing
    ModalBottomSheet(onDismissRequest = { Gate.dismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Filled.Verified, null, tint = Green, modifier = Modifier.size(48.dp))
            Text("Sign in to ${ask.action}", style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            Text(
                "Browsing and recording work without an account. Signing in lets Verified store your Moments on the " +
                    "server, run the cloud review and seal them.",
                color = Color.Gray, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(6.dp))
            Button(
                enabled = !working, onClick = { error = null; Auth.startSignIn(activity) },
                modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(26.dp),
            ) { Text("Sign in", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            if (BuildConfig.USE_EMULATOR) OutlinedButton(enabled = !working, onClick = {
                busy = true; error = null
                scope.launch { error = Auth.signInEmulatorTestUser(); busy = false }
            }) { Text("Emulator test user") }
            if (working) Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(if (state == Auth.SignIn.Finishing) "Signing you in…" else "Finish in the browser…", color = Color.Gray)
            }
            (error ?: (state as? Auth.SignIn.Failed)?.message)?.let { Text(it, color = Red, textAlign = TextAlign.Center) }
            TextButton(onClick = { Gate.dismiss() }) { Text("Not now") }
        }
    }
}

/** "You recorded N Moments as a guest" (v3.1 claim flow). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClaimSheet() {
    val guests by Vault.guests.collectAsState()
    val uploading by Claims.uploading.collectAsState()
    val list = guests.filter { it.status == "submitted" && it.id !in uploading }
    var kept by remember { mutableStateOf(setOf<String>()) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val shown = list.filter { it.id !in kept }
    if (shown.isEmpty()) {
        androidx.compose.runtime.LaunchedEffect(Unit) { Claims.dismiss() }
        return
    }
    ModalBottomSheet(onDismissRequest = { Claims.dismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CloudUpload, null, tint = Green)
                Spacer(Modifier.width(10.dp))
                Text(
                    "You recorded ${shown.size} Moment${if (shown.size == 1) "" else "s"} as a guest",
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                )
            }
            Text("Upload them to your account to get them verified? Their hash chains stay exactly as recorded.", color = Color.Gray, style = MaterialTheme.typography.bodyMedium)
            shown.forEach { m ->
                Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                    Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        B64Image(m.heroB64, Modifier.size(52.dp).clip(RoundedCornerShape(10.dp)))
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(m.text, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                            Text("${fmtDuration(m.summary.durationMs)} · ${m.summary.frameCount} frames", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                        }
                        TextButton(onClick = { kept = kept + m.id }) { Text("Keep here", fontSize = 12.sp) }
                        TextButton(onClick = { confirmDelete = m.id }) { Text("Delete", color = Red, fontSize = 12.sp) }
                    }
                }
            }
            Button(
                onClick = { Claims.claim(shown.map { it.id }) }, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(26.dp),
            ) { Text("Upload all", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            TextButton(onClick = { Claims.dismiss() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Not now") }
        }
    }
    confirmDelete?.let { id ->
        DeleteMomentDialog(onConfirm = { confirmDelete = null; Store.deleteMoment(id) }, onDismiss = { confirmDelete = null })
    }
}

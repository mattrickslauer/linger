package com.mattricks.verified.ui

import android.net.Uri
import android.util.Log
import android.view.LayoutInflater
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.google.firebase.storage.FirebaseStorage
import com.mattricks.verified.R
import com.mattricks.verified.data.MomentDetail
import com.mattricks.verified.data.SharedClip
import kotlinx.coroutines.tasks.await
import java.util.concurrent.ConcurrentHashMap

// ───────────────────────── v4.12 shared video (docs/ARCHITECTURE.md "v4.12 Shared video")

/** Download URLs per Storage path, for the session. A failure is not cached, so a later look retries. */
object ClipUrls {
    private val cache = ConcurrentHashMap<String, Uri>()

    suspend fun get(path: String): Uri? = cache[path] ?: runCatching {
        FirebaseStorage.getInstance().reference.child(path).downloadUrl.await()
    }.onFailure { Log.w("VerifiedVideo", "download url $path", it) }.getOrNull()?.also { cache[path] = it }
}

/** The feed's one player, re-pointed at the current slide; released when the feed leaves composition. */
@Composable
fun rememberFeedPlayer(): ExoPlayer {
    val ctx = LocalContext.current
    val player = remember { ExoPlayer.Builder(ctx).build().apply { repeatMode = Player.REPEAT_MODE_ONE; volume = 0f } }
    DisposableEffect(player) { onDispose { player.release() } }
    return player
}

/** A [PlayerView] on a TextureView (res/layout/video_player.xml), so it fades and scrolls like any composable. */
@androidx.annotation.OptIn(UnstableApi::class)
private fun inflatePlayerView(ctx: android.content.Context, controls: Boolean): PlayerView =
    (LayoutInflater.from(ctx).inflate(R.layout.video_player, null) as PlayerView).apply {
        useController = controls
        resizeMode = if (controls) AspectRatioFrameLayout.RESIZE_MODE_FIT else AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        if (controls) setShutterBackgroundColor(android.graphics.Color.BLACK)
    }

/**
 * The feed clip of the current slide: muted (unless [muted] is false), looping, no controls, over the hero photo,
 * which shows through until the first frame renders. Only composed for the current, settled slide while the app is
 * in the foreground, so leaving the slide or the app stops it. No URL (offline, rules) → nothing, the photo stays.
 */
@Composable
fun FeedVideo(clip: SharedClip, player: ExoPlayer, muted: Boolean, modifier: Modifier = Modifier) {
    val url by produceState<Uri?>(null, clip.path) { value = ClipUrls.get(clip.path) }
    var shown by remember(clip.path) { mutableStateOf(false) }
    val u = url ?: return
    DisposableEffect(player, u) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() { shown = true }
        }
        player.addListener(listener)
        player.setMediaItem(MediaItem.Builder().setUri(u).setMediaId(clip.path).build())
        player.prepare()
        player.playWhenReady = true
        onDispose {
            player.removeListener(listener)
            // Another slide may already have taken the player over; only stop our own clip.
            if (player.currentMediaItem?.mediaId == clip.path) { player.stop(); player.clearMediaItems() }
        }
    }
    LaunchedEffect(player, muted) { player.volume = if (muted) 0f else 1f }
    AndroidView(
        factory = { inflatePlayerView(it, controls = false).also { v -> v.player = player } },
        update = { it.player = player },
        onRelease = { it.player = null },
        modifier = modifier.graphicsLayer { alpha = if (shown) 1f else 0f },
    )
}

/** The small speaker button on a slide with a feed clip: sound on/off for that slide (default muted). */
@Composable
fun MuteButton(muted: Boolean, onToggle: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(TokBg.copy(alpha = 0.6f)).clickable(onClickLabel = if (muted) "Sound on" else "Sound off", onClick = onToggle),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp,
            if (muted) "Sound off" else "Sound on", tint = TokInk, modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * Evidence room "Video": every uploaded clip of the Moment, each playable with controls (never autoplayed). One
 * player at a time: tapping a clip opens it in place; leaving the screen or the app pauses it.
 */
@Composable
fun SharedVideoSection(d: MomentDetail) {
    if (d.sharedClips.isEmpty()) return
    var open by remember(d.card.id) { mutableStateOf<String?>(null) }
    Text("Video", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        d.sharedClips.forEachIndexed { i, c ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (open == c.path) ClipPlayer(c)
                    else Box(
                        Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black)
                            .clickable(onClickLabel = "Play clip ${i + 1}") { open = c.path },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.PlayArrow, "Play", tint = Color.White, modifier = Modifier.size(32.dp)) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Clip ${i + 1}", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.width(8.dp))
                        if (c.durationMs > 0) Text(fmtDuration(c.durationMs), color = Color.Gray, fontSize = 13.sp)
                        Spacer(Modifier.weight(1f))
                        Text(
                            when (c.hashOk) { true -> "hash ✓"; false -> "Hash does not match the chain"; null -> "uploaded" },
                            color = when (c.hashOk) { true -> Ok; false -> Bad; null -> Color.Gray }, fontSize = 12.sp,
                        )
                    }
                }
            }
        }
    }
}

/** One clip with controls; its own player, released when it leaves, paused when the app goes to the background. */
@Composable
private fun ClipPlayer(c: SharedClip) {
    val ctx = LocalContext.current
    // null while loading, Uri.EMPTY when the URL could not be had (offline, rules).
    val url by produceState<Uri?>(null, c.path) { value = ClipUrls.get(c.path) ?: Uri.EMPTY }
    val u = url
    if (u == null || u == Uri.EMPTY) {
        Box(Modifier.fillMaxWidth().height(56.dp), contentAlignment = Alignment.Center) {
            if (u == Uri.EMPTY) Text("Couldn't load this clip.", color = Color.Gray, fontSize = 13.sp)
            else CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
        return
    }
    val player = remember(u) {
        ExoPlayer.Builder(ctx).build().apply { setMediaItem(MediaItem.fromUri(u)); prepare(); playWhenReady = true }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player, lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs); player.release() }
    }
    AndroidView(
        factory = { inflatePlayerView(it, controls = true).also { v -> v.player = player } },
        onRelease = { it.player = null },
        modifier = Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(10.dp)),
    )
}

package com.mattricks.verified.ui

import android.net.Uri
import android.util.Log
import android.view.LayoutInflater
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.google.firebase.storage.FirebaseStorage
import com.mattricks.verified.R
import com.mattricks.verified.data.SharedClip
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.File
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentHashMap

// ───────────────────────── v4.12 shared video (docs/ARCHITECTURE.md "v4.12 Shared video")

/** Download URLs per Storage path, for the session. A failure is not cached, so a later look retries. */
object ClipUrls {
    private val cache = ConcurrentHashMap<String, Uri>()

    suspend fun get(path: String): Uri? = cache[path] ?: runCatching {
        FirebaseStorage.getInstance().reference.child(path).downloadUrl.await()
    }.onFailure { Log.w("VerifiedVideo", "download url $path", it) }.getOrNull()?.also { cache[path] = it }
}

/**
 * On-disk cache of shared clips for every player in the app (LRU, 300 MB). Clips are named by their sha256 and never
 * change, so each item is keyed by its Storage path: a replay, or a slide seen again, plays from disk, and the next
 * slide's clip can be fetched ahead ([prefetch]).
 */
@androidx.annotation.OptIn(UnstableApi::class)
object ClipCache {
    private const val MAX_BYTES = 300L shl 20
    /** How much of the next slide's clip [prefetch] fetches: a few seconds at phone bitrates. */
    private const val PREFETCH_BYTES = 2L shl 20

    @Volatile private var cache: SimpleCache? = null

    private fun cache(ctx: android.content.Context): SimpleCache = cache ?: synchronized(this) {
        cache ?: SimpleCache(
            File(ctx.applicationContext.cacheDir, "clips"),
            LeastRecentlyUsedCacheEvictor(MAX_BYTES),
            StandaloneDatabaseProvider(ctx.applicationContext),
        ).also { cache = it }
    }

    private fun dataSource(ctx: android.content.Context): CacheDataSource.Factory = CacheDataSource.Factory()
        .setCache(cache(ctx))
        .setUpstreamDataSourceFactory(DefaultDataSource.Factory(ctx.applicationContext))
        .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

    /**
     * A player reading through the cache, tuned to start fast: playback begins with half a second buffered (short
     * clips; the default waits for 2.5 s) and keeps up to 30 s ahead.
     */
    fun player(ctx: android.content.Context): ExoPlayer = ExoPlayer.Builder(ctx)
        .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource(ctx)))
        .setLoadControl(
            DefaultLoadControl.Builder().setBufferDurationsMs(10_000, 30_000, 500, 1_500).build(),
        )
        .build()

    /** The item for [path] at [uri]: cached under the path, so a fresh download token still hits the cache. */
    fun item(uri: Uri, path: String): MediaItem = MediaItem.Builder().setUri(uri).setMediaId(path).setCustomCacheKey(path).build()

    /** Fetches the start of [path]'s clip into the cache (cancelled with the caller, e.g. when the slide changes). */
    suspend fun prefetch(ctx: android.content.Context, path: String) {
        val uri = ClipUrls.get(path) ?: return
        val app = ctx.applicationContext
        withContext(Dispatchers.IO) {
            val writer = CacheWriter(
                dataSource(app).createDataSource(),
                DataSpec.Builder().setUri(uri).setKey(path).setLength(PREFETCH_BYTES).build(),
                null, null,
            )
            val job = coroutineContext[Job]
            val stop = job?.invokeOnCompletion { writer.cancel() }
            runCatching { writer.cache() }.onFailure { if (it !is InterruptedIOException) Log.w("VerifiedVideo", "prefetch $path", it) }
            stop?.dispose()
        }
    }
}

/** The feed's one player, re-pointed at the current slide; released when the feed leaves composition. */
@Composable
fun rememberFeedPlayer(): ExoPlayer {
    val ctx = LocalContext.current
    val player = remember { ClipCache.player(ctx).apply { repeatMode = Player.REPEAT_MODE_ONE; volume = 0f } }
    DisposableEffect(player) { onDispose { player.release() } }
    return player
}

/** A [PlayerView] on a TextureView (res/layout/video_player.xml), so it fades and scrolls like any composable. */
@androidx.annotation.OptIn(UnstableApi::class)
private fun inflatePlayerView(ctx: android.content.Context, controls: Boolean, layout: Int = R.layout.video_player): PlayerView =
    (LayoutInflater.from(ctx).inflate(layout, null) as PlayerView).apply {
        useController = controls
        // Always FIT: the whole frame at its true aspect, never cropped. With controls the letterbox is the dark media
        // background; the muted feed clip letterboxes over the (fit) hero photo and its blurred backdrop.
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        if (controls) { setShutterBackgroundColor(MediaBg.toArgb()); setBackgroundColor(MediaBg.toArgb()) }
    }

/**
 * The feed clip of the current slide: muted (unless [muted] is false), looping, no controls, over the hero photo,
 * which shows through until the first frame renders. Only composed for the current, settled slide while the app is
 * in the foreground, so leaving the slide or the app stops it. No URL (offline, rules) → nothing, the photo stays.
 *
 * Orientation: [modifier] gives the slide's box; [rotateFit] measures the view with that box's sides swapped for a
 * quarter turn, the view FITs the clip (ExoPlayer already honours the container's rotation) into it, then the whole
 * view is turned by displayRotation, so a turned clip is upright and fits the slide at its oriented aspect.
 */
@Composable
fun FeedVideo(clip: SharedClip, player: ExoPlayer, muted: Boolean, modifier: Modifier = Modifier, rotation: Int = 0) {
    val url by produceState<Uri?>(null, clip.path) { value = ClipUrls.get(clip.path) }
    var shown by remember(clip.path) { mutableStateOf(false) }
    val u = url ?: return
    DisposableEffect(player, u) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() { shown = true }
        }
        player.addListener(listener)
        player.setMediaItem(ClipCache.item(u, clip.path))
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
        // displayRotation: the stored clip is never changed; the view is turned (and re-fitted) to show it upright.
        modifier = modifier.rotateFit(rotation).graphicsLayer { alpha = if (shown) 1f else 0f },
    )
}

/** The small speaker button on a slide with a feed clip: sound on/off for that slide (default muted). */
@Composable
fun MuteButton(muted: Boolean, onToggle: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(CircleShape).background(TokBg.copy(alpha = 0.6f)).clickable(onClickLabel = if (muted) "Sound on" else "Sound off", onClick = onToggle),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp,
            if (muted) "Sound off" else "Sound on", tint = TokInk, modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * The on-screen width/height of a clip: ExoPlayer's video size (with its pixel aspect, and any rotation the renderer
 * left to the view, i.e. the container's own rotation metadata), then the Moment's clockwise [displayRotation] on top.
 * null while the size is unknown.
 */
fun orientedAspect(width: Int, height: Int, unappliedRotationDegrees: Int, pixelWidthHeightRatio: Float, displayRotation: Int): Float? {
    if (width <= 0 || height <= 0) return null
    var w = width * (if (pixelWidthHeightRatio > 0f) pixelWidthHeightRatio else 1f)
    var h = height.toFloat()
    if (unappliedRotationDegrees % 180 != 0) { val t = w; w = h; h = t }
    if (displayRotation % 180 != 0) { val t = w; w = h; h = t }
    return w / h
}

/**
 * One clip with controls; its own player, released when it leaves, paused when the app goes to the background. The
 * player box takes the clip's oriented aspect ([orientedAspect]) fitted into [modifier]'s space, at most 80% of the
 * screen high, never cropped. The controls always sit upright, whatever the displayRotation.
 */
@Composable
internal fun ClipPlayer(c: SharedClip, rotation: Int = 0, modifier: Modifier = Modifier.fillMaxWidth()) {
    val ctx = LocalContext.current
    // null while loading, Uri.EMPTY when the URL could not be had (offline, rules).
    val url by produceState<Uri?>(null, c.path) { value = ClipUrls.get(c.path) ?: Uri.EMPTY }
    val u = url
    if (u == null || u == Uri.EMPTY) {
        Box(modifier.heightIn(min = 56.dp), contentAlignment = Alignment.Center) {
            if (u == Uri.EMPTY) Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Glyph.Warning, null, Modifier.size(16.dp), tint = Ink2); Spacer(Modifier.width(6.dp))
                Text("Couldn't load this clip.", color = Ink2, fontSize = 13.sp)
            }
            else CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
        return
    }
    val player = remember(u) {
        ClipCache.player(ctx).apply { setMediaItem(ClipCache.item(u, c.path)); prepare(); playWhenReady = true }
    }
    var size by remember(player) { mutableStateOf(player.videoSize) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player, lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) player.pause() }
        val sizes = object : Player.Listener { override fun onVideoSizeChanged(videoSize: VideoSize) { size = videoSize } }
        lifecycle.addObserver(obs)
        player.addListener(sizes)
        onDispose { player.removeListener(sizes); lifecycle.removeObserver(obs); player.release() }
    }
    @Suppress("DEPRECATION")
    val aspect = orientedAspect(size.width, size.height, size.unappliedRotationDegrees, size.pixelWidthHeightRatio, rotation)
        ?: if (rotation % 180 == 0) 16f / 9f else 9f / 16f
    val screenH = LocalConfiguration.current.screenHeightDp.dp
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val cap = screenH * 0.8f
        val maxH = if (constraints.hasBoundedHeight) minOf(maxHeight, cap) else cap
        val w = minOf(maxWidth, maxH * aspect)
        val box = Modifier.size(w, w / aspect).clip(RoundedCornerShape(16.dp)).background(MediaBg)
        if (rotation % 360 == 0) {
            AndroidView(
                factory = { inflatePlayerView(it, controls = true).also { v -> v.player = player } },
                onRelease = { it.player = null },
                modifier = box,
            )
            return@BoxWithConstraints
        }
        // displayRotation: only the picture is turned (a control-less view, re-fitted to the box, which already has the
        // turned aspect); the controls sit upright on top in a surface-less PlayerView on the same player.
        Box(box) {
            AndroidView(
                factory = { inflatePlayerView(it, controls = false).also { v -> v.player = player } },
                onRelease = { it.player = null },
                modifier = Modifier.matchParentSize().rotateFit(rotation),
            )
            AndroidView(
                factory = {
                    inflatePlayerView(it, controls = false, layout = R.layout.video_controls).also { v ->
                        v.useController = true
                        v.player = player
                    }
                },
                onRelease = { it.player = null },
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

package com.mattricks.verified.record

import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Looper
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.mattricks.verified.ai.Ai
import com.mattricks.verified.chain.Chain
import com.mattricks.verified.chain.ChainLink
import com.mattricks.verified.chain.Check
import com.mattricks.verified.chain.Event
import com.mattricks.verified.chain.Payload
import com.mattricks.verified.data.LatLng
import com.mattricks.verified.data.Store
import com.mattricks.verified.data.Summary
import com.mattricks.verified.devices.Devices
import com.mattricks.verified.judge.Judging
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

data class RecUi(
    val phase: Phase = Phase.Idle,
    val momentId: String? = null,
    val intention: String = "",
    val category: String = "fishing",
    val startedAt: Long = 0,
    val elapsedMs: Long = 0,
    val distanceM: Double = 0.0,
    val lastFix: LatLng? = null,
    val track: List<LatLng> = emptyList(),
    val accuracyM: Double? = null,
    val gpsCount: Int = 0,
    val sparkline: List<Float> = emptyList(),
    val frameCount: Int = 0,
    val checking: Boolean = false,
    val coach: Check? = null,
    val chunksTotal: Int = 0,
    val chunksPending: Int = 0,
    val heartRate: Int? = null,
    val videoCount: Int = 0,
) {
    enum class Phase { Idle, Recording, Finished }
}

/**
 * Records a Moment: GPS ~1 Hz, motion 10 Hz, events and proof frames, closed into SHA-256 chained chunks every
 * 5 s or when a proof frame is taken. Chunks are written straight to Firestore (offline cache first).
 */
class RecordViewModel(app: Application) : AndroidViewModel(app) {
    companion object {
        private val _recording = MutableStateFlow<String?>(null)
        /** Id of the Moment being recorded on this device right now (until it is submitted); it can't be deleted. */
        val recording: StateFlow<String?> = _recording
    }

    private val _ui = MutableStateFlow(RecUi())
    val ui: StateFlow<RecUi> = _ui

    private val lock = Mutex()
    private val sensorManager = app.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val fused = LocationServices.getFusedLocationProviderClient(app)

    // chain state (guarded by lock)
    private var momentId = ""
    private var seq = 0
    private var prevHash = ""
    private var t0 = 0L
    private val gpsBuf = ArrayList<DoubleArray>()
    private val motionBuf = ArrayList<DoubleArray>()
    private val events = ArrayList<Event>()
    private var holdForFrame = false

    // session totals
    private val track = ArrayList<LatLng>()
    private var motionCount = 0
    private val frameSeqs = ArrayList<Pair<Int, Boolean>>() // seq, ok
    private val checks = ArrayList<Check>()

    // latest raw sensor values
    @Volatile private var accel: FloatArray? = null
    @Volatile private var gyro: FloatArray? = null

    private var jobs = ArrayList<Job>()

    fun setIntention(s: String) = _ui.update { it.copy(intention = s.take(200)) }
    fun setCategory(s: String) = _ui.update { it.copy(category = s) }

    fun start() {
        val s = _ui.value
        if (s.phase == RecUi.Phase.Recording || s.intention.isBlank()) return
        val now = System.currentTimeMillis()
        momentId = UUID.randomUUID().toString().lowercase()
        seq = 0; prevHash = Chain.genesis(momentId); t0 = now; holdForFrame = false
        gpsBuf.clear(); motionBuf.clear(); events.clear(); track.clear(); frameSeqs.clear(); checks.clear(); motionCount = 0
        events += Event(now, "start")
        _recording.value = momentId
        Store.createMoment(momentId, s.intention.trim(), s.category, now)
        _ui.update {
            it.copy(phase = RecUi.Phase.Recording, momentId = momentId, startedAt = now, elapsedMs = 0, distanceM = 0.0,
                lastFix = null, track = emptyList(), accuracyM = null, gpsCount = 0, sparkline = emptyList(), frameCount = 0, coach = null,
                checking = false, chunksTotal = 0, chunksPending = 0)
        }
        startSensors()
        jobs += viewModelScope.launch { sampleMotion() }
        jobs += viewModelScope.launch { chunkTicker() }
        jobs += viewModelScope.launch { sampleHeartRate() }
        Devices.reconnect()
        jobs += viewModelScope.launch {
            Store.chunkSync(momentId).collect { (total, pending) -> _ui.update { it.copy(chunksTotal = total, chunksPending = pending) } }
        }
    }

    private suspend fun sampleMotion() {
        while (viewModelScope.isActive) {
            delay(100)
            val a = accel ?: continue
            val g = gyro ?: floatArrayOf(0f, 0f, 0f)
            val t = System.currentTimeMillis()
            val row = doubleArrayOf(t.toDouble(),
                Geo.round(a[0].toDouble(), 3), Geo.round(a[1].toDouble(), 3), Geo.round(a[2].toDouble(), 3),
                Geo.round(g[0].toDouble(), 4), Geo.round(g[1].toDouble(), 4), Geo.round(g[2].toDouble(), 4))
            lock.withLock { motionBuf += row; motionCount++ }
            val mag = Math.sqrt((a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).toDouble()).toFloat()
            _ui.update { it.copy(sparkline = (it.sparkline + mag).takeLast(80), elapsedMs = t - it.startedAt) }
        }
    }

    /** 1 Hz BPM from a connected Bluetooth device (Settings → Devices) → `hr` events. */
    private suspend fun sampleHeartRate() {
        while (viewModelScope.isActive) {
            delay(1_000)
            val bpm = Devices.state.value.bpm
            if (bpm != null) lock.withLock { events += Event(System.currentTimeMillis(), "hr", mapOf("bpm" to bpm)) }
            if (bpm != _ui.value.heartRate) _ui.update { it.copy(heartRate = bpm) }
        }
    }

    private suspend fun chunkTicker() {
        while (viewModelScope.isActive) {
            delay(5_000)
            lock.withLock { if (!holdForFrame) closeChunk(System.currentTimeMillis(), null, null, null) }
        }
    }

    /** Must hold lock. */
    private fun closeChunk(t1: Long, frame: Store.FrameData?, frameSha: String?, check: Check?) {
        val payload = Payload.build(gpsBuf, motionBuf, events, frameSha, check)
        val hash = Chain.chunkHash(seq, t0, t1, prevHash, payload)
        Store.writeChunk(momentId, ChainLink(seq, t0, t1, prevHash, payload, hash), frame)
        if (frame != null) frameSeqs += seq to (check?.ok != false)
        prevHash = hash; seq++; t0 = t1
        gpsBuf.clear(); motionBuf.clear(); events.clear()
    }

    /** Proof shot: closes the running chunk, coaches on the frame, then closes the frame's own chunk. */
    fun proofShot(bitmap: Bitmap, jpegB64: String, extra: Map<String, Any?>? = null): Boolean {
        if (_ui.value.phase != RecUi.Phase.Recording || _ui.value.checking) return false
        val t = System.currentTimeMillis()
        _ui.update { it.copy(checking = true) }
        viewModelScope.launch {
            lock.withLock {
                closeChunk(t, null, null, null) // one frame max per chunk; frame chunk starts at the shot
                holdForFrame = true
                events += Event(t, "frame")
                if (extra != null) events += Event(t, "video", extra)
            }
            val check = Ai.liveCheck(bitmap, _ui.value.intention)
            val now = System.currentTimeMillis()
            lock.withLock {
                events += if (check.ok) Event(now, "check", mapOf("ok" to true, "mode" to check.mode))
                else Event(now, "retake", mapOf("reason" to check.reason, "mode" to check.mode))
                checks += check
                closeChunk(now, Store.FrameData(jpegB64, bitmap.width, bitmap.height, t), Chain.sha256Hex(jpegB64), check)
                holdForFrame = false
            }
            _ui.update { it.copy(checking = false, coach = check, frameCount = it.frameCount + 1) }
        }
        return true
    }

    fun videoStarted() {
        if (_ui.value.phase != RecUi.Phase.Recording) return
        val t = System.currentTimeMillis()
        viewModelScope.launch { lock.withLock { events += Event(t, "video_start") } }
    }

    /**
     * A finished video clip. The clip stays on the phone (Movies/Verified); the chain commits to its SHA-256, and its
     * middle frame goes through the normal proof-frame path (coach + judge) as the poster.
     */
    fun videoClip(clip: VideoClip, poster: Bitmap?, posterB64: String?) {
        if (_ui.value.phase != RecUi.Phase.Recording) return
        val extra = mapOf("sha256" to clip.sha256, "bytes" to clip.bytes, "durationMs" to clip.durationMs, "startedAt" to clip.startedAt, "name" to clip.name)
        val asFrame = poster != null && posterB64 != null && proofShot(poster, posterB64, extra)
        if (!asFrame) {
            val t = System.currentTimeMillis()
            viewModelScope.launch { lock.withLock { events += Event(t, "video", extra) } }
        }
        _ui.update { it.copy(videoCount = it.videoCount + 1) }
    }

    fun finish() {
        if (_ui.value.phase != RecUi.Phase.Recording || _ui.value.checking) return
        stopSensors()
        jobs.forEach { it.cancel() }; jobs.clear()
        viewModelScope.launch {
            val endedAt = System.currentTimeMillis()
            val id = momentId
            val summary: Summary
            val headHash: String
            val count: Int
            lock.withLock {
                events += Event(endedAt, "stop")
                closeChunk(endedAt, null, null, null)
                headHash = prevHash; count = seq
                val hero = frameSeqs.lastOrNull { it.second }?.first ?: frameSeqs.lastOrNull()?.first
                summary = Summary(
                    durationMs = endedAt - _ui.value.startedAt,
                    distanceM = Geo.round(Geo.pathLength(track), 1),
                    frameCount = frameSeqs.size, gpsCount = track.size, motionCount = motionCount,
                    start = track.firstOrNull(), end = track.lastOrNull(), heroFrameSeq = hero,
                )
            }
            val mode = when {
                checks.any { it.mode == "on_device" } -> "on_device"
                checks.any { it.mode == "cloud" } -> "cloud"
                else -> "none"
            }
            val onDevice = mapOf("mode" to mode, "checks" to checks.count { it.mode != "none" }, "retakes" to checks.count { !it.ok })
            Store.submit(id, endedAt, count, headHash, summary, onDevice)
            _recording.compareAndSet(id, null)
            _ui.update { it.copy(phase = RecUi.Phase.Finished, elapsedMs = summary.durationMs) }
            // Keep the sync badge live after finishing so the user sees the queue drain.
            jobs += viewModelScope.launch {
                Store.chunkSync(id).collect { (total, pending) -> _ui.update { it.copy(chunksTotal = total, chunksPending = pending) } }
            }
            Judging.kick()
        }
    }

    fun reset() {
        if (_ui.value.phase != RecUi.Phase.Recording) _recording.value = null
        jobs.forEach { it.cancel() }; jobs.clear()
        _ui.update { RecUi(intention = it.intention, category = it.category) }
    }

    // ---------- sensors ----------

    private val sensorListener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            when (e.sensor.type) {
                Sensor.TYPE_ACCELEROMETER -> accel = e.values.copyOf(3)
                Sensor.TYPE_GYROSCOPE -> gyro = e.values.copyOf(3)
            }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(r: LocationResult) {
            for (loc in r.locations) {
                val t = System.currentTimeMillis()
                val p = LatLng(Geo.round(loc.latitude, 6), Geo.round(loc.longitude, 6))
                val row = doubleArrayOf(t.toDouble(), p.lat, p.lng, Geo.round(loc.accuracy.toDouble(), 1),
                    if (loc.hasAltitude()) Geo.round(loc.altitude, 1) else Double.NaN,
                    if (loc.hasSpeed()) Geo.round(loc.speed.toDouble(), 2) else Double.NaN)
                viewModelScope.launch {
                    val snapshot = lock.withLock { gpsBuf += row; track += p; track.toList() }
                    val d = Geo.pathLength(snapshot)
                    _ui.update { it.copy(lastFix = p, track = snapshot, accuracyM = loc.accuracy.toDouble(), gpsCount = snapshot.size, distanceM = d) }
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun startSensors() {
        sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sensorManager.registerListener(sensorListener, it, 50_000) }
        sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { sensorManager.registerListener(sensorListener, it, 50_000) }
        try {
            val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000).setMinUpdateIntervalMillis(1_000).build()
            fused.requestLocationUpdates(req, locationCallback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            Log.w("VerifiedRec", "no location permission", e)
        }
    }

    private fun stopSensors() {
        sensorManager.unregisterListener(sensorListener)
        fused.removeLocationUpdates(locationCallback)
        accel = null; gyro = null
    }

    override fun onCleared() { stopSensors(); _recording.compareAndSet(momentId, null); super.onCleared() }
}

data class VideoClip(val name: String, val sha256: String, val bytes: Long, val durationMs: Long, val startedAt: Long)

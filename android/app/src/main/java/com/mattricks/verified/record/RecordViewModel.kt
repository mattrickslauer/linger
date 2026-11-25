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
import com.mattricks.verified.data.Claims
import com.mattricks.verified.data.Intention
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
import com.mattricks.verified.voice.Voice
import com.mattricks.verified.witness.WitnessNotifier
import com.mattricks.verified.witness.WitnessPacing
import org.json.JSONArray
import org.json.JSONObject

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
    /** Recorded signed out: kept only on this phone until claimed at sign-in (v3.1). */
    val guest: Boolean = false,
    /** v3.2 structured intention from the interview; null = typed v1 `{text, category}`. */
    val structured: Intention? = null,
    /** v3.4: the open witness request (one at a time), whether the next proof shot answers it, and the tally. */
    val witness: WitnessAsk? = null,
    val witnessArmed: Boolean = false,
    val witnessListening: Boolean = false,
    val witnessAsked: Int = 0,
    val witnessAnswered: Int = 0,
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
    private var guest = false

    // session totals
    private val track = ArrayList<LatLng>()
    private var motionCount = 0
    private val frameSeqs = ArrayList<Pair<Int, Boolean>>() // seq, ok
    private val checks = ArrayList<Check>()

    // latest raw sensor values
    @Volatile private var accel: FloatArray? = null
    @Volatile private var gyro: FloatArray? = null

    private var jobs = ArrayList<Job>()

    // witness (v3.4)
    private var witnessN = 0
    private var lastWitnessAt = 0L
    private var witnessAnswered = 0
    private var witnessSkipped = 0
    private val witnessBy = HashSet<String>()
    private val witnessLog = ArrayList<JSONObject>()
    private val recentFrames = ArrayDeque<Pair<Long, Bitmap>>()

    fun setIntention(s: String) = _ui.update { it.copy(intention = s.take(200)) }
    fun setCategory(s: String) = _ui.update { it.copy(category = s) }

    /** From the interview card: the structured intention (its text drives the live coach). */
    fun useStructured(i: Intention?, transcript: List<String> = emptyList()) {
        this.transcript = transcript
        _ui.update { it.copy(structured = i, intention = i?.text ?: it.intention, category = i?.category ?: it.category) }
    }
    private var transcript: List<String> = emptyList()

    fun start() {
        val s = _ui.value
        if (s.phase == RecUi.Phase.Recording || s.intention.isBlank()) return
        val now = System.currentTimeMillis()
        momentId = UUID.randomUUID().toString().lowercase()
        seq = 0; prevHash = Chain.genesis(momentId); t0 = now; holdForFrame = false
        gpsBuf.clear(); motionBuf.clear(); events.clear(); track.clear(); frameSeqs.clear(); checks.clear(); motionCount = 0
        witnessN = 0; lastWitnessAt = 0; witnessAnswered = 0; witnessSkipped = 0; witnessBy.clear(); witnessLog.clear(); recentFrames.clear()
        events += Event(now, "start")
        _recording.value = momentId
        val intention = s.structured?.copy(text = s.intention.trim(), category = s.category)?.toMap(now)
            ?: mapOf("text" to s.intention.trim().take(200), "category" to s.category)
        guest = Store.createMoment(momentId, intention, now, if (transcript.isEmpty()) emptyMap() else mapOf("transcript" to transcript))
        _ui.update {
            it.copy(phase = RecUi.Phase.Recording, momentId = momentId, startedAt = now, elapsedMs = 0, distanceM = 0.0,
                lastFix = null, track = emptyList(), accuracyM = null, gpsCount = 0, sparkline = emptyList(), frameCount = 0, coach = null,
                checking = false, chunksTotal = 0, chunksPending = 0, guest = guest, videoCount = 0,
                witness = null, witnessArmed = false, witnessListening = false, witnessAsked = 0, witnessAnswered = 0)
        }
        jobs += viewModelScope.launch { witnessLoop() }
        startSensors()
        jobs += viewModelScope.launch { sampleMotion() }
        jobs += viewModelScope.launch { chunkTicker() }
        jobs += viewModelScope.launch { sampleHeartRate() }
        Devices.reconnect()
        if (!guest) jobs += viewModelScope.launch {
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
        Store.writeChunk(momentId, ChainLink(seq, t0, t1, prevHash, payload, hash), frame, guest)
        if (frame != null) frameSeqs += seq to (check?.ok != false)
        prevHash = hash; seq++; t0 = t1
        if (guest) { val n = seq; _ui.update { it.copy(chunksTotal = n) } }
        gpsBuf.clear(); motionBuf.clear(); events.clear()
    }

    /**
     * Proof shot: closes the running chunk, coaches on the frame, then closes the frame's own chunk.
     * When a "show" witness request is armed, the frame event carries its `wid` and a `witness_answer` (via frame)
     * goes into the same chunk (v3.4); the coach sees "<intention> — witness asked: <ask>".
     */
    fun proofShot(bitmap: Bitmap, jpegB64: String, extra: Map<String, Any?>? = null): Boolean {
        if (_ui.value.phase != RecUi.Phase.Recording || _ui.value.checking) return false
        val t = System.currentTimeMillis()
        val answering = _ui.value.witness?.takeIf { _ui.value.witnessArmed && extra == null }
        _ui.update { it.copy(checking = true) }
        viewModelScope.launch {
            lock.withLock {
                closeChunk(t, null, null, null) // one frame max per chunk; frame chunk starts at the shot
                holdForFrame = true
                if (answering != null) {
                    events += Event(t, "frame", linkedMapOf("wid" to answering.wid))
                    events += Event(t, "witness_answer", linkedMapOf("wid" to answering.wid, "via" to "frame"))
                } else events += Event(t, "frame")
                if (extra != null) events += Event(t, "video", extra)
            }
            if (answering != null) closeWitness(answering, "frame", null)
            val coachIntention = _ui.value.intention + (answering?.let { " — witness asked: ${it.ask}" } ?: "")
            val check = Ai.liveCheck(bitmap, coachIntention)
            val now = System.currentTimeMillis()
            lock.withLock {
                events += if (check.ok) Event(now, "check", mapOf("ok" to true, "mode" to check.mode))
                else Event(now, "retake", mapOf("reason" to check.reason, "mode" to check.mode))
                checks += check
                closeChunk(now, Store.FrameData(jpegB64, bitmap.width, bitmap.height, t), Chain.sha256Hex(jpegB64), check)
                holdForFrame = false
                recentFrames.addLast((t - _ui.value.startedAt) / 1000 to bitmap)
                while (recentFrames.size > 3) recentFrames.removeFirst()
            }
            _ui.update { it.copy(checking = false, coach = check, frameCount = it.frameCount + 1) }
        }
        return true
    }

    // ---------- witness agent (v3.4) ----------

    /**
     * Pacing: first request ≥ 30 s after start, one open at a time, ≥ 60 s between requests, ≤ 6 per Moment,
     * shown only when ask != "" and gain ≥ 0.1. Draft `witnessDraft` PREFER_ON_DEVICE; online, `witnessRefine`
     * ONLY_IN_CLOUD with the latest frames (4 s budget, else the draft stands).
     */
    private suspend fun witnessLoop() {
        while (viewModelScope.isActive && _ui.value.phase == RecUi.Phase.Recording) {
            delay(5_000)
            val s = _ui.value
            val now = System.currentTimeMillis()
            if (s.checking || !WitnessPacing.canAsk(now, s.startedAt, lastWitnessAt, witnessN, open = s.witness != null)) continue
            lastWitnessAt = now // also paces retries after a failed draft
            val vars = mapOf(
                "intention" to JSONObject(s.structured?.toMap(s.startedAt) ?: mapOf("text" to s.intention, "category" to s.category)).toString(),
                "session" to sessionJson(s).toString(),
                "asked" to JSONArray(witnessLog).toString(),
            )
            val draft = runCatching { Ai.preferOnDevice("witnessDraft", vars, timeoutMs = 15_000) }
                .onFailure { Log.i("VerifiedWitness", "draft: ${it.message}") }.getOrNull() ?: continue
            var j = draft.json
            var by = draft.mode
            if (Judging.online() && draft.json.optString("ask").isNotBlank()) {
                val frames = lock.withLock { recentFrames.toList() }
                runCatching {
                    Ai.onlyInCloud(
                        "witnessRefine",
                        vars + mapOf("draft" to draft.json.toString(), "frameOffsets" to frames.joinToString(", ") { "${it.first}s" }.ifEmpty { "none" }),
                        images = frames.map { it.second }, timeoutMs = 4_000,
                    )
                }.getOrNull()?.let { j = it.json; by = "cloud" }
            }
            val ask = j.optString("ask").trim().take(90)
            val gain = j.optDouble("gain", 0.0).let { if (it.isNaN()) 0.0 else it }
            if (!WitnessPacing.worthShowing(ask, gain) || _ui.value.phase != RecUi.Phase.Recording || _ui.value.witness != null) continue
            witnessN++
            val req = WitnessAsk("w$witnessN", ask, j.optString("kind").takeIf { it in setOf("show", "tell", "do") } ?: "show", j.optString("why").take(90), by, gain)
            val t = System.currentTimeMillis()
            lock.withLock { events += Event(t, "witness", linkedMapOf("wid" to req.wid, "ask" to req.ask, "kind" to req.kind, "by" to req.by)) }
            lastWitnessAt = t
            witnessBy += by
            witnessLog += JSONObject().put("wid", req.wid).put("ask", req.ask).put("kind", req.kind).put("outcome", "open")
            _ui.update { it.copy(witness = req, witnessArmed = false, witnessAsked = witnessN) }
            WitnessNotifier.notifyIfBackground(getApplication(), req.ask, req.why)
            Voice.speak(req.ask)
        }
    }

    private fun sessionJson(s: RecUi) = JSONObject()
        .put("elapsedS", (System.currentTimeMillis() - s.startedAt) / 1000)
        .put("distanceM", Geo.round(s.distanceM, 0))
        .put("frames", s.frameCount)
        .put("frameLabels", JSONArray(checks.map { it.label }.filter { it.isNotBlank() }.takeLast(8)))
        .put("videoClips", s.videoCount)
        .put("gps", s.gpsCount > 0)
        .put("motion", motionCount > 0)
        .put("heartRate", s.heartRate != null)

    /** "Show": the next proof shot answers the open request. */
    fun armWitnessShot() { if (_ui.value.witness?.kind == "show") _ui.update { it.copy(witnessArmed = true) } }

    /** "Tell": a spoken answer (platform STT); null = nothing heard (the toast then offers typing). */
    fun answerWitnessByVoice() {
        val w = _ui.value.witness ?: return
        viewModelScope.launch {
            Voice.stopSpeaking()
            _ui.update { it.copy(witnessListening = true) }
            val heard = Voice.listen()
            _ui.update { it.copy(witnessListening = false) }
            if (!heard.isNullOrBlank()) answerWitnessText(heard, "voice", w)
        }
    }

    fun answerWitnessText(text: String, via: String = "text", w: WitnessAsk? = _ui.value.witness) {
        val req = w ?: return
        if (_ui.value.witness?.wid != req.wid || text.isBlank()) return
        val t = System.currentTimeMillis()
        viewModelScope.launch {
            lock.withLock { events += Event(t, "witness_answer", linkedMapOf("wid" to req.wid, "via" to via, "text" to text.trim().take(200))) }
            closeWitness(req, via, text.trim().take(200))
        }
    }

    /** "Do": the person did it; the sensors carry the evidence. */
    fun witnessDone() {
        val req = _ui.value.witness ?: return
        val t = System.currentTimeMillis()
        viewModelScope.launch {
            lock.withLock { events += Event(t, "witness_answer", linkedMapOf("wid" to req.wid, "via" to "done")) }
            closeWitness(req, "done", null)
        }
    }

    fun skipWitness() {
        val req = _ui.value.witness ?: return
        val t = System.currentTimeMillis()
        viewModelScope.launch {
            lock.withLock { events += Event(t, "witness_skip", linkedMapOf("wid" to req.wid)) }
            closeWitness(req, "skipped", null)
        }
    }

    private fun closeWitness(req: WitnessAsk, outcome: String, answer: String?) {
        if (_ui.value.witness?.wid != req.wid) return
        if (outcome == "skipped") witnessSkipped++ else witnessAnswered++
        witnessLog.lastOrNull { it.optString("wid") == req.wid }?.apply { put("outcome", outcome); answer?.let { put("answer", it) } }
        WitnessNotifier.cancel(getApplication())
        val answered = witnessAnswered
        _ui.update { it.copy(witness = null, witnessArmed = false, witnessListening = false, witnessAnswered = answered) }
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
        Voice.stopSpeaking()
        stopSensors()
        jobs.forEach { it.cancel() }; jobs.clear()
        viewModelScope.launch {
            val endedAt = System.currentTimeMillis()
            val id = momentId
            val summary: Summary
            val headHash: String
            val count: Int
            lock.withLock {
                _ui.value.witness?.let { w ->
                    events += Event(endedAt, "witness_skip", linkedMapOf("wid" to w.wid, "reason" to "stopped"))
                    witnessSkipped++
                }
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
            Store.submit(id, endedAt, count, headHash, summary, onDevice, witnessSummary(), guest)
            _recording.compareAndSet(id, null)
            WitnessNotifier.cancel(getApplication())
            _ui.update { it.copy(phase = RecUi.Phase.Finished, elapsedMs = summary.durationMs, witness = null, witnessArmed = false) }
            if (guest) {
                Claims.offerAfterFinish() // signed in while this guest Moment was recording: offer it now
                return@launch
            }
            // Keep the sync badge live after finishing so the user sees the queue drain.
            jobs += viewModelScope.launch {
                Store.chunkSync(id).collect { (total, pending) -> _ui.update { it.copy(chunksTotal = total, chunksPending = pending) } }
            }
            Judging.kick()
        }
    }

    /** moments/{id}.witness at submit (v3.4); filled in by the witness agent. */
    private fun witnessSummary(): Map<String, Any> = mapOf(
        "asked" to witnessN, "answered" to witnessAnswered, "skipped" to witnessSkipped,
        "mode" to when { witnessN == 0 -> "none"; witnessBy.size > 1 -> "mixed"; else -> witnessBy.firstOrNull() ?: "none" },
    )

    fun reset() {
        if (_ui.value.phase != RecUi.Phase.Recording) _recording.value = null
        jobs.forEach { it.cancel() }; jobs.clear()
        transcript = emptyList()
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

data class WitnessAsk(val wid: String, val ask: String, val kind: String, val why: String, val by: String, val gain: Double)

data class VideoClip(val name: String, val sha256: String, val bytes: Long, val durationMs: Long, val startedAt: Long)

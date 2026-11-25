package com.mattricks.verified.record

import android.annotation.SuppressLint
import android.app.Application
import android.location.Geocoder
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.mattricks.verified.ai.Ai
import com.mattricks.verified.data.CATEGORIES
import com.mattricks.verified.data.Intention
import com.mattricks.verified.data.IntentionPreview
import com.mattricks.verified.data.Place
import com.mattricks.verified.data.Quantity
import com.mattricks.verified.data.V3Math
import com.mattricks.verified.judge.Judging
import com.mattricks.verified.voice.Voice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** One line of the interview. [mode] = where the AI turn ran ("on_device" | "cloud"), null for the person. */
data class Turn(val me: Boolean, val text: String, val mode: String? = null)

data class InterviewUi(
    val phase: Phase = Phase.Idle,
    val turns: List<Turn> = emptyList(),
    val intention: Intention? = null,
    val previewBusy: Boolean = false,
    val note: String? = null,
) {
    enum class Phase { Idle, Listening, Thinking, Speaking, Structuring, Ready }
}

/**
 * Voice interview → structured intention (docs/ARCHITECTURE.md v3.2), all through Firebase AI Logic:
 *   turns: `interviewTurn` PREFER_ON_DEVICE (Gemini Nano when present) · final: `structureIntention` ONLY_IN_CLOUD
 *   (offline: the last on-device draft) · preview: `barPreview` PREFER_ON_DEVICE → bar = round2(0.5 + 0.45·d).
 * At most 3 questions; "start"/"go" ends it. Typing works everywhere voice does.
 */
class InterviewViewModel(app: Application) : AndroidViewModel(app) {
    private val _ui = MutableStateFlow(InterviewUi())
    val ui: StateFlow<InterviewUi> = _ui

    private var job: Job? = null
    private var draft = JSONObject()
    private var context: JSONObject? = null
    private var lat: Double? = null
    private var lng: Double? = null
    private var geoPlace: Place? = null
    private var questions = 0
    private var lastWasVoice = false

    /** The transcript lines kept in the local journal only (never on the server). */
    fun transcript(): List<String> = _ui.value.turns.map { (if (it.me) "me: " else "ai: ") + it.text }

    fun reset() {
        job?.cancel(); Voice.stopSpeaking()
        draft = JSONObject(); questions = 0
        _ui.value = InterviewUi()
    }

    /** Mic tapped (permissions already asked). */
    fun talk() {
        if (_ui.value.phase !in setOf(InterviewUi.Phase.Idle)) {
            // Tap while listening/speaking = stop and wait.
            job?.cancel(); Voice.stopSpeaking(); _ui.update { it.copy(phase = InterviewUi.Phase.Idle) }
            return
        }
        job = viewModelScope.launch {
            ensureContext()
            if (_ui.value.turns.isEmpty()) say(OPENER, null)
            listenLoop()
        }
    }

    fun typed(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        job?.cancel(); Voice.stopSpeaking()
        lastWasVoice = false
        job = viewModelScope.launch {
            ensureContext()
            if (_ui.value.turns.isEmpty()) _ui.update { it.copy(turns = it.turns + Turn(false, OPENER, null)) }
            if (answer(t) && lastWasVoice) listenLoop()
        }
    }

    /** "Start" without answering more: structure what we have. */
    fun finishNow() {
        if (_ui.value.turns.none { it.me }) return
        job?.cancel(); Voice.stopSpeaking()
        job = viewModelScope.launch { finalize() }
    }

    fun edit(f: (Intention) -> Intention) = _ui.update { s -> s.copy(intention = s.intention?.let(f)) }

    private suspend fun listenLoop() {
        while (true) {
            _ui.update { it.copy(phase = InterviewUi.Phase.Listening, note = null) }
            val heard = Voice.listen()
            if (heard.isNullOrBlank()) {
                _ui.update { it.copy(phase = InterviewUi.Phase.Idle, note = if (!Voice.canListen()) "No speech recognizer on this phone — type instead." else "Didn't catch that. Tap the mic or type.") }
                return
            }
            lastWasVoice = true
            if (!answer(heard)) return
        }
    }

    /** Adds the person's line and runs one turn. Returns true when another answer is wanted. */
    private suspend fun answer(text: String): Boolean {
        _ui.update { it.copy(turns = it.turns + Turn(true, text), note = null) }
        if (START_WORDS.matches(text.trim().lowercase())) { finalize(); return false }
        _ui.update { it.copy(phase = InterviewUi.Phase.Thinking) }
        val turn = runCatching {
            Ai.preferOnDevice("interviewTurn", mapOf("context" to ctxJson(), "draft" to draft.toString(), "transcript" to transcript().joinToString("\n")))
        }.onFailure { Log.w(TAG, "interviewTurn", it) }.getOrNull()
        if (turn == null) {
            // No on-device model and no signal: keep what was said as the intention.
            if (draft.optString("text").isBlank()) draft.put("text", _ui.value.turns.filter { it.me }.joinToString(". ") { it.text }.take(200))
            finalize(); return false
        }
        turn.json.optJSONObject("draft")?.let { draft = it }
        // That was the answer to the 3rd question: keep the updated draft, ask nothing more.
        if (questions >= MAX_QUESTIONS) { finalize(); return false }
        val done = turn.json.optBoolean("done", false)
        val sayText = turn.json.optString("say").take(160)
        if (!done) questions++
        say(sayText.ifBlank { if (done) "Got it." else "Anything else I should know?" }, turn.mode)
        if (done) { finalize(); return false }
        return true
    }

    private suspend fun say(text: String, mode: String?) {
        _ui.update { it.copy(turns = it.turns + Turn(false, text, mode), phase = InterviewUi.Phase.Speaking) }
        Voice.speak(text)
    }

    private suspend fun finalize() {
        _ui.update { it.copy(phase = InterviewUi.Phase.Structuring) }
        val turnModes = _ui.value.turns.mapNotNull { if (it.me) null else it.mode }.toSet()
        val cloud = if (Judging.online()) runCatching {
            Ai.onlyInCloud("structureIntention", mapOf("context" to ctxJson(), "transcript" to transcript().joinToString("\n"), "draft" to draft.toString()), timeoutMs = 20_000)
        }.onFailure { Log.w(TAG, "structureIntention", it) }.getOrNull() else null
        val final = cloud?.json ?: draft
        val modes = turnModes + (if (cloud != null) "cloud" else "on_device")
        val mode = when {
            modes.size > 1 -> "mixed"
            modes.contains("cloud") -> "cloud"
            else -> "on_device"
        }
        val intention = intentionFrom(final, mode)
        _ui.update { it.copy(intention = intention, phase = InterviewUi.Phase.Ready, previewBusy = true) }
        if (cloud == null && !Judging.online()) _ui.update { it.copy(note = "Offline: structured on this phone. The server sets the binding bar when you sync.") }
        preview()
    }

    /** Hybrid bar preview (never binding; the Cloud Function sets the real bar, v3.3). */
    fun preview() {
        val i = _ui.value.intention ?: return
        _ui.update { it.copy(previewBusy = true) }
        viewModelScope.launch {
            val p = runCatching {
                Ai.preferOnDevice("barPreview", mapOf("intention" to JSONObject(i.toMap(System.currentTimeMillis())).toString(), "context" to ctxJson()))
            }.onFailure { Log.w(TAG, "barPreview", it) }.getOrNull()
            val preview = p?.let {
                val d = V3Math.clamp01(it.json.optDouble("difficulty", 0.0))
                IntentionPreview(
                    V3Math.bar(d), d, it.mode, it.json.optString("rationale").take(160),
                    it.json.optJSONArray("factors")?.let { a -> (0 until a.length()).map { k -> a.optString(k) } }.orEmpty().take(4),
                )
            }
            _ui.update { s -> s.copy(intention = s.intention?.copy(preview = preview), previewBusy = false) }
        }
    }

    private fun intentionFrom(j: JSONObject, mode: String): Intention {
        fun strs(a: JSONArray?) = a?.let { (0 until it.length()).map { k -> it.optString(k).trim() } }.orEmpty().filter { it.isNotEmpty() }
        val quantities = j.optJSONArray("quantities")?.let { a ->
            (0 until a.length()).mapNotNull { k ->
                val q = a.optJSONObject(k) ?: return@mapNotNull null
                val v = q.optDouble("value", 0.0)
                if (q.optString("metric").isBlank() || v.isNaN() || v <= 0) null
                else Quantity(q.optString("metric"), v, q.optString("unit"), q.optString("measuredBy").takeIf { it in MEASURED_BY } ?: "claim")
            }
        }.orEmpty().take(5)
        val pj = j.optJSONObject("place")
        fun blankNull(s: String?) = s?.trim()?.takeIf { it.isNotEmpty() && it != "null" }
        val place = Place(
            blankNull(pj?.optString("name")) ?: geoPlace?.name, lat, lng,
            blankNull(pj?.optString("region")) ?: geoPlace?.region, blankNull(pj?.optString("country")) ?: geoPlace?.country,
        ).takeIf { it.name != null || it.lat != null || it.region != null || it.country != null }
        val goal = j.optString("goal").trim()
        val text = j.optString("text").trim().ifBlank { goal }.ifBlank { _ui.value.turns.firstOrNull { it.me }?.text.orEmpty() }
        return Intention(
            text = text.take(200),
            category = j.optString("category").takeIf { it in CATEGORIES } ?: "other",
            v = 3,
            activity = j.optString("activity").trim().take(40),
            goal = goal.take(120),
            quantities = quantities,
            place = place,
            expectedMinutes = j.optDouble("expectedMinutes", 0.0).takeIf { !it.isNaN() && it > 0 },
            conditions = strs(j.optJSONArray("conditions")).take(6),
            assumptions = strs(j.optJSONArray("assumptions")).take(6),
            interviewTurns = _ui.value.turns.count { it.me },
            interviewMode = mode,
        )
    }

    // ---------- context: GPS, reverse geocode, local time ----------

    private fun ctxJson(): String = (context ?: JSONObject().put("platform", "android")).toString()

    @SuppressLint("MissingPermission")
    private suspend fun ensureContext() {
        if (context != null) return
        val app = getApplication<Application>()
        val loc = runCatching {
            val fused = LocationServices.getFusedLocationProviderClient(app)
            withTimeoutOrNull(4_000) { fused.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null).await() }
                ?: fused.lastLocation.await()
        }.getOrNull()
        lat = loc?.latitude?.let { Geo.round(it, 6) }; lng = loc?.longitude?.let { Geo.round(it, 6) }
        if (loc != null) geoPlace = withContext(Dispatchers.IO) {
            withTimeoutOrNull(3_000) {
                runCatching {
                    @Suppress("DEPRECATION")
                    Geocoder(app, Locale.getDefault()).getFromLocation(loc.latitude, loc.longitude, 1)?.firstOrNull()?.let { a ->
                        Place(a.featureName?.takeIf { f -> f != a.subThoroughfare } ?: a.locality, null, null, a.adminArea, a.countryName)
                    }
                }.getOrNull()
            }
        }
        val now = Date()
        val cal = Calendar.getInstance()
        context = JSONObject()
            .put("lat", lat ?: JSONObject.NULL).put("lng", lng ?: JSONObject.NULL)
            .put("place", geoPlace?.label()?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
            .put("localTime", SimpleDateFormat("yyyy-MM-dd'T'HH:mm EEE", Locale.US).format(now))
            .put("month", cal.get(Calendar.MONTH) + 1)
            .put("hemisphere", if ((lat ?: 1.0) < 0) "S" else "N")
            .put("platform", "android")
    }

    override fun onCleared() { Voice.stopSpeaking(); super.onCleared() }

    companion object {
        private const val TAG = "VerifiedInterview"
        const val OPENER = "What are you about to do?"
        private const val MAX_QUESTIONS = 3
        private val START_WORDS = Regex("^(ok(ay)?[, ]*)?(start|go|let'?s go|start it|begin)[.!]*$")
        private val MEASURED_BY = setOf("scale", "ruler", "photo", "count", "gps", "motion", "claim")
    }
}

package com.mattricks.verified.ai

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.google.firebase.remoteconfig.remoteConfig
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.chain.Check
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/** Every AI call in the app goes through Firebase AI Logic (hybrid for live checks, cloud for judge/skeptic/scorer). */
@OptIn(PublicPreviewAPI::class)
object Ai {
    private const val TAG = "VerifiedAi"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Human readable on-device model state, e.g. "available", "unavailable", "downloading 40%". */
    private val _onDeviceState = MutableStateFlow("checking")
    val onDeviceState: StateFlow<String> = _onDeviceState

    private var prompts: JSONObject? = null

    fun cloudModel(): String = runCatching { Firebase.remoteConfig.getString("cloud_model") }
        .getOrNull()?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_CLOUD_MODEL

    fun warmUp(ctx: Context) {
        prompts = runCatching { JSONObject(ctx.assets.open("prompts.json").bufferedReader().readText()) }
            .onFailure { Log.e(TAG, "prompts.json missing from assets", it) }.getOrNull()
        scope.launch {
            try {
                // OnDeviceExtension (firebase-ai 18.x) replaces the deprecated FirebaseAIOnDevice helpers.
                val ext = liveModel.onDeviceExtension
                if (ext == null) {
                    _onDeviceState.value = "unavailable"
                } else when (ext.checkStatus()) {
                    OnDeviceModelStatus.AVAILABLE -> {
                        _onDeviceState.value = "available"
                        runCatching { ext.warmUp() }
                    }
                    OnDeviceModelStatus.DOWNLOADING -> _onDeviceState.value = "downloading"
                    OnDeviceModelStatus.DOWNLOADABLE -> {
                        _onDeviceState.value = "downloading"
                        // The SDK never downloads on demand: start it early (AICore manages the model).
                        ext.download().collect { s ->
                            _onDeviceState.value = when (s) {
                                is DownloadStatus.DownloadStarted -> "downloading"
                                is DownloadStatus.DownloadInProgress -> "downloading"
                                is DownloadStatus.DownloadCompleted -> "available"
                                is DownloadStatus.DownloadFailed -> "unavailable"
                                else -> _onDeviceState.value
                            }
                        }
                    }
                    else -> _onDeviceState.value = "unavailable"
                }
            } catch (t: Throwable) {
                Log.w(TAG, "on-device status check failed", t)
                _onDeviceState.value = "unavailable"
            }
            Log.i(TAG, "on-device model: ${_onDeviceState.value}")
        }
    }

    private fun prompt(key: String, field: String): String =
        prompts?.optJSONObject(key)?.optString(field).orEmpty()

    // ---------- live coach (PREFER_ON_DEVICE, image + text) ----------

    private val liveModel by lazy {
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = cloudModel(),
            onDeviceConfig = OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE, maxOutputTokens = 160),
        )
    }

    /**
     * Checks one proof frame against the intention. Can only say "keep going" or "retake: ...".
     * mode = "on_device" | "cloud" from response.inferenceSource, or "none" when nothing could run (offline, no Nano).
     */
    suspend fun liveCheck(frame: Bitmap, intention: String): Check {
        val text = buildString {
            // System text is inlined: on-device (ML Kit Prompt API) is single-turn, text+one Bitmap.
            append(prompt("liveCheck", "system")).append("\n\n")
            append(prompt("liveCheck", "user").replace("{{intention}}", intention).replace("{{frame}}", "the attached photo"))
            append("\nRespond with only a JSON object: {\"ok\": boolean, \"reason\": string, \"label\": string}")
        }
        return try {
            val resp = withTimeout(25_000) {
                liveModel.generateContent(content { image(frame); text(text) })
            }
            val mode = if (resp.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "cloud"
            val j = extractJson(resp.text.orEmpty())
            val ok = j?.optBoolean("ok", true) ?: true
            val reason = j?.optString("reason").orEmpty().ifBlank { if (ok) "keep going" else "retake" }
            Check(ok = ok, reason = if (ok) "keep going" else reason.take(80), mode = mode, label = j?.optString("label").orEmpty().take(40))
        } catch (t: Throwable) {
            Log.w(TAG, "live check failed", t)
            Check(ok = true, reason = "not checked (offline)", mode = "none", label = "")
        }
    }

    // ---------- judge + skeptic + scorer (ONLY_IN_CLOUD, JSON schema) ----------

    data class Opinion(val verdict: String, val confidence: Double, val reasons: List<String>, val model: String, val ranAt: Long) {
        fun toMap() = mapOf("verdict" to verdict, "confidence" to confidence, "reasons" to reasons, "model" to model, "ranAt" to ranAt)
    }

    /** Verification score: P(claim true | evidence) under the adversarial prior (prompts.scorer). */
    data class Score(val probability: Double, val reasons: List<String>, val model: String, val ranAt: Long) {
        fun toMap() = mapOf("probability" to probability, "reasons" to reasons, "model" to model, "ranAt" to ranAt)
    }

    private val opinionSchema = Schema.obj(
        mapOf(
            "verdict" to Schema.enumeration(listOf("consistent", "inconsistent", "uncertain")),
            "confidence" to Schema.double(),
            "reasons" to Schema.array(Schema.string()),
        )
    )

    private val scoreSchema = Schema.obj(
        mapOf(
            "probability" to Schema.double("P(claim true | evidence), 0..1"),
            "reasons" to Schema.array(Schema.string()),
        )
    )

    private fun cloudModelFor(key: String, schema: Schema = opinionSchema) = Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = cloudModel(),
        generationConfig = generationConfig {
            responseMimeType = "application/json"
            responseSchema = schema
        },
        systemInstruction = content { text(prompt(key, "system")) },
        onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
    )

    /** key = "judge" | "skeptic". frames = (offsetSeconds, bitmap) in time order. */
    suspend fun opinion(key: String, intention: String, category: String, summaryJson: String, frames: List<Pair<Long, Bitmap>>): Opinion {
        val j = cloudJson(key, opinionSchema, intention, category, summaryJson, frames)
        val reasons = reasonsOf(j)
        val verdict = j.optString("verdict").takeIf { it in setOf("consistent", "inconsistent", "uncertain") } ?: "uncertain"
        return Opinion(verdict, j.optDouble("confidence", 0.0).coerceIn(0.0, 1.0), reasons, cloudModel(), System.currentTimeMillis())
    }

    /** prompts.scorer, same inputs as the judge. Throws when the reply has no probability (treated like a judge failure). */
    suspend fun score(intention: String, category: String, summaryJson: String, frames: List<Pair<Long, Bitmap>>): Score {
        val j = cloudJson("scorer", scoreSchema, intention, category, summaryJson, frames)
        val p = j.optDouble("probability").takeIf { !it.isNaN() } ?: throw IllegalStateException("scorer: no probability")
        return Score(p.coerceIn(0.0, 1.0), reasonsOf(j), cloudModel(), System.currentTimeMillis())
    }

    private suspend fun cloudJson(key: String, schema: Schema, intention: String, category: String, summaryJson: String, frames: List<Pair<Long, Bitmap>>): JSONObject {
        val user = prompt(key, "user")
            .replace("{{intention}}", intention)
            .replace("{{category}}", category)
            .replace("{{summary}}", summaryJson)
            .replace("{{frameOffsets}}", frames.joinToString(", ") { "${it.first}s" }.ifEmpty { "none" })
        val resp = withTimeout(90_000) {
            cloudModelFor(key, schema).generateContent(content {
                text(user)
                frames.forEach { image(it.second) }
            })
        }
        return extractJson(resp.text.orEmpty()) ?: JSONObject()
    }

    private fun reasonsOf(j: JSONObject) =
        j.optJSONArray("reasons")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty().take(4)

    // ---------- v3 prompts (docs/ARCHITECTURE.md v3.2, v3.4, v3.10): interview, structuring, bar preview, witness ----------

    /** A JSON reply plus where it ran: "on_device" | "cloud". */
    data class Hybrid(val json: JSONObject, val mode: String)

    /** Text-only model that prefers Gemini Nano; falls back to the cloud model (Firebase AI Logic hybrid). */
    private val preferOnDeviceText by lazy {
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = cloudModel(),
            onDeviceConfig = OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE, maxOutputTokens = 512),
        )
    }

    private fun fill(template: String, vars: Map<String, String>): String =
        vars.entries.fold(template) { acc, (k, v) -> acc.replace("{{$k}}", v) }

    /**
     * PREFER_ON_DEVICE: the on-device model is single-turn and has no response schema, so the system text and the
     * JSON shape are inlined and the reply is parsed leniently. Throws when nothing could run or the reply isn't JSON.
     */
    suspend fun preferOnDevice(key: String, vars: Map<String, String>, timeoutMs: Long = 20_000): Hybrid {
        val schema = prompts?.optJSONObject(key)?.optJSONObject("schema")
        val text = buildString {
            append(prompt(key, "system")).append("\n\n")
            append(fill(prompt(key, "user"), vars))
            if (schema != null) append("\nRespond with only a JSON object matching this JSON schema: ").append(schema.toString())
        }
        val resp = withTimeout(timeoutMs) { preferOnDeviceText.generateContent(text) }
        val mode = if (resp.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "cloud"
        val j = extractJson(resp.text.orEmpty()) ?: throw IllegalStateException("$key: no JSON in reply")
        return Hybrid(j, mode)
    }

    /** ONLY_IN_CLOUD with the shared JSON schema from prompts.json as responseSchema. */
    suspend fun onlyInCloud(key: String, vars: Map<String, String>, images: List<Bitmap> = emptyList(), timeoutMs: Long = 30_000): Hybrid {
        val schema = prompts?.optJSONObject(key)?.optJSONObject("schema")?.let(::schemaFrom)
        val model = Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = cloudModel(),
            generationConfig = generationConfig {
                responseMimeType = "application/json"
                if (schema != null) responseSchema = schema
            },
            systemInstruction = content { text(prompt(key, "system")) },
            onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
        )
        val resp = withTimeout(timeoutMs) {
            model.generateContent(content { text(fill(prompt(key, "user"), vars)); images.forEach { image(it) } })
        }
        return Hybrid(extractJson(resp.text.orEmpty()) ?: throw IllegalStateException("$key: no JSON in reply"), "cloud")
    }

    /** shared/prompts.json JSON schema → Firebase AI Logic Schema (object, array, string, enum, number, integer, boolean). */
    fun schemaFrom(j: JSONObject): Schema {
        val desc = j.optString("description").takeIf { it.isNotBlank() }
        return when (j.optString("type")) {
            "object" -> {
                val props = j.optJSONObject("properties") ?: JSONObject()
                val req = j.optJSONArray("required")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
                val map = props.keys().asSequence().associateWith { schemaFrom(props.getJSONObject(it)) }
                Schema.obj(map, optionalProperties = map.keys.filter { it !in req }, description = desc)
            }
            "array" -> Schema.array(j.optJSONObject("items")?.let(::schemaFrom) ?: Schema.string(), description = desc)
            "number" -> Schema.double(desc)
            "integer" -> Schema.integer(desc)
            "boolean" -> Schema.boolean(desc)
            else -> j.optJSONArray("enum")?.let { a -> Schema.enumeration((0 until a.length()).map { a.getString(it) }, desc) } ?: Schema.string(desc)
        }
    }

    /** Lenient: handles ```json fences or prose around the object. */
    fun extractJson(s: String): JSONObject? {
        val start = s.indexOf('{'); val end = s.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        return runCatching { JSONObject(s.substring(start, end + 1)) }.getOrNull()
    }
}

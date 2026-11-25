package com.mattricks.verified.voice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

/**
 * Voice in and out with the platform engines only (docs/ARCHITECTURE.md v3.2): Android SpeechRecognizer (on-device
 * recognizer when the phone has one, else prefer offline) and TextToSpeech, one sentence at a time.
 * A text field is always offered next to it, so nothing here is required to use the app.
 */
object Voice {
    private const val TAG = "VerifiedVoice"
    private lateinit var app: Context
    private var tts: TextToSpeech? = null
    private val ttsReady = CompletableDeferred<Boolean>()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Unit>>()

    private val _partial = MutableStateFlow("")
    /** Live partial transcript while listening. */
    val partial: StateFlow<String> = _partial
    private val _level = MutableStateFlow(0f)
    /** Mic level 0..1 while listening (for the pulsing mic). */
    val level: StateFlow<Float> = _level
    private val _speaking = MutableStateFlow(false)
    val speaking: StateFlow<Boolean> = _speaking

    fun init(ctx: Context) {
        app = ctx.applicationContext
        tts = TextToSpeech(app) { status ->
            val ok = status == TextToSpeech.SUCCESS
            if (ok) {
                tts?.language = Locale.getDefault()
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String) { _speaking.value = true }
                    override fun onDone(id: String) { pending.remove(id)?.complete(Unit); if (pending.isEmpty()) _speaking.value = false }
                    @Deprecated("Deprecated in Java")
                    override fun onError(id: String) { pending.remove(id)?.complete(Unit); if (pending.isEmpty()) _speaking.value = false }
                    override fun onStop(id: String, interrupted: Boolean) { pending.remove(id)?.complete(Unit); if (pending.isEmpty()) _speaking.value = false }
                })
            }
            ttsReady.complete(ok)
        }
    }

    fun canListen(): Boolean = SpeechRecognizer.isRecognitionAvailable(app)

    /** Splits into sentences and speaks them in order; returns when the last one finished (or TTS is missing). */
    suspend fun speak(text: String) {
        if (text.isBlank()) return
        val ok = withTimeoutOrNull(3_000) { ttsReady.await() } ?: false
        val engine = tts
        if (!ok || engine == null) return
        val sentences = text.split(Regex("(?<=[.!?])\\s+")).map { it.trim() }.filter { it.isNotEmpty() }
        var last: CompletableDeferred<Unit>? = null
        sentences.forEachIndexed { i, s ->
            val id = "u${System.nanoTime()}_$i"
            val d = CompletableDeferred<Unit>()
            pending[id] = d
            last = d
            engine.speak(s, TextToSpeech.QUEUE_ADD, null, id)
        }
        // Never hang the interview on a stuck engine: ~6 s per sentence at most.
        withTimeoutOrNull(6_000L * sentences.size) { last?.await() }
    }

    fun stopSpeaking() {
        tts?.stop()
        pending.values.forEach { it.complete(Unit) }
        pending.clear()
        _speaking.value = false
    }

    /**
     * Listens for one utterance. Returns the best transcript, or null on silence / no match / no recognizer.
     * Must be called from the main thread (SpeechRecognizer requirement); suspends until the result.
     */
    suspend fun listen(): String? = withContext(Dispatchers.Main) {
        if (!canListen()) return@withContext null
        _partial.value = ""
        suspendCancellableCoroutine { cont ->
            val rec = if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(app))
                SpeechRecognizer.createOnDeviceSpeechRecognizer(app) else SpeechRecognizer.createSpeechRecognizer(app)
            fun finish(result: String?) {
                _level.value = 0f
                runCatching { rec.destroy() }
                if (cont.isActive) cont.resume(result)
            }
            rec.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) { _level.value = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f) }
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() { _level.value = 0f }
                override fun onError(error: Int) {
                    Log.i(TAG, "recognizer error $error")
                    finish(_partial.value.takeIf { it.isNotBlank() })
                }
                override fun onResults(results: Bundle?) {
                    val best = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    finish(best?.takeIf { it.isNotBlank() } ?: _partial.value.takeIf { it.isNotBlank() })
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { _partial.value = it }
                }
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true) // keep working with no signal
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            cont.invokeOnCancellation { android.os.Handler(android.os.Looper.getMainLooper()).post { runCatching { rec.cancel(); rec.destroy() } } }
            runCatching { rec.startListening(intent) }.onFailure { Log.w(TAG, "startListening", it); finish(null) }
        }
    }
}

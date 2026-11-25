package com.mattricks.verified.judge

import android.content.Context
import android.graphics.BitmapFactory
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Base64
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.ai.Ai
import com.mattricks.verified.data.Store
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * When online: for each of my submitted Moments without a judge, run judge, skeptic + scorer in the cloud
 * (Firebase AI Logic, ONLY_IN_CLOUD) on the hero frame + up to 3 more frames, and write all three in one update.
 * The Cloud Function then seals. Triggered after Finish, on sign-in and whenever the network comes back.
 */
object Judging {
    private const val TAG = "VerifiedJudge"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private var cm: ConnectivityManager? = null

    private val _status = MutableStateFlow<String?>(null)
    /** e.g. "Judge, skeptic + scorer running in the cloud…" — null when idle. */
    val status: StateFlow<String?> = _status

    fun init(ctx: Context) {
        cm = ctx.getSystemService(ConnectivityManager::class.java)
        cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { kick() }
        })
    }

    fun online(): Boolean {
        val c = cm ?: return true
        val caps = c.getNetworkCapabilities(c.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun kick() { scope.launch { runPending() } }

    private suspend fun runPending() = mutex.withLock {
        val uid = Firebase.auth.currentUser?.uid ?: return@withLock
        if (!online()) return@withLock
        val pending = runCatching { Store.pendingJudging(uid) }.onFailure { Log.w(TAG, "query", it) }.getOrDefault(emptyList())
        for (m in pending) {
            try {
                _status.value = "Judge, skeptic + scorer running in the cloud…"
                judgeOne(m.id, m.data.orEmpty())
            } catch (t: Throwable) {
                Log.w(TAG, "judge ${m.id} failed", t)
            }
        }
        _status.value = null
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun judgeOne(id: String, m: Map<String, Any?>) {
        val intention = m["intention"] as? Map<String, Any?> ?: return
        val startedAt = (m["startedAt"] as? Number)?.toLong() ?: 0
        val summary = m["summary"] as? Map<String, Any?> ?: return
        val heroSeq = (summary["heroFrameSeq"] as? Number)?.toInt()

        val frames = Store.chunks(id).mapNotNull { c ->
            val f = c.get("frame") as? Map<String, Any?> ?: return@mapNotNull null
            Triple((c.getLong("seq") ?: 0).toInt(), (f["t"] as? Number)?.toLong() ?: 0, f["jpegB64"] as? String ?: return@mapNotNull null)
        }
        // hero + up to 3 others spread across the session, in time order
        val others = frames.filter { it.first != heroSeq }
        val picked = (frames.filter { it.first == heroSeq } +
            if (others.size <= 3) others else listOf(0, others.size / 2, others.size - 1).map { others[it] })
            .distinct().sortedBy { it.second }
        val bitmaps = picked.mapNotNull { (_, t, b64) ->
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { ((t - startedAt) / 1000) to it }
        }
        val summaryJson = JSONObject(summary).toString()
        val text = intention["text"] as? String ?: ""
        val category = intention["category"] as? String ?: "other"

        // v4.10: judge the server's claims one by one. They are written at submit by barAndClaims; wait ≤ 30 s,
        // else `[]` (the seal then falls back to the judge's overall verdict).
        _status.value = "Waiting for the server's claims…"
        val claims = Store.awaitClaims(id, m["claims"], 30_000)
        val claimsJson = JSONArray(claims.map { JSONObject(it.toMap()) }).toString()
        _status.value = "Judge, skeptic + scorer running in the cloud…"

        // Concurrent; any failure cancels the others and nothing is written (retried on the next kick).
        val (judge, skeptic, score) = coroutineScope {
            val j = async { Ai.opinion("judge", text, category, summaryJson, bitmaps, claimsJson) }
            val s = async { Ai.opinion("skeptic", text, category, summaryJson, bitmaps) }
            val p = async { Ai.score(text, category, summaryJson, bitmaps) }
            Triple(j.await(), s.await(), p.await())
        }
        Store.writeOpinions(id, judge.toMap(), skeptic.toMap(), score.toMap())
        Log.i(TAG, "judged $id: judge=${judge.verdict} skeptic=${skeptic.verdict} score=${score.probability}")
    }
}

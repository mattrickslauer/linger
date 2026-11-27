package com.mattricks.verified.data

import android.util.Log
import androidx.compose.runtime.mutableStateMapOf
import com.google.firebase.Firebase
import com.google.firebase.firestore.firestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Proof-shot thumbnails for My Moments (mirrors iOS `HeroCache`). `moments/{id}` docs carry no hero (only the public
 * `feed/{id}` does), so a tile resolves one: the feed's hero for a sealed Moment, else a proof frame from the chain
 * (the local vault first, then the server chunks). Same pick as the evidence room: the last frame the coach passed,
 * else the last frame.
 */
object HeroCache {
    data class Hero(val b64: String, val rotation: Int)

    /** Resolved heroes by Moment id; snapshot state, so tiles recompose when one lands. */
    val heroes = mutableStateMapOf<String, Hero>()
    private val tried = HashSet<String>()
    private val lock = Mutex()

    /** [c] with its hero (and the feed's displayRotation when the moment doc has none) filled in, if resolved. */
    fun fill(c: MomentCard): MomentCard {
        if (!c.heroJpegB64.isNullOrEmpty()) return c
        val h = heroes[c.id] ?: return c
        return c.copy(heroJpegB64 = h.b64, displayRotation = if (c.displayRotation != 0) c.displayRotation else h.rotation)
    }

    /** Loads a hero once per Moment (per launch); a miss is retried on the next call. */
    suspend fun load(c: MomentCard) {
        val id = c.id
        if (!c.heroJpegB64.isNullOrEmpty() || heroes.containsKey(id)) return
        lock.withLock { if (!tried.add(id)) return }
        val hero = runCatching { resolve(c) }.onFailure { Log.w("HeroCache", "hero $id", it) }.getOrNull()
        if (hero != null) heroes[id] = hero else lock.withLock { tried.remove(id) }
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun resolve(c: MomentCard): Hero? = withContext(Dispatchers.IO) {
        val db = Firebase.firestore
        if (!c.local) {
            val feed = runCatching { db.collection("feed").document(c.id).get().await() }.getOrNull()?.takeIf { it.exists() }
            (feed?.get("heroJpegB64") as? String)?.takeIf { it.isNotEmpty() }?.let {
                return@withContext Hero(it, normalizeDisplayRotation(feed.get("displayRotation")))
            }
        }
        val rows = Vault.load(c.id)?.second.orEmpty()
        pick(rows)?.let { return@withContext Hero(it, 0) }
        if (c.local) return@withContext null
        val server = db.collection("moments").document(c.id).collection("chunks").orderBy("seq").get().await()
            .documents.mapNotNull { it.data }
        pick(server)?.let { Hero(it, 0) }
    }

    /** The last frame whose coach check passed, else the last frame; null if the chain has none. */
    @Suppress("UNCHECKED_CAST")
    fun pick(chunks: List<Map<String, Any?>>): String? {
        var okHero: String? = null
        var anyHero: String? = null
        for (c in chunks.sortedBy { (it["seq"] as? Number)?.toInt() ?: 0 }) {
            val b64 = ((c["frame"] as? Map<String, Any?>)?.get("jpegB64") as? String)?.takeIf { it.isNotEmpty() } ?: continue
            anyHero = b64
            val ok = runCatching { JSONObject(c["payload"] as? String ?: "").optJSONObject("check")?.optBoolean("ok") == true }.getOrDefault(false)
            if (ok) okHero = b64
        }
        return okHero ?: anyHero
    }
}

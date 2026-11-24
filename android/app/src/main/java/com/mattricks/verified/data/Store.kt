package com.mattricks.verified.data

import android.os.Build
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.auth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.firestore
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.chain.Chain
import com.mattricks.verified.chain.ChainLink
import com.mattricks.verified.chain.Check
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/**
 * Firestore access per docs/ARCHITECTURE.md. Writes are fire-and-forget: with offline persistence they land in the
 * local cache immediately and sync later, so we never await them while recording.
 */
object Store {
    private const val TAG = "VerifiedStore"
    private val db get() = Firebase.firestore

    private fun logFail(what: String) = com.google.android.gms.tasks.OnFailureListener { e -> Log.e(TAG, "$what failed", e) }

    fun chunkId(seq: Int) = "%06d".format(seq)

    suspend fun upsertUser(u: FirebaseUser) {
        val ref = db.collection("users").document(u.uid)
        val data = mutableMapOf<String, Any?>("displayName" to (u.displayName ?: "Anonymous"), "photoURL" to u.photoUrl?.toString())
        val exists = runCatching { ref.get().await().exists() }.getOrDefault(true)
        if (!exists) data["createdAtServer"] = FieldValue.serverTimestamp()
        ref.set(data, SetOptions.merge()).addOnFailureListener(logFail("user upsert"))
    }

    fun createMoment(id: String, intention: String, category: String, startedAt: Long) {
        val u = Firebase.auth.currentUser ?: return
        val doc = mapOf(
            "ownerUid" to u.uid,
            "owner" to mapOf("name" to (u.displayName ?: "Anonymous"), "photoURL" to u.photoUrl?.toString()),
            "intention" to mapOf("text" to intention.take(200), "category" to category),
            "platform" to "android",
            "device" to mapOf("model" to "${Build.MANUFACTURER} ${Build.MODEL}", "os" to "Android ${Build.VERSION.RELEASE}", "appVersion" to BuildConfig.VERSION_NAME),
            "status" to "recording",
            "startedAt" to startedAt,
            "endedAt" to null,
            "chunkCount" to 0,
            "headHash" to null,
            "summary" to null,
            "onDevice" to mapOf("mode" to "none", "checks" to 0, "retakes" to 0),
            "judge" to null,
            "skeptic" to null,
            "seal" to null,
            "createdAtServer" to FieldValue.serverTimestamp(),
        )
        Vault.saveMoment(id, doc) // raw copy on the phone first, kept until the server provably has it
        db.collection("moments").document(id).set(doc).addOnFailureListener(logFail("create moment"))
    }

    data class FrameData(val jpegB64: String, val w: Int, val h: Int, val t: Long)

    fun writeChunk(momentId: String, link: ChainLink, frame: FrameData?) {
        val doc = mapOf(
            "seq" to link.seq, "t0" to link.t0, "t1" to link.t1, "prevHash" to link.prevHash,
            "payload" to link.payload, "hash" to link.hash,
            "frame" to frame?.let { mapOf("jpegB64" to it.jpegB64, "w" to it.w, "h" to it.h, "t" to it.t) },
        )
        Vault.saveChunk(momentId, doc)
        db.collection("moments").document(momentId).collection("chunks").document(chunkId(link.seq))
            .set(doc).addOnFailureListener(logFail("chunk ${link.seq}"))
    }

    fun submit(momentId: String, endedAt: Long, chunkCount: Int, headHash: String, summary: Summary, onDevice: Map<String, Any>) {
        val fields = mapOf(
            "status" to "submitted", "endedAt" to endedAt, "chunkCount" to chunkCount, "headHash" to headHash,
            "summary" to summary.toMap(), "onDevice" to onDevice, "submittedAtServer" to FieldValue.serverTimestamp(),
        )
        Vault.updateMoment(momentId, fields)
        db.collection("moments").document(momentId).update(fields).addOnFailureListener(logFail("submit"))
    }

    /**
     * Owner-only delete (docs/ARCHITECTURE.md "Deleting a Moment"). The local raw-vault journal goes FIRST so this
     * phone can never re-upload it; then the moment doc is deleted (queued offline like any write). The Cloud Function
     * onMomentDeleted removes the chunks and feed entry and writes the deleted/{id} tombstone.
     */
    fun deleteMoment(id: String) {
        val uid = Firebase.auth.currentUser?.uid ?: return
        if (id == com.mattricks.verified.record.RecordViewModel.recording.value) return // never the one being recorded
        bg.launch {
            val forgot = runCatching { Vault.forget(id) }.onFailure { Log.e(TAG, "vault forget $id failed; not deleting", it) }
            if (forgot.isFailure) return@launch
            Log.i(TAG, "deleting moment $id (owner $uid)")
            db.collection("moments").document(id).delete().addOnFailureListener(logFail("delete moment"))
        }
    }

    private val bg = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun writeOpinions(momentId: String, judge: Map<String, Any?>, skeptic: Map<String, Any?>) {
        db.collection("moments").document(momentId).update(mapOf("judge" to judge, "skeptic" to skeptic)).await()
    }

    /** Sync badge: (total chunks, chunks still waiting for the server). */
    fun chunkSync(momentId: String): Flow<Pair<Int, Int>> = callbackFlow {
        val reg = db.collection("moments").document(momentId).collection("chunks")
            .addSnapshotListener(MetadataChanges.INCLUDE) { snap, _ ->
                if (snap != null) trySend(snap.size() to snap.documents.count { it.metadata.hasPendingWrites() })
            }
        awaitClose { reg.remove() }
    }

    fun feed(): Flow<List<MomentCard>> = callbackFlow {
        val reg = db.collection("feed").orderBy("sealedAtServer", Query.Direction.DESCENDING).limit(50)
            .addSnapshotListener { snap, e ->
                if (e != null) Log.w(TAG, "feed", e)
                if (snap != null) trySend(snap.documents.map(::feedCard))
            }
        awaitClose { reg.remove() }
    }

    fun myMoments(uid: String): Flow<List<MomentCard>> = callbackFlow {
        // Single-field filter, sorted client side: no composite index needed.
        val reg = db.collection("moments").whereEqualTo("ownerUid", uid)
            .addSnapshotListener(MetadataChanges.INCLUDE) { snap, e ->
                if (e != null) Log.w(TAG, "me", e)
                if (snap != null) trySend(snap.documents.map(::momentCard).sortedByDescending { it.startedAt })
            }
        awaitClose { reg.remove() }
    }

    /** Own moments that are submitted but still have no judge (to run the cloud judge when online). */
    suspend fun pendingJudging(uid: String): List<DocumentSnapshot> =
        db.collection("moments").whereEqualTo("ownerUid", uid).get().await()
            .documents.filter { it.getString("status") == "submitted" && it.get("judge") == null }

    suspend fun chunks(momentId: String): List<DocumentSnapshot> =
        db.collection("moments").document(momentId).collection("chunks").orderBy("seq").get().await().documents

    @Suppress("UNCHECKED_CAST")
    private fun feedCard(d: DocumentSnapshot): MomentCard {
        val owner = d.get("owner") as? Map<String, Any?>
        val intention = d.get("intention") as? Map<String, Any?>
        return MomentCard(
            id = d.id, ownerName = owner?.get("name") as? String ?: "",
            intention = intention?.get("text") as? String ?: "", category = intention?.get("category") as? String ?: "other",
            platform = d.getString("platform") ?: "", status = d.getString("status") ?: "",
            summary = Summary.from(d.get("summary") as? Map<String, Any?>), onDeviceMode = d.getString("onDeviceMode") ?: "none",
            heroJpegB64 = d.getString("heroJpegB64"),
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun momentCard(d: DocumentSnapshot): MomentCard {
        val owner = d.get("owner") as? Map<String, Any?>
        val intention = d.get("intention") as? Map<String, Any?>
        val onDevice = d.get("onDevice") as? Map<String, Any?>
        return MomentCard(
            id = d.id, ownerName = owner?.get("name") as? String ?: "",
            intention = intention?.get("text") as? String ?: "", category = intention?.get("category") as? String ?: "other",
            platform = d.getString("platform") ?: "", status = d.getString("status") ?: "",
            summary = Summary.from(d.get("summary") as? Map<String, Any?>), onDeviceMode = onDevice?.get("mode") as? String ?: "none",
            heroJpegB64 = null, startedAt = d.getLong("startedAt") ?: 0, pendingWrites = d.metadata.hasPendingWrites(),
            ownerUid = d.getString("ownerUid") ?: "",
        )
    }

    /** Builds the detail view. Falls back to the public feed entry when the raw moment is not readable. */
    @Suppress("UNCHECKED_CAST")
    suspend fun detail(momentId: String): MomentDetail {
        val feedDoc = runCatching { db.collection("feed").document(momentId).get().await() }.getOrNull()?.takeIf { it.exists() }
        val m = runCatching { db.collection("moments").document(momentId).get().await() }.getOrNull()?.takeIf { it.exists() }
        val chunkDocs = if (m != null) runCatching { chunks(momentId) }.getOrDefault(emptyList()) else emptyList()

        val track = ArrayList<LatLng>(); val motion = ArrayList<Pair<Long, Float>>(); val frames = ArrayList<Frame>()
        val links = ArrayList<ChainLink>()
        for (c in chunkDocs) {
            val payload = c.getString("payload") ?: continue
            val seq = (c.getLong("seq") ?: 0).toInt()
            links += ChainLink(seq, c.getLong("t0") ?: 0, c.getLong("t1") ?: 0, c.getString("prevHash") ?: "", payload, c.getString("hash") ?: "")
            val p = runCatching { JSONObject(payload) }.getOrNull() ?: continue
            p.optJSONArray("gps")?.let { a -> for (i in 0 until a.length()) a.optJSONArray(i)?.let { r -> track += LatLng(r.optDouble(1), r.optDouble(2)) } }
            p.optJSONArray("motion")?.let { a ->
                for (i in 0 until a.length()) a.optJSONArray(i)?.let { r ->
                    val ax = r.optDouble(1); val ay = r.optDouble(2); val az = r.optDouble(3)
                    motion += r.optLong(0) to Math.sqrt(ax * ax + ay * ay + az * az).toFloat()
                }
            }
            val fr = c.get("frame") as? Map<String, Any?>
            if (fr != null) {
                val ck = p.optJSONObject("check")?.let { Check(it.optBoolean("ok"), it.optString("reason"), it.optString("mode"), it.optString("label")) }
                frames += Frame(seq, num(fr["t"]).toLong(), fr["jpegB64"] as? String ?: "", ck)
            }
        }
        if (track.isEmpty() && feedDoc != null) {
            // Backend writes [{lat,lng}] (Firestore rejects nested arrays); also accept [[lat,lng]].
            (feedDoc.get("track") as? List<Any?>)?.forEach { pt ->
                when (pt) {
                    is Map<*, *> -> if (pt["lat"] != null && pt["lng"] != null) track += LatLng(num(pt["lat"]), num(pt["lng"]))
                    is List<*> -> if (pt.size >= 2) track += LatLng(num(pt[0]), num(pt[1]))
                }
            }
        }
        if (frames.isEmpty()) feedDoc?.getString("heroJpegB64")?.let { frames += Frame(0, 0, it, null) }

        val card = when {
            m != null -> momentCard(m).copy(heroJpegB64 = frames.lastOrNull()?.jpegB64)
            feedDoc != null -> feedCard(feedDoc)
            else -> throw IllegalStateException("Moment not found")
        }
        return MomentDetail(
            card = card,
            startedAt = m?.getLong("startedAt") ?: 0, endedAt = m?.getLong("endedAt"),
            track = track, motion = motion, frames = frames,
            chunkCount = links.size, chainOk = if (links.isEmpty()) null else Chain.verify(momentId, links) == -1,
            judge = Opinion.from(m?.get("judge")), skeptic = Opinion.from(m?.get("skeptic")), seal = Seal.from(m?.get("seal")),
            feedChecks = (feedDoc?.get("checks") as? Map<String, Any?>).orEmpty().mapValues { it.value == true },
            feedReason = feedDoc?.getString("sealReason"),
            judgeReasons = (feedDoc?.get("judgeReasons") as? List<String>).orEmpty(),
        )
    }
}

package com.mattricks.verified.data

import android.content.Context
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.Source
import com.google.firebase.firestore.firestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * The phone's own copy of every Moment's raw data, kept until the server provably has all of it.
 *
 * The Firestore cache is not a backup: if the server loses a document, the cache simply records that it is gone.
 * So every write goes to an app-private journal file first (atomically, fsynced), then to Firestore:
 *   files/vault/{momentId}/moment.json        the moment fields as created and as submitted
 *   files/vault/{momentId}/chunks/{seq}.json  seq, t0, t1, prevHash, payload, hash, frame — the exact hashed bytes
 * [verifyAll] reads each submitted Moment back FROM THE SERVER (never the cache), re-uploads anything missing (the
 * whole Moment if the server lost it), and deletes the local copy only when every chunk's hash, payload and frame,
 * the chunk count and the head hash match. Offline, an error, or any mismatch: the local copy stays.
 */
object Vault {
    private const val TAG = "VerifiedVault"
    private lateinit var root: File
    private val lock = Mutex()
    private val db get() = Firebase.firestore

    enum class State { Waiting, Repairing, Conflict }

    /** Moments still held on this phone, with why. Empty map = everything is safely on the server. Guest Moments are not here. */
    private val _held = MutableStateFlow<Map<String, State>>(emptyMap())
    val held: StateFlow<Map<String, State>> = _held

    /**
     * Guest Moments (docs/ARCHITECTURE.md v3.1): recorded while signed out, journal-only (`guest: true`, `ownerUid: null`),
     * never written to Firestore until claimed at sign-in. Newest first.
     */
    private val _guests = MutableStateFlow<List<LocalMoment>>(emptyList())
    val guests: StateFlow<List<LocalMoment>> = _guests

    data class LocalMoment(
        val id: String, val text: String, val category: String, val status: String, val startedAt: Long,
        val summary: Summary, val heroB64: String?, val bar: Double?,
    )

    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
        root = File(context.filesDir, "vault").apply { mkdirs() }
        _held.value = ids().filter { !isGuest(it) }.associateWith { State.Waiting }
        refreshGuests()
    }

    private fun readMoment(id: String): JSONObject? = runCatching { JSONObject(File(dir(id), "moment.json").readText()) }.getOrNull()

    fun isGuest(id: String): Boolean = readMoment(id)?.optBoolean("guest", false) == true

    /** Rebuilds [guests] from the journal (cheap: a handful of small files). */
    fun refreshGuests() {
        _guests.value = ids().mapNotNull { id ->
            val m = readMoment(id) ?: return@mapNotNull null
            if (!m.optBoolean("guest", false)) return@mapNotNull null
            val intention = m.optJSONObject("intention")
            @Suppress("UNCHECKED_CAST")
            val summary = Summary.from(fromJsonValue(m.opt("summary")) as? Map<String, Any?>)
            val hero = summary.heroFrameSeq?.let { seq ->
                runCatching { JSONObject(File(dir(id), "chunks/${Store.chunkId(seq)}.json").readText()).optJSONObject("frame")?.optString("jpegB64") }.getOrNull()
            }
            LocalMoment(
                id, intention?.optString("text").orEmpty(), intention?.optString("category") ?: "other",
                m.optString("status", "recording"), m.optLong("startedAt"), summary, hero,
                intention?.optJSONObject("preview")?.optDouble("bar")?.takeIf { !it.isNaN() },
            )
        }.sortedByDescending { it.startedAt }
    }

    /** The journal as Firestore-like maps (moment fields, chunks in seq order), for the detail screen. Null if absent. */
    fun load(id: String): Pair<Map<String, Any?>, List<Map<String, Any?>>>? {
        val m = readMoment(id) ?: return null
        val chunks = File(dir(id), "chunks").listFiles()?.filter { it.name.endsWith(".json") }?.sortedBy { it.name }
            ?.mapNotNull { f -> runCatching { fromJson(JSONObject(f.readText())) }.getOrNull() }.orEmpty()
        return fromJson(m) to chunks
    }

    /**
     * Claim a guest Moment for the signed-in user (v3.1 step 2): the journal gets the owner first, then the normal
     * [verifyAll] re-creates it on the server (it is missing there), uploads every chunk and the submit fields.
     * The chain binds only the momentId, so nothing hashed changes. A Moment once owned is never re-assigned.
     */
    suspend fun claim(id: String, uid: String, name: String, photoURL: String?): Boolean = lock.withLock {
        withContext(Dispatchers.IO) {
            val m = readMoment(id) ?: return@withContext false
            if (!m.optBoolean("guest", false) || (m.opt("ownerUid") != null && m.opt("ownerUid") != JSONObject.NULL)) return@withContext false
            if (m.optString("status") != "submitted") return@withContext false // still recording: offered when it finishes
            updateMoment(id, mapOf(
                "ownerUid" to uid,
                "owner" to mapOf("name" to name, "photoURL" to photoURL),
                "recordedAsGuest" to true,
                "claimedAt" to System.currentTimeMillis(),
                "guest" to false,
            ))
            _held.update { it + (id to State.Waiting) }
            refreshGuests()
            Log.i(TAG, "claimed guest Moment $id for $uid")
            true
        }
    }

    private fun ids(): List<String> = root.listFiles()?.filter { File(it, "moment.json").exists() }?.map { it.name } ?: emptyList()
    private fun dir(id: String) = File(root, id)

    private fun writeAtomic(f: File, text: String) {
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".tmp")
        FileOutputStream(tmp).use { out -> out.write(text.toByteArray()); out.fd.sync() }
        if (!tmp.renameTo(f)) error("vault: could not write ${f.path}")
    }

    // ── journal (called by Store before each Firestore write; throws rather than silently skipping)

    fun saveMoment(id: String, fields: Map<String, Any?>) {
        writeAtomic(File(dir(id), "moment.json"), toJson(fields).toString())
        if (fields["guest"] == true) refreshGuests() else _held.update { it + (id to State.Waiting) }
    }

    fun updateMoment(id: String, fields: Map<String, Any?>) {
        val f = File(dir(id), "moment.json")
        val j = if (f.exists()) JSONObject(f.readText()) else JSONObject()
        for ((k, v) in fields) j.put(k, wrap(v))
        writeAtomic(f, j.toString())
        if (j.optBoolean("guest", false)) refreshGuests()
    }

    fun saveChunk(id: String, chunk: Map<String, Any?>) {
        writeAtomic(File(dir(id), "chunks/${Store.chunkId(chunk["seq"] as Int)}.json"), toJson(chunk).toString())
    }

    /**
     * The owner deleted this Moment: drop the local journal so this phone can never re-upload it. Takes the verify
     * lock, so an in-flight [verifyAll] pass can't re-create it afterwards from files that are about to vanish.
     */
    suspend fun forget(id: String) = lock.withLock {
        withContext(Dispatchers.IO) {
            val d = dir(id)
            if (d.exists() && !d.deleteRecursively()) error("vault: could not delete ${d.path}")
        }
        _held.update { it - id }
        refreshGuests()
        Log.i(TAG, "deleted by owner, local copy removed: $id")
    }

    // ── verification

    private val kickScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.IO)

    /** Run a pass now (e.g. right after Finish of a Moment with video, whose submit goes through the clip upload). */
    fun kick() { kickScope.launch { runCatching { verifyAll() }.onFailure { Log.w(TAG, "vault kick", it) } } }

    /** Checks every held Moment against the server. Safe to call often; one pass at a time. */
    suspend fun verifyAll() = lock.withLock {
        val uid = Firebase.auth.currentUser?.uid ?: return@withLock
        for (id in ids()) {
            val ok = runCatching { verify(id, uid) }.onFailure { Log.w(TAG, "verify $id: ${it.message}") }.getOrNull()
            if (ok == true) {
                dir(id).deleteRecursively()
                _held.update { it - id }
                Log.i(TAG, "verified on server, local copy removed: $id")
            }
        }
    }

    /** True when the local copy can go: the server provably has everything, or the owner deleted the Moment. Throws when the server can't be reached. */
    private suspend fun verify(id: String, uid: String): Boolean = withContext(Dispatchers.IO) {
        val local = JSONObject(File(dir(id), "moment.json").readText())
        if (local.optString("ownerUid") != uid) return@withContext false // another account's Moment: keep, don't touch
        if (local.optString("status") != "submitted") return@withContext false // still recording
        val chunkFiles = File(dir(id), "chunks").listFiles()?.filter { it.name.endsWith(".json") }?.sortedBy { it.name } ?: emptyList()
        val localChunks = chunkFiles.map { JSONObject(it.readText()) }
        val chunkCount = local.getInt("chunkCount")
        if (localChunks.size != chunkCount) {
            Log.e(TAG, "$id: journal has ${localChunks.size} chunks, moment says $chunkCount; keeping")
            _held.update { it + (id to State.Conflict) }
            return@withContext false
        }

        val ref = db.collection("moments").document(id)
        var server = ref.get(Source.SERVER).await()
        if (!server.exists()) {
            // Deleted on another device? The Cloud Function leaves a tombstone; never resurrect a deleted Moment.
            val tombstone = db.collection("deleted").document(id).get(Source.SERVER).await().exists()
            if (VaultCheck.onMissing(tombstone) == VaultCheck.Missing.Forget) {
                Log.i(TAG, "$id: deleted by the owner on another device; dropping the local copy")
                return@withContext true // caller removes the journal
            }
            _held.update { it + (id to State.Repairing) }
            Log.w(TAG, "$id: missing on server, re-creating from the journal")
            val create = fromJson(local).toMutableMap()
            for (k in SUBMIT_FIELDS) create.remove(k)
            create["status"] = "recording"
            create["seal"] = null; create["judge"] = null; create["skeptic"] = null; create["score"] = null
            create["bar"] = null; create["verification"] = null
            for (k in JOURNAL_ONLY) create.remove(k)
            create["createdAtServer"] = FieldValue.serverTimestamp()
            ref.set(create).await()
            server = ref.get(Source.SERVER).await()
        }

        val serverChunks = ref.collection("chunks").get(Source.SERVER).await().documents.associateBy { (it.getLong("seq") ?: -1L).toInt() }
        val missing = localChunks.filter { (it.getInt("seq")) !in serverChunks }
        if (missing.isNotEmpty()) {
            _held.update { it + (id to State.Repairing) }
            Log.w(TAG, "$id: uploading ${missing.size} missing chunk(s)")
            // Chunks may be added while recording, or after submit when seq < chunkCount (firestore.rules).
            for (c in missing) ref.collection("chunks").document(Store.chunkId(c.getInt("seq"))).set(fromJson(c)).await()
        }
        if (server.getString("status") == "recording") {
            // v4.4: every chained clip goes up BEFORE status = "submitted" (the free video review needs it). Throws
            // when offline or failing: the Moment stays `recording` on the server and this loop retries.
            val clips = localChunks.flatMap { Clips.refsIn(it.optString("payload")) }
            if (clips.isNotEmpty()) {
                _held.update { it + (id to State.Repairing) }
                Clips.uploadForSubmit(appContext, uid, id, clips)
            }
            ref.update(SUBMIT_FIELDS.associateWith { k -> if (k == "submittedAtServer") FieldValue.serverTimestamp() else fromJsonValue(local.opt(k)) }).await()
            com.mattricks.verified.judge.Judging.kick() // submitted now: the cloud review can run
        }

        // Read everything back from the server and compare with the journal, byte for byte where it matters.
        val m = ref.get(Source.SERVER).await()
        val back = ref.collection("chunks").get(Source.SERVER).await().documents.associateBy { (it.getLong("seq") ?: -1L).toInt() }
        val problems = VaultCheck.compare(
            localHead = local.optString("headHash"), localCount = chunkCount,
            serverHead = m.getString("headHash"), serverCount = m.getLong("chunkCount")?.toInt(), serverStatus = m.getString("status"),
            local = localChunks.map { VaultCheck.Chunk(it.getInt("seq"), it.getString("hash"), it.getString("payload"), it.optJSONObject("frame")?.optString("jpegB64")) },
            server = back.values.map { d ->
                @Suppress("UNCHECKED_CAST")
                VaultCheck.Chunk((d.getLong("seq") ?: -1L).toInt(), d.getString("hash") ?: "", d.getString("payload") ?: "", (d.get("frame") as? Map<String, Any?>)?.get("jpegB64") as? String)
            },
        )
        if (problems.isNotEmpty()) {
            Log.e(TAG, "$id: server copy differs from the journal, keeping local copy: ${problems.take(5)}")
            _held.update { it + (id to State.Conflict) }
            return@withContext false
        }
        true
    }

    private val SUBMIT_FIELDS = listOf("status", "endedAt", "chunkCount", "headHash", "summary", "onDevice", "witness", "submittedAtServer")

    /** Journal markers never sent to Firestore (v3.1 guest marker, v3.2 local interview transcript). */
    private val JOURNAL_ONLY = listOf("guest", "transcript")

    // ── JSON <-> Firestore values (maps, lists, numbers, strings, booleans, null)

    private fun wrap(v: Any?): Any = when (v) {
        null -> JSONObject.NULL
        is Map<*, *> -> JSONObject().apply { for ((k, x) in v) if (x !is FieldValue) put(k.toString(), wrap(x)) }
        is List<*> -> JSONArray().apply { v.forEach { put(wrap(it)) } }
        is FieldValue -> JSONObject.NULL
        else -> v
    }
    private fun toJson(m: Map<String, Any?>) = wrap(m) as JSONObject

    private fun fromJsonValue(v: Any?): Any? = when (v) {
        null, JSONObject.NULL -> null
        is JSONObject -> fromJson(v)
        is JSONArray -> (0 until v.length()).map { fromJsonValue(v.get(it)) }
        else -> v
    }
    private fun fromJson(j: JSONObject): Map<String, Any?> = j.keys().asSequence().associateWith { fromJsonValue(j.get(it)) }
}

/** Pure comparison of the journal with what the server returned (unit-tested). */
object VaultCheck {
    enum class Missing { Recreate, Forget }

    /** Moment missing on the server: a deleted/{id} tombstone means the owner deleted it elsewhere, so drop the journal. */
    fun onMissing(tombstoneExists: Boolean): Missing = if (tombstoneExists) Missing.Forget else Missing.Recreate

    data class Chunk(val seq: Int, val hash: String, val payload: String, val frameB64: String?)

    fun compare(
        localHead: String, localCount: Int, serverHead: String?, serverCount: Int?, serverStatus: String?,
        local: List<Chunk>, server: List<Chunk>,
    ): List<String> {
        val p = mutableListOf<String>()
        if (serverStatus !in listOf("submitted", "sealed", "rejected")) p += "status $serverStatus"
        if (serverHead != localHead) p += "headHash"
        if (serverCount != localCount) p += "chunkCount $serverCount != $localCount"
        val bySeq = server.associateBy { it.seq }
        if (server.size != local.size) p += "server has ${server.size} chunks, journal ${local.size}"
        for (c in local) {
            val s = bySeq[c.seq] ?: run { p += "chunk ${c.seq} missing"; null } ?: continue
            if (s.hash != c.hash) p += "chunk ${c.seq} hash"
            if (s.payload != c.payload) p += "chunk ${c.seq} payload"
            if (s.frameB64 != c.frameB64) p += "chunk ${c.seq} frame"
        }
        return p
    }
}

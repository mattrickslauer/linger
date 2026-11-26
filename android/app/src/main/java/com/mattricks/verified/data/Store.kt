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
import kotlinx.coroutines.flow.first
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

    /**
     * Creates a Moment. Signed in: journal + Firestore. Guest (no user): journal ONLY, marked `guest: true`,
     * `ownerUid: null`, `owner: null` (docs/ARCHITECTURE.md v3.1); it reaches the server only when claimed at sign-in.
     * Returns true when the Moment is a guest Moment.
     * [intention] is `{text, category}` or the v3 structured map (v3.2).
     */
    fun createMoment(id: String, intention: Map<String, Any?>, startedAt: Long, journalExtra: Map<String, Any?> = emptyMap()): Boolean {
        val u = Firebase.auth.currentUser
        val doc = mutableMapOf(
            "ownerUid" to u?.uid,
            "owner" to u?.let { mapOf("name" to (it.displayName ?: "Anonymous"), "photoURL" to it.photoUrl?.toString()) },
            "intention" to intention,
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
            "score" to null,
            "seal" to null,
            "createdAtServer" to FieldValue.serverTimestamp(),
        )
        if (u == null) {
            doc["guest"] = true
            Vault.saveMoment(id, doc + journalExtra) // guest: the journal is the only copy until it is claimed
            return true
        }
        Vault.saveMoment(id, doc + journalExtra) // raw copy on the phone first, kept until the server provably has it
        db.collection("moments").document(id).set(doc).addOnFailureListener(logFail("create moment"))
        return false
    }

    data class FrameData(val jpegB64: String, val w: Int, val h: Int, val t: Long)

    fun writeChunk(momentId: String, link: ChainLink, frame: FrameData?, guest: Boolean = false) {
        val doc = mapOf(
            "seq" to link.seq, "t0" to link.t0, "t1" to link.t1, "prevHash" to link.prevHash,
            "payload" to link.payload, "hash" to link.hash,
            "frame" to frame?.let { mapOf("jpegB64" to it.jpegB64, "w" to it.w, "h" to it.h, "t" to it.t) },
        )
        Vault.saveChunk(momentId, doc)
        if (guest) return // no Firestore writes at all for guests (not even queued)
        db.collection("moments").document(momentId).collection("chunks").document(chunkId(link.seq))
            .set(doc).addOnFailureListener(logFail("chunk ${link.seq}"))
    }

    fun submit(
        momentId: String, endedAt: Long, chunkCount: Int, headHash: String, summary: Summary, onDevice: Map<String, Any>,
        witness: Map<String, Any>, guest: Boolean = false, hasVideo: Boolean = false,
    ) {
        val fields = mapOf(
            "status" to "submitted", "endedAt" to endedAt, "chunkCount" to chunkCount, "headHash" to headHash,
            "summary" to summary.toMap(), "onDevice" to onDevice, "witness" to witness, "submittedAtServer" to FieldValue.serverTimestamp(),
        )
        Vault.updateMoment(momentId, fields)
        if (guest) return
        if (hasVideo) {
            // v4.4: the clips go up first, then the submit fields; the raw vault does both (offline-safe: the journal
            // keeps everything and the vault loop retries until the server has the clips and the submit).
            // Let the chunk writes still in flight land first so the vault pass doesn't race them (offline: the
            // 30 s vault loop does it once back online).
            db.waitForPendingWrites().addOnCompleteListener { Vault.kick() }
            return
        }
        db.collection("moments").document(momentId).update(fields).addOnFailureListener(logFail("submit"))
    }

    /**
     * Owner-only delete (docs/ARCHITECTURE.md "Deleting a Moment"). The local raw-vault journal goes FIRST so this
     * phone can never re-upload it; then the moment doc is deleted (queued offline like any write). The Cloud Function
     * onMomentDeleted removes the chunks and feed entry and writes the deleted/{id} tombstone.
     */
    fun deleteMoment(id: String) {
        if (id == com.mattricks.verified.record.RecordViewModel.recording.value) return // never the one being recorded
        if (Vault.isGuest(id)) { // a guest Moment lives only on this phone: deleting it needs no sign-in
            bg.launch { runCatching { Vault.forget(id) }.onFailure { Log.e(TAG, "vault forget $id failed", it) } }
            return
        }
        val uid = Firebase.auth.currentUser?.uid ?: return
        bg.launch {
            val forgot = runCatching { Vault.forget(id) }.onFailure { Log.e(TAG, "vault forget $id failed; not deleting", it) }
            if (forgot.isFailure) return@launch
            Log.i(TAG, "deleting moment $id (owner $uid)")
            db.collection("moments").document(id).delete().addOnFailureListener(logFail("delete moment"))
        }
    }

    private val bg = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** All-or-nothing: judge, skeptic and score land in one update, so the seal never sees a partial set. */
    suspend fun writeOpinions(momentId: String, judge: Map<String, Any?>, skeptic: Map<String, Any?>, score: Map<String, Any?>) {
        db.collection("moments").document(momentId).update(mapOf("judge" to judge, "skeptic" to skeptic, "score" to score)).await()
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

    /** v4.10: the server claims (moments/{id}.claims.items), waiting for the snapshot up to [timeoutMs]; [] if none. */
    suspend fun awaitClaims(momentId: String, already: Any?, timeoutMs: Long): List<Claim> {
        ServerClaims.from(already)?.items?.takeIf { it.isNotEmpty() }?.let { return it }
        return kotlinx.coroutines.withTimeoutOrNull(timeoutMs) {
            callbackFlow {
                val reg = db.collection("moments").document(momentId).addSnapshotListener { snap, _ ->
                    ServerClaims.from(snap?.get("claims"))?.items?.takeIf { it.isNotEmpty() }?.let { trySend(it) }
                }
                awaitClose { reg.remove() }
            }.first()
        }.orEmpty()
    }

    suspend fun chunks(momentId: String): List<DocumentSnapshot> =
        db.collection("moments").document(momentId).collection("chunks").orderBy("seq").get().await().documents

    private fun feedCard(d: DocumentSnapshot): MomentCard = feedCardFrom(d.id, d.data.orEmpty())

    private fun momentCard(d: DocumentSnapshot): MomentCard =
        momentCardFrom(d.id, d.data.orEmpty() + ("__pending" to d.metadata.hasPendingWrites()), local = false)

    @Suppress("UNCHECKED_CAST")
    private fun feedCardFrom(id: String, d: Map<String, Any?>): MomentCard {
        val owner = d["owner"] as? Map<String, Any?>
        val intention = d["intention"] as? Map<String, Any?>
        val ladder = d["ladder"] as? List<Any?>
        return MomentCard(
            id = id, ownerName = owner?.get("name") as? String ?: "",
            intention = intention?.get("text") as? String ?: "", category = intention?.get("category") as? String ?: "other",
            platform = d["platform"] as? String ?: "", status = d["status"] as? String ?: "",
            summary = Summary.from(d["summary"] as? Map<String, Any?>), onDeviceMode = d["onDeviceMode"] as? String ?: "none",
            heroJpegB64 = d["heroJpegB64"] as? String,
            bar = (d["bar"] as? Number)?.toDouble(), score = (d["verificationScore"] as? Number)?.toDouble(),
            ladderCount = ladder?.size ?: 0, recordedAsGuest = d["recordedAsGuest"] == true,
            witnessAsked = ((d["witness"] as? Map<String, Any?>)?.get("asked") as? Number)?.toInt() ?: 0,
            claimsBacked = (d["claimsBacked"] as? Number)?.toInt(), claimsTotal = (d["claimsTotal"] as? Number)?.toInt(),
            cheating = d["cheating"] == true,
            checks = (d["checks"] as? Map<String, Any?>).orEmpty().mapValues { it.value == true },
            track = trackFrom(d["track"]),
            sealedAt = when (val t = d["sealedAtServer"]) {
                is com.google.firebase.Timestamp -> t.toDate().time
                is Number -> t.toLong()
                else -> 0
            },
            sealReason = d["sealReason"] as? String ?: "",
            scoreReasons = (d["scoreReasons"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
            judgeReasons = (d["judgeReasons"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
            cheatingSignals = (d["cheatingSignals"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
            witnessAnswered = ((d["witness"] as? Map<String, Any?>)?.get("answered") as? Number)?.toInt() ?: 0,
            clips = feedClips(d["video"]),
        )
    }

    /** feed.video.clips (v4.12); absent on feeds sealed before it → []. */
    @Suppress("UNCHECKED_CAST")
    private fun feedClips(video: Any?): List<SharedClip> =
        ((video as? Map<String, Any?>)?.get("clips") as? List<Any?>).orEmpty().mapNotNull { c ->
            val x = c as? Map<String, Any?> ?: return@mapNotNull null
            val path = x["path"] as? String ?: return@mapNotNull null
            SharedClip(path, x["sha256"] as? String ?: "", x["ext"] as? String ?: path.substringAfterLast('.', "mp4"), num(x["durationMs"]).toLong(), x["hashOk"] as? Boolean)
        }

    /** feed.track: the backend writes [{lat,lng}] (Firestore rejects nested arrays); also accept [[lat,lng]]. */
    private fun trackFrom(x: Any?): List<LatLng> = (x as? List<Any?>).orEmpty().mapNotNull { pt ->
        when (pt) {
            is Map<*, *> -> if (pt["lat"] != null && pt["lng"] != null) LatLng(num(pt["lat"]), num(pt["lng"])) else null
            is List<*> -> if (pt.size >= 2) LatLng(num(pt[0]), num(pt[1])) else null
            else -> null
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun momentCardFrom(id: String, d: Map<String, Any?>, local: Boolean): MomentCard {
        val owner = d["owner"] as? Map<String, Any?>
        val intention = d["intention"] as? Map<String, Any?>
        val onDevice = d["onDevice"] as? Map<String, Any?>
        val verification = d["verification"] as? Map<String, Any?>
        return MomentCard(
            id = id, ownerName = owner?.get("name") as? String ?: if (local) "You" else "",
            intention = intention?.get("text") as? String ?: "", category = intention?.get("category") as? String ?: "other",
            platform = d["platform"] as? String ?: "", status = d["status"] as? String ?: "",
            summary = Summary.from(d["summary"] as? Map<String, Any?>), onDeviceMode = onDevice?.get("mode") as? String ?: "none",
            heroJpegB64 = null, startedAt = (d["startedAt"] as? Number)?.toLong() ?: 0, pendingWrites = d["__pending"] == true,
            ownerUid = d["ownerUid"] as? String ?: "",
            bar = ((d["bar"] as? Map<String, Any?>)?.get("value") as? Number)?.toDouble(),
            score = (verification?.get("score") as? Number)?.toDouble() ?: ((d["score"] as? Map<String, Any?>)?.get("probability") as? Number)?.toDouble(),
            ladderCount = (verification?.get("modules") as? List<Any?>)?.size ?: 0,
            recordedAsGuest = d["recordedAsGuest"] == true, local = local,
            previewBar = ((intention?.get("preview") as? Map<String, Any?>)?.get("bar") as? Number)?.toDouble(),
            claimsBacked = verification?.takeIf { num(it["version"]).toInt() >= 4 }?.get("claimsBacked")?.let { (it as? Number)?.toInt() },
            claimsTotal = ((d["claims"] as? Map<String, Any?>)?.get("items") as? List<Any?>)?.size,
            cheating = ((d["seal"] as? Map<String, Any?>)?.get("checks") as? Map<String, Any?>)?.get("cheating") == false,
        )
    }

    /** A guest Moment from the journal as a card (Me screen). */
    fun localCard(m: Vault.LocalMoment) = MomentCard(
        id = m.id, ownerName = "You", intention = m.text, category = m.category, platform = "android",
        status = m.status, summary = m.summary, onDeviceMode = "none", heroJpegB64 = m.heroB64, startedAt = m.startedAt,
        local = true, previewBar = m.bar,
    )

    /** Builds the detail view. Guest Moments come from the journal; else the moment (+ feed entry) from Firestore. */
    @Suppress("UNCHECKED_CAST")
    suspend fun detail(momentId: String): MomentDetail {
        if (Vault.isGuest(momentId)) {
            val (m, chunks) = Vault.load(momentId) ?: throw IllegalStateException("Moment not found")
            return build(momentId, m, chunks, null, local = true)
        }
        val feedDoc = runCatching { db.collection("feed").document(momentId).get().await() }.getOrNull()?.takeIf { it.exists() }
        val m = runCatching { db.collection("moments").document(momentId).get().await() }.getOrNull()?.takeIf { it.exists() }
        val chunkDocs = if (m != null) runCatching { chunks(momentId) }.getOrDefault(emptyList()) else emptyList()
        if (m == null && feedDoc == null) {
            // Not on the server (yet): show this phone's journal if it has one.
            Vault.load(momentId)?.let { (lm, lc) -> return build(momentId, lm, lc, null, local = true) }
            throw IllegalStateException("Moment not found")
        }
        return build(momentId, m?.data?.let { it + ("__pending" to m.metadata.hasPendingWrites()) }, chunkDocs.mapNotNull { it.data }, feedDoc?.data, local = false)
    }

    @Suppress("UNCHECKED_CAST")
    private fun build(momentId: String, m: Map<String, Any?>?, chunkDocs: List<Map<String, Any?>>, feed: Map<String, Any?>?, local: Boolean): MomentDetail {
        val track = ArrayList<LatLng>(); val motion = ArrayList<Pair<Long, Float>>(); val frames = ArrayList<Frame>()
        val links = ArrayList<ChainLink>()
        val witness = ArrayList<WitnessItem>()
        val videos = ArrayList<VideoRef>()
        for (c in chunkDocs.sortedBy { num(it["seq"]).toInt() }) {
            val payload = c["payload"] as? String ?: continue
            val seq = num(c["seq"]).toInt()
            links += ChainLink(seq, num(c["t0"]).toLong(), num(c["t1"]).toLong(), c["prevHash"] as? String ?: "", payload, c["hash"] as? String ?: "")
            val p = runCatching { JSONObject(payload) }.getOrNull() ?: continue
            p.optJSONArray("gps")?.let { a -> for (i in 0 until a.length()) a.optJSONArray(i)?.let { r -> track += LatLng(r.optDouble(1), r.optDouble(2)) } }
            p.optJSONArray("motion")?.let { a ->
                for (i in 0 until a.length()) a.optJSONArray(i)?.let { r ->
                    val ax = r.optDouble(1); val ay = r.optDouble(2); val az = r.optDouble(3)
                    motion += r.optLong(0) to Math.sqrt(ax * ax + ay * ay + az * az).toFloat()
                }
            }
            var frameWid: String? = null
            p.optJSONArray("events")?.let { a ->
                for (i in 0 until a.length()) {
                    val e = a.optJSONObject(i) ?: continue
                    when (e.optString("type")) {
                        "video" -> videos += VideoRef(e.optString("sha256"), e.optString("name"), e.optLong("bytes"), e.optLong("durationMs"))
                        "witness" -> witness += WitnessItem(
                            e.optString("wid"), e.optString("ask"), e.optString("kind"), e.optString("by"), e.optLong("t"),
                            rid = e.optString("rid").takeIf { e.has("rid") && it.isNotEmpty() },
                        )
                        "frame" -> if (e.has("wid")) frameWid = e.optString("wid")
                        "witness_answer" -> witness.indexOfFirst { it.wid == e.optString("wid") }.takeIf { it >= 0 }?.let { j ->
                            witness[j] = witness[j].copy(outcome = e.optString("via"), answer = e.optString("text").takeIf { it.isNotBlank() }, answerSeq = seq)
                        }
                        "witness_skip" -> witness.indexOfFirst { it.wid == e.optString("wid") }.takeIf { it >= 0 }?.let { j ->
                            witness[j] = witness[j].copy(outcome = "skipped")
                        }
                    }
                }
            }
            val fr = c["frame"] as? Map<String, Any?>
            if (fr != null) {
                val ck = p.optJSONObject("check")?.let { Check(it.optBoolean("ok"), it.optString("reason"), it.optString("mode"), it.optString("label")) }
                val ask = frameWid?.let { w -> witness.firstOrNull { it.wid == w }?.ask }
                frames += Frame(seq, num(fr["t"]).toLong(), fr["jpegB64"] as? String ?: "", ck, ask)
            }
        }
        if (track.isEmpty() && feed != null) {
            // Backend writes [{lat,lng}] (Firestore rejects nested arrays); also accept [[lat,lng]].
            track += trackFrom(feed["track"])
        }
        if (frames.isEmpty()) (feed?.get("heroJpegB64") as? String)?.let { frames += Frame(0, 0, it, null) }

        val card = when {
            m != null -> momentCardFrom(momentId, m, local).copy(heroJpegB64 = frames.lastOrNull()?.jpegB64)
            feed != null -> feedCardFrom(momentId, feed)
            else -> throw IllegalStateException("Moment not found")
        }
        val intentionMap = (m?.get("intention") ?: feed?.get("intention")) as? Map<String, Any?>
        return MomentDetail(
            card = card,
            startedAt = (m?.get("startedAt") as? Number)?.toLong() ?: 0, endedAt = (m?.get("endedAt") as? Number)?.toLong(),
            track = track, motion = motion, frames = frames,
            chunkCount = links.size, chainOk = if (links.isEmpty()) null else Chain.verify(momentId, links) == -1,
            judge = Opinion.from(m?.get("judge")), skeptic = Opinion.from(m?.get("skeptic")), seal = Seal.from(m?.get("seal")),
            // The scorer's own (baseline) score; the feed's verificationScore is the final score after the ladder (v3.8).
            score = Score.from(m?.get("score")) ?: feed?.let { Score.fromFeed(it["baselineScore"] ?: it["verificationScore"], it["scoreReasons"]) },
            feedChecks = (feed?.get("checks") as? Map<String, Any?>).orEmpty().mapValues { it.value == true },
            feedReason = feed?.get("sealReason") as? String,
            judgeReasons = (feed?.get("judgeReasons") as? List<String>).orEmpty(),
            local = local,
            intention = Intention.from(intentionMap),
            bar = Bar.from(m?.get("bar")) ?: feed?.let { Bar.fromFeed(it) },
            verification = Verification.from(m?.get("verification")) ?: feed?.let { Verification.fromFeed(it) },
            witness = witness,
            sealVersion = (m?.get("seal") as? Map<String, Any?>)?.get("version")?.let { num(it).toInt() } ?: (feed?.get("sealVersion") as? Number)?.toInt() ?: 0,
            ladderEligible = (m?.get("seal") as? Map<String, Any?>)?.get("ladderEligible") == true,
            ownerUid = m?.get("ownerUid") as? String ?: "",
            videos = videos,
            v4 = v4From(m, feed),
            witnessRids = witness.filter { it.outcome != null && it.outcome != "skipped" }.map { it.rid },
            sharedClips = sharedClips(momentId, m, feed),
        )
    }

    /** v4.12: moments videoReview.clips where uploaded (so the owner sees them before the seal), else feed.video.clips. */
    private fun sharedClips(momentId: String, m: Map<String, Any?>?, feed: Map<String, Any?>?): List<SharedClip> {
        val uid = m?.get("ownerUid") as? String
        val fromMoment = if (uid.isNullOrBlank()) emptyList() else VideoReview.from(m?.get("videoReview"))?.clips.orEmpty()
            .filter { it.uploaded && it.ext != null && it.sha256.isNotBlank() }
            .map { SharedClip("clips/$uid/$momentId/${it.sha256}.${it.ext}", it.sha256, it.ext!!, it.durationMs, it.hashOk) }
        return fromMoment.ifEmpty { feedClips(feed?.get("video")) }
    }

    /** v4 server state (moments doc) or the public subset (feed v4.8). Null when neither has claims. */
    @Suppress("UNCHECKED_CAST")
    private fun v4From(m: Map<String, Any?>?, feed: Map<String, Any?>?): V4Detail? {
        val sc = ServerClaims.from(m?.get("claims"))
        if (m != null && sc != null) {
            val ver = m["verification"] as? Map<String, Any?>
            val v4ver = ver?.takeIf { num(it["version"]).toInt() >= 4 }
            val cheat = v4ver?.get("cheating") as? Map<String, Any?>
            val seal = m["seal"] as? Map<String, Any?>
            return V4Detail(
                claims = sc.items, plan = Plan.from(m["plan"]), videoReview = VideoReview.from(m["videoReview"]),
                claimScores = (v4ver?.get("claims") as? List<Any?>).orEmpty().mapNotNull { (it as? Map<*, *>)?.let(ClaimScore::from) },
                claimsBacked = (v4ver?.get("claimsBacked") as? Number)?.toInt(),
                cheatingDetected = cheat?.get("detected") == true || seal?.let { s -> (s["checks"] as? Map<String, Any?>)?.get("cheating") == false } == true,
                cheatingSignals = ((cheat?.get("signals") ?: seal?.get("cheatingSignals")) as? List<Any?>).orEmpty().mapNotNull { it as? String },
            )
        }
        val f = feed ?: return null
        val fc = (f["claims"] as? List<Any?>).orEmpty().mapNotNull { it as? Map<String, Any?> }
        if (fc.isEmpty()) return null
        val fp = f["plan"] as? Map<String, Any?>
        val reqs = (fp?.get("requirements") as? List<Any?>).orEmpty().mapNotNull { it as? Map<String, Any?> }
        val met = reqs.associate { (it["id"] as? String ?: "") to (it["met"] == true) }
        val plan = fp?.let { Plan(reqs.map(Requirement::from), it["recordMode"] as? String ?: "photo", "") }
        val video = f["video"] as? Map<String, Any?>
        return V4Detail(
            claims = fc.map(Claim::from),
            plan = plan,
            videoReview = video?.let { VideoReview(it["status"] as? String ?: "none", emptyList(), emptyList(), false, emptyList(), it["summary"] as? String ?: "", null, null) },
            claimScores = fc.map { c ->
                val id = c["id"] as? String ?: ""
                val mine = plan?.requirements.orEmpty().filter { it.claimId == id }
                ClaimScore(
                    id, num(c["p"]), num(c["p"]), mine.filter { met[it.id] == true }.map { it.id }, mine.filter { met[it.id] != true }.map { it.id },
                    mine.isNotEmpty() && mine.all { met[it.id] == true }, (c["backedBy"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
                )
            },
            claimsBacked = (f["claimsBacked"] as? Number)?.toInt(),
            cheatingDetected = f["cheating"] == true,
            cheatingSignals = (f["cheatingSignals"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
            feedMet = met,
            videoSummary = video?.get("summary") as? String,
        )
    }
}

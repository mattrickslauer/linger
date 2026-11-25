package com.mattricks.verified.data

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageException
import com.google.firebase.storage.storageMetadata
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.security.MessageDigest

/**
 * Video evidence for the `full_video` module (docs/ARCHITECTURE.md v3.6). Clips stay on the phone (Movies/Verified);
 * the chain holds their SHA-256. For the module the owner uploads the clip to
 * `clips/{uid}/{momentId}/{sha256}.mp4` (storage.rules: owner create-only, a video content type, < 200 MB); the function re-hashes it.
 */
object Clips {
    private const val TAG = "VerifiedClips"
    const val MAX_BYTES = 200L * 1024 * 1024

    /** The chained clip on this phone, found by its gallery name. */
    suspend fun find(ctx: Context, ref: VideoRef): Uri? = withContext(Dispatchers.IO) {
        if (ref.name.isBlank()) return@withContext null
        val base = ref.name.substringBeforeLast('.')
        runCatching {
            ctx.contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI, arrayOf(MediaStore.Video.Media._ID),
                "${MediaStore.Video.Media.DISPLAY_NAME} = ? OR ${MediaStore.Video.Media.DISPLAY_NAME} = ?", arrayOf(ref.name, "$base.mp4"), null,
            )?.use { c -> if (c.moveToFirst()) ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, c.getLong(0)) else null }
        }.onFailure { Log.w(TAG, "find ${ref.name}", it) }.getOrNull()
    }

    // ───────── v4.4: every chained clip is uploaded at submit, before `status = "submitted"`

    /** Live upload state per Moment, for "Uploading video · 34 MB" → "Video uploaded". */
    data class Upload(val sentBytes: Long, val totalBytes: Long, val clips: Int, val done: Int, val finished: Boolean = false, val error: String? = null)

    private val _uploads = MutableStateFlow<Map<String, Upload>>(emptyMap())
    val uploads: StateFlow<Map<String, Upload>> = _uploads

    /** Storage extension from the gallery name ("…mp4"); CameraX records MPEG-4. */
    fun ext(ref: VideoRef): String = ref.name.substringAfterLast('.', "mp4").lowercase().takeIf { it in setOf("mp4", "mov", "webm") } ?: "mp4"

    private fun contentType(ext: String) = when (ext) { "mov" -> "video/quicktime"; "webm" -> "video/webm"; else -> "video/mp4" }

    /** `video` events in a chunk payload (the journal's exact hashed bytes). */
    fun refsIn(payload: String): List<VideoRef> = runCatching {
        val a = org.json.JSONObject(payload).optJSONArray("events") ?: return@runCatching emptyList()
        (0 until a.length()).mapNotNull { i ->
            val e = a.optJSONObject(i)?.takeIf { it.optString("type") == "video" } ?: return@mapNotNull null
            VideoRef(e.optString("sha256"), e.optString("name"), e.optLong("bytes"), e.optLong("durationMs"))
        }
    }.getOrDefault(emptyList())

    /**
     * Uploads every chained clip of a Moment to `clips/{uid}/{momentId}/{sha256}.{ext}`, sequentially. Idempotent:
     * `getMetadata` first and skip what is already there (create-only path, v4.9). Skipped for good (the submit goes
     * ahead, those video requirements stay unmet): over 200 MB, gone from this phone, or changed since it was chained.
     * Throws when offline or an upload fails, so the caller keeps the Moment `recording` and retries later.
     */
    suspend fun uploadForSubmit(ctx: Context, uid: String, momentId: String, refs: List<VideoRef>) {
        val todo = refs.filter { it.sha256.length == 64 }.distinctBy { it.sha256 }
        if (todo.isEmpty()) return
        val total = todo.filter { it.bytes <= MAX_BYTES }.sumOf { it.bytes }
        var sentBefore = 0L
        fun publish(u: Upload) = _uploads.update { it + (momentId to u) }
        publish(Upload(0, total, todo.size, 0))
        try {
            todo.forEachIndexed { i, ref ->
                if (ref.bytes > MAX_BYTES) { Log.w(TAG, "$momentId: clip ${ref.sha256} is over 200 MB, not uploaded"); return@forEachIndexed }
                val ext = ext(ref)
                val obj = FirebaseStorage.getInstance().reference.child("clips/$uid/$momentId/${ref.sha256}.$ext")
                val exists = try { obj.metadata.await(); true } catch (e: StorageException) {
                    if (e.errorCode == StorageException.ERROR_OBJECT_NOT_FOUND) false else throw e
                }
                if (!exists) {
                    val uri = find(ctx, ref)
                    if (uri == null) { Log.w(TAG, "$momentId: clip ${ref.name} is no longer on this phone, not uploaded"); return@forEachIndexed }
                    if (sha256(ctx, uri) != ref.sha256) { Log.w(TAG, "$momentId: clip ${ref.name} changed after it was chained, not uploaded"); return@forEachIndexed }
                    obj.putFile(uri, storageMetadata { contentType = contentType(ext) })
                        .addOnProgressListener { s -> publish(Upload(sentBefore + s.bytesTransferred, total, todo.size, i)) }
                        .await()
                    Log.i(TAG, "$momentId: uploaded clip ${ref.sha256}.$ext (${ref.bytes} bytes)")
                }
                sentBefore += ref.bytes
                publish(Upload(sentBefore, total, todo.size, i + 1))
            }
            publish(Upload(total, total, todo.size, todo.size, finished = true))
        } catch (t: Throwable) {
            publish(Upload(sentBefore, total, todo.size, 0, error = t.message ?: "upload failed"))
            throw t
        }
    }

    suspend fun sha256(ctx: Context, uri: Uri): String = withContext(Dispatchers.IO) {
        val md = MessageDigest.getInstance("SHA-256")
        ctx.contentResolver.openInputStream(uri)!!.use { ins ->
            val buf = ByteArray(1 shl 16)
            while (true) { val n = ins.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        md.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Re-hashes the clip (it must still match the chain), uploads it, and returns the sha for `runLadderModule`.
     * Already uploaded (create-only path) is fine: the function re-hashes what is there.
     */
    suspend fun upload(ctx: Context, uid: String, momentId: String, ref: VideoRef, uri: Uri, onProgress: (Int) -> Unit = {}): String {
        if (ref.bytes > MAX_BYTES) throw Ladder.RunError("too_large", "This clip is over 200 MB.")
        val sha = sha256(ctx, uri)
        if (sha != ref.sha256) throw Ladder.RunError("clip_hash_mismatch", "This clip was changed after it was chained, so it can't be used. No credits were spent.")
        val obj = FirebaseStorage.getInstance().reference.child("clips/$uid/$momentId/$sha.mp4")
        try {
            obj.putFile(uri, storageMetadata { contentType = "video/mp4" })
                .addOnProgressListener { s -> if (s.totalByteCount > 0) onProgress((100 * s.bytesTransferred / s.totalByteCount).toInt()) }
                .await()
        } catch (e: StorageException) {
            // Create-only rules reject a second upload of the same object: the clip is already there.
            if (e.errorCode != StorageException.ERROR_NOT_AUTHORIZED) throw Ladder.RunError("upload_failed", "Upload failed: ${e.message}")
            Log.i(TAG, "clip already uploaded (or not allowed): ${e.message}")
        }
        return sha
    }
}

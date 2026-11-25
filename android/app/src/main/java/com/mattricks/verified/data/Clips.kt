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

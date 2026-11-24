package com.mattricks.verified

import com.mattricks.verified.data.VaultCheck
import com.mattricks.verified.data.VaultCheck.Chunk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultCheckTest {
    private val local = listOf(Chunk(0, "h0", "{\"gps\":[]}", null), Chunk(1, "h1", "{\"gps\":[1]}", "AAAA"))

    private fun check(server: List<Chunk>, head: String? = "h1", count: Int? = 2, status: String? = "submitted") =
        VaultCheck.compare("h1", 2, head, count, status, local, server)

    @Test fun identicalServerCopyPasses() {
        assertEquals(emptyList<String>(), check(local))
        assertEquals(emptyList<String>(), check(local, status = "sealed"))
    }

    @Test fun missingChunkKeepsLocalCopy() {
        val p = check(local.take(1))
        assertTrue(p.any { "chunk 1 missing" in it })
    }

    @Test fun differentPayloadHashOrFrameKeepsLocalCopy() {
        assertTrue(check(listOf(local[0], local[1].copy(payload = "{}"))).any { "payload" in it })
        assertTrue(check(listOf(local[0], local[1].copy(hash = "x"))).any { "hash" in it })
        assertTrue(check(listOf(local[0], local[1].copy(frameB64 = null))).any { "frame" in it })
    }

    @Test fun wrongHeadCountOrStatusKeepsLocalCopy() {
        assertTrue(check(local, head = "other").contains("headHash"))
        assertTrue(check(local, count = 3).any { "chunkCount" in it })
        assertTrue(check(local, status = "recording").any { "status" in it })
        assertTrue(check(local, status = null).any { "status" in it })
    }

    @Test fun extraServerChunkIsFlagged() {
        assertTrue(check(local + Chunk(2, "h2", "{}", null)).any { "server has 3" in it })
    }

    @Test fun tombstoneMeansForgetNotRecreate() {
        assertEquals(VaultCheck.Missing.Forget, VaultCheck.onMissing(tombstoneExists = true))
        assertEquals(VaultCheck.Missing.Recreate, VaultCheck.onMissing(tombstoneExists = false))
    }
}

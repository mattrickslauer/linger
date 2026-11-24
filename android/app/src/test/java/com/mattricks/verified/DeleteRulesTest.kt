package com.mattricks.verified

import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Summary
import com.mattricks.verified.ui.canDeleteMoment
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeleteRulesTest {
    private fun card(id: String = "m1", owner: String = "me") = MomentCard(
        id = id, ownerName = "", intention = "", category = "other", platform = "android", status = "sealed",
        summary = Summary.from(null), onDeviceMode = "none", heroJpegB64 = null, ownerUid = owner,
    )

    @Test fun ownerCanDeleteOwnMoment() = assertTrue(canDeleteMoment(card(), "me", null))
    @Test fun notSomeoneElses() = assertFalse(canDeleteMoment(card(owner = "other"), "me", null))
    @Test fun notSignedOut() = assertFalse(canDeleteMoment(card(), null, null))
    @Test fun notWithoutOwner() = assertFalse(canDeleteMoment(card(owner = ""), "", null))
    @Test fun notTheOneBeingRecorded() = assertFalse(canDeleteMoment(card(id = "rec"), "me", "rec"))
}

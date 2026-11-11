package dev.haasele.ione

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatesTest {
    @Test
    fun `the debug build type's applicationId is a debug id`() {
        assertTrue(Updates.isDebugApplicationId("dev.haasele.ione.debug"))
        assertTrue(Updates.isDebugApplicationId("org.example.ione" + Updates.DEBUG_ID_SUFFIX))
    }

    @Test
    fun `release ids are not`() {
        assertFalse(Updates.isDebugApplicationId("dev.haasele.ione"))
        assertFalse(Updates.isDebugApplicationId("dev.haasele.ione.debugger"))
        assertFalse(Updates.isDebugApplicationId("org.example.zen.debug.chromium"))
        assertFalse(Updates.isDebugApplicationId(""))
    }

    @Test
    fun `the suffix is the one the build script appends`() {
        assertEquals(".debug", Updates.DEBUG_ID_SUFFIX)
    }
}

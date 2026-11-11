package dev.haasele.ione

import android.view.View
import org.junit.Assert.assertEquals
import org.junit.Test

/** The provider setting as the page WebViews apply it (`autofill.setProvider`). */
class SystemAutofillTest {
    @Test
    fun ioneTakesThePagesOutOfTheFramework() {
        assertEquals(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, SystemAutofill.importance(SystemAutofill.PROVIDER_IONE))
    }

    @Test
    fun theSystemServiceKeepsTheDefault() {
        assertEquals(View.IMPORTANT_FOR_AUTOFILL_AUTO, SystemAutofill.importance(SystemAutofill.PROVIDER_SYSTEM))
        assertEquals(View.IMPORTANT_FOR_AUTOFILL_AUTO, SystemAutofill.importance("something else"))
    }

    @Test
    fun providerNamesFromTheBridgeAreNormalised() {
        assertEquals(SystemAutofill.PROVIDER_IONE, SystemAutofill.provider("ione"))
        assertEquals(SystemAutofill.PROVIDER_SYSTEM, SystemAutofill.provider("system"))
        assertEquals(SystemAutofill.PROVIDER_SYSTEM, SystemAutofill.provider(null))
        assertEquals(SystemAutofill.PROVIDER_SYSTEM, SystemAutofill.provider("Ione"))
    }
}

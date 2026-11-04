package pl.patrykpro.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class GuardedWebViewClientTest {

    @Test
    public void refusesCapacitorsInternalRoutes() {
        assertTrue(GuardedWebViewClient.isInternalRoute("/_capacitor_file_/data/user/0/x"));
        assertTrue(GuardedWebViewClient.isInternalRoute("/_capacitor_content_/com.evil.provider/x.html"));
        assertTrue(GuardedWebViewClient.isInternalRoute("/_capacitor_http_interceptor_?u=x"));
        // However it is spelt.
        assertTrue(GuardedWebViewClient.isInternalRoute("//_capacitor_file_/x"));
        assertTrue(GuardedWebViewClient.isInternalRoute("/_CAPACITOR_FILE_/x"));
        assertTrue(GuardedWebViewClient.isInternalRoute("\\_capacitor_content_/x"));
    }

    @Test
    public void leavesTheAppsOwnPathsAlone() {
        assertFalse(GuardedWebViewClient.isInternalRoute(null));
        assertFalse(GuardedWebViewClient.isInternalRoute(""));
        assertFalse(GuardedWebViewClient.isInternalRoute("/"));
        assertFalse(GuardedWebViewClient.isInternalRoute("/index.html"));
        assertFalse(GuardedWebViewClient.isInternalRoute("/assets/App-x.js"));
        assertFalse(GuardedWebViewClient.isInternalRoute("/invite"));
        assertFalse(GuardedWebViewClient.isInternalRoute("/assets/_capacitor_file_"));
    }
}

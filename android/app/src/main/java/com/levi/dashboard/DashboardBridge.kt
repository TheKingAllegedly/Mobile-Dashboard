package com.levi.dashboard

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/**
 * Exposed to the dashboard as `window.DashboardHost`.
 *
 * This is the whole contract between the web app and the Android shell. The
 * dashboard pushes a small summary here after every refresh; the widget reads
 * it back. Nothing in this class reads from the page, so the bridge cannot be
 * used to pull data out of the dashboard.
 */
class DashboardBridge(
    private val context: Context,
    private val onReloadRequested: (() -> Unit)? = null
) {

    private val mainThread = Handler(Looper.getMainLooper())

    /** Called by the dashboard after every refresh with the widget summary. */
    @JavascriptInterface
    fun publishWidgetData(json: String) {
        if (json.length > MAX_PAYLOAD_CHARS) return
        WidgetStore.savePayload(context, json)
        DashboardWidgetProvider.refreshAll(context)
    }

    /** Lets the web app show Android-only settings when it is running in the app. */
    @JavascriptInterface
    fun isAndroidHost(): Boolean = true

    @JavascriptInterface
    fun getHomeUrl(): String = WidgetStore.getHomeUrl(context)

    /**
     * Point the app at a hosted copy of the dashboard. Blank goes back to the
     * copy bundled in the APK. Returns false for anything that is not https.
     */
    @JavascriptInterface
    fun setHomeUrl(url: String): Boolean {
        val trimmed = url.trim()
        if (trimmed.isNotEmpty() && !trimmed.startsWith("https://")) return false
        WidgetStore.setHomeUrl(context, trimmed)
        onReloadRequested?.let { mainThread.post(it) }
        return true
    }

    /** Force the background worker to re-read the weather for the widget. */
    @JavascriptInterface
    fun refreshWidget() {
        WidgetRefreshWorker.runNow(context)
        DashboardWidgetProvider.refreshAll(context)
    }

    private companion object {
        const val MAX_PAYLOAD_CHARS = 64 * 1024
    }
}

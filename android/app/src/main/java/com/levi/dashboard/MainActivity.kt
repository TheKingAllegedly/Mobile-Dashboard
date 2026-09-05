package com.levi.dashboard

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Hosts the dashboard.
 *
 * The web app is bundled in the APK and served over
 * https://appassets.androidplatform.net/ rather than a file:// URL, so it gets
 * a real secure origin: ES modules, localStorage and the service worker all
 * behave exactly as they do on the web.
 *
 * There is deliberately no native chrome. The dashboard draws its own header
 * and settings, and reaches the Android-only pieces through [DashboardBridge].
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var pendingGeolocation: Pair<String, GeolocationPermissions.Callback>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler(ASSET_PREFIX, WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        web.addJavascriptInterface(
            DashboardBridge(applicationContext) { loadDashboard() },
            "DashboardHost"
        )
        web.webViewClient = DashboardWebViewClient()
        web.webChromeClient = DashboardChromeClient()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            loadDashboard()
        }

        WidgetRefreshWorker.schedulePeriodic(applicationContext)
    }

    private fun loadDashboard() {
        val hosted = WidgetStore.getHomeUrl(this)
        web.loadUrl(if (hosted.isNotEmpty()) hosted else BUNDLED_URL)
    }

    private fun refreshDashboard() {
        web.evaluateJavascript("window.dashboardRefresh && window.dashboardRefresh();", null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_REFRESH, false)) refreshDashboard()
    }

    private inner class DashboardWebViewClient : WebViewClient() {

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            val url = request.url
            if (isDashboardUrl(url)) return false
            // Anything else is a link out of the dashboard: hand it to the browser.
            return try {
                startActivity(Intent(Intent.ACTION_VIEW, url))
                true
            } catch (e: Exception) {
                false
            }
        }

        /**
         * A hosted dashboard that will not load would otherwise leave the app
         * stuck on an error page with no way back, so fall back to the copy
         * bundled in the APK. If the bundled copy is what failed, say so in
         * plain language rather than leaving the WebView's raw error showing.
         */
        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            if (!request.isForMainFrame) return

            if (WidgetStore.getHomeUrl(this@MainActivity).isNotEmpty()) {
                WidgetStore.setHomeUrl(this@MainActivity, "")
                Toast.makeText(
                    this@MainActivity,
                    R.string.hosted_load_failed,
                    Toast.LENGTH_LONG
                ).show()
                view.loadUrl(BUNDLED_URL)
                return
            }

            view.loadDataWithBaseURL(
                null,
                bundledFailurePage(request.url.toString(), error.description?.toString()),
                "text/html",
                "utf-8",
                null
            )
        }

        private fun isDashboardUrl(url: Uri): Boolean {
            if (url.host == ASSET_DOMAIN) return true
            val hosted = WidgetStore.getHomeUrl(this@MainActivity)
            if (hosted.isEmpty()) return false
            return url.host != null && url.host == Uri.parse(hosted).host
        }
    }

    private inner class DashboardChromeClient : WebChromeClient() {

        override fun onGeolocationPermissionsShowPrompt(
            origin: String,
            callback: GeolocationPermissions.Callback
        ) {
            val granted = ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (granted) {
                callback.invoke(origin, true, true)
                return
            }
            pendingGeolocation = origin to callback
            ActivityCompat.requestPermissions(
                this@MainActivity,
                arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION),
                REQUEST_LOCATION
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_LOCATION) return
        val granted = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        pendingGeolocation?.let { (origin, callback) -> callback.invoke(origin, granted, granted) }
        pendingGeolocation = null
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    /**
     * Shown when the dashboard bundled in the APK will not load. That means the
     * asset path and the URL have drifted apart, so name both: it is the only
     * thing that makes the failure diagnosable from the phone.
     */
    private fun bundledFailurePage(url: String, reason: String?): String {
        val body = """
            <!doctype html>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { margin:0; padding:32px 24px; background:#0b0d10; color:#e8ecf1;
                     font:16px/1.5 system-ui, sans-serif; }
              h1 { font-size:20px; margin:0 0 12px; }
              p { color:#9aa5b1; margin:0 0 14px; }
              code { display:block; background:#14181d; border:1px solid #262c35;
                     border-radius:10px; padding:10px 12px; margin-top:6px;
                     font-size:12.5px; color:#5aa9ff; word-break:break-all; }
            </style>
            <h1>The dashboard could not start</h1>
            <p>The copy built into this app did not load, which usually means the
               bundled files moved without the address being updated.</p>
            <p>Address<code>${escapeHtml(url)}</code></p>
            <p>Reason<code>${escapeHtml(reason ?: "unknown")}</code></p>
            <p>Expected the files under <code>assets/web/</code> in the APK,
               reached through the <code>${escapeHtml(ASSET_PREFIX)}</code> handler.</p>
        """
        return body.trimIndent()
    }

    private fun escapeHtml(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

    companion object {
        const val ASSET_DOMAIN = "appassets.androidplatform.net"

        /*
         * WebViewAssetLoader strips this prefix from the URL and opens what is
         * left relative to assets/. The dashboard is copied into assets/web/ by
         * the copyWebApp Gradle task, so the URL has to carry both segments:
         * "/assets/" is removed, leaving "web/index.html".
         * scripts/check-asset-paths.mjs enforces that this still lines up.
         */
        const val ASSET_PREFIX = "/assets/"
        const val BUNDLED_URL = "https://$ASSET_DOMAIN${ASSET_PREFIX}web/index.html"
        const val EXTRA_REFRESH = "refresh"
        private const val REQUEST_LOCATION = 42
    }
}

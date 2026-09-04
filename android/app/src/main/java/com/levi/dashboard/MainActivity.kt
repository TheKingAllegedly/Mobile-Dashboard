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
            .addPathHandler("/web/", WebViewAssetLoader.AssetsPathHandler(this))
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
         * bundled in the APK.
         */
        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            if (!request.isForMainFrame) return
            if (WidgetStore.getHomeUrl(this@MainActivity).isEmpty()) return
            WidgetStore.setHomeUrl(this@MainActivity, "")
            Toast.makeText(
                this@MainActivity,
                R.string.hosted_load_failed,
                Toast.LENGTH_LONG
            ).show()
            view.loadUrl(BUNDLED_URL)
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

    companion object {
        const val ASSET_DOMAIN = "appassets.androidplatform.net"
        const val BUNDLED_URL = "https://$ASSET_DOMAIN/web/index.html"
        const val EXTRA_REFRESH = "refresh"
        private const val REQUEST_LOCATION = 42
    }
}

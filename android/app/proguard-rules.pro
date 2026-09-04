# The WebView bridge is called from JavaScript by name, so keep it intact.
-keepclassmembers class com.levi.dashboard.DashboardBridge {
    public *;
}
-keepattributes JavascriptInterface

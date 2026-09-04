package com.levi.dashboard

import android.content.Context
import org.json.JSONObject

/**
 * The single place the app and the home-screen widget agree on.
 *
 * The web dashboard publishes a compact JSON summary through [DashboardBridge]
 * every time it finishes refreshing. The widget reads that summary back, and a
 * background worker tops up the weather so the widget stays current even when
 * the app has not been opened for a while.
 */
object WidgetStore {

    private const val PREFS = "dashboard_widget"
    private const val KEY_PAYLOAD = "payload"
    private const val KEY_UPDATED_AT = "updated_at"
    private const val KEY_HOME_URL = "home_url"

    fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun savePayload(context: Context, json: String) {
        prefs(context).edit()
            .putString(KEY_PAYLOAD, json)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .apply()
    }

    fun readPayload(context: Context): JSONObject =
        try {
            JSONObject(prefs(context).getString(KEY_PAYLOAD, "{}") ?: "{}")
        } catch (e: Exception) {
            JSONObject()
        }

    /** Merge a few fields into the stored payload without losing the rest. */
    fun mergePayload(context: Context, updates: Map<String, String>) {
        val current = readPayload(context)
        for ((key, value) in updates) current.put(key, value)
        savePayload(context, current.toString())
    }

    fun updatedAt(context: Context): Long = prefs(context).getLong(KEY_UPDATED_AT, 0L)

    /** Empty means "use the copy of the dashboard bundled in the APK". */
    fun getHomeUrl(context: Context): String = prefs(context).getString(KEY_HOME_URL, "") ?: ""

    fun setHomeUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_HOME_URL, url).apply()
    }
}

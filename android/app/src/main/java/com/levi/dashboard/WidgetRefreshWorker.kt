package com.levi.dashboard

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * Keeps the widget's weather current while the app is closed.
 *
 * The dashboard publishes the coordinates it resolved, and this worker re-reads
 * Open-Meteo for them on a schedule. Everything else on the widget (calendar,
 * tasks, headlines) comes from the last time the app itself refreshed, because
 * those sources need the user's own configuration and credentials.
 */
class WidgetRefreshWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {

    override fun doWork(): Result {
        val stored = WidgetStore.readPayload(applicationContext)
        val lat = stored.optString("weatherLat", "")
        val lon = stored.optString("weatherLon", "")
        val unit = stored.optString("weatherUnit", "fahrenheit")

        if (lat.isEmpty() || lon.isEmpty()) {
            // Nothing to refresh yet; the app has not published a location.
            DashboardWidgetProvider.refreshAll(applicationContext)
            return Result.success()
        }

        return try {
            val current = fetchCurrentWeather(lat, lon, unit)
            WidgetStore.mergePayload(applicationContext, current)
            DashboardWidgetProvider.refreshAll(applicationContext)
            Result.success()
        } catch (e: Exception) {
            // Leave the last good reading on the widget and try again later.
            DashboardWidgetProvider.refreshAll(applicationContext)
            Result.retry()
        }
    }

    private fun fetchCurrentWeather(
        lat: String,
        lon: String,
        unit: String
    ): Map<String, String> {
        val degrees = if (unit == "celsius") "°C" else "°F"
        val url = URL(
            "https://api.open-meteo.com/v1/forecast" +
                "?latitude=$lat&longitude=$lon" +
                "&current=temperature_2m,weather_code,is_day" +
                "&daily=temperature_2m_max,temperature_2m_min" +
                "&forecast_days=1&timezone=auto" +
                "&temperature_unit=$unit"
        )

        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 12_000
            readTimeout = 12_000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
        }

        val body = try {
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("HTTP ${connection.responseCode}")
            }
            connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }

        val json = JSONObject(body)
        val current = json.getJSONObject("current")
        val code = current.optInt("weather_code", -1)
        val isDay = current.optInt("is_day", 1) == 1
        val temp = current.optDouble("temperature_2m", Double.NaN)

        val out = mutableMapOf<String, String>()
        if (!temp.isNaN()) out["weatherTemp"] = "${temp.roundToInt()}$degrees"

        /* An unrecognised code yields an empty label. Merging that would wipe
           the description the app published and leave the widget reading
           "Open the app to fill this in" next to a perfectly good temperature. */
        val condition = describe(code)
        if (condition.isNotEmpty()) out["weatherCond"] = condition
        val glyph = icon(code, isDay)
        if (glyph.isNotEmpty()) out["weatherIcon"] = glyph

        json.optJSONObject("daily")?.let { daily ->
            val highs = daily.optJSONArray("temperature_2m_max")
            val lows = daily.optJSONArray("temperature_2m_min")
            if (highs != null && lows != null && highs.length() > 0 && lows.length() > 0) {
                out["weatherHiLo"] =
                    "H ${highs.getDouble(0).roundToInt()}°  L ${lows.getDouble(0).roundToInt()}°"
            }
        }
        return out
    }

    /** WMO weather interpretation codes, matching the web app's labels. */
    private fun describe(code: Int): String = when (code) {
        0 -> "Clear"
        1 -> "Mostly clear"
        2 -> "Partly cloudy"
        3 -> "Overcast"
        45, 48 -> "Fog"
        51, 53, 55, 56, 57 -> "Drizzle"
        61, 63, 65, 66, 67 -> "Rain"
        71, 73, 75, 77 -> "Snow"
        80, 81, 82 -> "Showers"
        85, 86 -> "Snow showers"
        95, 96, 99 -> "Thunderstorm"
        else -> ""
    }

    private fun icon(code: Int, isDay: Boolean): String = when (code) {
        0 -> if (isDay) "☀️" else "🌙"
        1 -> if (isDay) "🌤️" else "🌙"
        2 -> "⛅"
        3 -> "☁️"
        45, 48 -> "🌫️"
        51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81 -> "🌧️"
        71, 73, 75, 77, 85, 86 -> "❄️"
        82, 95, 96, 99 -> "⛈️"
        else -> ""
    }

    companion object {
        private const val PERIODIC_NAME = "dashboard-widget-refresh"
        private const val ONE_SHOT_NAME = "dashboard-widget-refresh-now"

        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                ONE_SHOT_NAME,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_NAME)
        }
    }
}

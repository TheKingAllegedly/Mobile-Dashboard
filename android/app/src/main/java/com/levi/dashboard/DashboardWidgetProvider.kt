package com.levi.dashboard

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.format.DateUtils
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * The home-screen widget.
 *
 * It never fetches anything itself. It renders whatever summary is in
 * [WidgetStore], which is filled in by the dashboard when you open the app and
 * topped up in the background by [WidgetRefreshWorker].
 */
class DashboardWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(id, buildViews(context))
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            WidgetRefreshWorker.runNow(context)
            refreshAll(context)
        }
    }

    override fun onEnabled(context: Context) {
        WidgetRefreshWorker.schedulePeriodic(context)
    }

    override fun onDisabled(context: Context) {
        WidgetRefreshWorker.cancel(context)
    }

    companion object {
        const val ACTION_REFRESH = "com.levi.dashboard.ACTION_REFRESH_WIDGET"

        /** Redraw every placed copy of the widget. */
        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, DashboardWidgetProvider::class.java)
            )
            if (ids.isEmpty()) return
            val views = buildViews(context)
            for (id in ids) manager.updateAppWidget(id, views)
        }

        private fun buildViews(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_dashboard)
            val data = WidgetStore.readPayload(context)

            // Weather
            val temp = data.str("weatherTemp")
            views.setTextViewText(R.id.widget_temp, temp.ifEmpty { "--" })
            views.setTextViewText(
                R.id.widget_condition,
                listOf(data.str("weatherIcon"), data.str("weatherCond"))
                    .filter { it.isNotEmpty() }
                    .joinToString(" ")
                    .ifEmpty { context.getString(R.string.widget_open_to_set_up) }
            )
            views.setTextViewText(R.id.widget_hilo, data.str("weatherHiLo"))

            // Next calendar event, falling back to the top task
            val eventTitle = data.str("nextEvent")
            val eventTime = data.str("nextEventTime")
            if (eventTitle.isNotEmpty()) {
                views.setViewVisibility(R.id.widget_event_row, View.VISIBLE)
                views.setTextViewText(R.id.widget_event_time, eventTime.ifEmpty { "•" })
                views.setTextViewText(R.id.widget_event_title, eventTitle)
            } else {
                views.setViewVisibility(R.id.widget_event_row, View.GONE)
            }

            val task = data.str("topTask")
            val openCount = data.str("tasksOpen")
            val headline = data.str("headline")
            val secondLine = when {
                task.isNotEmpty() && openCount != "0" ->
                    context.getString(R.string.widget_tasks_prefix, openCount) + "  " + task
                headline.isNotEmpty() -> headline
                task.isNotEmpty() -> task
                else -> ""
            }
            if (secondLine.isNotEmpty()) {
                views.setViewVisibility(R.id.widget_second_row, View.VISIBLE)
                views.setTextViewText(R.id.widget_second_line, secondLine)
            } else {
                views.setViewVisibility(R.id.widget_second_row, View.GONE)
            }

            // Freshness stamp
            val updatedAt = WidgetStore.updatedAt(context)
            views.setTextViewText(
                R.id.widget_updated,
                if (updatedAt == 0L) {
                    context.getString(R.string.widget_never_updated)
                } else {
                    DateUtils.getRelativeTimeSpanString(
                        updatedAt,
                        System.currentTimeMillis(),
                        DateUtils.MINUTE_IN_MILLIS
                    ).toString()
                }
            )

            // Tapping the widget opens the dashboard and refreshes it.
            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(MainActivity.EXTRA_REFRESH, true)
            }
            views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(
                    context, 0, openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            // The refresh button updates in place without opening the app.
            val refreshIntent = Intent(context, DashboardWidgetProvider::class.java)
                .setAction(ACTION_REFRESH)
            views.setOnClickPendingIntent(
                R.id.widget_refresh,
                PendingIntent.getBroadcast(
                    context, 1, refreshIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            return views
        }

        private fun JSONObject.str(key: String): String = optString(key, "").trim()
    }
}

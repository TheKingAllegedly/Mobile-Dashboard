# Mobile Dashboard

Everything you need to know at a glance, on one screen, on your phone.

Weather, your calendar, headlines, markets, GitHub, and your own task list all
land on a single scrollable grid. It installs to your home screen like an app,
works offline with the last data it saw, and ships with a real Android
home-screen widget.

There is no account, no server and no sync. Every setting, token and note you
enter stays in your phone's storage.

---

## The two halves

| | What it is | What you get |
|---|---|---|
| `web/` | A static progressive web app. No build step, no framework. | The dashboard itself. Installable from any browser. |
| `android/` | A small Kotlin app that hosts the same web app. | A real home-screen widget, plus an offline copy in the APK. |

The web app is the single source of truth. The Android build copies `web/`
into the APK at compile time, so there is only ever one dashboard to maintain.

---

## Getting it on your Pixel

### Option A — the app with the widget (what you asked for)

The APK is built by GitHub Actions, so you never need Android Studio.

1. Push this branch. Open the repo's **Actions** tab and wait for the **CI**
   run to go green (about three minutes).
2. Open that run and download the **dashboard-apk** artifact. It arrives as a
   zip; unzip it on your phone to get `dashboard-<commit>.apk`.
3. Tap the APK. Android will ask whether to allow installs from your file
   manager or browser. Allow it, then install.
4. Open **Dashboard** once so it can set itself up.

If you are replacing an earlier build, install straight over it — your cards and
settings are kept.

To place the widget:

1. Long-press an empty spot on your home screen.
2. Tap **Widgets**, scroll to **Dashboard**.
3. Long-press the widget and drag it where you want it. Resize it by dragging
   the handles; it starts at four cells wide by two tall.

The widget shows the current temperature, the clock and date, your next
calendar event and either your open task count or the top headline. It
refreshes itself in the background every half hour, and tapping it opens the
dashboard and pulls fresh data. The small circular arrow updates it in place
without opening the app.

Prefer a tagged build? Push a tag starting with `v` and the **Release APK**
workflow attaches `dashboard.apk` to a GitHub release.

### Option B — install it as a web app (no widget, thirty seconds)

1. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Push to `main`. The **Deploy dashboard to GitHub Pages** workflow publishes
   `web/` and prints the URL.
3. Open that URL in Chrome on your Pixel, then **⋮ → Add to Home screen**.

This gives you the identical dashboard in a standalone window. Android does not
let a web app publish a home-screen widget, which is the one thing Option A
adds.

You can have both: install the APK and point it at your Pages URL from
**Settings → Run a hosted copy instead**. Then updating the dashboard is a
`git push` with no reinstall.

---

## The cards

Tap the **+** button to add one. Each card has its own settings behind the
**⋯** menu, and can be small, medium or wide. Drag a card to reorder it.

| Card | Needs | Notes |
|---|---|---|
| Weather | A place name, or location permission | Current conditions, 12 hours, 7 days. Open-Meteo, no key. |
| Air quality | Same | US AQI, particulates, pollen. |
| Calendar | An `.ics` URL | Google, Outlook and Apple all publish one. Handles repeating events. |
| Feed (RSS/Atom) | A feed URL | News sites, blogs, podcasts, YouTube channels. |
| Hacker News | Nothing | Top, best, new, Ask HN, Show HN. |
| Reddit | A subreddit | Hot, new, top today, rising. |
| GitHub | A repo, or your username | Commits, open issues, open PRs, or everything assigned to you. |
| Crypto | CoinGecko coin ids | Price and 24-hour change. |
| Stocks | Stooq symbols | US tickers end in `.us`; indexes look like `^spx`. |
| Clock | Nothing | Local time plus any time zones you list. |
| Tasks | Nothing | A checklist stored on the phone. |
| Notes | Nothing | A scratchpad that saves as you type. |
| Quick links | A list of links | One-tap shortcuts. |
| Custom JSON API | Any JSON endpoint | The escape hatch. Pull named values or a list out of any API. |

### Getting your calendar in

Google Calendar → **Settings** → pick your calendar → **Integrate calendar** →
copy the **Secret address in iCal format**. Paste that into the Calendar card.

That link is a password in disguise: anyone holding it can read your calendar.
See the proxy note below before you use it.

### The Custom JSON card

Point it at any endpoint and pull values out by path:

```
Server status = data.status
Users online  = stats.active[0].count
```

Use `[0]` for array positions. Switch the layout to **A list of items** to
render an array as rows instead, naming which field is the title, the subtitle
and the link.

---

## Where your data lives

In your browser's local storage on your phone. That is the whole story.

- No backend exists, so nothing is uploaded anywhere.
- API tokens you paste into a card are stored on the device and sent only to
  that card's own API.
- The Android app keeps the widget summary in its private preferences.
- **Settings → Copy backup** puts your whole configuration on the clipboard as
  JSON. **Restore backup** takes it back.

### The one exception: the CORS proxy

Calendar files, most RSS feeds, Reddit and Stooq refuse to answer a browser
directly. Those requests go through a proxy, which by default is a public one.
The operator of that proxy can see the URLs you fetch, and your calendar's
secret address is exactly the kind of URL that should not travel that way.

`worker/` holds a Cloudflare Worker that does the same job on your own account,
free, in about two minutes. Deploy it and paste its URL into
**Settings → CORS proxy**. See `worker/README.md`.

Cards that talk to APIs which allow browsers directly — weather, air quality,
Hacker News, GitHub, CoinGecko — never touch the proxy at all.

---

## Working on it

```bash
npm install
npm test                 # 20 checks: every source, plus a full app boot in jsdom
npm run serve            # http://localhost:8080
```

The tests run the real modules against mocked network responses in jsdom,
including the guards that keep feed content from injecting markup and keep
`javascript:` URLs out of links.

Building the Android app needs the Android SDK and JDK 17:

```bash
cd android
./gradlew assembleDebug
```

### Adding a card type

Every card is one file in `web/js/sources/`, exporting an object with a
`fields` schema, an async `load`, and a `render` that returns a DOM node. Add
an optional `widget` to contribute a line to the Android widget. Register it in
`web/js/core/registry.js` and it appears in the catalog with its own settings
form. Nothing else needs to change.

Content is built with `createElement` throughout and never `innerHTML`, so a
hostile feed cannot inject markup. Keep it that way.

### Layout

```
web/            the dashboard: index.html, css, js/core, js/sources
android/        Kotlin shell, home-screen widget, background refresh worker
worker/         optional private CORS proxy for Cloudflare
tests/          jsdom test suites
scripts/        local static server
```

# Private CORS proxy

The dashboard fetches everything straight from your phone. A few sources —
calendar `.ics` links, Reddit, Stooq, most RSS feeds — refuse cross-origin
browser requests, so those go through a proxy.

Out of the box the app uses a public one. That works, but the operator of that
proxy can see which feeds and calendars you read. Your calendar's secret `.ics`
address is exactly the sort of thing you do not want passing through someone
else's server.

Deploying your own takes about two minutes and costs nothing.

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

Wrangler prints a URL like `https://dashboard-proxy.you.workers.dev`. In the
dashboard, open Settings and set **CORS proxy** to:

```
https://dashboard-proxy.you.workers.dev/?url=
```

## The allowlist

`ALLOWED_HOSTS` in `index.js` limits what the proxy will fetch. Add the hosts
your own cards need. Keeping the list tight matters: anyone who learns your
worker's URL can make it fetch anything the list permits.

Setting `ENFORCE_ALLOWLIST = false` turns it into an open proxy. Convenient,
and a bad idea on a URL that ever leaves your device.

## What it will not do

- Non-https targets.
- Anything but `GET`.
- Responses over 5 MB.
- Forwarding your request headers upstream, so tokens you set on a card are
  never handed to the proxy. Keep the "route through the CORS proxy" switch off
  on any card that carries a token.

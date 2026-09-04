/**
 * A private CORS proxy for the dashboard.
 *
 * Some feeds and calendars refuse cross-origin browser requests. The dashboard
 * routes those through a proxy. The public default works, but it means a third
 * party sees which calendars and feeds you read. Deploy this to your own
 * Cloudflare account (free tier is plenty) and point the dashboard at it.
 *
 *   npx wrangler deploy
 *
 * Then in the dashboard: Settings → CORS proxy →
 *   https://your-worker.workers.dev/?url=
 */

/* Only these hosts may be fetched. Add your own; keep the list tight, because
   anything listed here can be requested by anyone who finds your worker URL. */
const ALLOWED_HOSTS = [
  'calendar.google.com',
  'outlook.office365.com',
  'outlook.live.com',
  'p01-calendars.icloud.com',
  'www.reddit.com',
  'oauth.reddit.com',
  'stooq.com',
  'feeds.bbci.co.uk',
  'rss.cnn.com',
  'feeds.npr.org',
  'www.youtube.com',
  'news.google.com'
];

/* Set to false to allow any host. Convenient, but then your worker is an open
   proxy: anyone who learns the URL can route traffic through it. */
const ENFORCE_ALLOWLIST = true;

const MAX_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return problem(405, 'Only GET is supported.');
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return problem(400, 'Add ?url= with the address to fetch.');

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return problem(400, 'That is not a valid URL.');
    }
    if (parsed.protocol !== 'https:') {
      return problem(400, 'Only https targets are allowed.');
    }
    if (ENFORCE_ALLOWLIST && !ALLOWED_HOSTS.includes(parsed.hostname)) {
      return problem(403, `${parsed.hostname} is not in this proxy's allowlist.`);
    }

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': 'MobileDashboard/1.0 (+personal use)',
          Accept: request.headers.get('Accept') || '*/*'
        },
        redirect: 'follow',
        cf: { cacheTtl: 120, cacheEverything: true }
      });
    } catch (e) {
      return problem(502, 'Could not reach that address.');
    }

    if (!upstream.ok) {
      return problem(upstream.status, `Upstream returned ${upstream.status}.`);
    }

    const length = parseInt(upstream.headers.get('Content-Length') || '0', 10);
    if (length > MAX_BYTES) return problem(413, 'That response is too large.');

    const headers = corsHeaders();
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=120');

    return new Response(upstream.body, { status: 200, headers });
  }
};

function corsHeaders() {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  });
}

function problem(status, message) {
  const headers = corsHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

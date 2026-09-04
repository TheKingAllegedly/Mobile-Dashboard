/* Network helpers: timeouts, CORS proxying, feed parsing, formatting. */
import { getSettings } from './store.js';

const DEFAULT_TIMEOUT = 15000;

export class FetchError extends Error {
  constructor(message, cause) { super(message); this.name = 'FetchError'; this.cause = cause; }
}

export async function fetchWithTimeout(url, opts = {}) {
  const ms = opts.timeout || DEFAULT_TIMEOUT;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new FetchError(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new FetchError(`Timed out after ${Math.round(ms / 1000)}s`);
    if (e instanceof FetchError) throw e;
    throw new FetchError(e.message || 'Network request failed', e);
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  try { return await res.json(); }
  catch { throw new FetchError('Response was not valid JSON'); }
}

export async function getText(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  return res.text();
}

/* Many feeds (RSS, ICS, some APIs) block cross-origin browser requests.
   Route those through a configurable proxy. */
export function proxied(url) {
  const proxy = (getSettings().proxy || '').trim();
  if (!proxy) return url;
  if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(url));
  return proxy + encodeURIComponent(url);
}

export async function getTextViaProxy(url, opts = {}) {
  try {
    return await getText(url, opts);
  } catch (direct) {
    const proxy = (getSettings().proxy || '').trim();
    if (!proxy) throw direct;
    try {
      return await getText(proxied(url), opts);
    } catch (viaProxy) {
      throw new FetchError(`${direct.message} (proxy also failed: ${viaProxy.message})`);
    }
  }
}

export async function getJSONViaProxy(url, opts = {}) {
  const text = await getTextViaProxy(url, opts);
  try { return JSON.parse(text); }
  catch { throw new FetchError('Response was not valid JSON'); }
}

/* ---------------- feed parsing ---------------- */

export function parseFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new FetchError('Feed is not valid XML');

  const out = { title: '', items: [] };
  const rssChannel = doc.querySelector('channel');
  if (rssChannel) {
    out.title = text(rssChannel.querySelector(':scope > title'));
    out.items = [...doc.querySelectorAll('item')].map(node => ({
      title: text(node.querySelector('title')) || '(untitled)',
      link: text(node.querySelector('link')),
      date: parseDate(text(node.querySelector('pubDate')) || text(node.querySelector('date'))),
      author: text(node.querySelector('creator')) || text(node.querySelector('author')),
      summary: stripHtml(text(node.querySelector('description')))
    }));
    return out;
  }

  const feed = doc.querySelector('feed');
  if (feed) {
    out.title = text(feed.querySelector(':scope > title'));
    out.items = [...doc.querySelectorAll('entry')].map(node => {
      const linkEl = node.querySelector('link[rel="alternate"]') || node.querySelector('link');
      return {
        title: text(node.querySelector('title')) || '(untitled)',
        link: linkEl ? (linkEl.getAttribute('href') || text(linkEl)) : '',
        date: parseDate(text(node.querySelector('published')) || text(node.querySelector('updated'))),
        author: text(node.querySelector('author > name')),
        summary: stripHtml(text(node.querySelector('summary')) || text(node.querySelector('content')))
      };
    });
    return out;
  }

  throw new FetchError('No RSS or Atom items found at that URL');
}

function text(node) { return node && node.textContent ? node.textContent.trim() : ''; }

export function stripHtml(s) {
  if (!s) return '';
  const el = document.createElement('div');
  el.innerHTML = s;
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/* ---------------- formatting ---------------- */

export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units = [
    [60000, 'm', 1000 * 60],
    [3600000, 'h', 1000 * 60 * 60],
    [86400000 * 7, 'd', 1000 * 60 * 60 * 24]
  ];
  if (abs < 60000) return future ? 'in a moment' : 'just now';
  for (const [limit, suffix, size] of units) {
    if (abs < limit * 60 || suffix === 'd') {
      const n = Math.round(abs / size);
      if (suffix !== 'd' || abs < 86400000 * 7) return future ? `in ${n}${suffix}` : `${n}${suffix} ago`;
    }
  }
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatTime(d, opts = {}) {
  const { hour12 } = getSettings();
  return new Date(d).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', hour12: !!hour12, ...opts
  });
}

export function formatDate(d, opts = {}) {
  return new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...opts });
}

export function compactNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function money(n, digits) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const d = digits !== undefined ? digits : (Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 2 : 6);
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

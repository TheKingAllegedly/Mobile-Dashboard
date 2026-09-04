import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../web');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// expose globals the modules expect
for (const k of ['window','document','navigator','localStorage','DOMParser','CustomEvent','Node','Element','HTMLElement','Intl','AbortController','location','fetch','Response','Headers','Request','requestAnimationFrame','setTimeout','clearTimeout','setInterval','clearInterval','getComputedStyle','crypto']) {
  if (k in window && globalThis[k] === undefined) globalThis[k] = window[k];
}
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.DOMParser = window.DOMParser;
globalThis.CustomEvent = window.CustomEvent;

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push(String(url));
  const u = String(url);
  const body = MOCKS(u);
  if (body === null) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}), text: async () => '' };
  return {
    ok: true, status: 200, statusText: 'OK',
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    clone() { return this; }
  };
};
window.fetch = globalThis.fetch;

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1
SUMMARY:Standup with the
  team
DTSTART;TZID=America/Chicago:${isoStamp(2)}
DTEND;TZID=America/Chicago:${isoStamp(2, 30)}
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
LOCATION:Zoom\\, room 3
END:VEVENT
BEGIN:VEVENT
UID:2
SUMMARY:Dentist
DTSTART:${utcStamp(26)}
DTEND:${utcStamp(27)}
END:VEVENT
BEGIN:VEVENT
UID:3
SUMMARY:Vacation
DTSTART;VALUE=DATE:${dateStamp(3)}
DTEND;VALUE=DATE:${dateStamp(5)}
END:VEVENT
END:VCALENDAR`;

function pad(n){return String(n).padStart(2,'0')}
function isoStamp(hoursAhead, mins = 0) {
  const d = new Date(Date.now() + hoursAhead * 3600e3 + mins * 60e3);
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function utcStamp(hoursAhead) {
  const d = new Date(Date.now() + hoursAhead * 3600e3);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
function dateStamp(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 864e5);
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

const nowIso = new Date().toISOString().slice(0, 13) + ':00';
function MOCKS(u) {
  if (u.includes('geocoding-api')) return { results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US', latitude: 30.27, longitude: -97.74 }] };
  if (u.includes('air-quality-api')) return { current: { us_aqi: 42, pm2_5: 8.4, pm10: 14.2, ozone: 61, nitrogen_dioxide: 9, grass_pollen: 3 } };
  if (u.includes('api.open-meteo.com')) return {
    current_units: { temperature_2m: '°F', wind_speed_10m: 'mph' },
    current: { time: nowIso, temperature_2m: 88.3, apparent_temperature: 95.1, relative_humidity_2m: 62, wind_speed_10m: 7.4, weather_code: 2, is_day: 1 },
    hourly: { time: [nowIso, bump(1), bump(2)], temperature_2m: [88, 90, 91], precipitation_probability: [10, 25, 40], weather_code: [2, 3, 61] },
    daily: { time: [today(0), today(1)], weather_code: [2, 61], temperature_2m_max: [95, 91], temperature_2m_min: [74, 72], precipitation_probability_max: [20, 60], sunrise: [today(0)+'T06:58'], sunset: [today(0)+'T20:12'] }
  };
  if (u.includes('topstories')) return [1, 2, 3];
  if (u.includes('/v0/item/')) { const id = u.match(/item\/(\d+)/)[1]; return { id: +id, title: 'Story ' + id, url: 'https://example.com/' + id, score: 10 * id, descendants: id * 2, time: Math.floor(Date.now()/1000) - 3600 }; }
  if (u.includes('coingecko')) return { bitcoin: { usd: 64231.55, usd_24h_change: 2.14, usd_market_cap: 1.2e12 }, ethereum: { usd: 3402.1, usd_24h_change: -1.02, usd_market_cap: 4e11 } };
  if (u.includes('stooq')) return 'Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-09-03,22:00:03,228.5,231.0,227.9,230.11,45000000\n^SPX,2026-09-03,22:00:03,5600.1,5650.0,5590.0,5644.5,0\n';
  if (u.includes('api.github.com/repos') && u.includes('/commits')) return [{ html_url: 'https://github.com/x/y/commit/1', commit: { message: 'Fix the thing\n\nlong body', author: { name: 'Levi', date: new Date(Date.now()-7200e3).toISOString() } } }];
  if (u.includes('api.github.com/search/issues')) return { items: [{ title: 'Investigate flake', html_url: 'https://github.com/x/y/issues/3', repository_url: 'https://api.github.com/repos/x/y', updated_at: new Date().toISOString(), pull_request: null }] };
  if (u.includes('reddit.com')) return { data: { children: [{ data: { title: 'Neat thing', permalink: '/r/tech/comments/1/neat', score: 412, num_comments: 88, subreddit_name_prefixed: 'r/technology', created_utc: Date.now()/1000 - 5400 } }] } };
  if (u.includes('allorigins') || u.includes('proxy')) {
    const inner = decodeURIComponent(u.split('url=')[1] || '');
    return MOCKS(inner);
  }
  if (u.includes('.ics') || u.includes('ical')) return ICS;
  if (u.includes('rss') || u.includes('feeds')) return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title><item><title>Headline one &amp; two</title><link>https://news.example.com/1</link><pubDate>${new Date(Date.now()-1800e3).toUTCString()}</pubDate><description>&lt;p&gt;Some &lt;b&gt;summary&lt;/b&gt; text.&lt;/p&gt;</description></item><item><title>Headline two</title><link>https://news.example.com/2</link><pubDate>${new Date(Date.now()-9000e3).toUTCString()}</pubDate></item></channel></rss>`;
  if (u.includes('customapi')) return { status: 'green', stats: { online: 1423 }, results: [{ title: 'Row A', author: 'me', url: 'https://e.test/a' }, { title: 'Row B', author: 'you', url: 'https://e.test/b' }] };
  return null;
}
function bump(h) { const d = new Date(Date.now() + h * 3600e3); return d.toISOString().slice(0,13) + ':00'; }
function today(offset) { const d = new Date(Date.now() + offset * 864e5); return d.toISOString().slice(0,10); }

const base = pathToFileURL(path.join(ROOT, 'js')).href + '/';
const { allSources, getSource } = await import(base + 'core/registry.js');
const { getSettings } = await import(base + 'core/store.js');

const CASES = [
  ['weather', { place: 'Austin, TX', view: 'full' }],
  ['clock', { zones: 'Mom = America/Denver\nEurope/London' }],
  ['calendar', { url: 'https://calendar.google.com/calendar/ical/x/basic.ics', days: 7, limit: 6 }],
  ['tasks', {}],
  ['news', { url: 'https://feeds.bbci.co.uk/news/rss.xml', limit: 3, showSummary: true }],
  ['hackernews', { list: 'top', limit: 3 }],
  ['reddit', { sub: 'technology', sort: 'hot', limit: 3 }],
  ['github', { mode: 'repo', repo: 'x/y', limit: 3 }],
  ['github', { mode: 'mine', user: 'levi', limit: 3 }],
  ['crypto', { coins: 'bitcoin,ethereum' }],
  ['stocks', { symbols: 'aapl.us,^spx' }],
  ['airquality', { place: 'Denver' }],
  ['notes', {}],
  ['links', { links: 'Gmail = https://mail.google.com\nBad = javascript:alert(1)' }],
  ['json', { url: 'https://customapi.test/s', mode: 'fields', paths: 'Status = status\nOnline = stats.online\nFirst row = results[0].title' }],
  ['json', { url: 'https://customapi.test/s', mode: 'listing', listPath: 'results', itemTitle: 'title', itemMeta: 'author', itemLink: 'url', limit: 5 }]
];

let pass = 0, fail = 0;
for (const [type, settings] of CASES) {
  const source = getSource(type);
  const card = { id: 'test_' + type + '_' + Math.random().toString(36).slice(2,6), type, settings, title: '', span: 2 };
  const label = `${type} ${JSON.stringify(settings).slice(0, 46)}`;
  try {
    const payload = await source.load({ card, settings });
    const node = source.render(payload, { card, settings, rerender() {} });
    const probe = document.createElement('div'); probe.append(node);
    const fields = [...probe.querySelectorAll('textarea,input')].map(n => n.value || n.placeholder || n.type).join(' ');
    const text = ((node.textContent || '') + ' ' + fields).replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('rendered nothing');
    let widgetOut = '';
    if (source.widget) widgetOut = JSON.stringify(source.widget(payload, { card, settings }));
    console.log(`PASS  ${label}\n      → ${text.slice(0, 110)}`);
    if (widgetOut && widgetOut !== '{}') console.log(`      widget ${widgetOut.slice(0, 110)}`);
    pass++;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${e && e.stack ? e.stack.split('\n').slice(0,3).join(' | ') : e}`);
    fail++;
  }
}

// XSS guard: a feed item whose title contains markup must render as text
const news = getSource('news');
const evil = { items: [{ title: '<img src=x onerror=alert(1)>', link: 'https://e.test/x', date: Date.now(), summary: '', host: 'e.test' }] };
const evilNode = news.render(evil, { card: { id: 'x' }, settings: {} });
const wrapper = document.createElement('div');
wrapper.append(evilNode);
if (wrapper.querySelector('img')) { console.log('FAIL  xss: markup in a headline became a real element'); fail++; }
else { console.log('PASS  xss: markup in a headline stays plain text'); pass++; }

// link scheme guard
const linksNode = getSource('links').render({}, { card: {}, settings: { links: 'Bad = javascript:alert(1)\nGood = https://ok.test' } });
const w2 = document.createElement('div'); w2.append(linksNode);
const hrefs = [...w2.querySelectorAll('a')].map(a => a.getAttribute('href'));
if (hrefs.some(h => /^javascript:/i.test(h))) { console.log('FAIL  link scheme: javascript: url survived'); fail++; }
else { console.log('PASS  link scheme: only http(s) links are emitted (' + hrefs.join(', ') + ')'); pass++; }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

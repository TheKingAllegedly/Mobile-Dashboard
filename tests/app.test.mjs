import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../web');
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  { url: 'https://example.test/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = window.localStorage;
globalThis.DOMParser = window.DOMParser;
globalThis.CustomEvent = window.CustomEvent;
globalThis.location = window.location;

const published = [];
let hostedUrl = '';
window.DashboardHost = {
  publishWidgetData: json => published.push(JSON.parse(json)),
  isAndroidHost: () => true,
  getHomeUrl: () => hostedUrl,
  setHomeUrl: url => { if (url && !url.startsWith('https://')) return false; hostedUrl = url; return true; },
  refreshWidget: () => { published.push({ widgetRefreshRequested: true }); }
};

const nowIso = new Date().toISOString().slice(0, 13) + ':00';
function today(o){ return new Date(Date.now()+o*864e5).toISOString().slice(0,10); }
globalThis.fetch = window.fetch = async (u) => {
  u = String(u);
  let body = null;
  if (u.includes('geocoding-api')) body = { results: [{ name: 'Austin', admin1: 'TX', country_code: 'US', latitude: 30, longitude: -97 }] };
  else if (u.includes('api.open-meteo.com')) body = {
    current_units: { temperature_2m: '°F', wind_speed_10m: 'mph' },
    current: { time: nowIso, temperature_2m: 88, apparent_temperature: 95, relative_humidity_2m: 60, wind_speed_10m: 7, weather_code: 1, is_day: 1 },
    hourly: { time: [nowIso], temperature_2m: [88], precipitation_probability: [5], weather_code: [1] },
    daily: { time: [today(0)], weather_code: [1], temperature_2m_max: [95], temperature_2m_min: [74], precipitation_probability_max: [10], sunrise: [today(0)+'T07:00'], sunset: [today(0)+'T20:00'] }
  };
  else if (u.includes('topstories')) body = [11, 12];
  else if (u.includes('/v0/item/')) { const id = u.match(/item\/(\d+)/)[1]; body = { id: +id, title: 'HN story ' + id, url: 'https://e.test/' + id, score: 5, descendants: 1, time: Math.floor(Date.now()/1000) }; }
  else if (u.includes('rss') || u.includes('feeds')) body = `<?xml version="1.0"?><rss version="2.0"><channel><title>World news</title><item><title>Big story today</title><link>https://n.test/1</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  if (body === null) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '', json: async () => ({}) };
  return { ok: true, status: 200, statusText: 'OK', clone(){return this;},
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body) : body };
};

// geolocation is denied, so the starter weather card must fall back cleanly
Object.defineProperty(window.navigator, 'geolocation', {
  value: { getCurrentPosition: (_ok, err) => err({ code: 1 }) }, configurable: true
});

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '\n      ' + extra : ''));
  if (!cond) fails++;
};

await import(pathToFileURL(path.join(ROOT, 'js', 'main.js')).href);
await new Promise(r => setTimeout(r, 900));

const d = window.document;
const cards = [...d.querySelectorAll('.card')];
check('starter cards were seeded', cards.length === 5, `${cards.length} cards: ` + cards.map(c => c.querySelector('.card-title').textContent).join(', '));
check('greeting rendered', /morning|afternoon|evening|late/i.test(d.getElementById('greetingText').textContent),
  d.getElementById('greetingText').textContent + ' — ' + d.getElementById('greetingSub').textContent);

const weatherCard = cards.find(c => /weather/i.test(c.querySelector('.card-title').textContent));
const wText = weatherCard.querySelector('.card-body').textContent;
check('weather card degraded with a readable error when location was denied',
  /permission denied|Location/i.test(wText), wText.slice(0, 120));

const newsCard = cards.find(c => /world news/i.test(c.querySelector('.card-title').textContent));
check('news card rendered its headline', /Big story today/.test(newsCard.textContent), newsCard.querySelector('.card-body').textContent.slice(0, 90));

const hnCard = cards.find(c => /hacker/i.test(c.querySelector('.card-title').textContent));
check('hacker news card rendered', /HN story/.test(hnCard.textContent), hnCard.querySelector('.card-body').textContent.slice(0, 90));

check('failed cards are surfaced in the status strip',
  !d.getElementById('statusStrip').hidden && /failed/.test(d.getElementById('statusStrip').textContent),
  d.getElementById('statusStrip').textContent);

check('widget payload was handed to the Android host', published.length > 0,
  JSON.stringify(published[published.length - 1] || {}).slice(0, 200));
const wp = published[published.length - 1] || {};
check('widget payload carries a headline and task count', !!wp.headline && wp.tasksOpen !== undefined, JSON.stringify(wp));

// interactions
d.getElementById('settingsBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 50));
check('settings sheet opens', !!d.querySelector('.sheet'), d.querySelector('.sheet h2') ? d.querySelector('.sheet h2').textContent : '');

const sheetText = d.querySelector('.sheet').textContent;
check('android shell gets widget setup instead of the install prompt',
  /On this phone/.test(sheetText) && /Widgets/.test(sheetText) && !/Install on this phone/.test(sheetText));

const applyBtn = [...d.querySelectorAll('.sheet .btn')].find(b => b.textContent === 'Apply');
const hostedField = [...d.querySelectorAll('.sheet input[type=url]')].pop();
hostedField.value = 'http://insecure.test/';
applyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check('a non-https hosted url is rejected', hostedUrl === '' && /https/i.test(d.querySelector('.toast')?.textContent || ''),
  'toast: ' + (d.querySelector('.toast')?.textContent || 'none'));
hostedField.value = 'https://levi.github.io/Mobile-Dashboard/';
applyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 30));
check('an https hosted url is accepted', hostedUrl === 'https://levi.github.io/Mobile-Dashboard/', hostedUrl);

d.querySelector('.scrim').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 50));
check('settings sheet closes', !d.querySelector('.sheet'));

d.getElementById('addFab').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 50));
const catItems = [...d.querySelectorAll('.cat-item')];
check('catalog lists every card type', catItems.length === 14, catItems.length + ' types');
const notesBtn = catItems.find(b => /Notes/.test(b.textContent));
notesBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 200));
check('adding a no-config card works immediately', d.querySelectorAll('.card').length === 6,
  d.querySelectorAll('.card').length + ' cards now');

// card menu -> remove
const last = [...d.querySelectorAll('.card')].pop();
last.querySelector('.card-menu').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 50));
const removeBtn = [...d.querySelectorAll('.sheet .btn')].find(b => /Remove/.test(b.textContent));
removeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 100));
check('removing a card works', d.querySelectorAll('.card').length === 5,
  d.querySelectorAll('.card').length + ' cards left');

// config survives a reload
const saved = JSON.parse(window.localStorage.getItem('md.config.v3'));
check('config persisted to localStorage', saved && saved.cards.length === 5, (saved ? saved.cards.map(c=>c.type).join(',') : 'none'));

console.log(`\n${fails ? fails + ' FAILED' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);

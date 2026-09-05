/*
 * One case per bug that reached a build. Each of these passed the rest of the
 * suite while being wrong, so they are pinned here by behaviour rather than by
 * shape.
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../web');
const dom = new JSDOM('<!doctype html><body>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.CustomEvent = dom.window.CustomEvent;

let fetchBody = null;
globalThis.fetch = async (url) => {
  /* Geocoding is incidental to every weather case here, so answer it once. */
  if (String(url).includes('geocoding-api')) {
    const place = { results: [{ name: 'Austin', admin1: 'TX', country_code: 'US', latitude: 30, longitude: -97 }] };
    return { ok: true, status: 200, statusText: 'OK', clone() { return this; },
      text: async () => JSON.stringify(place), json: async () => place };
  }
  if (fetchBody === null) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '', json: async () => ({}) };
  return {
    ok: true, status: 200, statusText: 'OK', clone() { return this; },
    text: async () => (typeof fetchBody === 'string' ? fetchBody : JSON.stringify(fetchBody)),
    json: async () => (typeof fetchBody === 'string' ? JSON.parse(fetchBody) : fetchBody)
  };
};

const mod = p => import(pathToFileURL(path.join(ROOT, p)).href);
const { relativeTime } = await mod('js/core/net.js');
const store = await mod('js/core/store.js');
const calendar = (await mod('js/sources/calendar.js')).default;
const github = (await mod('js/sources/github.js')).default;
const weather = (await mod('js/sources/weather.js')).default;

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '\n      ' + extra : ''));
  if (!cond) fails++;
};

/* ---- relative time must never spill into the unit above it ---- */
{
  const now = Date.now();
  const cases = [
    ['45s', 45e3, '1m ago'],
    ['59m 59s', 3599e3, '59m ago'],
    ['23h 37m', 85000e3, '23h ago'],
    ['6d 22h', 600000e3, '6d ago']
  ];
  for (const [label, ms, expected] of cases) {
    const got = relativeTime(now - ms);
    check(`relativeTime(${label}) is "${expected}"`, got === expected, `got "${got}"`);
  }
  const old = relativeTime(now - 20 * 864e5);
  check('relativeTime past a week falls back to a date', !/ago$/.test(old), old);
}

/* ---- a recurrence that started years ago still reaches today ---- */
{
  const pad = n => String(n).padStart(2, '0');
  const icsFor = (daysAgo, rule) => {
    const d = new Date(Date.now() - daysAgo * 864e5);
    const stamp = suffix =>
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${suffix}Z`;
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:r', 'SUMMARY:Standup',
      `DTSTART:${stamp('140000')}`, `DTEND:${stamp('141500')}`,
      `RRULE:${rule}`, 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
  };
  const load = async (daysAgo, rule) => {
    fetchBody = icsFor(daysAgo, rule);
    const out = await calendar.load({ settings: { url: 'https://c.test/c.ics', days: 7, limit: 20 }, card: {} });
    return out.events.length;
  };

  const weekday = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  const recent = await load(30, weekday);
  const ancient = await load(4000, weekday);
  check('a weekday rule started 11 years ago still yields this week',
    ancient === recent && ancient > 0, `30d ago: ${recent}, 4000d ago: ${ancient}`);

  const daily = await load(3000, 'FREQ=DAILY');
  check('a daily rule started 8 years ago still yields this week', daily >= 7, `${daily} occurrences`);

  /* The jump forward must land on the rule's own cadence, not just near it. */
  const fortnightly = await load(3000, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE');
  check('a fortnightly rule keeps its alternate-week alignment',
    fortnightly <= 1, `${fortnightly} occurrences in 7 days`);

  /* COUNT is spent long before today, so nothing should survive to now. */
  const counted = await load(3000, 'FREQ=WEEKLY;BYDAY=MO;COUNT=5');
  check('COUNT still limits an old rule to its first few occurrences',
    counted === 0, `${counted} occurrences`);
}

/* ---- a commit with no git author must not fail the whole card ---- */
{
  fetchBody = [
    { html_url: 'https://github.com/x/y/commit/1', commit: { message: 'No author here', author: null } },
    { html_url: 'https://github.com/x/y/commit/2', commit: { message: 'Fine', author: { name: 'Levi', date: new Date().toISOString() } } }
  ];
  let payload = null;
  let threw = null;
  try {
    payload = await github.load({ settings: { mode: 'repo', repo: 'x/y', limit: 5 }, card: {} });
  } catch (e) { threw = e; }
  check('a commit with a null author does not throw', !threw, threw ? threw.message : '');
  check('both commits still render', payload && payload.items.length === 2,
    payload ? payload.items.map(i => i.meta).join(' | ') : '');
}

/* ---- the hourly strip starts at the hour actually in progress ---- */
{
  const iso = d => d.toISOString().slice(0, 13) + ':00';
  const hourNow = new Date();
  hourNow.setMinutes(0, 0, 0);
  const hours = [0, 1, 2, 3].map(h => iso(new Date(hourNow.getTime() + h * 3600e3)));
  const day = new Date().toISOString().slice(0, 10);

  fetchBody = {
    current_units: { temperature_2m: '°F', wind_speed_10m: 'mph' },
    /* Open-Meteo reports the current time to the quarter hour. */
    current: {
      time: iso(hourNow).slice(0, 11) + String(hourNow.getHours()).padStart(2, '0') + ':45',
      temperature_2m: 70, apparent_temperature: 70, relative_humidity_2m: 50,
      wind_speed_10m: 5, weather_code: 0, is_day: 1
    },
    hourly: {
      time: hours,
      temperature_2m: [70, 71, 72, 73],
      precipitation_probability: [0, 0, 0, 0],
      weather_code: [0, 0, 0, 0]
    },
    daily: {
      time: [day], weather_code: [0], temperature_2m_max: [80], temperature_2m_min: [60],
      precipitation_probability_max: [0], sunrise: [day + 'T07:00'], sunset: [day + 'T20:00']
    }
  };
  const out = await weather.load({ settings: { place: 'Austin' }, card: {} });
  check('the hourly strip includes the hour in progress',
    out.hourly.length && out.hourly[0].time === hours[0],
    `first cell ${out.hourly[0] && out.hourly[0].time}, current hour ${hours[0]}`);
}

/* ---- the refresh window survives a blank or nonsense setting ---- */
{
  const cases = [
    ['blank', null, 15 * 60000],
    ['empty string', '', 15 * 60000],
    ['zero', 0, 15 * 60000],
    ['negative', -5, 15 * 60000],
    ['absurd', 99999, 240 * 60000],
    ['normal', 30, 30 * 60000]
  ];
  for (const [label, value, expected] of cases) {
    store.setSettings({ refreshMinutes: value });
    const got = store.getRefreshWindowMs();
    check(`refresh window with a ${label} setting is ${expected / 60000} minutes`,
      got === expected, `got ${got / 60000} minutes`);
  }
  store.setSettings({ refreshMinutes: 15 });
}

/* ---- the offline data cache must outlive an app update ---- */
{
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const dataCache = sw.match(/const DATA_CACHE\s*=\s*([^;]+);/);
  check('the data cache name is not derived from VERSION',
    !!dataCache && !/VERSION/.test(dataCache[1]),
    dataCache ? dataCache[1].trim() : 'not found');
  check('the activate sweep spares the data cache',
    /k !== DATA_CACHE/.test(sw));
}

console.log(`\n${fails ? fails + ' FAILED' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);

/* Every card type the dashboard knows about. */
import weather from '../sources/weather.js';
import clock from '../sources/clock.js';
import calendar from '../sources/calendar.js';
import news from '../sources/news.js';
import hackernews from '../sources/hackernews.js';
import reddit from '../sources/reddit.js';
import github from '../sources/github.js';
import crypto from '../sources/crypto.js';
import stocks from '../sources/stocks.js';
import airquality from '../sources/airquality.js';
import tasks from '../sources/tasks.js';
import notes from '../sources/notes.js';
import links from '../sources/links.js';
import json from '../sources/json.js';

const SOURCES = [
  weather, calendar, clock, tasks, news, hackernews,
  reddit, github, crypto, stocks, airquality, notes, links, json
];

const BY_TYPE = new Map(SOURCES.map(s => [s.type, s]));

export function allSources() { return SOURCES; }
export function getSource(type) { return BY_TYPE.get(type) || null; }

/* A sensible first screen for someone who just installed the app. */
export const STARTER_CARDS = [
  { type: 'clock', settings: {} },
  { type: 'weather', settings: { view: 'full', useDeviceLocation: true } },
  { type: 'tasks', settings: {} },
  { type: 'news', settings: { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', limit: 5 }, title: 'World news' },
  { type: 'hackernews', settings: { list: 'top', limit: 5 } }
];

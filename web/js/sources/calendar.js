/* Upcoming events from any iCalendar (.ics) URL — Google Calendar's secret
   address, Outlook's published calendar, Apple Calendar's public link, etc. */
import { getTextViaProxy, formatTime } from '../core/net.js';
import { el, list } from '../core/ui.js';

/* ---- ICS parsing ---- */

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(s) {
  return String(s || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDate(value, params) {
  const raw = String(value || '').trim();
  const dateOnly = /^\d{8}$/.test(raw);
  if (dateOnly) {
    const y = +raw.slice(0, 4), m = +raw.slice(4, 6) - 1, d = +raw.slice(6, 8);
    return { ms: new Date(y, m, d, 0, 0, 0).getTime(), allDay: true };
  }
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : { ms: t, allDay: false };
  }
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };

  const tzid = params && params.TZID;
  const localGuess = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  if (!tzid) return { ms: localGuess, allDay: false };

  /* Interpret the wall-clock time in the event's own zone. */
  try {
    const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    const offset = zoneOffsetMs(asUtc, tzid);
    return { ms: asUtc - offset, allDay: false };
  } catch {
    return { ms: localGuess, allDay: false };
  }
}

function zoneOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second);
  return asIfUtc - utcMs;
}

function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const bits = left.split(';');
  const name = bits[0].toUpperCase();
  const params = {};
  for (const bit of bits.slice(1)) {
    const eq = bit.indexOf('=');
    if (eq > 0) params[bit.slice(0, eq).toUpperCase()] = bit.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

export function parseIcs(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;
    if (name === 'SUMMARY') cur.summary = unescapeText(value);
    else if (name === 'LOCATION') cur.location = unescapeText(value);
    else if (name === 'DTSTART') cur.start = parseIcsDate(value, params);
    else if (name === 'DTEND') cur.end = parseIcsDate(value, params);
    else if (name === 'RRULE') cur.rrule = value;
    else if (name === 'STATUS') cur.status = value.toUpperCase();
    else if (name === 'UID') cur.uid = value;
  }
  return events.filter(e => e.start && e.status !== 'CANCELLED');
}

const DAY = 86400000;
const WEEKDAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function startOfWeek(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

/* Expand simple recurrence rules into concrete occurrences inside a window. */
function expand(event, fromMs, toMs) {
  const startMs = event.start.ms;
  const durationMs = event.end ? Math.max(0, event.end.ms - startMs) : (event.start.allDay ? DAY : 3600000);

  if (!event.rrule) {
    return (startMs + durationMs >= fromMs && startMs <= toMs) ? [{ startMs, durationMs }] : [];
  }

  const rule = {};
  for (const part of event.rrule.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = (rule.FREQ || '').toUpperCase();
  const interval = Math.max(1, parseInt(rule.INTERVAL || '1', 10) || 1);
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
  const untilParsed = rule.UNTIL ? parseIcsDate(rule.UNTIL, {}) : null;
  const until = untilParsed ? untilParsed.ms : null;
  const byDay = rule.BYDAY
    ? rule.BYDAY.split(',').map(d => WEEKDAY_INDEX[d.trim().slice(-2).toUpperCase()]).filter(n => n !== undefined)
    : null;

  const out = [];
  const hardStop = Math.min(toMs, fromMs + 400 * DAY);
  let emitted = 0;
  let cursor = new Date(startMs);
  const guardMax = 2000;

  for (let step = 0; step < guardMax; step++) {
    const occMs = cursor.getTime();
    if (occMs > hardStop) break;
    if (until !== null && occMs > until) break;
    if (count !== null && emitted >= count) break;

    let ok = true;
    if (freq === 'WEEKLY' && byDay && byDay.length) {
      const weeksApart = Math.floor((startOfWeek(occMs) - startOfWeek(startMs)) / (7 * DAY));
      ok = byDay.includes(cursor.getDay()) && weeksApart % interval === 0;
    }
    if (ok) {
      emitted++;
      if (occMs + durationMs >= fromMs) out.push({ startMs: occMs, durationMs });
    }

    if (freq === 'DAILY') cursor = new Date(occMs + interval * DAY);
    else if (freq === 'WEEKLY') {
      if (byDay && byDay.length) cursor = new Date(occMs + DAY);
      else cursor = new Date(occMs + interval * 7 * DAY);
    } else if (freq === 'MONTHLY') {
      const d = new Date(occMs); d.setMonth(d.getMonth() + interval); cursor = d;
    } else if (freq === 'YEARLY') {
      const d = new Date(occMs); d.setFullYear(d.getFullYear() + interval); cursor = d;
    } else break;

    if (out.length > 60) break;
  }
  return out;
}

export default {
  type: 'calendar',
  name: 'Calendar',
  emoji: '📅',
  blurb: 'Upcoming events from a Google, Outlook or Apple .ics link',
  defaultSpan: 2,
  fields: [
    { key: 'url', type: 'url', label: 'Calendar .ics URL',
      placeholder: 'https://calendar.google.com/calendar/ical/.../basic.ics',
      help: 'Google Calendar → Settings → your calendar → “Secret address in iCal format”. Keep that link private.' },
    { key: 'days', type: 'number', label: 'Days ahead', default: 7, min: 1, max: 60 },
    { key: 'limit', type: 'number', label: 'Events to show', default: 6, min: 1, max: 25 }
  ],
  defaultTitle: () => 'Calendar',

  async load({ settings }) {
    if (!settings.url) throw new Error('Add your calendar’s .ics URL in this card’s settings.');
    const text = await getTextViaProxy(settings.url, { timeout: 25000 });
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That URL did not return an iCalendar file.');
    const events = parseIcs(text);

    const now = Date.now();
    const days = Math.max(1, Math.min(60, settings.days || 7));
    const until = now + days * DAY;
    const occurrences = [];
    for (const ev of events) {
      for (const occ of expand(ev, now - 2 * 3600000, until)) {
        occurrences.push({
          summary: ev.summary || '(no title)',
          location: ev.location || '',
          allDay: !!ev.start.allDay,
          startMs: occ.startMs,
          endMs: occ.startMs + occ.durationMs
        });
      }
    }
    occurrences.sort((a, b) => a.startMs - b.startMs);
    const limit = Math.max(1, Math.min(25, settings.limit || 6));
    return { events: occurrences.slice(0, limit), total: occurrences.length };
  },

  render(p) {
    if (!p.events.length) return el('p', { class: 'muted', text: 'Nothing scheduled in this window.' });
    const todayStr = new Date().toDateString();
    const tomorrowStr = new Date(Date.now() + DAY).toDateString();

    return list(p.events, ev => {
      const start = new Date(ev.startMs);
      const dayStr = start.toDateString();
      const dayLabel = dayStr === todayStr ? 'Today'
        : dayStr === tomorrowStr ? 'Tomorrow'
        : start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const timeLabel = ev.allDay ? 'All day' : formatTime(ev.startMs);
      const live = Date.now() >= ev.startMs && Date.now() < ev.endMs;

      return el('div', { class: 'row', style: 'gap:11px;align-items:flex-start' }, [
        el('div', { style: 'flex:none;width:58px;text-align:left' }, [
          el('div', { class: 'faint', style: 'font-size:11px;text-transform:uppercase;letter-spacing:.05em', text: dayLabel }),
          el('div', { class: 'mono', style: 'font-size:13.5px;font-weight:600;margin-top:1px', text: timeLabel })
        ]),
        el('div', { style: 'min-width:0;flex:1' }, [
          el('div', { class: 'item-title', text: ev.summary }),
          ev.location ? el('div', { class: 'item-meta', text: ev.location }) : null
        ]),
        live ? el('span', { class: 'pill', style: 'background:var(--accent);color:var(--accent-ink)', text: 'now' }) : null
      ]);
    });
  },

  widget(p) {
    const next = p.events[0];
    if (!next) return { nextEvent: 'Nothing scheduled', nextEventTime: '' };
    const start = new Date(next.startMs);
    const isToday = start.toDateString() === new Date().toDateString();
    return {
      nextEvent: next.summary,
      nextEventTime: next.allDay
        ? (isToday ? 'Today · all day' : start.toLocaleDateString(undefined, { weekday: 'short' }) + ' · all day')
        : (isToday ? formatTime(next.startMs)
                   : start.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + formatTime(next.startMs))
    };
  }
};

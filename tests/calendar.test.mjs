/* Focused checks on the iCalendar parser: time zones, all-day events and
   recurrence. These assert exact results, where the source suite only checks
   that a card renders something. */
import { JSDOM } from 'jsdom';
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

const { parseIcs } = await import(pathToFileURL(path.join(ROOT, 'js/sources/calendar.js')).href);

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '\n      ' + extra : ''));
  if (!cond) fails++;
};

/* Line folding, escaped characters, a UTC stamp, a zoned stamp, an all-day
   event, a cancelled event and a recurrence rule, all in one file. */
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:utc-1',
  'SUMMARY:Launch review',
  'DTSTART:20260610T150000Z',
  'DTEND:20260610T160000Z',
  'LOCATION:Room A\\, second floor',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:zoned-1',
  'SUMMARY:Standup with the ',
  ' whole team',
  'DTSTART;TZID=America/Chicago:20260610T090000',
  'DTEND;TZID=America/Chicago:20260610T091500',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-1',
  'SUMMARY:Conference',
  'DTSTART;VALUE=DATE:20260615',
  'DTEND;VALUE=DATE:20260618',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cancelled-1',
  'SUMMARY:Scrapped meeting',
  'DTSTART:20260611T150000Z',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'SUMMARY:Weekly sync',
  'DTSTART:20260601T140000Z',
  'DTEND:20260601T150000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const events = parseIcs(ICS);

check('cancelled events are dropped',
  events.length === 4 && !events.some(e => e.summary === 'Scrapped meeting'),
  events.map(e => e.summary).join(' | '));

const utc = events.find(e => e.summary === 'Launch review');
check('a UTC stamp keeps its exact instant',
  utc.start.ms === Date.UTC(2026, 5, 10, 15, 0, 0),
  new Date(utc.start.ms).toISOString());

check('escaped commas are unescaped',
  utc.location === 'Room A, second floor', JSON.stringify(utc.location));

const folded = events.find(e => e.summary.startsWith('Standup'));
check('folded lines are rejoined without the leading space',
  folded.summary === 'Standup with the whole team', JSON.stringify(folded.summary));

/* 09:00 in Chicago on 10 June 2026 is CDT, UTC-5, so 14:00 UTC. */
check('a TZID stamp is read in the event’s own time zone, not the phone’s',
  folded.start.ms === Date.UTC(2026, 5, 10, 14, 0, 0),
  new Date(folded.start.ms).toISOString());

const allDay = events.find(e => e.summary === 'Conference');
check('an all-day event is flagged and starts at local midnight',
  allDay.start.allDay === true && new Date(allDay.start.ms).getHours() === 0,
  new Date(allDay.start.ms).toString());

const weekly = events.find(e => e.summary === 'Weekly sync');
check('a recurrence rule is carried through for expansion',
  weekly.rrule === 'FREQ=WEEKLY;BYDAY=MO;COUNT=4', weekly.rrule);

/* A calendar with no events at all should parse rather than throw. */
check('an empty calendar parses to no events',
  parseIcs('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR').length === 0);

console.log(`\n${fails ? fails + ' FAILED' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);

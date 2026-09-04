/* Time, date, and optional world clocks. Fully local. */
import { el, list } from '../core/ui.js';
import { getSettings } from '../core/store.js';

function timeIn(tz) {
  const { hour12 } = getSettings();
  try {
    return new Date().toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', hour12: !!hour12, timeZone: tz || undefined
    });
  } catch { return '—'; }
}

function dayIn(tz) {
  try {
    return new Date().toLocaleDateString(undefined, { weekday: 'short', timeZone: tz || undefined });
  } catch { return ''; }
}

export default {
  type: 'clock',
  name: 'Clock',
  emoji: '🕐',
  blurb: 'Local time, date, and other time zones',
  defaultSpan: 2,
  local: true,
  tick: 1000,
  fields: [
    { key: 'zones', type: 'textarea', label: 'Extra time zones',
      placeholder: 'America/New_York\nEurope/London\nAsia/Tokyo',
      help: 'One IANA time zone per line. Optionally "Label = Zone", e.g. "Mom = America/Denver".' }
  ],
  defaultTitle: () => 'Clock',

  async load() { return { at: Date.now() }; },

  render(_p, { settings }) {
    const wrap = el('div', { class: 'stack' });
    wrap.append(el('div', {}, [
      el('div', { class: 'big-num mono', text: timeIn() }),
      el('div', { class: 'muted', style: 'font-size:13.5px;margin-top:4px',
        text: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) })
    ]));

    const zones = String(settings.zones || '')
      .split('\n').map(s => s.trim()).filter(Boolean)
      .map(line => {
        const i = line.indexOf('=');
        return i > 0
          ? { label: line.slice(0, i).trim(), tz: line.slice(i + 1).trim() }
          : { label: line.split('/').pop().replace(/_/g, ' '), tz: line };
      });

    if (zones.length) {
      wrap.append(list(zones, z => el('div', { class: 'row between' }, [
        el('span', { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px', text: z.label }),
        el('span', { class: 'mono', style: 'flex:none;font-size:14px' }, [
          el('span', { class: 'faint', style: 'font-size:11.5px;margin-right:6px', text: dayIn(z.tz) }),
          timeIn(z.tz)
        ])
      ])));
    }
    return wrap;
  }
};

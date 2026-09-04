/* Fast access to the places you open all day. */
import { el, safeLink } from '../core/ui.js';

export default {
  type: 'links',
  name: 'Quick links',
  emoji: '🔗',
  blurb: 'One tap to the sites and apps you use most',
  defaultSpan: 2,
  local: true,
  fields: [
    { key: 'links', type: 'textarea', label: 'Links',
      placeholder: 'Gmail = https://mail.google.com\nBank = https://…',
      default: 'Gmail = https://mail.google.com\nCalendar = https://calendar.google.com\nDrive = https://drive.google.com',
      help: 'One per line, written as "Label = URL".' }
  ],
  defaultTitle: () => 'Quick links',

  async load() { return { at: Date.now() }; },

  render(_p, { settings }) {
    const rows = String(settings.links || '').split('\n').map(s => s.trim()).filter(Boolean)
      .map(line => {
        const i = line.indexOf('=');
        return i > 0
          ? { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() }
          : { label: line, url: line };
      });
    if (!rows.length) return el('p', { class: 'muted', text: 'Add some links in this card’s settings.' });

    const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' });
    for (const r of rows) {
      grid.append(safeLink(r.url, r.label, {
        class: 'btn sm',
        style: 'text-decoration:none;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block'
      }));
    }
    return grid;
  }
};

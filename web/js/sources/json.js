/* The catch-all: point it at any JSON API and pull out the values you care about.
   Anything with a public REST endpoint can become a card with this. */
import { getJSON, getJSONViaProxy, compactNumber } from '../core/net.js';
import { el, kv, list, safeLink } from '../core/ui.js';

/* Path syntax: dot for objects, [n] for arrays. e.g. data.items[0].name */
export function pluck(obj, path) {
  if (!path) return obj;
  let cur = obj;
  const parts = String(path).split('.').filter(p => p !== '');
  for (const part of parts) {
    const match = part.match(/^([^[\]]*)((\[\d+\])*)$/);
    if (!match) return undefined;
    const [, key, brackets] = match;
    if (key) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[key];
    }
    if (brackets) {
      for (const idx of brackets.match(/\d+/g) || []) {
        if (!Array.isArray(cur)) return undefined;
        cur = cur[parseInt(idx, 10)];
      }
    }
  }
  return cur;
}

function display(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Math.abs(value) >= 10000 ? compactNumber(value) : String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60);
  return String(value);
}

function parseHeaders(text) {
  const headers = {};
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return headers;
}

export default {
  type: 'json',
  name: 'Custom JSON API',
  emoji: '🧩',
  blurb: 'Pull values out of any JSON endpoint — sports, servers, sensors, anything',
  defaultSpan: 2,
  fields: [
    { key: 'url', type: 'url', label: 'Endpoint URL', placeholder: 'https://api.example.com/status' },
    { key: 'mode', type: 'select', label: 'Layout', default: 'fields', options: [
      { value: 'fields', label: 'Labelled values' },
      { value: 'listing', label: 'A list of items' }
    ] },
    { key: 'paths', type: 'textarea', label: 'Values to show',
      placeholder: 'Status = data.status\nUsers online = stats.online',
      help: 'One per line: "Label = path.to.value". Use [0] for array items, e.g. items[0].title.' },
    { key: 'listPath', label: 'List path', placeholder: 'results',
      help: 'For the list layout: the path to the array, e.g. "results" or "data.items".' },
    { key: 'itemTitle', label: 'Item title field', placeholder: 'title', default: 'title' },
    { key: 'itemMeta', label: 'Item subtitle field', placeholder: 'author' },
    { key: 'itemLink', label: 'Item link field', placeholder: 'url' },
    { key: 'limit', type: 'number', label: 'Items to show', default: 6, min: 1, max: 25 },
    { key: 'headers', type: 'textarea', label: 'Request headers (optional)',
      placeholder: 'Authorization: Bearer abc123',
      help: 'One per line, "Name: value". Stored only on this device.' },
    { key: 'useProxy', type: 'boolean', label: 'Route through the CORS proxy',
      help: 'Turn on if the API blocks browser requests. Do not use with private tokens.', default: false }
  ],
  defaultTitle: () => 'Custom',

  async load({ settings }) {
    if (!settings.url) throw new Error('Add an endpoint URL in this card’s settings.');
    const headers = parseHeaders(settings.headers);
    const opts = Object.keys(headers).length ? { headers } : {};
    const data = settings.useProxy
      ? await getJSONViaProxy(settings.url, opts)
      : await getJSON(settings.url, opts);

    if ((settings.mode || 'fields') === 'listing') {
      const arr = pluck(data, settings.listPath || '');
      if (!Array.isArray(arr)) {
        throw new Error(`"${settings.listPath || '(root)'}" is not an array in the response.`);
      }
      const limit = Math.max(1, Math.min(25, settings.limit || 6));
      return {
        mode: 'listing',
        items: arr.slice(0, limit).map(row => ({
          title: display(pluck(row, settings.itemTitle || 'title')),
          meta: settings.itemMeta ? display(pluck(row, settings.itemMeta)) : '',
          link: settings.itemLink ? String(pluck(row, settings.itemLink) || '') : ''
        }))
      };
    }

    const specs = String(settings.paths || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!specs.length) throw new Error('List at least one "Label = path" line.');
    return {
      mode: 'fields',
      rows: specs.map(line => {
        const i = line.indexOf('=');
        const label = i > 0 ? line.slice(0, i).trim() : line;
        const path = i > 0 ? line.slice(i + 1).trim() : line;
        return [label, display(pluck(data, path))];
      })
    };
  },

  render(p) {
    if (p.mode === 'listing') {
      if (!p.items.length) return el('p', { class: 'muted', text: 'The list came back empty.' });
      return list(p.items, item => {
        const body = el('div', {}, [
          el('div', { class: 'item-title', text: item.title }),
          item.meta ? el('div', { class: 'item-meta', text: item.meta }) : null
        ]);
        return item.link ? safeLink(item.link, body) : body;
      });
    }
    return kv(p.rows);
  }
};

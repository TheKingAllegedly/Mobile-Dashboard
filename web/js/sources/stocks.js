/* Stock and index quotes from Stooq's free CSV endpoint (no key, no signup). */
import { getTextViaProxy, money } from '../core/net.js';
import { el, list } from '../core/ui.js';

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    head.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

export default {
  type: 'stocks',
  name: 'Stocks & indexes',
  emoji: '📈',
  blurb: 'Quotes and daily change from Stooq',
  defaultSpan: 2,
  fields: [
    { key: 'symbols', label: 'Symbols', default: 'aapl.us,msft.us,^spx',
      placeholder: 'aapl.us,msft.us,^spx',
      help: 'Stooq symbols: US stocks end in ".us" (aapl.us). Indexes: ^spx, ^ndq, ^dji.' }
  ],
  defaultTitle: () => 'Markets',

  async load({ settings }) {
    const symbols = String(settings.symbols || 'aapl.us')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 15);
    if (!symbols.length) throw new Error('List at least one symbol.');
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbols.join(' '))}&f=sd2t2ohlcv&h&e=csv`;
    const csv = await getTextViaProxy(url);
    const rows = parseCsv(csv).map(r => {
      const close = parseFloat(r.close);
      const open = parseFloat(r.open);
      const change = Number.isFinite(close) && Number.isFinite(open) && open !== 0
        ? ((close - open) / open) * 100 : null;
      return {
        symbol: (r.symbol || '').toUpperCase(),
        price: Number.isFinite(close) ? close : null,
        change,
        date: r.date || ''
      };
    }).filter(r => r.symbol);
    if (!rows.length || rows.every(r => r.price == null)) {
      throw new Error('No quotes returned — check the symbols (US tickers need a ".us" suffix).');
    }
    return { rows };
  },

  render(p) {
    return list(p.rows, r => {
      const up = (r.change || 0) >= 0;
      return el('div', { class: 'row between' }, [
        el('span', { style: 'font-size:14.5px;font-weight:560', text: r.symbol }),
        el('span', { style: 'flex:none;text-align:right' }, [
          el('div', { class: 'mono', style: 'font-size:14.5px', text: r.price == null ? '—' : money(r.price, 2) }),
          r.change == null ? null : el('div', { class: 'mono ' + (up ? 'up' : 'down'), style: 'font-size:11.5px',
            text: (up ? '+' : '') + r.change.toFixed(2) + '%' })
        ])
      ]);
    });
  }
};

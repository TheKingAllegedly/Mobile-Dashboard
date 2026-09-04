/* Crypto prices from CoinGecko's public API (no key needed for light use). */
import { getJSON, money } from '../core/net.js';
import { el, list } from '../core/ui.js';

export default {
  type: 'crypto',
  name: 'Crypto',
  emoji: '₿',
  blurb: 'Live prices and 24h change from CoinGecko',
  defaultSpan: 2,
  fields: [
    { key: 'coins', label: 'Coins', default: 'bitcoin,ethereum,solana',
      placeholder: 'bitcoin,ethereum,solana',
      help: 'Comma-separated CoinGecko ids (the name in the coin’s coingecko.com URL).' },
    { key: 'currency', label: 'Currency', default: 'usd', help: 'usd, eur, gbp, …' }
  ],
  defaultTitle: () => 'Crypto',

  async load({ settings }) {
    const ids = String(settings.coins || 'bitcoin,ethereum')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!ids.length) throw new Error('List at least one coin id.');
    const vs = String(settings.currency || 'usd').toLowerCase();
    const url = 'https://api.coingecko.com/api/v3/simple/price'
      + `?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=${encodeURIComponent(vs)}`
      + '&include_24hr_change=true&include_market_cap=true';
    const data = await getJSON(url);
    const rows = ids.map(id => {
      const d = data[id];
      return d ? {
        id,
        price: d[vs],
        change: d[`${vs}_24h_change`],
        cap: d[`${vs}_market_cap`]
      } : { id, price: null, change: null, cap: null };
    });
    if (rows.every(r => r.price == null)) throw new Error('No prices returned — check the coin ids.');
    return { currency: vs, rows };
  },

  render(p) {
    return list(p.rows, r => {
      const up = (r.change || 0) >= 0;
      return el('div', { class: 'row between' }, [
        el('span', { style: 'text-transform:capitalize;font-size:14.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
          text: r.id.replace(/-/g, ' ') }),
        el('span', { style: 'flex:none;text-align:right' }, [
          el('div', { class: 'mono', style: 'font-size:14.5px', text: r.price == null ? '—' : money(r.price) }),
          r.change == null ? null : el('div', {
            class: 'mono ' + (up ? 'up' : 'down'),
            style: 'font-size:11.5px',
            text: (up ? '+' : '') + r.change.toFixed(2) + '%'
          })
        ])
      ]);
    });
  },

  widget(p) {
    const first = p.rows.find(r => r.price != null);
    if (!first) return {};
    return { tickerName: first.id.toUpperCase(), tickerValue: money(first.price),
      tickerChange: first.change == null ? '' : (first.change >= 0 ? '+' : '') + first.change.toFixed(2) + '%' };
  }
};

/* A subreddit or your own multireddit, using reddit's public .json endpoints. */
import { getJSONViaProxy, relativeTime } from '../core/net.js';
import { el, list, safeLink } from '../core/ui.js';

export default {
  type: 'reddit',
  name: 'Reddit',
  emoji: '👽',
  blurb: 'Hot or top posts from any subreddit',
  defaultSpan: 2,
  fields: [
    { key: 'sub', label: 'Subreddit', placeholder: 'technology', default: 'popular',
      help: 'Just the name, no "r/". Use "popular" or "all" for the global feed.' },
    { key: 'sort', type: 'select', label: 'Sort', default: 'hot', options: [
      { value: 'hot', label: 'Hot' }, { value: 'new', label: 'New' },
      { value: 'top', label: 'Top today' }, { value: 'rising', label: 'Rising' }
    ] },
    { key: 'limit', type: 'number', label: 'Posts to show', default: 6, min: 1, max: 20 }
  ],
  defaultTitle: s => 'r/' + (s.sub || 'popular'),

  async load({ settings }) {
    const sub = String(settings.sub || 'popular').replace(/^\/?r\//, '').trim() || 'popular';
    const sort = settings.sort || 'hot';
    const limit = Math.max(1, Math.min(20, settings.limit || 6));
    const extra = sort === 'top' ? '&t=day' : '';
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?limit=${limit}${extra}&raw_json=1`;
    const data = await getJSONViaProxy(url);
    const children = data && data.data && Array.isArray(data.data.children) ? data.data.children : [];
    if (!children.length) throw new Error(`r/${sub} returned no posts (private, empty, or blocked).`);
    return {
      items: children.map(c => c.data).filter(Boolean).map(d => ({
        title: d.title || '(untitled)',
        link: 'https://www.reddit.com' + (d.permalink || ''),
        score: d.score || 0,
        comments: d.num_comments || 0,
        sub: d.subreddit_name_prefixed || ('r/' + sub),
        date: d.created_utc ? d.created_utc * 1000 : null
      }))
    };
  },

  render(p) {
    return list(p.items, i => safeLink(i.link, [
      el('div', { class: 'item-title', text: i.title }),
      el('div', { class: 'item-meta', text: `${i.sub} · ⬆ ${i.score} · 💬 ${i.comments} · ${relativeTime(i.date)}` })
    ]));
  }
};

/* Hacker News front page via the official Firebase API (CORS-friendly, no key). */
import { getJSON, relativeTime, hostOf } from '../core/net.js';
import { el, list, safeLink } from '../core/ui.js';

const LISTS = {
  top: 'topstories', new: 'newstories', best: 'beststories',
  ask: 'askstories', show: 'showstories'
};

export default {
  type: 'hackernews',
  name: 'Hacker News',
  emoji: '🟠',
  blurb: 'Top, new, best, Ask HN or Show HN',
  defaultSpan: 2,
  fields: [
    { key: 'list', type: 'select', label: 'List', default: 'top', options: [
      { value: 'top', label: 'Top' }, { value: 'best', label: 'Best' }, { value: 'new', label: 'New' },
      { value: 'ask', label: 'Ask HN' }, { value: 'show', label: 'Show HN' }
    ] },
    { key: 'limit', type: 'number', label: 'Stories to show', default: 6, min: 1, max: 20 }
  ],
  defaultTitle: s => 'Hacker News' + (s.list && s.list !== 'top' ? ` · ${s.list}` : ''),

  async load({ settings }) {
    const listName = LISTS[settings.list] || LISTS.top;
    const ids = await getJSON(`https://hacker-news.firebaseio.com/v0/${listName}.json`);
    const limit = Math.max(1, Math.min(20, settings.limit || 6));
    const wanted = (Array.isArray(ids) ? ids : []).slice(0, limit);
    const stories = await Promise.all(
      wanted.map(id => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null))
    );
    return {
      items: stories.filter(Boolean).map(s => ({
        title: s.title || '(untitled)',
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        comments: `https://news.ycombinator.com/item?id=${s.id}`,
        score: s.score || 0,
        n: s.descendants || 0,
        date: s.time ? s.time * 1000 : null,
        host: s.url ? hostOf(s.url) : 'news.ycombinator.com'
      }))
    };
  },

  render(p) {
    if (!p.items.length) return el('p', { class: 'muted', text: 'Nothing returned.' });
    return list(p.items, s => el('div', {}, [
      safeLink(s.url, el('div', { class: 'item-title', text: s.title })),
      el('div', { class: 'item-meta' }, [
        `${s.score} pts · `,
        safeLink(s.comments, `${s.n} comments`, { style: 'display:inline;color:var(--accent)' }),
        ` · ${s.host} · ${relativeTime(s.date)}`
      ])
    ]));
  }
};

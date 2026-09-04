/* Any RSS or Atom feed: news sites, blogs, podcasts, YouTube channels, subreddits. */
import { getTextViaProxy, parseFeed, relativeTime, hostOf } from '../core/net.js';
import { el, list, safeLink } from '../core/ui.js';

export default {
  type: 'news',
  name: 'Feed (RSS / Atom)',
  emoji: '📰',
  blurb: 'Headlines from any news site, blog, podcast or YouTube channel',
  defaultSpan: 2,
  fields: [
    { key: 'url', type: 'url', label: 'Feed URL', placeholder: 'https://feeds.bbci.co.uk/news/rss.xml',
      help: 'Any RSS or Atom feed. YouTube channels work too: youtube.com/feeds/videos.xml?channel_id=…' },
    { key: 'limit', type: 'number', label: 'Headlines to show', default: 6, min: 1, max: 30 },
    { key: 'showSummary', type: 'boolean', label: 'Show a line of summary', default: false }
  ],
  defaultTitle: () => 'News',

  async load({ settings }) {
    if (!settings.url) throw new Error('Add a feed URL in this card’s settings.');
    const xml = await getTextViaProxy(settings.url);
    const feed = parseFeed(xml);
    const limit = Math.max(1, Math.min(30, settings.limit || 6));
    return {
      feedTitle: feed.title,
      items: feed.items.slice(0, limit).map(i => ({
        title: i.title, link: i.link, date: i.date,
        summary: i.summary ? i.summary.slice(0, 180) : '',
        host: hostOf(i.link)
      }))
    };
  },

  render(p, { settings }) {
    if (!p.items.length) return el('p', { class: 'muted', text: 'This feed has no items right now.' });
    return list(p.items, item => safeLink(item.link, [
      el('div', { class: 'item-title', text: item.title }),
      settings.showSummary && item.summary
        ? el('div', { class: 'item-meta', style: 'white-space:normal', text: item.summary })
        : null,
      el('div', { class: 'item-meta', text: [item.host, relativeTime(item.date)].filter(Boolean).join(' · ') })
    ]));
  },

  widget(p, { card }) {
    if (!p.items.length) return {};
    return { headline: p.items[0].title, headlineSource: card.title || p.feedTitle || 'News' };
  }
};

/* GitHub: your notifications, assigned issues, review requests, or a repo's activity.
   A token is optional — without one you get public data and a low rate limit. */
import { getJSON, relativeTime } from '../core/net.js';
import { el, list, safeLink } from '../core/ui.js';

export default {
  type: 'github',
  name: 'GitHub',
  emoji: '🐙',
  blurb: 'Pull requests, issues, or a repo’s latest commits',
  defaultSpan: 2,
  fields: [
    { key: 'mode', type: 'select', label: 'Show', default: 'repo', options: [
      { value: 'repo', label: 'Latest commits in a repo' },
      { value: 'issues', label: 'Open issues in a repo' },
      { value: 'pulls', label: 'Open pull requests in a repo' },
      { value: 'mine', label: 'Issues & PRs assigned to me' }
    ] },
    { key: 'repo', label: 'Repository', placeholder: 'owner/name', help: 'Needed for every mode except “assigned to me”.' },
    { key: 'user', label: 'Your GitHub username', placeholder: 'octocat', help: 'Used by “assigned to me”.' },
    { key: 'token', type: 'password', label: 'Personal access token (optional)',
      help: 'Stored only on this device. Needed for private repos and a higher rate limit.' },
    { key: 'limit', type: 'number', label: 'Rows to show', default: 6, min: 1, max: 20 }
  ],
  defaultTitle: s => s.mode === 'mine' ? 'GitHub · assigned to me' : (s.repo ? `GitHub · ${s.repo}` : 'GitHub'),

  async load({ settings }) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (settings.token) headers.Authorization = 'Bearer ' + settings.token;
    const limit = Math.max(1, Math.min(20, settings.limit || 6));
    const mode = settings.mode || 'repo';
    const repo = String(settings.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');

    if (mode === 'mine') {
      const user = String(settings.user || '').trim();
      if (!user) throw new Error('Set your GitHub username in this card’s settings.');
      const q = `assignee:${user} state:open`;
      const data = await getJSON(
        `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}&sort=updated`,
        { headers });
      return {
        items: (data.items || []).map(i => ({
          title: i.title,
          link: i.html_url,
          meta: `${i.pull_request ? 'PR' : 'Issue'} · ${i.repository_url.split('/').slice(-2).join('/')} · ${relativeTime(Date.parse(i.updated_at))}`
        }))
      };
    }

    if (!repo || !repo.includes('/')) throw new Error('Set a repository as owner/name.');

    if (mode === 'repo') {
      const data = await getJSON(`https://api.github.com/repos/${repo}/commits?per_page=${limit}`, { headers });
      return {
        items: (data || []).map(c => ({
          title: (c.commit && c.commit.message ? c.commit.message : '').split('\n')[0] || '(no message)',
          link: c.html_url,
          meta: `${c.commit && c.commit.author ? c.commit.author.name : 'unknown'} · ${relativeTime(Date.parse(c.commit.author.date))}`
        }))
      };
    }

    const path = mode === 'pulls' ? 'pulls' : 'issues';
    const data = await getJSON(`https://api.github.com/repos/${repo}/${path}?state=open&per_page=${limit}&sort=updated`, { headers });
    const rows = (data || []).filter(i => mode === 'pulls' || !i.pull_request);
    return {
      items: rows.map(i => ({
        title: i.title,
        link: i.html_url,
        meta: `#${i.number} · ${i.user ? i.user.login : ''} · ${relativeTime(Date.parse(i.updated_at))}`
      }))
    };
  },

  render(p) {
    if (!p.items.length) return el('p', { class: 'muted', text: 'Nothing open right now. 🎉' });
    return list(p.items, i => safeLink(i.link, [
      el('div', { class: 'item-title', text: i.title }),
      el('div', { class: 'item-meta', text: i.meta })
    ]));
  }
};

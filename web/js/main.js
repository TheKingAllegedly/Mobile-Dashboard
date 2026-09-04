/* Dashboard controller: builds the grid, loads each card, keeps it fresh,
   and hands a compact summary to the Android home-screen widget. */
import {
  loadConfig, getSettings, setSettings, getCards, getCard,
  addCard, updateCard, removeCard, moveCard,
  getCached, setCached, exportAll, importAll
} from './core/store.js';
import { allSources, getSource, STARTER_CARDS } from './core/registry.js';
import { el, clear, sheet, form, toast, skeleton, errorBox } from './core/ui.js';
import { relativeTime } from './core/net.js';

const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const statusStrip = document.getElementById('statusStrip');

const cardState = new Map();  // cardId -> { node, body, dot, foot, payload, error, loadedAt, timer }
let installPrompt = null;
let refreshTimer = null;
let tickTimer = null;

/* ------------------------------------------------------------------ boot */

function boot() {
  const cfg = loadConfig();
  applyTheme();

  if (!cfg.cards.length) {
    for (const seed of STARTER_CARDS) {
      addCard(seed.type, seed.settings, { title: seed.title, span: seed.span });
    }
  }

  renderGreeting();
  renderGrid();
  wireChrome();
  scheduleRefresh();
  registerServiceWorker();

  refreshAll({ silent: true });

  tickTimer = setInterval(() => {
    for (const card of getCards()) {
      const source = getSource(card.type);
      if (source && source.tick) renderCard(card);
    }
    renderGreeting();
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    renderGreeting();
    const stalest = Math.min(...[...cardState.values()].map(s => s.loadedAt || 0), Date.now());
    const maxAge = Math.max(1, getSettings().refreshMinutes) * 60000;
    if (Date.now() - stalest > maxAge) refreshAll({ silent: true });
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
  });
}

function applyTheme() {
  const { theme } = getSettings();
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6f9' : '#0b0d10');
}

function renderGreeting() {
  const { name, hour12 } = getSettings();
  const now = new Date();
  const h = now.getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greetingText').textContent = name ? `${part}, ${name}` : part;
  document.getElementById('greetingSub').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    + ' · ' + now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !!hour12 });
}

/* ------------------------------------------------------------------ grid */

function renderGrid() {
  clear(grid);
  cardState.clear();
  const cards = getCards();
  emptyState.hidden = cards.length > 0;

  for (const card of cards) {
    const source = getSource(card.type);
    const title = card.title || (source && source.defaultTitle ? source.defaultTitle(card.settings) : card.type);

    const dot = el('span', { class: 'dot' });
    const body = el('div', { class: 'card-body' });
    const foot = el('div', { class: 'card-foot' }, [
      el('span', { class: 'stamp', text: '' }),
      el('span', { class: 'src', text: source ? source.name : 'Unknown card' })
    ]);

    const node = el('article', {
      class: 'card',
      dataset: { id: card.id, span: String(card.span) },
      draggable: 'true'
    }, [
      el('div', { class: 'card-head' }, [
        dot,
        el('h3', { class: 'card-title', text: title }),
        el('button', {
          class: 'card-menu', 'aria-label': `Options for ${title}`, text: '⋯',
          onClick: () => openCardMenu(card.id)
        })
      ]),
      body,
      foot
    ]);

    if (!source) {
      body.append(errorBox(`This card type ("${card.type}") is not available in this version.`));
    } else {
      body.append(skeleton(2));
    }

    node.setAttribute('data-span', String(card.span));
    wireDrag(node);
    grid.append(node);
    cardState.set(card.id, { node, body, dot, foot, payload: null, error: null, loadedAt: 0 });

    if (source) {
      const cached = getCached(card.id);
      if (cached) {
        const state = cardState.get(card.id);
        state.payload = cached.payload;
        state.loadedAt = cached.at;
        renderCard(card);
      } else if (source.local) {
        renderCard(card);
      }
    }
  }
}

function renderCard(card) {
  const state = cardState.get(card.id);
  const source = getSource(card.type);
  if (!state || !source) return;

  const ctx = {
    card,
    settings: card.settings || {},
    rerender: () => { renderCard(card); publishWidgetData(); }
  };

  try {
    const payload = state.payload || {};
    const node = source.render(payload, ctx);
    clear(state.body);
    state.body.append(node);
  } catch (e) {
    clear(state.body);
    state.body.append(errorBox('Could not draw this card: ' + (e.message || e)));
  }

  const stamp = state.foot.querySelector('.stamp');
  if (source.local) stamp.textContent = 'On this device';
  else if (state.error) stamp.textContent = 'Last good: ' + (state.loadedAt ? relativeTime(state.loadedAt) : 'never');
  else stamp.textContent = state.loadedAt ? 'Updated ' + relativeTime(state.loadedAt) : '';

  state.dot.className = 'dot' + (state.error ? ' err' : (isStale(state) ? ' stale' : ''));
}

function isStale(state) {
  if (!state.loadedAt) return false;
  const maxAge = Math.max(1, getSettings().refreshMinutes) * 60000;
  return Date.now() - state.loadedAt > maxAge * 2.5;
}

/* --------------------------------------------------------------- loading */

async function loadCard(card) {
  const source = getSource(card.type);
  const state = cardState.get(card.id);
  if (!source || !state) return;

  if (source.local) {
    state.error = null;
    state.loadedAt = Date.now();
    renderCard(card);
    return;
  }

  try {
    const payload = await source.load({ card, settings: card.settings || {} });
    state.payload = payload;
    state.error = null;
    state.loadedAt = Date.now();
    setCached(card.id, payload);
    renderCard(card);
  } catch (e) {
    state.error = e.message || String(e);
    if (state.payload) {
      renderCard(card);
      const note = el('div', { class: 'err-box', style: 'margin-top:10px', text: state.error });
      state.body.append(note);
    } else {
      clear(state.body);
      state.body.append(errorBox(state.error));
      state.dot.className = 'dot err';
      const stamp = state.foot.querySelector('.stamp');
      if (stamp) stamp.textContent = 'Failed';
    }
  }
}

async function refreshAll({ silent = false } = {}) {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  const cards = getCards();
  await Promise.all(cards.map(card => loadCard(card)));
  btn.classList.remove('spinning');
  renderStatusStrip();
  publishWidgetData();
  if (!silent) toast('Everything refreshed');
}

function renderStatusStrip() {
  const failures = [];
  for (const card of getCards()) {
    const state = cardState.get(card.id);
    if (state && state.error) {
      const source = getSource(card.type);
      failures.push(card.title || (source && source.defaultTitle ? source.defaultTitle(card.settings) : card.type));
    }
  }
  clear(statusStrip);
  if (!failures.length) { statusStrip.hidden = true; return; }
  statusStrip.hidden = false;
  statusStrip.append(el('span', { class: 'chip err', text: `${failures.length} card${failures.length > 1 ? 's' : ''} failed` }));
  for (const name of failures.slice(0, 6)) statusStrip.append(el('span', { class: 'chip', text: name }));
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  const minutes = Math.max(1, getSettings().refreshMinutes || 15);
  refreshTimer = setInterval(() => refreshAll({ silent: true }), minutes * 60000);
}

/* ------------------------------------------------- Android widget bridge */

function publishWidgetData() {
  const summary = {
    updatedAt: Date.now(),
    updatedLabel: new Date().toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', hour12: !!getSettings().hour12
    })
  };

  for (const card of getCards()) {
    const source = getSource(card.type);
    const state = cardState.get(card.id);
    if (!source || !source.widget) continue;
    try {
      const contribution = source.widget(state && state.payload ? state.payload : {}, { card, settings: card.settings || {} });
      for (const [k, v] of Object.entries(contribution || {})) {
        if (v !== undefined && v !== null && v !== '' && summary[k] === undefined) summary[k] = v;
      }
    } catch { /* a broken card must never break the widget */ }
  }

  try { localStorage.setItem('md.widget.v1', JSON.stringify(summary)); } catch { /* quota */ }

  const bridge = window.DashboardHost;
  if (bridge && typeof bridge.publishWidgetData === 'function') {
    try { bridge.publishWidgetData(JSON.stringify(summary)); } catch (e) { console.warn('widget bridge failed', e); }
  }
}

/* True when the dashboard is running inside the Android app rather than a browser. */
function isAndroidApp() {
  const host = window.DashboardHost;
  if (!host) return false;
  try { return host.isAndroidHost() === true; } catch { return false; }
}

/* --------------------------------------------------------------- chrome */

function wireChrome() {
  document.getElementById('refreshBtn').addEventListener('click', () => refreshAll());
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('addFab').addEventListener('click', openCatalog);
  emptyState.querySelector('[data-action="open-add"]').addEventListener('click', openCatalog);
  wirePullToRefresh();
}

function wirePullToRefresh() {
  const indicator = document.getElementById('ptr');
  let startY = 0;
  let pulling = false;

  window.addEventListener('touchstart', e => {
    if (window.scrollY > 0 || e.touches.length !== 1) { pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 70 && window.scrollY <= 0) indicator.classList.add('armed');
    else indicator.classList.remove('armed');
  }, { passive: true });

  window.addEventListener('touchend', async () => {
    if (!pulling || !indicator.classList.contains('armed')) { pulling = false; indicator.classList.remove('armed'); return; }
    pulling = false;
    indicator.classList.add('busy');
    await refreshAll({ silent: true });
    indicator.classList.remove('busy', 'armed');
    toast('Refreshed');
  }, { passive: true });
}

/* --------------------------------------------------------- drag to sort */

let dragId = null;

function wireDrag(node) {
  node.addEventListener('dragstart', e => {
    dragId = node.dataset.id;
    node.classList.add('dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); }
  });
  node.addEventListener('dragend', () => {
    node.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
    dragId = null;
  });
  node.addEventListener('dragover', e => {
    if (!dragId || dragId === node.dataset.id) return;
    e.preventDefault();
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
  node.addEventListener('drop', e => {
    e.preventDefault();
    node.classList.remove('drop-target');
    if (!dragId || dragId === node.dataset.id) return;
    const ids = getCards().map(c => c.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(node.dataset.id);
    if (from < 0 || to < 0) return;
    moveCard(dragId, to - from);
    renderGrid();
    refreshAll({ silent: true });
  });
}

/* ---------------------------------------------------------- card menu */

function openCardMenu(id) {
  const card = getCard(id);
  if (!card) return;
  const source = getSource(card.type);
  const title = card.title || (source && source.defaultTitle ? source.defaultTitle(card.settings) : card.type);

  const body = el('div', {});
  const spanRow = el('div', { class: 'btn-row', style: 'margin-bottom:6px' });
  for (const [value, label] of [[1, 'Small'], [2, 'Medium'], [4, 'Wide']]) {
    spanRow.append(el('button', {
      class: 'btn sm' + (card.span === value ? ' primary' : ''),
      text: label,
      onClick: () => { updateCard(id, { span: value }); renderGrid(); refreshAll({ silent: true }); handle.close(); }
    }));
  }

  body.append(
    el('div', { class: 'section-label', text: 'Size' }),
    spanRow,
    el('div', { class: 'section-label', text: 'Position' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm', text: '↑ Move up', onClick: () => { moveCard(id, -1); renderGrid(); refreshAll({ silent: true }); handle.close(); } }),
      el('button', { class: 'btn sm', text: '↓ Move down', onClick: () => { moveCard(id, 1); renderGrid(); refreshAll({ silent: true }); handle.close(); } })
    ]),
    el('div', { class: 'section-label', text: 'Card' }),
    el('div', { class: 'btn-row' }, [
      source && source.fields && source.fields.length
        ? el('button', { class: 'btn sm', text: '⚙ Settings', onClick: () => { handle.close(); openCardEditor(id); } })
        : null,
      el('button', { class: 'btn sm', text: '↻ Refresh now', onClick: async () => { handle.close(); await loadCard(card); renderStatusStrip(); publishWidgetData(); } }),
      el('button', {
        class: 'btn sm danger', text: '🗑 Remove',
        onClick: () => { removeCard(id); renderGrid(); renderStatusStrip(); publishWidgetData(); handle.close(); toast('Card removed'); }
      })
    ])
  );

  const handle = sheet({ title, body });
}

function openCardEditor(id) {
  const card = getCard(id);
  if (!card) return;
  const source = getSource(card.type);
  if (!source) return;

  const titleField = { key: '__title', label: 'Card title', placeholder: source.defaultTitle ? source.defaultTitle(card.settings) : source.name };
  const builder = form([titleField, ...(source.fields || [])], { __title: card.title, ...(card.settings || {}) });

  const handle = sheet({
    title: `${source.emoji} ${source.name}`,
    body: builder.node,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: ({ close }) => close() },
      {
        label: 'Save', variant: 'primary',
        onClick: async ({ close }) => {
          const values = builder.values();
          const nextTitle = values.__title || '';
          delete values.__title;
          updateCard(id, { title: nextTitle, settings: values });
          close();
          renderGrid();
          await refreshAll({ silent: true });
          toast('Card saved');
        }
      }
    ]
  });
  return handle;
}

/* ------------------------------------------------------------- catalog */

function openCatalog() {
  const body = el('div', {});
  const catalog = el('div', { class: 'catalog' });
  for (const source of allSources()) {
    catalog.append(el('button', {
      class: 'cat-item',
      onClick: () => { handle.close(); openNewCard(source); }
    }, [
      el('span', { class: 'emoji', text: source.emoji }),
      el('span', { style: 'min-width:0' }, [
        el('b', { text: source.name }),
        el('small', { text: source.blurb })
      ])
    ]));
  }
  body.append(catalog);
  const handle = sheet({ title: 'Add a card', body });
}

function openNewCard(source) {
  if (!source.fields || !source.fields.length) {
    const card = addCard(source.type, {}, { span: source.defaultSpan || 2 });
    renderGrid();
    loadCard(card).then(publishWidgetData);
    toast(`${source.name} added`);
    return;
  }

  const defaults = {};
  for (const f of source.fields) if (f.default !== undefined) defaults[f.key] = f.default;
  const builder = form(source.fields, defaults);

  const handle = sheet({
    title: `Add ${source.name}`,
    body: builder.node,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: ({ close }) => close() },
      {
        label: 'Add card', variant: 'primary',
        onClick: async ({ close }) => {
          const card = addCard(source.type, builder.values(), { span: source.defaultSpan || 2 });
          close();
          renderGrid();
          await loadCard(card);
          renderStatusStrip();
          publishWidgetData();
          toast(`${source.name} added`);
        }
      }
    ]
  });
}

/* ------------------------------------------------------------ settings */

function openSettings() {
  const s = getSettings();
  const body = el('div', {});

  const builder = form([
    { key: 'name', label: 'Your name', placeholder: 'Levi', help: 'Used in the greeting at the top.' },
    { key: 'theme', type: 'select', label: 'Theme', options: [
      { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }
    ] },
    { key: 'units', type: 'select', label: 'Units', options: [
      { value: 'imperial', label: 'Fahrenheit, mph, inches' },
      { value: 'metric', label: 'Celsius, km/h, mm' }
    ] },
    { key: 'hour12', type: 'boolean', label: '12-hour clock' },
    { key: 'refreshMinutes', type: 'number', label: 'Auto-refresh every (minutes)', min: 1, max: 240 },
    { key: 'proxy', label: 'CORS proxy', help: 'Feeds and calendars that block browsers are fetched through this. Leave blank to disable. Self-host the included Cloudflare Worker for privacy.' }
  ], s);

  body.append(builder.node);

  body.append(el('div', { class: 'section-label', text: 'Cards' }));
  const manage = el('div', {});
  for (const card of getCards()) {
    const source = getSource(card.type);
    manage.append(el('div', { class: 'manage-row' }, [
      el('span', { style: 'flex:none;font-size:16px', text: source ? source.emoji : '❔' }),
      el('span', { class: 'grow', text: card.title || (source && source.defaultTitle ? source.defaultTitle(card.settings) : card.type) }),
      el('button', { class: 'btn sm ghost', text: '↑', 'aria-label': 'Move up', onClick: () => { moveCard(card.id, -1); handle.close(); renderGrid(); openSettings(); } }),
      el('button', { class: 'btn sm ghost', text: '↓', 'aria-label': 'Move down', onClick: () => { moveCard(card.id, 1); handle.close(); renderGrid(); openSettings(); } }),
      el('button', { class: 'btn sm danger', text: '✕', 'aria-label': 'Remove', onClick: () => { removeCard(card.id); handle.close(); renderGrid(); renderStatusStrip(); openSettings(); } })
    ]));
  }
  if (!getCards().length) manage.append(el('p', { class: 'muted', style: 'font-size:13.5px', text: 'No cards yet.' }));
  body.append(manage);

  if (isAndroidApp()) {
    body.append(el('div', { class: 'section-label', text: 'On this phone' }));
    body.append(el('p', {
      class: 'faint',
      style: 'font-size:12px;margin:0 0 12px;line-height:1.45',
      text: 'Long-press your home screen, choose Widgets, then drag the Dashboard widget out. '
        + 'It shows the weather, your next event and your top task, and updates on its own in the background.'
    }));

    const widgetRow = el('div', { class: 'btn-row' });
    widgetRow.append(el('button', {
      class: 'btn sm', text: '🔄 Update the widget now',
      onClick: () => {
        publishWidgetData();
        try { window.DashboardHost.refreshWidget(); } catch { /* older shell */ }
        toast('Widget updated');
      }
    }));
    body.append(widgetRow);

    let currentHosted = '';
    try { currentHosted = window.DashboardHost.getHomeUrl() || ''; } catch { currentHosted = ''; }
    const hostedInput = el('input', { type: 'url', placeholder: 'https://you.github.io/Mobile-Dashboard/' });
    hostedInput.value = currentHosted;
    body.append(el('label', { class: 'field' }, [
      el('span', { text: 'Run a hosted copy instead' }),
      hostedInput,
      el('small', { text: 'Leave blank to use the copy built into the app. An https address lets you update the dashboard without reinstalling.' })
    ]));
    body.append(el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn sm', text: 'Apply',
        onClick: () => {
          const value = hostedInput.value.trim();
          let ok = false;
          try { ok = window.DashboardHost.setHomeUrl(value); } catch { ok = false; }
          if (!ok) toast('Only https addresses are allowed');
        }
      })
    ]));
  } else {
    body.append(el('div', { class: 'section-label', text: 'Install' }));
    const installRow = el('div', { class: 'btn-row' });
    installRow.append(el('button', {
      class: 'btn sm', text: '📲 Install on this phone',
      onClick: async () => {
        if (!installPrompt) {
          toast('Use your browser menu → “Add to Home screen”');
          return;
        }
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        installPrompt = null;
        toast(choice.outcome === 'accepted' ? 'Installing…' : 'Install dismissed');
      }
    }));
    body.append(installRow);
  }

  body.append(el('div', { class: 'section-label', text: 'Backup' }));
  const backupRow = el('div', { class: 'btn-row' });
  backupRow.append(
    el('button', {
      class: 'btn sm', text: '⬇ Copy backup',
      onClick: async () => {
        const text = exportAll();
        try {
          await navigator.clipboard.writeText(text);
          toast('Backup copied to clipboard');
        } catch {
          showText('Backup', text);
        }
      }
    }),
    el('button', {
      class: 'btn sm', text: '⬆ Restore backup',
      onClick: () => {
        const area = el('textarea', { placeholder: 'Paste a backup here…', style: 'min-height:180px' });
        const restore = sheet({
          title: 'Restore backup',
          body: area,
          actions: [
            { label: 'Cancel', variant: 'ghost', onClick: ({ close }) => close() },
            {
              label: 'Restore', variant: 'primary',
              onClick: ({ close }) => {
                try {
                  importAll(area.value);
                  close(); handle.close();
                  applyTheme(); renderGreeting(); renderGrid(); refreshAll({ silent: true });
                  toast('Backup restored');
                } catch (e) {
                  toast('Could not restore: ' + e.message);
                }
              }
            }
          ]
        });
        return restore;
      }
    })
  );
  body.append(backupRow);

  body.append(el('p', {
    class: 'faint',
    style: 'font-size:11.5px;margin-top:22px;line-height:1.5',
    text: 'Everything you configure stays in this browser. No account, no server, nothing uploaded. Tokens you paste into cards are stored on this device only.'
  }));

  const handle = sheet({
    title: 'Settings',
    body,
    actions: [
      { label: 'Close', variant: 'ghost', onClick: ({ close }) => close() },
      {
        label: 'Save', variant: 'primary',
        onClick: async ({ close }) => {
          setSettings(builder.values());
          applyTheme();
          renderGreeting();
          scheduleRefresh();
          close();
          await refreshAll({ silent: true });
          toast('Settings saved');
        }
      }
    ]
  });
}

function showText(title, text) {
  const area = el('textarea', { style: 'min-height:240px' });
  area.value = text;
  area.readOnly = true;
  sheet({ title, body: area });
}

/* ------------------------------------------------------ service worker */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.protocol !== 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker failed', e));
}

/* The Android shell calls this to force a refresh when the widget is tapped. */
window.dashboardRefresh = () => refreshAll({ silent: true });

boot();

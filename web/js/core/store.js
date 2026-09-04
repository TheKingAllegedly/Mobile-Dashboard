/* Config persistence. Everything lives in localStorage; no server, no accounts. */

const KEY = 'md.config.v3';
const DATA_KEY = 'md.data.v1';   // per-card user data (tasks, notes)
const CACHE_KEY = 'md.cache.v1'; // last successful payload per card

const DEFAULTS = {
  version: 3,
  settings: {
    theme: 'dark',
    units: 'imperial',        // imperial | metric
    name: '',
    refreshMinutes: 15,
    proxy: 'https://api.allorigins.win/raw?url=',
    hour12: true,
    compact: false
  },
  cards: []
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return clone(fallback);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : clone(fallback);
  } catch { return clone(fallback); }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('storage write failed', e); return false; }
}

let config = null;

export function loadConfig() {
  if (config) return config;
  const raw = read(KEY, DEFAULTS);
  config = {
    version: DEFAULTS.version,
    settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
    cards: Array.isArray(raw.cards) ? raw.cards : []
  };
  config.cards = config.cards
    .filter(c => c && typeof c.type === 'string')
    .map(c => ({
      id: c.id || newId(),
      type: c.type,
      title: typeof c.title === 'string' ? c.title : '',
      span: c.span === 1 ? 1 : (c.span === 4 ? 4 : 2),
      settings: c.settings && typeof c.settings === 'object' ? c.settings : {}
    }));
  return config;
}

export function saveConfig() {
  if (!config) return;
  write(KEY, config);
  window.dispatchEvent(new CustomEvent('md:config-saved'));
}

export function getSettings() { return loadConfig().settings; }

export function setSettings(patch) {
  const cfg = loadConfig();
  cfg.settings = { ...cfg.settings, ...patch };
  saveConfig();
  return cfg.settings;
}

export function getCards() { return loadConfig().cards; }
export function getCard(id) { return loadConfig().cards.find(c => c.id === id) || null; }

export function addCard(type, settings = {}, opts = {}) {
  const cfg = loadConfig();
  const card = {
    id: newId(),
    type,
    title: opts.title || '',
    span: opts.span || 2,
    settings
  };
  cfg.cards.push(card);
  saveConfig();
  return card;
}

export function updateCard(id, patch) {
  const card = getCard(id);
  if (!card) return null;
  Object.assign(card, patch);
  saveConfig();
  return card;
}

export function removeCard(id) {
  const cfg = loadConfig();
  const i = cfg.cards.findIndex(c => c.id === id);
  if (i < 0) return false;
  cfg.cards.splice(i, 1);
  saveConfig();
  clearCardData(id);
  return true;
}

export function moveCard(id, delta) {
  const cfg = loadConfig();
  const i = cfg.cards.findIndex(c => c.id === id);
  if (i < 0) return false;
  const j = Math.max(0, Math.min(cfg.cards.length - 1, i + delta));
  if (i === j) return false;
  const [card] = cfg.cards.splice(i, 1);
  cfg.cards.splice(j, 0, card);
  saveConfig();
  return true;
}

export function reorderCards(idsInOrder) {
  const cfg = loadConfig();
  const byId = new Map(cfg.cards.map(c => [c.id, c]));
  const next = [];
  for (const id of idsInOrder) { if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); } }
  for (const leftover of byId.values()) next.push(leftover);
  cfg.cards = next;
  saveConfig();
}

/* ---- per-card user data (tasks, notes) ---- */
export function getCardData(id, fallback) {
  const all = read(DATA_KEY, {});
  return id in all ? all[id] : clone(fallback);
}
export function setCardData(id, value) {
  const all = read(DATA_KEY, {});
  all[id] = value;
  write(DATA_KEY, all);
}
function clearCardData(id) {
  const all = read(DATA_KEY, {});
  if (id in all) { delete all[id]; write(DATA_KEY, all); }
  const cache = read(CACHE_KEY, {});
  if (id in cache) { delete cache[id]; write(CACHE_KEY, cache); }
}

/* ---- last-good payload cache, so cards render instantly and work offline ---- */
export function getCached(id) {
  const all = read(CACHE_KEY, {});
  const entry = all[id];
  if (!entry || typeof entry !== 'object') return null;
  return entry;
}
export function setCached(id, payload) {
  const all = read(CACHE_KEY, {});
  all[id] = { at: Date.now(), payload };
  write(CACHE_KEY, all);
}

/* ---- import / export ---- */
export function exportAll() {
  return JSON.stringify({
    kind: 'mobile-dashboard-backup',
    version: DEFAULTS.version,
    exportedAt: new Date().toISOString(),
    config: loadConfig(),
    data: read(DATA_KEY, {})
  }, null, 2);
}

export function importAll(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed && parsed.config ? parsed.config : parsed;
  if (!incoming || !Array.isArray(incoming.cards)) throw new Error('Not a dashboard backup file.');
  write(KEY, incoming);
  if (parsed && parsed.data && typeof parsed.data === 'object') write(DATA_KEY, parsed.data);
  config = null;
  loadConfig();
  return true;
}

export function newId() {
  return 'c' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

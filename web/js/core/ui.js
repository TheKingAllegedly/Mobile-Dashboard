/* Small DOM toolkit. Everything is built with createElement, never innerHTML,
   so remote feed content can never inject markup. */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') throw new Error('raw html is not allowed');
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* Only http(s) links are allowed to escape the app. */
export function safeLink(href, children, attrs = {}) {
  let ok = false;
  try {
    const u = new URL(href, location.href);
    ok = u.protocol === 'https:' || u.protocol === 'http:';
    if (ok) href = u.href;
  } catch { ok = false; }
  if (!ok) return el('span', attrs, children);
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, children);
}

export function skeleton(lines = 3) {
  const frag = document.createDocumentFragment();
  frag.append(el('div', { class: 'skeleton lg' }));
  for (let i = 0; i < lines; i++) {
    frag.append(el('div', { class: 'skeleton', style: `width:${70 + ((i * 13) % 25)}%` }));
  }
  return frag;
}

export function errorBox(message) {
  return el('div', { class: 'err-box', text: message });
}

export function list(items, renderItem) {
  const ul = el('ul', { class: 'list' });
  items.forEach((item, i) => ul.append(el('li', {}, [renderItem(item, i)])));
  return ul;
}

export function kv(rows) {
  const wrap = el('div', {});
  for (const [k, v, cls] of rows) {
    wrap.append(el('div', { class: 'kv' }, [
      el('span', { class: 'k', text: k }),
      el('span', { class: 'v' + (cls ? ' ' + cls : ''), text: v })
    ]));
  }
  return wrap;
}

export function toast(message, ms = 2600) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const node = el('div', { class: 'toast', text: message });
  root.append(node);
  setTimeout(() => node.remove(), ms);
}

/* ---------------- bottom sheet ---------------- */

let openSheets = 0;

export function sheet({ title, body, actions = [], onClose }) {
  const root = document.getElementById('sheetRoot');
  const scrim = el('div', { class: 'scrim' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });

  const bodyWrap = el('div', { class: 'sheet-body' });
  bodyWrap.append(body);

  const head = el('div', { class: 'sheet-head' }, [
    el('h2', { text: title || '' }),
    el('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => close() }, [
      (() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z');
        path.setAttribute('fill', 'currentColor');
        svg.append(path);
        svg.style.width = '18px'; svg.style.height = '18px'; svg.style.fill = 'var(--fg-dim)';
        return svg;
      })()
    ])
  ]);

  panel.append(el('div', { class: 'sheet-grab' }), head, bodyWrap);

  if (actions.length) {
    const foot = el('div', { class: 'sheet-foot' });
    for (const a of actions) {
      foot.append(el('button', {
        class: 'btn ' + (a.variant || ''),
        text: a.label,
        onClick: () => a.onClick({ close })
      }));
    }
    panel.append(foot);
  }

  function close() {
    scrim.remove();
    panel.remove();
    openSheets = Math.max(0, openSheets - 1);
    if (!openSheets) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  root.append(scrim, panel);
  openSheets++;
  document.body.style.overflow = 'hidden';
  return { close, panel, body: bodyWrap };
}

/* ---------------- form builder ---------------- */

export function form(fields, values = {}) {
  const wrap = el('div', {});
  const inputs = {};

  for (const f of fields) {
    if (f.type === 'note') {
      wrap.append(el('p', { class: 'faint', style: 'font-size:12.5px;margin:2px 0 16px;line-height:1.45', text: f.text }));
      continue;
    }
    const id = 'f_' + f.key;
    let input;
    const current = values[f.key] !== undefined ? values[f.key] : (f.default !== undefined ? f.default : '');

    if (f.type === 'select') {
      input = el('select', { id });
      for (const opt of f.options) {
        const o = el('option', { value: String(opt.value), text: opt.label });
        if (String(opt.value) === String(current)) o.selected = true;
        input.append(o);
      }
    } else if (f.type === 'textarea') {
      input = el('textarea', { id, placeholder: f.placeholder || '' });
      input.value = current == null ? '' : String(current);
    } else if (f.type === 'boolean') {
      input = el('input', { type: 'checkbox', id });
      input.checked = !!current;
      const row = el('label', { class: 'switch', for: id }, [
        el('span', {}, [
          el('div', { text: f.label }),
          f.help ? el('small', { class: 'faint', style: 'display:block;font-size:11.5px', text: f.help }) : null
        ]),
        input
      ]);
      wrap.append(row);
      inputs[f.key] = () => input.checked;
      continue;
    } else {
      input = el('input', {
        id,
        type: f.type === 'number' ? 'number' : (f.type === 'password' ? 'password' : (f.type === 'url' ? 'url' : 'text')),
        placeholder: f.placeholder || '',
        inputmode: f.type === 'number' ? 'decimal' : undefined,
        min: f.min, max: f.max, step: f.step,
        autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
      });
      input.value = current == null ? '' : String(current);
    }

    wrap.append(el('label', { class: 'field', for: id }, [
      el('span', { text: f.label }),
      input,
      f.help ? el('small', { text: f.help }) : null
    ]));

    inputs[f.key] = () => {
      const raw = input.value;
      if (f.type === 'number') {
        const n = parseFloat(raw);
        return Number.isNaN(n) ? (f.default !== undefined ? f.default : null) : n;
      }
      return typeof raw === 'string' ? raw.trim() : raw;
    };
  }

  return {
    node: wrap,
    values() {
      const out = {};
      for (const [k, get] of Object.entries(inputs)) out[k] = get();
      return out;
    }
  };
}

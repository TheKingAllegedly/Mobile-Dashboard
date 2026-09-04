/* A checklist that lives on this device. No account, no sync, no network. */
import { el } from '../core/ui.js';
import { getCardData, setCardData } from '../core/store.js';

export default {
  type: 'tasks',
  name: 'Tasks',
  emoji: '✅',
  blurb: 'A quick checklist stored on this device',
  defaultSpan: 2,
  local: true,
  fields: [
    { key: 'hideDone', type: 'boolean', label: 'Hide completed tasks', default: false }
  ],
  defaultTitle: () => 'Tasks',

  async load() { return { at: Date.now() }; },

  render(_p, { card, settings, rerender }) {
    const items = getCardData(card.id, []);
    const wrap = el('div', { class: 'stack tight' });

    const input = el('input', { type: 'text', placeholder: 'Add a task…', 'aria-label': 'New task' });
    const add = () => {
      const value = input.value.trim();
      if (!value) return;
      items.push({ id: Date.now().toString(36), text: value, done: false });
      setCardData(card.id, items);
      input.value = '';
      rerender();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    wrap.append(el('div', { class: 'row', style: 'gap:8px' }, [
      input,
      el('button', { class: 'btn sm primary', text: 'Add', onClick: add, style: 'flex:none' })
    ]));

    const visible = settings.hideDone ? items.filter(i => !i.done) : items;
    if (!visible.length) {
      wrap.append(el('p', { class: 'muted', style: 'font-size:13.5px;padding:6px 0', text: 'Nothing on the list.' }));
      return wrap;
    }

    const ul = el('ul', { class: 'list' });
    for (const item of visible) {
      const box = el('input', { type: 'checkbox', style: 'flex:none;width:auto;accent-color:var(--accent);transform:scale(1.2)' });
      box.checked = !!item.done;
      box.addEventListener('change', () => {
        item.done = box.checked;
        setCardData(card.id, items);
        rerender();
      });
      ul.append(el('li', {}, [
        el('div', { class: 'row', style: 'gap:11px' }, [
          box,
          el('span', {
            style: 'flex:1;min-width:0;font-size:14.5px;line-height:1.35;'
              + (item.done ? 'text-decoration:line-through;color:var(--fg-faint)' : ''),
            text: item.text
          }),
          el('button', {
            class: 'card-menu', 'aria-label': 'Delete task', text: '✕', style: 'flex:none;font-size:13px',
            onClick: () => {
              const i = items.findIndex(x => x.id === item.id);
              if (i >= 0) items.splice(i, 1);
              setCardData(card.id, items);
              rerender();
            }
          })
        ])
      ]));
    }
    wrap.append(ul);

    const open = items.filter(i => !i.done).length;
    if (items.length) {
      wrap.append(el('div', { class: 'faint', style: 'font-size:11.5px;padding-top:4px',
        text: `${open} open · ${items.length - open} done` }));
    }
    return wrap;
  },

  widget(_p, { card }) {
    const items = getCardData(card.id, []);
    const open = items.filter(i => !i.done);
    return {
      tasksOpen: String(open.length),
      topTask: open.length ? open[0].text : 'All clear'
    };
  }
};

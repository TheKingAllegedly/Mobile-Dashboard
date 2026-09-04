/* A scratchpad that saves as you type, on this device only. */
import { el } from '../core/ui.js';
import { getCardData, setCardData } from '../core/store.js';

export default {
  type: 'notes',
  name: 'Notes',
  emoji: '📝',
  blurb: 'A scratchpad that saves as you type',
  defaultSpan: 2,
  local: true,
  fields: [],
  defaultTitle: () => 'Notes',

  async load() { return { at: Date.now() }; },

  render(_p, { card }) {
    const box = el('textarea', { placeholder: 'Anything you want to remember…', 'aria-label': 'Notes' });
    box.value = getCardData(card.id, '') || '';
    const status = el('div', { class: 'faint', style: 'font-size:11.5px;margin-top:6px', text: '' });
    let timer = null;
    box.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setCardData(card.id, box.value);
        status.textContent = 'Saved ' + new Date().toLocaleTimeString();
      }, 400);
    });
    return el('div', {}, [box, status]);
  }
};

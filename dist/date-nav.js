/**
 * date-nav.js — period selector: `‹ label 📅 ›  Now  Day Week Month Year Custom`.
 *
 * Used twice with the same behaviour: in the top bar, where the selection
 * governs the whole page, and in the per-sensor dialog. It owns no data — it
 * renders a view object from ranges.js and reports the next one through
 * onChange.
 *
 * The period control comes in two shapes. A row of tabs is one click per period
 * and is what the dialog uses; a `<select>` is one control regardless of how
 * many periods there are, which is what fits a top bar that also has to hold a
 * title, a clock, a connection state and two icon buttons — on a phone as well.
 */

import { h, setText, setAttr, toggleClass } from './utils.js?v=1.2.2';
import { t, localeTag } from './i18n.js?v=1.2.2';
import { icon } from './icons.js?v=1.2.2';
import {
  RANGE_KEYS, periodLabel, shiftPeriod, canGoForward, withRange,
  toDateInput, fromDateInput, startOfDay, addMonths, defaultView, isHistorical,
} from './ranges.js?v=1.2.2';

/** A short month name in the interface language. */
function monthShort(date) {
  try {
    return new Intl.DateTimeFormat(localeTag(), { month: 'short' }).format(date);
  } catch (e) {
    return String(date.getMonth() + 1);
  }
}

export class DateNav {
  /**
   * @param {object} opts
   *   ranges   — which periods to offer (default: all)
   *   onChange — receives the next view object
   *   compact  — tighter spacing, for a header
   *   switcher — 'tabs' (a row of buttons) or 'select' (one dropdown)
   *   showNow  — offer the own "Now" button; false where something else does
   */
  constructor({ ranges = RANGE_KEYS, onChange, compact = false, switcher = 'tabs', showNow = true } = {}) {
    this.ranges = ranges;
    this.onChange = onChange || (() => {});
    this.compact = compact;
    this.switcher = switcher;
    this.showNow = showNow;
    this.view = defaultView();
    this.el = this._build();
  }

  get element() { return this.el; }

  _emit(next) {
    this.view = next;
    this.setView(next);
    this.onChange(next);
  }

  _build() {
    this.prevBtn = h('button', {
      class: 'icon-btn nav-btn', type: 'button', title: t('nav.prev'), 'aria-label': t('nav.prev'),
      html: icon('chevronLeft', { size: 16 }),
      onclick: () => this._emit(shiftPeriod(this.view, -1)),
    });
    this.nextBtn = h('button', {
      class: 'icon-btn nav-btn', type: 'button', title: t('nav.next'), 'aria-label': t('nav.next'),
      html: icon('chevronRight', { size: 16 }),
      onclick: () => { if (canGoForward(this.view)) this._emit(shiftPeriod(this.view, 1)); },
    });

    // Picking a day out of a calendar makes no sense when the period is a month
    // or a year: the native input only knows days, and `type="month"` is not
    // supported everywhere. Days and weeks keep the platform calendar (any day
    // inside a week selects that week); months and years get a small grid of
    // their own, which behaves the same in every browser.
    this.dateInput = h('input', {
      type: 'date', class: 'nav-date-input',
      onchange: () => {
        const picked = fromDateInput(this.dateInput.value);
        if (picked) this._emit({ ...this.view, anchor: startOfDay(picked) });
      },
    });
    this.label = h('span', { class: 'nav-label-text' });
    this.pop = h('div', { class: 'nav-pop', hidden: true });
    this.labelBtn = h('button', {
      class: 'nav-label', type: 'button', title: t('nav.pickDate'), 'aria-expanded': 'false',
      onclick: (e) => { e.stopPropagation(); this._openPicker(); },
    }, this.label, h('span', { class: 'nav-cal', html: icon('calendar', { size: 14 }) }), this.dateInput, this.pop);

    this.todayBtn = h('button', {
      class: 'btn btn-ghost nav-now', type: 'button', text: t('nav.today'),
      onclick: () => this._emit({ ...this.view, anchor: startOfDay(new Date()) }),
    });

    this.fromInput = h('input', {
      type: 'date', class: 'nav-range-input', 'aria-label': t('nav.from'),
      onchange: () => this._commitCustom(),
    });
    this.toInput = h('input', {
      type: 'date', class: 'nav-range-input', 'aria-label': t('nav.to'),
      onchange: () => this._commitCustom(),
    });
    this.customWrap = h('div', { class: 'nav-custom', hidden: true },
      this.fromInput, h('span', { class: 'nav-dash', text: '–' }), this.toInput);

    this.rangeBtns = {};
    this.rangeSelect = null;
    let switcher;
    if (this.switcher === 'select') {
      this.rangeSelect = h('select', {
        class: 'nav-range-select', 'aria-label': t('nav.period'),
        onchange: () => this._emit(withRange(this.view, this.rangeSelect.value)),
      }, ...this.ranges.map((key) => h('option', { value: key, text: t(`range.${key}`) })));
      switcher = this.rangeSelect;
    } else {
      switcher = h('div', { class: 'range-switch', role: 'tablist' });
      for (const key of this.ranges) {
        const btn = h('button', {
          class: 'range-btn', type: 'button', role: 'tab', dataset: { range: key },
          text: t(`range.${key}`),
          onclick: () => this._emit(withRange(this.view, key)),
        });
        this.rangeBtns[key] = btn;
        switcher.appendChild(btn);
      }
    }

    return h('div', { class: ['date-nav', this.compact ? 'is-compact' : ''] },
      h('div', { class: 'nav-period' }, this.prevBtn, this.labelBtn, this.nextBtn,
        this.showNow ? this.todayBtn : null),
      this.customWrap,
      switcher);
  }

  /** Opens whichever picker suits the current range. */
  _openPicker() {
    const grid = this.view.range === 'month' ? 'month' : this.view.range === 'year' ? 'year' : null;
    if (!grid) {
      this._closePop();
      try { this.dateInput.showPicker(); } catch (e) { this.dateInput.focus(); this.dateInput.click(); }
      return;
    }
    if (!this.pop.hidden) { this._closePop(); return; }
    this.pop.innerHTML = '';
    this.pop.appendChild(grid === 'month' ? this._monthGrid() : this._yearGrid());
    setAttr(this.pop, 'hidden', false);
    setAttr(this.labelBtn, 'aria-expanded', 'true');
    // One listener while open, removed on close: no global state left behind.
    this._popAway = (ev) => { if (!this.pop.contains(ev.target) && ev.target !== this.labelBtn) this._closePop(); };
    this._popKeys = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); this._closePop(); this.labelBtn.focus(); } };
    document.addEventListener('click', this._popAway, true);
    this.pop.addEventListener('keydown', this._popKeys);
    const first = this.pop.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  _closePop() {
    if (!this.pop || this.pop.hidden) return;
    setAttr(this.pop, 'hidden', true);
    setAttr(this.labelBtn, 'aria-expanded', 'false');
    if (this._popAway) { document.removeEventListener('click', this._popAway, true); this._popAway = null; }
    if (this._popKeys) { this.pop.removeEventListener('keydown', this._popKeys); this._popKeys = null; }
  }

  /** Twelve months of one year, with a year stepper above them. */
  _monthGrid() {
    const now = new Date();
    const shown = new Date(this.view.anchor);
    const year = shown.getFullYear();
    const head = h('div', { class: 'pop-head' },
      h('button', {
        class: 'icon-btn nav-btn', type: 'button', 'aria-label': t('nav.prev'),
        html: icon('chevronLeft', { size: 14 }),
        onclick: (e) => { e.stopPropagation(); this.view = { ...this.view, anchor: addMonths(this.view.anchor, -12) }; this.pop.innerHTML = ''; this.pop.appendChild(this._monthGrid()); },
      }),
      h('span', { class: 'pop-title', text: String(year) }),
      h('button', {
        class: 'icon-btn nav-btn', type: 'button', 'aria-label': t('nav.next'),
        disabled: year >= now.getFullYear(),
        html: icon('chevronRight', { size: 14 }),
        onclick: (e) => { e.stopPropagation(); this.view = { ...this.view, anchor: addMonths(this.view.anchor, 12) }; this.pop.innerHTML = ''; this.pop.appendChild(this._monthGrid()); },
      }));
    const grid = h('div', { class: 'pop-grid pop-months' });
    for (let m = 0; m < 12; m++) {
      const date = new Date(year, m, 1);
      const future = date > now;
      grid.appendChild(h('button', {
        class: ['pop-cell', m === shown.getMonth() ? 'is-active' : ''],
        type: 'button', disabled: future,
        text: monthShort(date),
        onclick: (e) => { e.stopPropagation(); this._closePop(); this._emit({ ...this.view, anchor: date }); },
      }));
    }
    return h('div', {}, head, grid);
  }

  /** Ten years back from the current one — statistics rarely reach further. */
  _yearGrid() {
    const now = new Date();
    const current = now.getFullYear();
    const shown = new Date(this.view.anchor).getFullYear();
    const grid = h('div', { class: 'pop-grid pop-years' });
    for (let y = current; y > current - 10; y--) {
      grid.appendChild(h('button', {
        class: ['pop-cell', y === shown ? 'is-active' : ''],
        type: 'button', text: String(y),
        onclick: (e) => { e.stopPropagation(); this._closePop(); this._emit({ ...this.view, anchor: new Date(y, 0, 1) }); },
      }));
    }
    return grid;
  }

  _commitCustom() {
    let from = fromDateInput(this.fromInput.value);
    let to = fromDateInput(this.toInput.value);
    if (!from || !to) return;
    if (from > to) [from, to] = [to, from];          // tolerate a reversed pair
    const today = startOfDay(new Date());
    if (to > today) to = today;                       // never select the future
    this._emit({ ...this.view, range: 'custom', customFrom: from, customTo: to, anchor: to });
  }

  setView(view) {
    this.view = view;
    const isCustom = view.range === 'custom';
    this._closePop();

    // The forward button stops at the current period, so the pickers must too —
    // otherwise a future date is one click away and only ever shows "no data".
    const today = toDateInput(new Date());
    for (const input of [this.dateInput, this.fromInput, this.toInput]) setAttr(input, 'max', today);

    setText(this.label, periodLabel(view));
    this.dateInput.value = toDateInput(view.anchor);
    setAttr(this.labelBtn, 'hidden', isCustom);
    setAttr(this.customWrap, 'hidden', !isCustom);
    if (isCustom) {
      this.fromInput.value = toDateInput(view.customFrom);
      this.toInput.value = toDateInput(view.customTo);
    }

    const forward = canGoForward(view);
    setAttr(this.nextBtn, 'disabled', !forward);
    setAttr(this.nextBtn, 'aria-disabled', String(!forward));
    // "Now" only makes sense while looking at the past.
    setAttr(this.todayBtn, 'hidden', !isHistorical(view));

    if (this.rangeSelect) {
      if (this.rangeSelect.value !== view.range) this.rangeSelect.value = view.range;
    }
    for (const [key, btn] of Object.entries(this.rangeBtns)) {
      const active = key === view.range;
      toggleClass(btn, 'is-active', active);
      setAttr(btn, 'aria-selected', String(active));
    }
  }
}

/**
 * date-nav.js — period selector: `‹ label 📅 ›  Now  Day Week Month Year Custom`.
 *
 * Used twice with the same behaviour: in the chart card header and in the
 * per-sensor dialog. It owns no data — it renders a view object from ranges.js
 * and reports the next one through onChange.
 */

import { h, setText, setAttr, toggleClass } from './utils.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import {
  RANGE_KEYS, periodLabel, shiftPeriod, canGoForward, withRange,
  toDateInput, fromDateInput, startOfDay, defaultView, isHistorical,
} from './ranges.js';

export class DateNav {
  /**
   * @param {object} opts
   *   ranges   — which period buttons to show (default: all)
   *   onChange — receives the next view object
   *   compact  — hides the "Now" button label, used in tight headers
   */
  constructor({ ranges = RANGE_KEYS, onChange, compact = false } = {}) {
    this.ranges = ranges;
    this.onChange = onChange || (() => {});
    this.compact = compact;
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

    // A native date input drives the picker; the visible chip shows the period
    // label, because "August 2026" reads better than "01/08/2026".
    this.dateInput = h('input', {
      type: 'date', class: 'nav-date-input',
      onchange: () => {
        const picked = fromDateInput(this.dateInput.value);
        if (picked) this._emit({ ...this.view, anchor: startOfDay(picked) });
      },
    });
    this.label = h('span', { class: 'nav-label-text' });
    this.labelBtn = h('button', {
      class: 'nav-label', type: 'button', title: t('nav.pickDate'),
      onclick: () => {
        try { this.dateInput.showPicker(); } catch (e) { this.dateInput.focus(); this.dateInput.click(); }
      },
    }, this.label, h('span', { class: 'nav-cal', html: icon('calendar', { size: 14 }) }), this.dateInput);

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
    const switcher = h('div', { class: 'range-switch', role: 'tablist' });
    for (const key of this.ranges) {
      const btn = h('button', {
        class: 'range-btn', type: 'button', role: 'tab', dataset: { range: key },
        text: t(`range.${key}`),
        onclick: () => this._emit(withRange(this.view, key)),
      });
      this.rangeBtns[key] = btn;
      switcher.appendChild(btn);
    }

    return h('div', { class: ['date-nav', this.compact ? 'is-compact' : ''] },
      h('div', { class: 'nav-period' }, this.prevBtn, this.labelBtn, this.nextBtn, this.todayBtn),
      this.customWrap,
      switcher);
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

    for (const [key, btn] of Object.entries(this.rangeBtns)) {
      const active = key === view.range;
      toggleClass(btn, 'is-active', active);
      setAttr(btn, 'aria-selected', String(active));
    }
  }
}

/**
 * settings-ui.js — settings dialog: entity mapping, options, diagnostics, export.
 *
 * This is what keeps the dashboard from guessing entity ids: auto-detection
 * proposes, the user confirms, and the result can be exported as YAML for
 * configuration.yaml so it no longer depends on this browser's localStorage.
 */

import { ROLES, GROUPS, ROLE_BY_KEY, VERSION, DEFAULT_CONFIG } from './config.js?v=1.2.0';
import { autoDetect, candidatesFor, entityInfo, scoreCandidate } from './discovery.js?v=1.2.0';
import { h, setText, setAttr, toggleClass, copyToClipboard, DASH, formatByKind, fmtClock } from './utils.js?v=1.2.0';
import { t, LANGUAGES } from './i18n.js?v=1.2.0';
import { icon } from './icons.js?v=1.2.0';

const DOMAINS = ['sensor.', 'binary_sensor.'];

export class SettingsUI {
  constructor({ client, entityManager, model, getConfig, onApply, onDemoToggle, onSetLanguage }) {
    this.client = client;
    this.entityManager = entityManager;
    this.model = model;
    this.getConfig = getConfig;
    this.onApply = onApply;
    this.onDemoToggle = onDemoToggle;
    this.onSetLanguage = onSetLanguage;
    this.el = null;
    this.draft = null;
  }

  mount(root) {
    this.root = root;
    this.el = h('div', { class: 'modal', hidden: true, onclick: (e) => { if (e.target === this.el) this.close(); } });
    root.appendChild(this.el);
    return this.el;
  }

  open(tab = 'entities') {
    this.draft = JSON.parse(JSON.stringify(this.getConfig()));
    this.el.innerHTML = '';
    this.el.appendChild(this._buildPanel(tab));
    setAttr(this.el, 'hidden', false);
    this._keyHandler = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this._keyHandler);
  }

  close() {
    setAttr(this.el, 'hidden', true);
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
  }

  get isOpen() { return this.el && !this.el.hidden; }

  /* ─────────────────────────── shell ─────────────────────────── */

  _buildPanel(activeTab) {
    const tabs = [
      ['entities', t('settings.tab.entities')],
      ['options', t('settings.tab.options')],
      ['diag', t('settings.tab.diag')],
      ['export', t('settings.tab.export')],
    ];
    this.panels = {};
    const tabBar = h('div', { class: 'tabs' });
    const body = h('div', { class: 'modal-body' });

    for (const [key, label] of tabs) {
      const btn = h('button', {
        class: ['tab-btn', key === activeTab ? 'is-active' : ''], type: 'button', text: label,
        dataset: { tab: key },
        onclick: () => {
          for (const b of tabBar.children) toggleClass(b, 'is-active', b === btn);
          for (const [k, p] of Object.entries(this.panels)) setAttr(p, 'hidden', k !== key);
          if (key === 'diag') this._refreshDiagnostics();
          if (key === 'export') this._refreshExport();
        },
      });
      tabBar.appendChild(btn);
      const panel = h('div', { class: 'tab-panel', hidden: key !== activeTab });
      this.panels[key] = panel;
      body.appendChild(panel);
    }

    this._buildEntitiesTab(this.panels.entities);
    this._buildOptionsTab(this.panels.options);
    this.panels.diag.appendChild(h('div', { class: 'diag-wrap' }));
    this.panels.export.appendChild(h('div', { class: 'export-wrap' }));
    if (activeTab === 'diag') this._refreshDiagnostics();
    if (activeTab === 'export') this._refreshExport();

    this.statusEl = h('span', { class: 'modal-status' });

    return h('div', { class: 'modal-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title') },
      h('div', { class: 'modal-head' },
        h('span', { class: 'modal-title', text: t('settings.title') }),
        tabBar,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('ui.close'), html: icon('close', { size: 18 }), onclick: () => this.close() })),
      body,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-ghost', type: 'button', text: t('settings.autodetect'), onclick: () => this._autoDetect() }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: t('settings.clearAll'), onclick: () => this._clearAll() }),
        this.statusEl,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', text: t('settings.cancel'), onclick: () => this.close() }),
        h('button', { class: 'btn btn-primary', type: 'button', text: t('settings.save'), onclick: () => this._save() })));
  }

  _status(text, cls = '') {
    if (!this.statusEl) return;
    setText(this.statusEl, text);
    this.statusEl.className = `modal-status ${cls}`;
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => { setText(this.statusEl, ''); this.statusEl.className = 'modal-status'; }, 4000);
  }

  /* ─────────────────────────── entities tab ─────────────────────────── */

  _buildEntitiesTab(panel) {
    panel.innerHTML = '';
    this.fields = {};

    const allIds = this.client.listEntityIds()
      .filter((id) => DOMAINS.some((d) => id.startsWith(d)))
      .sort();
    const datalist = h('datalist', { id: 'deye-entity-list' });
    for (const id of allIds) datalist.appendChild(h('option', { value: id }));
    panel.appendChild(datalist);

    panel.appendChild(h('p', { class: 'help-text' },
      h('span', { html: `${t('settings.entitiesHelp', { n: allIds.length })} ` }),
      h('span', { html: t('settings.entitiesHelp2') })));

    for (const group of GROUPS) {
      const roles = ROLES.filter((r) => r.group === group.key);
      if (!roles.length) continue;
      const wrap = h('div', { class: `field-group tone-${group.key}` },
        h('div', { class: 'field-group-head', text: t(`group.${group.key}`, null, group.label) }));
      for (const role of roles) wrap.appendChild(this._buildField(role));
      panel.appendChild(wrap);
    }
  }

  _buildField(role) {
    const current = this.draft.entities[role.key] || '';
    const label = t(`role.${role.key}`, null, role.label);
    const input = h('input', {
      type: 'text', value: current, list: 'deye-entity-list',
      placeholder: role.optional === false ? t('settings.requiredField') : t('settings.notSet'),
      spellcheck: 'false', autocomplete: 'off',
      oninput: () => { this.draft.entities[role.key] = input.value.trim() || null; this._refreshField(role.key); },
    });
    const dot = h('span', { class: 'conf-dot' });
    const stateEl = h('span', { class: 'field-state' });
    const suggestBtn = h('button', {
      class: 'icon-btn', type: 'button', title: t('settings.suggest'),
      'aria-label': `${t('settings.suggest')}: ${label}`,
      html: icon('search', { size: 15 }),
      onclick: () => {
        const best = candidatesFor(role.key, this.client.getStates())[0];
        if (best) {
          input.value = best.entity_id;
          this.draft.entities[role.key] = best.entity_id;
          this._refreshField(role.key);
          this._status(`${label}: ${best.entity_id}`, 'is-ok');
        } else {
          this._status(t('settings.noCandidates', { label }), 'is-warn');
        }
      },
    });

    this.fields[role.key] = { input, dot, stateEl };
    const field = h('div', { class: 'field' },
      h('label', { class: 'field-label' }, label, role.optional === false ? h('small', { text: t('settings.keyRole') }) : null),
      h('div', { class: 'field-control' }, input, suggestBtn, dot, stateEl));
    setTimeout(() => this._refreshField(role.key), 0);
    return field;
  }

  _refreshField(roleKey) {
    const f = this.fields[roleKey];
    if (!f) return;
    const id = this.draft.entities[roleKey];
    const role = ROLE_BY_KEY[roleKey];
    if (!id) {
      setAttr(f.dot, 'data-c', null);
      setText(f.stateEl, '');
      return;
    }
    const st = this.client.getState(id);
    if (!st) {
      setAttr(f.dot, 'data-c', 'low');
      setText(f.stateEl, t('settings.noSuchEntity'));
      f.stateEl.style.color = 'var(--danger-color)';
      return;
    }
    const info = entityInfo(st);
    // Does the chosen entity actually look like this role (unit, device_class, name)?
    const score = scoreCandidate(role, info);
    const conf = score >= 10 ? 'high' : score >= 7 ? 'medium' : score > 0 ? 'low' : 'mismatch';
    setAttr(f.dot, 'data-c', conf);
    f.dot.title = conf === 'mismatch' ? t('settings.confMismatch') : t('settings.confMatch', { conf, score });
    f.stateEl.style.color = '';
    const shown = role.kind === 'text' ? String(info.state) : `${info.state} ${info.unit}`.trim();
    setText(f.stateEl, shown.length > 22 ? `${shown.slice(0, 22)}…` : shown);
  }

  _autoDetect() {
    const states = this.client.getStates();
    // Fill the gaps, never overwrite what the user typed by hand — "Clear all"
    // is the deliberate way to start over.
    const { mapping, report, prefix } = autoDetect(states, { keepExisting: this.draft.entities });
    let filled = 0;
    for (const role of ROLES) {
      const id = mapping[role.key];
      this.draft.entities[role.key] = id || null;
      const f = this.fields[role.key];
      if (f) f.input.value = id || '';
      if (id) filled++;
      this._refreshField(role.key);
      const rep = report.find((x) => x.role === role.key);
      if (f && rep && rep.confidence !== 'none') setAttr(f.dot, 'data-c', rep.confidence);
    }
    const device = prefix ? t('settings.detectedDevice', { prefix: prefix.replace(/_$/, '') }) : '';
    this._status(t('settings.detected', { n: filled, total: ROLES.length, device }), 'is-ok');
  }

  _clearAll() {
    for (const role of ROLES) {
      this.draft.entities[role.key] = null;
      const f = this.fields[role.key];
      if (f) { f.input.value = ''; this._refreshField(role.key); }
    }
    this._status(t('settings.cleared'), 'is-warn');
  }

  /* ─────────────────────────── options tab ─────────────────────────── */

  _buildOptionsTab(panel) {
    panel.innerHTML = '';
    const d = this.draft;

    const sel = (value, options, onChange) => {
      const s = h('select', { onchange: () => onChange(s.value) });
      for (const [v, label] of options) s.appendChild(h('option', { value: v, text: label, selected: v === value }));
      s.value = value;
      return s;
    };
    const numInput = (value, onChange, step = 'any') => h('input', {
      type: 'number', step, value: value === null || value === undefined ? '' : value, placeholder: t('settings.auto'),
      oninput: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)),
    });
    const toggle = (checked, onChange, label) => {
      const inp = h('input', { type: 'checkbox', checked, onchange: () => onChange(inp.checked) });
      return h('label', { class: 'switch' }, inp, h('span', { class: 'switch-track' }), h('span', { class: 'switch-label', text: label }));
    };

    const battery = this.model ? this.model.batteryLearner : null;
    const grid = this.model ? this.model.gridLearner : null;
    const learned = (l) => (l && l.resolved ? ` (${t(`sign.${l.resolved}`)}, ${Math.round(l.confidence * 100)}%)` : '');

    panel.append(
      h('div', { class: 'field-group' },
        h('div', { class: 'field-group-head', text: t('settings.signs') }),
        h('p', { class: 'help-text', html: t('settings.signsHelp') }),
        field(t('settings.batterySign'),
          sel(d.powerDirection.battery, [
            ['auto', t('settings.auto') + learned(battery)],
            ['charge_positive', t('settings.signCharge')],
            ['discharge_positive', t('settings.signDischarge')],
          ], (v) => { d.powerDirection.battery = v; })),
        field(t('settings.gridSign'),
          sel(d.powerDirection.grid, [
            ['auto', t('settings.auto') + learned(grid)],
            ['import_positive', t('settings.signImport')],
            ['export_positive', t('settings.signExport')],
          ], (v) => { d.powerDirection.grid = v; })),
        field(t('settings.loadSign'),
          sel(d.powerDirection.load, [['normal', t('settings.loadAsIs')], ['inverted', t('settings.loadInvert')]], (v) => { d.powerDirection.load = v; })),
        field('', h('button', {
          class: 'btn btn-ghost', type: 'button', text: t('settings.resetLearned'),
          onclick: () => { if (this.model) this.model.resetLearned(); this._status(t('settings.resetLearnedDone'), 'is-ok'); },
        }))),

      h('div', { class: 'field-group' },
        h('div', { class: 'field-group-head', text: t('settings.system') }),
        field(t('settings.ratedPower'), numInput(d.ratedPowerKw, (v) => { d.ratedPowerKw = v; }, '0.1')),
        field(t('settings.batteryCapacity'), numInput(d.batteryCapacityKwh, (v) => { d.batteryCapacityKwh = v; }, '0.1')),
        field(t('settings.staleAfter'), numInput(d.staleAfterSeconds, (v) => { d.staleAfterSeconds = v || 600; }, '30')),
        field(t('settings.dashboardTitle'), h('input', { type: 'text', value: d.title || '', oninput: (e) => { d.title = e.target.value; } }))),

      h('div', { class: 'field-group' },
        h('div', { class: 'field-group-head', text: t('settings.display') }),
        field(t('settings.language'),
          sel(d.language || 'auto',
            [['auto', t('settings.languageAuto')], ...LANGUAGES.map((l) => [l.code, l.label])],
            (v) => { d.language = v; if (this.onSetLanguage) this.onSetLanguage(v); })),
        field(t('settings.phasesBlock'),
          sel(d.showPhases, [['auto', t('settings.phasesAuto')], ['always', t('settings.phasesAlways')], ['never', t('settings.phasesNever')]], (v) => { d.showPhases = v; })),
        field(t('settings.defaultRange'),
          sel(d.chart.defaultRange, [
            ['day', t('range.day')], ['week', t('range.week')],
            ['month', t('range.month')], ['year', t('range.year')],
            ['custom', t('range.custom')],
          ], (v) => { d.chart.defaultRange = v; })),
        field(t('settings.animations'),
          sel(d.animations, [
            ['auto', t('settings.animationsAuto')],
            ['on', t('settings.animationsOn')],
            ['off', t('settings.animationsOff')],
          ], (v) => { d.animations = v; })),
        field('', toggle(d.debug, (v) => { d.debug = v; }, t('settings.debug'))),
        this.onDemoToggle ? field('', h('button', {
          class: 'btn btn-ghost', type: 'button', text: t('settings.demoMode'),
          onclick: () => { this.close(); this.onDemoToggle(); },
        })) : null));
  }

  /* ─────────────────────────── diagnostics tab ─────────────────────── */

  _refreshDiagnostics() {
    const wrap = this.panels.diag.querySelector('.diag-wrap');
    wrap.innerHTML = '';
    const all = this.entityManager.diagnostics();
    const mapped = all.filter((d) => d.entityId);
    const unmapped = all.filter((d) => !d.entityId);

    const pills = [];
    if (this.model) {
      for (const [name, l] of [[t('src.battery'), this.model.batteryLearner], [t('src.grid'), this.model.gridLearner]]) {
        pills.push(h('span', { class: 'pill', text: `${name}: ${t(`sign.${l.value}`)} · ${l.source} · ${Math.round(l.confidence * 100)}%` }));
      }
    }

    wrap.append(
      h('div', { class: 'help-text', style: { marginBottom: '10px' },
        text: t('settings.diagMeta', { mode: this.client.mode || DASH, status: this.client.status, version: VERSION }) }),
      h('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '14px' } }, ...pills),
      table(mapped),
      h('p', { class: 'help-text', style: { marginTop: '12px' },
        text: t('settings.diagUnmapped', {
          n: unmapped.length,
          list: unmapped.slice(0, 12).map((u) => u.role).join(', ') + (unmapped.length > 12 ? '…' : ''),
        }) }),
      h('button', {
        class: 'btn btn-ghost', type: 'button', text: t('settings.copyReport'),
        style: { marginTop: '10px' },
        onclick: () => {
          const payload = {
            version: VERSION, mode: this.client.mode, status: this.client.status,
            generated: fmtClock(new Date()),
            config: stripDefaults(this.getConfig()),
            signs: this.model ? { battery: this.model.batteryLearner, grid: this.model.gridLearner } : null,
            entities: all,
          };
          copyToClipboard(JSON.stringify(payload, null, 2))
            .then(() => this._status(t('settings.reportCopied'), 'is-ok'))
            .catch(() => this._status(t('settings.copyFailed'), 'is-warn'));
        },
      }));
  }

  /* ─────────────────────────── export tab ─────────────────────────── */

  _refreshExport() {
    const wrap = this.panels.export.querySelector('.export-wrap');
    wrap.innerHTML = '';
    const cfg = stripDefaults(this.draft);
    const yaml = toPanelYaml(cfg);
    const json = JSON.stringify(cfg, null, 2);

    wrap.append(
      h('p', { class: 'help-text', html: t('settings.exportHelp') }),
      h('textarea', { readonly: true, value: yaml, spellcheck: 'false' }),
      h('div', { style: { display: 'flex', gap: '8px', margin: '8px 0 18px' } },
        h('button', { class: 'btn btn-ghost', type: 'button', text: t('settings.copyYaml'),
          onclick: () => copyToClipboard(yaml).then(() => this._status(t('settings.yamlCopied'), 'is-ok')) })),
      h('p', { class: 'help-text', text: t('settings.exportJsonHelp') }),
      h('textarea', { readonly: true, value: json, spellcheck: 'false' }),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
        h('button', { class: 'btn btn-ghost', type: 'button', text: t('settings.copyJson'),
          onclick: () => copyToClipboard(json).then(() => this._status(t('settings.jsonCopied'), 'is-ok')) }),
        h('button', {
          class: 'btn btn-ghost', type: 'button', text: t('settings.pasteJson'),
          onclick: async () => {
            try {
              const text = await navigator.clipboard.readText();
              const parsed = JSON.parse(text);
              this.draft = { ...this.draft, ...parsed, entities: { ...this.draft.entities, ...(parsed.entities || {}) } };
              this._buildEntitiesTab(this.panels.entities);
              this._buildOptionsTab(this.panels.options);
              this._refreshExport();
              this._status(t('settings.jsonLoaded'), 'is-ok');
            } catch (e) {
              this._status(t('settings.jsonInvalid'), 'is-warn');
            }
          },
        })));
  }

  _save() {
    this.onApply(this.draft);
    this.close();
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

function field(labelText, control) {
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', text: labelText || '' }),
    h('div', { class: 'field-control' }, control));
}

function table(rows) {
  const tbl = h('table', { class: 'diag-table' },
    h('thead', {}, h('tr', {},
      h('th', { text: t('settings.diagRole') }), h('th', { text: t('settings.diagEntity') }),
      h('th', { text: t('settings.diagRaw') }), h('th', { text: t('settings.diagModel') }),
      h('th', { text: t('settings.diagStatus') }))));
  const tb = h('tbody');
  for (const r of rows) {
    const f = r.value === null ? { value: DASH, unit: '' } : formatByKind(r.kind, r.value);
    tb.appendChild(h('tr', { 'data-status': r.status },
      h('td', { text: r.role }),
      h('td', { class: 'mono', text: r.entityId || DASH }),
      h('td', { text: r.rawState === null ? DASH : `${r.rawState} ${r.rawUnit}`.trim() }),
      h('td', { text: `${f.value} ${f.unit}`.trim() }),
      h('td', {}, h('span', { class: 'pill', text: r.stale ? 'stale' : r.assumedUnit ? 'unit?' : r.status }))));
  }
  tbl.appendChild(tb);
  return tbl;
}

/** Drops values equal to the defaults and empty entity slots. */
function stripDefaults(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'entities') {
      const ent = {};
      for (const [rk, rv] of Object.entries(v)) if (rv) ent[rk] = rv;
      if (Object.keys(ent).length) out.entities = ent;
      continue;
    }
    if (JSON.stringify(v) === JSON.stringify(DEFAULT_CONFIG[k])) continue;
    out[k] = v;
  }
  return out;
}

function toPanelYaml(cfg) {
  const lines = [
    'panel_custom:',
    '  - name: deye-dashboard',
    '    sidebar_title: Deye',
    '    sidebar_icon: mdi:solar-power-variant',
    '    url_path: deye-dashboard',
    '    module_url: /local/deye-dashboard/deye-dashboard.js?v=' + VERSION,
    '    embed_iframe: false',
    '    require_admin: false',
  ];
  const keys = Object.keys(cfg);
  if (keys.length) {
    lines.push('    config:');
    for (const [k, v] of Object.entries(cfg)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        const entries = Object.entries(v).filter(([, x]) => x !== null && x !== undefined);
        if (!entries.length) continue;
        lines.push(`      ${k}:`);
        for (const [k2, v2] of entries) lines.push(`        ${k2}: ${yamlScalar(v2)}`);
      } else {
        lines.push(`      ${k}: ${yamlScalar(v)}`);
      }
    }
  }
  return lines.join('\n');
}

function yamlScalar(v) {
  if (typeof v === 'string') return /[:#{}[\],&*?|<>=!%@`"']/.test(v) ? JSON.stringify(v) : v;
  return String(v);
}

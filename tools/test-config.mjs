/**
 * test-config.mjs — unit tests for the stored-configuration migration.
 *   node tools/test-config.mjs
 *
 * This is the one thing that breaks silently for someone upgrading from 1.0.2:
 * their browser still holds the old shapes (`animations: true`, `range: '7d'`),
 * and nothing on screen would say the value was dropped.
 */
import { mergeConfig, unknownRoles, DEFAULT_CONFIG, ROLES, ROLE_BY_KEY, VERSION } from '../deye-dashboard/js/config.js';

let pass = 0;
const failures = [];
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}
const ok = (name, cond, detail = '') => eq(name, cond ? true : `false ${detail}`, true);

/* ── the three-state animation setting grew out of a boolean ── */
eq('animations: true becomes auto', mergeConfig(null, { animations: true }).animations, 'auto');
eq('animations: false becomes off', mergeConfig(null, { animations: false }).animations, 'off');
eq('animations: auto survives', mergeConfig(null, { animations: 'auto' }).animations, 'auto');
eq('animations: on survives', mergeConfig(null, { animations: 'on' }).animations, 'on');
eq('a nonsense value falls back to the default', mergeConfig(null, { animations: 'sometimes' }).animations, 'on');
// The flow is the point of the diagram: it runs unless someone turns it down.
eq('animation is on by default', DEFAULT_CONFIG.animations, 'on');
eq('an absent value takes the default', mergeConfig(null, {}).animations, DEFAULT_CONFIG.animations);

/* ── range keys were renamed when periods became calendar-exact ── */
const range = (v) => mergeConfig(null, { chart: { defaultRange: v } }).chart.defaultRange;
eq("'today' becomes 'day'", range('today'), 'day');
eq("'7d' becomes 'week'", range('7d'), 'week');
eq("'30d' becomes 'month'", range('30d'), 'month');
eq("'day' survives", range('day'), 'day');
eq("'year' survives", range('year'), 'year');
eq("'custom' survives", range('custom'), 'custom');
eq('an unknown key falls back to day', range('fortnight'), 'day');

/* ── the pinned entity mapping is never lost by a merge ── */
const stored = { entities: { pvPower: 'sensor.a', loadPower: 'sensor.b' } };
const yaml = { entities: { pvPower: 'sensor.from_yaml', gridPower: 'sensor.c' }, ratedPowerKw: 12 };
const merged = mergeConfig(yaml, stored);
eq('the UI wins over YAML for the same role', merged.entities.pvPower, 'sensor.a');
eq('a role only in YAML is kept', merged.entities.gridPower, 'sensor.c');
eq('a role only in localStorage is kept', merged.entities.loadPower, 'sensor.b');
eq('YAML scalars are kept', merged.ratedPowerKw, 12);
ok('every default role key exists in the merged mapping',
  Object.keys(DEFAULT_CONFIG.entities).every((k) => k in merged.entities));

/* ── a stored value must never introduce an unknown role ── */
const junk = mergeConfig(null, { entities: { notARole: 'sensor.x' } });
eq('an unknown role is dropped', junk.entities.notARole, undefined);

/* ── polarity settings ── */
eq('battery polarity default', mergeConfig(null, {}).powerDirection.battery, 'auto');
eq('a pinned polarity survives',
  mergeConfig(null, { powerDirection: { battery: 'discharge_positive' } }).powerDirection.battery, 'discharge_positive');
eq('an invalid polarity falls back to auto',
  mergeConfig(null, { powerDirection: { grid: 'sideways' } }).powerDirection.grid, 'auto');

/* ── language ── */
eq('language default', DEFAULT_CONFIG.language, 'en');
eq('a stored language survives', mergeConfig(null, { language: 'uk' }).language, 'uk');
eq('an unsupported language falls back', mergeConfig(null, { language: 'ru' }).language, 'en');

/* ── roles a stored mapping has never heard of ── */
// A mapping saved by 1.0.2 has no generator keys at all; one saved later holds
// generatorPower: null when the user cleared it. Only the first kind is new, and
// only new roles may be filled in by detection without asking.
const savedBy102 = { entities: { pvPower: 'sensor.pv', batterySoc: 'sensor.soc' } };
ok('a role absent from the saved mapping is new', unknownRoles(savedBy102).includes('generatorPower'));
ok('a mapped role is not new', !unknownRoles(savedBy102).includes('pvPower'));
ok('a role the user cleared is not new', !unknownRoles({ entities: { generatorPower: null } }).includes('generatorPower'));
ok('a role named in the panel_custom config is not new',
  !unknownRoles({ entities: { generatorPower: 'sensor.gen' } }, savedBy102).includes('generatorPower'));
eq('with nothing stored every role is new', unknownRoles(null, null).length, ROLES.length);

/* ── role table sanity: the auto-detection depends on it ── */
ok('every role has a unique key', new Set(ROLES.map((r) => r.key)).size === ROLES.length);
ok('every role has a kind and a group', ROLES.every((r) => r.kind && r.group));
ok('every role is reachable by key', ROLES.every((r) => ROLE_BY_KEY[r.key] === r));
ok('key roles are not optional',
  ['pvPower', 'batterySoc', 'batteryPower', 'gridPower', 'loadPower'].every((k) => ROLE_BY_KEY[k] && !ROLE_BY_KEY[k].optional));
ok(`version looks like a release (${VERSION})`, /^\d+\.\d+\.\d+$/.test(VERSION));

if (failures.length) {
  console.log(`config.js: ${failures.length} of ${pass + failures.length} checks FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`config.js: all ${pass} checks passed`);

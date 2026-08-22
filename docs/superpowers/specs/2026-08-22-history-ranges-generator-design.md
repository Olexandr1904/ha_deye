# Deye Dashboard — history ranges, sensor drill-down, generator

Date: 2026-08-22 · Status: approved design · Version target: 1.1.0

## Context

The dashboard (v1.0.2) is deployed and verified inside Home Assistant 2025.11.3:
40 entities pinned from `packages/deye_dashboard.yaml`, English and Ukrainian UI,
88 browser checks locally and 22 against the live inverter.

Today the chart offers exactly three fixed ranges (`today`, `7d`, `30d`) anchored
to "now", nothing in the UI can be clicked for detail, and the generator inputs
the inverter exposes are deliberately ignored. This design adds five things the
owner asked for:

1. a date picker for past periods;
2. confirmation and control over the animated flow particles;
3. generator support;
4. a per-sensor history dialog opened by clicking a value;
5. selectable period lengths (day … year, plus a custom interval) with honest
   handling of missing data.

## Goals

- Any past period can be inspected: day, week, month, year, or a custom interval.
- Selecting a period that is entirely in the past puts the whole panel into a
  clearly marked historical mode instead of mixing live and past values.
- Any displayed value backed by an entity can be opened as its own chart.
- A connected generator is a first-class energy source: diagram, balance,
  distribution, KPI and card.
- Flow animation is controllable and its interaction with the operating system's
  "reduce motion" preference is explicit rather than surprising.

## Non-goals

- Per-sensor aggregate cards in historical mode (detail cards are hidden there).
- Comparing two periods side by side.
- CSV/data export.
- Solar forecast, although `sensor.solcast_*` entities exist on this system.
- Any new backend, database or polling. Data still comes only from the Home
  Assistant WebSocket API.

## Decisions and rationale

**Time context lives in `app.js`; the live pipeline is untouched.** Two
alternatives were rejected: a unified view-model layer (forcing period
aggregates into a model designed for instantaneous values means half its fields
become lies), and a separate history screen (duplicates KPI and chart rendering
for a mode we deliberately narrowed to "header + KPI + chart").

**Mode is derived, never stored.** `history` ⟺ the selected period does not
contain the current moment. One rule covers every case: day+today and
month+current-month stay live, day+15-Aug and month+July are history. The `Now`
button only moves the anchor.

**KPI always matches the selected period, and the tiles stop naming a period.**
`PV TODAY` becomes `SOLAR`; `BATTERY CHARGED`, `BATTERY USED`, `CONSUMPTION`,
`GRID IMPORT`, `GRID EXPORT` and `SELF-SUFFICIENCY` keep their labels.
The period is stated once, in the date bar. Source differs by period: for
day+today the existing daily-reset sensors are used directly (no API call, always
in sync with the inverter); every other period comes from long-term statistics.

**Self-sufficiency is defined differently per mode, on purpose.** Live:
`100 − grid share` of the instantaneous load, from the allocation — everything
that was not bought from the utility, so a running generator counts towards it
(it burns fuel, but it is still not a purchase). Period:
`(consumption − import) / consumption`, the standard "share of consumption not
bought from the grid". Both are honest for their timescale; the difference is
documented here so it is not mistaken for a bug.

**The generator appears when it is relevant, not always.** Relevant means
`generatorPower > 0.015 kW` OR `generatorToday > 0.01 kWh`. Because the daily
counter does not reset until midnight, the diagram changes shape at most once a
day, so there is no flapping between layouts.

## Module map

New:

| Module | Responsibility |
|---|---|
| `js/ranges.js` | Calendar period arithmetic. Pure functions, no DOM, unit-tested in node. |
| `js/date-nav.js` | Reusable control: `‹ label 📅 ›` plus period buttons. Used by the chart header and the sensor dialog. |
| `js/detail-dialog.js` | Single-sensor dialog: chart, date navigation, min/avg/max, link into Home Assistant. |

Changed: `history.js` (generalised fetch), `renderer.js` (history branch,
generator node, clickable values), `app.js` (time context, dialog wiring),
`flow-layout.js` (two extra layouts), `power-flow.js` and `energy-model.js`
(generator in the balance), `charts.js` (min–max band series), `config.js`,
`i18n.js`, CSS.

## Time model

```js
view = {
  range: 'day' | 'week' | 'month' | 'year' | 'custom',
  anchor: Date,        // local midnight identifying the period
  customFrom: Date,    // used when range === 'custom'
  customTo: Date,
}
```

`ranges.js` API (every function that needs the clock takes `now` as its last
parameter, defaulting to `new Date()`, so the unit tests are time-independent):

- `periodBounds(view, now)` → `{ from, to, step, includesNow }`. `to` is exclusive
  and clamped to "now" when the period contains it.
- `shiftPeriod(view, delta)` → new view. A custom interval shifts by its own length.
- `periodLabel(view)` → localised label (`15 Aug 2026`, `10–16 Aug 2026`,
  `August 2026`, `2026`, `1 Jul – 15 Aug 2026`).
- `canGoForward(view, now)` → false when the next period starts in the future.
- `stepFor(from, to)` → `'power' | 'day' | 'month'`.
- `isHistorical(view, now)` / `usesLiveCounters(view, now)` — the two derived
  questions the rest of the code asks instead of storing a mode.
- `withRange(view, range, now)` — switch range keeping the anchor; a custom range
  derived from the current month or year is clamped so it never ends in the future.
- `defaultView(range)`, `RANGE_KEYS`, `toDateInput` / `fromDateInput`, and the
  calendar primitives (`startOfDay/Week/Month/Year`, `addDays`, `addMonths`).

Bounds: weeks start on Monday, unconditionally — no locale-dependent week start.
Months and years are calendar-exact. Aggregation step by range: day → `power`,
week and month → `day`, year → `month`, custom → `stepFor`, which measures the
interval in **calendar days** (not hours, so a 25-hour DST day does not change
the resolution): ≤2 days → `power`, ≤92 days → `day`, otherwise `month`.

## Data loading

`history.js` exposes:

- `fetchPowerSeries(client, entityIds, from, to)` → per-entity `[[ms, kW]]`,
  decimated with LTTB. Backs the `power` step.
- `fetchEnergyBars(client, statIds, from, to, period)` → per-entity
  `[{start, value}]` from `recorder/statistics_during_period` using `change`,
  falling back to a `sum` diff on older cores.
- `fetchSensorStats(client, statId, from, to, period)` → `[{start, mean, min, max}]`
  for the sensor dialog's band chart.
- `listStatisticIds(client, ids)` → which entities have long-term statistics.

Caching stays as-is: keyed by range and rounded end time, 60 s TTL, on-demand only.

## Chart content

| Step | Series | Source |
|---|---|---|
| `power` | Solar, House, Battery, Grid (signed) | `history/history_during_period` |
| `day` / `month` | Solar, House, Import, Export, and Generator when relevant | statistics `change` |

In the sensor dialog the series is chosen by the quantity, not by the range:
energy roles get bars of per-period change; every other kind gets a mean line
with a shaded min–max band. This requires one new series type in `charts.js`
(`band`), reusing the existing monotone-path machinery.

## Historical mode

Shown: header with a `VIEWING <period>` banner and a `Now` button, the date bar,
the KPI row for the period, the chart. Hidden: the flow diagram card and every
detail card (battery, grid, solar, phases, inverter, generator). The connection
status chip keeps its normal live meaning.

## Missing data

Three distinct situations, three distinct messages:

1. The entity has no long-term statistics → empty chart state plus `—` in the KPI
   tile, with a hint that the sensor needs a `state_class`.
2. The period lies entirely before data existed → "no data for this period".
3. The period is partially covered → draw what exists, no warning.

Forward navigation is disabled (not silently ignored) at the current period.
Backward navigation is unlimited: clamping it correctly would need an extra query
per entity and would still be wrong after a Recorder purge.

Consequence worth stating for this installation: `recorder: purge_keep_days: 120`
purges detailed states but not long-term statistics. A **day** older than roughly
the retention window will therefore be empty while the same month or year still
has bars. The day-view empty state names this and suggests Week or Month.

## Generator

Roles (already added in `config.js`): `generatorPower`, `generatorToday`,
`generatorTotal`, `generatorVoltage`, `generatorStatus`. Auto-detection excludes
setpoints and, as before, keeps generator sensors out of the phase roles.

Balance becomes `pv + generator + grid_import = load + battery_charge`. Without
this the balance-mismatch banner would fire whenever the generator runs, and — worse —
the balance-based polarity learner would learn a wrong sign. Load coverage
priority in the distribution: solar → generator → battery → grid, labelled
"calculated" like the rest of that block.

Surfaces: a fifth diagram node and link, a fourth segment in the coverage bar, an
optional KPI tile, and a `GENERATOR` card — all governed by the relevance rule.

Geometry, viewBox `1000×700`, node radius 74, hub half-size 95, gaps 6 at the node
and 10 at the inverter:

```text
wideGen     solar (500, 92)      grid (150, 240)      generator (150, 460)
            house (860, 350)     battery (500, 610)   hub (500, 350)
  paths     solar  M500,172 L500,245     grid  M226,264 L395,317
            gen    M226,436 L395,383     load  M780,350 L605,350
            battery M500,528 L500,455

narrowGen   viewBox 440×640
            solar (128, 82)      generator (312, 82)  hub (220, 300)
            battery (88, 520)    house (220, 520)     grid (352, 520)
  paths     solar M151,137 L190,229      gen  M289,137 L250,229
            load  M220,460 L220,372
            battery M88,460 C88,408 158,376 212,368
            grid    M352,460 C352,408 282,376 228,368
```

The existing geometry test — every link endpoint within 14 px of its node edge —
covers the new layouts unchanged.

## Sensor dialog

Any element carrying `data-role` whose role has a mapped entity becomes
interactive: stat rows, PV string rows, phase rows, KPI tiles and diagram nodes.
One delegated listener on the app root, `role="button"`, `tabindex="0"`,
Enter and Space, and a pointer cursor only where an entity actually exists.

Contents: role label as the title, `entity_id` in monospace and selectable, the
shared date navigation with the full set of periods (day … year and custom), the chart, then min / avg / max for the period and a link
to the Home Assistant history page for that entity. When the sensor has no
recorded history at all the chart area explains that instead of showing an empty
grid.

## Flow animation

`animations` becomes `'auto' | 'on' | 'off'` (booleans from older stored configs
migrate to `auto` and `off`). The value is written to `data-anim` on the app root.
The global `prefers-reduced-motion` block is scoped to `:not([data-anim="on"])`
and a new `[data-anim="off"]` block disables animation regardless of the system
setting. Settings replaces the toggle with a three-option select whose help text
states that `auto` respects the system "reduce motion" preference — the reason the
particles can look frozen through no fault of the dashboard.

## Interface strings

New i18n keys (English source, Ukrainian overrides): range names, `Custom`,
`Now`, previous/next period, "pick a date", the `VIEWING <period>` banner, the
three empty-data messages, the day-retention hint, generator node/card/KPI
labels, dialog title chrome, min/avg/max, "Open in Home Assistant", and the three
animation options. KPI tiles lose the word "TODAY".

## Testing

`ranges.js` gets plain node unit tests: bounds for every range, month and year
boundaries, custom step selection, `canGoForward` at the current period.

The CDP browser suite gains: entering history mode (diagram and detail cards
hidden, banner present, KPI recomputed), forward navigation disabled at the
current period, a custom interval, an empty period, a day older than the
retention window, the generator appearing (demo runs it in the evening — node,
animated link, balance still consistent), the sensor dialog opened from a stat
row, a KPI tile and a diagram node, the no-history case, and all three animation
states including `on` under emulated reduce-motion.

The demo client gains generator sensors with an evening run and statistics for
previous months, otherwise Year and Custom have nothing to show.

Finally: deploy, restart Home Assistant, re-run the in-HA suite against the real
inverter. Since the real generator sensors read zero, "the generator node stays
hidden on live data" is itself one of those checks.

## Rollout

Version 1.1.0. `deploy.py` writes the new `module_url` query, Home Assistant needs
a restart because `panel_custom` is read at start-up. Stored user configs migrate
silently (`animations` booleans, old `today`/`7d`/`30d` range keys). Pinned entity
mappings and learned polarity are untouched.

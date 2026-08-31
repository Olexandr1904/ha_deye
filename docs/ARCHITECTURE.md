# Deye Dashboard — a local solar dashboard for Home Assistant

A self-contained frontend that lives inside Home Assistant: an animated energy-flow
diagram, battery, grid, load, phases, and charts for today / 7 days / 30 days.

**No clouds.** No Deye Cloud, no SolarMAN, no external APIs, no CDN, no separate
backend and no database of its own. The only data source is Home Assistant.

```text
Deye inverter
     |  local network (Modbus/MQTT — through the Home Assistant integration you already have)
Home Assistant entities
     |  WebSocket API (state_changed, history, statistics)
Deye Dashboard (custom panel, vanilla JS)
```

Installation: [INSTALL.md](INSTALL.md).

---

## What is inside

| Capability | How it is done |
|---|---|
| A dedicated `Deye` item in the sidebar | `panel_custom` with `embed_iframe: false` — no iframe anywhere |
| Realtime without polling | subscription to `state_changed`, targeted DOM updates |
| Animated flows | SVG paths plus CSS `stroke-dashoffset`; speed follows the power |
| Flow direction | measured values plus automatic sensor-polarity detection |
| Distribution (PV→house, PV→battery, grid→house …) | derived from the power balance and labelled "calculated" |
| Charts | an own SVG renderer, no Chart.js or ECharts |
| Any past period | day / week / month / year or a custom interval, with a date picker |
| Historical mode | a period entirely in the past hides the live diagram instead of mixing epochs |
| Sensor drill-down | clicking any value backed by an entity opens its own chart |
| Generator | a first-class source: fifth spoke, balance, distribution, KPI and card |
| History | `history/history_during_period` and `recorder/statistics_during_period` |
| Units | taken from `unit_of_measurement`, normalised to kW / kWh / V / A / °C / Hz |
| Entity setup | keyword auto-detection, manual picking in the UI, or YAML |
| Missing data | `—`, never a crash; one broken sensor does not take the rest down |
| Connection loss | `RECONNECTING…` in the header, backfill once it returns |
| Languages | English and Ukrainian, switchable from the header |
| Mobile | a separate diagram layout and a block order that follows importance |

---

## Structure

```text
deye-dashboard.js        entry point: the <deye-dashboard> custom element, shadow DOM
index.html               standalone mode (debugging; needs a token)

js/config.js             ROLES: 55 role descriptions, defaults, stored-config migration
js/ranges.js             calendar period arithmetic (pure functions, unit-tested)
js/date-nav.js           the reusable period selector
js/detail-dialog.js      single-sensor history dialog
js/i18n.js               interface strings (English + Ukrainian)
js/utils.js              formatting, unit normalisation, DOM/SVG helpers, chart maths
js/icons.js              inline SVG icons (no external files)
js/ha-client.js          Home Assistant access: panel mode (existing hass) and standalone
js/discovery.js          entity auto-detection (domain and unit gates, keyword scoring)
js/entity-manager.js     raw Home Assistant states -> normalised role values
js/energy-model.js       the data model plus battery/grid polarity detection
js/power-flow.js         link directions and energy distribution
js/history.js            history and statistics
js/charts.js             TimeSeriesChart and DailyBarChart in SVG
js/flow-layout.js        diagram geometry (four layouts: with and without a generator)
js/renderer.js           builds the DOM once, then patches it
js/settings-ui.js        settings dialog: entities, options, diagnostics, export
js/demo.js               inverter simulation (demo mode and debugging)
js/app.js                wiring

css/dashboard.css        tokens, background, grid, header
css/components.css       flow diagram, battery, KPI, charts, settings
css/responsive.css       desktop / tablet / mobile layouts
```

## Data flow

```text
state_changed (WebSocket)
      |
EntityManager     raw state -> normalizeValue() -> {value, unit, stale, ...}
      |           (only the roles that changed are recomputed)
EnergyModel       signs, derived values, inverter state
      |
computeFlow()     link directions plus distribution
      |
DashboardRenderer setText/setAttr only where the value actually changed
```

Nothing is re-rendered wholesale. Updates are coalesced into a single
`requestAnimationFrame`. The only interval timer in the whole dashboard is a 30 s
staleness re-check — the data itself arrives as events.

---

## Sensor polarity (important for Deye)

The model's internal convention:

```text
battery.power > 0  — charging (energy goes INTO the battery)
grid.power    > 0  — import   (energy comes FROM the grid)
```

Deye integrations report these differently, so the sign is detected automatically
from three independent signals, in order of confidence:

1. **Daily energy counters.** If "sold" grows while grid power is negative, then
   negative means export. That is a fact, not a guess.
2. **SOC changes.** SOC went up while battery power was positive, so positive
   means charging. Plus the battery status text (`Charge` / `Discharge`) if present.
3. **The power balance** `pv + grid_import = load + battery_charge` — the fallback:
   the residual is accumulated for both polarities and the smaller one wins.

The result is cached in `localStorage` and shown under the gear icon →
Diagnostics (source and confidence). It can always be pinned by hand in
Options → "Battery / Grid: a positive value means".

When the data is not enough, the dashboard does **not** pretend to know: it shows
`—` or the warning "Power balance is off by …".

---

## Entity roles

Key roles (the dashboard is incomplete without them): `pvPower`, `batterySoc`,
`batteryPower`, `gridPower`, `loadPower`.

Everything else is optional and simply hides when the entity is missing:
`pvToday`, `pvTotal`, `pv1…pv4 Power/Voltage/Current`,
`batteryVoltage/Current/Temperature/Soh/Status/Capacity`,
`batteryChargePower`, `batteryDischargePower`, `batteryChargeToday`, `batteryDischargeToday`,
`gridImportPower`, `gridExportPower`, `gridImportToday`, `gridExportToday`, `gridVoltage`, `gridFrequency`,
`loadToday`, `loadTotal`,
`inverterPower`, `inverterTemperature`, `inverterStatus`, `inverterAlarm`,
`phaseA/B/C Power/Voltage/Current`.

The full list with auto-detection hints lives in [js/config.js](../deye-dashboard/js/config.js).

Auto-detection works in three steps: filter by domain and unit / `device_class`,
score by keywords, then a second pass with a bonus for a shared `entity_id`
prefix. The domain filter only accepts `sensor` and `binary_sensor`, because
`number.*` entities are inverter **setpoints** — reading
`number.inverter_grid_max_export_power` as the current export would be wrong.

---

## Periods and history

The top bar carries the whole time selection — `‹ 22 Aug 2026 📅 ›` plus a
period list, with a picker that matches the period (a calendar for a day or a
week, a grid of months for a month, a list of years for a year) — because the choice governs the entire page, not just the chart:
the diagram, the detail cards and every KPI tile follow it. Weeks start on Monday; months and years are
calendar-exact; a custom interval picks its own resolution — up to 48 hours it
draws instantaneous power, up to 92 days daily bars, beyond that monthly bars.

Whether the dashboard is live or historical is **derived, never toggled**: a
period that contains the present keeps the diagram and the detail cards, a period
strictly in the past replaces them with a `VIEWING …` banner, KPI totals for that
period and the chart. Forward navigation stops at the current period; backward
navigation is unlimited, and an empty period says which of the three reasons
applies — the sensor has no long-term statistics, the period predates the data,
or detailed states for that day have already been purged while its month still
has bars.

KPI tiles always match the selected period. Today's numbers come from the live
daily counters; any other period comes from long-term statistics. Note that
self-sufficiency is necessarily defined differently for the two: live it is the
share of instantaneous load covered by solar, generator and battery, while over a
period it is the share of consumption that was not bought from the grid.

## Clicking a value

Any stat row, PV string, phase, KPI tile or diagram node backed by an entity
opens a dialog with that sensor's own history, its own date navigation and
min / avg / max for the period, plus a link to the Home Assistant history page.
Energy counters are drawn as bars of per-period change; instantaneous quantities
get a mean line with a shaded min–max band, which is the only useful way to look
at power or temperature over a month.

## Generator

If the inverter reports a generator, it becomes a full energy source rather than
a footnote: a fifth spoke in the diagram, a term in the power balance
(`pv + generator + grid_import = load + battery_charge`), a share in the load
coverage, a KPI tile and a card. It appears when it has power or has produced
energy today, and because the daily counter only resets at midnight the diagram
changes shape at most once a day.

## Flow animation

The particles move along each link in the direction energy actually flows, at a
speed derived from the power, and stop when a flow is idle. The setting under the
gear icon has three states: `auto` respects the operating system's "reduce
motion" preference, `on` animates regardless, `off` never animates. If the
particles ever look frozen, that system preference is the first thing to check.

## Configuration through YAML (optional)

To make the configuration independent of the browser, set it on the panel itself:

```yaml
panel_custom:
  - name: deye-dashboard
    # …
    config:
      language: auto              # auto | en | uk
      ratedPowerKw: 12
      batteryCapacityKwh: 11.7    # omit it and the value comes from an entity
      powerDirection:
        battery: auto             # auto | charge_positive | discharge_positive
        grid: auto                # auto | import_positive | export_positive
      entities:
        pvPower: sensor.inverter_pv_power
        batterySoc: sensor.inverter_battery
        batteryPower: sensor.inverter_battery_power
        gridPower: sensor.inverter_grid_power
        loadPower: sensor.inverter_load_power
```

Priority: defaults → `config:` from YAML → settings from the UI (localStorage).
The gear icon → Export tab generates ready-made YAML for your own system.

---

## Deliberately absent

* Lovelace cards and stacks of dozens of them;
* an iframe with Deye Cloud;
* a separate Python/Node backend or a database;
* calls to cloud servers and analytics;
* sensor polling and a `setInterval` per value;
* React/Vue/Angular and external charting libraries;
* hard-coded entity ids and hard-coded units.

---

## Tests

The plan behind them, and what is deliberately not covered, is in
[test-plan.md](test-plan.md).

```bash
./tools/run-tests.sh
```

One command runs everything: 217 unit assertions (period arithmetic, energy
distribution, history windowing, chart axes, stored-config migration and the
deployment YAML — no browser,
under a second) and then 181
checks in a real Chrome, headless over the Chrome DevTools Protocol with no npm
dependencies. Link geometry is measured in screen coordinates for all three
diagram layouts, responsive layout is verified with real device emulation from
390 to 2560 px, and there are separate checks for `unavailable` entities,
connection loss, onboarding, polarity auto-detection, the sensor dialog,
keyboard activation, accessibility and a clean console. See
[tools/README.md](../tools/README.md).

There is also a check **inside a running Home Assistant**
(`tools/test-in-ha.mjs`, which boots the panel in the real HA frontend with live
inverter data): 42 assertions covering panel registration, `panel` mode without
an own WebSocket, the power balance, history and a week of statistics from
Recorder, the period selector inside the HA shell, historical mode hiding every
live card, the sensor dialog on a real entity, diagnostics free of
`unavailable`, `hass-toggle-menu`, and — the one that earns its keep — every KPI
tile for a past day checked against the inverter's own daily counter, read
through the states API so the two paths stay independent.

## Debugging

```text
?demo=1&hour=13.5    test data with the time of day pinned
?deye_debug=1        [DEYE] logs in the console
?deye_range=week     open a specific chart period (day|week|month|year)
?deye_settings=diag  open the settings dialog (entities|options|diag|export)
?deye_noauto=1       skip entity auto-detection
?diag=1              layout measurements (index.html only)
```

Demo mode deliberately reports battery power with inverted polarity
(`+` = discharge) so the sign auto-detection gets exercised.

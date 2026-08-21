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
| Charts | an own SVG renderer (~330 lines), no Chart.js or ECharts |
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

js/config.js             ROLES: 50 role descriptions plus auto-detection hints
js/i18n.js               interface strings (English + Ukrainian)
js/utils.js              formatting, unit normalisation, DOM/SVG helpers, chart maths
js/icons.js              inline SVG icons (no external files)
js/ha-client.js          Home Assistant access: panel mode (existing hass) and standalone
js/entity-manager.js     raw Home Assistant states -> normalised role values
js/energy-model.js       the data model plus battery/grid polarity detection
js/power-flow.js         link directions and energy distribution
js/history.js            history and statistics
js/charts.js             TimeSeriesChart and DailyBarChart in SVG
js/flow-layout.js        diagram geometry (wide and narrow layouts)
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

The full list with auto-detection hints lives in [js/config.js](js/config.js).

Auto-detection works in three steps: filter by domain and unit / `device_class`,
score by keywords, then a second pass with a bonus for a shared `entity_id`
prefix. The domain filter only accepts `sensor` and `binary_sensor`, because
`number.*` entities are inverter **setpoints** — reading
`number.inverter_grid_max_export_power` as the current export would be wrong.

---

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

```bash
./tools/run-tests.sh
```

78 checks in a real Chrome (headless, over the Chrome DevTools Protocol, no npm
dependencies): link geometry is measured in screen coordinates, responsive layout
is verified with real device emulation from 390 to 2560 px, and there are separate
checks for `unavailable` entities, connection loss, onboarding, polarity
auto-detection, accessibility and a clean console. See [tools/README.md](../tools/README.md).

There is also a check **inside a running Home Assistant** (the panel boots in the
real HA frontend with live inverter data): 21 assertions covering panel
registration, `panel` mode without an own WebSocket, the power balance, history
from Recorder, 7-day statistics, diagnostics free of `unavailable`, layout inside
the HA shell, and `hass-toggle-menu`.

## Debugging

```text
?demo=1&hour=13.5    test data with the time of day pinned
?deye_debug=1        [DEYE] logs in the console
?deye_range=7d       open a specific chart range
?deye_settings=diag  open the settings dialog (entities|options|diag|export)
?deye_noauto=1       skip entity auto-detection
?diag=1              layout measurements (index.html only)
```

Demo mode deliberately reports battery power with inverted polarity
(`+` = discharge) so the sign auto-detection gets exercised.

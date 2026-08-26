# tools/ — dashboard tooling

These files are **not** part of what gets copied into Home Assistant: only the
`deye-dashboard/` folder goes to `/config/www/`.

## Tests

The reasoning behind the suites — including why each escaped defect escaped —
is in [docs/test-plan.md](../docs/test-plan.md).

```bash
./tools/run-tests.sh
```

Runs the unit tests first (217 assertions, instantly, no browser), then serves
`deye-dashboard/` over a static server, launches headless Chrome and runs 181
checks in a real browser. No dependencies: Node 22+ (for the global `WebSocket`) and an installed
Google Chrome.

| File | What it covers |
|---|---|
| `test-ranges.mjs` | 69 assertions on the calendar arithmetic in `js/ranges.js`: period bounds, Monday weeks, month lengths, DST, resolution choice, navigation clamping. A fixed `now` is threaded through every call, so the suite still passes next year and in any timezone. |
| `test-config.mjs` | 30 assertions on stored-configuration handling: the 1.0.2 → 1.1.0 migrations (`animations: true → 'auto'`, `today/7d/30d → day/week/month`), value validation, and that a merge never loses a pinned entity. |
| `test-model.mjs` | 42 assertions on `js/power-flow.js` and the counter fallback: link directions, the load-coverage cascade, export attribution (including a generator exporting while the battery charges), and that an unmeasured sensor is never treated as zero. |
| `test-history.mjs` | 15 assertions on `js/history.js` against a stub Home Assistant, including the boundary defect that made a one-day period report two days of energy, the sum-diff baseline, and unit normalisation. |
| `test-charts.mjs` | 28 assertions on the chart axes: a period's buckets are calendar-exact across DST, month lengths and leap years, a year always lays out twelve months whatever the data holds, and the time axis labels a month with dates rather than repeating one clock time. |
| `test-deploy.py` | 33 assertions on the YAML `deploy.py` writes, including the case that must never regress: a re-deploy without `--entities` keeps the mapping already on the host. |
| `test-dashboard.mjs` | 181 checks in a real browser (below). |
| `cdp.mjs` | A 300-line Chrome DevTools Protocol driver: launches the browser on a private profile, emulates devices (a real viewport width and DPR, which `--window-size` cannot give), clicks, reads the shadow DOM, takes screenshots, and collects console errors, exceptions **and** window errors. Kills the process group on exit and on Ctrl-C. |

| Browser group | Examples |
|---|---|
| Boot | no exceptions or `console.error`, no 4xx, every card and node present, the first paint agrees with the entity state, an idle generator is nowhere on screen |
| Geometry | SVG link endpoints line up with the node edges, measured in screen coordinates, for `wide`, `wideGen` and `narrowGen` |
| Animation | active flows animate, flows out of the inverter run in reverse, speed follows power, idle flows stop |
| Chart periods | Day draws lines, Week/Month/Year draw bars, the legend shows period totals, forward navigation stops at today |
| Period consistency | for week, month and year: every KPI tile equals the chart legend for the same quantity, the legend totals the bars actually drawn, no bucket lies outside the period, bars are one per bucket per series, self-sufficiency follows from the two tiles it is derived from, and returning to a period reproduces its numbers |
| Selector placement | the date chip and the period list are inside the first screen at 1600, 1440 and 390 px, with no horizontal overflow |
| Chart interaction | tooltip and crosshair, series toggle off and on |
| Date navigation | historical mode hides every live card, KPI is recomputed from statistics, `Now` returns, a custom interval loads, the pickers refuse the future, an empty period names its reason |
| Settings | opens from the gear, four tabs, entity autocomplete, role-match validation, YAML/JSON export |
| Responsive | 390 / 430 / 768 / 1024 / 1440 / 1920 / 2560 — no horizontal scrolling, labels do not overlap, numbers are not clipped |
| Extreme data | 200 kW does not break the layout, low SOC turns the battery red, `unavailable` becomes dashes and OFFLINE, every flow goes idle |
| Connection | RECONNECTING → DISCONNECTED → ONLINE |
| Onboarding | shown with no entities mapped, "Detect automatically" finds the right ones |
| Polarity | the demo reports "+ = discharge", the dashboard flips the sign itself, the balance adds up |
| Language | English ⇄ Ukrainian, units and the settings dialog translate, the remount keeps state |
| Generator | the five-spoke layout, the card, the KPI, the coverage mix, the balance, and that an export is attributed to the generator rather than to a charging battery |
| Sensor dialog | a stat row, a KPI tile, a diagram node, a PV string and a phase all open their own sensor; Enter and Space work; a sensor without `state_class` explains itself; Escape closes |
| Animation setting | `auto` / `on` / `off` against an emulated `prefers-reduced-motion` |
| Accessibility | aria-labels on icon buttons, `role="tab"` / `aria-selected`, decorative SVG hidden, buttons focusable |

Environment variables: `DEYE_PORT`, `DEYE_SHOTS`, `DEYE_ORIGIN`.

## Deployment

```bash
python3 tools/deploy.py --host homeassistant.local --user <user> \
    --password-file .smb --entities mapping.json --rated-power 12 [--dry-run]
```

Copies the dashboard into `/config/www/deye-dashboard/` over SMB (the "Samba
share" add-on) and writes `/config/packages/deye_dashboard.yaml` with the
`panel_custom` block, leaving `configuration.yaml` untouched. Needs
`pip install smbprotocol`.

Every relative import in the copied `.js` is stamped with `?v=<version>`.
Home Assistant serves `/local/` with a 31-day cache and `panel_custom` only
version-stamps the entry point, so without this a fresh loader would keep
pulling month-old modules out of the browser cache. The deploy aborts rather
than ship a half-stamped module graph, because a module reached through two
different URLs is loaded twice — two copies of `i18n.js` would mean two current
languages.

Nothing is ever deleted, and the panel package cannot lose settings: a re-deploy
without `--entities` carries the `config:` block already on the host forward
unchanged, and any file it replaces is copied to `deye_dashboard.yaml.bak`
first. `--entities`, `--rated-power` and `--language` replace that block with
what you pass.

Keep the password and the mapping out of the repository: `.gitignore` covers
`secret/`, `*.token`, `.smb*`, `*password*` and `mapping*.json`.

A Home Assistant restart is required afterwards — `panel_custom` is read at
start-up only. Validate first with
`POST /api/config/core/check_config` and expect `"result": "valid"`.

## Chrome MCP

For interactive debugging an MCP server is registered for all projects:

```bash
claude mcp get chrome-devtools     # check
claude mcp remove chrome-devtools -s user
```

It runs with `--isolated --headless --usageStatistics=false
--performanceCrux=false`: a throwaway profile and no telemetry leaving the machine.

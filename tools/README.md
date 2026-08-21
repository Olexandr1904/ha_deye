# tools/ — dashboard tooling

These files are **not** part of what gets copied into Home Assistant: only the
`deye-dashboard/` folder goes to `/config/www/`.

## Tests

```bash
./tools/run-tests.sh
```

Serves `deye-dashboard/` over a static server, launches headless Chrome and runs
78 checks in a real browser. No dependencies: Node 22+ (for the global
`WebSocket`) and an installed Google Chrome.

* `cdp.mjs` — a ~200 line Chrome DevTools Protocol driver: launches the browser,
  emulates devices (a real viewport width and DPR, which `--window-size` cannot
  give), clicks, reads the shadow DOM, takes screenshots and collects both console
  errors **and** window errors.
* `test-dashboard.mjs` — the checks themselves.

| Group | Examples |
|---|---|
| Boot | no exceptions or `console.error`, no 4xx, all cards and nodes present |
| Geometry | SVG link endpoints line up with the node edges (measured in screen coordinates) |
| Animation | active flows animate, flows out of the inverter run in reverse, speed follows power, `prefers-reduced-motion` disables everything |
| Charts | Today draws lines, 7/30 days draw bars, the legend shows totals, tooltip and crosshair work, series toggle off and on |
| Settings | opens from the gear, four tabs, entity autocomplete, role-match validation, YAML/JSON export |
| Responsive | 390 / 430 / 768 / 1024 / 1440 / 1920 / 2560 — no horizontal scrolling, labels do not overlap, numbers are not clipped |
| Extreme data | 200 kW does not break the layout, low SOC turns the battery red, `unavailable` becomes dashes and OFFLINE, every flow goes idle |
| Connection | RECONNECTING → DISCONNECTED → ONLINE |
| Onboarding | shown with no entities mapped, "Detect automatically" finds the right ones |
| Polarity | the demo reports "+ = discharge", the dashboard flips the sign itself, the balance adds up |
| Accessibility | aria-labels on icon buttons, `role="tab"` / `aria-selected`, decorative SVG hidden, buttons focusable |

Environment variables: `DEYE_PORT`, `DEYE_SHOTS`, `DEYE_VERBOSE=1`.

## Deployment

```bash
python3 tools/deploy.py --host homeassistant.local --user <user> \
    --password-file <file> --entities mapping.json --rated-power 12 [--dry-run]
```

Copies the dashboard into `/config/www/deye-dashboard/` over SMB (the "Samba
share" add-on) and writes `/config/packages/deye_dashboard.yaml` with the
`panel_custom` block, leaving `configuration.yaml` untouched. Needs
`pip install smbprotocol`; nothing is ever deleted, files are only overwritten.

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

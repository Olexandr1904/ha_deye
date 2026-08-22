# Installing Deye Dashboard in Home Assistant

> **Already installed on this system** (22 Aug 2026, HA 2025.11.3, dashboard 1.1.0):
> files in `/config/www/deye-dashboard/`, the panel is wired up by
> `/config/packages/deye_dashboard.yaml` (`configuration.yaml` was not touched),
> 40 entities are pinned there, and the 12 kW rating comes from the attributes of
> `sensor.inverter_device`. The **Deye** item is in the sidebar.
> To update after a code change: `python3 tools/deploy.py …` plus a Home Assistant restart.

Requirements: Home Assistant 2023.4 or newer (the WebSocket commands
`history/history_during_period` and `recorder/statistics_during_period` are needed).
No internet access is required, neither during installation nor at runtime.

---

## Step 1. Copy the files

Put the `deye-dashboard` folder into the `www` directory of your Home Assistant
configuration:

```text
/config/www/deye-dashboard/
    deye-dashboard.js
    index.html
    js/…
    css/…
    assets/…
```

If `/config/www` does not exist, create it (after creating it Home Assistant needs
one restart before `/local/` starts serving files).

Ways to copy: File editor / Samba / the VS Code add-on / `scp`:

```bash
scp -r deye-dashboard root@homeassistant.local:/config/www/
```

Check: open `http://homeassistant.local:8123/local/deye-dashboard/deye-dashboard.js`
— it must return the script text, not a 404.

---

## Step 2. Wire up the panel

### Option A — a separate package file (tidier, leaves the main config alone)

Works when `configuration.yaml` contains
`homeassistant: packages: !include_dir_named packages` (it is part of the default
Home Assistant configuration). Create `/config/packages/deye_dashboard.yaml`:

```yaml
panel_custom:
  - name: deye-dashboard
    sidebar_title: Deye
    sidebar_icon: mdi:solar-power-variant
    url_path: deye-dashboard
    module_url: /local/deye-dashboard/deye-dashboard.js?v=1.1.0
    embed_iframe: false
    require_admin: false
    config:
      ratedPowerKw: 12
      entities:
        pvPower: sensor.inverter_pv_power
        # … the remaining roles
```

To remove the panel later, delete this single file and restart Home Assistant.

### Option B — directly in `configuration.yaml`

```yaml
panel_custom:
  - name: deye-dashboard          # must match the custom element name
    sidebar_title: Deye
    sidebar_icon: mdi:solar-power-variant
    url_path: deye-dashboard
    module_url: /local/deye-dashboard/deye-dashboard.js?v=1.1.0
    embed_iframe: false           # important: no iframe, the panel lives inside HA
    require_admin: false
```

`?v=1.1.0` only busts the browser cache. Bump it after updating the files (or do a
hard reload: Ctrl/Cmd + Shift + R).

### Automated copying

From a developer machine a single script does all of the above (needs the
"Samba share" add-on):

```bash
python3 tools/deploy.py --host homeassistant.local --user <samba-user> \
    --password-file <file-with-password> --entities mapping.json --rated-power 12
```

It copies the files into `www/deye-dashboard/` and writes
`packages/deye_dashboard.yaml`. Add `--dry-run` to see what it would do without
changing anything.

## Step 3. Restart Home Assistant

Settings → System → Restart (a full restart, not "reload YAML": `panel_custom` is
only read at start-up).

## Step 4. Open the panel

A **Deye** item appears in the sidebar → `http://homeassistant.local:8123/deye-dashboard`.

On first open the dashboard looks for the inverter entities itself. Then:

* everything was found → press **Save** in the yellow banner at the top;
* something is missing → gear icon in the top right → **Entities** tab, one
  autocomplete field per role, and the 🔍 button picks the best candidate;
* nothing was found → a dialog appears with
  "Detect automatically" / "Choose manually" / "Demo mode".

Settings are stored in the browser's `localStorage`. To share them across devices,
use the **Export** tab, copy the YAML and paste it into `configuration.yaml` (the
`config:` block inside `panel_custom`).

## Periods and the date picker

The chart header selects the period: `Day / Week / Month / Year / Custom` with
`‹ ›` arrows and a date picker. Choosing a period that lies entirely in the past
switches the whole panel into a historical view — the flow diagram and the detail
cards disappear (a past moment has no instantaneous values), a `VIEWING …` banner
appears with a `Now` button, and the KPI tiles show that period's totals.

Clicking any value that is backed by an entity — a stat row, a PV string, a
phase, a KPI tile or a diagram node — opens that sensor's own chart with the same
date navigation.

## Interface language

English and Ukrainian are available. The two-letter button in the header switches
between them; the gear icon → Options → Language also has an `Auto` mode that
follows the Home Assistant user locale. The choice can be pinned in YAML with
`config: language: en` (or `uk`, or `auto`).

---

## Checking the signs (important for Deye)

Different integrations report battery and grid power with different polarity. The
dashboard works the sign out on its own: from daily energy counters, from SOC
changes and from the power balance. That takes anywhere from one sensor update to
a couple of minutes.

If a direction looks wrong: gear icon → **Options** → "Battery: a positive value
means" and "Grid: a positive value means" can be set manually. The same page has
"Reset learned polarity".

The symptom to watch for is the banner "Power balance is off by …".

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No "Deye" item in the sidebar | `panel_custom` was not applied — a full Home Assistant restart is required; check the YAML indentation |
| Blank panel | Open the browser console (F12). Most often a 404 on `/local/…`: the files are not in `/config/www/deye-dashboard/` |
| "Deye Dashboard failed to start" | One of the `js/…` modules did not load — make sure the whole folder was copied |
| Changes to the files are not visible | Cache: bump `?v=` in `module_url` and do Ctrl/Cmd + Shift + R |
| Dashes `—` everywhere | Entities are not mapped (gear icon → Entities) or the sensor is `unavailable` |
| Week / Month / Year charts are empty | The energy sensors have no long-term statistics (`state_class: total_increasing` is needed) or Recorder excludes them |
| The Day chart is empty for an old date | Recorder purges detailed states after `purge_keep_days`, while statistics are kept — use Week or Month for older periods |
| The Day chart is empty for today | Recorder excludes those entities (`recorder: exclude:`) |
| Flow particles do not move | The system "reduce motion" setting is on; gear icon → Options → Flow animation → `always animate` |
| Flow directions look wrong | See "Checking the signs" above |
| BATTERY CHARGED / USED read `0.00` while the battery clearly cycles | The inverter's own battery energy registers are stuck — some Deye firmwares leave "today battery charge/discharge" at zero. Map `batteryChargeTotal` / `batteryDischargeTotal` to the lifetime counters as well: the dashboard uses whichever of the two actually moves. If both are stuck (on this 12 kW unit the lifetime pair advances 0.1 kWh a day against a battery that swings 1.8 kW), no counter on the inverter knows the number, so the tiles report what the sensors say instead of guessing. A Riemann-sum integration helper over the battery power sensor gives an estimate, if an estimate is what you want. |
| Data does not update | Check the status in the header: `RECONNECTING` means the Home Assistant WebSocket is the problem, not the dashboard |

Diagnostics: gear icon → **Diagnostics** shows a table of role → entity → raw
value → value in the model → status, plus a "Copy support report" button.

---

## Standalone mode (for debugging)

`index.html` can be opened directly:
`http://homeassistant.local:8123/local/deye-dashboard/index.html`

It asks for the Home Assistant address and a long-lived access token
(Profile → Security → Long-lived access tokens). The token is stored in that
browser only. The normal way to run the dashboard is the panel from step 2.

Debug URL parameters:

```text
?demo=1              test data, no Home Assistant needed
?hour=13.5           pin the time of day in demo mode
?deye_debug=1        verbose logs in the console
?deye_range=week     open a specific chart period (day|week|month|year)
?deye_settings=1     open the settings dialog (entities|options|diag|export)
?deye_noauto=1       skip entity auto-detection
```

---

## Updating and removing

Updating: replace the files, bump `?v=` in `module_url`, reload the page.
Settings and learned polarity survive (they live in `localStorage`).

Removing: delete the `panel_custom` block (or `packages/deye_dashboard.yaml`),
restart Home Assistant, delete `/config/www/deye-dashboard/`.

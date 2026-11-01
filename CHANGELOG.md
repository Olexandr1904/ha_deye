# Changelog

All notable changes to this project. Versions are the `VERSION` constant in
`deye-dashboard/js/config.js`, which is also the cache-busting query the panel is
loaded with.

## 1.3.1

* A healthy inverter no longer shows FAULT. An alarm sensor at rest — a
  `binary_sensor` of class `problem` reading `off`, a register reading `0.0`,
  a padded `" No fault "` — was taken for an alarm; hex fault codes still are
  one.
* The generator stays on the day's power chart after it stops, on past days,
  and after an inverter whose clock runs ahead has zeroed its counters before
  midnight: the chart draws it when it ran in that period, not when it runs
  now. Week, month and year show it whenever the period had generator energy,
  and the chart and the tile follow the same rule. This replaces the 1.3.0
  rule that the tile and the charts followed the day's counter.
* Coming back to today never shows another day's figures in today's tiles.
* "With the solar forecast" no longer says "lasts" about a night the forecast
  does not reach. With only today's forecast, at 10:00 in the sun, the card used
  to read "lasts — lowest ≈ 30 % today at 10:00" although the battery was still
  draining when the forecast stopped at midnight; it now says "forecast ends
  tomorrow at 00:00 with ≈ 43 % left". A night the forecast does see through to
  the sun is still the answer.
* "On battery" no longer shows the consumption from before a tab was hidden.
  A background tab is given no frames, so nothing was averaged while it was
  hidden, and the reading from before stood for the whole hour: 0.3 kW at
  18:00 read as 30 hours at 19:00 with the house drawing 3 kW.
* At the cut-off with the inverter's output switched off (an off-grid inverter
  at its shutdown SOC reads 0 W for the house) the card says "at the cut-off"
  instead of nothing.
* A time on battery that rounds up to the hour reads "3 h 00 min", not
  "2 h 60 min".
* The year arrows in the month grid step the year. They closed the grid and
  silently moved the period a year, so ‹ then jumped to the year before.
* On a phone with the generator running, every flow arrow points along its
  link; the battery, the grid and the house had the desktop arrows.
* No empty generator label sits in the corner of a diagram without a generator.
* The sensor dialog labels its axis kW / kWh, the unit its numbers are in. It
  said W under a kilowatt and MWh from a thousand kWh over kilowatt ticks.
* A custom period longer than 92 days keeps its first month, and a past one
  ending mid-month no longer counts the rest of that month: Home Assistant
  widens month buckets to whole months, so such periods are now added up from
  days. The sensor dialog's band chart had the same gap.
* A daily energy counter recorded as a measurement (statistics with a maximum
  but no sum) no longer reports a day as the sum of its running totals — a
  12 kWh day read as 150 kWh, and won over the lifetime counter.
* A request that fails says "The period could not be loaded" instead of
  explaining an empty period — that the sensors had no long-term statistics, or
  that the day's history had been purged.
* Today on a past custom period comes back to the present, keeping its length.
* Changing the language in the settings keeps what was typed but not saved.
* The language button saves the language only. It saved the whole
  configuration with it — including an auto-detected mapping that had not been
  confirmed — and from then on that copy overrode `configuration.yaml` in that
  browser.
* The dashboard title from the settings shows on Save, not after a reload.
* An empty section in the panel's YAML (`entities:` with every line commented
  out) no longer stops the panel at start-up.
* The day chart's hour ticks start at local midnight: 00:00, 03:00 … rather
  than 02:00, 05:00 … in Kyiv (or 02:30 … in India).
* Standalone (`index.html`): a Home Assistant that is down, or a mistyped
  host, shows the connection form with an error instead of waiting forever.
* `tools/build-dist.mjs` works from a path with spaces in it.
* Change `?v=1.3.0` to `?v=1.3.1` in your `panel_custom` entry.

## 1.3.0

* The battery card says how long the battery lasts: "On battery ≈ 19 h 56 min
  (to 10 %)" — the energy above the inverter's cut-off at the house's
  consumption, averaged over ten minutes. It used to divide by what the battery
  delivered that minute, which is near zero whenever the sun covers the house,
  and was hidden below 0.1 kW — that is, most of the day.
* With a Solcast forecast in Home Assistant, a second line runs the battery
  through it, half an hour at a time: "down to 10 % tomorrow at 04:43", or
  "lasts — lowest ≈ 28 % tomorrow at 07:00". A forecast that runs out at night
  says only how much is left where it ends. At the cut-off the card says "at the
  cut-off" instead.
* Three new roles, detected automatically — also for a mapping saved earlier:
  the battery cut-off (`number.*_battery_shutdown_soc`, the one setpoint the
  panel reads), and today's and tomorrow's solar forecast. The forecast sensors
  can no longer be mistaken for the inverter's own solar readings.
* The generator is on the diagram only while it runs, and leaves it two minutes
  after it stops. Its KPI tile and its series in the charts keep the day's
  energy.
* The settings' autocomplete offers the cut-off setpoint to the cut-off role,
  and setpoints to no other role.
* Change `?v=1.2.5` to `?v=1.3.0` in your `panel_custom` entry.

## 1.2.5

* The beads on the diagram move again, in the direction the energy flows. The
  animation ended on a unitless offset, which the browser does not interpolate
  from the 0px it starts at: the offset jumped by exactly one pattern period
  every half cycle, so every bead stood still while the animation was
  nominally running. Solar and the generator now run into the inverter; the
  battery, the grid and the house out of it, or in when they feed it.
* The beads are round. Each was a short dash with round caps — a capsule, which
  read as an oval; it is now a dot as wide as the line.
* Flow animation is on by default. `auto`, which stops it whenever the system
  asks for reduced motion, is still a choice under Options. A browser that saved
  its settings earlier keeps the `auto` it stored; choose `always animate` there
  once.
* Change `?v=1.2.4` to `?v=1.2.5` in your `panel_custom` entry.

## 1.2.4

* The power chart no longer draws ramps that never happened. Home Assistant
  records a sensor's changes, not samples, and the chart joined those changes
  with a smooth curve: a generator that read 0 W from midnight and started at
  10:11 rose slowly for ten hours, and a 49-minute silence from the logger
  became a half-hour slope on the battery. A value now holds until it changes,
  then steps. A sensor that never changed all day — the grid at 0 W — had a
  single point and no line at all; it is now drawn across the period.
* Change `?v=1.2.3` to `?v=1.2.4` in your `panel_custom` entry.

## 1.2.3

* A generator connected after you saved your entities now appears. Start-up
  detection only ran when nothing at all was mapped, so a mapping saved before
  1.1.0 never learned the generator roles: its kilowatts were missing from the
  diagram and a power-balance warning appeared instead. Roles your saved mapping
  has never heard of are now detected at start-up and offered for saving; a role
  you cleared yourself stays cleared.
* The grid is no longer credited with power it did not supply. Whatever the
  measured sources could not explain was handed to the grid, so an unmapped
  generator showed up as "Grid → Battery 5.20 kW" next to a grid reading 0 W.
  The grid now covers at most what it imported; the rest stays unattributed and
  the balance notice says so.
* The settings dialog fits a phone. Its header and footer were single rows that
  a 390 px screen could not hold, and the dialog clipped what did not fit — the
  close button, the last tabs and, in Ukrainian, Save simply vanished. They now
  wrap.
* Change `?v=1.2.2` to `?v=1.2.3` in your `panel_custom` entry.

## 1.2.2

* The top bar stays at the top of the screen again inside Home Assistant. It is
  sticky, but it stuck within the panel, and inside Home Assistant the panel
  does not scroll — the page does — so the bar, with the period selector on it,
  scrolled away with everything else. The panel no longer scrolls itself
  anywhere: the standalone page scrolls its document too, the way Home
  Assistant does. Change `?v=1.2.1` to `?v=1.2.2` in your `panel_custom` entry.

## 1.2.1

* One finger scrolls the page again on a phone. Inside Home Assistant the panel
  is not given a height, so the page scrolls rather than the panel — but the
  panel still refused to hand a swipe on to the page, and only a two-finger drag
  got through. The same affected a mouse wheel or a trackpad when the page was
  taller than the window. If your `panel_custom` entry carries `?v=1.2.0`, change
  it to `?v=1.2.1`, or the browser keeps the old code.

## 1.1.5

* One period, one number. The KPI tiles and the chart legend used to read
  different counters, and could disagree by 40 % for the same period. A period is
  now fetched once, the counter is chosen once per quantity, and the bars, the
  legend and the tiles all come from those rows.
* The bar chart's x axis comes from the selected period, not from whichever
  buckets happen to hold data — a year with two months of data no longer spreads
  those two months across twelve slots.
* `tools/deploy.py` stamps `?v=` on every relative import it copies, and refuses
  to ship a half-stamped module graph. Home Assistant serves `/local/` with a
  31-day cache and `panel_custom` stamps only the entry point, so an update could
  otherwise reach the browser as a fresh loader pulling month-old modules.
* A period that still contains the present says so ("TOTALS FOR August 2026 / so
  far this period") instead of looking arbitrarily different from a closed one.
* A period that fails to load says so in the card and logs it, rather than
  leaving a blank chart and a clean console.

## 1.1.3

* The picker matches the period: a calendar for a day or a week, a grid of twelve
  months for a month, a list of years for a year. `type="month"` is not portable
  and there is no year input at all, so the grids are the panel's own.

## 1.1.2

* Fixed a period reporting two days of energy as one.
  `recorder/statistics_during_period` can answer a one-day request with the next
  day's bucket as well, and the total summed both. Buckets outside the requested
  window are now dropped, and day and week totals are summed from hourly buckets
  so day alignment cannot matter.

## 1.1.1

* The period selector moved into the top bar. It governs the whole page, so
  having it in one card's header — at the bottom of a long page — meant most
  people never found it.
* The midnight rollover fix now works in a background tab: the re-anchor check no
  longer waits for an animation frame.

## 1.1.0

* Selectable periods: day / week / month / year / custom, with a date picker.
* Historical mode, derived rather than stored: a period strictly in the past
  hides every live card and shows that period's totals.
* Flow animation that follows the measured direction and power, with a three-state
  setting (auto / on / off).
* The generator as a first-class source: a fifth spoke, a term in the balance, a
  share of the load coverage, a KPI tile and a card.
* Sensor drill-down: any value backed by an entity opens its own history.
* Missing data names which of three reasons applies.

## 1.0.2

* First working panel: animated energy-flow diagram, battery / grid / load /
  phases / inverter cards, KPI row, charts, sensor polarity auto-detection,
  entity auto-detection with a mapping UI, English and Ukrainian.

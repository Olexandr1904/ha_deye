# Changelog

All notable changes to this project. Versions are the `VERSION` constant in
`deye-dashboard/js/config.js`, which is also the cache-busting query the panel is
loaded with.

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

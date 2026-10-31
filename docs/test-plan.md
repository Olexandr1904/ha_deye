# Deye Dashboard — test plan

Written after a bug reached the owner: a period total that silently added the
next period's energy, so a day showed roughly twice its export. It passed every
suite. This plan starts from why, and from what else could hide in the same
blind spot.

## What went wrong, and what it says about the suites

| Defect | Why every suite missed it |
|---|---|
| A one-day period summed two days | The demo answered the requested range *exactly*, so the code path that mishandles a generous backend never ran. The in-HA checks counted bars and asserted "not a dash" — never a number. |
| Stale modules served for up to a month | Only the entry point carried `?v=`. Every test run uses a fresh browser profile, so no test could ever have a warm cache. |
| The picker asked for a day when the period was a year | Nothing asserted what the chip *opens*, only that a date could be typed into the input. |
| KPI tiles and the chart legend disagreed for the same period | The two read different entities and no check ever compared them. |
| A year with two months of data spread those months across the whole axis | Bar count was asserted as `> 0`. |
| One finger could not scroll the page on a phone inside Home Assistant | The browser suite ran only the standalone page, where the panel is its own scroller. Home Assistant gives a panel no height, so there the document scrolls — a container the suite never had, and nothing ever swiped. |
| The settings dialog lost its close button and Save on a phone | The responsive checks measured horizontal overflow of the page; the dialog clips its own overflow, so nothing ever overflowed where they looked, and the dialog was only ever opened at 1600 px. |
| A generator connected later never appeared for a mapping saved before 1.1.0 | Every run starts from empty storage and detects everything, so no test ever had a mapping older than the roles it was being checked against. |
| An unmapped source's power was credited to a grid reading 0 W | The cascade was only fed balanced states. The grid as the residual looks right until something is missing. |
| The power chart drew a ten-hour ramp for a generator that was off until 10:11 | The demo reports every sensor every few seconds, so no series ever had a gap; and nothing compared the drawn line with the state Home Assistant held in between. |
| The flow beads stood still on every link | The animation checks read the animation's name and duration, which were right; nothing ever read the offset itself, which only jumped by one period — a picture identical to standing still. |
| The sticky top bar scrolled away inside Home Assistant | Same blind spot, found one release later: the bar sticks within its nearest scroll container, which was the panel, and nothing ever scrolled and then looked at the bar. The standalone page now scrolls its document as Home Assistant does, so the two no longer differ. |
| A healthy inverter showed FAULT | Alarm values were only ever text ("OK", fault codes). A `binary_sensor` of class `problem` at rest reads `off`, which was not on the list of quiet values. |

Four lessons, and they shape everything below:

1. **A fake backend must be at least as awkward as the real one.** If the real
   Home Assistant answers a one-day request with two buckets, the stub has to do
   it too, or the clamp is untested.
2. **Assert numbers, not shapes.** "12 bars" and "not a dash" survive a factor
   of two. A total compared against an independent source does not.
3. **Two paths to the same number must be compared to each other.** The tile and
   the legend, the statistics and the counter, the chart and the KPI.
4. **What the test environment cannot have, the test cannot catch.** A fresh
   profile cannot catch a caching bug; that guarantee has to move into the
   deployer, where it can be asserted (every import stamped, or refuse to ship).

## Layers

| Layer | Runs | Cost | What only it can prove |
|---|---|---|---|
| Unit (`test-ranges`, `test-config`, `test-model`, `test-history`, `test-charts`) | node, no browser, < 1 s | free | Calendar arithmetic across DST and month lengths, energy attribution, window clamping against a hostile stub, stored-config migration, axis construction |
| Deployment (`test-deploy.py`) | python, no network | free | The panel package can never lose pinned settings; every module import is version-stamped or the deploy aborts |
| Browser (`test-dashboard.mjs`) | real headless Chrome over CDP | ~4 min | Layout at seven widths, SVG geometry in screen coordinates, animation, the shadow DOM, keyboard access, the console |
| In Home Assistant (`test-in-ha.mjs`) | real HA, real inverter | ~2 min | That it is a panel: registration, no iframe, HA's own connection, Recorder, and every KPI tile against the inverter's own counter |

Nothing is mocked at the browser layer except the inverter itself, and the demo
inverter is a simulation with a fixed epoch (`INSTALLED = 1 Jan 2026`) so dates
in assertions stay valid forever.

## Invariants under test

**Time and periods.** Weeks start Monday; months and years are calendar-exact; a
period is half-open `[from, to)`; `to` never exceeds now; forward navigation
stops at the current period; backward navigation is unbounded; a DST day does not
change the chart resolution; the view re-anchors itself when the calendar moves
on, and a period the user picked deliberately never moves.

**Energy accounting.** A period total equals the sum of the buckets *inside* that
period and nothing else. The KPI tile, the chart legend and the inverter's own
daily counter agree to within a couple of percent. A daily counter that never
leaves zero falls back to the lifetime counter, and both a chart and a tile use
the same choice. Units are normalised, never assumed.

**Physics.** The power balance closes. Distribution attributes every kilowatt to
a source that could have produced it — a charging battery is never credited with
an export. An unmeasured sensor stays unmeasured instead of counting as zero.

**Honesty.** Missing data says which of three reasons applies. A derived number
is labelled derived. A past period never shows a live value. Nothing invented.

**The shell.** No iframe, no own WebSocket in panel mode, no horizontal scrolling
between 390 and 2560 px, one finger scrolls the page and the top bar stays on
screen both standalone and inside a parent that gives the panel no height (as
Home Assistant does), the diagram's links meet the node edges in all three
layouts, and the console stays clean.

## Deliberately not covered

- Home Assistant versions other than the one installed. The WebSocket contract
  is exercised against a stub and against one live instance.
- Browsers other than Chromium. The month and year grids exist precisely because
  `type="month"` is not portable, but no Safari or Firefox run is automated.
- Recorder purge behaviour beyond what the demo models (120 days).
- Long-run memory behaviour. Listener and observer teardown is reviewed, not
  measured over days.

## Adding a test

Put it in the cheapest layer that can prove the thing. If a browser check would
pass with the feature deleted, it belongs in a unit test with real numbers
instead. When a defect is found in the field, the first commit is the test that
reproduces it — with the numbers from the report, so the fix is verifiable
against what the owner actually saw.

# assets/

`icon.svg` — the favicon for the standalone `index.html`.

The interface icons (sun, battery, house, grid, inverter) are **built into the
code** (`js/icons.js`) as inline SVG: that is twenty fewer HTTP requests, it works
without a network, and it lets the icons inherit their colour from the theme
through `currentColor`.

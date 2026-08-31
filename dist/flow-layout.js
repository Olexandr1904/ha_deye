/**
 * flow-layout.js — geometry of the energy-flow diagram.
 *
 * Four layouts: wide and narrow, each with and without a generator. The links
 * are SVG (a viewBox with a fixed aspect ratio); the nodes are plain HTML on
 * top, positioned in % of the same coordinate space, so the text stays crisp,
 * accessible and cheap to update.
 *
 * Every path is drawn in the direction "node -> inverter". For a flow out of
 * the inverter the animation simply runs in reverse.
 *
 * Node radius is 14.8 % of the width in the wide layouts and 24.5 % in the
 * narrow ones; the inverter is 19 % and 28.2 % respectively. Gaps are uniform:
 * 6 units at the node, 10 at the inverter.
 */

export const FLOW_LAYOUTS = {
  wide: {
    viewBox: [1000, 700],
    maxHeight: '62vh',
    nodeSize: 14.8,       // % of the container width
    hubSize: 19,
    nodes: {
      solar: { x: 50, y: 13.14 },
      grid: { x: 14, y: 50 },
      house: { x: 86, y: 50 },
      battery: { x: 50, y: 86.86 },
      inverter: { x: 50, y: 50 },
    },
    paths: {
      solar: 'M500,172 L500,245',
      battery: 'M500,528 L500,455',
      grid: 'M220,350 L395,350',
      load: 'M780,350 L605,350',
    },
    labels: {
      solar: { x: 50, y: 29.7, align: 'left' },
      battery: { x: 50, y: 71.2, align: 'left' },
      grid: { x: 30.5, y: 50, align: 'top' },
      load: { x: 69.5, y: 50, align: 'top' },
    },
  },

  /* Grid moves up and the generator takes the lower-left slot; both feed the
     inverter's left face along diagonals. */
  wideGen: {
    viewBox: [1000, 700],
    maxHeight: '62vh',
    nodeSize: 14.8,
    hubSize: 19,
    nodes: {
      solar: { x: 50, y: 13.14 },
      grid: { x: 15, y: 34.29 },
      generator: { x: 15, y: 65.71 },
      house: { x: 86, y: 50 },
      battery: { x: 50, y: 86.86 },
      inverter: { x: 50, y: 50 },
    },
    paths: {
      solar: 'M500,172 L500,245',
      battery: 'M500,528 L500,455',
      grid: 'M226,264 L395,317',
      generator: 'M226,436 L395,383',
      load: 'M780,350 L605,350',
    },
    labels: {
      solar: { x: 50, y: 29.7, align: 'left' },
      battery: { x: 50, y: 71.2, align: 'left' },
      grid: { x: 31, y: 41.4, align: 'top' },
      generator: { x: 31, y: 58.6, align: 'top' },
      load: { x: 69.5, y: 50, align: 'top' },
    },
  },

  narrow: {
    viewBox: [440, 600],
    maxHeight: '200vh',
    nodeSize: 24.5,
    hubSize: 28.2,
    nodes: {
      solar: { x: 50, y: 12 },
      inverter: { x: 50, y: 43.7 },
      battery: { x: 20, y: 83.3 },
      house: { x: 50, y: 83.3 },
      grid: { x: 80, y: 83.3 },
    },
    paths: {
      solar: 'M220,132 L220,190',
      battery: 'M88,440 C88,388 158,344 212,330',
      load: 'M220,440 L220,334',
      grid: 'M352,440 C352,388 282,344 228,330',
    },
    labels: {
      solar: { x: 50, y: 27, align: 'left' },
      battery: { x: 17, y: 61, align: 'center' },
      load: { x: 50, y: 63, align: 'center' },
      grid: { x: 83, y: 61, align: 'center' },
    },
  },

  /* Solar and generator share the top row; the bottom row is untouched. */
  narrowGen: {
    viewBox: [440, 640],
    maxHeight: '200vh',
    nodeSize: 24.5,
    hubSize: 28.2,
    nodes: {
      solar: { x: 29.09, y: 12.81 },
      generator: { x: 70.91, y: 12.81 },
      inverter: { x: 50, y: 46.88 },
      battery: { x: 20, y: 81.25 },
      house: { x: 50, y: 81.25 },
      grid: { x: 80, y: 81.25 },
    },
    paths: {
      solar: 'M151,137 L190,229',
      generator: 'M289,137 L250,229',
      battery: 'M88,460 C88,408 158,376 212,368',
      load: 'M220,460 L220,372',
      grid: 'M352,460 C352,408 282,376 228,368',
    },
    labels: {
      solar: { x: 26, y: 28.5, align: 'center' },
      generator: { x: 74, y: 28.5, align: 'center' },
      battery: { x: 17, y: 62, align: 'center' },
      load: { x: 50, y: 64, align: 'center' },
      grid: { x: 83, y: 62, align: 'center' },
    },
  },
};

/** Every link key the renderer can draw, in a stable order. */
export const LINK_KEYS = ['solar', 'generator', 'battery', 'grid', 'load'];

/** Which node sits at the far end of each link. */
export const LINK_NODE = {
  solar: 'solar', generator: 'generator', battery: 'battery', grid: 'grid', load: 'house',
};

/**
 * Picks a layout by available width and whether the generator is in play.
 * @param {number} width container width in px
 * @param {boolean} withGenerator
 */
export function pickLayout(width, withGenerator) {
  const narrow = width && width < 620;
  if (narrow) return withGenerator ? 'narrowGen' : 'narrow';
  return withGenerator ? 'wideGen' : 'wide';
}

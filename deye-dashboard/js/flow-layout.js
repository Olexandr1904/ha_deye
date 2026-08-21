/**
 * flow-layout.js — geometry of the energy-flow diagram.
 *
 * Two layouts. The links are SVG (a viewBox with a fixed aspect ratio); the
 * nodes are plain HTML on top, positioned in % of the same coordinate space,
 * so the text stays crisp, accessible and cheap to update.
 *
 * Every path is drawn in the direction "node -> inverter".
 * For a flow out of the inverter the animation simply runs in reverse.
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
    // Node radius 74 (14.8% of 1000). Inverter half-size 95 (19% of 1000).
    // Gaps are the same everywhere: 6 units at the node, 10 at the inverter.
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
    // Node radius 54 (24.5% of 440). Inverter half-size 62 (28.2% of 440).
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
};

/** Which node sits at the far end of each link. */
export const LINK_NODE = { solar: 'solar', battery: 'battery', grid: 'grid', load: 'house' };

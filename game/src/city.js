// Cinder Bay: a fictional harbour city on a road grid. The avenues run
// north-south, the streets east-west, and a pier road drops south from the
// western avenue to the docks on the water. Everything in the game — traffic,
// pedestrians, police, missions — moves on this grid, so one small set of
// helpers (onRoad, nearestRoadPoint, nearestCrossing, routeBetween) is shared
// by every driver in the world. Buildings and dressing are rolled from the
// seed; the road layout itself is fixed by design.
import { intRange, pick, range } from './rng.js';

export const WORLD = { width: 2400, height: 1800 };
export const AVENUES = [260, 740, 1220, 1700, 2140];
export const STREETS = [260, 660, 1060, 1460];
export const ROAD_W = 96;
export const WATER_Y = 1700;
export const PIER_X = 260;

export const SPOTS = {
  docks: { x: 260, y: 1760, label: 'Cinder Docks' },
  bank: { x: 1220, y: 660, label: 'Meridian Bank' },
  hall: { x: 1700, y: 260, label: 'City Hall' },
  hideout: { x: 740, y: 1060, label: 'Hideout' },
  pierGate: { x: 260, y: 1460, label: 'Pier Gate' },
  market: { x: 2140, y: 1460, label: 'Night Market' },
  garage: { x: 1220, y: 1460, label: 'Rook Garage' },
  plaza: { x: 1700, y: 1060, label: 'Foundry Plaza' },
};

const WALLS = ['#3b4a63', '#4c3f5e', '#54402f', '#2e4a44', '#4d4a33', '#5a3a48', '#37455c', '#46543f'];
const ROOFS = ['#222b3a', '#2b2530', '#2a2f28', '#33241f', '#26303a'];
const TREES = ['#2e5d3a', '#3a6b35', '#27513a'];

export function onRoad(x, y) {
  const half = ROAD_W / 2;
  for (const ax of AVENUES) if (Math.abs(x - ax) <= half) return true;
  for (const sy of STREETS) if (Math.abs(y - sy) <= half) return true;
  // The pier road runs south from the last street to the docks.
  if (Math.abs(x - PIER_X) <= half && y >= STREETS[STREETS.length - 1] && y <= WATER_Y + 120) return true;
  return false;
}

export function inWater(x, y) {
  return y >= WATER_Y && !(Math.abs(x - PIER_X) <= ROAD_W / 2 && y <= WATER_Y + 120);
}

export function nearestRoadPoint(x, y) {
  let bx = AVENUES[0];
  for (const ax of AVENUES) if (Math.abs(ax - x) < Math.abs(bx - x)) bx = ax;
  let by = STREETS[0];
  for (const sy of STREETS) if (Math.abs(sy - y) < Math.abs(by - y)) by = sy;
  // Near the docks the pier road is the closest tarmac.
  if (y > STREETS[STREETS.length - 1] && Math.abs(x - PIER_X) < Math.abs(bx - x) + 60) {
    return { x: PIER_X, y: Math.max(STREETS[STREETS.length - 1], Math.min(y, WATER_Y + 90)) };
  }
  if (Math.abs(bx - x) <= Math.abs(by - y)) return { x: bx, y };
  return { x, y: by };
}

export function nearestCrossing(x, y) {
  let best = null; let bestD = Infinity;
  for (const ax of AVENUES) for (const sy of STREETS) {
    const d = (ax - x) * (ax - x) + (sy - y) * (sy - y);
    if (d < bestD) { bestD = d; best = { x: ax, y: sy }; }
  }
  return best;
}

export function randomCrossing(rng, avoid) {
  const ax = pick(rng, AVENUES);
  const sy = pick(rng, STREETS);
  if (avoid && ax === avoid.x && sy === avoid.y) return randomCrossing(rng, avoid);
  return { x: ax, y: sy };
}

// A grid route: go along the current street/avenue to the target's line, then
// along the target's line. Returns waypoints the driver follows in order.
export function routeBetween(from, to) {
  const pts = [];
  const start = nearestRoadPoint(from.x, from.y);
  const goal = nearestRoadPoint(to.x, to.y);
  const mid = { x: goal.x, y: start.y };
  if (Math.abs(mid.x - start.x) > 4) pts.push(mid);
  if (Math.abs(goal.y - mid.y) > 4) pts.push({ x: goal.x, y: goal.y });
  else if (pts.length === 0) pts.push({ x: goal.x, y: goal.y });
  return pts;
}

function blocksOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Build the static city for a seed: buildings inside each block, plus trees,
// lamps, parked cars and a couple of parks. Buildings never touch a road.
export function buildCity(rng) {
  const buildings = [];
  const trees = [];
  const lamps = [];
  const parks = [];
  const half = ROAD_W / 2 + 14;
  const xs = [0, ...AVENUES, WORLD.width];
  const ys = [0, ...STREETS, WATER_Y];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const x0 = xs[i] + half, x1 = xs[i + 1] - half;
      const y0 = ys[j] + half, y1 = ys[j + 1] - half;
      if (x1 - x0 < 90 || y1 - y0 < 90) continue;
      // One south-west block is a park instead of buildings.
      if (i === 0 && j === ys.length - 2) {
        parks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        continue;
      }
      const count = intRange(rng, 1, 3);
      for (let k = 0; k < count; k++) {
        const w = range(rng, 70, Math.min(150, (x1 - x0) / count));
        const h = range(rng, 60, Math.min(130, y1 - y0));
        const bx = range(rng, x0, Math.max(x0 + 1, x1 - w));
        const by = range(rng, y0, Math.max(y0 + 1, y1 - h));
        const cand = { x: bx, y: by, w, h, color: pick(rng, WALLS), roof: pick(rng, ROOFS), tall: rng() < 0.3 };
        if (buildings.some((b) => blocksOverlap(cand, b))) continue;
        buildings.push(cand);
      }
      for (let t = 0; t < 3; t++) {
        trees.push({ x: range(rng, x0, x1), y: range(rng, y0, y1), r: range(rng, 7, 12), color: pick(rng, TREES) });
      }
    }
  }
  for (const ax of AVENUES) for (const sy of STREETS) {
    lamps.push({ x: ax + ROAD_W / 2 + 6, y: sy - ROAD_W / 2 - 6 });
    lamps.push({ x: ax - ROAD_W / 2 - 6, y: sy + ROAD_W / 2 + 6 });
  }
  for (let i = 0; i < 10; i++) {
    lamps.push({ x: PIER_X + (i % 2 ? 60 : -60), y: 1520 + i * 26 });
  }
  return { buildings, trees, lamps, parks };
}

// True when a circle of radius r at (x, y) would hit a building or the water.
export function hitsObstacle(city, x, y, r) {
  if (inWater(x, y)) return true;
  for (const b of city.buildings) {
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
  }
  return false;
}

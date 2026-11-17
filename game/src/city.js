// Neon Bay: a fictional harbour city built on a road grid. Roads run north-south
// and east-west; the blocks between them hold buildings, parks and car parks,
// and the south edge is the bay with a pier. Nothing here is a real place.
import { clamp } from './rng.js';

export const WORLD_W = 3600;
export const WORLD_H = 2600;
export const ROAD_W = 110;
export const SIDEWALK = 16;

export const ROADS_V = [300, 900, 1500, 2100, 2700, 3300];
export const ROADS_H = [300, 800, 1300, 1800, 2300];

export const DISTRICTS = [
  { name: 'Harbourfront', x: 0, y: 2100, w: 3600, h: 500 },
  { name: 'Old Mill Quarter', x: 0, y: 0, w: 1200, h: 1000 },
  { name: 'Downtown Neon', x: 1200, y: 600, w: 1500, h: 900 },
  { name: 'Palm Court', x: 2400, y: 0, w: 1200, h: 1000 },
  { name: 'Junction Yards', x: 1200, y: 1500, w: 1500, h: 600 },
];

// Build the static city: buildings, parks, trees, parking lots and named spots.
export function buildCity(rng) {
  const buildings = [];
  const parks = [];
  const trees = [];
  const lots = [];
  const palette = ['#c96f5a', '#5a7dc9', '#c9a45a', '#6fc98a', '#9a6fc9', '#c95a8a', '#5ac9c2', '#b0b6c0', '#d97b4f', '#7d9b57'];
  for (let vi = 0; vi < ROADS_V.length - 1; vi++) {
    for (let hi = 0; hi < ROADS_H.length - 1; hi++) {
      const x0 = ROADS_V[vi] + ROAD_W / 2 + SIDEWALK + 14;
      const x1 = ROADS_V[vi + 1] - ROAD_W / 2 - SIDEWALK - 14;
      const y0 = ROADS_H[hi] + ROAD_W / 2 + SIDEWALK + 14;
      const y1 = ROADS_H[hi + 1] - ROAD_W / 2 - SIDEWALK - 14;
      if (x1 - x0 < 120 || y1 - y0 < 120) continue;
      const roll = rng.next();
      if (roll < 0.22) {
        parks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        const n = Math.floor(rng.range(4, 9));
        for (let i = 0; i < n; i++) trees.push({ x: rng.range(x0 + 20, x1 - 20), y: rng.range(y0 + 20, y1 - 20), r: rng.range(9, 16) });
        continue;
      }
      if (roll < 0.32) {
        lots.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        continue;
      }
      // One or two buildings per block, with a gap between them.
      const split = rng.chance(0.55);
      const spots = split
        ? [{ x: x0, y: y0, w: (x1 - x0) * 0.46, h: y1 - y0 }, { x: x0 + (x1 - x0) * 0.54, y: y0, w: (x1 - x0) * 0.46, h: y1 - y0 }]
        : [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }];
      for (const s of spots) {
        const w = Math.max(70, s.w * rng.range(0.6, 0.92));
        const h = Math.max(60, s.h * rng.range(0.55, 0.9));
        buildings.push({
          x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, w, h,
          color: rng.pick(palette), roof: rng.pick(['#3c4250', '#4a3c34', '#2f3a44', '#54423a']),
          stories: rng.int(1, 6), lit: rng.next(),
        });
      }
    }
  }
  return { buildings, parks, trees, lots };
}

// Manhattan routing over the road grid: change latitude on a vertical road,
// then longitude on a horizontal road, so a driver never cuts diagonally
// through buildings. Used by the screenshot autopilot and by police pursuit.
export function roadWaypoint(x, y, tx, ty) {
  const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const vx = nearest(ROADS_V, x);
  const hy = nearest(ROADS_H, ty);
  if (Math.abs(y - hy) > 70) {
    if (Math.abs(x - vx) > 40) return { x: vx, y: nearest(ROADS_H, y) };
    return { x: vx, y: hy };
  }
  if (Math.abs(x - tx) > 70) return { x: tx, y: hy };
  return { x: tx, y: ty };
}

export function onRoad(x, y) {
  for (const rx of ROADS_V) if (Math.abs(x - rx) < ROAD_W / 2) return true;
  for (const ry of ROADS_H) if (Math.abs(y - ry) < ROAD_W / 2) return true;
  return false;
}

export function nearestRoadPoint(x, y) {
  let best = null; let bd = Infinity;
  for (const rx of ROADS_V) {
    const d = Math.abs(x - rx);
    if (d < bd) { bd = d; best = { x: rx, y: clamp(y, 60, WORLD_H - 60), vertical: true }; }
  }
  for (const ry of ROADS_H) {
    const d = Math.abs(y - ry);
    if (d < bd) { bd = d; best = { x: clamp(x, 60, WORLD_W - 60), y: ry, vertical: false }; }
  }
  return best;
}

// Circle vs building rectangles: push the circle out, report a hit.
export function collideBuildings(buildings, x, y, r) {
  let hit = false;
  for (const b of buildings) {
    const cx = clamp(x, b.x, b.x + b.w);
    const cy = clamp(y, b.y, b.y + b.h);
    const dx = x - cx; const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.01) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; y = cy + (dy / d) * r;
      } else {
        x += r;
      }
    }
  }
  return { x, y, hit };
}

export function insideBuilding(buildings, x, y) {
  for (const b of buildings) if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
  return false;
}

// Named story spots, all invented for this game.
export const SPOTS = {
  pier: { x: 1500, y: 2440, label: 'Neon Pier' },
  warehouse: { x: 3300, y: 800, label: 'Harbour Warehouse' },
  garage: { x: 300, y: 1800, label: 'Rusty Anchor Garage' },
  bank: { x: 2100, y: 1300, label: 'Bay Trust Bank' },
  diner: { x: 900, y: 1300, label: 'Sunset Diner' },
  casino: { x: 2700, y: 300, label: 'Golden Gull Casino' },
  hospital: { x: 900, y: 300, label: 'St. Marina Hospital' },
  dropA: { x: 2700, y: 1800, label: 'Drop-off: Palm Court' },
  dropB: { x: 300, y: 800, label: 'Drop-off: Old Mill' },
  deal: { x: 2100, y: 2300, label: 'Deal under the overpass' },
};

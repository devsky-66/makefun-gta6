// Neon Bay: a fictional harbour city drawn on a road grid. Everything in the
// world is placed against this grid — roads, blocks, buildings, lamps, parks and
// the mission landmarks — so traffic, pedestrians and the police can all share
// one simple rule: stay on the roads, walk on the pavements, never drive through
// a building. The layout is fixed by design; only the dressing (building
// colours, heights, trees, parked cars) is rolled from the seed.
import { intRange, pick, range } from './rng.js';

export const WORLD = { width: 2560, height: 1920 };

// The avenues run north-south, the streets east-west. Every crossing is an
// intersection traffic and missions can aim at.
export const AVENUES = [320, 800, 1280, 1760, 2240];
export const STREETS = [300, 700, 1100, 1500];
export const ROAD_WIDTH = 104;
export const WALK_WIDTH = 26;

export const LANDMARKS = {
  // The docks sit on the south-west pier, past the last street.
  docks: { x: 320, y: 1720, label: 'Harbor Docks' },
  // The bank anchors the middle of town.
  bank: { x: 1280, y: 700, label: 'Neon Bay Bank' },
  // City hall crowns the north-east quarter.
  cityHall: { x: 1760, y: 300, label: 'City Hall' },
  // The safehouse is a quiet flat on a middle street.
  safehouse: { x: 800, y: 1100, label: 'Safehouse' },
  // The courier runs the long road down to the pier.
  pierGate: { x: 320, y: 1500, label: 'Pier Gate' },
  // A market square in the south-east for the rush deliveries.
  market: { x: 2240, y: 1500, label: 'Night Market' },
};

const BUILDING_COLORS = [
  '#3d4a63', '#4a3f5e', '#54423a', '#2f4a44', '#4c4a35',
  '#5a3a4a', '#37455c', '#4a5540', '#5c4632', '#413654',
];
const ROOF_COLORS = ['#232b3a', '#2c2530', '#2a2f28', '#33241f', '#26303a'];

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Is this point on tarmac (a road), rather than a block?
export function onRoad(x, y) {
  const half = ROAD_WIDTH / 2;
  for (const ax of AVENUES) if (Math.abs(x - ax) <= half) return true;
  for (const sy of STREETS) if (Math.abs(y - sy) <= half) return true;
  return false;
}

// The closest point that sits on a road, for steering lost cars back to tarmac.
export function nearestRoadPoint(x, y) {
  let bestX = AVENUES[0];
  for (const ax of AVENUES) if (Math.abs(ax - x) < Math.abs(bestX - x)) bestX = ax;
  let bestY = STREETS[0];
  for (const sy of STREETS) if (Math.abs(sy - y) < Math.abs(bestY - y)) bestY = sy;
  if (Math.abs(bestX - x) <= Math.abs(bestY - y)) return { x: bestX, y };
  return { x, y: bestY };
}

// The closest intersection to a point.
export function nearestIntersection(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const ax of AVENUES) {
    for (const sy of STREETS) {
      const d = (ax - x) * (ax - x) + (sy - y) * (sy - y);
      if (d < bestD) { bestD = d; best = { x: ax, y: sy }; }
    }
  }
  return best;
}

// A random intersection, optionally not the one given.
export function randomIntersection(random, avoid) {
  const ax = pick(random, AVENUES);
  const sy = pick(random, STREETS);
  if (avoid && ax === avoid.x && sy === avoid.y) return randomIntersection(random, avoid);
  return { x: ax, y: sy };
}

// A random point on a road (used for pickups and parked cars).
export function randomRoadPoint(random) {
  if (random() < 0.5) {
    const ax = pick(random, AVENUES);
    return { x: ax + range(random, -ROAD_WIDTH / 2 + 18, ROAD_WIDTH / 2 - 18), y: range(random, 120, WORLD.height - 120) };
  }
  const sy = pick(random, STREETS);
  return { x: range(random, 120, WORLD.width - 120), y: sy + range(random, -ROAD_WIDTH / 2 + 18, ROAD_WIDTH / 2 - 18) };
}

// Keep a point inside the world with a small margin.
export function clampWorld(x, y, margin) {
  return {
    x: Math.max(margin, Math.min(WORLD.width - margin, x)),
    y: Math.max(margin, Math.min(WORLD.height - margin, y)),
  };
}

// Build the city dressing from the seed: buildings fill every block between the
// roads, lamps line the crossings, trees dot the pavements, and a few parks
// break up the concrete.
export function buildCity(random) {
  const buildings = [];
  const lamps = [];
  const trees = [];
  const parks = [];

  for (let ai = 0; ai < AVENUES.length - 1; ai += 1) {
    for (let si = 0; si < STREETS.length - 1; si += 1) {
      const left = AVENUES[ai] + ROAD_WIDTH / 2 + WALK_WIDTH;
      const right = AVENUES[ai + 1] - ROAD_WIDTH / 2 - WALK_WIDTH;
      const top = STREETS[si] + ROAD_WIDTH / 2 + WALK_WIDTH;
      const bottom = STREETS[si + 1] - ROAD_WIDTH / 2 - WALK_WIDTH;
      const blockW = right - left;
      const blockH = bottom - top;
      // One block in five is a park instead of buildings.
      if (random() < 0.18) {
        parks.push({ x: left, y: top, w: blockW, h: blockH });
        for (let t = 0; t < 6; t += 1) {
          trees.push({ x: range(random, left + 20, right - 20), y: range(random, top + 20, bottom - 20), r: range(random, 9, 15) });
        }
        continue;
      }
      // Split the block into two or three buildings.
      const vertical = blockW > blockH;
      const cuts = intRange(random, 1, 2);
      for (let c = 0; c <= cuts; c += 1) {
        let b;
        if (vertical) {
          const w = blockW / (cuts + 1) - 14;
          b = { x: left + (c * blockW) / (cuts + 1) + 7, y: top + 7, w, h: blockH - 14 };
        } else {
          const h = blockH / (cuts + 1) - 14;
          b = { x: left + 7, y: top + (c * blockH) / (cuts + 1) + 7, w: blockW - 14, h };
        }
        b.color = pick(random, BUILDING_COLORS);
        b.roof = pick(random, ROOF_COLORS);
        b.height = intRange(random, 1, 4);
        b.windows = random() < 0.7;
        buildings.push(b);
      }
      for (let t = 0; t < 2; t += 1) {
        trees.push({ x: range(random, left, right), y: range(random, top, bottom), r: range(random, 8, 13) });
      }
    }
  }

  // Lamps at every intersection corner and along the long roads.
  for (const ax of AVENUES) {
    for (const sy of STREETS) {
      lamps.push({ x: ax - ROAD_WIDTH / 2 - 8, y: sy - ROAD_WIDTH / 2 - 8 });
      lamps.push({ x: ax + ROAD_WIDTH / 2 + 8, y: sy + ROAD_WIDTH / 2 + 8 });
    }
  }
  for (let x = 200; x < WORLD.width; x += 320) lamps.push({ x, y: 1500 - ROAD_WIDTH / 2 - 8 });

  // The pier: a strip of wooden boards south of the last street, with crates.
  const pier = { x: 120, y: 1660, w: 420, h: 220 };
  const crates = [];
  for (let i = 0; i < 10; i += 1) {
    crates.push({ x: range(random, pier.x + 16, pier.x + pier.w - 40), y: range(random, pier.y + 16, pier.y + pier.h - 40), s: range(random, 18, 30) });
  }

  return { buildings, lamps, trees, parks, pier, crates };
}

// Push a circle (a person or a car centre) out of every building it overlaps.
// Returns true when a push happened.
export function resolveBuildingCollision(buildings, body, radius) {
  let hit = false;
  for (const b of buildings) {
    const cx = Math.max(b.x, Math.min(body.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(body.y, b.y + b.h));
    const dx = body.x - cx;
    const dy = body.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      body.x = cx + (dx / d) * radius;
      body.y = cy + (dy / d) * radius;
    } else {
      body.x = b.x - radius;
    }
  }
  return hit;
}

// Keep the pier crates solid too (small squares).
export function resolveCrateCollision(crates, body, radius) {
  let hit = false;
  for (const c of crates) {
    const cx = Math.max(c.x, Math.min(body.x, c.x + c.s));
    const cy = Math.max(c.y, Math.min(body.y, c.y + c.s));
    const dx = body.x - cx;
    const dy = body.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      body.x = cx + (dx / d) * radius;
      body.y = cy + (dy / d) * radius;
    } else {
      body.x = c.x - radius;
    }
  }
  return hit;
}

// A car hitting a crate fast enough smashes straight through it; at a crawl
// the crate is solid, like a bollard. Without this a car can wedge
// nose-first on a crate at full speed and never get out.
export function collideCratesForCar(crates, body, radius, speed, onSmash) {
  let hit = false;
  for (let i = crates.length - 1; i >= 0; i -= 1) {
    const c = crates[i];
    const cx = Math.max(c.x, Math.min(body.x, c.x + c.s));
    const cy = Math.max(c.y, Math.min(body.y, c.y + c.s));
    const dx = body.x - cx;
    const dy = body.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    if (Math.abs(speed) > 80) {
      crates.splice(i, 1);
      if (onSmash) onSmash();
      continue;
    }
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      body.x = cx + (dx / d) * radius;
      body.y = cy + (dy / d) * radius;
    } else {
      body.x = c.x - radius;
    }
  }
  return hit;
}

export function rectsOverlapExport(a, b) {
  return rectsOverlap(a, b);
}

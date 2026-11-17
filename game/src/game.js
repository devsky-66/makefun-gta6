// Cinder Bay core rules: movement, driving, traffic, pedestrians, stealing,
// wanted stars, police, six story missions, shooting, pickups, day/night
// and saves. Rendering lives in render.js; screenshot steering in shots.js.
// The whole simulation steps at a fixed 1/60s so headless replays are exact.
import { AVENUES, STREETS, WORLD, SPOTS, WATER_Y, PIER_X, buildCity, hitsObstacle, nearestCrossing, nearestRoadPoint, onRoad, randomCrossing, routeBetween } from './city.js';
import { makeRng, pick, range, intRange } from './rng.js';

export const STEP = 1 / 60;
export const SAVE_KEY = 'cinder-bay-save-v5';

const PAINT_JOBS = ['#c23b3b', '#3b7ec2', '#c2a13b', '#4a9e5c', '#8a5fc2', '#c26a2e', '#5fb8c2', '#b8b8b8'];
const PED_SKINS = ['#e8c39a', '#c98f5f', '#8a6b4a', '#e0a878', '#b98a5a'];

export const MISSIONS = [
  { id: 0, name: 'First Wheels', brief: 'Rook needs a ride. Take the sedan parked by the Hideout and bring it to the Pier Gate.', target: 'pierGate', reward: 150, dialog: ['Vex: Rook, you are back. We need wheels before the docks wake up.', 'Rook: One sedan, no questions. Got it.'] },
  { id: 1, name: 'Harbour Run', brief: 'Drive the package from the Pier Gate to the Night Market. Keep it under the speed the cops notice.', target: 'market', reward: 250, dialog: ['Vex: Package is in the trunk. Market stall, east end. Do not stop for anyone.', 'Rook: East end. Quiet as smoke.'] },
  { id: 2, name: 'Bank Job', brief: 'Grab the ledger page from Meridian Bank, then shake the tail and reach the Hideout.', target: 'bank', reward: 400, dialog: ['Vex: The ledger page is in the bank vault room. In and out.', 'Rook: Alarms mean I run. You know the drill.'] },
  { id: 3, name: 'Lose the Heat', brief: 'The heat is on. Lose 3 stars, then meet Vex at Foundry Plaza.', target: 'plaza', reward: 300, dialog: ['Vex: They are all over you. Break line of sight, then come to the plaza.', 'Rook: Three stars and a prayer. See you there.'] },
  { id: 4, name: 'Three Stops', brief: 'Timed rush: hit the Garage, the Docks and City Hall before the clock runs out.', target: 'garage', reward: 500, dialog: ['Vex: Three drops, ninety seconds each. The crew is counting on you.', 'Rook: Clock is ticking. Floor it.'] },
  { id: 5, name: 'The Ledger', brief: 'Final job: take the full ledger from City Hall and deliver it to the Docks. Finish this.', target: 'hall', reward: 800, dialog: ['Vex: Last one, Rook. The whole ledger. City Hall to the Docks.', 'Rook: Then we are free of this city. Let us go.'] },
];

function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function createGame(seed) {
  const g = {
    seed,
    random: makeRng(seed),
    city: null,
    time: 0,
    clock: 9 * 3600,
    state: 'title', // title | play | pause | busted | wasted | done
    player: { x: SPOTS.hideout.x, y: SPOTS.hideout.y + 60, angle: -Math.PI / 2, speed: 0, car: null, onFoot: true },
    health: 100,
    cash: 120,
    ammo: 30,
    wanted: 0,
    wantedTimer: 0,
    cars: [], peds: [], police: [], bullets: [], enemies: [], pickups: [], roadblocks: [],
    missionIndex: 0, mission: null, missionStage: 0, missionTimer: 0, missionFailed: false,
    banner: '', bannerT: 0, dialog: [], dialogT: 0, kills: 0, carsStolen: 0,
    over: null, stats: { missionsDone: 0, shots: 0 }, events: [],
    camX: 0, camY: 0, lastShot: -1,
  };
  resetWorld(g, g.random);
  return g;
}

export function resetWorld(g, rng) {
  g.city = buildCity(rng);
  g.cars = [];
  g.peds = [];
  g.police = [];
  g.bullets = [];
  g.enemies = [];
  g.pickups = [];
  g.roadblocks = [];
  g.time = 0;
  // Parked cars near landmarks, plus NPC traffic on the grid.
  for (let i = 0; i < 6; i += 1) {
    const spot = randomCrossing(rng);
    g.cars.push(makeCar(rng, spot.x + range(rng, -30, 30), spot.y + range(rng, -30, 30), 'parked'));
  }
  // Mission 1's sedan is always parked by the Hideout, on the street.
  const sedan = makeCar(rng, 830, 1060, 'parked');
  sedan.angle = 0;
  g.cars.push(sedan);
  for (let i = 0; i < 10; i += 1) {
    const spot = randomCrossing(rng);
    const car = makeCar(rng, spot.x, spot.y, 'npc');
    car.route = null;
    car.dest = randomCrossing(rng, spot);
    g.cars.push(car);
  }
  for (let i = 0; i < 14; i += 1) {
    const spot = randomCrossing(rng);
    g.peds.push({
      x: spot.x + range(rng, -60, 60), y: spot.y + range(rng, -60, 60),
      angle: range(rng, 0, Math.PI * 2), speed: range(rng, 28, 52),
      color: pick(rng, PED_SKINS), target: randomCrossing(rng, spot), pauseT: 0,
    });
  }
  for (let i = 0; i < 5; i += 1) {
    const spot = randomCrossing(rng);
    g.pickups.push({
      x: spot.x + range(rng, -40, 40), y: spot.y + range(rng, -40, 40),
      kind: pick(rng, ['cash', 'health', 'ammo']),
    });
  }
}

export function makeCar(rng, x, y, kind) {
  const models = [
    { name: 'sedan', top: 330, accel: 260, turn: 2.6, len: 44, wid: 22 },
    { name: 'taxi', top: 350, accel: 280, turn: 2.8, len: 44, wid: 22 },
    { name: 'van', top: 280, accel: 210, turn: 2.2, len: 52, wid: 24 },
    { name: 'bike', top: 380, accel: 330, turn: 3.4, len: 34, wid: 14 },
  ];
  const spec = kind === 'police'
    ? { name: 'cruiser', top: 400, accel: 320, turn: 3.0, len: 46, wid: 22 }
    : pick(rng, models);
  return {
    x, y,
    angle: pick(rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]),
    speed: 0,
    color: kind === 'police' ? '#20242e' : pick(rng, PAINT_JOBS),
    kind,
    type: spec,
    route: null, routeIdx: 0, dest: null,
    driver: kind !== 'parked',
    stuckT: 0, lastX: x, lastY: y, reverseT: 0, blockedT: 0, replanT: 0, honkT: 0,
  };
}

// ---------- autopilot / driver brain (shared by NPC traffic, police, shots) ----------
// Route state lives on the car so a blocked driver re-plans instead of
// pushing forever at the same wall. Stuck means moved < 8px in a second.
export function planRoute(car, target) {
  car.route = routeBetween(car, target);
  car.routeIdx = 0;
  car.stuckT = 0;
  car.blockedT = 0;
  car.replanT = 0;
  car.lastX = car.x;
  car.lastY = car.y;
}

export function driveAlongRoute(g, car, dt, cruise) {
  if (!car.route || car.routeIdx >= car.route.length) return true; // arrived
  const wp = car.route[car.routeIdx];
  const d = dist(car.x, car.y, wp.x, wp.y);
  if (d < 26) {
    car.routeIdx += 1;
    return car.routeIdx >= car.route.length;
  }
  // Stuck detection: less than 8px in one second while trying to move.
  car.stuckT += dt;
  if (car.stuckT >= 1) {
    const moved = dist(car.x, car.y, car.lastX, car.lastY);
    if (moved < 8) {
      car.reverseT = 0.7; // reverse out of the jam
      car.stuckT = 0;
    }
    car.lastX = car.x;
    car.lastY = car.y;
    car.stuckT = 0;
  }
  if (car.reverseT > 0) {
    car.reverseT -= dt;
    car.speed = Math.max(car.speed - car.type.accel * dt, -120);
    moveCar(g, car, dt);
    return false;
  }
  // Blocked by a car ahead for 2s: shove it aside instead of waiting forever.
  const ahead = carAhead(g, car);
  if (ahead) {
    car.blockedT += dt;
    if (car.blockedT > 2) {
      const push = 260 * dt;
      ahead.x += Math.cos(car.angle) * push;
      ahead.y += Math.sin(car.angle) * push;
      car.blockedT = 0;
      if (g.events) g.events.push('shove');
    }
  } else car.blockedT = 0;
  // Re-plan if the waypoint has been unreachable for a while.
  car.replanT += dt;
  if (car.replanT > 6) {
    planRoute(car, car.route[car.route.length - 1]);
    return false;
  }
  const want = Math.atan2(wp.y - car.y, wp.x - car.x);
  const diff = angleDiff(want, car.angle);
  car.angle += clamp(diff, -car.type.turn * dt, car.type.turn * dt);
  const cruiseSpeed = Math.abs(diff) > 0.9 ? cruise * 0.35 : cruise;
  car.speed += clamp(cruiseSpeed - car.speed, -car.type.accel * dt, car.type.accel * dt * 0.8);
  moveCar(g, car, dt);
  return false;
}

function carAhead(g, car) {
  const ax = car.x + Math.cos(car.angle) * 46;
  const ay = car.y + Math.sin(car.angle) * 46;
  for (const other of g.cars) {
    if (other === car) continue;
    if (dist(ax, ay, other.x, other.y) < 34 && Math.abs(other.speed) < 40) return other;
  }
  return null;
}

export function moveCar(g, car, dt) {
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  if (!hitsObstacle(g.city, nx, ny, 16) && nx > 20 && nx < WORLD.width - 20 && ny > 20 && ny < WATER_Y + 100) {
    car.x = nx;
    car.y = ny;
  } else {
    car.speed *= 0.4;
    car.angle += 0.12; // scrape along the wall instead of stopping dead
  }
}

// On foot, if the player has not moved for a second, walk along the road
// grid toward the nearest road point — the same escape hatch drivers use.
export function footEscape(g, p, dt, state) {
  state.t += dt;
  if (state.t >= 1) {
    const moved = dist(p.x, p.y, state.lx, state.ly);
    if (moved < 8) {
      const rp = nearestRoadPoint(p.x, p.y);
      const d = dist(p.x, p.y, rp.x, rp.y);
      if (d > 6) {
        p.x += ((rp.x - p.x) / d) * 170 * dt * 4;
        p.y += ((rp.y - p.y) / d) * 170 * dt * 4;
      }
    }
    state.lx = p.x;
    state.ly = p.y;
    state.t = 0;
  }
}

// ---------- missions ----------
export function missionTarget(g) {
  if (!g.mission) return null;
  const m = MISSIONS[g.missionIndex];
  if (g.missionIndex === 2 && g.missionStage === 1) return SPOTS.hideout;
  if (g.missionIndex === 4) return [SPOTS.garage, SPOTS.docks, SPOTS.hall][Math.min(g.missionStage, 2)];
  return SPOTS[m.target];
}

export function startMission(g, idx) {
  const m = MISSIONS[idx];
  g.missionIndex = idx;
  g.mission = m;
  g.missionStage = 0;
  g.missionFailed = false;
  g.missionTimer = idx === 4 ? 90 : 0;
  g.dialog = m.dialog.slice();
  g.dialogT = 6;
  g.banner = 'Mission: ' + m.name;
  g.bannerT = 3;
  if (idx === 2) spawnEnemies(g, SPOTS.bank, 3);
  if (idx === 5) spawnEnemies(g, SPOTS.hall, 4);
  if (idx === 3) addWanted(g, 3);
}

function spawnEnemies(g, spot, n) {
  for (let i = 0; i < n; i += 1) {
    g.enemies.push({
      x: spot.x + (i - n / 2) * 60, y: spot.y + 50,
      angle: 0, hp: 3, speed: 70,
      shootT: range(g.random, 1, 2.5), color: '#5c2e2e',
    });
  }
}

export function completeMission(g) {
  const m = MISSIONS[g.missionIndex];
  g.cash += m.reward;
  g.stats.missionsDone += 1;
  g.banner = 'Mission complete: +' + m.reward + ' cash';
  g.bannerT = 3;
  g.mission = null;
  g.enemies = [];
  if (g.missionIndex + 1 < MISSIONS.length) {
    startMission(g, g.missionIndex + 1);
  } else {
    g.state = 'done';
    g.over = 'You finished the ledger. Cinder Bay is yours.';
  }
}

export function failMission(g, why) {
  g.missionFailed = true;
  g.banner = 'Mission failed: ' + why + ' — press R to retry';
  g.bannerT = 4;
}

export function retryMission(g) {
  g.missionFailed = false;
  g.health = Math.max(g.health, 60);
  startMission(g, g.missionIndex);
}

// ---------- wanted / police ----------
export function addWanted(g, stars) {
  g.wanted = clamp(g.wanted + stars, 0, 5);
  g.wantedTimer = 0;
  if (g.wanted >= 1) g.events.push('wanted' + g.wanted);
}

function spawnPolice(g) {
  const want = 1 + Math.min(2, Math.floor(g.wanted / 2));
  while (g.police.length < want) {
    const spot = randomCrossing(g.random, nearestCrossing(g.player.x, g.player.y));
    const car = makeCar(g.random, spot.x, spot.y, 'police');
    car.route = null;
    g.police.push(car);
    g.cars.push(car);
  }
}

function setRoadblocks(g) {
  if (g.wanted < 4) { g.roadblocks = []; return; }
  if (g.roadblocks.length >= 2) return;
  const cross = nearestCrossing(g.player.x, g.player.y);
  const ax = pick(g.random, AVENUES.filter((a) => Math.abs(a - g.player.x) > 200));
  g.roadblocks.push({ x: ax, y: cross.y, angle: 0 });
  const sy = pick(g.random, STREETS.filter((s) => Math.abs(s - g.player.y) > 200));
  g.roadblocks.push({ x: cross.x, y: sy, angle: Math.PI / 2 });
}

// ---------- combat ----------
export function fireBullet(g, fromX, fromY, angle, friendly) {
  if (friendly && g.ammo <= 0) return;
  if (friendly) { g.ammo -= 1; g.stats.shots += 1; }
  g.bullets.push({
    x: fromX + Math.cos(angle) * 22, y: fromY + Math.sin(angle) * 22,
    angle, speed: 620, life: 0.9, friendly,
  });
}

// ---------- save / load ----------
export function saveGame(g) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: g.cash, health: g.health, ammo: g.ammo, missionIndex: g.missionIndex,
      x: g.player.x, y: g.player.y, wanted: g.wanted, kills: g.kills,
    }));
  } catch { /* storage unavailable in some embeds */ }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function hasSave() { return loadSave() !== null; }

// ---------- main step ----------
export function stepGame(g, input, dt) {
  if (g.state !== 'play') return;
  g.time += dt;
  g.clock = (g.clock + dt * 100) % 86400; // a full day in ~14 game minutes
  const p = g.player;
  const car = p.car;

  if (g.bannerT > 0) g.bannerT -= dt;
  if (g.dialogT > 0) g.dialogT -= dt;

  // --- player ---
  if (car) {
    const fwd = (input.up ? 1 : 0) - (input.down ? 0.6 : 0);
    const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (fwd !== 0) car.speed += fwd * car.type.accel * dt;
    else car.speed *= Math.max(0, 1 - 1.6 * dt);
    car.speed = clamp(car.speed, -140, car.type.top);
    if (Math.abs(car.speed) > 12) {
      car.angle += steer * car.type.turn * dt * Math.sign(car.speed) * (Math.abs(car.speed) / car.type.top + 0.3);
    }
    moveCar(g, car, dt);
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    if (input.shoot || input.shootLatch) {
      input.shootLatch = false;
      const ang = input.aimAngle != null ? input.aimAngle : car.angle;
      if (g.time - (g.lastShot || 0) > 0.22) { fireBullet(g, p.x, p.y, ang, true); g.lastShot = g.time; }
    }
  } else {
    const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const len = Math.hypot(mx, my);
    if (len > 0) {
      const sp = input.run ? 250 : 175;
      const nx = p.x + (mx / len) * sp * dt;
      const ny = p.y + (my / len) * sp * dt;
      if (!hitsObstacle(g.city, nx, ny, 12)) { p.x = nx; p.y = ny; }
      p.angle = Math.atan2(my, mx);
      p.speed = sp;
    } else p.speed = 0;
    if (input.shoot || input.shootLatch) {
      input.shootLatch = false;
      const ang = input.aimAngle != null ? input.aimAngle : p.angle;
      if (g.time - (g.lastShot || 0) > 0.22) { fireBullet(g, p.x, p.y, ang, true); g.lastShot = g.time; }
    }
  }

  // Enter / leave a car.
  if (input.enterPressed) {
    input.enterPressed = false;
    if (car) {
      p.car = null;
      p.onFoot = true;
      p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 30;
      p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 30;
    } else {
      let best = null;
      let bestD = 70;
      for (const c of g.cars) {
        const d = dist(p.x, p.y, c.x, c.y);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) {
        const stolen = best.kind === 'npc' && best.driver;
        p.car = best;
        p.onFoot = false;
        best.driver = true;
        best.kind = best.kind === 'parked' ? 'owned' : best.kind;
        if (stolen) {
          g.carsStolen += 1;
          addWanted(g, 1);
          g.banner = 'Car stolen! The cops are coming.';
          g.bannerT = 2.5;
        } else {
          g.banner = 'In the car. Drive!';
          g.bannerT = 1.5;
        }
      }
    }
  }

  // --- NPC traffic: follow the grid, re-route at each destination ---
  for (const c of g.cars) {
    if (c === p.car || c.kind === 'police' || c.kind === 'parked' || c.kind === 'owned') continue;
    if (!c.dest || !c.route) {
      c.dest = randomCrossing(g.random, nearestCrossing(c.x, c.y));
      planRoute(c, c.dest);
    }
    if (driveAlongRoute(g, c, dt, 150)) {
      c.dest = randomCrossing(g.random, nearestCrossing(c.x, c.y));
      planRoute(c, c.dest);
    }
  }

  // --- pedestrians: walk the pavements, dodge nearby cars ---
  for (const ped of g.peds) {
    let tx = ped.target.x;
    let ty = ped.target.y;
    for (const c of g.cars) {
      if (dist(ped.x, ped.y, c.x, c.y) < 60 && Math.abs(c.speed) > 40) {
        tx = ped.x + (ped.x - c.x);
        ty = ped.y + (ped.y - c.y);
      }
    }
    const d = dist(ped.x, ped.y, tx, ty);
    if (d < 20) { ped.target = randomCrossing(g.random); continue; }
    ped.angle = Math.atan2(ty - ped.y, tx - ped.x);
    const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
    const ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
    if (!hitsObstacle(g.city, nx, ny, 10)) { ped.x = nx; ped.y = ny; }
    // Run over by a fast car: the pedestrian flees and the heat rises.
    for (const c of g.cars) {
      if (Math.abs(c.speed) > 120 && dist(ped.x, ped.y, c.x, c.y) < 26) {
        ped.x += (ped.x - c.x) * 0.4;
        ped.y += (ped.y - c.y) * 0.4;
        if (c === p.car) addWanted(g, 1);
      }
    }
  }

  // --- wanted decay & police ---
  if (g.wanted > 0) {
    g.wantedTimer += dt;
    const nearCop = g.police.some((pc) => dist(pc.x, pc.y, p.x, p.y) < 420);
    if (g.wantedTimer > 18 && !nearCop) {
      g.wanted -= 1;
      g.wantedTimer = 0;
      g.banner = 'Heat cooling off…';
      g.bannerT = 2;
    }
    spawnPolice(g);
    setRoadblocks(g);
    for (const pc of g.police) {
      if (!pc.route || pc.replanT > 5) {
        planRoute(pc, { x: p.x, y: p.y });
        pc.dest = { x: p.x, y: p.y };
      }
      driveAlongRoute(g, pc, dt, 300 + g.wanted * 22);
      // Ram the player when close.
      if (dist(pc.x, pc.y, p.x, p.y) < 34) {
        if (p.car) { p.car.speed *= 0.7; g.health -= 4 * dt * 10; }
        else g.health -= 12 * dt;
        if (g.health <= 0) {
          g.health = 0;
          g.state = 'busted';
          g.over = 'Busted by the Cinder Bay police.';
        }
      }
    }
  } else {
    g.police = g.police.filter((pc) => {
      const i = g.cars.indexOf(pc);
      if (i >= 0) g.cars.splice(i, 1);
      return false;
    });
    g.roadblocks = [];
  }

  // --- enemies (mission thugs) ---
  for (const e of g.enemies) {
    const d = dist(e.x, e.y, p.x, p.y);
    if (d > 40) {
      e.angle = Math.atan2(p.y - e.y, p.x - e.x);
      e.x += Math.cos(e.angle) * e.speed * dt;
      e.y += Math.sin(e.angle) * e.speed * dt;
    }
    e.shootT -= dt;
    if (e.shootT <= 0 && d < 420) {
      fireBullet(g, e.x, e.y, Math.atan2(p.y - e.y, p.x - e.x) + range(g.random, -0.1, 0.1), false);
      e.shootT = range(g.random, 1.2, 2.4);
    }
  }

  // --- bullets ---
  for (const b of g.bullets) {
    b.x += Math.cos(b.angle) * b.speed * dt;
    b.y += Math.sin(b.angle) * b.speed * dt;
    b.life -= dt;
    if (b.friendly) {
      for (const e of g.enemies) {
        if (dist(b.x, b.y, e.x, e.y) < 18) {
          e.hp -= 1;
          b.life = 0;
          if (e.hp <= 0) { g.kills += 1; g.cash += 20; }
        }
      }
      g.enemies = g.enemies.filter((e) => e.hp > 0);
      for (const pc of g.police) {
        if (dist(b.x, b.y, pc.x, pc.y) < 24) { b.life = 0; addWanted(g, 1); pc.speed *= 0.5; }
      }
    } else if (dist(b.x, b.y, p.x, p.y) < 16) {
      b.life = 0;
      g.health -= 8;
      if (g.health <= 0) {
        g.health = 0;
        g.state = 'wasted';
        g.over = 'Rook got wasted on the streets of Cinder Bay.';
      }
    }
    if (hitsObstacle(g.city, b.x, b.y, 2)) b.life = 0;
  }
  g.bullets = g.bullets.filter((b) => b.life > 0);

  // --- pickups ---
  for (const pk of g.pickups) {
    if (dist(p.x, p.y, pk.x, pk.y) < 30) {
      if (pk.kind === 'cash') g.cash += 50;
      if (pk.kind === 'health') g.health = clamp(g.health + 30, 0, 100);
      if (pk.kind === 'ammo') g.ammo += 18;
      pk.taken = true;
      g.events.push('pickup:' + pk.kind);
    }
  }
  g.pickups = g.pickups.filter((pk) => !pk.taken);
  if (g.pickups.length < 4 && g.random() < 0.002) {
    const spot = randomCrossing(g.random);
    g.pickups.push({ x: spot.x, y: spot.y, kind: pick(g.random, ['cash', 'health', 'ammo']) });
  }

  // --- car collisions with roadblocks ---
  for (const rb of g.roadblocks) {
    if (p.car && dist(p.x, p.y, rb.x, rb.y) < 40) {
      p.car.speed *= 0.2;
      g.health -= 5;
      if (g.health <= 0) {
        g.health = 0;
        g.state = 'busted';
        g.over = 'Stopped at a police roadblock.';
      }
    }
  }

  // --- missions ---
  if (g.mission && !g.missionFailed) {
    if (g.missionIndex === 4) {
      g.missionTimer -= dt;
      if (g.missionTimer <= 0) failMission(g, 'out of time');
    }
    const t = missionTarget(g);
    if (t && dist(p.x, p.y, t.x, t.y) < 70) {
      if (g.missionIndex === 2 && g.missionStage === 0) {
        g.missionStage = 1;
        g.banner = 'Ledger page grabbed — get to the Hideout!';
        g.bannerT = 3;
        addWanted(g, 2);
      } else if (g.missionIndex === 4) {
        g.missionStage += 1;
        g.missionTimer = 90;
        if (g.missionStage >= 3) completeMission(g);
        else { g.banner = 'Drop done — next stop!'; g.bannerT = 2; }
      } else if (g.missionIndex === 3) {
        if (g.wanted <= 0) completeMission(g);
      } else completeMission(g);
    }
    if (g.missionIndex === 3 && g.wanted <= 0 && g.missionStage === 0) {
      g.missionStage = 1;
      g.banner = 'Heat is gone — head to Foundry Plaza.';
      g.bannerT = 3;
    }
  }

  // Camera follows the player.
  g.camX = clamp(p.x - 480, 0, WORLD.width - 960);
  g.camY = clamp(p.y - 320, 0, WORLD.height - 640);
  if (g.time % 1 < dt) saveGame(g); // autosave about once a second
}

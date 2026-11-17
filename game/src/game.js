// Neon Bay Nights — the simulation. One fixed-step world: a player on foot or
// behind the wheel, NPC traffic on the road grid, pedestrians on the pavements,
// police that chase the wanted, roadblocks at high heat, pickups, a day/night
// clock, and six story missions played back to back. The renderer only reads
// this state; the input only steers it.
import {
  AVENUES, LANDMARKS, STREETS, WORLD, buildCity, clampWorld, collideCratesForCar,
  nearestIntersection, nearestRoadPoint, onRoad, randomIntersection,
  randomRoadPoint, resolveBuildingCollision, resolveCrateCollision,
} from './city.js';
import { intRange, pick, range } from './rng.js';

export const STEP = 1 / 60;
export const SAVE_KEY = 'neon-bay-nights.save.v3';

const CAR_TYPES = {
  sedan: { maxSpeed: 400, accel: 280, turn: 2.7, brake: 520, w: 66, h: 30, radius: 24 },
  bus: { maxSpeed: 265, accel: 165, turn: 1.9, brake: 420, w: 100, h: 34, radius: 30 },
  bike: { maxSpeed: 505, accel: 400, turn: 3.5, brake: 620, w: 46, h: 18, radius: 16 },
  police: { maxSpeed: 465, accel: 330, turn: 3.1, brake: 560, w: 66, h: 30, radius: 24 },
};
const CAR_COLORS = ['#c94f42', '#4f7ec9', '#c9a44f', '#7ec94f', '#9a5fc9', '#c9c9c9', '#3fae8a', '#d97b3f'];
const PED_COLORS = ['#e8c39e', '#c98f6a', '#8a5a3b', '#f0d0b0', '#a06a45'];
const PED_SHIRTS = ['#d94f4f', '#4f7ed9', '#4fd97e', '#d9c44f', '#9a4fd9', '#e8e8e8', '#3f3f3f', '#d97b4f'];

const WANTED_DECAY_SECONDS = 20;
const CRIME_COOLDOWN = 4;
const POLICE_MAX_ACTIVE = 4;
const PICKUP_TARGET = 10;
const NPC_CAR_COUNT = 14;
const PED_COUNT = 36;

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// The six jobs, in story order. Each stage is one small goal; the mission
// ends when its last stage is done. Rewards are paid in cash on completion.
export const MISSIONS = [
  {
    name: 'Dockside Pickup',
    reward: 500,
    intro: [
      'A voice on the payphone: "Harbor Docks. A friend is waiting."',
      'Pick up the package, then drive it east. No questions.',
    ],
    stages: [
      { type: 'goto', x: LANDMARKS.docks.x, y: LANDMARKS.docks.y, r: 100, label: 'Meet the contact at the Harbor Docks' },
      { type: 'enterCar', label: 'Get in a car — the pickup is parked by the pier' },
      { type: 'goto', x: 1760, y: 1100, r: 100, label: 'Drive the package to the east side drop' },
    ],
  },
  {
    name: 'Cross-Town Delivery',
    reward: 800,
    intro: [
      '"Same package, longer road. Keep it quiet and the pay doubles — well, almost."',
      'Cross town to the Night Market. Full pay only if the heat stays off.',
    ],
    stages: [
      { type: 'goto', x: LANDMARKS.market.x, y: LANDMARKS.market.y, r: 100, label: 'Deliver to the Night Market — stay clean for full pay' },
    ],
  },
  {
    name: 'Lose the Heat',
    reward: 600,
    intro: [
      'A lookout tips you off: the whole precinct is rolling your way.',
      'Three stars. Lay low, stay out of sight, let the heat die down.',
    ],
    stages: [
      { type: 'setWanted', n: 3, label: 'The heat is on — three stars' },
      { type: 'loseHeat', label: 'Lay low until the wanted level drops to zero' },
    ],
  },
  {
    name: 'Bank Standoff',
    reward: 1500,
    intro: [
      '"The bank job is on. Hold the floor for thirty seconds while the crew works."',
      'Then run. The safehouse is the only place that matters after.',
    ],
    stages: [
      { type: 'goto', x: LANDMARKS.bank.x, y: LANDMARKS.bank.y, r: 130, label: 'Get to the Neon Bay Bank' },
      { type: 'hold', x: LANDMARKS.bank.x, y: LANDMARKS.bank.y, r: 180, dur: 30, label: 'Hold the bank floor — 30 seconds' },
      { type: 'goto', x: LANDMARKS.safehouse.x, y: LANDMARKS.safehouse.y, r: 110, label: 'Escape to the safehouse' },
    ],
  },
  {
    name: 'Three-Stop Rush',
    reward: 1200,
    intro: [
      'Three envelopes, three doors, one clock. The dispatcher is not patient.',
      'Hit all three stops before the time runs out.',
    ],
    stages: [
      {
        type: 'timed', limit: 150,
        stops: [
          { x: 800, y: 300, label: 'Stop 1 — north flats' },
          { x: 2240, y: 700, label: 'Stop 2 — east arcade' },
          { x: 320, y: 1100, label: 'Stop 3 — west depot' },
        ],
        label: 'Deliver to all three stops',
      },
    ],
  },
  {
    name: "The Mayor's Ledger",
    reward: 5000,
    intro: [
      'The last job. A ledger in City Hall names everyone — including the mayor.',
      'Take it, tail the courier to the docks, photograph the handoff, then vanish.',
    ],
    stages: [
      { type: 'goto', x: LANDMARKS.cityHall.x, y: LANDMARKS.cityHall.y, r: 120, label: 'Take the ledger from City Hall' },
      { type: 'follow', label: 'Tail the courier to the docks — stay close' },
      { type: 'photo', x: LANDMARKS.docks.x, y: LANDMARKS.docks.y, r: 130, dur: 12, label: 'Photograph the handoff — hold still for 12 seconds' },
      { type: 'loseHeat', label: 'Lose the police before the meet' },
      { type: 'combat', count: 4, label: 'The handoff is a setup — take down the crew at the docks' },
    ],
  },
];

function makeCar(random, type, x, y, angle, opts) {
  const spec = CAR_TYPES[type];
  const car = {
    id: Math.floor(random() * 1e9),
    type, x, y, angle, speed: 0,
    color: type === 'police' ? '#22262e' : pick(random, CAR_COLORS),
    npc: !!(opts && opts.npc),
    driver: !!(opts && opts.driver),
    parked: !!(opts && opts.parked),
    missionCar: !!(opts && opts.missionCar),
    route: [],
    routeIdx: 0,
    cruise: range(random, 120, 185),
    stuck: 0,
    flash: 0,
  };
  if (car.npc) {
    const start = nearestIntersection(x, y);
    car.route = [start, randomIntersection(random, start)];
    car.routeIdx = 1;
  }
  return car;
}

function makePed(random) {
  const p = randomRoadPoint(random);
  const side = random() < 0.5 ? -1 : 1;
  return {
    x: p.x + side * 52, y: p.y, angle: range(random, 0, Math.PI * 2),
    speed: range(random, 38, 68), target: null, flee: 0, down: 0,
    shirt: pick(random, PED_SHIRTS), skin: pick(random, PED_COLORS),
    phase: range(random, 0, Math.PI * 2), wait: 0,
  };
}

export function createGame(random) {
  const city = buildCity(random);
  const state = {
    random, city, time: 0,
    clock: 8 * 3600, // 08:00 on day one
    cash: 200, wanted: 0, wantedTimer: 0, crimeCooldown: 0,
    health: 100, ammo: 24, bestCash: 0, missionsDone: 0,
    player: {
      x: LANDMARKS.safehouse.x, y: LANDMARKS.safehouse.y + 60, angle: -Math.PI / 2,
      walkPhase: 0, invuln: 0, meleeCd: 0, shootCd: 0, hurtTimer: 0, car: null, moving: false,
    },
    cars: [], peds: [], police: [], roadblocks: [], pickups: [], guards: [],
    courier: null, missionCar: null,
    missionIndex: 0, mission: null, missionFailed: false,
    banner: '', bannerT: 0, dialog: [], dialogT: 0,
    over: null, events: [], kills: 0, steals: 0,
    dayPhase: 'day', light: 1,
  };
  resetWorld(state, random);
  return state;
}

// (Re)build the traffic, pedestrians and pickups for a fresh run.
export function resetWorld(state, random) {
  state.cars = [];
  state.peds = [];
  state.police = [];
  state.roadblocks = [];
  state.pickups = [];
  state.guards = [];
  state.courier = null;
  state.missionCar = null;
  state.over = null;
  state.missionFailed = false;
  const types = ['sedan', 'sedan', 'sedan', 'bus', 'bike', 'sedan', 'bus', 'sedan', 'bike', 'sedan', 'sedan', 'bus', 'sedan', 'bike'];
  for (let i = 0; i < NPC_CAR_COUNT; i += 1) {
    const p = randomRoadPoint(random);
    const car = makeCar(random, types[i % types.length], p.x, p.y, range(random, 0, Math.PI * 2), { npc: true, driver: true });
    state.cars.push(car);
  }
  // A few parked cars the player can take without stealing. Each one faces
  // along the road it sits on, so it can pull away instead of nosing into
  // the building across the street.
  for (let i = 0; i < 4; i += 1) {
    const p = randomRoadPoint(random);
    let nearestAvenue = AVENUES[0];
    for (const ax of AVENUES) if (Math.abs(ax - p.x) < Math.abs(nearestAvenue - p.x)) nearestAvenue = ax;
    let nearestStreet = STREETS[0];
    for (const sy of STREETS) if (Math.abs(sy - p.y) < Math.abs(nearestStreet - p.y)) nearestStreet = sy;
    const alongAvenue = Math.abs(p.x - nearestAvenue) <= Math.abs(p.y - nearestStreet);
    const angle = alongAvenue ? pick(random, [Math.PI / 2, -Math.PI / 2]) : pick(random, [0, Math.PI]);
    const car = makeCar(random, pick(random, ['sedan', 'sedan', 'bike']), p.x, p.y, angle, { parked: true });
    state.cars.push(car);
  }
  for (let i = 0; i < PED_COUNT; i += 1) state.peds.push(makePed(random));
  for (let i = 0; i < PICKUP_TARGET; i += 1) spawnPickup(state, random, true);
}

function spawnPickup(state, random, initial) {
  let x = 0;
  let y = 0;
  for (let tries = 0; tries < 12; tries += 1) {
    const p = randomRoadPoint(random);
    x = p.x; y = p.y;
    if (dist(x, y, state.player.x, state.player.y) > (initial ? 150 : 250)) break;
  }
  const roll = random();
  const kind = roll < 0.4 ? 'cash' : roll < 0.7 ? 'health' : 'ammo';
  state.pickups.push({ kind, x, y, value: kind === 'cash' ? intRange(random, 50, 150) : kind === 'health' ? 35 : 12, t: 0 });
}

function pushEvent(state, type, data) {
  state.events.push({ type, ...(data || {}) });
}

function showBanner(state, text, seconds) {
  state.banner = text;
  state.bannerT = seconds || 3.5;
}

function showDialog(state, lines) {
  state.dialog = lines.slice();
  state.dialogT = 0;
}

export function addWanted(state, n, reason) {
  if (state.over) return;
  const before = state.wanted;
  state.wanted = Math.min(5, state.wanted + n);
  state.wantedTimer = 0;
  if (state.wanted !== before) {
    pushEvent(state, 'wanted', { level: state.wanted, reason });
    showBanner(state, `Wanted level ${state.wanted} — ${reason}`, 2.5);
  }
}

// The mission the player is on, or null once the story is finished.
export function currentMission(state) {
  return state.missionIndex < MISSIONS.length ? MISSIONS[state.missionIndex] : null;
}

export function missionTarget(state) {
  const m = state.mission;
  if (!m || state.over) return null;
  const def = MISSIONS[m.index];
  const stage = def.stages[m.stage];
  if (!stage) return null;
  if (stage.type === 'goto' || stage.type === 'hold' || stage.type === 'photo') return { x: stage.x, y: stage.y, label: stage.label };
  if (stage.type === 'timed') {
    const stop = stage.stops[m.stopIndex];
    return stop ? { x: stop.x, y: stop.y, label: stop.label } : null;
  }
  if (stage.type === 'follow' && state.courier) return { x: state.courier.x, y: state.courier.y, label: stage.label };
  if (stage.type === 'combat' && state.guards.length) {
    const g = state.guards[0];
    return { x: g.x, y: g.y, label: stage.label };
  }
  if (stage.type === 'enterCar' && state.missionCar) return { x: state.missionCar.x, y: state.missionCar.y, label: stage.label };
  if (stage.type === 'loseHeat' || stage.type === 'setWanted') return { x: state.player.x, y: state.player.y, label: stage.label };
  return null;
}

export function startMission(state, index) {
  const def = MISSIONS[index];
  state.missionIndex = index;
  state.mission = { index, stage: 0, t: 0, hold: 0, stopIndex: 0, wantedAtStart: state.wanted, photo: 0 };
  state.missionFailed = false;
  showDialog(state, [`${def.name}`, ...def.intro]);
  showBanner(state, `Mission ${index + 1} of ${MISSIONS.length}: ${def.name}`, 4);
  pushEvent(state, 'missionStart', { name: def.name });
  if (index === 0 && !state.missionCar) {
    // The pickup car waits by the pier for the first job.
    const car = makeCar(state.random, 'sedan', LANDMARKS.docks.x + 90, LANDMARKS.docks.y - 40, Math.PI / 2, { parked: true, missionCar: true });
    car.color = '#d9b23f';
    state.cars.push(car);
    state.missionCar = car;
  }
}

function completeStage(state) {
  const m = state.mission;
  const def = MISSIONS[m.index];
  m.stage += 1;
  m.t = 0;
  m.hold = 0;
  m.photo = 0;
  if (m.stage >= def.stages.length) completeMission(state);
  else {
    const next = def.stages[m.stage];
    showBanner(state, next.label, 3);
    if (next.type === 'follow') spawnCourier(state);
    if (next.type === 'combat') spawnGuards(state);
  }
}

function completeMission(state) {
  const m = state.mission;
  const def = MISSIONS[m.index];
  let reward = def.reward;
  if (m.index === 1 && state.wanted > m.wantedAtStart) reward = Math.floor(reward / 2);
  state.cash += reward;
  state.bestCash = Math.max(state.bestCash, state.cash);
  state.missionsDone = m.index + 1;
  pushEvent(state, 'missionDone', { name: def.name, reward });
  showBanner(state, `Mission complete: ${def.name} — +$${reward}`, 4.5);
  showDialog(state, [`${def.name} — done.`, `Paid $${reward}. ${m.index + 1 < MISSIONS.length ? 'Next job is waiting.' : 'That is the whole story. Neon Bay is yours.'}`]);
  state.mission = null;
  state.missionIndex = m.index + 1;
  if (state.missionIndex < MISSIONS.length) startMission(state, state.missionIndex);
}

function failMission(state, reason) {
  state.missionFailed = true;
  pushEvent(state, 'missionFail', { reason });
  showBanner(state, `Mission failed — ${reason}. Press R to retry.`, 5);
  showDialog(state, ['Mission failed.', `${reason} — press R to retry the job.`]);
}

function spawnCourier(state) {
  const car = makeCar(state.random, 'sedan', LANDMARKS.cityHall.x + 70, LANDMARKS.cityHall.y + 60, Math.PI, { npc: true, driver: true });
  car.color = '#5a2e6e';
  car.route = [{ x: 1760, y: 300 }, { x: 800, y: 300 }, { x: 320, y: 300 }, { x: 320, y: 700 }, { x: 320, y: 1100 }, { x: 320, y: 1500 }, { x: 320, y: 1720 }];
  car.routeIdx = 1;
  car.cruise = 150;
  state.cars.push(car);
  state.courier = car;
}

function spawnGuards(state) {
  state.guards = [];
  for (let i = 0; i < 4; i += 1) {
    state.guards.push({
      x: LANDMARKS.docks.x + (i - 1.5) * 90, y: LANDMARKS.docks.y - 60 + (i % 2) * 80,
      hp: 60, angle: -Math.PI / 2, shootCd: range(state.random, 0.5, 1.5), phase: range(state.random, 0, 6),
    });
  }
  pushEvent(state, 'guards', {});
}

function nearestCar(state, x, y, maxD) {
  let best = null;
  let bestD = maxD;
  for (const car of state.cars) {
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function enterCar(state, car) {
  const p = state.player;
  if (car.driver && car.npc) {
    // Stealing a driven car: the driver is thrown out and the heat rises.
    const ped = makePed(state.random);
    ped.x = car.x + 40; ped.y = car.y + 30; ped.flee = 2;
    state.peds.push(ped);
    car.driver = false;
    car.npc = false;
    car.route = [];
    state.steals += 1;
    addWanted(state, 1, 'Grand theft auto');
    pushEvent(state, 'steal', {});
  } else if (car.type === 'police') {
    addWanted(state, 2, 'Stole a police car');
  }
  car.parked = false;
  p.car = car;
  p.angle = car.angle;
  pushEvent(state, 'enterCar', {});
}

function exitCar(state) {
  const p = state.player;
  const car = p.car;
  if (!car) return;
  car.speed = 0;
  car.parked = true;
  const side = { x: car.x + Math.cos(car.angle + Math.PI / 2) * 46, y: car.y + Math.sin(car.angle + Math.PI / 2) * 46 };
  const spot = clampWorld(side.x, side.y, 20);
  p.x = spot.x; p.y = spot.y;
  p.car = null;
  p.angle = car.angle;
  pushEvent(state, 'exitCar', {});
}

// One fixed step of the whole world.
export function stepGame(state, input, dt) {
  state.time += dt;
  state.clock = (state.clock + dt * 360) % 86400; // a full day every 4 minutes
  const hour = state.clock / 3600;
  state.dayPhase = hour >= 6 && hour < 17 ? 'day' : hour >= 17 && hour < 19.5 ? 'dusk' : hour >= 19.5 || hour < 5.5 ? 'night' : 'dawn';
  state.light = state.dayPhase === 'day' ? 1 : state.dayPhase === 'dusk' ? 0.55 : state.dayPhase === 'dawn' ? 0.6 : 0.22;
  if (state.crimeCooldown > 0) state.crimeCooldown -= dt;
  if (state.bannerT > 0) state.bannerT -= dt;
  if (state.dialog.length) state.dialogT += dt;
  if (state.player.invuln > 0) state.player.invuln -= dt;
  if (state.player.meleeCd > 0) state.player.meleeCd -= dt;
  if (state.player.shootCd > 0) state.player.shootCd -= dt;
  if (state.player.hurtTimer > 0) state.player.hurtTimer -= dt;

  // Wanted decay: twenty quiet seconds drops one star.
  if (state.wanted > 0) {
    state.wantedTimer += dt;
    if (state.wantedTimer >= WANTED_DECAY_SECONDS) {
      state.wanted -= 1;
      state.wantedTimer = 0;
      pushEvent(state, 'wanted', { level: state.wanted, reason: 'Heat dying down' });
      if (state.wanted === 0) showBanner(state, 'You lost them. The heat is off.', 3);
    }
  }

  stepPlayer(state, input, dt);
  stepTraffic(state, dt);
  stepPeds(state, dt);
  stepPolice(state, dt);
  stepGuards(state, dt);
  stepPickups(state, dt);
  stepMission(state, dt);

  // Slow recovery once the heat is off and nobody is shooting.
  if (state.wanted === 0 && state.player.hurtTimer <= 0 && state.health > 0 && state.health < 100) {
    state.health = Math.min(100, state.health + 1.5 * dt);
  }
  if (state.health <= 0 && !state.over) {
    state.over = 'wasted';
    pushEvent(state, 'wasted', {});
  }
}

function stepPlayer(state, input, dt) {
  const p = state.player;
  const city = state.city;
  if (input.enter) {
    if (p.car) exitCar(state);
    else {
      const car = nearestCar(state, p.x, p.y, 78);
      if (car) enterCar(state, car);
    }
  }
  if (input.melee && p.meleeCd <= 0 && !p.car) {
    p.meleeCd = 0.45;
    pushEvent(state, 'melee', {});
    meleeHit(state);
  }
  if (input.shoot && p.shootCd <= 0 && state.ammo > 0) {
    p.shootCd = 0.28;
    state.ammo -= 1;
    pushEvent(state, 'shoot', {});
    shootHit(state, input.shootX, input.shootY);
  }

  if (p.car) {
    const car = p.car;
    const spec = CAR_TYPES[car.type];
    const throttle = -input.my; // up (negative my) is forward
    const steer = input.mx;
    if (throttle > 0) car.speed += spec.accel * throttle * dt;
    else if (throttle < 0) car.speed += spec.accel * throttle * 0.7 * dt; // reverse is weaker
    if (input.my > 0.1 && car.speed > 0) car.speed -= spec.brake * dt; // S brakes while moving
    car.speed -= car.speed * 0.55 * dt; // drag and rolling resistance
    car.speed = Math.max(-spec.maxSpeed * 0.45, Math.min(spec.maxSpeed, car.speed));
    if (Math.abs(car.speed) > 4) {
      // Steering stays usable at a crawl (a parked car can still swing its
      // nose out of a tight spot); at a standstill it does nothing.
      const authority = Math.min(1, Math.max(0.3, Math.abs(car.speed) / 140));
      car.angle += steer * spec.turn * dt * authority * Math.sign(car.speed);
    }
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    car.x = nx; car.y = ny;
    const hitBuilding = resolveBuildingCollision(city.buildings, car, spec.radius);
    collideCratesForCar(city.crates, car, spec.radius, car.speed, () => pushEvent(state, 'crash', { strength: 0.3 }));
    const spot = clampWorld(car.x, car.y, 24);
    car.x = spot.x; car.y = spot.y;
    if (hitBuilding && Math.abs(car.speed) > 130) {
      pushEvent(state, 'crash', { strength: Math.abs(car.speed) / spec.maxSpeed });
      damagePlayer(state, Math.abs(car.speed) * 0.03);
      car.speed *= 0.35;
    } else if (hitBuilding) {
      car.speed *= 0.6;
    }
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    p.moving = Math.abs(car.speed) > 20;
    p.walkPhase += Math.abs(car.speed) * dt * 0.02;
  } else {
    const speed = 178;
    const mx = input.mx;
    const my = input.my;
    const len = Math.hypot(mx, my);
    p.moving = len > 0.1;
    if (p.moving) {
      const nx = mx / (len || 1);
      const ny = my / (len || 1);
      p.x += nx * speed * dt;
      p.y += ny * speed * dt;
      p.angle = Math.atan2(ny, nx);
      p.walkPhase += dt * 11;
    }
    const spot = clampWorld(p.x, p.y, 18);
    p.x = spot.x; p.y = spot.y;
    resolveBuildingCollision(city.buildings, p, 15);
    resolveCrateCollision(city.crates, p, 15);
  }
}

function meleeHit(state) {
  const p = state.player;
  const rangePx = 58;
  const hitArc = 1.1;
  let hitSomeone = false;
  const tryHit = (x, y, isPed) => {
    const d = dist(p.x, p.y, x, y);
    if (d > rangePx) return false;
    const ang = Math.abs(angleDiff(Math.atan2(y - p.y, x - p.x), p.angle));
    return ang < hitArc;
  };
  for (const g of state.guards) {
    if (g.hp > 0 && tryHit(g.x, g.y)) {
      g.hp -= 30;
      hitSomeone = true;
      if (g.hp <= 0) { state.kills += 1; pushEvent(state, 'guardDown', {}); }
    }
  }
  state.guards = state.guards.filter((g) => g.hp > 0);
  for (const ped of state.peds) {
    if (ped.down <= 0 && tryHit(ped.x, ped.y, true)) {
      ped.down = 2.5;
      ped.flee = 3;
      hitSomeone = true;
      if (state.crimeCooldown <= 0) { addWanted(state, 1, 'Assault'); state.crimeCooldown = CRIME_COOLDOWN; }
    }
  }
  if (hitSomeone) pushEvent(state, 'meleeHit', {});
}

function shootHit(state, tx, ty) {
  const p = state.player;
  const rangePx = 540;
  const dx = tx - p.x;
  const dy = ty - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let bestD = Math.min(rangePx, len);
  let bestKind = null;
  let bestObj = null;
  const consider = (x, y, radius, kind, obj) => {
    const vx = x - p.x;
    const vy = y - p.y;
    const along = vx * ux + vy * uy;
    if (along < 0 || along > bestD) return;
    const perp = Math.abs(vx * uy - vy * ux);
    if (perp < radius + 8) { bestD = along; bestKind = kind; bestObj = obj; }
  };
  for (const g of state.guards) if (g.hp > 0) consider(g.x, g.y, 16, 'guard', g);
  for (const ped of state.peds) if (ped.down <= 0) consider(ped.x, ped.y, 14, 'ped', ped);
  for (const car of state.cars) {
    if (car === p.car) continue;
    consider(car.x, car.y, CAR_TYPES[car.type].radius, car.type === 'police' ? 'policeCar' : 'car', car);
  }
  if (!bestKind) {
    pushEvent(state, 'shotMiss', { x: p.x + ux * bestD, y: p.y + uy * bestD });
    return;
  }
  pushEvent(state, 'shotHit', { x: bestObj.x, y: bestObj.y, kind: bestKind });
  if (bestKind === 'guard') {
    bestObj.hp -= 34;
    if (bestObj.hp <= 0) {
      state.kills += 1;
      state.guards = state.guards.filter((g) => g.hp > 0);
      pushEvent(state, 'guardDown', {});
    }
  } else if (bestKind === 'ped') {
    bestObj.down = 3;
    bestObj.flee = 4;
    if (state.crimeCooldown <= 0) { addWanted(state, 1, 'Shot a pedestrian'); state.crimeCooldown = CRIME_COOLDOWN; }
  } else if (bestKind === 'policeCar') {
    if (state.crimeCooldown <= 0) { addWanted(state, 1, 'Shot at the police'); state.crimeCooldown = CRIME_COOLDOWN; }
  } else if (bestKind === 'car') {
    if (state.crimeCooldown <= 0) { addWanted(state, 1, 'Shot a car'); state.crimeCooldown = CRIME_COOLDOWN; }
  }
}

function damagePlayer(state, amount) {
  if (state.player.invuln > 0 || state.over) return;
  state.health -= amount;
  state.player.hurtTimer = 4;
  state.player.invuln = 0.6;
  pushEvent(state, 'hurt', { amount });
}

function stepTraffic(state, dt) {
  const p = state.player;
  for (const car of state.cars) {
    if (!car.npc || car === p.car) continue;
    if (car.route.length === 0) continue;
    const target = car.route[car.routeIdx];
    const d = dist(car.x, car.y, target.x, target.y);
    if (d < 26) {
      const prev = target;
      const next = randomIntersection(state.random, prev);
      car.route = [prev, next];
      car.routeIdx = 1;
      continue;
    }
    const desired = Math.atan2(target.y - car.y, target.x - car.x);
    const turn = angleDiff(desired, car.angle);
    car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, turn));
    // Brake for the player's car stopped ahead.
    let cruise = car.cruise;
    if (p.car) {
      const ahead = dist(car.x + Math.cos(car.angle) * 70, car.y + Math.sin(car.angle) * 70, p.car.x, p.car.y);
      if (ahead < 55 && Math.abs(p.car.speed) < 30) cruise = 0;
    }
    // Brake for the car ahead of us.
    for (const other of state.cars) {
      if (other === car || other === p.car) continue;
      const ax = car.x + Math.cos(car.angle) * 60;
      const ay = car.y + Math.sin(car.angle) * 60;
      if (dist(ax, ay, other.x, other.y) < 42) { cruise = 0; break; }
    }
    car.speed += (cruise - car.speed) * Math.min(1, 1.6 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    const spot = clampWorld(car.x, car.y, 24);
    car.x = spot.x; car.y = spot.y;
    // Collisions between NPC cars and the player's car.
    if (p.car) {
      const rr = CAR_TYPES[car.type].radius + CAR_TYPES[p.car.type].radius;
      const dd = dist(car.x, car.y, p.car.x, p.car.y);
      if (dd < rr && dd > 0.01) {
        const push = (rr - dd) / 2;
        const ux = (car.x - p.car.x) / dd;
        const uy = (car.y - p.car.y) / dd;
        car.x += ux * push; car.y += uy * push;
        p.car.x -= ux * push; p.car.y -= uy * push;
        const impact = Math.abs(car.speed - p.car.speed);
        if (impact > 120) {
          car.speed *= 0.4;
          p.car.speed *= 0.55;
          pushEvent(state, 'crash', { strength: impact / 400 });
          damagePlayer(state, impact * 0.02);
          if (state.crimeCooldown <= 0) { addWanted(state, 1, 'Hit and run'); state.crimeCooldown = CRIME_COOLDOWN; }
        }
      }
    }
    // NPC cars that hit a pedestrian knock them down (no wanted for the player).
    for (const ped of state.peds) {
      if (ped.down <= 0 && car.speed > 60 && dist(car.x, car.y, ped.x, ped.y) < 30) {
        ped.down = 2.5; ped.flee = 3;
      }
    }
  }
  // The player's car running over a pedestrian.
  if (p.car && Math.abs(p.car.speed) > 90) {
    for (const ped of state.peds) {
      if (ped.down <= 0 && dist(p.car.x, p.car.y, ped.x, ped.y) < 32) {
        ped.down = 3; ped.flee = 4;
        pushEvent(state, 'crash', { strength: 0.5 });
        if (state.crimeCooldown <= 0) { addWanted(state, 1, 'Hit a pedestrian'); state.crimeCooldown = CRIME_COOLDOWN; }
      }
    }
  }
}

function stepPeds(state, dt) {
  for (const ped of state.peds) {
    if (ped.down > 0) { ped.down -= dt; continue; }
    if (ped.wait > 0) { ped.wait -= dt; continue; }
    // Flee from any fast car nearby.
    let threat = null;
    for (const car of state.cars) {
      if (Math.abs(car.speed) > 40 && dist(car.x, car.y, ped.x, ped.y) < 85) { threat = car; break; }
    }
    if (threat || ped.flee > 0) {
      ped.flee = Math.max(ped.flee - dt, threat ? 1.2 : ped.flee - dt);
      const away = threat ? Math.atan2(ped.y - threat.y, ped.x - threat.x) : ped.angle;
      ped.angle = away;
      ped.x += Math.cos(away) * 135 * dt;
      ped.y += Math.sin(away) * 135 * dt;
      ped.phase += dt * 13;
    } else {
      if (!ped.target || dist(ped.x, ped.y, ped.target.x, ped.target.y) < 20) {
        if (state.random() < 0.12) { ped.wait = range(state.random, 1, 3); continue; }
        const rp = randomRoadPoint(state.random);
        const side = state.random() < 0.5 ? -1 : 1;
        ped.target = { x: rp.x + side * 52, y: rp.y };
      }
      const desired = Math.atan2(ped.target.y - ped.y, ped.target.x - ped.x);
      ped.angle += Math.max(-6 * dt, Math.min(6 * dt, angleDiff(desired, ped.angle)));
      ped.x += Math.cos(ped.angle) * ped.speed * dt;
      ped.y += Math.sin(ped.angle) * ped.speed * dt;
      ped.phase += dt * 8;
    }
    const spot = clampWorld(ped.x, ped.y, 14);
    ped.x = spot.x; ped.y = spot.y;
    resolveBuildingCollision(state.city.buildings, ped, 12);
  }
}

function stepPolice(state, dt) {
  const p = state.player;
  // Spawn up to one police car per star (capped), at a crossing a fair
  // distance from the player — never right on top of them, or the bust
  // would feel like an ambush instead of a chase.
  const want = Math.min(state.wanted, POLICE_MAX_ACTIVE);
  while (state.police.length < want) {
    const near = nearestIntersection(p.x, p.y);
    let spot = randomIntersection(state.random, near);
    for (let tries = 0; tries < 8 && dist(spot.x, spot.y, p.x, p.y) < 500; tries += 1) {
      spot = randomIntersection(state.random, near);
    }
    const car = makeCar(state.random, 'police', spot.x, spot.y, range(state.random, 0, Math.PI * 2), {});
    car.flash = state.random() * 10;
    state.cars.push(car);
    state.police.push(car);
    pushEvent(state, 'policeSpawn', {});
  }
  // Stand down when the heat is gone.
  if (state.wanted === 0) {
    for (const car of state.police) {
      const idx = state.cars.indexOf(car);
      if (idx >= 0) state.cars.splice(idx, 1);
    }
    state.police = [];
    if (state.roadblocks.length) state.roadblocks = [];
    return;
  }
  // Four stars or more: block the road ahead of the player.
  if (state.wanted >= 4 && state.roadblocks.length === 0) {
    const ahead = nearestIntersection(p.x + Math.cos(p.angle) * 420, p.y + Math.sin(p.angle) * 420);
    state.roadblocks.push({ x: ahead.x, y: ahead.y, angle: p.angle });
    const second = randomIntersection(state.random, ahead);
    state.roadblocks.push({ x: second.x, y: second.y, angle: p.angle + Math.PI / 2 });
    pushEvent(state, 'roadblock', {});
    showBanner(state, 'Roadblock ahead!', 3);
  }
  if (state.wanted < 4) state.roadblocks = [];

  for (const car of state.police) {
    car.flash += dt * 6;
    const target = onRoad(p.x, p.y) ? { x: p.x, y: p.y } : nearestRoadPoint(p.x, p.y);
    const desired = Math.atan2(target.y - car.y, target.x - car.x);
    const turn = angleDiff(desired, car.angle);
    car.angle += Math.max(-3.4 * dt, Math.min(3.4 * dt, turn));
    const spec = CAR_TYPES.police;
    const d = dist(car.x, car.y, p.x, p.y);
    const cruise = d > 700 ? spec.maxSpeed : spec.maxSpeed * 0.92;
    car.speed += (cruise - car.speed) * Math.min(1, 1.8 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    const spot = clampWorld(car.x, car.y, 24);
    car.x = spot.x; car.y = spot.y;
    resolveBuildingCollision(state.city.buildings, car, spec.radius);
    // Ram the player's car.
    if (p.car) {
      const rr = spec.radius + CAR_TYPES[p.car.type].radius;
      const dd = dist(car.x, car.y, p.car.x, p.car.y);
      if (dd < rr && dd > 0.01) {
        const ux = (p.car.x - car.x) / dd;
        const uy = (p.car.y - car.y) / dd;
        p.car.x += ux * 3; p.car.y += uy * 3;
        car.speed *= 0.6;
        const impact = Math.abs(car.speed);
        if (impact > 100) {
          pushEvent(state, 'crash', { strength: impact / 465 });
          damagePlayer(state, impact * 0.02);
        }
      }
    } else if (d < 30 && car.speed < 90) {
      // Caught on foot: busted.
      state.over = 'busted';
      pushEvent(state, 'busted', {});
    } else if (d < 46 && car.speed >= 90) {
      // A fast police car clipping the player on foot still hurts.
      damagePlayer(state, 12);
      car.speed *= 0.5;
      pushEvent(state, 'crash', { strength: 0.4 });
    }
  }
  // Roadblocks are solid.
  for (const rb of state.roadblocks) {
    if (p.car && dist(rb.x, rb.y, p.car.x, p.car.y) < 58) {
      const d = dist(rb.x, rb.y, p.car.x, p.car.y) || 1;
      const ux = (p.car.x - rb.x) / d;
      const uy = (p.car.y - rb.y) / d;
      p.car.x = rb.x + ux * 58;
      p.car.y = rb.y + uy * 58;
      if (Math.abs(p.car.speed) > 120) {
        pushEvent(state, 'crash', { strength: 0.7 });
        damagePlayer(state, 10);
      }
      p.car.speed *= 0.3;
    } else if (!p.car && dist(rb.x, rb.y, p.x, p.y) < 40) {
      const d = dist(rb.x, rb.y, p.x, p.y) || 1;
      p.x = rb.x + ((p.x - rb.x) / d) * 40;
      p.y = rb.y + ((p.y - rb.y) / d) * 40;
    }
  }
}

function stepGuards(state, dt) {
  const p = state.player;
  for (const g of state.guards) {
    if (g.hp <= 0) continue;
    g.shootCd -= dt;
    const d = dist(g.x, g.y, p.x, p.y);
    g.angle = Math.atan2(p.y - g.y, p.x - g.x);
    if (d > 260) {
      g.x += Math.cos(g.angle) * 95 * dt;
      g.y += Math.sin(g.angle) * 95 * dt;
    }
    g.phase += dt * 6;
    if (g.shootCd <= 0 && d < 430) {
      g.shootCd = range(state.random, 1.1, 1.9);
      if (state.random() < 0.55) {
        damagePlayer(state, intRange(state.random, 5, 10));
        pushEvent(state, 'guardShot', {});
      }
    }
  }
}

function stepPickups(state, dt) {
  const p = state.player;
  for (const pk of state.pickups) {
    pk.t += dt;
    if (dist(pk.x, pk.y, p.x, p.y) < 34) {
      if (pk.kind === 'cash') { state.cash += pk.value; pushEvent(state, 'cash', { value: pk.value }); }
      else if (pk.kind === 'health') { state.health = Math.min(100, state.health + pk.value); pushEvent(state, 'pickup', { kind: 'health' }); }
      else { state.ammo += pk.value; pushEvent(state, 'pickup', { kind: 'ammo' }); }
      pk.t = -20; // respawn timer: hide for a while, then move
      pk.x = -9999; pk.y = -9999;
    }
  }
  // Respawn hidden pickups elsewhere, keeping the count steady.
  for (const pk of state.pickups) {
    if (pk.x < 0 && pk.t >= 0) {
      const rp = randomRoadPoint(state.random);
      pk.x = rp.x; pk.y = rp.y;
      pk.t = 0;
    }
  }
  while (state.pickups.length < PICKUP_TARGET) spawnPickup(state, state.random, false);
}

function stepMission(state, dt) {
  const m = state.mission;
  if (!m || state.over) return;
  const def = MISSIONS[m.index];
  const stage = def.stages[m.stage];
  if (!stage) return;
  const p = state.player;
  m.t += dt;

  if (stage.type === 'goto') {
    if (dist(p.x, p.y, stage.x, stage.y) < stage.r) {
      if (m.index === 5 && m.stage === 0) {
        // Grabbing the ledger brings two stars of heat at once.
        addWanted(state, 2, 'Stole the mayor\'s ledger');
      }
      completeStage(state);
    }
    return;
  }
  if (stage.type === 'enterCar') {
    if (p.car) completeStage(state);
    return;
  }
  if (stage.type === 'setWanted') {
    addWanted(state, stage.n, 'The precinct is rolling');
    completeStage(state);
    return;
  }
  if (stage.type === 'loseHeat') {
    if (state.wanted === 0) completeStage(state);
    return;
  }
  if (stage.type === 'hold') {
    if (dist(p.x, p.y, stage.x, stage.y) < stage.r) {
      m.hold += dt;
      if (m.hold >= stage.dur) completeStage(state);
    }
    return;
  }
  if (stage.type === 'photo') {
    const speed = p.car ? Math.abs(p.car.speed) : (p.moving ? 178 : 0);
    if (dist(p.x, p.y, stage.x, stage.y) < stage.r && speed < 30) {
      m.photo += dt;
      if (m.photo >= stage.dur) completeStage(state);
    } else {
      m.photo = Math.max(0, m.photo - dt * 0.5);
    }
    return;
  }
  if (stage.type === 'follow') {
    const c = state.courier;
    if (!c) { completeStage(state); return; }
    const arrived = dist(c.x, c.y, LANDMARKS.docks.x, LANDMARKS.docks.y) < 120;
    if (arrived && dist(p.x, p.y, c.x, c.y) < 380) completeStage(state);
    else if (arrived && dist(p.x, p.y, c.x, c.y) >= 380) {
      // The courier waits at the pier for the tail to catch up.
      c.speed = 0;
    }
    return;
  }
  if (stage.type === 'timed') {
    if (m.t >= stage.limit) {
      failMission(state, 'Out of time on the deliveries');
      return;
    }
    const stop = stage.stops[m.stopIndex];
    if (stop && dist(p.x, p.y, stop.x, stop.y) < 110) {
      m.stopIndex += 1;
      pushEvent(state, 'stopDone', { index: m.stopIndex });
      showBanner(state, `Stop ${m.stopIndex} of ${stage.stops.length} done`, 2.5);
      if (m.stopIndex >= stage.stops.length) completeStage(state);
    }
    return;
  }
  if (stage.type === 'combat') {
    if (state.guards.length === 0) completeStage(state);
  }
}

// Retry the current mission from the safehouse, keeping cash and progress.
export function retryMission(state) {
  const idx = state.missionIndex;
  state.wanted = 0;
  state.wantedTimer = 0;
  state.health = 100;
  state.over = null;
  state.missionFailed = false;
  state.police = [];
  state.roadblocks = [];
  state.guards = [];
  state.courier = null;
  if (state.player.car) {
    state.player.car.parked = true;
    state.player.car.speed = 0;
    state.player.car = null;
  }
  state.player.x = LANDMARKS.safehouse.x;
  state.player.y = LANDMARKS.safehouse.y + 60;
  state.player.angle = -Math.PI / 2;
  // Drop the courier's car too (capture it before clearing the reference).
  const oldCourier = state.courier;
  state.cars = state.cars.filter((c) => c !== oldCourier);
  startMission(state, idx);
}

// Screenshot scenes for ?shot=start|drive|chase|mission. Each one plays the
// real rules forward from a fresh world with a small autopilot — walking,
// stealing a car, driving the grid, running from the police — so every frame
// is a moment a real player could reach, and the same seed always gives the
// same frame. The autopilot reuses the game's own stuck-escape rules:
// a blocked driver re-plans its route, reverses out when it has not moved
// 8px in a second, shoves a blocking car after 2s, and a stuck pedestrian
// walks back to the nearest road point.
import { STEP, addWanted, clamp, footEscape, planRoute, driveAlongRoute, makeCar, missionTarget, resetWorld, startMission, stepGame } from './game.js';
import { SPOTS, nearestCrossing, nearestRoadPoint, randomCrossing } from './city.js';

function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

function fresh(g, hour) {
  resetWorld(g, g.random);
  g.cash = 200; g.health = 100; g.ammo = 24; g.wanted = 0; g.wantedTimer = 0;
  g.missionIndex = 0; g.mission = null; g.missionFailed = false; g.over = null;
  g.banner = ''; g.bannerT = 0; g.dialog = []; g.dialogT = 0;
  g.player.x = SPOTS.hideout.x; g.player.y = SPOTS.hideout.y + 60;
  g.player.angle = -Math.PI / 2; g.player.car = null; g.player.onFoot = true;
  g.clock = hour * 3600; g.events.length = 0;
  g.camX = clamp(g.player.x - 480, 0, 2400 - 960);
  g.camY = clamp(g.player.y - 320, 0, 1800 - 640);
}

// Drive the player's car toward a point with the shared driver brain.
function driveTo(g, target, dt, brain) {
  const car = g.player.car;
  if (!car) return true;
  if (!brain.route || brain.dest !== target) {
    planRoute(car, target);
    brain.dest = target; brain.route = car.route;
  }
  return driveAlongRoute(g, car, dt, 300);
}

// Walk the player toward a point; if stuck for a second, footEscape walks
// the road grid out of the jam.
function walkTo(g, target, dt, brain) {
  const p = g.player;
  const d = Math.hypot(target.x - p.x, target.y - p.y);
  if (d < 30) return true;
  const want = Math.atan2(target.y - p.y, target.x - p.x);
  p.angle = want;
  const input = { up: false, down: false, left: false, right: false, run: true, shoot: false, aimAngle: null, enterPressed: false };
  const dx = Math.cos(want), dy = Math.sin(want);
  input.right = dx > 0.3; input.left = dx < -0.3;
  input.down = dy > 0.3; input.up = dy < -0.3;
  stepGame(g, input, dt);
  footEscape(g, p, dt, brain.foot);
  return false;
}

function nearestCar(g, maxD) {
  // Prefer a parked car: it stays put while the player walks up to it.
  const parked = g.cars.filter((c) => c.kind === 'parked');
  const pool = parked.length ? parked : g.cars;
  let best = null; let bestD = maxD;
  for (const c of pool) {
    if (c.kind === 'police') continue;
    const d = Math.hypot(c.x - g.player.x, c.y - g.player.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function stealNearest(g, brain) {
  const car = nearestCar(g, 400);
  if (!car) return false;
  if (!brain.seeking) {
    brain.seeking = true;
    brain.foot = { t: 0, lx: g.player.x, ly: g.player.y };
  }
  if (Math.hypot(car.x - g.player.x, car.y - g.player.y) > 55) {
    walkTo(g, { x: car.x, y: car.y }, STEP, brain);
    return false;
  }
  stepGame(g, { up: false, down: false, left: false, right: false, run: false, shoot: false, aimAngle: null, enterPressed: true }, STEP);
  return !!g.player.car;
}

function runSeconds(g, seconds, fn) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) fn(STEP);
}

export function runShot(g, shot, sound) {
  const brain = { dest: null, route: null, seeking: false, foot: { t: 0, lx: 0, ly: 0 } };
  if (shot === 'start') {
    fresh(g, 19);
    g.state = 'title';
    // Let traffic roll behind the title for a living street scene.
    runSeconds(g, 5, (dt) => {
      const saved = g.state; g.state = 'play';
      stepGame(g, { up: false, down: false, left: false, right: false, run: false, shoot: false, aimAngle: null, enterPressed: false }, dt);
      g.state = saved;
    });
    g.state = 'title';
    g.player.x = SPOTS.hideout.x; g.player.y = SPOTS.hideout.y + 60;
    return;
  }
  if (shot === 'drive') {
    fresh(g, 10);
    startMission(g, 0);
    runSeconds(g, 26, (dt) => {
      if (!g.player.car) { stealNearest(g, brain); return; }
      driveTo(g, SPOTS.pierGate, dt, brain);
      stepGame(g, { up: true, down: false, left: false, right: false, run: false, shoot: false, aimAngle: null, enterPressed: false }, 0);
    });
    return;
  }
  if (shot === 'chase') {
    fresh(g, 21);
    startMission(g, 0);
    // Steal, then keep driving across town with the heat on — when one
    // destination is reached, pick the far end of town so the chase never
    // parks and the pursuing cruisers stay in frame.
    let chaseTarget = SPOTS.market;
    runSeconds(g, 30, (dt) => {
      if (!g.player.car) { stealNearest(g, brain); return; }
      if (g.wanted < 4) addWanted(g, 4 - g.wanted);
      if (driveTo(g, chaseTarget, dt, brain)) {
        chaseTarget = chaseTarget === SPOTS.market ? SPOTS.hideout : SPOTS.market;
        brain.dest = null;
      }
      stepGame(g, { up: false, down: false, left: false, right: false, run: false, shoot: false, aimAngle: null, enterPressed: false }, 0);
    });
    g.wanted = 4;
    g.banner = '4 stars — lose the cops!';
    g.bannerT = 3;
    return;
  }
  // mission
  fresh(g, 17);
  startMission(g, 2);
  runSeconds(g, 30, (dt) => {
    if (!g.player.car) { stealNearest(g, brain); return; }
    driveTo(g, SPOTS.bank, dt, brain);
    stepGame(g, { up: false, down: false, left: false, right: false, run: false, shoot: false, aimAngle: null, enterPressed: false }, 0);
  });
  g.dialog = ['Vex: The ledger page is in the bank vault room. In and out.', 'Rook: Alarms mean I run. You know the drill.'];
  g.dialogT = 6;
  g.banner = 'Mission 3/6: Bank Job';
  g.bannerT = 3;
}

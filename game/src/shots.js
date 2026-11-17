// The screenshot scenes behind ?shot=start|drive|chase|mission. Each one plays
// the real rules forward from a fresh world for a fixed number of seconds,
// steered by a small autopilot that walks, steals a car, drives the road grid
// and runs from the police exactly as a player would — so every frame is what
// a short game really looks like, and the same seed always gives the same frame.
import { STEP, missionTarget, resetWorld, startMission, stepGame } from './game.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { LANDMARKS, nearestIntersection, nearestRoadPoint, onRoad, randomIntersection } from './city.js';

const SAMPLE = STEP;
const START_SECONDS = 6;
const DRIVE_SECONDS = 24;
const CHASE_SECONDS = 16;
const MISSION_SECONDS = 30;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Fresh world, player at the safehouse, clock set for the scene's mood.
function freshScene(game, hour) {
  missionRoute.route = null;
  missionRoute.prev = null;
  carRoute.route = null;
  carRoute.prev = null;
  footTimer = 0;
  footCheck = 0;
  blockedTimer = 0;
  carTargetId = null;
  seekingCar = false;
  reversing = false;
  stuckTimer = 0;
  stuckCheck = 0;
  resetWorld(game, game.random);
  game.cash = 200;
  game.health = 100;
  game.ammo = 24;
  game.wanted = 0;
  game.wantedTimer = 0;
  game.missionIndex = 0;
  game.mission = null;
  game.missionFailed = false;
  game.over = null;
  game.banner = '';
  game.bannerT = 0;
  game.dialog = [];
  game.player.x = LANDMARKS.safehouse.x;
  game.player.y = LANDMARKS.safehouse.y + 60;
  game.player.angle = -Math.PI / 2;
  game.player.car = null;
  game.clock = hour * 3600;
  game.events.length = 0;
}

function nearestParkedCar(game, avoidBus) {
  const p = game.player;
  let best = null;
  let bestD = Infinity;
  // Prefer a car nobody is driving (parked, or the mission car) over
  // stealing one out from under its driver — the autopilot is showing the
  // city, not starting a crime spree.
  const candidates = game.cars.filter((c) => !(c.npc && c.driver));
  const pool = candidates.length ? candidates : game.cars;
  for (const car of pool) {
    if (avoidBus && car.type === 'bus') continue;
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  // If every nearby car is a bus, fall back to the nearest car of any kind.
  if (!best) {
    for (const car of pool) {
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bestD) { bestD = d; best = car; }
    }
  }
  return best ? { car: best, d: bestD } : null;
}

// The autopilot's route: a Manhattan path along the road grid to the target
// (nearest crossing, across, down, then in), rebuilt when the target moves.
// Driving straight at a target cuts across city blocks and scrapes building
// corners; the grid route keeps the car on tarmac.
// The car the autopilot is walking to: sticky, so it cannot ping-pong
// between two parked cars that keep swapping "nearest".
let carTargetId = null;

function carTarget(game, avoidBus) {
  const p = game.player;
  if (carTargetId !== null) {
    const kept = game.cars.find((c) => c.id === carTargetId);
    if (kept && Math.hypot(kept.x - p.x, kept.y - p.y) < 500) {
      return { car: kept, d: Math.hypot(kept.x - p.x, kept.y - p.y) };
    }
    carTargetId = null;
  }
  const found = nearestParkedCar(game, avoidBus);
  if (found) carTargetId = found.car.id;
  return found;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// A planned Manhattan route: legs to follow, plus the leg just left (the
// current leg runs prev -> legs[0]). The mission and the walk to fetch a car
// each keep their own, so planning one never clobbers the other.
function makeRouteState() { return { route: null, prev: null }; }
const missionRoute = makeRouteState();
const carRoute = makeRouteState();

function waypointForState(st, game, tx, ty) {
  const p = game.player;
  if (!st.route || Math.hypot(st.route.tx - tx, st.route.ty - ty) > 30) {
    const from = nearestIntersection(p.x, p.y);
    const to = nearestIntersection(tx, ty);
    st.route = { tx, ty, legs: [from, { x: to.x, y: from.y }, to, { x: tx, y: ty }] };
    st.prev = from;
  }
  while (st.route.legs.length > 1 && Math.hypot(st.route.legs[0].x - p.x, st.route.legs[0].y - p.y) < 70) {
    st.prev = st.route.legs[0];
    st.route.legs.shift();
  }
  // Off the planned path: the autopilot can enter a car far from the leg it
  // was meant to drive (or be shoved off it), and steering at that leg —
  // across a block corner — wedges the car on the road edge, flipping every
  // step between the route leg and the off-road recovery point. Re-plan the
  // Manhattan route from the nearest crossing instead, so the car just joins
  // the nearest road and drives the grid from there. Only the distance to
  // the leg being driven counts: a long leg's far end is hundreds of pixels
  // away even while the car is right on it.
  if (st.route.legs.length > 1 && st.prev) {
    const offLeg = distToSegment(p.x, p.y, st.prev.x, st.prev.y, st.route.legs[0].x, st.route.legs[0].y);
    const farFromLegEnd = Math.hypot(st.route.legs[0].x - p.x, st.route.legs[0].y - p.y);
    if (offLeg > 130 && farFromLegEnd > 240) {
      const from = nearestIntersection(p.x, p.y);
      const to = nearestIntersection(tx, ty);
      st.route = { tx, ty, legs: [from, { x: to.x, y: from.y }, to, { x: tx, y: ty }] };
      st.prev = from;
    }
  }
  return st.route.legs[0];
}

function waypointFor(game, tx, ty) {
  return waypointForState(missionRoute, game, tx, ty);
}

// Steer the player (on foot or driving) toward a point on the map, following
// the road grid. avoidBus keeps the autopilot out of the slow-turning buses,
// so the driving scenes show a car that actually moves. Exported for the
// headless autopilot simulation used in testing.

// Whether the autopilot has committed to walking to a car: once it decides
// to fetch a car it keeps going to that car, instead of flip-flopping
// between "walk to the car" and "walk to the waypoint" every time the
// mission target crosses the 320px line — that oscillation strands the
// player walking in place.
let seekingCar = false;

export // Stuck escape: a car can wedge nose-first on a pier crate or a building
// corner — full speed, no movement. The autopilot watches for that and
// backs out with a hard turn for a second to free itself.
let stuckTimer = 0;
let stuckCheck = 0;
let lastX = 0;
let lastY = 0;

// Same idea on foot: walking straight at a car can press the player against
// a building wall with no sideways component to slide along it. The escape
// walks to the nearest road point instead, to get around the corner.
let footTimer = 0;
let footCheck = 0;
let lastFootX = 0;
let lastFootY = 0;

// Whether the autopilot is mid-reversal: hysteresis around the turn-around
// threshold, so it cannot flip-flop between forward and reverse every few
// steps while the car is barely moving — that oscillation strands it.
let reversing = false;

// How long the autopilot has waited behind slow traffic: the "ease off"
// rule below and the traffic's own "brake for the player" rule can deadlock
// — each waits for the other, both at speed ~0, forever. After two seconds
// of waiting, drive on through at low speed instead: the game just pushes
// slow cars aside, with no crash at that speed.
let blockedTimer = 0;

export function driveToward(game, tx, ty, wantCar, avoidBus) {
  const p = game.player;
  const input = { mx: 0, my: 0, enter: false, melee: false, shoot: false, shootX: 0, shootY: 0 };
  let wp = waypointFor(game, tx, ty);
  if (p.car) {
    seekingCar = false;
    if (stuckTimer > 0) {
      stuckTimer -= 1;
      input.mx = 1;
      input.my = 1;
      return input;
    }
    stuckCheck += 1;
    if (stuckCheck >= 60) {
      stuckCheck = 0;
      // Stuck means "told to drive but not moving", not "moving fast": a car
      // wedged on a corner creeps at a few px/s, and a car in a traffic
      // deadlock sits at speed ~0 while each waits for the other — so the
      // old |speed| > 100 gate never fired and the escape never ran.
      if (Math.hypot(p.car.x - lastX, p.car.y - lastY) < 8) {
        stuckTimer = 70;
        // Drop the route too: the old legs were planned from where the car
        // was before it got wedged, and steering back at them is what cut
        // the corner into the pocket in the first place. The next plan
        // starts from where the car actually ends up.
        missionRoute.route = null;
        missionRoute.prev = null;
      }
      lastX = p.car.x;
      lastY = p.car.y;
    }
    // Shoved off the tarmac (a police ram can do that): head for the nearest
    // road first instead of grinding against a building.
    if (!onRoad(p.car.x, p.car.y)) wp = nearestRoadPoint(p.car.x, p.car.y);
    const car = p.car;
    const desired = Math.atan2(wp.y - car.y, wp.x - car.x);
    const diff = angleDiff(desired, car.angle);
    input.mx = clamp(diff * 2.2, -1, 1);
    // Ease off for slow traffic stopped right ahead instead of ramming it;
    // a car that is itself moving is no reason to stop.
    let blocked = false;
    const fx = car.x + Math.cos(car.angle) * 85;
    const fy = car.y + Math.sin(car.angle) * 85;
    for (const other of game.cars) {
      if (other === car) continue;
      if (Math.abs(other.speed) < 120 && Math.hypot(other.x - fx, other.y - fy) < 48) { blocked = true; break; }
    }
    // Facing away from the waypoint (a U-turn, e.g. leaving the pier):
    // brake and reverse to turn around instead of grinding forward into
    // whatever is ahead. Hysteresis: once reversing, keep reversing until
    // the car has turned well past the threshold.
    if (reversing) { if (Math.abs(diff) < 1.4) reversing = false; }
    else if (Math.abs(diff) > 2.6) reversing = true;
    blockedTimer = blocked ? blockedTimer + 1 : 0;
    input.my = blocked && blockedTimer <= 120 ? 0.3 : reversing ? 1 : -1;
    return input;
  }
  const near = carTarget(game, avoidBus);
  const targetD = Math.hypot(tx - p.x, ty - p.y);
  if (wantCar && near && near.d < 70) {
    input.enter = true;
    return input;
  }
  // On foot and not moving for a second while being told to walk: pressed
  // against a building wall. Step out to the nearest road point to get
  // around the corner, then resume the normal walk.
  if (footTimer > 0) {
    footTimer -= 1;
    const rp = nearestRoadPoint(p.x, p.y);
    const rx = Math.hypot(rp.x - p.x, rp.y - p.y) < 12 ? wp.x : rp.x;
    const ry = Math.hypot(rp.x - p.x, rp.y - p.y) < 12 ? wp.y : rp.y;
    const ang = Math.atan2(ry - p.y, rx - p.x);
    input.mx = Math.cos(ang);
    input.my = Math.sin(ang);
    return input;
  }
  footCheck += 1;
  if (footCheck >= 60) {
    footCheck = 0;
    if (Math.hypot(p.x - lastFootX, p.y - lastFootY) < 8) footTimer = 45;
    lastFootX = p.x;
    lastFootY = p.y;
  }
  if (wantCar && near && (seekingCar || targetD > 320)) {
    // Committed to fetching this car. Walk the road grid to it while it is
    // far away: walking straight at it cuts across blocks and presses the
    // player against a building wall with no way around. Close in, walk
    // straight at it — it is on the same stretch of road by then.
    seekingCar = true;
    let ang;
    if (near.d > 150) {
      const leg = waypointForState(carRoute, game, near.car.x, near.car.y);
      ang = Math.atan2(leg.y - p.y, leg.x - p.x);
    } else {
      ang = Math.atan2(near.car.y - p.y, near.car.x - p.x);
    }
    input.mx = Math.cos(ang);
    input.my = Math.sin(ang);
    return input;
  }
  seekingCar = false;
  const ang = Math.atan2(wp.y - p.y, wp.x - p.x);
  input.mx = Math.cos(ang);
  input.my = Math.sin(ang);
  return input;
}

// Drive away from the nearest police car, staying on the roads.
function fleeInput(game) {
  const p = game.player;
  let threat = null;
  let bestD = Infinity;
  for (const car of game.police) {
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestD) { bestD = d; threat = car; }
  }
  if (!p.car) {
    const near = nearestParkedCar(game);
    if (near && near.d < 70) return { mx: 0, my: 0, enter: true, melee: false, shoot: false, shootX: 0, shootY: 0 };
    if (near) return driveToward(game, near.car.x, near.car.y, false);
    return { mx: 0, my: 0, enter: false, melee: false, shoot: false, shootX: 0, shootY: 0 };
  }
  // Aim for the intersection farthest from the threat.
  const away = threat
    ? Math.atan2(p.y - threat.y, p.x - threat.x)
    : p.angle;
  const tx = p.x + Math.cos(away) * 600;
  const ty = p.y + Math.sin(away) * 600;
  const spot = nearestIntersection(tx, ty);
  return driveToward(game, spot.x, spot.y, false);
}

function runSeconds(game, seconds, pilot) {
  const steps = Math.round(seconds / SAMPLE);
  for (let i = 0; i < steps; i += 1) {
    if (game.over) break;
    stepGame(game, pilot(game), SAMPLE);
    game.events.length = 0;
  }
}

/**
 * Set `game` to the named scene (start, drive, chase or mission; anything else
 * is start) and return the screen to draw over it.
 */
export function stageShot(name, game) {
  if (name === 'drive') {
    freshScene(game, 10);
    startMission(game, 0);
    let target = { x: 2240, y: 300 };
    const pilot = (g) => {
      if (g.player.car && Math.hypot(target.x - g.player.x, target.y - g.player.y) < 130) {
        target = randomIntersection(g.random, target);
      }
      return driveToward(g, target.x, target.y, true, true);
    };
    runSeconds(game, DRIVE_SECONDS, pilot);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'chase') {
    freshScene(game, 21);
    startMission(game, 2);
    runSeconds(game, CHASE_SECONDS, fleeInput);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'mission') {
    freshScene(game, 8);
    startMission(game, 0);
    const pilot = (g) => {
      const target = missionTarget(g);
      if (!target) return { mx: 0, my: 0, enter: false, melee: false, shoot: false, shootX: 0, shootY: 0 };
      return driveToward(g, target.x, target.y, true, true);
    };
    runSeconds(game, MISSION_SECONDS, pilot);
    return { screen: SCREEN_PLAY };
  }
  // start: the title over a living city at dusk.
  freshScene(game, 17.5);
  runSeconds(game, START_SECONDS, () => ({ mx: 0, my: 0, enter: false, melee: false, shoot: false, shootX: 0, shootY: 0 }));
  return { screen: SCREEN_TITLE };
}

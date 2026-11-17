// Deterministic screenshot scenes behind ?shot=start|play|chase|mission.
// Each one plays the real rules forward from a fresh world, steered by a
// simple autopilot, so the frame is what a short game really looks like and
// the same seed always gives the same frame. Sets window.__shotReady.
import { STEP } from './game.js';
import { angleTo, angleDiff, dist, clamp } from './rng.js';
import { SPOTS, roadWaypoint } from './city.js';

// Drive the player's car toward a world point: full throttle, steer to the
// next road-grid waypoint, and ease off near a turn so it does not overshoot.
function driveToward(game, tx, ty) {
  const p = game.player;
  const car = p.car;
  if (!car) return { up: false, down: false, left: false, right: false };
  const wp = roadWaypoint(car.x, car.y, tx, ty);
  const want = angleTo(car.x, car.y, wp.x, wp.y);
  const d = angleDiff(car.angle, want);
  const speed = Math.abs(car.speed);
  const nearTurn = dist(car.x, car.y, wp.x, wp.y) < 170;
  return {
    up: (nearTurn ? speed < 220 : speed < 380) || Math.abs(d) < 0.6,
    down: false,
    left: d < -0.12,
    right: d > 0.12,
  };
}

// Walk toward a world point.
function walkToward(game, tx, ty) {
  const p = game.player;
  const want = angleTo(p.x, p.y, tx, ty);
  const dx = Math.cos(want);
  const dy = Math.sin(want);
  return {
    up: dy < -0.3, down: dy > 0.3, left: dx < -0.3, right: dx > 0.3,
  };
}

function tryEnter(game) {
  if (!game.player.car && game.nearestCar(70)) game.enterCar();
}

function stageStart(game) {
  // Title screen over a living city: traffic rolls for a few seconds.
  for (let i = 0; i < 5 / STEP; i++) game.step(STEP, {});
  game.screen = 'title';
  return 'title';
}

function stagePlay(game) {
  // Start the game, take the starter car by the pier, drive up the avenue.
  game.screen = 'play';
  game.enterCar();
  const target = { x: 1500, y: 800 };
  for (let i = 0; i < 14 / STEP; i++) {
    tryEnter(game);
    const input = game.player.car ? driveToward(game, target.x, target.y) : walkToward(game, 1500, 2260);
    game.step(STEP, input);
    if (game.player.car && dist(game.player.x, game.player.y, target.x, target.y) < 120) break;
  }
  return 'play';
}

function stageChase(game) {
  // Three stars, cruisers on the tail, driving hard across Downtown Neon.
  game.screen = 'play';
  game.enterCar();
  game.addWanted(3, 'Heat!');
  const target = { x: 2100, y: 1300 };
  for (let i = 0; i < 14 / STEP; i++) {
    tryEnter(game);
    const input = game.player.car ? driveToward(game, target.x, target.y) : walkToward(game, 1500, 2260);
    game.step(STEP, input);
    // Freeze the frame the moment a cruiser closes in on the player's car.
    const pcNear = game.police.some((pc) => dist(pc.x, pc.y, game.player.x, game.player.y) < 280);
    if (game.police.length >= 1 && pcNear && game.time > 5) break;
    if (dist(game.player.x, game.player.y, target.x, target.y) < 150) break;
  }
  return 'play';
}

function stageMission(game) {
  // Mission 6 in progress at dusk: the ledger is lifted, the courier is
  // being tailed to the marina, and the light is going down over the bay.
  game.screen = 'play';
  game.missionIdx = 5;
  game.missionStep = 1;
  game.missionWait = 0;
  game.clockMin = 18 * 60 + 20; // 18:20, dusk
  game.showDialogue('Vera Cross', 'Vera: "Ledger is in the bag. Tail the courier to the marina — don\'t lose him."');
  game.enterCar();
  const target = SPOTS.marina;
  for (let i = 0; i < 18 / STEP; i++) {
    tryEnter(game);
    const input = game.player.car ? driveToward(game, target.x, target.y) : walkToward(game, 1500, 2260);
    game.step(STEP, input);
    if (dist(game.player.x, game.player.y, target.x, target.y) < 260) break;
  }
  return 'play';
}

export function stageShot(name, game) {
  game.reset();
  // A fresh reset clears the save-based mission; force mission 1 for staging.
  game.missionIdx = 0;
  game.missionStep = 0;
  game.missionDone = false;
  game.storyComplete = false;
  game.player.cash = 120; // staged shots always show the opening bankroll
  let screen = 'title';
  if (name === 'play') screen = stagePlay(game);
  else if (name === 'chase') screen = stageChase(game);
  else if (name === 'mission') screen = stageMission(game);
  else screen = stageStart(game);
  game.screen = screen === 'title' ? 'title' : 'play';
  window.__shotReady = true;
  return screen;
}

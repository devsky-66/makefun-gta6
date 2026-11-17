// Boot and input for Cinder Bay. Fixed-step loop (1/60s), keyboard + mouse,
// title/pause/busted flow, autosave and the ?shot= screenshot scenes. The
// game exposes window.__game for headless checks.
import { createGame, startMission, retryMission, stepGame, loadSave, hasSave, STEP, SAVE_KEY } from './game.js';
import { render } from './render.js';
import { runShot } from './shots.js';
import { SoundBank } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 1);
const shot = params.get('shot');

const game = createGame(seed);
game.hasSave = hasSave();
const sound = new SoundBank();
window.__game = game;
window.__sound = sound;

const input = {
  up: false, down: false, left: false, right: false, run: false,
  shoot: false, aimAngle: null, enterPressed: false,
};

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

function aimFromMouse(e) {
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (canvas.width / r.width);
  const my = (e.clientY - r.top) * (canvas.height / r.height);
  input.aimAngle = Math.atan2(my - 320, mx - 480);
}

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  sound.ensure();
  const mapped = KEYMAP[e.code];
  if (mapped) input[mapped] = true;
  if (e.code === 'Space') { input.shoot = true; input.shootLatch = true; }
  if (e.code === 'KeyE' && !e.repeat) input.enterPressed = true;
  if (e.code === 'KeyM' && !e.repeat) { sound.setMuted(!sound.muted); }
  if (e.code === 'KeyP' && !e.repeat) {
    if (game.state === 'play') { game.state = 'pause'; sound.stopEngine(); sound.stopSiren(); }
    else if (game.state === 'pause') game.state = 'play';
  }
  if (e.code === 'KeyR' && !e.repeat && (game.state === 'busted' || game.state === 'wasted' || game.missionFailed)) retryMission(game);
  if (e.code === 'Enter' && !e.repeat) {
    if (game.state === 'title') beginGame(false);
    else if (game.state === 'busted' || game.state === 'wasted' || game.state === 'done') { game.state = 'title'; game.hasSave = hasSave(); }
  }
  if (e.code === 'KeyC' && !e.repeat && game.state === 'title' && hasSave()) beginGame(true);
});

window.addEventListener('keyup', (e) => {
  const mapped = KEYMAP[e.code];
  if (mapped) input[mapped] = false;
  if (e.code === 'Space') input.shoot = false;
});

canvas.addEventListener('mousemove', aimFromMouse);
canvas.addEventListener('mousedown', (e) => {
  sound.ensure();
  aimFromMouse(e);
  input.shoot = true;
  input.shootLatch = true;
  if (game.state === 'title') beginGame(false);
});
window.addEventListener('mouseup', () => { input.shoot = false; });

function beginGame(continueSave) {
  sound.ensure();
  game.state = 'play';
  if (continueSave) {
    const s = loadSave();
    if (s) {
      game.cash = s.cash; game.health = s.health; game.ammo = s.ammo;
      game.player.x = s.x; game.player.y = s.y;
      game.wanted = s.wanted || 0;
      game.missionIndex = s.missionIndex || 0;
    }
  } else {
    game.cash = 120; game.health = 100; game.ammo = 30;
    game.wanted = 0; game.missionIndex = 0;
  }
  game.mission = null;
  startMission(game, game.missionIndex);
  sound.blip();
}

let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game.state === 'play') {
    acc += dt;
    while (acc >= STEP) { stepGame(game, input, STEP); acc -= STEP; }
    // Engine + siren follow the live state.
    if (game.player.car) { sound.startEngine(); sound.setEngine(Math.abs(game.player.car.speed) / game.player.car.type.top); }
    else sound.stopEngine();
    if (game.wanted > 0) sound.startSiren(); else sound.stopSiren();
  }
  render(ctx, game, sound);
  requestAnimationFrame(frame);
}

if (shot) {
  // Screenshot mode: stage a scene from the real rules, then freeze on it.
  game.state = 'play';
  runShot(game, shot, sound);
  render(ctx, game, sound);
  window.__shotDone = true;
} else {
  requestAnimationFrame(frame);
}

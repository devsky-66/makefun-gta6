// Neon Bay boot: canvas, keyboard + mouse input, the fixed-step loop, menus,
// pause, save/continue and the ?shot= staging hook for screenshots.
import { Game, STEP, loadSave, MISSIONS } from './game.js';
import { drawWorld, drawHUD, drawMenu } from './render.js';
import { parseSeed } from './rng.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const seed = parseSeed(location.search);
const game = new Game(seed);
game._save = loadSave();
window.__game = game; // probe handle for play-testing
window.__shotReady = false;

let vw = 1280, vh = 720;
let camX = game.player.x, camY = game.player.y;

function resize() {
  vw = window.innerWidth; vh = window.innerHeight;
  canvas.width = vw; canvas.height = vh;
}
window.addEventListener('resize', resize);
resize();

const keys = {};
const input = { up: false, down: false, left: false, right: false, enterPressed: false, punchPressed: false, shootPressed: false, aim: null };
let mouseWorld = null;

function keyDown(e) {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys[e.key.toLowerCase()] = true;
  game.sounds.ensure();
  if (e.key === 'm' || e.key === 'M') {
    const muted = game.sounds.toggleMute();
    game.showToast(muted ? 'Sound muted' : 'Sound on');
  }
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (game.screen === 'play') { game.screen = 'pause'; game.save(); }
    else if (game.screen === 'pause') game.screen = 'play';
  }
  if (e.key === ' ') {
    if (game.screen === 'title') startGame(false);
    else if (game.screen === 'over') retryAfterOver();
    else if (game.screen === 'play') input.punchPressed = true;
  }
  if ((e.key === 'e' || e.key === 'E') && game.screen === 'play') input.enterPressed = true;
  if ((e.key === 'c' || e.key === 'C') && game.screen === 'title' && game._save) startGame(true);
  if ((e.key === 'r' || e.key === 'R') && game.screen === 'pause') {
    game.screen = 'play';
    game.failMission('Mission restarted');
  }
}
function keyUp(e) { keys[e.key.toLowerCase()] = false; }
window.addEventListener('keydown', keyDown);
window.addEventListener('keyup', keyUp);

canvas.addEventListener('mousemove', (e) => {
  const view = currentView();
  mouseWorld = {
    x: view.camX + (e.clientX - vw / 2) / view.scale,
    y: view.camY + (e.clientY - vh / 2) / view.scale,
  };
});
canvas.addEventListener('mousedown', (e) => {
  game.sounds.ensure();
  const view = currentView();
  mouseWorld = {
    x: view.camX + (e.clientX - vw / 2) / view.scale,
    y: view.camY + (e.clientY - vh / 2) / view.scale,
  };
  if (game.screen === 'title') { startGame(false); return; }
  if (game.screen === 'over') { retryAfterOver(); return; }
  if (game.screen !== 'play') return;
  input.shootPressed = true;
  input.aim = mouseWorld;
  // Fire once right away: a fast click may end before the next frame sees it.
  if (!game.player.car && mouseWorld) game.shootAt(mouseWorld.x, mouseWorld.y);
});
window.addEventListener('mouseup', () => { input.shootPressed = false; });

function startGame(continueSave) {
  if (!continueSave) {
    try { localStorage.removeItem('neon-bay-save-v1'); } catch { /* ignore */ }
    game.reset();
    game._save = null;
  } else {
    game.reset();
  }
  game.screen = 'play';
  game.showToast('Mission ' + (game.missionIdx + 1) + ': ' + MISSIONS[game.missionIdx].title);
  if (game.currentMission()) game.showDialogue(game.currentMission().client, game.currentMission().intro);
}

function retryAfterOver() {
  const p = game.player;
  p.dead = false; p.busted = false; p.hp = 100; p.bustedTimer = 0;
  p.wanted = 0;
  game.police.length = 0;
  game.exitCar(true);
  p.x = 900; p.y = 330; // outside St. Marina Hospital
  game.screen = 'play';
  game.save();
}

function readInput() {
  input.up = !!(keys['w'] || keys['arrowup']);
  input.down = !!(keys['s'] || keys['arrowdown']);
  input.left = !!(keys['a'] || keys['arrowleft']);
  input.right = !!(keys['d'] || keys['arrowright']);
  if (input.shootPressed) input.aim = mouseWorld;
  return input;
}

function currentView() {
  const scale = Math.max(vw / 1150, vh / 660);
  return { camX, camY, scale, vw, vh };
}

function render() {
  const view = currentView();
  game._view = view;
  ctx.fillStyle = '#11141b';
  ctx.fillRect(0, 0, vw, vh);
  drawWorld(ctx, game, view);
  if (game.screen === 'play' || game.screen === 'pause') drawHUD(ctx, game, vw, vh);
  if (game.screen === 'title') drawMenu(ctx, game, vw, vh, 'title');
  if (game.screen === 'pause') drawMenu(ctx, game, vw, vh, 'pause');
  if (game.screen === 'over') drawMenu(ctx, game, vw, vh, 'over');
  statusEl.textContent = game.screen === 'play'
    ? 'Playing Neon Bay. Cash $' + Math.floor(game.player.cash) + ', wanted ' + game.player.wanted + ' stars, mission ' + (game.missionIdx + 1) + ' of ' + MISSIONS.length
    : 'Neon Bay menu: ' + game.screen;
}

let acc = 0;
let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let guard = 0;
  while (acc >= STEP && guard < 8) {
    const inp = readInput();
    game.step(STEP, inp);
    input.enterPressed = false;
    input.punchPressed = false;
    acc -= STEP;
    guard++;
  }
  // Camera eases toward the player.
  camX += (game.player.x - camX) * 0.12;
  camY += (game.player.y - camY) * 0.12;
  render();
  requestAnimationFrame(loop);
}

// Screenshot staging: ?shot=start|play|chase|mission&seed=N
const shotMatch = /[?&]shot=([a-z]+)/.exec(location.search);
if (shotMatch) {
  stageShot(shotMatch[1], game);
  camX = game.player.x; camY = game.player.y;
  render();
} else {
  requestAnimationFrame(loop);
}

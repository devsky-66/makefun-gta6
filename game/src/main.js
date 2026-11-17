// Boot and the one loop for Neon Bay Nights. Input is read every frame, the
// world advances in fixed 1/60 s steps, and the renderer paints what is there.
// Screens: title, play, paused, busted/wasted. Progress (cash, mission,
// records) lives in localStorage; ?seed=N fixes the city; ?shot=start|drive|
// chase|mission stages a scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.
import { createRandom } from './rng.js';
import {
  STEP, SAVE_KEY, createGame, currentMission, resetWorld, retryMission,
  startMission, stepGame,
} from './game.js';
import { WORLD } from './city.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const VIEW_W = 1280;
const VIEW_H = 720;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const game = createGame(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

// Debug handle for automated checks, in both game and shot modes: the state
// and the screen, read-only from outside. The game itself never reads this.
window.__neon = { game, get screen() { return window.__neonScreen || 'title'; } };
window.__game = game;

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return data;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: game.cash,
      missionIndex: game.missionIndex,
      bestCash: game.bestCash,
      missionsDone: game.missionsDone,
      muted: audio.isMuted(),
    }));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

function applySave(save) {
  if (!save) return;
  if (Number.isFinite(save.cash)) game.cash = save.cash;
  if (Number.isFinite(save.bestCash)) game.bestCash = save.bestCash;
  if (Number.isFinite(save.missionsDone)) game.missionsDone = save.missionsDone;
  if (Number.isFinite(save.missionIndex)) game.missionIndex = Math.max(0, Math.min(5, save.missionIndex));
  if (save.muted) audio.setMuted(true);
}

function runShot(name) {
  const scene = stageShot(name, game);
  window.__neonScreen = scene.screen;
  let painted = 0;
  function paint() {
    renderer.draw(game, scene.screen, readSave());
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const keys = new Set();
  const input = { mx: 0, my: 0, enter: false, melee: false, shoot: false, shootX: 0, shootY: 0 };
  let screen = SCREEN_TITLE;
  let save = readSave();
  if (save) applySave(save);
  let saveTimer = 0;

  // Debug handle for automated checks: the state and the screen, read-only
  // from outside. The game itself never reads this.
  window.__neon = {
    game,
    get screen() { return screen; },
    get save() { return readSave(); },
  };
  window.__game = game;

  function announce(message) {
    status.textContent = message;
  }

  function refreshInput() {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const up = keys.has('ArrowUp') || keys.has('KeyW');
    const down = keys.has('ArrowDown') || keys.has('KeyS');
    input.mx = (right ? 1 : 0) - (left ? 1 : 0);
    input.my = (down ? 1 : 0) - (up ? 1 : 0);
  }

  function startNewGame() {
    resetWorld(game, game.random);
    game.cash = 200;
    game.health = 100;
    game.ammo = 24;
    game.wanted = 0;
    game.missionIndex = 0;
    game.missionsDone = 0;
    game.bestCash = 0;
    game.over = null;
    game.player.x = 800;
    game.player.y = 1160;
    game.player.car = null;
    game.player.angle = -Math.PI / 2;
    startMission(game, 0);
    screen = SCREEN_PLAY;
    writeSave();
    announce('Playing. Mission 1: Dockside Pickup.');
  }

  function continueGame() {
    const s = readSave();
    resetWorld(game, game.random);
    game.health = 100;
    game.ammo = 24;
    game.wanted = 0;
    game.over = null;
    game.player.x = 800;
    game.player.y = 1160;
    game.player.car = null;
    game.player.angle = -Math.PI / 2;
    if (s) applySave(s);
    startMission(game, game.missionIndex);
    screen = SCREEN_PLAY;
    announce(`Continuing. Mission ${game.missionIndex + 1}.`);
  }

  function endGame() {
    screen = SCREEN_OVER;
    writeSave();
    announce(game.over === 'busted' ? 'Busted. Press Enter to try again.' : 'Wasted. Press Enter to try again.');
  }

  function respawn() {
    retryMission(game);
    screen = SCREEN_PLAY;
    announce('Back on the streets.');
  }

  window.addEventListener('keydown', (event) => {
    audio.unlock();
    audio.resume();
    if (event.code === 'KeyM' && !event.repeat) {
      audio.setMuted(!audio.isMuted());
      writeSave();
      return;
    }
    if (event.code === 'KeyP' || event.code === 'Escape') {
      if (!event.repeat) {
        if (screen === SCREEN_PLAY) { screen = SCREEN_PAUSED; announce('Paused.'); }
        else if (screen === SCREEN_PAUSED) { screen = SCREEN_PLAY; announce('Playing.'); }
      }
      event.preventDefault();
      return;
    }
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      if (!event.repeat) {
        if (screen === SCREEN_TITLE) startNewGame();
        else if (screen === SCREEN_OVER) respawn();
        else if (screen === SCREEN_PAUSED) { screen = SCREEN_PLAY; announce('Playing.'); }
      }
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyC' && !event.repeat && screen === SCREEN_TITLE && readSave()) {
      continueGame();
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyR' && !event.repeat && game.missionFailed && screen === SCREEN_PLAY) {
      retryMission(game);
      announce('Mission restarted.');
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyE' && !event.repeat && screen === SCREEN_PLAY) input.enter = true;
    if (event.code === 'Space' && !event.repeat && screen === SCREEN_PLAY) input.melee = true;
    keys.add(event.code);
    refreshInput();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
    refreshInput();
  });
  window.addEventListener('blur', () => {
    keys.clear();
    refreshInput();
  });
  canvas.addEventListener('pointerdown', (event) => {
    audio.unlock();
    audio.resume();
    if (screen === SCREEN_TITLE) { startNewGame(); return; }
    if (screen === SCREEN_OVER) { respawn(); return; }
    if (screen !== SCREEN_PLAY) return;
    // Convert the click to world coordinates using the same camera the
    // renderer uses: centred on the player, clamped to the city.
    const rectBox = canvas.getBoundingClientRect();
    const scale = Math.min(rectBox.width / VIEW_W, rectBox.height / VIEW_H);
    const viewX = (rectBox.width - VIEW_W * scale) / 2;
    const viewY = (rectBox.height - VIEW_H * scale) / 2;
    const lx = (event.clientX - rectBox.left - viewX) / scale;
    const ly = (event.clientY - rectBox.top - viewY) / scale;
    const camX = Math.max(0, Math.min(WORLD.width - VIEW_W, game.player.x - VIEW_W / 2));
    const camY = Math.max(0, Math.min(WORLD.height - VIEW_H, game.player.y - VIEW_H / 2));
    input.shootX = camX + lx;
    input.shootY = camY + ly;
    input.shoot = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      writeSave();
      announce('Paused.');
    }
  });

  let accumulator = 0;
  let last = performance.now();

  function drainEvents() {
    let nearestPolice = Infinity;
    for (const car of game.police) {
      const d = Math.hypot(car.x - game.player.x, car.y - game.player.y);
      if (d < nearestPolice) nearestPolice = d;
    }
    const siren = nearestPolice === Infinity ? 0 : Math.max(0, 1 - nearestPolice / 900);
    const driving = !!game.player.car;
    const speedRatio = driving ? Math.abs(game.player.car.speed) / 505 : 0;
    audio.update(driving, speedRatio, siren);
    for (const ev of game.events) {
      if (ev.type === 'shoot') audio.shoot();
      else if (ev.type === 'melee') audio.melee();
      else if (ev.type === 'pickup') audio.pickup();
      else if (ev.type === 'cash') audio.cash();
      else if (ev.type === 'crash') audio.crash(ev.strength || 0.3);
      else if (ev.type === 'missionDone') audio.missionDone();
      else if (ev.type === 'missionFail') audio.missionFail();
      else if (ev.type === 'busted' || ev.type === 'wasted') audio.busted();
      else if (ev.type === 'policeSpawn') audio.sirenBlip();
      else if (ev.type === 'hurt') audio.crash(0.25);
    }
    game.events.length = 0;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP) {
        if (screen === SCREEN_TITLE) {
          // The city lives behind the menu.
          stepGame(game, { mx: 0, my: 0, enter: false, melee: false, shoot: false, shootX: 0, shootY: 0 }, STEP);
          game.events.length = 0;
        } else {
          stepGame(game, input, STEP);
          input.enter = false;
          input.melee = false;
          input.shoot = false;
          drainEvents();
          if (game.over) { endGame(); break; }
        }
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    saveTimer += 1;
    if (saveTimer >= 300 && screen === SCREEN_PLAY) {
      saveTimer = 0;
      writeSave();
    }
    renderer.draw(game, screen, save);
    if (currentMission(game) === null && game.missionIndex >= 6) {
      // Story finished: keep the city alive as a free roam.
    }
  }

  announce('Neon Bay Nights. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();

// Neon Bay Nights — drawing only. The world state and the current screen go in,
// pixels come out. A 1280x720 logical view follows the player across the city
// and scales to the window; the HUD, the minimap and every menu are drawn here
// too, so the whole game is one canvas and no DOM.
import { AVENUES, LANDMARKS, ROAD_WIDTH, STREETS, WALK_WIDTH, WORLD } from './city.js';
import { MISSIONS, missionTarget } from './game.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const VIEW = { width: 1280, height: 720 };
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const SKY = {
  day: '#7fb2d9', dusk: '#e08a4f', night: '#0d1526', dawn: '#c98a6a',
};
const GROUND = {
  day: '#5d8a4f', dusk: '#6a6a44', night: '#16241a', dawn: '#5d5a44',
};

function starRow(count) {
  let s = '';
  for (let i = 0; i < 5; i += 1) s += i < count ? '★' : '☆';
  return s;
}

function clockText(clockSeconds) {
  const total = Math.floor(clockSeconds / 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0, camX: 0, camY: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * ratio);
    const h = Math.round(window.innerHeight * ratio);
    canvas.width = w;
    canvas.height = h;
    view.scale = Math.min(w / VIEW.width, h / VIEW.height);
    view.x = (w - VIEW.width * view.scale) / 2;
    view.y = (h - VIEW.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, weight) {
    const key = `${size}:${weight || ''}`;
    if (!fonts.has(key)) fonts.set(key, `${weight ? 'bold ' : ''}${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function circle(x, y, r, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }

  function rect(x, y, w, h, color) {
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
  }

  function drawCity(state) {
    const city = state.city;
    const phase = state.dayPhase;
    rect(0, 0, WORLD.width, WORLD.height, GROUND[phase]);
    // The pier boards.
    rect(city.pier.x, city.pier.y, city.pier.w, city.pier.h, '#6a4a2f');
    context.strokeStyle = '#54371f';
    context.lineWidth = 2;
    for (let x = city.pier.x + 20; x < city.pier.x + city.pier.w; x += 28) {
      context.beginPath();
      context.moveTo(x, city.pier.y);
      context.lineTo(x, city.pier.y + city.pier.h);
      context.stroke();
    }
    // Parks.
    for (const park of city.parks) {
      rect(park.x, park.y, park.w, park.h, phase === 'night' ? '#14261a' : '#4a7a3f');
      context.strokeStyle = phase === 'night' ? '#2a4a30' : '#3a6a35';
      context.lineWidth = 3;
      context.strokeRect(park.x, park.y, park.w, park.h);
    }
    // Pavements around every road, painted as wide strips first with the
    // tarmac on top.
    context.fillStyle = phase === 'night' ? '#4a4f57' : '#a8adb5';
    for (const ax of AVENUES) rect(ax - ROAD_WIDTH / 2 - WALK_WIDTH, 0, ROAD_WIDTH + WALK_WIDTH * 2, WORLD.height, phase === 'night' ? '#4a4f57' : '#a8adb5');
    for (const sy of STREETS) rect(0, sy - ROAD_WIDTH / 2 - WALK_WIDTH, WORLD.width, ROAD_WIDTH + WALK_WIDTH * 2, phase === 'night' ? '#4a4f57' : '#a8adb5');
    // Tarmac.
    context.fillStyle = phase === 'night' ? '#23262c' : '#3c4048';
    for (const ax of AVENUES) rect(ax - ROAD_WIDTH / 2, 0, ROAD_WIDTH, WORLD.height, phase === 'night' ? '#23262c' : '#3c4048');
    for (const sy of STREETS) rect(0, sy - ROAD_WIDTH / 2, WORLD.width, ROAD_WIDTH, phase === 'night' ? '#23262c' : '#3c4048');
    // Centre dashes.
    context.fillStyle = phase === 'night' ? '#8a7a3a' : '#e8d44f';
    for (const ax of AVENUES) {
      for (let y = 40; y < WORLD.height; y += 64) rect(ax - 3, y, 6, 30, phase === 'night' ? '#8a7a3a' : '#e8d44f');
    }
    for (const sy of STREETS) {
      for (let x = 40; x < WORLD.width; x += 64) rect(x, sy - 3, 30, 6, phase === 'night' ? '#8a7a3a' : '#e8d44f');
    }
    // Buildings with roofs, windows and a little height shading.
    for (const b of city.buildings) {
      rect(b.x, b.y, b.w, b.h, b.color);
      context.fillStyle = b.roof;
      context.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
      if (b.windows) {
        context.fillStyle = phase === 'night' ? '#ffd76a' : '#bcd6e8';
        const cols = Math.max(1, Math.floor(b.w / 34));
        const rows = Math.max(1, Math.floor(b.h / 34));
        for (let c = 0; c < cols; c += 1) {
          for (let r = 0; r < rows; r += 1) {
            if ((c * 7 + r * 3 + b.height) % 3 === 0) continue;
            context.fillRect(b.x + 12 + c * 34, b.y + 12 + r * 34, 14, 10);
          }
        }
      }
      context.strokeStyle = 'rgba(0,0,0,0.35)';
      context.lineWidth = 2;
      context.strokeRect(b.x, b.y, b.w, b.h);
    }
    // Crates on the pier.
    for (const c of city.crates) {
      rect(c.x, c.y, c.s, c.s, '#8a6a3f');
      context.strokeStyle = '#5d4526';
      context.lineWidth = 2;
      context.strokeRect(c.x, c.y, c.s, c.s);
    }
    // Trees.
    for (const t of city.trees) {
      circle(t.x, t.y, t.r, phase === 'night' ? '#1d3a24' : '#2f7a3a');
      circle(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, phase === 'night' ? '#26502e' : '#3f9a4a');
    }
    // Street lamps; at night they glow.
    for (const lamp of city.lamps) {
      if (phase === 'night' || phase === 'dusk') {
        const glow = context.createRadialGradient(lamp.x, lamp.y, 2, lamp.x, lamp.y, 46);
        glow.addColorStop(0, 'rgba(255, 214, 106, 0.5)');
        glow.addColorStop(1, 'rgba(255, 214, 106, 0)');
        context.fillStyle = glow;
        context.beginPath();
        context.arc(lamp.x, lamp.y, 46, 0, Math.PI * 2);
        context.fill();
      }
      circle(lamp.x, lamp.y, 4, '#2c2c2c');
      circle(lamp.x, lamp.y, 2.5, phase === 'night' ? '#ffd76a' : '#c9c9c9');
    }
    // Landmark signs: short labels that fit inside the marker circle.
    drawLandmark(state, LANDMARKS.docks.x, LANDMARKS.docks.y, 'DOCKS', '#3f7ec9');
    drawLandmark(state, LANDMARKS.bank.x, LANDMARKS.bank.y, 'BANK', '#c9a44f');
    drawLandmark(state, LANDMARKS.cityHall.x, LANDMARKS.cityHall.y, 'HALL', '#9a5fc9');
    drawLandmark(state, LANDMARKS.safehouse.x, LANDMARKS.safehouse.y, 'HOME', '#4f9a5f');
    drawLandmark(state, LANDMARKS.market.x, LANDMARKS.market.y, 'MARKET', '#d97b3f');
  }

  function drawLandmark(state, x, y, label, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 26, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(x, y, 26, 0, Math.PI * 2);
    context.stroke();
    text(label, x, y + 4, 10, '#ffffff', 'center', true);
  }

  function drawCar(state, car) {
    const specW = car.type === 'bus' ? 100 : car.type === 'bike' ? 46 : 66;
    const specH = car.type === 'bus' ? 34 : car.type === 'bike' ? 18 : 30;
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle);
    // Headlight cones at night.
    if (state.dayPhase === 'night' && Math.abs(car.speed) > 5) {
      const beam = context.createRadialGradient(specW / 2, 0, 4, specW / 2 + 90, 0, 130);
      beam.addColorStop(0, 'rgba(255, 240, 180, 0.35)');
      beam.addColorStop(1, 'rgba(255, 240, 180, 0)');
      context.fillStyle = beam;
      context.beginPath();
      context.moveTo(specW / 2, -14);
      context.lineTo(specW / 2 + 120, -42);
      context.lineTo(specW / 2 + 120, 42);
      context.lineTo(specW / 2, 14);
      context.closePath();
      context.fill();
    }
    // Body.
    context.fillStyle = car.color;
    context.beginPath();
    context.roundRect(-specW / 2, -specH / 2, specW, specH, 8);
    context.fill();
    // Cabin / windshield.
    context.fillStyle = 'rgba(20, 30, 44, 0.85)';
    if (car.type === 'bike') {
      context.beginPath();
      context.arc(4, 0, 6, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillRect(-specW * 0.08, -specH / 2 + 4, specW * 0.34, specH - 8);
    }
    // Police livery and light bar.
    if (car.type === 'police') {
      context.fillStyle = '#e8e8e8';
      context.fillRect(-specW / 2 + 6, -specH / 2 + 3, specW - 12, 5);
      const red = Math.floor(car.flash) % 2 === 0;
      context.fillStyle = red ? '#ff2e2e' : '#2e6bff';
      context.fillRect(-6, -specH / 2 - 2, 12, 6);
      context.fillStyle = red ? '#2e6bff' : '#ff2e2e';
      context.fillRect(-6, specH / 2 - 4, 12, 6);
    }
    if (car.missionCar) {
      context.strokeStyle = '#ffd76a';
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(-specW / 2 - 3, -specH / 2 - 3, specW + 6, specH + 6, 10);
      context.stroke();
    }
    context.restore();
    // Brake lights.
    if (car.speed < -5) {
      context.save();
      context.translate(car.x, car.y);
      context.rotate(car.angle);
      context.fillStyle = '#ff3b30';
      context.fillRect(-specW / 2 - 2, -specH / 2 + 4, 4, 6);
      context.fillRect(-specW / 2 - 2, specH / 2 - 10, 4, 6);
      context.restore();
    }
  }

  function drawPed(state, ped) {
    if (ped.down > 0) {
      // Knocked flat: a lying figure.
      context.save();
      context.translate(ped.x, ped.y);
      context.rotate(ped.angle);
      context.fillStyle = ped.shirt;
      context.fillRect(-14, -5, 28, 10);
      circle(16, 0, 6, ped.skin);
      context.restore();
      return;
    }
    const swing = Math.sin(ped.phase) * 5;
    context.save();
    context.translate(ped.x, ped.y);
    context.rotate(ped.angle);
    // Legs mid-stride.
    context.strokeStyle = '#2c2c34';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-6 + swing, 5);
    context.moveTo(0, 0);
    context.lineTo(-6 - swing, -5);
    context.stroke();
    // Body and head.
    context.fillStyle = ped.shirt;
    context.beginPath();
    context.arc(0, 0, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = ped.skin;
    context.beginPath();
    context.arc(11, 0, 6, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawPlayer(state) {
    const p = state.player;
    if (p.car) return; // the car drawing carries the player
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return; // hurt blink
    const swing = p.moving ? Math.sin(p.walkPhase) * 6 : 0;
    context.save();
    context.translate(p.x, p.y);
    context.rotate(p.angle);
    context.strokeStyle = '#20242e';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-2, 0);
    context.lineTo(-10 + swing, 6);
    context.moveTo(-2, 0);
    context.lineTo(-10 - swing, -6);
    context.stroke();
    // Jacket and head.
    context.fillStyle = '#e8b23f';
    context.beginPath();
    context.arc(0, 0, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f0c8a0';
    context.beginPath();
    context.arc(13, 0, 7, 0, Math.PI * 2);
    context.fill();
    // A gun in hand when there is ammo to spend.
    if (state.ammo > 0) {
      context.fillStyle = '#22242a';
      context.fillRect(8, -2, 14, 4);
    }
    context.restore();
    // Melee swing arc.
    if (p.meleeCd > 0.25) {
      context.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(p.x, p.y, 44, p.angle - 0.9, p.angle + 0.9);
      context.stroke();
    }
  }

  function drawPickups(state) {
    for (const pk of state.pickups) {
      if (pk.x < 0) continue;
      const bob = Math.sin(state.time * 3 + pk.x) * 3;
      if (pk.kind === 'cash') {
        rect(pk.x - 11, pk.y - 7 + bob, 22, 14, '#3fae5a');
        text('$', pk.x, pk.y + 4 + bob, 13, '#ffffff', 'center', true);
      } else if (pk.kind === 'health') {
        circle(pk.x, pk.y + bob, 12, '#e8e8e8');
        rect(pk.x - 2.5, pk.y - 8 + bob, 5, 16, '#d92e2e');
        rect(pk.x - 8, pk.y - 2.5 + bob, 16, 5, '#d92e2e');
      } else {
        rect(pk.x - 9, pk.y - 6 + bob, 18, 12, '#c9a44f');
        for (let i = 0; i < 3; i += 1) rect(pk.x - 7 + i * 6, pk.y - 4 + bob, 3, 9, '#8a6d1f');
      }
    }
  }

  function drawGuards(state) {
    for (const g of state.guards) {
      context.save();
      context.translate(g.x, g.y);
      context.rotate(g.angle);
      context.fillStyle = '#5a2e6e';
      context.beginPath();
      context.arc(0, 0, 12, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#f0c8a0';
      context.beginPath();
      context.arc(13, 0, 7, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#22242a';
      context.fillRect(8, -2, 16, 4);
      context.restore();
      // Health bar.
      rect(g.x - 16, g.y - 26, 32, 5, '#333333');
      rect(g.x - 16, g.y - 26, 32 * Math.max(0, g.hp / 60), 5, '#d92e2e');
    }
  }

  function drawRoadblocks(state) {
    for (const rb of state.roadblocks) {
      context.save();
      context.translate(rb.x, rb.y);
      context.rotate(rb.angle + Math.PI / 2);
      for (let i = -1; i <= 1; i += 1) {
        rect(i * 34 - 15, -10, 30, 20, i % 2 === 0 ? '#ff7a1a' : '#e8e8e8');
      }
      context.fillStyle = '#ff2e2e';
      circle(-40, 0, 5, '#ff2e2e');
      circle(40, 0, 5, '#ff2e2e');
      context.restore();
    }
  }

  function drawMissionMarker(state) {
    const target = missionTarget(state);
    if (!target) return;
    const pulse = 1 + Math.sin(state.time * 4) * 0.12;
    context.save();
    context.translate(target.x, target.y);
    context.scale(pulse, pulse);
    context.strokeStyle = '#ffd76a';
    context.lineWidth = 4;
    context.beginPath();
    context.arc(0, 0, 30, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#ffd76a';
    context.beginPath();
    context.moveTo(0, -44);
    context.lineTo(-10, -24);
    context.lineTo(10, -24);
    context.closePath();
    context.fill();
    context.restore();
    // Off-screen direction arrow at the view edge.
    const p = state.player;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 420) {
      const ang = Math.atan2(dy, dx);
      const ax = p.x + Math.cos(ang) * 300;
      const ay = p.y + Math.sin(ang) * 300;
      context.save();
      context.translate(ax, ay);
      context.rotate(ang);
      context.fillStyle = '#ffd76a';
      context.beginPath();
      context.moveTo(22, 0);
      context.lineTo(-12, -14);
      context.lineTo(-12, 14);
      context.closePath();
      context.fill();
      context.restore();
      text(`${Math.round(d)}m`, ax, ay - 22, 15, '#ffd76a', 'center', true);
    }
  }

  function drawLighting(state) {
    if (state.dayPhase === 'day') return;
    const alpha = state.dayPhase === 'night' ? 0.5 : state.dayPhase === 'dusk' ? 0.28 : 0.22;
    const color = state.dayPhase === 'dusk' ? 'rgba(224, 110, 60, ALPHA)' : 'rgba(8, 14, 34, ALPHA)';
    context.fillStyle = color.replace('ALPHA', String(alpha));
    context.fillRect(view.camX - 40, view.camY - 40, VIEW.width + 80, VIEW.height + 80);
    // A pool of light around the player at night.
    if (state.dayPhase === 'night') {
      const glow = context.createRadialGradient(state.player.x, state.player.y, 40, state.player.x, state.player.y, 260);
      glow.addColorStop(0, 'rgba(255, 220, 140, 0.14)');
      glow.addColorStop(1, 'rgba(255, 220, 140, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(state.player.x, state.player.y, 260, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawHud(state, screen) {
    const p = state.player;
    // Top bar.
    context.fillStyle = 'rgba(10, 12, 18, 0.72)';
    context.fillRect(0, 0, VIEW.width, 52);
    text(`$${state.cash.toLocaleString('en-US')}`, 18, 34, 26, '#7ee787', 'left', true);
    text(starRow(state.wanted), 240, 34, 26, state.wanted > 0 ? '#ff5a4f' : '#8b93a3', 'left', true);
    // Health bar.
    rect(430, 16, 180, 20, '#333a44');
    rect(430, 16, 180 * Math.max(0, state.health / 100), 20, state.health > 50 ? '#4fd97e' : state.health > 25 ? '#e8c44f' : '#ff5a4f');
    text('HP', 405, 33, 16, '#eef1f5', 'right', true);
    text(`Ammo ${state.ammo}`, 640, 34, 22, '#ffd76a', 'left', true);
    // Clock and day/night icon.
    const icon = state.dayPhase === 'day' ? '☀' : state.dayPhase === 'night' ? '☾' : '◐';
    text(`${icon} ${clockText(state.clock)}`, VIEW.width - 18, 34, 24, '#eef1f5', 'right', true);
    // Speed when driving.
    if (p.car) {
      const kmh = Math.round(Math.abs(p.car.speed) * 0.32);
      text(`${kmh} km/h`, VIEW.width - 18, 84, 26, '#eef1f5', 'right', true);
      text(p.car.type.toUpperCase(), VIEW.width - 18, 110, 15, '#8b93a3', 'right', true);
    }
    // Current objective.
    const target = missionTarget(state);
    const mission = state.missionIndex < MISSIONS.length ? MISSIONS[state.missionIndex] : null;
    if (mission && target && screen === SCREEN_PLAY) {
      context.fillStyle = 'rgba(10, 12, 18, 0.72)';
      const label = `★ ${mission.name}: ${target.label}`;
      context.fillRect(18, 62, Math.min(760, 24 + label.length * 9.2), 34);
      text(label, 30, 86, 19, '#ffd76a', 'left', true);
      // Progress for hold / photo / timed stages.
      const m = state.mission;
      const stage = m ? mission.stages[m.stage] : null;
      if (stage && (stage.type === 'hold' || stage.type === 'photo')) {
        const done = stage.type === 'hold' ? m.hold : m.photo;
        const frac = Math.min(1, done / stage.dur);
        rect(18, 104, 320, 12, '#333a44');
        rect(18, 104, 320 * frac, 12, '#ffd76a');
        text(`${Math.ceil(stage.dur - done)}s`, 348, 116, 16, '#ffd76a', 'left', true);
      }
      if (stage && stage.type === 'timed') {
        const left = Math.max(0, stage.limit - m.t);
        text(`Time left ${Math.ceil(left)}s — stop ${m.stopIndex + 1} of ${stage.stops.length}`, 18, 128, 18, left < 30 ? '#ff5a4f' : '#eef1f5', 'left', true);
      }
    }
    if (state.missionIndex >= MISSIONS.length && screen === SCREEN_PLAY) {
      text('Story complete — Neon Bay is yours. Free roam!', 18, 86, 19, '#7ee787', 'left', true);
    }
    // Banner.
    if (state.bannerT > 0 && state.banner) {
      context.fillStyle = 'rgba(10, 12, 18, 0.78)';
      const w = Math.min(900, 40 + state.banner.length * 10);
      context.fillRect((VIEW.width - w) / 2, 130, w, 40);
      text(state.banner, VIEW.width / 2, 158, 21, '#ffd76a', 'center', true);
    }
    // Dialogue lines at the bottom, kept clear of the minimap on the right.
    if (state.dialog.length && state.dialogT < 9) {
      const line = state.dialog[Math.min(state.dialog.length - 1, Math.floor(state.dialogT / 3))];
      context.fillStyle = 'rgba(10, 12, 18, 0.8)';
      context.fillRect(150, VIEW.height - 96, 820, 44);
      context.strokeStyle = '#ffd76a';
      context.lineWidth = 2;
      context.strokeRect(150, VIEW.height - 96, 820, 44);
      text(line, 560, VIEW.height - 67, 18, '#eef1f5', 'center');
    }
    // Controls hint.
    text('WASD move · E enter/exit car · Space melee · Click shoot · P pause · M mute', 18, VIEW.height - 14, 14, 'rgba(238,241,245,0.6)', 'left');
    drawMinimap(state);
  }

  function drawMinimap(state) {
    const mw = 230;
    const mh = 172;
    const mx = VIEW.width - mw - 16;
    const my = VIEW.height - mh - 16;
    const sx = mw / WORLD.width;
    const sy = mh / WORLD.height;
    context.fillStyle = 'rgba(10, 12, 18, 0.78)';
    context.fillRect(mx, my, mw, mh);
    context.strokeStyle = '#ffd76a';
    context.lineWidth = 2;
    context.strokeRect(mx, my, mw, mh);
    context.save();
    context.beginPath();
    context.rect(mx, my, mw, mh);
    context.clip();
    context.fillStyle = 'rgba(120, 140, 160, 0.5)';
    for (const ax of AVENUES) context.fillRect(mx + ax * sx - 2, my, 4, mh);
    for (const sy2 of STREETS) context.fillRect(mx, my + sy2 * sy - 2, mw, 4);
    const target = missionTarget(state);
    if (target) {
      context.fillStyle = '#ffd76a';
      context.beginPath();
      context.arc(mx + target.x * sx, my + target.y * sy, 6, 0, Math.PI * 2);
      context.fill();
    }
    for (const car of state.cars) {
      context.fillStyle = car.type === 'police' ? '#ff5a4f' : '#9aa0a8';
      context.fillRect(mx + car.x * sx - 2, my + car.y * sy - 2, 4, 4);
    }
    for (const rb of state.roadblocks) {
      context.fillStyle = '#ff7a1a';
      context.fillRect(mx + rb.x * sx - 4, my + rb.y * sy - 4, 8, 8);
    }
    // The player is a white dot with a direction tick.
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(mx + state.player.x * sx, my + state.player.y * sy, 5, 0, Math.PI * 2);
    context.fill();
    context.restore();
    const icon = state.dayPhase === 'day' ? '☀ Day' : state.dayPhase === 'night' ? '☾ Night' : state.dayPhase === 'dusk' ? '◐ Dusk' : '◐ Dawn';
    text(icon, mx + 8, my + 18, 14, '#eef1f5', 'left', true);
    text('NEON BAY', mx + 8, my + mh - 8, 12, 'rgba(238,241,245,0.6)', 'left', true);
  }

  function drawPanel(title, lines, prompt, accent, topY) {
    const w = 680;
    const h = 150 + lines.length * 34;
    const x = (VIEW.width - w) / 2;
    const y = topY !== undefined ? topY : (VIEW.height - h) / 2;
    context.fillStyle = 'rgba(12, 14, 22, 0.92)';
    context.fillRect(x, y, w, h);
    context.strokeStyle = accent || '#ffd76a';
    context.lineWidth = 3;
    context.strokeRect(x, y, w, h);
    text(title, VIEW.width / 2, y + 62, 44, accent || '#ffd76a', 'center', true);
    lines.forEach((line, i) => {
      text(line, VIEW.width / 2, y + 112 + i * 34, 20, '#cfd6de', 'center');
    });
    text(prompt, VIEW.width / 2, y + h - 28, 20, '#ffd76a', 'center', true);
  }

  function drawTitle(state, save) {
    // A living city behind the menu: the title screen simulates the world.
    drawWorld(state, false);
    context.fillStyle = 'rgba(8, 10, 18, 0.55)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    text('NEON BAY', VIEW.width / 2, 118, 92, '#ffd76a', 'center', true);
    text('N I G H T S', VIEW.width / 2, 158, 34, '#eef1f5', 'center', true);
    text('An open-world crime story in a harbour city that never sleeps.', VIEW.width / 2, 192, 20, '#cfd6de', 'center');
    const lines = ['Drive, steal, run the jobs, lose the heat — six missions, one city.'];
    if (save) {
      lines.push(`Continue: $${save.cash.toLocaleString('en-US')} · Mission ${Math.min(save.missionIndex + 1, 6)} of 6 · Best cash $${(save.bestCash || 0).toLocaleString('en-US')}`);
      lines.push('Press Enter for a new game, or C to continue your save.');
    } else {
      lines.push('No save yet — your progress is kept in this browser.');
    }
    lines.push('WASD / arrows move · E enter or leave a car');
    lines.push('Space melee · Click to shoot · P pause · M mute · R retry a mission');
    lines.push('Steal a car, hit a pedestrian or shoot and the wanted stars climb.');
    drawPanel(' ', lines, save ? 'Enter — New game · C — Continue' : 'Press Enter or click to start', '#ffd76a', 214);
  }

  function drawPaused(state) {
    drawWorld(state, true);
    drawPanel('Paused', ['The city waits for no one — except right now.', `Cash $${state.cash.toLocaleString('en-US')} · Mission ${Math.min(state.missionIndex + 1, 6)} of 6 · Wanted ${starRow(state.wanted)}`], 'Press P or Enter to resume', '#7ec9ff');
  }

  function drawOver(state, save) {
    drawWorld(state, true);
    const busted = state.over === 'busted';
    drawPanel(
      busted ? 'BUSTED' : 'WASTED',
      busted
        ? ['The police pulled you out of the city in cuffs.', `Cash kept: $${state.cash.toLocaleString('en-US')}`]
        : ['Neon Bay got the better of you this time.', `Cash kept: $${state.cash.toLocaleString('en-US')}`],
      'Press Enter to try again from the safehouse',
      '#ff5a4f',
    );
  }

  function drawWorld(state, withHud) {
    const p = state.player;
    view.camX = Math.max(0, Math.min(WORLD.width - VIEW.width, p.x - VIEW.width / 2));
    view.camY = Math.max(0, Math.min(WORLD.height - VIEW.height, p.y - VIEW.height / 2));
    context.setTransform(view.scale, 0, 0, view.scale, view.x - view.camX * view.scale, view.y - view.camY * view.scale);
    drawCity(state);
    drawMissionMarker(state);
    drawPickups(state);
    for (const ped of state.peds) drawPed(state, ped);
    for (const car of state.cars) drawCar(state, car);
    drawGuards(state);
    drawRoadblocks(state);
    drawPlayer(state);
    drawLighting(state);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (withHud) drawHud(state, SCREEN_PLAY);
  }

  /** Paint one frame for the screen the game is on. */
  function draw(state, screen, save) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#0b0e14';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (screen === SCREEN_TITLE) {
      context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      drawTitle(state, save);
      return;
    }
    if (screen === SCREEN_PAUSED) { drawPaused(state); return; }
    if (screen === SCREEN_OVER) { drawOver(state, save); return; }
    drawWorld(state, true);
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, resize };
}

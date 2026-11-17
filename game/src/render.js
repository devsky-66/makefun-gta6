// Canvas 2D renderer for Neon Bay: the city, cars, people, effects, HUD,
// minimap, menus and the objective arrow. Everything is drawn by hand;
// no images are loaded and no network request is ever made.
import { WORLD_W, WORLD_H, ROAD_W, SIDEWALK, ROADS_V, ROADS_H, DISTRICTS } from './city.js';
import { MISSIONS } from './game.js';
import { clamp, dist } from './rng.js';

const MINIMAP_W = 216;
const MINIMAP_H = 156;

export function drawWorld(ctx, game, view) {
  const { camX, camY, scale, vw, vh } = view;
  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(scale, scale);
  const shakeX = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  const shakeY = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  ctx.translate(-camX + shakeX, -camY + shakeY);
  drawGround(ctx, game);
  drawPickups(ctx, game);
  drawPeds(ctx, game);
  drawCars(ctx, game);
  drawPlayer(ctx, game);
  drawParticles(ctx, game);
  drawMissionMarker(ctx, game);
  // Day-night wash over the whole scene, plus lamp glow after dark.
  const phase = game.phase();
  if (phase.darkness > 0) {
    const tint = phase.name === 'dusk' ? '255,120,40' : '8,12,40';
    ctx.fillStyle = 'rgba(' + tint + ',' + phase.darkness + ')';
    ctx.fillRect(camX - vw / scale / 2 - 60, camY - vh / scale / 2 - 60, vw / scale + 120, vh / scale + 120);
    if (phase.name === 'night') drawLampGlow(ctx, game, camX, camY, vw / scale, vh / scale);
  }
  ctx.restore();
}

function drawGround(ctx, game) {
  const city = game.city;
  const night = game.isNight();
  // Grass base, extended past the world edge so the camera never sees void.
  ctx.fillStyle = '#5d8a4a';
  ctx.fillRect(-2000, -2000, WORLD_W + 4000, WORLD_H + 4000);
  // The bay along the south edge, with a sandy beach and the pier.
  ctx.fillStyle = '#2b6cb0';
  ctx.fillRect(0, WORLD_H - 130, WORLD_W, 130);
  ctx.fillStyle = '#d8c08a';
  ctx.fillRect(0, WORLD_H - 150, WORLD_W, 22);
  ctx.fillStyle = '#8a6a4a';
  ctx.fillRect(1420, WORLD_H - 260, 160, 130);
  ctx.fillStyle = '#6a4a2a';
  for (let x = 1430; x < 1570; x += 18) ctx.fillRect(x, WORLD_H - 260, 6, 130);
  // Parks.
  for (const pk of city.parks) {
    ctx.fillStyle = '#4a7a3a';
    ctx.fillRect(pk.x, pk.y, pk.w, pk.h);
    ctx.strokeStyle = '#3a6a2a';
    ctx.lineWidth = 3;
    ctx.strokeRect(pk.x, pk.y, pk.w, pk.h);
  }
  for (const t of city.trees) {
    ctx.fillStyle = '#2f6b2f';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a9a3a';
    ctx.beginPath(); ctx.arc(t.x - 3, t.y - 3, t.r * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  // Roads + sidewalks.
  for (const rx of ROADS_V) {
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(rx - ROAD_W / 2 - SIDEWALK, 0, ROAD_W + SIDEWALK * 2, WORLD_H);
    ctx.fillStyle = '#33373e';
    ctx.fillRect(rx - ROAD_W / 2, 0, ROAD_W, WORLD_H);
  }
  for (const ry of ROADS_H) {
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(0, ry - ROAD_W / 2 - SIDEWALK, WORLD_W, ROAD_W + SIDEWALK * 2);
    ctx.fillStyle = '#33373e';
    ctx.fillRect(0, ry - ROAD_W / 2, WORLD_W, ROAD_W);
  }
  // Lane dashes.
  ctx.fillStyle = '#e8c832';
  for (const rx of ROADS_V) for (let y = 20; y < WORLD_H; y += 70) ctx.fillRect(rx - 3, y, 6, 34);
  for (const ry of ROADS_H) for (let x = 20; x < WORLD_W; x += 70) ctx.fillRect(x, ry - 3, 34, 6);
  // Crosswalks at intersections.
  ctx.fillStyle = '#d8dce2';
  for (const rx of ROADS_V) for (const ry of ROADS_H) {
    for (let i = -3; i <= 3; i++) {
      ctx.fillRect(rx + i * 13 - 4, ry - ROAD_W / 2 + 6, 8, 16);
      ctx.fillRect(rx + i * 13 - 4, ry + ROAD_W / 2 - 22, 8, 16);
    }
  }
  // Car parks.
  for (const lot of city.lots) {
    ctx.fillStyle = '#4a4f58';
    ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 2;
    for (let x = lot.x + 14; x < lot.x + lot.w - 20; x += 52) {
      ctx.strokeRect(x, lot.y + 12, 40, 20);
      ctx.strokeRect(x, lot.y + lot.h - 32, 40, 20);
    }
  }
  // Buildings with roofs and windows; windows glow at night.
  for (const b of city.buildings) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
    ctx.fillStyle = night ? 'rgba(255,220,120,0.95)' : 'rgba(255,255,190,0.75)';
    const cols = Math.max(1, Math.floor(b.w / 26));
    const rows = Math.max(1, Math.floor(b.h / 26));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (((i * 7 + j * 3 + Math.floor(b.lit * 10)) % 4) !== 0) continue;
        ctx.fillRect(b.x + 10 + i * 26, b.y + 10 + j * 26, 10, 8);
      }
    }
  }
  // Streetlamps at every intersection: posts by day, glowing bulbs by night.
  for (const rx of ROADS_V) {
    for (const ry of ROADS_H) {
      ctx.fillStyle = '#3a3f48';
      ctx.fillRect(rx + ROAD_W / 2 + 4, ry - ROAD_W / 2 - 14, 4, 14);
      if (night || game.isDusk()) {
        ctx.fillStyle = 'rgba(255,220,130,0.9)';
        ctx.beginPath(); ctx.arc(rx + ROAD_W / 2 + 6, ry - ROAD_W / 2 - 14, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  // District labels, faint on the ground.
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  for (const d of DISTRICTS) ctx.fillText(d.name.toUpperCase(), d.x + d.w / 2, d.y + d.h / 2);
}

// Pools of warm light around each lamp after dark.
function drawLampGlow(ctx, game, camX, camY, vw, vh) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,214,120,0.10)';
  for (const rx of ROADS_V) {
    for (const ry of ROADS_H) {
      const lx = rx + ROAD_W / 2 + 6;
      const ly = ry - ROAD_W / 2 - 14;
      if (Math.abs(lx - camX) > vw / 2 + 120 || Math.abs(ly - camY) > vh / 2 + 120) continue;
      ctx.beginPath(); ctx.arc(lx, ly, 70, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawPickups(ctx, game) {
  for (const pk of game.pickups) {
    if (pk.taken) continue;
    const bob = Math.sin(pk.bob * 3) * 3;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    if (pk.kind === 'cash') {
      ctx.fillStyle = '#2fae4e'; ctx.fillRect(-13, -8, 26, 16);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('$', 0, 5);
    }
    if (pk.kind === 'health') {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-11, -11, 22, 22);
      ctx.fillStyle = '#e83a3a'; ctx.fillRect(-3, -8, 6, 16); ctx.fillRect(-8, -3, 16, 6);
    }
    if (pk.kind === 'ammo') {
      ctx.fillStyle = '#e8c832'; ctx.fillRect(-11, -7, 22, 14);
      ctx.fillStyle = '#333333'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('AMMO', 0, 4);
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCarShape(ctx, car, game) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const dark = game.isNight() || game.isDusk();
  // Headlight cone after dark, so night driving reads at a glance.
  if (dark) {
    const grad = ctx.createLinearGradient(car.w / 2, 0, car.w / 2 + 150, 0);
    grad.addColorStop(0, 'rgba(255,240,170,0.30)');
    grad.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(car.w / 2, -8);
    ctx.lineTo(car.w / 2 + 150, -42);
    ctx.lineTo(car.w / 2 + 150, 42);
    ctx.lineTo(car.w / 2, 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-car.w / 2 - 1, -car.h / 2 - 1, car.w + 2, car.h + 2);
  if (car.kind === 'bike') {
    // Slim bike with a rider leaning forward.
    ctx.fillStyle = car.color;
    roundRect(ctx, -17, -7, 34, 14, 6);
    ctx.fill();
    ctx.fillStyle = '#222222';
    ctx.beginPath(); ctx.arc(8, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8b88a';
    ctx.beginPath(); ctx.arc(12, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff8c0';
    ctx.fillRect(15, -4, 3, 8);
    ctx.fillStyle = '#ff3a3a';
    ctx.fillRect(-18, -3, 3, 6);
    ctx.restore();
    return;
  }
  if (car.kind === 'bus') {
    // Long bus with a row of windows and a destination strip.
    ctx.fillStyle = car.color;
    roundRect(ctx, -32, -13, 64, 26, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,210,240,0.75)';
    for (let i = -24; i <= 16; i += 10) ctx.fillRect(i, -9, 7, 18);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('BAY', 24, 3);
    ctx.fillStyle = '#fff8c0';
    ctx.fillRect(30, -10, 3, 5); ctx.fillRect(30, 5, 3, 5);
    ctx.fillStyle = '#ff3a3a';
    ctx.fillRect(-33, -10, 3, 5); ctx.fillRect(-33, 5, 3, 5);
    ctx.restore();
    return;
  }
  // Ordinary car body.
  ctx.fillStyle = car.color;
  roundRect(ctx, -23, -11, 46, 22, 7);
  ctx.fill();
  ctx.fillStyle = car.police ? '#d8dce2' : 'rgba(20,30,44,0.85)';
  roundRect(ctx, -6, -9, 16, 18, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,210,240,0.7)';
  ctx.fillRect(8, -8, 4, 16);
  ctx.fillStyle = '#fff8c0';
  ctx.fillRect(21, -9, 3, 5); ctx.fillRect(21, 4, 3, 5);
  ctx.fillStyle = '#ff3a3a';
  ctx.fillRect(-24, -9, 3, 5); ctx.fillRect(-24, 4, 3, 5);
  if (car.police) {
    // Black-and-white cruiser with a flashing light bar; a roadblock
    // cruiser parks across the lane with chevrons on its side.
    ctx.fillStyle = '#f0f0f0';
    roundRect(ctx, -23, -11, 20, 22, 7); ctx.fill();
    ctx.fillStyle = '#1c1e26';
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PD', -12, 4);
    const phase = Math.floor(performance.now() / 180) % 2 === 0;
    ctx.fillStyle = phase ? '#ff2a2a' : '#2a6bff';
    ctx.fillRect(-4, -12, 8, 4);
    ctx.fillStyle = phase ? '#2a6bff' : '#ff2a2a';
    ctx.fillRect(-4, 8, 8, 4);
    if (car.roadblock) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText('STOP', 8, 12);
    }
  }
  ctx.restore();
}

function drawCars(ctx, game) {
  for (const t of game.traffic) drawCarShape(ctx, t, game);
  for (const c of game.cars) {
    if (game.player.car === c) continue;
    drawCarShape(ctx, c, game);
  }
  for (const pc of game.police) drawCarShape(ctx, pc, game);
  for (const rb of game.roadblocks) drawCarShape(ctx, rb, game);
  if (game.player.car) drawCarShape(ctx, game.player.car, game);
}

function drawPeds(ctx, game) {
  for (const ped of game.peds) {
    ctx.save();
    ctx.translate(ped.x, ped.y);
    if (ped.down > 0) {
      ctx.rotate(1.4);
      ctx.fillStyle = ped.shirt;
      ctx.fillRect(-9, -5, 18, 10);
      ctx.fillStyle = ped.skin;
      ctx.beginPath(); ctx.arc(11, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      continue;
    }
    const bob = Math.sin(ped.walkPhase) * 2;
    ctx.rotate(ped.angle);
    ctx.fillStyle = ped.shirt;
    ctx.fillRect(-7, -6 + bob * 0.4, 14, 12);
    ctx.fillStyle = ped.skin;
    ctx.beginPath(); ctx.arc(10, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222222';
    ctx.fillRect(-8, -8, 4, 4); ctx.fillRect(-8, 4, 4, 4);
    ctx.restore();
  }
}

function drawPlayer(ctx, game) {
  const p = game.player;
  if (p.car) return; // drawn with the car
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 4, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  const bob = p.moving ? Math.sin(p.walkPhase) * 3 : 0;
  ctx.rotate(p.angle);
  // Leather jacket, jeans, sneakers.
  ctx.fillStyle = '#7a2e2e';
  ctx.fillRect(-8, -8 + bob * 0.3, 15, 16);
  ctx.fillStyle = '#2a3a6b';
  ctx.fillRect(-9, 6, 5, 7); ctx.fillRect(4, 6, 5, 7);
  ctx.fillStyle = '#e8b88a';
  ctx.beginPath(); ctx.arc(11, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222222';
  ctx.beginPath(); ctx.arc(11, -2, 7, Math.PI, Math.PI * 2); ctx.fill();
  // Pistol in hand when armed.
  if (p.ammo > 0) { ctx.fillStyle = '#222222'; ctx.fillRect(10, -2, 12, 4); }
  ctx.restore();
}

function drawParticles(ctx, game) {
  for (const pt of game.particles) {
    const a = 1 - pt.t / pt.life;
    if (pt.kind === 'muzzle') {
      ctx.fillStyle = 'rgba(255,220,90,' + a + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 10 * a + 4, 0, Math.PI * 2); ctx.fill();
    }
    if (pt.kind === 'hit') {
      ctx.fillStyle = 'rgba(255,60,60,' + a + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 8 * a + 3, 0, Math.PI * 2); ctx.fill();
    }
    if (pt.kind === 'boom') {
      ctx.fillStyle = 'rgba(255,' + Math.floor(120 * a) + ',40,' + a + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 26 * (1 - a * 0.5) + 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(60,60,60,' + a * 0.8 + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y - 10, 14 * a + 4, 0, Math.PI * 2); ctx.fill();
    }
    if (pt.kind === 'smoke') {
      ctx.fillStyle = 'rgba(200,200,200,' + a * 0.5 + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 12 * (1 - a) + 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  for (const f of game.floaters) {
    ctx.fillStyle = f.color;
    ctx.globalAlpha = 1 - f.t / 1.4;
    ctx.fillText(f.text, f.x, f.y - f.t * 34);
    ctx.globalAlpha = 1;
  }
}

function drawMissionMarker(ctx, game) {
  const t = game.missionTarget();
  if (!t || game.screen !== 'play') return;
  const pulse = 1 + Math.sin(game.time * 5) * 0.15;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#ffd24a';
  ctx.strokeStyle = '#7a5a00';
  ctx.lineWidth = 3;
  const s = 16 * pulse;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.strokeRect(-s / 2, -s / 2, s, s);
  ctx.restore();
  ctx.save();
  ctx.translate(t.x, t.y - 34 + Math.sin(game.time * 4) * 5);
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(-10, -8); ctx.lineTo(10, -8); ctx.closePath(); ctx.fill();
  ctx.restore();
  // Ring on the ground.
  ctx.strokeStyle = 'rgba(255,210,74,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(t.x, t.y, 44 * pulse, 0, Math.PI * 2); ctx.stroke();
}

// ---- HUD, minimap, menus ----
export function drawHUD(ctx, game, vw, vh) {
  const p = game.player;
  const m = game.currentMission();
  const s = game.currentStep();
  const phase = game.phase();
  ctx.textAlign = 'left';
  // Top-left: cash, health, wanted stars.
  ctx.fillStyle = 'rgba(10,12,18,0.72)';
  roundRect(ctx, 14, 12, 250, 92, 10); ctx.fill();
  ctx.fillStyle = '#7dff8a';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('$' + Math.floor(p.cash).toLocaleString('en-US'), 28, 44);
  ctx.fillStyle = '#ffffff';
  ctx.font = '13px sans-serif';
  ctx.fillText('NEON BAY', 150, 30);
  // Health bar.
  ctx.fillStyle = '#333333';
  ctx.fillRect(28, 54, 150, 12);
  ctx.fillStyle = p.hp > 40 ? '#37c86a' : '#e83a3a';
  ctx.fillRect(28, 54, 150 * clamp(p.hp / 100, 0, 1), 12);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('HP ' + Math.ceil(p.hp), 186, 64);
  // Wanted stars.
  ctx.font = '22px sans-serif';
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < p.wanted ? '★' : '☆';
  ctx.fillStyle = p.wanted > 0 ? '#ffd24a' : 'rgba(255,255,255,0.45)';
  ctx.fillText(stars, 28, 94);
  // Top-right: clock with day/night icon, speed, ammo.
  ctx.fillStyle = 'rgba(10,12,18,0.72)';
  roundRect(ctx, vw - 214, 12, 200, 92, 10); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(phase.icon + ' ' + game.clockString(), vw - 196, 44);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#ffd24a';
  ctx.fillText(p.car ? p.car.model.name + '  ·  ' + game.speedKmh() + ' km/h' : 'On foot', vw - 196, 68);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Ammo ' + p.ammo + '   ·   M mute', vw - 196, 90);
  // Top-centre: mission objective.
  if (m && s) {
    const label = m.title + ' — ' + s.text + (s.type === 'wait' ? '  (' + Math.max(0, Math.ceil(s.seconds - game.missionWait)) + 's)' : '');
    ctx.font = 'bold 15px sans-serif';
    const w = ctx.measureText(label).width + 28;
    ctx.fillStyle = 'rgba(10,12,18,0.72)';
    roundRect(ctx, (vw - w) / 2, 12, w, 34, 10); ctx.fill();
    ctx.fillStyle = '#ffd24a';
    ctx.textAlign = 'center';
    ctx.fillText(label, vw / 2, 35);
    ctx.textAlign = 'left';
  }
  // Objective arrow at the screen edge when the target is off-screen.
  const t = game.missionTarget();
  if (t && game.screen === 'play') {
    const view = game._view;
    if (view) {
      const sx = (t.x - view.camX) * view.scale + vw / 2;
      const sy = (t.y - view.camY) * view.scale + vh / 2;
      const d = dist(sx, sy, vw / 2, vh / 2);
      if (d > 320) {
        const a = Math.atan2(sy - vh / 2, sx - vw / 2);
        const ax = vw / 2 + Math.cos(a) * 250;
        const ay = vh / 2 + Math.sin(a) * 250;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(a);
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ffd24a';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(dist(p.x, p.y, t.x, t.y)) + 'm', ax, ay + 26);
        ctx.textAlign = 'left';
      }
    }
  }
  // Dialogue box.
  if (game.dialogue) {
    const d = game.dialogue;
    ctx.fillStyle = 'rgba(10,12,18,0.85)';
    roundRect(ctx, (vw - 640) / 2, vh - 168, 640, 84, 10); ctx.fill();
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(d.speaker, (vw - 640) / 2 + 20, vh - 138);
    ctx.fillStyle = '#ffffff';
    ctx.font = '15px sans-serif';
    wrapText(ctx, d.text, (vw - 640) / 2 + 20, vh - 114, 600, 20);
  }
  // Toast.
  if (game.toast) {
    ctx.fillStyle = 'rgba(10,12,18,0.8)';
    const w = ctx.measureText(game.toast.text).width + 30;
    roundRect(ctx, (vw - w) / 2, 58, w, 32, 10); ctx.fill();
    ctx.fillStyle = '#7dff8a';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(game.toast.text, vw / 2, 79);
    ctx.textAlign = 'left';
  }
  // Roadblock warning strip while the PD blocks the roads.
  if (game.roadblocks.length > 0) {
    ctx.fillStyle = 'rgba(120,10,10,0.85)';
    const label = '⚠ ROADBLOCK AHEAD — 4★ HEAT';
    ctx.font = 'bold 14px sans-serif';
    const w = ctx.measureText(label).width + 26;
    roundRect(ctx, (vw - w) / 2, 96, w, 30, 8); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, vw / 2, 115);
    ctx.textAlign = 'left';
  }
  // Controls hint, bottom-right.
  ctx.fillStyle = 'rgba(10,12,18,0.6)';
  roundRect(ctx, vw - 318, vh - 66, 304, 52, 10); ctx.fill();
  ctx.fillStyle = '#dddddd';
  ctx.font = '12px sans-serif';
  ctx.fillText('WASD move / drive · E enter car · Space punch', vw - 306, vh - 44);
  ctx.fillText('Click shoot · Esc pause · M mute sound', vw - 306, vh - 26);
  drawMinimap(ctx, game, vw, vh);
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; }
    else line = test;
  }
  ctx.fillText(line, x, yy);
}

function drawMinimap(ctx, game, vw, vh) {
  const mx = 14, my = vh - MINIMAP_H - 14;
  const sx = MINIMAP_W / WORLD_W, sy = MINIMAP_H / WORLD_H;
  const phase = game.phase();
  ctx.fillStyle = 'rgba(10,12,18,0.78)';
  roundRect(ctx, mx - 4, my - 4, MINIMAP_W + 8, MINIMAP_H + 8, 8); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.rect(mx, my, MINIMAP_W, MINIMAP_H); ctx.clip();
  ctx.fillStyle = '#3a5a34';
  ctx.fillRect(mx, my, MINIMAP_W, MINIMAP_H);
  ctx.fillStyle = '#2b6cb0';
  ctx.fillRect(mx, my + MINIMAP_H - 8, MINIMAP_W, 8);
  ctx.strokeStyle = '#555c66';
  ctx.lineWidth = 2;
  for (const rx of ROADS_V) { ctx.beginPath(); ctx.moveTo(mx + rx * sx, my); ctx.lineTo(mx + rx * sx, my + MINIMAP_H); ctx.stroke(); }
  for (const ry of ROADS_H) { ctx.beginPath(); ctx.moveTo(mx, my + ry * sy); ctx.lineTo(mx + MINIMAP_W, my + ry * sy); ctx.stroke(); }
  // Mission marker.
  const t = game.missionTarget();
  if (t) {
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath(); ctx.arc(mx + t.x * sx, my + t.y * sy, 5, 0, Math.PI * 2); ctx.fill();
  }
  // Traffic + parked cars.
  ctx.fillStyle = '#c8ccd4';
  for (const c of game.traffic) ctx.fillRect(mx + c.x * sx - 1, my + c.y * sy - 1, 3, 3);
  // Roadblocks as orange squares.
  for (const rb of game.roadblocks) {
    ctx.fillStyle = '#ff8a2a';
    ctx.fillRect(mx + rb.x * sx - 3, my + rb.y * sy - 3, 6, 6);
  }
  // Police, flashing red/blue.
  for (const pc of game.police) {
    ctx.fillStyle = Math.floor(game.time * 4) % 2 === 0 ? '#ff2a2a' : '#2a6bff';
    ctx.beginPath(); ctx.arc(mx + pc.x * sx, my + pc.y * sy, 4, 0, Math.PI * 2); ctx.fill();
  }
  // Player.
  const p = game.player;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(mx + p.x * sx, my + p.y * sy, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#111111'; ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  // Direction arrow: points from the player toward the mission target,
  // clamped to the minimap edge so it works even off-map.
  if (t) {
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const a = Math.atan2(dy, dx);
      const edge = Math.min(MINIMAP_W, MINIMAP_H) / 2 - 8;
      const ax = mx + MINIMAP_W / 2 + Math.cos(a) * edge;
      const ay = my + MINIMAP_H / 2 + Math.sin(a) * edge;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('NEON BAY', mx + 2, my - 8);
  // Day/night indicator on the minimap: sun by day, moon by night.
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(phase.icon + ' ' + phase.name, mx + MINIMAP_W - 52, my - 8);
}

export function drawMenu(ctx, game, vw, vh, kind) {
  // Dim the city behind the menu.
  ctx.fillStyle = 'rgba(8,10,18,0.62)';
  ctx.fillRect(0, 0, vw, vh);
  ctx.textAlign = 'center';
  if (kind === 'title') {
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('NEON BAY', vw / 2, vh / 2 - 150);
    ctx.fillStyle = '#ff5a7a';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('AN OPEN-WORLD CRIME STORY', vw / 2, vh / 2 - 112);
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    ctx.fillText('Six missions. One city. Day and night. Steal cars, dodge the Bay PD, and bring down the mayor.', vw / 2, vh / 2 - 78);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#7dff8a';
    ctx.fillText('PRESS SPACE OR CLICK TO START', vw / 2, vh / 2 - 30);
    const save = game._save;
    if (save) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '15px sans-serif';
      const progress = save.mission >= MISSIONS.length
        ? 'Story complete — all six missions done'
        : 'Continue: mission ' + (save.mission + 1) + ' of ' + MISSIONS.length;
      ctx.fillText(progress + ' · $' + save.cash + ' · best $' + (save.best || save.cash) + '  (press C)', vw / 2, vh / 2 + 4);
    }
    ctx.fillStyle = '#cccccc';
    ctx.font = '14px sans-serif';
    ctx.fillText('WASD move / drive · E enter or steal a car · Space punch · Click to shoot · Esc pause · M mute', vw / 2, vh / 2 + 46);
    ctx.fillText('Stealing, hitting people and attacking the police raise your wanted level. At 4 stars the PD sets roadblocks.', vw / 2, vh / 2 + 70);
    ctx.fillText('A fully original game. No real places, people or music.', vw / 2, vh / 2 + 100);
  } else if (kind === 'pause') {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('PAUSED', vw / 2, vh / 2 - 40);
    ctx.font = '16px sans-serif';
    ctx.fillText('Esc resume · R restart mission · M mute', vw / 2, vh / 2 + 4);
    ctx.fillText('Cash $' + Math.floor(game.player.cash) + ' · Mission ' + (game.missionIdx + 1) + ' of ' + MISSIONS.length + ' · ' + game.phase().icon + ' ' + game.clockString(), vw / 2, vh / 2 + 34);
  } else if (kind === 'over') {
    const busted = game.overReason === 'busted';
    ctx.fillStyle = busted ? '#2a6bff' : '#ff3a3a';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText(busted ? 'BUSTED!' : 'WASTED', vw / 2, vh / 2 - 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = '17px sans-serif';
    ctx.fillText(busted ? 'The Bay PD caught you. $200 bail, and the heat is off — for now.' : 'You did not make it out of Neon Bay this time.', vw / 2, vh / 2 - 18);
    ctx.fillText('Cash $' + Math.floor(game.player.cash) + ' · Mission ' + (game.missionIdx + 1) + ' of ' + MISSIONS.length, vw / 2, vh / 2 + 14);
    ctx.fillStyle = '#7dff8a';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('PRESS SPACE TO TRY AGAIN', vw / 2, vh / 2 + 58);
  }
  ctx.textAlign = 'left';
}

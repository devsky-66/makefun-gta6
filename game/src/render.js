// Canvas 2D rendering for Cinder Bay: the city, cars, people, police, HUD,
// minimap, day/night light and every menu screen. All drawing is plain
// canvas shapes — no images, no fonts from the network.
import { AVENUES, STREETS, ROAD_W, WORLD, WATER_Y, PIER_X, SPOTS, onRoad } from './city.js';
import { MISSIONS, clamp, missionTarget } from './game.js';

export const SCREEN_TITLE = 0;
export const SCREEN_PLAY = 1;

const VIEW_W = 960;
const VIEW_H = 640;

export function hourOf(clock) { return (clock / 3600) % 24; }

export function nightFactor(clock) {
  const h = hourOf(clock);
  if (h >= 7 && h < 18) return 0;
  if (h >= 18 && h < 20) return (h - 18) / 2 * 0.55;
  if (h >= 20 || h < 5) return 0.55;
  return (7 - h) / 2 * 0.55;
}

function drawCar(ctx, x, y, angle, color, type, isPolice) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const l = type.len, w = type.wid;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-l / 2 + 3, -w / 2 + 3, l, w);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-l / 2, -w / 2, l, w, 6);
  ctx.fill();
  ctx.fillStyle = isPolice ? '#e8e8e8' : 'rgba(255,255,255,0.25)';
  ctx.fillRect(-l * 0.18, -w / 2 + 3, l * 0.36, w - 6);
  ctx.fillStyle = '#1a2028';
  ctx.fillRect(l / 2 - 8, -w / 2 + 2, 5, 5);
  ctx.fillRect(l / 2 - 8, w / 2 - 7, 5, 5);
  // Headlights at night.
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(l / 2 - 2, -w / 2 + 2, 3, 4);
  ctx.fillRect(l / 2 - 2, w / 2 - 6, 3, 4);
  if (isPolice) {
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(-6, -w / 2 - 2, 6, 5);
    ctx.fillStyle = '#2f7bff';
    ctx.fillRect(0, -w / 2 - 2, 6, 5);
  }
  ctx.restore();
}

function drawPerson(ctx, x, y, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 2, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#20242a';
  ctx.beginPath(); ctx.arc(5, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function render(ctx, g, sound) {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  if (g.state === 'title') { renderTitle(ctx, g); return; }
  const camX = g.camX, camY = g.camY;
  const night = nightFactor(g.clock);
  const hour = hourOf(g.clock);

  // Ground.
  ctx.fillStyle = night > 0.3 ? '#1d2b1f' : '#3f7a44';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.save();
  ctx.translate(-camX, -camY);

  // Water and pier.
  ctx.fillStyle = night > 0.3 ? '#0e2a4a' : '#2a6ea8';
  ctx.fillRect(0, WATER_Y, WORLD.width, WORLD.height - WATER_Y);
  ctx.fillStyle = '#8a6f4d';
  ctx.fillRect(PIER_X - 52, 1460, 104, WATER_Y + 120 - 1460);
  ctx.fillStyle = '#6e5638';
  for (let y = 1500; y < WATER_Y + 100; y += 40) ctx.fillRect(PIER_X - 52, y, 104, 6);

  // Blocks.
  ctx.fillStyle = night > 0.3 ? '#2c2f36' : '#7d8a7a';
  ctx.fillRect(0, 0, WORLD.width, WATER_Y);

  // Parks.
  for (const pk of g.city.parks) {
    ctx.fillStyle = night > 0.3 ? '#1e3a24' : '#4d9e57';
    ctx.fillRect(pk.x, pk.y, pk.w, pk.h);
  }

  // Roads.
  ctx.fillStyle = '#33373d';
  for (const ax of AVENUES) ctx.fillRect(ax - ROAD_W / 2, 0, ROAD_W, WATER_Y + 60);
  for (const sy of STREETS) ctx.fillRect(0, sy - ROAD_W / 2, WORLD.width, ROAD_W);
  ctx.fillRect(PIER_X - ROAD_W / 2, STREETS[STREETS.length - 1], ROAD_W, WATER_Y + 120 - STREETS[STREETS.length - 1]);
  // Centre dashes.
  ctx.fillStyle = '#d8c95a';
  for (const ax of AVENUES) for (let y = 0; y < WATER_Y; y += 56) ctx.fillRect(ax - 2, y, 4, 26);
  for (const sy of STREETS) for (let x = 0; x < WORLD.width; x += 56) ctx.fillRect(x, sy - 2, 26, 4);

  // Buildings.
  for (const b of g.city.buildings) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(b.x + 4, b.y + 4, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
    if (night > 0.2) {
      ctx.fillStyle = '#ffd76a';
      const cols = Math.floor(b.w / 22), rows = Math.floor(b.h / 20);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if ((i * 7 + j * 3 + b.x) % 5 === 0) ctx.fillRect(b.x + 9 + i * 22, b.y + 9 + j * 20, 8, 7);
      }
    }
  }
  // Trees.
  for (const t of g.city.trees) {
    ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
  }
  // Lamps.
  for (const l of g.city.lamps) {
    ctx.fillStyle = '#222';
    ctx.fillRect(l.x - 2, l.y - 2, 4, 4);
    if (night > 0.2) {
      ctx.fillStyle = 'rgba(255,214,110,0.25)';
      ctx.beginPath(); ctx.arc(l.x, l.y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd66e';
      ctx.beginPath(); ctx.arc(l.x, l.y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Landmark labels.
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  for (const key of Object.keys(SPOTS)) {
    const s = SPOTS[key];
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(s.label, s.x, s.y - 14);
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
  }

  // Pickups.
  for (const pk of g.pickups) {
    ctx.fillStyle = pk.kind === 'cash' ? '#37d67a' : pk.kind === 'health' ? '#ff5a5a' : '#f5c542';
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(pk.kind === 'cash' ? '$' : pk.kind === 'health' ? '+' : 'A', pk.x, pk.y + 4);
  }

  // Roadblocks.
  for (const rb of g.roadblocks) {
    ctx.save(); ctx.translate(rb.x, rb.y); ctx.rotate(rb.angle);
    ctx.fillStyle = '#ff7a1a';
    ctx.fillRect(-34, -8, 68, 16);
    ctx.fillStyle = '#fff';
    for (let i = -28; i < 30; i += 14) ctx.fillRect(i, -8, 7, 16);
    ctx.restore();
  }

  // Cars, police, pedestrians, enemies, bullets, player.
  for (const c of g.cars) {
    if (c === g.player.car) continue;
    drawCar(ctx, c.x, c.y, c.angle, c.color, c.type, c.kind === 'police');
  }
  for (const ped of g.peds) drawPerson(ctx, ped.x, ped.y, ped.angle, ped.color);
  for (const e of g.enemies) {
    drawPerson(ctx, e.x, e.y, e.angle, e.color);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(e.x - 12, e.y - 20, 24 * (e.hp / 3), 4);
  }
  ctx.fillStyle = '#ffe14d';
  for (const b of g.bullets) {
    ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  const p = g.player;
  if (p.car) drawCar(ctx, p.car.x, p.car.y, p.car.angle, p.car.color, p.car.type, false);
  else drawPerson(ctx, p.x, p.y, p.angle, '#e8b13c');
  // Aim line.
  if (p.car == null) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(p.angle) * 40, p.y + Math.sin(p.angle) * 40); ctx.stroke();
  }

  // Mission target marker.
  const t = missionTarget(g);
  if (t && g.mission) {
    const pulse = 10 + Math.sin(g.time * 4) * 3;
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(t.x, t.y, 22 + pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }

  ctx.restore();

  // Night overlay + headlight glow around the player.
  if (night > 0.02) {
    ctx.fillStyle = `rgba(8,12,40,${night})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const gx = p.x - camX, gy = p.y - camY;
    const grad = ctx.createRadialGradient(gx, gy, 40, gx, gy, 260);
    grad.addColorStop(0, 'rgba(255,220,130,0.20)');
    grad.addColorStop(1, 'rgba(255,220,130,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  renderHud(ctx, g, hour, night);
  if (g.state === 'pause') renderOverlay(ctx, 'PAUSED', 'P to resume · M mute · progress autosaves');
  if (g.state === 'busted') renderOverlay(ctx, 'BUSTED', (g.over || '') + ' — press R to retry the mission, Enter for the title screen');
  if (g.state === 'wasted') renderOverlay(ctx, 'WASTED', (g.over || '') + ' — press R to retry, Enter for the title screen');
  if (g.state === 'done') renderOverlay(ctx, 'CINDER BAY IS YOURS', 'All six missions complete. Cash: $' + g.cash + ' — Enter for the title screen');
  if (g.dialogT > 0 && g.dialog.length) renderDialog(ctx, g);
}

function renderHud(ctx, g, hour, night) {
  const p = g.player;
  // Top-left panel: health, cash, ammo, wanted.
  ctx.fillStyle = 'rgba(10,12,18,0.72)';
  ctx.fillRect(10, 10, 250, 92);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('❤ ' + Math.round(g.health), 20, 32);
  ctx.fillStyle = '#37d67a';
  ctx.fillRect(78, 20, 120 * (g.health / 100), 12);
  ctx.strokeStyle = '#fff'; ctx.strokeRect(78, 20, 120, 12);
  ctx.fillStyle = '#ffd76a';
  ctx.fillText('$' + g.cash, 20, 58);
  ctx.fillStyle = '#fff';
  ctx.fillText('Ammo ' + g.ammo, 110, 58);
  ctx.fillText('★'.repeat(g.wanted) + '☆'.repeat(5 - g.wanted), 20, 84);
  ctx.fillStyle = g.wanted > 0 ? '#ff5a5a' : '#aaa';
  ctx.fillText(g.wanted > 0 ? 'WANTED' : 'CLEAN', 130, 84);
  // Speed.
  ctx.fillStyle = 'rgba(10,12,18,0.72)';
  ctx.fillRect(10, 110, 120, 34);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText((p.car ? Math.round(Math.abs(p.car.speed) * 0.36) : Math.round(p.speed * 0.36)) + ' km/h', 20, 133);
  // Clock + day/night.
  ctx.fillStyle = 'rgba(10,12,18,0.72)';
  ctx.fillRect(VIEW_W - 150, 10, 140, 34);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.fillText(String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.floor((hour % 1) * 60)).padStart(2, '0') + (night > 0.3 ? '  ☾' : '  ☀'), VIEW_W - 20, 32);
  ctx.textAlign = 'left';
  // Mission panel.
  if (g.mission) {
    ctx.fillStyle = 'rgba(10,12,18,0.72)';
    ctx.fillRect(10, VIEW_H - 86, 480, 76);
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('Mission ' + (g.missionIndex + 1) + '/6: ' + g.mission.name, 20, VIEW_H - 60);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(g.mission.brief, 20, VIEW_H - 38);
    if (g.missionIndex === 4) ctx.fillText('Time left: ' + Math.max(0, Math.ceil(g.missionTimer)) + 's', 20, VIEW_H - 18);
    else if (g.missionIndex === 3) ctx.fillText(g.wanted > 0 ? 'Lose the stars, then go to Foundry Plaza.' : 'Heat is gone — go to Foundry Plaza.', 20, VIEW_H - 18);
  }
  if (g.bannerT > 0 && g.banner) {
    ctx.fillStyle = 'rgba(10,12,18,0.8)';
    const w = ctx.measureText(g.banner).width + 30;
    ctx.fillRect((VIEW_W - w) / 2, 60, w, 34);
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(g.banner, VIEW_W / 2, 83);
    ctx.textAlign = 'left';
  }
  renderMinimap(ctx, g);
}

function renderMinimap(ctx, g) {
  const size = 168, ox = VIEW_W - size - 10, oy = VIEW_H - size - 10;
  const sx = size / WORLD.width, sy = size / WORLD.height;
  ctx.fillStyle = 'rgba(10,12,18,0.78)';
  ctx.fillRect(ox - 4, oy - 4, size + 8, size + 8);
  ctx.fillStyle = '#2e4a44';
  ctx.fillRect(ox, oy, size, size);
  ctx.fillStyle = '#5a5f66';
  for (const ax of AVENUES) ctx.fillRect(ox + ax * sx - 2, oy, 4, size);
  for (const sy2 of STREETS) ctx.fillRect(ox, oy + sy2 * sy - 2, size, 4);
  ctx.fillStyle = '#2a6ea8';
  ctx.fillRect(ox, oy + WATER_Y * sy, size, size - WATER_Y * sy);
  const t = missionTarget(g);
  if (t && g.mission) {
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(ox + t.x * sx, oy + t.y * sy, 5, 0, Math.PI * 2); ctx.fill();
  }
  for (const c of g.cars) {
    ctx.fillStyle = c.kind === 'police' ? '#2f7bff' : '#bbb';
    ctx.fillRect(ox + c.x * sx - 2, oy + c.y * sy - 2, 4, 4);
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(ox + g.player.x * sx, oy + g.player.y * sy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.strokeRect(ox - 4, oy - 4, size + 8, size + 8);
}

function renderDialog(ctx, g) {
  ctx.fillStyle = 'rgba(10,12,18,0.85)';
  ctx.fillRect(60, VIEW_H - 190, VIEW_W - 320, 92);
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 14px sans-serif';
  const line = g.dialog[0] || '';
  ctx.fillText(line, 76, VIEW_H - 158);
  if (g.dialog[1]) {
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(g.dialog[1], 76, VIEW_H - 134);
  }
  ctx.fillStyle = '#aaa';
  ctx.font = '12px sans-serif';
  ctx.fillText('Story — Vex is on the radio.', 76, VIEW_H - 112);
}

function renderOverlay(ctx, title, sub) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, VIEW_W / 2, VIEW_H / 2 - 10);
  ctx.font = '16px sans-serif';
  ctx.fillText(sub, VIEW_W / 2, VIEW_H / 2 + 30);
  ctx.textAlign = 'left';
}

function renderTitle(ctx, g) {
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, '#1a1030');
  grad.addColorStop(0.55, '#3a1a4a');
  grad.addColorStop(1, '#0c2a4a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // Skyline silhouette.
  ctx.fillStyle = '#120a24';
  let x = 0;
  const rng = { v: 7 };
  while (x < VIEW_W) {
    const w = 40 + ((rng.v = (rng.v * 37 + 11) % 97));
    const h = 90 + ((rng.v * 13) % 140);
    ctx.fillRect(x, VIEW_H - 190 - h, w, h + 190);
    ctx.fillStyle = '#ffd76a';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 8 + i * 10, VIEW_H - 180 - h + 12 + (i % 3) * 26, 5, 6);
    ctx.fillStyle = '#120a24';
    x += w + 6;
  }
  ctx.fillStyle = '#ff7a3c';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CINDER BAY', VIEW_W / 2, 150);
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('NIGHTS', VIEW_W / 2, 188);
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText('An open-world crime game — six missions, one harbour city, zero mercy.', VIEW_W / 2, 228);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(VIEW_W / 2 - 220, 260, 440, 150);
  ctx.fillStyle = '#fff';
  ctx.font = '15px sans-serif';
  const lines = [
    'WASD / arrows — walk or drive      E — enter / steal a car',
    'Mouse — aim      Click / Space — shoot      Shift — run',
    'P — pause      M — mute      R — retry mission',
    'Steal a car and the cops come. Lose the stars to go clean.',
  ];
  lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 288 + i * 26));
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(g.hasSave ? 'Press ENTER to start — or C to continue your save' : 'Press ENTER to start', VIEW_W / 2, 460);
  ctx.fillStyle = '#bbb';
  ctx.font = '14px sans-serif';
  ctx.fillText('Progress autosaves. Original fiction — no real places, people or music.', VIEW_W / 2, 500);
  ctx.textAlign = 'left';
}

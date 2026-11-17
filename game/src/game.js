// Neon Bay game state and rules: on-foot movement, driving, traffic, pedestrians,
// stealing, wanted level, police pursuit, combat, pickups and the story missions.
import { makeRng, clamp, dist, angleTo, angleDiff } from './rng.js';
import { WORLD_W, WORLD_H, ROAD_W, SIDEWALK, ROADS_V, ROADS_H, buildCity, onRoad, nearestRoadPoint, collideBuildings, insideBuilding, SPOTS, roadWaypoint } from './city.js';
import { SoundBank } from './audio.js';

export const SAVE_KEY = 'neon-bay-save-v1';
export const STEP = 1 / 60;

const CAR_MODELS = [
  { name: 'Comet', color: '#d84a4a', top: 560, accel: 340 },
  { name: 'Sedan', color: '#4a7dd8', top: 430, accel: 260 },
  { name: 'Taxi', color: '#e8c832', top: 400, accel: 250 },
  { name: 'Van', color: '#8a8f96', top: 360, accel: 200 },
  { name: 'Coupe', color: '#37c8a0', top: 500, accel: 300 },
  { name: 'Pickup', color: '#c97b2e', top: 420, accel: 240 },
];
const PED_COLORS = ['#e8b88a', '#8a5a3a', '#f0d0b0', '#6b4a2f', '#d8a070'];
const PED_SHIRTS = ['#d84a4a', '#4a7dd8', '#37c8a0', '#e8c832', '#9a6fc9', '#f0f0f0', '#333333', '#c95a8a'];

// Five story missions. Each step is: go to a spot, wait out a timer, or lose the heat.
export const MISSIONS = [
  {
    title: '1 · The New Arrival', client: 'Ray "Anchor" Marlow',
    intro: 'Ray: "Fresh face in Neon Bay? I got work if you got nerve. Meet me at the pier."',
    steps: [{ type: 'goto', spot: 'pier', text: 'Meet Ray at Neon Pier' }],
    reward: 150,
  },
  {
    title: '2 · The Package', client: 'Ray "Anchor" Marlow',
    intro: 'Ray: "Warehouse on the east docks has a package with your name on it. Bring it to Palm Court. No questions."',
    steps: [
      { type: 'goto', spot: 'warehouse', text: 'Pick up the package at Harbour Warehouse' },
      { type: 'goto', spot: 'dropA', text: 'Deliver the package to Palm Court' },
    ],
    reward: 300,
  },
  {
    title: '3 · Hot Delivery', client: 'Vera Cross',
    intro: 'Vera: "The deal is under the overpass. Cops are already sniffing around — get the goods, lose them, then drop off at Old Mill."',
    steps: [
      { type: 'goto', spot: 'deal', text: 'Collect the goods under the overpass', onArriveWanted: 3 },
      { type: 'loseheat', text: 'Lose the police — stay out of sight until the heat dies down' },
      { type: 'goto', spot: 'dropB', text: 'Deliver the goods to Old Mill' },
    ],
    reward: 600,
  },
  {
    title: '4 · The Bay Trust Job', client: 'Ray "Anchor" Marlow',
    intro: 'Ray: "One big score. Hold the bank for thirty seconds while Vera cracks the vault, then run. The whole Bay PD will be on you."',
    steps: [
      { type: 'goto', spot: 'bank', text: 'Get to Bay Trust Bank' },
      { type: 'wait', seconds: 30, text: 'Hold the bank while Vera cracks the vault' },
      { type: 'loseheat', text: 'Lose the police', onStartWanted: 4 },
      { type: 'goto', spot: 'garage', text: 'Lay low at Rusty Anchor Garage' },
    ],
    reward: 1200,
  },
  {
    title: '5 · The Golden Gull', client: 'Vera Cross',
    intro: 'Vera: "Last one. Three drops, one night, and the Gull pays out big. Drive like the bay is on fire — because it might be."',
    steps: [
      { type: 'goto', spot: 'casino', text: 'Collect the payout at Golden Gull Casino' },
      { type: 'goto', spot: 'diner', text: 'Drop 1: Sunset Diner' },
      { type: 'goto', spot: 'hospital', text: 'Drop 2: St. Marina Hospital' },
      { type: 'goto', spot: 'pier', text: 'Final drop: Neon Pier' },
    ],
    reward: 2000,
  },
];

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s.cash !== 'number' || typeof s.mission !== 'number') return null;
    return s;
  } catch { return null; }
}

export class Game {
  constructor(seed) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.city = buildCity(this.rng);
    this.sounds = new SoundBank();
    this.time = 0;
    this.clockMin = 9 * 60 + 5; // 09:05 in the morning
    this.reset();
  }

  reset() {
    const rng = this.rng;
    const save = loadSave();
    this.player = {
      x: 1500, y: 2150, angle: -Math.PI / 2, hp: 100, cash: save ? save.cash : 120,
      ammo: 24, wanted: 0, car: null, walkPhase: 0, moving: false, onFootSpeed: 195,
      punchCd: 0, shootCd: 0, dead: false, busted: false, bustedTimer: 0,
    };
    this.cars = [];
    this.peds = [];
    this.police = [];
    this.traffic = [];
    this.pickups = [];
    this.particles = [];
    this.floaters = [];
    this.crimeTimer = 0;      // seconds since last crime
    this.crimeCooldown = 0;   // per-crime rate limit
    this.crashCd = 0;         // per-crash rate limit so one shunt is not a loop
    this.policeSpawnT = 0;
    this.missionIdx = save ? Math.min(save.mission, MISSIONS.length - 1) : 0;
    this.missionStep = 0;
    this.missionWait = 0;
    this.missionDone = save ? save.mission >= MISSIONS.length : false;
    this.bestCash = save ? (save.best || save.cash) : 120;
    this.storyComplete = false;
    this.dialogue = null;     // {speaker, text, t}
    this.toast = null;        // {text, t}
    this.screen = 'title';    // title | play | pause | over
    this.overReason = '';
    this.shake = 0;
    this.spawnWorld();
    this.startMission(this.missionIdx, true);
  }

  spawnWorld() {
    const rng = this.rng;
    // Parked cars along roads and in lots.
    for (let i = 0; i < 26; i++) {
      const road = rng.chance(0.5) ? { v: true, at: rng.pick(ROADS_V) } : { v: false, at: rng.pick(ROADS_H) };
      const along = rng.range(120, road.v ? WORLD_H - 120 : WORLD_W - 120);
      const side = rng.chance(0.5) ? 1 : -1;
      const x = road.v ? road.at + side * (ROAD_W / 2 - 16) : along;
      const y = road.v ? along : road.at + side * (ROAD_W / 2 - 16);
      if (insideBuilding(this.city.buildings, x, y)) continue;
      const model = rng.pick(CAR_MODELS);
      this.cars.push(this.makeCar(x, y, road.v ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI), model, { parked: true }));
    }
    // Moving traffic on the road network.
    for (let i = 0; i < 16; i++) this.traffic.push(this.makeTrafficCar());
    // Pedestrians on sidewalks.
    for (let i = 0; i < 34; i++) this.peds.push(this.makePed());
    // Pickups: cash, health, ammo scattered around the city.
    const spots = [
      { kind: 'cash', x: 900, y: 300 }, { kind: 'health', x: 2100, y: 800 }, { kind: 'ammo', x: 300, y: 1300 },
      { kind: 'cash', x: 2700, y: 1300 }, { kind: 'health', x: 1500, y: 1800 }, { kind: 'ammo', x: 3300, y: 1800 },
      { kind: 'cash', x: 1500, y: 300 }, { kind: 'health', x: 2700, y: 2300 }, { kind: 'ammo', x: 900, y: 2300 },
      { kind: 'cash', x: 2100, y: 300 },
    ];
    for (const s of spots) this.pickups.push({ ...s, taken: false, bob: rng.range(0, 6) });
    // The player's starter car near the pier.
    const starter = this.makeCar(1500, 2260, -Math.PI / 2, CAR_MODELS[1], { parked: true, owned: true });
    this.cars.push(starter);
  }

  makeCar(x, y, angle, model, opts = {}) {
    return {
      x, y, angle, speed: 0, model, color: opts.color || model.color,
      top: model.top, accel: model.accel, parked: !!opts.parked, owned: !!opts.owned,
      police: !!opts.police, npc: !!opts.npc, driver: opts.driver !== false && !opts.parked,
      hp: 100, w: 46, h: 22, skid: 0,
    };
  }

  makeTrafficCar() {
    const rng = this.rng;
    const vertical = rng.chance(0.5);
    const road = vertical ? rng.pick(ROADS_V) : rng.pick(ROADS_H);
    const along = rng.range(100, vertical ? WORLD_H - 100 : WORLD_W - 100);
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane = dir > 0 ? 26 : -26;
    const model = rng.pick(CAR_MODELS);
    const car = this.makeCar(
      vertical ? road + lane : along,
      vertical ? along : road + lane,
      vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
      model, { npc: true, driver: true },
    );
    car.vertical = vertical; car.road = road; car.dir = dir; car.lane = lane;
    car.cruise = rng.range(150, 240);
    return car;
  }

  makePed() {
    const rng = this.rng;
    const vertical = rng.chance(0.5);
    const road = vertical ? rng.pick(ROADS_V) : rng.pick(ROADS_H);
    const along = rng.range(80, vertical ? WORLD_H - 80 : WORLD_W - 80);
    const side = rng.chance(0.5) ? 1 : -1;
    return {
      x: vertical ? road + side * (ROAD_W / 2 + SIDEWALK / 2) : along,
      y: vertical ? along : road + side * (ROAD_W / 2 + SIDEWALK / 2),
      angle: rng.range(0, Math.PI * 2), speed: rng.range(28, 62),
      skin: rng.pick(PED_COLORS), shirt: rng.pick(PED_SHIRTS),
      vertical, road, side, dir: rng.chance(0.5) ? 1 : -1,
      walkPhase: rng.range(0, 6), flee: 0, down: 0, hp: 30,
    };
  }

  save() {
    try {
      this.bestCash = Math.max(this.bestCash, this.player.cash);
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: Math.round(this.player.cash), mission: this.missionDone ? MISSIONS.length : this.missionIdx, best: Math.round(this.bestCash),
      }));
    } catch { /* storage unavailable: game still plays */ }
  }

  // ---- crimes / wanted ----
  addWanted(n, reason) {
    if (this.player.wanted >= 5) return;
    this.player.wanted = Math.min(5, this.player.wanted + n);
    this.crimeTimer = 0;
    this.sounds.wanted();
    this.floater(this.player.x, this.player.y - 30, reason + '  +' + n + '★', '#ff5a5a');
  }

  crime(n, reason) {
    if (this.crimeCooldown > 0) return;
    this.crimeCooldown = 2;
    this.addWanted(n, reason);
  }

  // ---- missions ----
  currentMission() { return this.missionDone ? null : MISSIONS[this.missionIdx]; }
  currentStep() {
    const m = this.currentMission();
    return m ? m.steps[this.missionStep] : null;
  }
  missionTarget() {
    const s = this.currentStep();
    if (!s) return null;
    if (s.type === 'goto') return SPOTS[s.spot];
    return null;
  }
  startMission(idx, silent) {
    if (idx >= MISSIONS.length) { this.missionDone = true; return; }
    this.missionIdx = idx; this.missionStep = 0; this.missionWait = 0;
    const m = MISSIONS[idx];
    if (!silent) {
      this.showDialogue(m.client, m.intro);
      this.sounds.mission();
    }
    this.save();
  }
  completeStep() {
    const m = this.currentMission();
    const s = this.currentStep();
    if (!s) return;
    this.missionStep++;
    if (this.missionStep >= m.steps.length) {
      this.player.cash += m.reward;
      this.showToast('Mission complete!  +$' + m.reward);
      this.sounds.cash();
      this.save();
      if (this.missionIdx + 1 >= MISSIONS.length) {
        this.missionDone = true;
        this.storyComplete = true;
        this.showDialogue('Vera Cross', 'Vera: "That\'s the whole board, kid. Neon Bay is yours now. Go enjoy it."');
      } else {
        this.startMission(this.missionIdx + 1);
      }
    }
  }
  failMission(reason) {
    const m = this.currentMission();
    if (!m) return;
    this.showDialogue('Mission failed', reason + ' — try again. The job is still waiting.');
    this.sounds.fail();
    this.missionStep = 0; this.missionWait = 0;
    this.player.wanted = Math.max(0, this.player.wanted - 1);
    this.police.length = 0;
    // Respawn the player near the current step target so retry is quick.
    const t = this.missionTarget();
    if (t) {
      const rp = nearestRoadPoint(t.x, t.y);
      this.exitCar(true);
      this.player.x = clamp(rp.x, 80, WORLD_W - 80);
      this.player.y = clamp(rp.y, 80, WORLD_H - 80);
      this.player.hp = 100;
    }
  }
  showDialogue(speaker, text) { this.dialogue = { speaker, text, t: 0 }; }
  showToast(text) { this.toast = { text, t: 0 }; }
  floater(x, y, text, color) { this.floaters.push({ x, y, text, color: color || '#ffffff', t: 0 }); }

  // ---- entering / leaving cars ----
  nearestCar(maxD) {
    let best = null; let bd = maxD;
    for (const c of this.cars) {
      if (c.police) continue;
      const d = dist(this.player.x, this.player.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  enterCar() {
    const car = this.nearestCar(70);
    if (!car) return false;
    if (car.driver && !car.owned) {
      // Steal it: the driver bails out and runs, and the heat goes up.
      this.crime(1, 'Carjacking');
      const d = this.makePed();
      d.x = car.x + 40; d.y = car.y + 30; d.flee = 6;
      this.peds.push(d);
      car.driver = false;
    } else if (!car.owned && car.parked) {
      this.crime(1, 'Car theft');
    }
    car.parked = false;
    this.player.car = car;
    this.player.x = car.x; this.player.y = car.y; this.player.angle = car.angle;
    this.sounds.pickup();
    return true;
  }
  exitCar(silent) {
    const car = this.player.car;
    if (!car) return;
    car.speed = 0; car.parked = true;
    const px = car.x + Math.cos(car.angle + Math.PI / 2) * 40;
    const py = car.y + Math.sin(car.angle + Math.PI / 2) * 40;
    this.player.x = clamp(px, 30, WORLD_W - 30);
    this.player.y = clamp(py, 30, WORLD_H - 30);
    this.player.angle = car.angle;
    this.player.car = null;
    if (!silent) this.sounds.pickup();
  }

  // ---- combat ----
  shootAt(tx, ty) {
    const p = this.player;
    if (p.shootCd > 0) return;
    if (p.ammo <= 0) { this.sounds.blip(160, 0.08, 'square', 0.12); return; }
    p.shootCd = 0.28; p.ammo--;
    p.angle = angleTo(p.x, p.y, tx, ty);
    this.sounds.shoot();
    this.particles.push({ x: p.x + Math.cos(p.angle) * 24, y: p.y + Math.sin(p.angle) * 24, vx: 0, vy: 0, t: 0, life: 0.08, kind: 'muzzle' });
    // Hit-scan: nearest ped / police car along the shot line.
    const range = 520;
    let bestD = range; let hit = null; let hitKind = '';
    for (const ped of this.peds) {
      if (ped.down > 0) continue;
      const d = dist(p.x, p.y, ped.x, ped.y);
      const a = angleTo(p.x, p.y, ped.x, ped.y);
      if (d < bestD && Math.abs(angleDiff(p.angle, a)) < 0.09) { bestD = d; hit = ped; hitKind = 'ped'; }
    }
    for (const pc of this.police) {
      const d = dist(p.x, p.y, pc.x, pc.y);
      const a = angleTo(p.x, p.y, pc.x, pc.y);
      if (d < bestD && Math.abs(angleDiff(p.angle, a)) < 0.12) { bestD = d; hit = pc; hitKind = 'police'; }
    }
    if (hit) {
      this.particles.push({ x: hit.x, y: hit.y, vx: 0, vy: 0, t: 0, life: 0.25, kind: 'hit' });
      if (hitKind === 'ped') { hit.down = 999; this.crime(1, 'Assault'); }
      else { hit.hp -= 34; if (hit.hp <= 0) this.destroyPoliceCar(hit); else this.crime(1, 'Attacking police'); }
    }
  }
  punch() {
    const p = this.player;
    if (p.punchCd > 0) return;
    p.punchCd = 0.4;
    this.sounds.punch();
    for (const ped of this.peds) {
      if (ped.down > 0) continue;
      if (dist(p.x, p.y, ped.x, ped.y) < 46) {
        ped.down = 999; ped.flee = 0;
        this.crime(1, 'Assault');
        this.floater(ped.x, ped.y - 20, 'Ouch!', '#ffd24a');
      }
    }
  }
  destroyPoliceCar(pc) {
    this.particles.push({ x: pc.x, y: pc.y, vx: 0, vy: 0, t: 0, life: 0.6, kind: 'boom' });
    this.sounds.crash();
    this.shake = 10;
    this.police.splice(this.police.indexOf(pc), 1);
    this.player.cash += 50;
    this.floater(pc.x, pc.y - 20, '+$50 impound bonus', '#7dff8a');
  }

  damagePlayer(amount, source) {
    const p = this.player;
    if (p.dead || p.busted) return;
    p.hp -= amount;
    this.shake = Math.max(this.shake, 6);
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      this.overReason = source || 'wasted';
      this.screen = 'over';
      this.sounds.fail();
      this.save();
    }
  }

  // ---- main update ----
  step(dt, input) {
    this.time += dt;
    this.clockMin += dt * 0.5; // game clock: 1 real second = 30 game minutes
    if (this.crimeCooldown > 0) this.crimeCooldown -= dt;
    if (this.crashCd > 0) this.crashCd -= dt;
    if (this.dialogue) { this.dialogue.t += dt; if (this.dialogue.t > 9) this.dialogue = null; }
    if (this.toast) { this.toast.t += dt; if (this.toast.t > 4) this.toast = null; }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < 1.4);
    for (const pt of this.particles) { pt.t += dt; pt.x += (pt.vx || 0) * dt; pt.y += (pt.vy || 0) * dt; }
    this.particles = this.particles.filter((pt) => pt.t < pt.life);

    if (this.screen !== 'play') {
      // World idles behind menus: traffic keeps rolling.
      this.updateTraffic(dt);
      this.updatePeds(dt, true);
      this.sounds.setEngine(0, false);
      this.sounds.setSiren(false);
      return;
    }
    const p = this.player;
    if (p.punchCd > 0) p.punchCd -= dt;
    if (p.shootCd > 0) p.shootCd -= dt;

    // Wanted decay: lay low and the heat dies down.
    this.crimeTimer += dt;
    if (p.wanted > 0 && this.crimeTimer > 22) {
      p.wanted--; this.crimeTimer = 0;
      this.showToast(p.wanted === 0 ? 'You lost the cops. Heat is off.' : 'Heat dying down… ' + p.wanted + '★ left');
    }

    if (input.enterPressed) {
      if (p.car) this.exitCar();
      else this.enterCar();
    }
    if (input.punchPressed) {
      if (p.car) { /* no punching from a car */ }
      else if (p.ammo > 0 && input.aim) this.shootAt(input.aim.x, input.aim.y);
      else this.punch();
    }
    if (input.shootPressed && !p.car && input.aim) this.shootAt(input.aim.x, input.aim.y);

    if (p.car) this.updateDriving(dt, input);
    else this.updateWalking(dt, input);

    this.updateTraffic(dt);
    this.updatePeds(dt, false);
    this.updatePolice(dt);
    this.updatePickups(dt);
    this.updateMission(dt);

    // Engine + siren audio follow the action.
    const speed01 = p.car ? Math.abs(p.car.speed) / p.car.top : 0;
    this.sounds.setEngine(speed01, !!p.car);
    this.sounds.setSiren(this.police.length > 0);

    // Busted: a cop car sits on an on-foot player at low speed.
    if (!p.car && p.wanted > 0 && !p.dead) {
      let near = false;
      for (const pc of this.police) if (dist(p.x, p.y, pc.x, pc.y) < 46) near = true;
      if (near) {
        p.bustedTimer += dt;
        if (p.bustedTimer > 1.6) {
          p.busted = true;
          this.overReason = 'busted';
          this.screen = 'over';
          this.sounds.fail();
          this.player.cash = Math.max(0, this.player.cash - 200);
          this.save();
        }
      } else p.bustedTimer = 0;
    }
  }

  updateWalking(dt, input) {
    const p = this.player;
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const len = Math.hypot(mx, my);
    p.moving = len > 0;
    if (len > 0) {
      mx /= len; my /= len;
      p.angle = Math.atan2(my, mx);
      p.walkPhase += dt * 11;
      const nx = p.x + mx * p.onFootSpeed * dt;
      const ny = p.y + my * p.onFootSpeed * dt;
      const r1 = collideBuildings(this.city.buildings, nx, p.y, 13);
      const r2 = collideBuildings(this.city.buildings, r1.x, ny, 13);
      p.x = clamp(r2.x, 24, WORLD_W - 24);
      p.y = clamp(r2.y, 24, WORLD_H - 24);
    }
  }

  updateDriving(dt, input) {
    const car = this.player.car;
    const p = this.player;
    const throttle = (input.up ? 1 : 0) - (input.down ? 0.7 : 0);
    const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    const offroad = onRoad(car.x, car.y) ? 1 : 0.55;
    car.speed += throttle * car.accel * offroad * dt;
    // Drag + braking.
    car.speed -= car.speed * 0.55 * dt;
    if (!input.up && !input.down) car.speed -= car.speed * 0.9 * dt;
    car.speed = clamp(car.speed, -car.top * 0.35, car.top * offroad);
    if (Math.abs(car.speed) < 4 && !input.up) car.speed = 0;
    const steerAmt = steer * clamp(Math.abs(car.speed) / 140, 0, 1) * 2.5 * dt * (car.speed < 0 ? -1 : 1);
    car.angle += steerAmt;
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    const before = { x: car.x, y: car.y };
    const hit = collideBuildings(this.city.buildings, nx, ny, 22);
    car.x = clamp(hit.x, 30, WORLD_W - 30);
    car.y = clamp(hit.y, 30, WORLD_H - 30);
    if (hit.hit && Math.abs(car.speed) > 120) {
      this.crashCar(car, before);
    }
    // Skid particles at hard steering.
    if (Math.abs(steer) > 0 && Math.abs(car.speed) > 300 && this.rng.chance(0.4)) {
      this.particles.push({ x: car.x - Math.cos(car.angle) * 20, y: car.y - Math.sin(car.angle) * 20, vx: 0, vy: 0, t: 0, life: 0.4, kind: 'smoke' });
    }
    // Collisions with traffic cars: shunt them aside; only a hard hit
    // (and at most one per second) counts as a crash.
    for (const t of this.traffic) {
      if (dist(car.x, car.y, t.x, t.y) < 46) {
        const push = angleTo(t.x, t.y, car.x, car.y);
        t.x += Math.cos(push) * 30; t.y += Math.sin(push) * 30;
        car.speed *= 0.96;
        if (Math.abs(car.speed) > 260 && this.crashCd <= 0) {
          this.crashCd = 1;
          this.crashCar(car, before, true);
          this.crime(1, 'Hit and run');
        }
      }
    }
    for (const ped of this.peds) {
      if (ped.down > 0) continue;
      if (dist(car.x, car.y, ped.x, ped.y) < 34) {
        if (Math.abs(car.speed) > 60) {
          ped.down = 999;
          this.crime(1, 'Hit a pedestrian');
          this.sounds.crash();
          this.shake = 8;
          this.floater(ped.x, ped.y - 20, 'Ouch!', '#ffd24a');
        } else {
          ped.flee = 2.5;
        }
      }
    }
    p.x = car.x; p.y = car.y; p.angle = car.angle;
  }

  crashCar(car, before, soft) {
    const impact = Math.abs(car.speed);
    car.speed *= -0.25;
    car.x = before.x; car.y = before.y;
    car.hp -= impact / 12;
    this.sounds.crash();
    this.shake = Math.min(12, 4 + impact / 60);
    this.particles.push({ x: car.x, y: car.y, vx: 0, vy: 0, t: 0, life: 0.5, kind: 'boom' });
    if (car === this.player.car) {
      this.damagePlayer(impact / 22, 'wasted');
      if (car.hp <= 0) {
        this.showToast('Your car is wrecked!');
        this.exitCar(true);
        this.cars.splice(this.cars.indexOf(car), 1);
      }
    }
  }

  updateTraffic(dt) {
    for (const t of this.traffic) {
      // Keep a gap to the car ahead on the same road.
      let blocked = false;
      for (const o of this.traffic) {
        if (o === t || o.vertical !== t.vertical || o.road !== t.road || o.dir !== t.dir) continue;
        const along = t.vertical ? o.y - t.y : o.x - t.x;
        if (along * t.dir > 0 && along * t.dir < 70) blocked = true;
      }
      // Swerve around the player's car instead of stopping dead in front of it.
      const p = this.player;
      let swerving = false;
      if (p.car) {
        const ahead = t.vertical ? (p.car.y - t.y) * t.dir : (p.car.x - t.x) * t.dir;
        const lateral = t.vertical ? Math.abs(p.car.x - t.x) : Math.abs(p.car.y - t.y);
        if (ahead > 0 && ahead < 170 && lateral < 60) {
          swerving = true;
          const away = t.vertical ? (p.car.x >= t.x ? -1 : 1) : (p.car.y >= t.y ? -1 : 1);
          if (t.vertical) t.x = clamp(t.x + away * 130 * dt, t.road - 48, t.road + 48);
          else t.y = clamp(t.y + away * 130 * dt, t.road - 48, t.road + 48);
        }
      }
      // Ease back to the home lane once the road is clear.
      if (!swerving) {
        if (t.vertical) t.x += clamp((t.road + t.lane) - t.x, -60 * dt, 60 * dt);
        else t.y += clamp((t.road + t.lane) - t.y, -60 * dt, 60 * dt);
      }
      const speed = blocked ? 0 : t.cruise;
      if (t.vertical) {
        t.y += t.dir * speed * dt;
        if (t.y > WORLD_H - 60) t.y = 60;
        if (t.y < 60) t.y = WORLD_H - 60;
      } else {
        t.x += t.dir * speed * dt;
        if (t.x > WORLD_W - 60) t.x = 60;
        if (t.x < 60) t.x = WORLD_W - 60;
      }
    }
  }

  updatePeds(dt, idle) {
    for (const ped of this.peds) {
      if (ped.down > 0) continue;
      if (ped.flee > 0) {
        ped.flee -= dt;
        const p = this.player;
        const a = angleTo(p.x, p.y, ped.x, ped.y);
        ped.x = clamp(ped.x + Math.cos(a) * 130 * dt, 24, WORLD_W - 24);
        ped.y = clamp(ped.y + Math.sin(a) * 130 * dt, 24, WORLD_H - 24);
        ped.angle = a;
        ped.walkPhase += dt * 12;
        continue;
      }
      ped.walkPhase += dt * 7;
      // Stroll along the sidewalk; turn around at the ends.
      const speed = ped.speed * (idle ? 0.6 : 1);
      if (ped.vertical) {
        ped.y += ped.dir * speed * dt;
        if (ped.y > WORLD_H - 70 || ped.y < 70) ped.dir *= -1;
        ped.angle = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        ped.x += ped.dir * speed * dt;
        if (ped.x > WORLD_W - 70 || ped.x < 70) ped.dir *= -1;
        ped.angle = ped.dir > 0 ? 0 : Math.PI;
      }
      // Step aside from the player's car.
      const p = this.player;
      if (p.car && dist(ped.x, ped.y, p.car.x, p.car.y) < 90 && Math.abs(p.car.speed) > 40) ped.flee = 1.6;
    }
  }

  updatePolice(dt) {
    const p = this.player;
    const wanted = p.wanted;
    const desired = wanted === 0 ? 0 : Math.min(1 + Math.floor(wanted / 2), 4);
    this.policeSpawnT -= dt;
    if (this.police.length < desired && this.policeSpawnT <= 0) {
      this.policeSpawnT = 2.5;
      const a = this.rng.range(0, Math.PI * 2);
      const rp = nearestRoadPoint(
        clamp(p.x + Math.cos(a) * 700, 80, WORLD_W - 80),
        clamp(p.y + Math.sin(a) * 700, 80, WORLD_H - 80),
      );
      const pc = this.makeCar(rp.x, rp.y, angleTo(rp.x, rp.y, p.x, p.y), { name: 'Interceptor', color: '#1c1e26', top: 540, accel: 380 }, { police: true, driver: true });
      pc.hp = 120;
      this.police.push(pc);
      this.sounds.wanted();
    }
    // When the heat is off, remaining units give up and drive away.
    if (wanted === 0 && this.police.length > 0) {
      this.policeSpawnT -= dt * 0;
      for (const pc of this.police) pc.givingUp = true;
    }
    for (const pc of [...this.police]) {
      if (pc.givingUp) {
        pc.speed = Math.min(pc.speed + 200 * dt, 300);
        pc.angle += angleDiff(pc.angle, angleTo(pc.x, pc.y, WORLD_W / 2, WORLD_H / 2)) * 1.5 * dt;
        pc.x += Math.cos(pc.angle) * pc.speed * dt;
        pc.y += Math.sin(pc.angle) * pc.speed * dt;
        if (dist(pc.x, pc.y, p.x, p.y) > 1100) this.police.splice(this.police.indexOf(pc), 1);
        continue;
      }
      // Far away, cruisers route over the road grid like the autopilot;
      // up close they steer straight at the player to ram.
      const d = dist(pc.x, pc.y, p.x, p.y);
      const wp = d > 260 ? roadWaypoint(pc.x, pc.y, p.x, p.y) : { x: p.x, y: p.y };
      const targetA = angleTo(pc.x, pc.y, wp.x, wp.y);
      const wantSpeed = d > 90 ? pc.top : pc.top * 0.6;
      pc.speed = Math.min(pc.speed + pc.accel * dt, wantSpeed);
      pc.angle += clamp(angleDiff(pc.angle, targetA), -2.6 * dt, 2.6 * dt);
      const nx = pc.x + Math.cos(pc.angle) * pc.speed * dt;
      const ny = pc.y + Math.sin(pc.angle) * pc.speed * dt;
      const hit = collideBuildings(this.city.buildings, nx, ny, 22);
      pc.x = clamp(hit.x, 30, WORLD_W - 30);
      pc.y = clamp(hit.y, 30, WORLD_H - 30);
      if (hit.hit) pc.speed *= 0.4;
      // Ram the player: on foot it hurts, in a car it shoves and damages.
      if (d < 48) {
        if (p.car) {
          p.car.speed *= 0.92;
          p.car.x += Math.cos(pc.angle) * 14; p.car.y += Math.sin(pc.angle) * 14;
          pc.speed *= 0.85; // the cruiser bounces off instead of gluing on
          this.damagePlayer(14 * dt, 'wasted');
          if (this.rng.chance(0.02)) this.sounds.crash();
        } else {
          this.damagePlayer(22 * dt, 'wasted');
        }
      }
    }
  }

  updatePickups(dt) {
    const p = this.player;
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.bob += dt;
      if (dist(p.x, p.y, pk.x, pk.y) < 34) {
        pk.taken = true;
        if (pk.kind === 'cash') { p.cash += 75; this.floater(pk.x, pk.y - 20, '+$75', '#7dff8a'); this.sounds.cash(); }
        if (pk.kind === 'health') { p.hp = Math.min(100, p.hp + 40); this.floater(pk.x, pk.y - 20, '+40 HP', '#7dd8ff'); this.sounds.pickup(); }
        if (pk.kind === 'ammo') { p.ammo += 24; this.floater(pk.x, pk.y - 20, '+24 ammo', '#ffd24a'); this.sounds.pickup(); }
        this.save();
      }
    }
  }

  updateMission(dt) {
    const m = this.currentMission();
    if (!m) return;
    const s = this.currentStep();
    if (!s) return;
    const p = this.player;
    if (s.type === 'goto') {
      const t = SPOTS[s.spot];
      if (dist(p.x, p.y, t.x, t.y) < 70) {
        if (s.onArriveWanted) this.addWanted(s.onArriveWanted, 'Spotted!');
        this.completeStep();
      }
    } else if (s.type === 'wait') {
      this.missionWait += dt;
      if (this.missionWait >= s.seconds) this.completeStep();
    } else if (s.type === 'loseheat') {
      if (s.onStartWanted && !s.started) { s.started = true; this.addWanted(s.onStartWanted, 'Alarm tripped!'); }
      if (p.wanted === 0) this.completeStep();
    }
  }

  speedKmh() {
    const car = this.player.car;
    return car ? Math.round(Math.abs(car.speed) * 0.32) : 0;
  }
  clockString() {
    const mins = Math.floor(this.clockMin) % (24 * 60);
    const h = Math.floor(mins / 60); const m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
}

// Every sound in Neon Bay is synthesised with WebAudio. No audio files,
// no network, no samples: oscillators and filtered noise only.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTick = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return; // no audio device in this environment: the game plays silent
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // Engine: a sawtooth through a low-pass filter, pitch follows speed.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();

    // Police siren: a triangle wave alternating between two tones.
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 750;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
  }

  // speed01 is 0..1; driving is false on foot. The engine hums only in a car.
  setEngine(speed01, driving) {
    if (!this.ctx) return;
    if (this.muted || !driving) {
      this.engineGain.gain.value = 0;
      return;
    }
    this.engineGain.gain.value = 0.05 + speed01 * 0.06;
    this.engineOsc.frequency.value = 55 + speed01 * 160;
  }

  // level is 0..1 and follows the nearest cruiser: the siren swells as the
  // police close in and fades as you pull away.
  setSiren(on, level) {
    if (!this.ctx) return;
    const loud = on && !this.muted ? Math.max(0, Math.min(1, level == null ? 1 : level)) : 0;
    this.sirenGain.gain.value = loud * 0.05;
    if (on) {
      this.sirenTick += 1;
      this.sirenOsc.frequency.value = Math.floor(this.sirenTick / 22) % 2 === 0 ? 720 : 980;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol || 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  noise(dur, vol, cutoff) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff || 1200;
    const gain = this.ctx.createGain();
    gain.gain.value = vol || 0.3;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
  }

  shoot() { this.noise(0.16, 0.4, 2600); this.blip(180, 0.08, 'square', 0.15); }
  punch() { this.noise(0.08, 0.25, 500); }
  pickup() { this.blip(880, 0.12, 'sine', 0.22); setTimeout(() => this.blip(1320, 0.16, 'sine', 0.2), 70); }
  cash() { this.blip(660, 0.1, 'sine', 0.2); setTimeout(() => this.blip(990, 0.2, 'sine', 0.22), 90); }
  crash() { this.noise(0.25, 0.5, 320); this.blip(70, 0.25, 'sine', 0.35); }
  wanted() { this.blip(520, 0.15, 'square', 0.12); setTimeout(() => this.blip(390, 0.25, 'square', 0.12), 140); }
  mission() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.18, 'triangle', 0.22), i * 110)); }
  fail() { [400, 320, 240].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'sawtooth', 0.15), i * 130)); }
}

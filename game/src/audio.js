// All sound is synthesised live with the Web Audio API — no audio files, no
// network. Engine hum, gunshots, sirens, pickups and UI blips are small
// oscillator/noise recipes, so the game stays silent until the player first
// interacts (browsers require a gesture before audio starts).
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) { this.muted = m; if (m) this.stopEngine(); }

  tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  noise(dur, vol, lowpass) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = src;
    if (lowpass) {
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = lowpass;
      src.connect(filt); node = filt;
    }
    node.connect(gain).connect(this.ctx.destination);
    src.start(t);
  }

  blip() { this.tone(660, 0.07, 'sine', 0.12); }
  pickup() { this.tone(520, 0.09, 'sine', 0.16, 940); }
  cash() { this.tone(880, 0.08, 'sine', 0.14); setTimeout(() => this.tone(1320, 0.12, 'sine', 0.14), 70); }
  gunshot() { this.noise(0.14, 0.3, 1800); this.tone(140, 0.1, 'square', 0.18, 60); }
  thud() { this.noise(0.12, 0.2, 500); }
  crash() { this.noise(0.3, 0.35, 900); this.tone(90, 0.25, 'sawtooth', 0.2, 40); }
  alarm() { this.tone(440, 0.16, 'square', 0.12, 620); this.tone(620, 0.16, 'square', 0.12, 440); }
  missionDone() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'sine', 0.16), i * 110)); }
  fail() { this.tone(320, 0.3, 'sawtooth', 0.14, 140); }

  startEngine() {
    if (!this.ctx || this.muted || this.engineOsc) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 55;
    gain.gain.value = 0.045;
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    this.engineOsc = osc; this.engineGain = gain;
  }

  setEngine(speed01) {
    if (this.engineOsc) this.engineOsc.frequency.value = 50 + speed01 * 130;
  }

  stopEngine() {
    if (this.engineOsc) { try { this.engineOsc.stop(); } catch { /* already stopped */ } this.engineOsc = null; this.engineGain = null; }
  }

  startSiren() {
    if (!this.ctx || this.muted || this.sirenOsc) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = 700;
    gain.gain.value = 0.03;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.9;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(); lfo.start();
    this.sirenOsc = osc; this.sirenGain = gain; this.sirenLfo = lfo;
  }

  stopSiren() {
    if (this.sirenOsc) {
      try { this.sirenOsc.stop(); this.sirenLfo.stop(); } catch { /* already stopped */ }
      this.sirenOsc = null; this.sirenGain = null;
    }
  }
}

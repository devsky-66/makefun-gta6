// All sound is synthesised with WebAudio: no audio files, no network.
// Engine hum, police siren, gunshot, punch, pickup chime, crash thud, siren wail.
export class SoundBank {
  constructor() {
    this.ctx = null; this.muted = false;
    this.engineOsc = null; this.engineGain = null;
    this.sirenOsc = null; this.sirenGain = null; this.sirenTimer = 0;
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Looping engine oscillator, pitch follows speed.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 420;
      this.engineOsc.connect(filt); filt.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
      // Police siren oscillator, toggled between two tones.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 750;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setEngine(speed01, driving) {
    if (!this.ctx || this.muted) { if (this.engineGain) this.engineGain.gain.value = 0; return; }
    this.engineGain.gain.value = driving ? 0.05 + speed01 * 0.06 : 0;
    this.engineOsc.frequency.value = 55 + speed01 * 160;
  }
  setSiren(on) {
    if (!this.ctx) return;
    this.sirenGain.gain.value = on && !this.muted ? 0.045 : 0;
    if (on) {
      this.sirenTimer += 1;
      this.sirenOsc.frequency.value = (Math.floor(this.sirenTimer / 22) % 2 === 0) ? 720 : 980;
    }
  }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; return this.muted; }
  blip(freq, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }
  noise(dur, vol, freq) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = freq || 1200;
    const g = this.ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(filt); filt.connect(g); g.connect(this.master);
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

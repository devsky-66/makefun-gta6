// Every sound in Neon Bay Nights is synthesised live with the Web Audio API —
// no audio files, no network. Engine hum, siren wail, gunfire, pickups and
// crashes are all oscillators and filtered noise built at boot and driven by
// the game state each frame.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenLfo = null;
  let muted = false;
  let unlocked = false;

  // The context can only start after a user gesture; call this from any input.
  function unlock() {
    if (unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);

      // Engine: a low sawtooth whose pitch follows the car's speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();

      // Siren: a triangle wave swept up and down by a slow LFO.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenLfo = ctx.createOscillator();
      sirenLfo.type = 'sine';
      sirenLfo.frequency.value = 0.55;
      const sirenLfoGain = ctx.createGain();
      sirenLfoGain.gain.value = 260;
      sirenLfo.connect(sirenLfoGain);
      sirenLfoGain.connect(sirenOsc.frequency);
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      sirenLfo.start();
      unlocked = true;
    } catch {
      ctx = null;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ctx || muted) return;
    resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, vol, filterFreq) {
    if (!ctx || muted) return;
    resume();
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
  }

  return {
    unlock,
    resume,
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },
    isMuted() {
      return muted;
    },
    // Called every frame: engine pitch from speed, siren loudness from the
    // nearest police car's distance (0 = far away, 1 = on top of you).
    update(driving, speedRatio, sirenNearness) {
      if (!ctx || muted) return;
      resume();
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(driving ? 0.05 + 0.09 * speedRatio : 0, t, 0.08);
      engineOsc.frequency.setTargetAtTime(48 + 150 * speedRatio, t, 0.08);
      sirenGain.gain.setTargetAtTime(0.085 * sirenNearness, t, 0.15);
    },
    shoot() {
      noiseBurst(0.12, 0.5, 2600);
      blip(220, 0.08, 'square', 0.12, 60);
    },
    melee() {
      noiseBurst(0.09, 0.25, 1200);
    },
    pickup() {
      blip(660, 0.1, 'sine', 0.22);
      setTimeout(() => blip(990, 0.14, 'sine', 0.22), 70);
    },
    cash() {
      blip(880, 0.09, 'triangle', 0.22);
      setTimeout(() => blip(1174, 0.12, 'triangle', 0.22), 60);
      setTimeout(() => blip(1568, 0.16, 'triangle', 0.2), 130);
    },
    crash(strength) {
      noiseBurst(0.22, Math.min(0.6, 0.2 + strength * 0.4), 500);
      blip(90, 0.18, 'sine', 0.25, 40);
    },
    sirenBlip() {
      blip(700, 0.3, 'triangle', 0.15, 950);
    },
    missionDone() {
      blip(523, 0.14, 'triangle', 0.25);
      setTimeout(() => blip(659, 0.14, 'triangle', 0.25), 130);
      setTimeout(() => blip(784, 0.22, 'triangle', 0.25), 260);
    },
    missionFail() {
      blip(330, 0.2, 'sawtooth', 0.18, 180);
      setTimeout(() => blip(220, 0.3, 'sawtooth', 0.18, 120), 180);
    },
    busted() {
      blip(440, 0.25, 'square', 0.15, 220);
      setTimeout(() => blip(330, 0.4, 'square', 0.15, 165), 220);
    },
    click() {
      blip(1200, 0.05, 'sine', 0.12);
    },
  };
}

// Every sound in Neon Shores is synthesized with the Web Audio API — no audio files exist.
// A tiny synth engine hums under the car, sirens wail with an LFO, shots crack with filtered
// noise, and the radio plays endless procedural loops: each station is a chord progression,
// a bass line and an arpeggio pattern rendered note by note from a lookahead scheduler.

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freq(name, octave) {
  return 440 * Math.pow(2, (NOTE[name] + (octave - 4) * 12 - 9) / 12);
}

/** Chord progressions per radio style, as [root, quality] pairs; quality picks the triad. */
const PROGRESSIONS = {
  synthwave: [['A', 'min'], ['F', 'maj'], ['C', 'maj'], ['G', 'maj']],
  funk: [['E', 'min7'], ['E', 'min7'], ['A', 'min7'], ['B', 'dom7']],
  latin: [['D', 'min'], ['D', 'min'], ['A#', 'maj'], ['A', 'dom7']],
  chill: [['C', 'maj7'], ['A', 'min7'], ['F', 'maj7'], ['G', 'dom7']],
};
const TRIADS = { min: [0, 3, 7], maj: [0, 4, 7], min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10] };

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenLFO = null;
  let radioGain = null;
  let radioTimer = 0;
  let radioStep = 0;
  let station = null;

  /** Browsers only let audio start after a gesture: call this from the PLAY click. */
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    // The engine: two detuned oscillators through a lowpass, gain tied to speed.
    engineOsc = [ctx.createOscillator(), ctx.createOscillator()];
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc[0].type = 'sawtooth';
    engineOsc[1].type = 'square';
    engineOsc[0].connect(engineFilter);
    engineOsc[1].connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.forEach((osc) => osc.start());

    // The siren: a triangle whose pitch an LFO sweeps between two tones.
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenLFO = ctx.createOscillator();
    sirenLFO.frequency.value = 0.55;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    sirenLFO.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    sirenOsc.frequency.value = 830;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
    sirenLFO.start();

    radioGain = ctx.createGain();
    radioGain.gain.value = 0.16;
    radioGain.connect(master);
  }

  function blip(frequency, seconds, type, volume, slideTo) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + seconds);
    gain.gain.setValueAtTime(volume || 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + seconds);
  }

  function noise(seconds, volume, filterFreq, type) {
    if (!ctx) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type || 'highpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  function note(frequency, at, seconds, type, volume, destination) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(gain);
    gain.connect(destination || radioGain);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }

  /** Schedule one bar of the current station: chords, a walking bass and a sparkle arp. */
  function scheduleBar() {
    const chords = PROGRESSIONS[station.style];
    if (!chords) return;
    const bar = Math.floor(radioStep / 4) % chords.length;
    const beat = radioStep % 4;
    const [rootName, quality] = chords[bar];
    const root = freq(rootName, 2);
    const tones = TRIADS[quality];
    const t = ctx.currentTime + 0.06;
    if (beat === 0) {
      for (const step of tones) {
        const f = root * Math.pow(2, step / 12) * 2;
        note(f, t, 1.7, station.style === 'synthwave' ? 'sawtooth' : 'triangle', 0.05);
      }
    }
    // Bass on the beat, arp on the off-eighths.
    note(root, t, 0.42, 'square', 0.11);
    if (beat % 2 === 1) note(root * Math.pow(2, tones[2] / 12), t, 0.3, 'square', 0.07);
    for (let e = 0; e < 2; e += 1) {
      const tone = tones[(radioStep + e) % tones.length];
      note(root * Math.pow(2, tone / 12) * 4, t + e * 0.21, 0.16, 'sine', 0.045);
    }
    if (station.style === 'funk' && beat === 2) noise(0.05, 0.05, 6000);
    if (station.style === 'latin' && beat % 2 === 0) noise(0.04, 0.04, 5000);
  }

  return {
    unlock,
    /** Per-frame: engine pitch from speed, siren loudness from the nearest cruiser, radio. */
    update(dt, speedRatio, inVehicle, sirenLevel) {
      if (!ctx) return;
      const target = inVehicle ? 0.05 + Math.abs(speedRatio) * 0.1 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      const base = 55 + Math.abs(speedRatio) * 165;
      engineOsc[0].frequency.setTargetAtTime(base, ctx.currentTime, 0.05);
      engineOsc[1].frequency.setTargetAtTime(base * 0.5 + 2, ctx.currentTime, 0.05);
      sirenGain.gain.setTargetAtTime(Math.min(0.12, sirenLevel * 0.12), ctx.currentTime, 0.15);
      if (station && station.style !== 'off') {
        radioTimer -= dt;
        if (radioTimer <= 0) {
          radioTimer = 0.43;
          radioStep += 1;
          scheduleBar();
        }
      }
    },
    setStation(next) {
      station = next;
      radioStep = 0;
      radioTimer = 0;
      if (ctx && next && next.style !== 'off') blip(1200, 0.07, 'sine', 0.08);
    },
    shot() { noise(0.14, 0.3, 900, 'lowpass'); blip(160, 0.1, 'square', 0.12, 60); },
    dryFire() { blip(900, 0.04, 'square', 0.06, 300); },
    crash(strength) { noise(0.25, Math.min(0.4, 0.12 + strength * 0.3), 500, 'lowpass'); },
    pickup() { blip(880, 0.09, 'sine', 0.16); setTimeout(() => blip(1320, 0.12, 'sine', 0.16), 60); },
    cash() { blip(1560, 0.08, 'triangle', 0.18); setTimeout(() => blip(2090, 0.14, 'triangle', 0.18), 70); },
    mission() { blip(660, 0.12, 'triangle', 0.18); setTimeout(() => blip(990, 0.2, 'triangle', 0.18), 110); },
    alarm() { blip(520, 0.16, 'square', 0.1, 390); },
  };
}

// Virtual Instruments & Polyphonic Web Audio Synthesizer
// Works identically on both live AudioContext and OfflineAudioContext (for .wav export)

export const INSTRUMENT_PRESETS = [
  {
    id: "kick808",
    name: "808 Sub Kick",
    category: "Drum",
    color: "#ff5c5c",
    engine: "kick808",
    baseMidi: 36,
    synth: { cutoff: 400, resonance: 1.2, attack: 0.002, decay: 0.36, sustain: 0, release: 0.08, detune: 0, subMix: 0.5, fmAmount: 0 },
  },
  {
    id: "snare",
    name: "Crispy Snare",
    category: "Drum",
    color: "#ff9f43",
    engine: "snare",
    baseMidi: 38,
    synth: { cutoff: 3800, resonance: 1.5, attack: 0.001, decay: 0.19, sustain: 0, release: 0.05, detune: 0, subMix: 0, fmAmount: 0 },
  },
  {
    id: "clap",
    name: "909 Studio Clap",
    category: "Drum",
    color: "#feca57",
    engine: "clap",
    baseMidi: 39,
    synth: { cutoff: 2600, resonance: 2.2, attack: 0.001, decay: 0.22, sustain: 0, release: 0.06, detune: 0, subMix: 0, fmAmount: 0 },
  },
  {
    id: "hihat",
    name: "Closed Hi-Hat",
    category: "Drum",
    color: "#1dd1a1",
    engine: "hihat",
    baseMidi: 42,
    synth: { cutoff: 8500, resonance: 1.0, attack: 0.001, decay: 0.065, sustain: 0, release: 0.02, detune: 0, subMix: 0, fmAmount: 0 },
  },
  {
    id: "openhat",
    name: "Open Shimmer Hat",
    category: "Drum",
    color: "#00d2d3",
    engine: "openhat",
    baseMidi: 46,
    synth: { cutoff: 7800, resonance: 1.4, attack: 0.002, decay: 0.32, sustain: 0, release: 0.08, detune: 0, subMix: 0, fmAmount: 0 },
  },
  {
    id: "subbass",
    name: "Analog Reesebass",
    category: "Bass",
    color: "#54a0ff",
    engine: "synth",
    baseMidi: 36,
    synth: { waveform: "sawtooth", cutoff: 520, resonance: 4.5, attack: 0.008, decay: 0.24, sustain: 0.65, release: 0.12, detune: 11, subMix: 0.65, fmAmount: 0 },
  },
  {
    id: "fmkeys",
    name: "Velvet FM Keys",
    category: "Keys",
    color: "#a29bfe",
    engine: "fmkeys",
    baseMidi: 60,
    synth: { waveform: "sine", cutoff: 3400, resonance: 1.2, attack: 0.01, decay: 0.45, sustain: 0.42, release: 0.32, detune: 5, subMix: 0.15, fmAmount: 2.2 },
  },
  {
    id: "cyberlead",
    name: "Neon SuperSaw Lead",
    category: "Synth",
    color: "#ff6bcb",
    engine: "synth",
    baseMidi: 60,
    synth: { waveform: "sawtooth", cutoff: 4200, resonance: 3.2, attack: 0.012, decay: 0.28, sustain: 0.72, release: 0.22, detune: 18, subMix: 0.25, fmAmount: 0 },
  },
  {
    id: "lushpad",
    name: "Horizon Lush Pad",
    category: "Pad",
    color: "#48dbfb",
    engine: "synth",
    baseMidi: 60,
    synth: { waveform: "triangle", cutoff: 1900, resonance: 1.8, attack: 0.18, decay: 0.6, sustain: 0.8, release: 0.65, detune: 22, subMix: 0.35, fmAmount: 0 },
  },
  {
    id: "pluckarp",
    name: "Crystal Pluck",
    category: "Synth",
    color: "#badc58",
    engine: "fmkeys",
    baseMidi: 60,
    synth: { waveform: "triangle", cutoff: 5200, resonance: 2.4, attack: 0.003, decay: 0.22, sustain: 0.08, release: 0.18, detune: 7, subMix: 0.1, fmAmount: 3.5 },
  },
];

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

const noiseCache = new WeakMap();
export function getNoiseBuffer(ctx) {
  if (noiseCache.has(ctx)) return noiseCache.get(ctx);
  const length = Math.floor(ctx.sampleRate * 1.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

export function triggerInstrumentVoice(ctx, destNode, channel, midi, time, durationSec = 0.2, velocity = 0.85) {
  const t = Math.max(ctx.currentTime || 0, time);
  const vel = Math.max(0.05, Math.min(1.0, velocity));
  const s = channel.synth || {};
  const engine = channel.engine || "synth";

  if (engine === "kick808") {
    const pitchRatio = Math.pow(2, ((midi || 36) - 36) / 12);
    const osc = ctx.createOscillator();
    const clickOsc = ctx.createOscillator();
    const gain = ctx.createGain();
    const clickGain = ctx.createGain();

    const decay = Math.max(0.12, s.decay ?? 0.36);
    osc.type = "sine";
    osc.frequency.setValueAtTime(148 * pitchRatio, t);
    osc.frequency.exponentialRampToValueAtTime(52 * pitchRatio, t + 0.045);
    osc.frequency.exponentialRampToValueAtTime(34 * pitchRatio, t + decay);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vel * 1.05, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay + 0.05);

    clickOsc.type = "triangle";
    clickOsc.frequency.setValueAtTime(320 * pitchRatio, t);
    clickOsc.frequency.exponentialRampToValueAtTime(60, t + 0.02);
    clickGain.gain.setValueAtTime(vel * 0.35, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);

    osc.connect(gain);
    clickOsc.connect(clickGain);
    gain.connect(destNode);
    clickGain.connect(destNode);

    osc.start(t);
    clickOsc.start(t);
    osc.stop(t + decay + 0.07);
    clickOsc.stop(t + 0.03);
    return;
  }

  if (engine === "snare") {
    const decay = Math.max(0.08, s.decay ?? 0.19);
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(s.cutoff || 3200, t);
    filter.Q.setValueAtTime(0.9, t);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vel * 0.75, t);
    nGain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    const body = ctx.createOscillator();
    const bGain = ctx.createGain();
    const pitchRatio = Math.pow(2, ((midi || 38) - 38) / 12);
    body.type = "triangle";
    body.frequency.setValueAtTime(210 * pitchRatio, t);
    body.frequency.exponentialRampToValueAtTime(115 * pitchRatio, t + 0.07);
    bGain.gain.setValueAtTime(vel * 0.55, t);
    bGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(destNode);

    body.connect(bGain);
    bGain.connect(destNode);

    noise.start(t);
    body.start(t);
    noise.stop(t + decay + 0.03);
    body.stop(t + 0.11);
    return;
  }

  if (engine === "clap") {
    const decay = Math.max(0.1, s.decay ?? 0.22);
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(s.cutoff || 1800, t);
    bp.Q.setValueAtTime(1.8, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    // Triple micro-burst for authentic 909 clap
    gain.gain.setValueAtTime(vel * 0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.010);
    gain.gain.setValueAtTime(vel * 0.65, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.022);
    gain.gain.setValueAtTime(vel * 0.78, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(destNode);

    noise.start(t);
    noise.stop(t + decay + 0.03);
    return;
  }

  if (engine === "hihat" || engine === "openhat") {
    const decay = engine === "openhat" ? Math.max(0.18, s.decay ?? 0.32) : Math.max(0.03, s.decay ?? 0.065);
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(s.cutoff || 7800, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.52, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    noise.connect(hp);
    hp.connect(gain);
    gain.connect(destNode);

    noise.start(t);
    noise.stop(t + decay + 0.02);
    return;
  }

  // Melodic Engines: "synth" (Dual-Osc + Sub) & "fmkeys" (2-Op FM)
  const freq = midiToFreq(midi || 60);
  const attack = Math.max(0.002, Number(s.attack ?? 0.01));
  const decay = Math.max(0.02, Number(s.decay ?? 0.25));
  const sustain = Math.max(0.0, Math.min(1.0, Number(s.sustain ?? 0.6)));
  const release = Math.max(0.02, Number(s.release ?? 0.2));
  const cutoff = Math.max(80, Math.min(16000, Number(s.cutoff ?? 3200)));
  const resonance = Math.max(0.1, Math.min(18, Number(s.resonance ?? 1.5)));
  const detune = Number(s.detune ?? 10);
  const subMix = Math.max(0, Math.min(1, Number(s.subMix ?? 0.2)));
  const noteHold = Math.max(0.04, durationSec);
  const offTime = t + noteHold;
  const endTime = offTime + release + 0.05;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.setValueAtTime(resonance, t);
  filter.frequency.setValueAtTime(Math.min(16000, cutoff * 1.45), t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff), t + attack + decay);

  const env = ctx.createGain();
  const peak = vel * 0.42;
  const susLevel = Math.max(0.0002, peak * sustain);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(peak, t + attack);
  env.gain.exponentialRampToValueAtTime(susLevel, t + attack + decay);
  env.gain.setValueAtTime(susLevel, Math.max(t + attack + decay, offTime));
  env.gain.exponentialRampToValueAtTime(0.0001, offTime + release);

  filter.connect(env);
  env.connect(destNode);

  if (engine === "fmkeys") {
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();

    carrier.type = s.waveform || "sine";
    carrier.frequency.setValueAtTime(freq, t);

    mod.type = "sine";
    mod.frequency.setValueAtTime(freq * 2.0, t);
    const fmIndex = (s.fmAmount ?? 2.0) * freq;
    modGain.gain.setValueAtTime(fmIndex, t);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, fmIndex * 0.2), t + decay + 0.15);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(filter);

    mod.start(t);
    carrier.start(t);
    mod.stop(endTime);
    carrier.stop(endTime);
    return;
  }

  // Dual detuned oscillator + Sub-oscillator synth
  const wave = s.waveform || "sawtooth";
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = wave;
  osc2.type = wave;
  osc1.frequency.setValueAtTime(freq, t);
  osc2.frequency.setValueAtTime(freq, t);
  osc1.detune.setValueAtTime(-detune, t);
  osc2.detune.setValueAtTime(detune, t);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.55, t);
  osc1.connect(oscGain);
  osc2.connect(oscGain);
  oscGain.connect(filter);

  osc1.start(t);
  osc2.start(t);
  osc1.stop(endTime);
  osc2.stop(endTime);

  if (subMix > 0.02) {
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(freq * 0.5, t);
    subGain.gain.setValueAtTime(subMix * 0.55, t);
    subOsc.connect(subGain);
    subGain.connect(filter);
    subOsc.start(t);
    subOsc.stop(endTime);
  }
}

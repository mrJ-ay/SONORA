// Virtual Instruments, Sampler, SoundFont2 & Drum Kit Synthesis Engine
// Works identically on live AudioContext and OfflineAudioContext (.wav export)
import { getSampleAudioBuffer, getSf2ZoneForNote } from "./externalLoader.js";

export const DRUM_ROWS = [
  { key: "kick808", name: "808 Kick", color: "#ff5c5c", engine: "kick808", baseMidi: 36, synth: { decay: 0.36 } },
  { key: "snare",   name: "Crispy Snare", color: "#ff9f43", engine: "snare", baseMidi: 38, synth: { cutoff: 3400, decay: 0.19 } },
  { key: "clap",    name: "909 Clap", color: "#feca57", engine: "clap", baseMidi: 39, synth: { cutoff: 2200, decay: 0.22 } },
  { key: "hihat",   name: "Closed Hat", color: "#1dd1a1", engine: "hihat", baseMidi: 42, synth: { cutoff: 8200, decay: 0.065 } },
  { key: "openhat", name: "Open Hat", color: "#00d2d3", engine: "openhat", baseMidi: 46, synth: { cutoff: 7600, decay: 0.32 } },
];

export const AVAILABLE_DRUM_SOUNDS = [
  { id: "kick808",   name: "808 Kick",         category: "Kick",       color: "#ff5c5c", engine: "kick808",   baseMidi: 36, synth: { decay: 0.38 } },
  { id: "snare",     name: "Crispy Snare",     category: "Snare",      color: "#ff9f43", engine: "snare",     baseMidi: 38, synth: { cutoff: 3400, decay: 0.19 } },
  { id: "clap",      name: "909 Clap",         category: "Clap",       color: "#feca57", engine: "clap",      baseMidi: 39, synth: { cutoff: 2200, decay: 0.22 } },
  { id: "hihat",     name: "Closed Hat",       category: "Hi-Hat",     color: "#1dd1a1", engine: "hihat",     baseMidi: 42, synth: { cutoff: 8200, decay: 0.065 } },
  { id: "openhat",   name: "Open Hat",         category: "Hi-Hat",     color: "#00d2d3", engine: "openhat",   baseMidi: 46, synth: { cutoff: 7600, decay: 0.32 } },
  { id: "rimshot",   name: "Woody Rimshot",    category: "Snare/Rim",  color: "#e17055", engine: "rimshot",   baseMidi: 37, synth: { cutoff: 2100, decay: 0.08 } },
  { id: "tom_hi",    name: "High Tom",         category: "Toms",       color: "#6c5ce7", engine: "tom",       baseMidi: 50, synth: { pitch: 185, decay: 0.28 } },
  { id: "tom_mid",   name: "Mid Tom",          category: "Toms",       color: "#a29bfe", engine: "tom",       baseMidi: 47, synth: { pitch: 135, decay: 0.32 } },
  { id: "tom_low",   name: "Floor Low Tom",    category: "Toms",       color: "#575fcf", engine: "tom",       baseMidi: 43, synth: { pitch: 95, decay: 0.38 } },
  { id: "crash",     name: "Crash Cymbal",     category: "Cymbals",    color: "#fdcb6e", engine: "crash",     baseMidi: 49, synth: { cutoff: 5500, decay: 0.85 } },
  { id: "ride",      name: "Ride Cymbal",      category: "Cymbals",    color: "#ffeaa7", engine: "ride",      baseMidi: 51, synth: { cutoff: 7400, decay: 0.45 } },
  { id: "cowbell",   name: "808 Cowbell",      category: "Percussion", color: "#fab1a0", engine: "cowbell",   baseMidi: 56, synth: { decay: 0.22 } },
  { id: "shaker",    name: "Groove Shaker",    category: "Percussion", color: "#55efc4", engine: "shaker",    baseMidi: 70, synth: { decay: 0.07 } },
  { id: "perc",      name: "Afro Conga",       category: "Percussion", color: "#00b894", engine: "perc",      baseMidi: 63, synth: { pitch: 240, decay: 0.18 } },
  { id: "sub_boom",  name: "808 Sub Boom",     category: "Bass/Sub",   color: "#ff7675", engine: "sub_boom",  baseMidi: 33, synth: { decay: 0.75 } },
  { id: "synth_zap", name: "Electro Zap",      category: "FX/Zap",     color: "#fd79a8", engine: "synth_zap", baseMidi: 64, synth: { decay: 0.14 } },
];

export const INSTRUMENT_PRESETS = [
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
    id: "subbass",
    name: "Analog Reesebass",
    category: "Bass",
    color: "#54a0ff",
    engine: "synth",
    baseMidi: 36,
    synth: { waveform: "sawtooth", cutoff: 520, resonance: 4.5, attack: 0.008, decay: 0.24, sustain: 0.65, release: 0.12, detune: 11, subMix: 0.65, fmAmount: 0 },
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
    category: "Pluck",
    color: "#badc58",
    engine: "fmkeys",
    baseMidi: 60,
    synth: { waveform: "triangle", cutoff: 5200, resonance: 2.4, attack: 0.003, decay: 0.22, sustain: 0.08, release: 0.18, detune: 7, subMix: 0.1, fmAmount: 3.5 },
  },
  {
    id: "acidbass",
    name: "303 Acid Bass",
    category: "Bass",
    color: "#feca57",
    engine: "synth",
    baseMidi: 36,
    synth: { waveform: "square", cutoff: 950, resonance: 9.5, attack: 0.004, decay: 0.2, sustain: 0.25, release: 0.09, detune: 4, subMix: 0.3, fmAmount: 0 },
  },
  {
    id: "chiptune",
    name: "8-Bit Retro Pulse",
    category: "Synth",
    color: "#ff9f43",
    engine: "synth",
    baseMidi: 60,
    synth: { waveform: "square", cutoff: 6500, resonance: 1.0, attack: 0.003, decay: 0.16, sustain: 0.5, release: 0.08, detune: 2, subMix: 0, fmAmount: 0 },
  },
  {
    id: "grandpiano",
    name: "Concert Grand Piano",
    category: "Keys",
    color: "#e056fd",
    engine: "fmkeys",
    baseMidi: 60,
    synth: { waveform: "sine", cutoff: 5200, resonance: 1.0, attack: 0.005, decay: 0.7, sustain: 0.3, release: 0.45, detune: 4, subMix: 0.1, fmAmount: 2.6 },
  },
  {
    id: "sub808_boom",
    name: "808 Trap Sub Bass",
    category: "Bass",
    color: "#ff5252",
    engine: "kick808",
    baseMidi: 36,
    synth: { decay: 0.95 },
  },
];

export const AVAILABLE_MELODIC_INSTRUMENTS = [
  {
    id: "sub808_boom",
    name: "808 Trap Sub Bass",
    category: "Bass & 808",
    color: "#ff5252",
    engine: "kick808",
    baseMidi: 36,
    isMelodic: true,
    synth: { decay: 0.95 },
  },
  {
    id: "subbass",
    name: "Analog Reesebass",
    category: "Bass & 808",
    color: "#54a0ff",
    engine: "synth",
    baseMidi: 36,
    isMelodic: true,
    synth: { waveform: "sawtooth", cutoff: 520, resonance: 4.5, attack: 0.008, decay: 0.24, sustain: 0.65, release: 0.12, detune: 11, subMix: 0.65, fmAmount: 0 },
  },
  {
    id: "acidbass",
    name: "303 Acid Bass",
    category: "Bass & 808",
    color: "#feca57",
    engine: "synth",
    baseMidi: 36,
    isMelodic: true,
    synth: { waveform: "square", cutoff: 950, resonance: 9.5, attack: 0.004, decay: 0.2, sustain: 0.25, release: 0.09, detune: 4, subMix: 0.3, fmAmount: 0 },
  },
  {
    id: "grandpiano",
    name: "Concert Grand Piano",
    category: "Keys & Piano",
    color: "#e056fd",
    engine: "fmkeys",
    baseMidi: 60,
    isMelodic: true,
    synth: { waveform: "sine", cutoff: 5200, resonance: 1.0, attack: 0.005, decay: 0.7, sustain: 0.3, release: 0.45, detune: 4, subMix: 0.1, fmAmount: 2.6 },
  },
  {
    id: "fmkeys",
    name: "Velvet FM Keys",
    category: "Keys & Piano",
    color: "#a29bfe",
    engine: "fmkeys",
    baseMidi: 60,
    isMelodic: true,
    synth: { waveform: "sine", cutoff: 3400, resonance: 1.2, attack: 0.01, decay: 0.45, sustain: 0.42, release: 0.32, detune: 5, subMix: 0.15, fmAmount: 2.2 },
  },
  {
    id: "cyberlead",
    name: "Neon SuperSaw Lead",
    category: "Synths & Leads",
    color: "#ff6bcb",
    engine: "synth",
    baseMidi: 60,
    isMelodic: true,
    synth: { waveform: "sawtooth", cutoff: 4200, resonance: 3.2, attack: 0.012, decay: 0.28, sustain: 0.72, release: 0.22, detune: 18, subMix: 0.25, fmAmount: 0 },
  },
  {
    id: "pluckarp",
    name: "Crystal Pluck",
    category: "Synths & Leads",
    color: "#badc58",
    engine: "fmkeys",
    baseMidi: 60,
    isMelodic: true,
    synth: { waveform: "triangle", cutoff: 5200, resonance: 2.4, attack: 0.003, decay: 0.22, sustain: 0.08, release: 0.18, detune: 7, subMix: 0.1, fmAmount: 3.5 },
  },
  {
    id: "lushpad",
    name: "Horizon Lush Pad",
    category: "Pads & Atmos",
    color: "#48dbfb",
    engine: "synth",
    baseMidi: 60,
    isMelodic: true,
    synth: { waveform: "triangle", cutoff: 1900, resonance: 1.8, attack: 0.18, decay: 0.6, sustain: 0.8, release: 0.65, detune: 22, subMix: 0.35, fmAmount: 0 },
  },
  {
    id: "chiptune",
    name: "8-Bit Retro Pulse",
    category: "Synths & Leads",
    color: "#ff9f43",
    engine: "synth",
    baseMidi: 60,
    isMelodic: true,
    synth: { waveform: "square", cutoff: 6500, resonance: 1.0, attack: 0.003, decay: 0.16, sustain: 0.5, release: 0.08, detune: 2, subMix: 0, fmAmount: 0 },
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

export function triggerInstrumentVoice(ctx, destNode, voiceSpec, midi, time, durationSec = 0.2, velocity = 0.85) {
  const t = Math.max(ctx.currentTime || 0, time);
  const vel = Math.max(0.05, Math.min(1.0, velocity));
  const s = voiceSpec.synth || {};
  const engine = voiceSpec.engine || "synth";

  if (voiceSpec.drumSampleId) {
    const smpBuf = getSampleAudioBuffer(ctx, voiceSpec.drumSampleId);
    if (smpBuf) {
      const src = ctx.createBufferSource();
      src.buffer = smpBuf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vel * 0.95, t);
      src.connect(gain);
      gain.connect(destNode);
      src.start(t);
      return;
    }
  }

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
    body.type = "triangle";
    body.frequency.setValueAtTime(210, t);
    body.frequency.exponentialRampToValueAtTime(115, t + 0.07);
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

  if (engine === "rimshot") {
    const decay = Math.max(0.04, s.decay ?? 0.08);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(840, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.02);
    gain.gain.setValueAtTime(vel * 0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(s.cutoff || 2100, t);
    filter.Q.setValueAtTime(2.8, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vel * 0.55, t);
    nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);

    osc.connect(gain);
    gain.connect(destNode);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(destNode);

    osc.start(t);
    noise.start(t);
    osc.stop(t + decay + 0.02);
    noise.stop(t + 0.05);
    return;
  }

  if (engine === "tom") {
    const startFreq = Number(s.pitch ?? (midi ? midiToFreq(midi) : 130));
    const decay = Math.max(0.12, s.decay ?? 0.3);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(startFreq * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(startFreq, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, startFreq * 0.65), t + decay);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vel * 0.95, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    const click = ctx.createOscillator();
    const cGain = ctx.createGain();
    click.type = "triangle";
    click.frequency.setValueAtTime(380, t);
    click.frequency.exponentialRampToValueAtTime(70, t + 0.02);
    cGain.gain.setValueAtTime(vel * 0.35, t);
    cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);

    osc.connect(gain);
    gain.connect(destNode);
    click.connect(cGain);
    cGain.connect(destNode);

    osc.start(t);
    click.start(t);
    osc.stop(t + decay + 0.03);
    click.stop(t + 0.04);
    return;
  }

  if (engine === "crash") {
    const decay = Math.max(0.4, s.decay ?? 0.85);
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(s.cutoff || 5500, t);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(8000, t);
    bp.Q.setValueAtTime(1.2, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.7, t);
    gain.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    noise.connect(hp);
    hp.connect(bp);
    bp.connect(gain);
    gain.connect(destNode);

    noise.start(t);
    noise.stop(t + decay + 0.05);
    return;
  }

  if (engine === "ride") {
    const decay = Math.max(0.2, s.decay ?? 0.45);
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "square";
    osc2.type = "square";
    osc1.frequency.setValueAtTime(587, t);
    osc2.frequency.setValueAtTime(845, t);

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(7400, t);
    bp.Q.setValueAtTime(4.0, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc1.connect(bp);
    osc2.connect(bp);
    bp.connect(gain);
    gain.connect(destNode);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + decay + 0.02);
    osc2.stop(t + decay + 0.02);
    return;
  }

  if (engine === "cowbell") {
    const decay = Math.max(0.1, s.decay ?? 0.22);
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "square";
    osc2.type = "square";
    osc1.frequency.setValueAtTime(587, t);
    osc2.frequency.setValueAtTime(845, t);

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2600, t);
    bp.Q.setValueAtTime(2.5, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.75, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc1.connect(bp);
    osc2.connect(bp);
    bp.connect(gain);
    gain.connect(destNode);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + decay + 0.02);
    osc2.stop(t + decay + 0.02);
    return;
  }

  if (engine === "shaker") {
    const decay = Math.max(0.04, s.decay ?? 0.07);
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(9200, t);
    bp.Q.setValueAtTime(3.2, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vel * 0.58, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(destNode);

    noise.start(t);
    noise.stop(t + decay + 0.02);
    return;
  }

  if (engine === "perc") {
    const decay = Math.max(0.08, s.decay ?? 0.18);
    const startFreq = Number(s.pitch ?? 240);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(startFreq * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(startFreq, t + 0.035);

    gain.gain.setValueAtTime(vel * 0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(gain);
    gain.connect(destNode);

    osc.start(t);
    osc.stop(t + decay + 0.02);
    return;
  }

  if (engine === "sub_boom") {
    const decay = Math.max(0.35, s.decay ?? 0.75);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(85, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.09);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vel * 1.1, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(gain);
    gain.connect(destNode);

    osc.start(t);
    osc.stop(t + decay + 0.03);
    return;
  }

  if (engine === "synth_zap") {
    const decay = Math.max(0.08, s.decay ?? 0.14);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(1600, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + decay);

    gain.gain.setValueAtTime(vel * 0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(gain);
    gain.connect(destNode);

    osc.start(t);
    osc.stop(t + decay + 0.02);
    return;
  }

  // Melodic Engines
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

  if (engine === "sampler" && voiceSpec.sampleId) {
    const smpBuf = getSampleAudioBuffer(ctx, voiceSpec.sampleId);
    if (smpBuf) {
      const rootMidi = Number(voiceSpec.rootMidi ?? s.rootMidi ?? 60);
      const rate = Math.pow(2, ((midi || 60) - rootMidi + detune / 100) / 12);
      const src = ctx.createBufferSource();
      src.buffer = smpBuf;
      src.playbackRate.setValueAtTime(Math.max(0.0625, Math.min(16, rate)), t);
      if (s.loopSample) {
        src.loop = true;
        src.loopStart = Math.max(0, Number(s.trimStart ?? 0) * smpBuf.duration);
        src.loopEnd = Math.max(src.loopStart + 0.01, Number(s.trimEnd ?? 1) * smpBuf.duration);
      }
      const boost = ctx.createGain();
      boost.gain.setValueAtTime(1.65, t);
      src.connect(boost);
      boost.connect(filter);
      const offsetSec = Math.max(0, Math.min(smpBuf.duration - 0.01, Number(s.trimStart ?? 0) * smpBuf.duration));
      src.start(t, offsetSec);
      src.stop(endTime);
      return;
    }
  }

  if (engine === "sf2" && voiceSpec.sf2Id) {
    const found = getSf2ZoneForNote(ctx, voiceSpec.sf2Id, voiceSpec.sf2InstIndex || 0, midi || 60);
    if (found) {
      const { zone, buffer } = found;
      const rate = Math.pow(2, ((midi || 60) - zone.rootMidi + detune / 100) / 12);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.setValueAtTime(Math.max(0.0625, Math.min(16, rate)), t);
      if (zone.loop) {
        src.loop = true;
        src.loopStart = zone.loopStart;
        src.loopEnd = zone.loopEnd;
      }
      const boost = ctx.createGain();
      boost.gain.setValueAtTime(1.8, t);
      src.connect(boost);
      boost.connect(filter);
      src.start(t);
      src.stop(endTime);
      return;
    }
  }

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

import { INSTRUMENT_PRESETS } from "../audio/instruments.js";

export function cloneChannelFromPreset(presetId, customId, overrides = {}) {
  const preset = INSTRUMENT_PRESETS.find((p) => p.id === presetId) || INSTRUMENT_PRESETS[0];
  return {
    id: customId || `${preset.id}_${Math.random().toString(36).slice(2, 6)}`,
    presetId: preset.id,
    name: overrides.name || preset.name,
    category: preset.category,
    color: overrides.color || preset.color,
    engine: preset.engine,
    baseMidi: preset.baseMidi,
    volume: overrides.volume ?? 0.8,
    pan: overrides.pan ?? 0,
    muted: false,
    solo: false,
    reverbSend: overrides.reverbSend ?? (preset.category === "Drum" ? 0.06 : 0.24),
    delaySend: overrides.delaySend ?? (preset.category === "Synth" ? 0.22 : 0.04),
    synth: { ...preset.synth, ...(overrides.synth || {}) },
  };
}

function emptySteps(len = 16) {
  return new Array(len).fill(0);
}

export function createBlankProject() {
  const channels = [
    cloneChannelFromPreset("kick808", "ch_kick", { volume: 0.9, reverbSend: 0.02 }),
    cloneChannelFromPreset("snare", "ch_snare", { volume: 0.78, reverbSend: 0.14 }),
    cloneChannelFromPreset("hihat", "ch_hat", { volume: 0.65, pan: -0.15 }),
    cloneChannelFromPreset("openhat", "ch_ohat", { volume: 0.6, pan: 0.2 }),
    cloneChannelFromPreset("subbass", "ch_bass", { volume: 0.82, reverbSend: 0.05 }),
    cloneChannelFromPreset("fmkeys", "ch_keys", { volume: 0.72, pan: -0.12, reverbSend: 0.3 }),
    cloneChannelFromPreset("cyberlead", "ch_lead", { volume: 0.7, pan: 0.12, delaySend: 0.28 }),
  ];

  const pat1Steps = {};
  const pat1Notes = {};
  for (const c of channels) {
    pat1Steps[c.id] = emptySteps(16);
    pat1Notes[c.id] = [];
  }

  return {
    projectId: null,
    title: "Untitled Beat",
    bpm: 120,
    swing: 0,
    masterVolume: 0.88,
    selectedChannelId: "ch_lead",
    activePatternId: "pat_1",
    scale: "minor",
    channels,
    patterns: [
      { id: "pat_1", name: "Pattern 1", color: "#ff6bcb", lengthSteps: 16, steps: pat1Steps, notes: pat1Notes },
      { id: "pat_2", name: "Pattern 2", color: "#54a0ff", lengthSteps: 16, steps: JSON.parse(JSON.stringify(pat1Steps)), notes: JSON.parse(JSON.stringify(pat1Notes)) },
    ],
    arrangement: [
      { id: "clip_1", track: 0, bar: 0, lengthBars: 4, patternId: "pat_1" },
    ],
  };
}

export function createDemoNeonDrive() {
  const channels = [
    cloneChannelFromPreset("kick808", "ch_kick", { name: "808 Punch Kick", volume: 0.92, reverbSend: 0.02 }),
    cloneChannelFromPreset("snare", "ch_snare", { name: "Gated Snare", volume: 0.82, reverbSend: 0.26 }),
    cloneChannelFromPreset("hihat", "ch_hat", { name: "16th Hat", volume: 0.62, pan: -0.18 }),
    cloneChannelFromPreset("clap", "ch_clap", { name: "909 Clap", volume: 0.7, pan: 0.15, reverbSend: 0.22 }),
    cloneChannelFromPreset("subbass", "ch_bass", { name: "Driving Saw Bass", volume: 0.82, reverbSend: 0.04 }),
    cloneChannelFromPreset("lushpad", "ch_pad", { name: "Analog Horizon Pad", volume: 0.68, pan: -0.1, reverbSend: 0.42 }),
    cloneChannelFromPreset("cyberlead", "ch_lead", { name: "Neon Arp Lead", volume: 0.74, pan: 0.12, delaySend: 0.34, reverbSend: 0.28 }),
  ];

  const makePat = (id, name, color) => {
    const steps = {};
    const notes = {};
    for (const c of channels) {
      steps[c.id] = emptySteps(16);
      notes[c.id] = [];
    }
    return { id, name, color, lengthSteps: 16, steps, notes };
  };

  // Pattern 1: Synthwave Drum Groove
  const pDrums = makePat("pat_drums", "1 · Drum Groove", "#ff5c5c");
  pDrums.steps.ch_kick =  [0.95, 0, 0, 0, 0.9, 0, 0, 0, 0.95, 0, 0.75, 0, 0.9, 0, 0, 0];
  pDrums.steps.ch_snare = [0, 0, 0, 0, 0.92, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0.55];
  pDrums.steps.ch_clap =  [0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0];
  pDrums.steps.ch_hat =   [0.7, 0.45, 0.8, 0.45, 0.7, 0.45, 0.85, 0.5, 0.7, 0.45, 0.8, 0.45, 0.7, 0.5, 0.9, 0.6];

  // Pattern 2: A-Minor / F-Major Driving Bassline
  const pBass = makePat("pat_bass", "2 · Night Bass", "#54a0ff");
  const bassPitches = [45, 45, 57, 45, 45, 45, 57, 45, 41, 41, 53, 41, 43, 43, 55, 43];
  pBass.notes.ch_bass = bassPitches.map((midi, idx) => ({
    id: `bn_${idx}`,
    midi,
    start: idx,
    length: 1,
    velocity: idx % 2 === 0 ? 0.88 : 0.72,
  }));

  // Pattern 3: Lush Synth Chords (Am7 -> Fmaj7)
  const pChords = makePat("pat_chords", "3 · Lush Chords", "#48dbfb");
  pChords.notes.ch_pad = [
    // Am7 (bars beat 1-2)
    { id: "c1", midi: 57, start: 0, length: 8, velocity: 0.72 },
    { id: "c2", midi: 60, start: 0, length: 8, velocity: 0.70 },
    { id: "c3", midi: 64, start: 0, length: 8, velocity: 0.72 },
    { id: "c4", midi: 67, start: 0, length: 8, velocity: 0.68 },
    // Fmaj7 / G (beat 3-4)
    { id: "c5", midi: 53, start: 8, length: 4, velocity: 0.72 },
    { id: "c6", midi: 57, start: 8, length: 4, velocity: 0.70 },
    { id: "c7", midi: 60, start: 8, length: 4, velocity: 0.70 },
    { id: "c8", midi: 64, start: 8, length: 4, velocity: 0.72 },
    { id: "c9", midi: 55, start: 12, length: 4, velocity: 0.75 },
    { id: "c10", midi: 59, start: 12, length: 4, velocity: 0.72 },
    { id: "c11", midi: 62, start: 12, length: 4, velocity: 0.72 },
    { id: "c12", midi: 67, start: 12, length: 4, velocity: 0.74 },
  ];

  // Pattern 4: Neon Lead Hook
  const pLead = makePat("pat_lead", "4 · Neon Lead Hook", "#ff6bcb");
  pLead.notes.ch_lead = [
    { id: "l1", midi: 69, start: 0, length: 3, velocity: 0.86 },
    { id: "l2", midi: 72, start: 3, length: 3, velocity: 0.84 },
    { id: "l3", midi: 76, start: 6, length: 2, velocity: 0.90 },
    { id: "l4", midi: 74, start: 8, length: 3, velocity: 0.84 },
    { id: "l5", midi: 72, start: 11, length: 2, velocity: 0.80 },
    { id: "l6", midi: 67, start: 13, length: 3, velocity: 0.85 },
  ];

  return {
    projectId: null,
    title: "Neon Drive 1984",
    bpm: 118,
    swing: 8,
    masterVolume: 0.88,
    selectedChannelId: "ch_lead",
    activePatternId: "pat_lead",
    scale: "minor",
    channels,
    patterns: [pDrums, pBass, pChords, pLead],
    arrangement: [
      // Track 0: Drums (Bars 1..7)
      { id: "cl_1", track: 0, bar: 1, lengthBars: 7, patternId: "pat_drums" },
      // Track 1: Bass (Bars 0..7)
      { id: "cl_2", track: 1, bar: 0, lengthBars: 8, patternId: "pat_bass" },
      // Track 2: Chords (Bars 0..7)
      { id: "cl_3", track: 2, bar: 0, lengthBars: 8, patternId: "pat_chords" },
      // Track 3: Lead Hook (Bars 2..5 & 6..7)
      { id: "cl_4", track: 3, bar: 2, lengthBars: 4, patternId: "pat_lead" },
      { id: "cl_5", track: 3, bar: 6, lengthBars: 2, patternId: "pat_lead" },
    ],
  };
}

export function createDemoSeoulTrap() {
  const channels = [
    cloneChannelFromPreset("kick808", "ch_kick", { name: "Booming 808", volume: 0.95, synth: { decay: 0.55 } }),
    cloneChannelFromPreset("clap", "ch_clap", { name: "Trap Clap", volume: 0.84 }),
    cloneChannelFromPreset("hihat", "ch_hat", { name: "Rapid Hat", volume: 0.68, pan: -0.12 }),
    cloneChannelFromPreset("openhat", "ch_ohat", { name: "Accent Open Hat", volume: 0.64, pan: 0.22 }),
    cloneChannelFromPreset("pluckarp", "ch_pluck", { name: "Dark Koto Pluck", volume: 0.78, delaySend: 0.32, reverbSend: 0.34 }),
    cloneChannelFromPreset("fmkeys", "ch_keys", { name: "Midnight Bell", volume: 0.68, reverbSend: 0.38 }),
  ];

  const makePat = (id, name, color) => {
    const steps = {};
    const notes = {};
    for (const c of channels) {
      steps[c.id] = emptySteps(16);
      notes[c.id] = [];
    }
    return { id, name, color, lengthSteps: 16, steps, notes };
  };

  const pBeat = makePat("pat_beat", "1 · 808 Trap Beat", "#ff9f43");
  pBeat.steps.ch_kick = [0.98, 0, 0, 0.82, 0, 0, 0.9, 0, 0, 0, 0.94, 0, 0, 0, 0.78, 0];
  pBeat.steps.ch_clap = [0, 0, 0, 0, 0.92, 0, 0, 0, 0, 0, 0, 0, 0.92, 0, 0, 0];
  pBeat.steps.ch_hat =  [0.8, 0.6, 0.85, 0.7, 0.8, 0.6, 0.9, 0.85, 0.8, 0.65, 0.85, 0.75, 0.85, 0.8, 0.9, 0.85];
  pBeat.steps.ch_ohat = [0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0.8, 0];

  const pMelody = makePat("pat_mel", "2 · Minor Pluck", "#badc58");
  pMelody.notes.ch_pluck = [
    { id: "m1", midi: 60, start: 0, length: 2, velocity: 0.88 },
    { id: "m2", midi: 63, start: 3, length: 2, velocity: 0.82 },
    { id: "m3", midi: 67, start: 6, length: 2, velocity: 0.86 },
    { id: "m4", midi: 68, start: 8, length: 3, velocity: 0.92 },
    { id: "m5", midi: 67, start: 11, length: 2, velocity: 0.80 },
    { id: "m6", midi: 62, start: 14, length: 2, velocity: 0.84 },
  ];
  pMelody.notes.ch_keys = [
    { id: "k1", midi: 48, start: 0, length: 8, velocity: 0.70 },
    { id: "k2", midi: 55, start: 0, length: 8, velocity: 0.68 },
    { id: "k3", midi: 44, start: 8, length: 8, velocity: 0.72 },
    { id: "k4", midi: 51, start: 8, length: 8, velocity: 0.68 },
  ];

  return {
    projectId: null,
    title: "Seoul 808 Night",
    bpm: 138,
    swing: 4,
    masterVolume: 0.9,
    selectedChannelId: "ch_pluck",
    activePatternId: "pat_mel",
    scale: "minor",
    channels,
    patterns: [pBeat, pMelody],
    arrangement: [
      { id: "tc1", track: 0, bar: 1, lengthBars: 7, patternId: "pat_beat" },
      { id: "tc2", track: 1, bar: 0, lengthBars: 8, patternId: "pat_mel" },
    ],
  };
}

export function createDemoLofiDesk() {
  const channels = [
    cloneChannelFromPreset("kick808", "ch_kick", { name: "Dusty Kick", volume: 0.82, synth: { decay: 0.22 } }),
    cloneChannelFromPreset("snare", "ch_snare", { name: "Rim Snare", volume: 0.7, synth: { cutoff: 2100, decay: 0.14 } }),
    cloneChannelFromPreset("hihat", "ch_hat", { name: "Lazy Shaker Hat", volume: 0.52, synth: { cutoff: 6200 } }),
    cloneChannelFromPreset("subbass", "ch_bass", { name: "Warm Sine Bass", volume: 0.78, synth: { waveform: "triangle", cutoff: 340 } }),
    cloneChannelFromPreset("fmkeys", "ch_keys", { name: "Lo-Fi Rhodes EP", volume: 0.78, reverbSend: 0.36, delaySend: 0.18 }),
  ];

  const makePat = (id, name, color) => {
    const steps = {};
    const notes = {};
    for (const c of channels) {
      steps[c.id] = emptySteps(16);
      notes[c.id] = [];
    }
    return { id, name, color, lengthSteps: 16, steps, notes };
  };

  const pDrum = makePat("pat_ldrum", "1 · Swung BoomBap", "#1dd1a1");
  pDrum.steps.ch_kick =  [0.9, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0.85, 0, 0, 0, 0, 0];
  pDrum.steps.ch_snare = [0, 0, 0, 0, 0.82, 0, 0, 0, 0, 0, 0, 0, 0.84, 0, 0, 0.4];
  pDrum.steps.ch_hat =   [0.65, 0, 0.55, 0, 0.65, 0, 0.55, 0.4, 0.65, 0, 0.55, 0, 0.65, 0, 0.6, 0];

  const pRhodes = makePat("pat_lkeys", "2 · Jazz 9th Chords", "#a29bfe");
  pRhodes.notes.ch_keys = [
    // Dm9
    { id: "r1", midi: 62, start: 0, length: 7, velocity: 0.74 },
    { id: "r2", midi: 65, start: 0, length: 7, velocity: 0.70 },
    { id: "r3", midi: 69, start: 0, length: 7, velocity: 0.72 },
    { id: "r4", midi: 72, start: 0, length: 7, velocity: 0.68 },
    { id: "r5", midi: 76, start: 1, length: 6, velocity: 0.66 },
    // G13 -> Cmaj7
    { id: "r6", midi: 59, start: 8, length: 4, velocity: 0.72 },
    { id: "r7", midi: 65, start: 8, length: 4, velocity: 0.68 },
    { id: "r8", midi: 69, start: 8, length: 4, velocity: 0.70 },
    { id: "r9", midi: 74, start: 8, length: 4, velocity: 0.72 },
    { id: "r10", midi: 60, start: 12, length: 4, velocity: 0.74 },
    { id: "r11", midi: 64, start: 12, length: 4, velocity: 0.70 },
    { id: "r12", midi: 67, start: 12, length: 4, velocity: 0.70 },
    { id: "r13", midi: 71, start: 12, length: 4, velocity: 0.72 },
  ];
  pRhodes.notes.ch_bass = [
    { id: "lb1", midi: 38, start: 0, length: 7, velocity: 0.82 },
    { id: "lb2", midi: 43, start: 8, length: 4, velocity: 0.80 },
    { id: "lb3", midi: 36, start: 12, length: 4, velocity: 0.84 },
  ];

  return {
    projectId: null,
    title: "Lo-Fi Rainy Study",
    bpm: 84,
    swing: 34,
    masterVolume: 0.88,
    selectedChannelId: "ch_keys",
    activePatternId: "pat_lkeys",
    scale: "major",
    channels,
    patterns: [pDrum, pRhodes],
    arrangement: [
      { id: "lc1", track: 0, bar: 0, lengthBars: 8, patternId: "pat_lkeys" },
      { id: "lc2", track: 1, bar: 1, lengthBars: 7, patternId: "pat_ldrum" },
    ],
  };
}

export const DEMO_PROJECTS = {
  neondrive: createDemoNeonDrive,
  seoultrap: createDemoSeoulTrap,
  lofidesk: createDemoLofiDesk,
  blank: createBlankProject,
};

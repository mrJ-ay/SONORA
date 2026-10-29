import { DRUM_ROWS, INSTRUMENT_PRESETS } from "../audio/instruments.js";

export function createDrumTrack(customId, overrides = {}) {
  return {
    id: customId || `trk_drum_${Math.random().toString(36).slice(2, 6)}`,
    type: "drumkit",
    name: overrides.name || "Studio Drum Kit",
    color: overrides.color || "#ff5c5c",
    volume: overrides.volume ?? 0.88,
    pan: overrides.pan ?? 0,
    muted: false,
    solo: false,
    reverbSend: overrides.reverbSend ?? 0.08,
    delaySend: overrides.delaySend ?? 0.03,
  };
}

export function createInstrumentTrack(presetId = "fmkeys", customId, overrides = {}) {
  const preset = INSTRUMENT_PRESETS.find((p) => p.id === presetId) || INSTRUMENT_PRESETS[0];
  return {
    id: customId || `trk_${preset.id}_${Math.random().toString(36).slice(2, 6)}`,
    type: "instrument",
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
    reverbSend: overrides.reverbSend ?? 0.24,
    delaySend: overrides.delaySend ?? 0.14,
    synth: { ...preset.synth, ...(overrides.synth || {}) },
  };
}

export function createSamplerTrack({ sampleId, name }) {
  return {
    id: `trk_smp_${Math.random().toString(36).slice(2, 6)}`,
    type: "instrument",
    engine: "sampler",
    sampleId,
    rootMidi: 60,
    name: name || "External Sampler",
    category: "SAMPLER",
    color: "#1dd1a1",
    baseMidi: 60,
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    reverbSend: 0.16,
    delaySend: 0.06,
    synth: {
      cutoff: 12000,
      resonance: 1.0,
      attack: 0.004,
      decay: 0.35,
      sustain: 0.85,
      release: 0.22,
      detune: 0,
      loopSample: false,
      trimStart: 0,
      trimEnd: 1,
    },
  };
}

export function createSf2Track({ sf2Id, sf2InstIndex = 0, name }) {
  return {
    id: `trk_sf2_${Math.random().toString(36).slice(2, 6)}`,
    type: "instrument",
    engine: "sf2",
    sf2Id,
    sf2InstIndex,
    name: name || "SoundFont Instrument",
    category: "SF2",
    color: "#ffd166",
    baseMidi: 60,
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    reverbSend: 0.2,
    delaySend: 0.08,
    synth: {
      cutoff: 14000,
      resonance: 0.9,
      attack: 0.005,
      decay: 0.4,
      sustain: 0.82,
      release: 0.28,
      detune: 0,
    },
  };
}

export function createEmptyClip(track, bar = 0, lengthBars = 2) {
  const drumSteps = {};
  if (track.type === "drumkit") {
    for (const r of DRUM_ROWS) drumSteps[r.key] = new Array(16).fill(0);
  }
  return {
    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trackId: track.id,
    name: track.type === "drumkit" ? "Beat Clip" : "MIDI Clip",
    bar,
    lengthBars,
    patternBars: 1,
    drumSteps,
    notes: [],
  };
}

export function createBlankProject() {
  const tDrum = createDrumTrack("trk_1");
  const tKeys = createInstrumentTrack("fmkeys", "trk_2");
  return {
    version: 2,
    projectId: null,
    title: "New Session",
    bpm: 120,
    swing: 0,
    masterVolume: 0.88,
    scale: "minor",
    selectedTrackId: tDrum.id,
    tracks: [tDrum, tKeys],
    clips: [],
  };
}

export function createDemoNeonDrive() {
  const tDrum = createDrumTrack("trk_drums", { name: "808 Synth Drums", volume: 0.9, reverbSend: 0.12 });
  const tBass = createInstrumentTrack("subbass", "trk_bass", { name: "Night Saw Bass", volume: 0.82, reverbSend: 0.04 });
  const tPad = createInstrumentTrack("lushpad", "trk_pad", { name: "Horizon Pad", volume: 0.68, pan: -0.1, reverbSend: 0.42 });
  const tLead = createInstrumentTrack("cyberlead", "trk_lead", { name: "Neon Arp Lead", volume: 0.74, pan: 0.12, delaySend: 0.32, reverbSend: 0.28 });

  const drumClip = createEmptyClip(tDrum, 1, 7);
  drumClip.id = "cl_drum";
  drumClip.name = "Synthwave Beat";
  drumClip.drumSteps.kick808 = [0.95, 0, 0, 0, 0.9, 0, 0, 0, 0.95, 0, 0.75, 0, 0.9, 0, 0, 0];
  drumClip.drumSteps.snare   = [0, 0, 0, 0, 0.92, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0.55];
  drumClip.drumSteps.clap    = [0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0];
  drumClip.drumSteps.hihat   = [0.7, 0.45, 0.8, 0.45, 0.7, 0.45, 0.85, 0.5, 0.7, 0.45, 0.8, 0.45, 0.7, 0.5, 0.9, 0.6];

  const bassPitches = [45, 45, 57, 45, 45, 45, 57, 45, 41, 41, 53, 41, 43, 43, 55, 43];
  const bassClip = createEmptyClip(tBass, 0, 8);
  bassClip.id = "cl_bass";
  bassClip.name = "Octave Bass";
  bassClip.notes = bassPitches.map((midi, i) => ({
    id: `bn_${i}`,
    midi,
    start: i,
    length: 1,
    velocity: i % 2 === 0 ? 0.88 : 0.72,
  }));

  const padClip = createEmptyClip(tPad, 0, 8);
  padClip.id = "cl_pad";
  padClip.name = "Am7 - F - G";
  padClip.notes = [
    { id: "c1", midi: 57, start: 0, length: 8, velocity: 0.72 },
    { id: "c2", midi: 60, start: 0, length: 8, velocity: 0.70 },
    { id: "c3", midi: 64, start: 0, length: 8, velocity: 0.72 },
    { id: "c4", midi: 67, start: 0, length: 8, velocity: 0.68 },
    { id: "c5", midi: 53, start: 8, length: 4, velocity: 0.72 },
    { id: "c6", midi: 57, start: 8, length: 4, velocity: 0.70 },
    { id: "c7", midi: 60, start: 8, length: 4, velocity: 0.70 },
    { id: "c8", midi: 64, start: 8, length: 4, velocity: 0.72 },
    { id: "c9", midi: 55, start: 12, length: 4, velocity: 0.75 },
    { id: "c10", midi: 59, start: 12, length: 4, velocity: 0.72 },
    { id: "c11", midi: 62, start: 12, length: 4, velocity: 0.72 },
    { id: "c12", midi: 67, start: 12, length: 4, velocity: 0.74 },
  ];

  const leadClip = createEmptyClip(tLead, 2, 6);
  leadClip.id = "cl_lead";
  leadClip.name = "Neon Hook";
  leadClip.notes = [
    { id: "l1", midi: 69, start: 0, length: 3, velocity: 0.86 },
    { id: "l2", midi: 72, start: 3, length: 3, velocity: 0.84 },
    { id: "l3", midi: 76, start: 6, length: 2, velocity: 0.90 },
    { id: "l4", midi: 74, start: 8, length: 3, velocity: 0.84 },
    { id: "l5", midi: 72, start: 11, length: 2, velocity: 0.80 },
    { id: "l6", midi: 67, start: 13, length: 3, velocity: 0.85 },
  ];

  return {
    version: 2,
    projectId: null,
    title: "Neon Drive 1984",
    bpm: 118,
    swing: 8,
    masterVolume: 0.88,
    scale: "minor",
    selectedTrackId: tLead.id,
    tracks: [tDrum, tBass, tPad, tLead],
    clips: [drumClip, bassClip, padClip, leadClip],
  };
}

export function createDemoSeoulTrap() {
  const tDrum = createDrumTrack("trk_tdrum", { name: "808 Trap Kit", volume: 0.92 });
  const tPluck = createInstrumentTrack("pluckarp", "trk_tpluck", { name: "Dark Koto Pluck", volume: 0.78, delaySend: 0.3 });
  const tKeys = createInstrumentTrack("fmkeys", "trk_tkeys", { name: "Midnight Sub Bell", volume: 0.7, reverbSend: 0.36 });

  const cBeat = createEmptyClip(tDrum, 1, 7);
  cBeat.name = "808 Bounce";
  cBeat.drumSteps.kick808 = [0.98, 0, 0, 0.82, 0, 0, 0.9, 0, 0, 0, 0.94, 0, 0, 0, 0.78, 0];
  cBeat.drumSteps.clap    = [0, 0, 0, 0, 0.92, 0, 0, 0, 0, 0, 0, 0, 0.92, 0, 0, 0];
  cBeat.drumSteps.hihat   = [0.8, 0.6, 0.85, 0.7, 0.8, 0.6, 0.9, 0.85, 0.8, 0.65, 0.85, 0.75, 0.85, 0.8, 0.9, 0.85];
  cBeat.drumSteps.openhat = [0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0, 0.8, 0];

  const cPluck = createEmptyClip(tPluck, 0, 8);
  cPluck.name = "Minor Riff";
  cPluck.notes = [
    { id: "m1", midi: 60, start: 0, length: 2, velocity: 0.88 },
    { id: "m2", midi: 63, start: 3, length: 2, velocity: 0.82 },
    { id: "m3", midi: 67, start: 6, length: 2, velocity: 0.86 },
    { id: "m4", midi: 68, start: 8, length: 3, velocity: 0.92 },
    { id: "m5", midi: 67, start: 11, length: 2, velocity: 0.80 },
    { id: "m6", midi: 62, start: 14, length: 2, velocity: 0.84 },
  ];

  const cBell = createEmptyClip(tKeys, 0, 8);
  cBell.name = "Low Pad";
  cBell.notes = [
    { id: "k1", midi: 48, start: 0, length: 8, velocity: 0.70 },
    { id: "k2", midi: 55, start: 0, length: 8, velocity: 0.68 },
    { id: "k3", midi: 44, start: 8, length: 8, velocity: 0.72 },
    { id: "k4", midi: 51, start: 8, length: 8, velocity: 0.68 },
  ];

  return {
    version: 2,
    projectId: null,
    title: "Seoul 808 Night",
    bpm: 138,
    swing: 4,
    masterVolume: 0.9,
    scale: "minor",
    selectedTrackId: tPluck.id,
    tracks: [tDrum, tPluck, tKeys],
    clips: [cBeat, cPluck, cBell],
  };
}

export function createDemoLofiDesk() {
  const tDrum = createDrumTrack("trk_ldrum", { name: "Dusty BoomBap", volume: 0.82 });
  const tKeys = createInstrumentTrack("fmkeys", "trk_lkeys", { name: "Lo-Fi Rhodes EP", volume: 0.78, reverbSend: 0.36 });
  const tBass = createInstrumentTrack("subbass", "trk_lbass", { name: "Warm Sub Bass", volume: 0.78, synth: { waveform: "triangle", cutoff: 340 } });

  const cDrum = createEmptyClip(tDrum, 1, 7);
  cDrum.name = "Swung Groove";
  cDrum.drumSteps.kick808 = [0.9, 0, 0, 0, 0, 0, 0, 0.65, 0, 0, 0.85, 0, 0, 0, 0, 0];
  cDrum.drumSteps.snare   = [0, 0, 0, 0, 0.82, 0, 0, 0, 0, 0, 0, 0, 0.84, 0, 0, 0.4];
  cDrum.drumSteps.hihat   = [0.65, 0, 0.55, 0, 0.65, 0, 0.55, 0.4, 0.65, 0, 0.55, 0, 0.65, 0, 0.6, 0];

  const cKeys = createEmptyClip(tKeys, 0, 8);
  cKeys.name = "Jazz 9th Chords";
  cKeys.notes = [
    { id: "r1", midi: 62, start: 0, length: 7, velocity: 0.74 },
    { id: "r2", midi: 65, start: 0, length: 7, velocity: 0.70 },
    { id: "r3", midi: 69, start: 0, length: 7, velocity: 0.72 },
    { id: "r4", midi: 72, start: 0, length: 7, velocity: 0.68 },
    { id: "r5", midi: 76, start: 1, length: 6, velocity: 0.66 },
    { id: "r6", midi: 59, start: 8, length: 4, velocity: 0.72 },
    { id: "r7", midi: 65, start: 8, length: 4, velocity: 0.68 },
    { id: "r8", midi: 69, start: 8, length: 4, velocity: 0.70 },
    { id: "r9", midi: 74, start: 8, length: 4, velocity: 0.72 },
    { id: "r10", midi: 60, start: 12, length: 4, velocity: 0.74 },
    { id: "r11", midi: 64, start: 12, length: 4, velocity: 0.70 },
    { id: "r12", midi: 67, start: 12, length: 4, velocity: 0.70 },
    { id: "r13", midi: 71, start: 12, length: 4, velocity: 0.72 },
  ];

  const cBass = createEmptyClip(tBass, 0, 8);
  cBass.name = "Root Bass";
  cBass.notes = [
    { id: "lb1", midi: 38, start: 0, length: 7, velocity: 0.82 },
    { id: "lb2", midi: 43, start: 8, length: 4, velocity: 0.80 },
    { id: "lb3", midi: 36, start: 12, length: 4, velocity: 0.84 },
  ];

  return {
    version: 2,
    projectId: null,
    title: "Lo-Fi Rainy Study",
    bpm: 84,
    swing: 34,
    masterVolume: 0.88,
    scale: "major",
    selectedTrackId: tKeys.id,
    tracks: [tDrum, tKeys, tBass],
    clips: [cDrum, cKeys, cBass],
  };
}

export const DEMO_PROJECTS = {
  blank: createBlankProject,
  neondrive: createDemoNeonDrive,
  seoultrap: createDemoSeoulTrap,
  lofidesk: createDemoLofiDesk,
};

import { DRUM_ROWS, triggerInstrumentVoice } from "./instruments.js";

function createImpulseResponse(ctx, seconds = 1.9, decay = 2.6) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return impulse;
}

function buildAudioGraph(ctx, project, withAnalysers = true) {
  const masterBus = ctx.createGain();
  const masterGain = ctx.createGain();
  masterGain.gain.value = project.masterVolume ?? 0.88;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4.0;
  limiter.knee.value = 6.0;
  limiter.ratio.value = 12.0;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;

  const reverbNode = ctx.createConvolver();
  reverbNode.buffer = createImpulseResponse(ctx, 1.8, 2.5);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.45;
  reverbNode.connect(reverbReturn);
  reverbReturn.connect(masterBus);

  const delayNode = ctx.createDelay(2.0);
  const beatSec = 60 / (project.bpm || 120);
  delayNode.delayTime.value = beatSec * 0.75;
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = 0.34;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 2800;
  const delayReturn = ctx.createGain();
  delayReturn.gain.value = 0.38;

  delayNode.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayFilter.connect(delayReturn);
  delayReturn.connect(masterBus);

  let masterAnalyser = null;
  masterBus.connect(masterGain);
  masterGain.connect(limiter);
  if (withAnalysers) {
    masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 256;
    masterAnalyser.smoothingTimeConstant = 0.78;
    limiter.connect(masterAnalyser);
    masterAnalyser.connect(ctx.destination);
  } else {
    limiter.connect(ctx.destination);
  }

  const strips = new Map();
  const tracks = project.tracks || [];
  const anySolo = tracks.some((t) => t.solo);

  for (const trk of tracks) {
    const input = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, trk.pan ?? 0));

    const fader = ctx.createGain();
    const audible = anySolo ? Boolean(trk.solo) : !trk.muted;
    fader.gain.value = audible ? (trk.volume ?? 0.8) : 0.0;

    const revSend = ctx.createGain();
    revSend.gain.value = audible ? (trk.reverbSend ?? 0.12) : 0.0;

    const dlySend = ctx.createGain();
    dlySend.gain.value = audible ? (trk.delaySend ?? 0.06) : 0.0;

    let analyser = null;
    input.connect(panner);
    panner.connect(fader);

    if (withAnalysers) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      fader.connect(analyser);
      analyser.connect(masterBus);
    } else {
      fader.connect(masterBus);
    }

    fader.connect(revSend);
    revSend.connect(reverbNode);

    fader.connect(dlySend);
    dlySend.connect(delayNode);

    strips.set(trk.id, { input, panner, fader, revSend, dlySend, analyser });
  }

  return { masterBus, masterGain, limiter, masterAnalyser, delayNode, strips };
}

export function getTrackDrumRows(track) {
  const custom = Array.isArray(track.customDrumRows) ? track.customDrumRows : [];
  const merged = DRUM_ROWS.map((r) => {
    const smp = track.drumSamples?.[r.key];
    return smp ? { ...r, name: smp.name || r.name, drumSampleId: smp.sampleId } : r;
  });
  return [...merged, ...custom];
}

function scheduleClipStep(ctx, graph, track, clip, localStep, stepTime, stepDurSec) {
  const strip = graph.strips.get(track.id);
  if (!strip) return;

  if (track.type === "drumkit") {
    const drumSteps = clip.drumSteps || {};
    const subdiv = clip.drumSubdiv === 2 ? 2 : 1; // 1 = 16th, 2 = 32nd (반박 쪼개기)
    const rows = getTrackDrumRows(track);
    for (const row of rows) {
      const arr = drumSteps[row.key];
      if (!arr) continue;
      for (let sub = 0; sub < subdiv; sub++) {
        const idx = localStep * subdiv + sub;
        if (arr[idx]) {
          const vel = typeof arr[idx] === "number" ? arr[idx] : 0.85;
          const hitTime = stepTime + (sub / subdiv) * stepDurSec;
          triggerInstrumentVoice(ctx, strip.input, row, row.baseMidi || 36, hitTime, (stepDurSec / subdiv) * 0.9, vel);
        }
      }
    }
  } else {
    const notes = clip.notes || [];
    const loopSteps = (clip.patternBars || 1) * 16;
    for (const n of notes) {
      const nStart = ((Number(n.start) || 0) % loopSteps + loopSteps) % loopSteps;
      if (Math.floor(nStart) === localStep) {
        const subStepOffsetSec = (nStart - localStep) * stepDurSec;
        const durSec = Math.max(0.06, Number(n.length) || 0.5) * stepDurSec * 0.96;
        triggerInstrumentVoice(
          ctx,
          strip.input,
          track,
          n.midi,
          stepTime + subStepOffsetSec,
          durSec,
          n.velocity ?? 0.82
        );
      }
    }
  }
}

export class SonoraEngine {
  constructor(getProject, onTick) {
    this.getProject = getProject;
    this.onTick = onTick;
    this.ctx = null;
    this.graph = null;
    this.isPlaying = false;
    this.loopClipId = null; // If set, loops just that clip; otherwise plays full Arrangement
    this.metronome = false;

    this.currentGlobalStep = 0;
    this.displayGlobalStep = 0;
    this.nextNoteTime = 0;
    this.timerId = null;
    this.visualQueue = [];
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    this.rebuildMixGraph();
  }

  rebuildMixGraph() {
    if (!this.ctx) return;
    const project = this.getProject();
    const tracks = project.tracks || [];
    if (!this.graph) {
      this.graph = buildAudioGraph(this.ctx, project, true);
      return;
    }

    const existingIds = new Set(tracks.map((t) => t.id));
    if (existingIds.size !== this.graph.strips.size || tracks.some((t) => !this.graph.strips.has(t.id))) {
      try { this.graph.masterGain.disconnect(); } catch {}
      this.graph = buildAudioGraph(this.ctx, project, true);
      return;
    }

    const anySolo = tracks.some((t) => t.solo);
    const now = this.ctx.currentTime;
    this.graph.masterGain.gain.setTargetAtTime(project.masterVolume ?? 0.88, now, 0.015);
    const beatSec = 60 / (project.bpm || 120);
    this.graph.delayNode.delayTime.setTargetAtTime(beatSec * 0.75, now, 0.03);

    for (const trk of tracks) {
      const strip = this.graph.strips.get(trk.id);
      if (!strip) continue;
      const audible = anySolo ? Boolean(trk.solo) : !trk.muted;
      strip.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, trk.pan ?? 0)), now, 0.015);
      strip.fader.gain.setTargetAtTime(audible ? (trk.volume ?? 0.8) : 0, now, 0.015);
      strip.revSend.gain.setTargetAtTime(audible ? (trk.reverbSend ?? 0.12) : 0, now, 0.015);
      strip.dlySend.gain.setTargetAtTime(audible ? (trk.delaySend ?? 0.06) : 0, now, 0.015);
    }
  }

  previewTrackNote(track, midi, durationSec = 0.26, velocity = 0.85) {
    if (!track) return;
    this.ensureContext();
    const strip = this.graph?.strips.get(track.id);
    const dest = strip ? strip.input : this.graph.masterBus;
    if (track.type === "drumkit") {
      const drumRow = DRUM_ROWS.find((d) => d.baseMidi === midi) || DRUM_ROWS[0];
      triggerInstrumentVoice(this.ctx, dest, drumRow, drumRow.baseMidi, this.ctx.currentTime, durationSec, velocity);
    } else {
      triggerInstrumentVoice(this.ctx, dest, track, midi, this.ctx.currentTime, durationSec, velocity);
    }
  }

  previewDrumRow(track, drumKey) {
    if (!track) return;
    this.ensureContext();
    const strip = this.graph?.strips.get(track.id);
    const dest = strip ? strip.input : this.graph.masterBus;
    const rows = getTrackDrumRows(track);
    const row = rows.find((r) => r.key === drumKey) || rows[0];
    triggerInstrumentVoice(this.ctx, dest, row, row.baseMidi || 36, this.ctx.currentTime, 0.2, 0.88);
  }

  getSongTotalSteps(project) {
    let maxBar = 4;
    for (const clip of project.clips || []) {
      const endBar = (clip.bar || 0) + (clip.lengthBars || 1);
      if (endBar > maxBar) maxBar = endBar;
    }
    return maxBar * 16;
  }

  start() {
    this.ensureContext();
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.visualQueue = [];
    this.nextNoteTime = this.ctx.currentTime + 0.04;
    this.scheduler();
  }

  stop(resetToZero = true) {
    this.isPlaying = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.visualQueue = [];
    if (resetToZero) {
      const project = this.getProject();
      const loopClip = this.loopClipId ? (project.clips || []).find((c) => c.id === this.loopClipId) : null;
      this.currentGlobalStep = loopClip ? (loopClip.bar || 0) * 16 : 0;
      this.displayGlobalStep = this.currentGlobalStep;
    }
    if (this.onTick) this.onTick(this.displayGlobalStep, false);
  }

  seekToBar(barIndex) {
    this.currentGlobalStep = Math.max(0, Math.floor(barIndex) * 16);
    this.displayGlobalStep = this.currentGlobalStep;
    if (this.onTick) this.onTick(this.displayGlobalStep, this.isPlaying);
  }

  playMetronomeClick(time, isDownbeat) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(isDownbeat ? 1320 : 880, time);
    g.gain.setValueAtTime(0.22, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    osc.connect(g);
    g.connect(this.graph.masterBus);
    osc.start(time);
    osc.stop(time + 0.045);
  }

  scheduler() {
    if (!this.isPlaying || !this.ctx) return;
    const project = this.getProject();
    const bpm = Math.max(40, Math.min(240, project.bpm || 120));
    const baseStepDur = 60 / bpm / 4;
    const swing = Math.max(0, Math.min(0.6, (project.swing || 0) / 100));

    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      const stepIndex = this.currentGlobalStep;
      const swingOffset = stepIndex % 2 === 1 ? baseStepDur * swing * 0.5 : 0;
      const playTime = this.nextNoteTime + swingOffset;

      if (this.metronome && stepIndex % 4 === 0) {
        this.playMetronomeClick(playTime, stepIndex % 16 === 0);
      }

      const currentBar = Math.floor(stepIndex / 16);
      const stepInBar = stepIndex % 16;

      for (const clip of project.clips || []) {
        const startBar = clip.bar || 0;
        const lenBars = clip.lengthBars || 1;
        if (currentBar >= startBar && currentBar < startBar + lenBars) {
          const track = (project.tracks || []).find((t) => t.id === clip.trackId);
          if (track) {
            const loopSteps = (clip.patternBars || 1) * 16;
            const localStep = ((currentBar - startBar) * 16 + stepInBar) % loopSteps;
            scheduleClipStep(this.ctx, this.graph, track, clip, localStep, playTime, baseStepDur);
          }
        }
      }

      this.visualQueue.push({ step: stepIndex, time: playTime });
      this.nextNoteTime += baseStepDur;

      const loopClip = this.loopClipId ? (project.clips || []).find((c) => c.id === this.loopClipId) : null;
      if (loopClip) {
        const startStep = (loopClip.bar || 0) * 16;
        const endStep = startStep + (loopClip.lengthBars || 1) * 16;
        const next = stepIndex + 1;
        this.currentGlobalStep = next >= endStep || next < startStep ? startStep : next;
      } else {
        const totalSongSteps = this.getSongTotalSteps(project);
        this.currentGlobalStep = (stepIndex + 1) % totalSongSteps;
      }
    }

    this.timerId = setTimeout(() => this.scheduler(), 25);
  }

  pollPlayhead() {
    if (!this.isPlaying || !this.ctx) return this.displayGlobalStep;
    const now = this.ctx.currentTime;
    while (this.visualQueue.length && this.visualQueue[0].time <= now) {
      this.displayGlobalStep = this.visualQueue[0].step;
      this.visualQueue.shift();
    }
    return this.displayGlobalStep;
  }

  getTrackPeak(trackId) {
    const strip = this.graph?.strips.get(trackId);
    if (!strip?.analyser) return 0;
    const buf = new Uint8Array(strip.analyser.fftSize);
    strip.analyser.getByteTimeDomainData(buf);
    let max = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > max) max = v;
    }
    return Math.min(1, max * 1.45);
  }

  getMasterSpectrum() {
    if (!this.graph?.masterAnalyser) return null;
    const bins = new Uint8Array(this.graph.masterAnalyser.frequencyBinCount);
    this.graph.masterAnalyser.getByteFrequencyData(bins);
    return bins;
  }
}

export async function exportProjectToWav(project) {
  const sampleRate = 44100;
  const bpm = Math.max(40, Math.min(240, project.bpm || 120));
  const stepDur = 60 / bpm / 4;
  const swing = Math.max(0, Math.min(0.6, (project.swing || 0) / 100));

  let maxBar = 1;
  for (const clip of project.clips || []) {
    const endBar = (clip.bar || 0) + (clip.lengthBars || 1);
    if (endBar > maxBar) maxBar = endBar;
  }
  const totalSteps = maxBar * 16;
  const tailSec = 1.6;
  const totalSec = totalSteps * stepDur + tailSec;

  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalSec * sampleRate), sampleRate);
  const graph = buildAudioGraph(offlineCtx, project, false);

  for (let s = 0; s < totalSteps; s++) {
    const swingOffset = s % 2 === 1 ? stepDur * swing * 0.5 : 0;
    const t = 0.05 + s * stepDur + swingOffset;
    const currentBar = Math.floor(s / 16);
    const stepInBar = s % 16;

    for (const clip of project.clips || []) {
      const startBar = clip.bar || 0;
      const lenBars = clip.lengthBars || 1;
      if (currentBar >= startBar && currentBar < startBar + lenBars) {
        const track = (project.tracks || []).find((tr) => tr.id === clip.trackId);
        if (track) {
          const loopSteps = (clip.patternBars || 1) * 16;
          const localStep = ((currentBar - startBar) * 16 + stepInBar) % loopSteps;
          scheduleClipStep(offlineCtx, graph, track, clip, localStep, t, stepDur);
        }
      }
    }
  }

  const rendered = await offlineCtx.startRendering();
  return audioBufferToWavBlob(rendered);
}

function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

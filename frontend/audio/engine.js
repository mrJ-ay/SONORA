import { triggerInstrumentVoice } from "./instruments.js";

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

  // Reverb Bus
  const reverbNode = ctx.createConvolver();
  reverbNode.buffer = createImpulseResponse(ctx, 1.8, 2.5);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.45;
  reverbNode.connect(reverbReturn);
  reverbReturn.connect(masterBus);

  // Stereo Ping-Pong / Echo Delay Bus
  const delayNode = ctx.createDelay(2.0);
  const beatSec = 60 / (project.bpm || 120);
  delayNode.delayTime.value = beatSec * 0.75; // Dotted 8th feel
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
  const anySolo = project.channels.some((c) => c.solo);

  for (const ch of project.channels) {
    const input = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, ch.pan ?? 0));

    const fader = ctx.createGain();
    const isAudible = anySolo ? Boolean(ch.solo) : !ch.muted;
    fader.gain.value = isAudible ? (ch.volume ?? 0.8) : 0.0;

    const revSend = ctx.createGain();
    revSend.gain.value = isAudible ? (ch.reverbSend ?? 0.12) : 0.0;

    const dlySend = ctx.createGain();
    dlySend.gain.value = isAudible ? (ch.delaySend ?? 0.06) : 0.0;

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

    strips.set(ch.id, { input, panner, fader, revSend, dlySend, analyser });
  }

  return {
    masterBus,
    masterGain,
    limiter,
    masterAnalyser,
    delayNode,
    strips,
  };
}

function schedulePatternStep(ctx, graph, project, pattern, localStep, stepTime, stepDurSec) {
  for (const ch of project.channels) {
    const strip = graph.strips.get(ch.id);
    if (!strip) continue;

    // 1. Trigger Beat Sequencer step if active
    const stepsArr = pattern.steps?.[ch.id];
    if (stepsArr && stepsArr[localStep]) {
      const vel = typeof stepsArr[localStep] === "number" ? stepsArr[localStep] : 0.85;
      triggerInstrumentVoice(ctx, strip.input, ch, ch.baseMidi || 36, stepTime, stepDurSec * 0.9, vel);
    }

    // 2. Trigger Piano Roll notes starting at localStep
    const notes = pattern.notes?.[ch.id];
    if (Array.isArray(notes)) {
      for (const n of notes) {
        if (Math.round(n.start) === localStep) {
          const durSec = Math.max(0.25, n.length || 1) * stepDurSec * 0.95;
          triggerInstrumentVoice(ctx, strip.input, ch, n.midi, stepTime, durSec, n.velocity ?? 0.82);
        }
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
    this.mode = "pattern"; // "pattern" | "song"
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
    if (!this.graph) {
      this.graph = buildAudioGraph(this.ctx, project, true);
      return;
    }

    // Ensure any newly added channel gets a strip; sync mixer gains/pans cleanly
    const anySolo = project.channels.some((c) => c.solo);
    this.graph.masterGain.gain.setTargetAtTime(project.masterVolume ?? 0.88, this.ctx.currentTime, 0.015);
    const beatSec = 60 / (project.bpm || 120);
    this.graph.delayNode.delayTime.setTargetAtTime(beatSec * 0.75, this.ctx.currentTime, 0.03);

    const existingIds = new Set(project.channels.map((c) => c.id));
    for (const [id, strip] of this.graph.strips.entries()) {
      if (!existingIds.has(id)) {
        try { strip.fader.disconnect(); } catch {}
        this.graph.strips.delete(id);
      }
    }

    for (const ch of project.channels) {
      if (!this.graph.strips.has(ch.id)) {
        // Rebuild full graph when channel topology changes
        try { this.graph.masterGain.disconnect(); } catch {}
        this.graph = buildAudioGraph(this.ctx, project, true);
        return;
      }
      const strip = this.graph.strips.get(ch.id);
      const audible = anySolo ? Boolean(ch.solo) : !ch.muted;
      const now = this.ctx.currentTime;
      strip.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, ch.pan ?? 0)), now, 0.015);
      strip.fader.gain.setTargetAtTime(audible ? (ch.volume ?? 0.8) : 0, now, 0.015);
      strip.revSend.gain.setTargetAtTime(audible ? (ch.reverbSend ?? 0.12) : 0, now, 0.015);
      strip.dlySend.gain.setTargetAtTime(audible ? (ch.delaySend ?? 0.06) : 0, now, 0.015);
    }
  }

  previewNote(channel, midi, durationSec = 0.28, velocity = 0.85) {
    this.ensureContext();
    const strip = this.graph?.strips.get(channel.id);
    const dest = strip ? strip.input : this.graph.masterBus;
    triggerInstrumentVoice(this.ctx, dest, channel, midi, this.ctx.currentTime, durationSec, velocity);
  }

  getSongTotalSteps(project) {
    let maxBar = 4;
    for (const clip of project.arrangement || []) {
      const endBar = (clip.bar || 0) + (clip.lengthBars || 1);
      if (endBar > maxBar) maxBar = endBar;
    }
    return maxBar * 16;
  }

  start(mode) {
    if (mode) this.mode = mode;
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
      this.currentGlobalStep = 0;
      this.displayGlobalStep = 0;
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
    const baseStepDur = 60 / bpm / 4; // 16th note
    const swing = Math.max(0, Math.min(0.6, (project.swing || 0) / 100));

    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      const stepIndex = this.currentGlobalStep;
      const swingOffset = stepIndex % 2 === 1 ? baseStepDur * swing * 0.5 : 0;
      const playTime = this.nextNoteTime + swingOffset;

      if (this.metronome && stepIndex % 4 === 0) {
        this.playMetronomeClick(playTime, stepIndex % 16 === 0);
      }

      if (this.mode === "pattern") {
        const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
        if (pat) {
          const patSteps = pat.lengthSteps || 16;
          const localStep = stepIndex % patSteps;
          schedulePatternStep(this.ctx, this.graph, project, pat, localStep, playTime, baseStepDur);
        }
      } else {
        // SONG Mode: check arrangement clips active at current bar
        const currentBar = Math.floor(stepIndex / 16);
        const stepInBar = stepIndex % 16;
        for (const clip of project.arrangement || []) {
          const startBar = clip.bar || 0;
          const lenBars = clip.lengthBars || 1;
          if (currentBar >= startBar && currentBar < startBar + lenBars) {
            const pat = project.patterns.find((p) => p.id === clip.patternId);
            if (pat) {
              const patSteps = pat.lengthSteps || 16;
              const offsetStep = ((currentBar - startBar) * 16 + stepInBar) % patSteps;
              schedulePatternStep(this.ctx, this.graph, project, pat, offsetStep, playTime, baseStepDur);
            }
          }
        }
      }

      this.visualQueue.push({ step: stepIndex, time: playTime });

      // Advance step
      this.nextNoteTime += baseStepDur;
      if (this.mode === "pattern") {
        const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
        const patSteps = pat?.lengthSteps || 16;
        this.currentGlobalStep = (this.currentGlobalStep + 1) % patSteps;
      } else {
        const totalSongSteps = this.getSongTotalSteps(project);
        this.currentGlobalStep = (this.currentGlobalStep + 1) % totalSongSteps;
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

  getChannelPeak(channelId) {
    const strip = this.graph?.strips.get(channelId);
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

// Offline .WAV Exporter
export async function exportProjectToWav(project, mode = "song") {
  const sampleRate = 44100;
  const bpm = Math.max(40, Math.min(240, project.bpm || 120));
  const stepDur = 60 / bpm / 4;
  const swing = Math.max(0, Math.min(0.6, (project.swing || 0) / 100));

  let totalSteps = 16;
  if (mode === "pattern") {
    const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
    totalSteps = (pat?.lengthSteps || 16) * 2; // Render 2 loops of the pattern
  } else {
    let maxBar = 1;
    for (const clip of project.arrangement || []) {
      const endBar = (clip.bar || 0) + (clip.lengthBars || 1);
      if (endBar > maxBar) maxBar = endBar;
    }
    totalSteps = maxBar * 16;
  }

  const tailSec = 1.6;
  const totalSec = totalSteps * stepDur + tailSec;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalSec * sampleRate), sampleRate);
  const graph = buildAudioGraph(offlineCtx, project, false);

  for (let s = 0; s < totalSteps; s++) {
    const swingOffset = s % 2 === 1 ? stepDur * swing * 0.5 : 0;
    const t = 0.05 + s * stepDur + swingOffset;

    if (mode === "pattern") {
      const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
      if (pat) {
        const localStep = s % (pat.lengthSteps || 16);
        schedulePatternStep(offlineCtx, graph, project, pat, localStep, t, stepDur);
      }
    } else {
      const currentBar = Math.floor(s / 16);
      const stepInBar = s % 16;
      for (const clip of project.arrangement || []) {
        const startBar = clip.bar || 0;
        const lenBars = clip.lengthBars || 1;
        if (currentBar >= startBar && currentBar < startBar + lenBars) {
          const pat = project.patterns.find((p) => p.id === clip.patternId);
          if (pat) {
            const localStep = ((currentBar - startBar) * 16 + stepInBar) % (pat.lengthSteps || 16);
            schedulePatternStep(offlineCtx, graph, project, pat, localStep, t, stepDur);
          }
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
  view.setUint16(20, 1, true); // PCM
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

import { DRUM_ROWS, triggerInstrumentVoice } from "./instruments.js";
import { getSampleAudioBuffer } from "./externalLoader.js";

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
  const hiddenKeys = new Set(track.hiddenDrumKeys || []);
  const custom = Array.isArray(track.customDrumRows) ? track.customDrumRows : [];
  const merged = DRUM_ROWS.filter((r) => !hiddenKeys.has(r.key)).map((r) => {
    const smp = track.drumSamples?.[r.key];
    return smp ? { ...r, name: smp.name || r.name, drumSampleId: smp.sampleId } : r;
  });
  return [...merged, ...custom.filter((r) => !hiddenKeys.has(r.key))];
}

function isAudioTimelineClip(track, clip) {
  return Boolean(clip?.sampleId && (clip.kind === "audio" || track?.type === "audio"));
}

function triggerAudioClipSlice(ctx, destination, clip, startTime, sliceOffsetSec = 0, playDurSec = 4) {
  if (!clip?.sampleId) return null;
  const buf = getSampleAudioBuffer(ctx, clip.sampleId);
  if (!buf) return null;

  const rate = Math.max(0.25, Math.min(4.0, Number(clip.playbackRate) || 1.0));
  const baseOffsetSec = Math.max(0, Number(clip.offsetSec) || 0);
  const endTrimSec = Math.max(0, Number(clip.endTrimSec) || 0);
  const effectiveBufDuration = Math.max(baseOffsetSec, buf.duration - endTrimSec);
  const bufOffset = baseOffsetSec + Math.max(0, sliceOffsetSec) * rate;
  if (bufOffset >= effectiveBufDuration - 0.005) return null;

  const availTimelineSec = Math.max(0, (effectiveBufDuration - bufOffset) / rate);
  const actualPlaySec = Math.min(playDurSec, availTimelineSec);
  if (actualPlaySec <= 0.008) return null;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.setValueAtTime(rate, startTime);

  const g = ctx.createGain();
  const targetGain = Math.max(0, Math.min(2.5, Number(clip.gain ?? 1.0)));
  const fadeIn =
    sliceOffsetSec > 0.01
      ? 0.012
      : Math.min(actualPlaySec * 0.45, Math.max(0.004, Number(clip.fadeInSec ?? 0.01)));
  const fadeOut = Math.min(actualPlaySec * 0.45, Math.max(0.008, Number(clip.fadeOutSec ?? 0.02)));

  g.gain.setValueAtTime(0.0001, startTime);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, targetGain), startTime + fadeIn);
  g.gain.setValueAtTime(
    Math.max(0.0001, targetGain),
    Math.max(startTime + fadeIn, startTime + actualPlaySec - fadeOut)
  );
  g.gain.linearRampToValueAtTime(0.0001, startTime + actualPlaySec);

  src.connect(g);
  g.connect(destination);
  src.start(startTime, bufOffset, actualPlaySec * rate);
  src.stop(startTime + actualPlaySec + 0.02);

  return { source: src, gain: g };
}

function scheduleClipStep(ctx, graph, track, clip, localStep, stepTime, stepDurSec) {
  if (!track || track.type === "empty" || track.engine === "none" || track.type === "audio" || clip.kind === "audio") {
    return;
  }
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

    // Melodic / Pitch notes placed via Piano Roll (Loop Mode) on this drum kit pattern
    const notes = clip.notes || [];
    for (const n of notes) {
      const nStart = Math.max(0, Number(n.start) || 0);
      if (Math.floor(nStart) === localStep) {
        const subStepOffsetSec = (nStart - localStep) * stepDurSec;
        const durSec = Math.max(0.06, Number(n.length) || 0.5) * stepDurSec * 0.96;
        const targetRow = rows.find((r) => (r.baseMidi || 36) === n.midi) || rows[0];
        triggerInstrumentVoice(
          ctx,
          strip.input,
          targetRow || track,
          n.midi,
          stepTime + subStepOffsetSec,
          durSec,
          n.velocity ?? 0.82
        );
      }
    }
  } else {
    const notes = clip.notes || [];
    for (const n of notes) {
      const nStart = Math.max(0, Number(n.start) || 0);
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
    this.isRecording = false; // Prevents timeline wrap-around while live recording
    this.loopClipId = null; // If set, loops just that clip; otherwise plays full Arrangement
    this.metronome = false;

    this.currentGlobalStep = 0;
    this.displayGlobalStep = 0;
    this.nextNoteTime = 0;
    this.timerId = null;
    this.visualQueue = [];

    this.activeAudioVoices = new Set();
    this.triggeredAudioClipIds = new Set();
    this.previewVoice = null;
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

  stopActiveAudioClips() {
    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (const v of this.activeAudioVoices) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(0.0001, now);
          v.source.stop(now + 0.015);
        } catch {}
      }
      if (this.previewVoice) {
        try {
          this.previewVoice.source.stop(now + 0.01);
        } catch {}
        this.previewVoice = null;
      }
    }
    this.activeAudioVoices.clear();
    this.triggeredAudioClipIds.clear();
  }

  registerAudioVoice(voice) {
    if (!voice) return;
    this.activeAudioVoices.add(voice);
    voice.source.onended = () => {
      this.activeAudioVoices.delete(voice);
    };
  }

  scheduleMidClipAudioAtStep(stepIndex, playTime) {
    if (!this.ctx || !this.graph) return;
    const project = this.getProject();
    const bpm = Math.max(40, Math.min(240, project.bpm || 120));
    const baseStepDur = 60 / bpm / 4;
    const songSec = stepIndex * baseStepDur;

    for (const clip of project.clips || []) {
      const track = (project.tracks || []).find((t) => t.id === clip.trackId);
      if (!isAudioTimelineClip(track, clip)) continue;
      const strip = this.graph.strips.get(track.id);
      if (!strip) continue;

      const clipStartSec = (Number(clip.bar) || 0) * 16 * baseStepDur;
      const clipDurSec = Math.max(0.05, (Number(clip.lengthBars) || 1) * 16 * baseStepDur);
      const clipEndSec = clipStartSec + clipDurSec;

      if (songSec > clipStartSec + 0.002 && songSec < clipEndSec - 0.02) {
        const voice = triggerAudioClipSlice(
          this.ctx,
          strip.input,
          clip,
          playTime,
          songSec - clipStartSec,
          clipEndSec - songSec
        );
        this.registerAudioVoice(voice);
        this.triggeredAudioClipIds.add(clip.id);
      }
    }
  }

  previewAudioClip(track, clip) {
    if (!track || !clip?.sampleId) return false;
    this.ensureContext();
    if (this.previewVoice) {
      try { this.previewVoice.source.stop(); } catch {}
      this.previewVoice = null;
    }
    const project = this.getProject();
    const bpm = Math.max(40, Math.min(240, project.bpm || 120));
    const barDurSec = (60 / bpm) * 4;
    const playDurSec = Math.max(0.1, (Number(clip.lengthBars) || 1) * barDurSec);
    const strip = this.graph?.strips.get(track.id);
    const dest = strip ? strip.input : this.graph.masterBus;
    const voice = triggerAudioClipSlice(this.ctx, dest, clip, this.ctx.currentTime + 0.02, 0, playDurSec);
    if (voice) {
      this.previewVoice = voice;
      voice.source.onended = () => {
        if (this.previewVoice === voice) this.previewVoice = null;
      };
    }
    return Boolean(voice);
  }

  previewTrackNote(track, midi, durationSec = 0.26, velocity = 0.85) {
    if (!track || track.type === "empty" || track.engine === "none" || track.type === "audio") return false;
    this.ensureContext();
    const strip = this.graph?.strips.get(track.id);
    const dest = strip ? strip.input : this.graph.masterBus;
    if (track.type === "drumkit") {
      const rows = getTrackDrumRows(track);
      const drumRow = rows.find((d) => (d.baseMidi || 36) === midi) || rows[0];
      triggerInstrumentVoice(this.ctx, dest, drumRow || track, midi, this.ctx.currentTime, durationSec, velocity);
    } else {
      triggerInstrumentVoice(this.ctx, dest, track, midi, this.ctx.currentTime, durationSec, velocity);
    }
    return true;
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

  previewDrumSpec(track, spec) {
    if (!track || !spec) return;
    this.ensureContext();
    const strip = this.graph?.strips.get(track.id);
    const dest = strip ? strip.input : this.graph.masterBus;
    triggerInstrumentVoice(this.ctx, dest, spec, spec.baseMidi || 36, this.ctx.currentTime, 0.25, 0.9);
  }

  getSongTotalSteps(project) {
    let maxBar = 512; // Generous DAW timeline: 512 bars minimum (8,192 steps)
    for (const clip of project.clips || []) {
      let clipEnd = Math.ceil((Number(clip.bar) || 0) + (Number(clip.lengthBars) || 1));
      if (clip.notes && clip.notes.length) {
        let maxNoteEnd = 0;
        for (const n of clip.notes) {
          const end = (Number(n.start) || 0) + (Number(n.length) || 1);
          if (end > maxNoteEnd) maxNoteEnd = end;
        }
        clipEnd = Math.max(clipEnd, Math.ceil((clip.bar || 0) + maxNoteEnd / 16));
      }
      if (clipEnd + 64 > maxBar) maxBar = clipEnd + 64;
    }
    if (this.currentGlobalStep / 16 + 64 > maxBar) {
      maxBar = Math.ceil(this.currentGlobalStep / 16) + 64;
    }
    return maxBar * 16;
  }

  start() {
    this.ensureContext();
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.visualQueue = [];
    this.stopActiveAudioClips();
    this.nextNoteTime = this.ctx.currentTime + 0.04;
    this.scheduleMidClipAudioAtStep(this.currentGlobalStep, this.nextNoteTime);
    this.scheduler();
  }

  stop(resetToZero = true) {
    this.isPlaying = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.stopActiveAudioClips();
    this.visualQueue = [];
    if (resetToZero) {
      const project = this.getProject();
      const loopClip = this.loopClipId ? (project.clips || []).find((c) => c.id === this.loopClipId) : null;
      this.currentGlobalStep = loopClip ? Math.floor((loopClip.bar || 0) * 16) : 0;
      this.displayGlobalStep = this.currentGlobalStep;
    }
    if (this.onTick) this.onTick(this.displayGlobalStep, false);
  }

  seekToBar(barIndex) {
    this.currentGlobalStep = Math.max(0, Math.round(barIndex * 16));
    this.displayGlobalStep = this.currentGlobalStep;
    if (this.isPlaying && this.ctx) {
      this.stopActiveAudioClips();
      this.scheduleMidClipAudioAtStep(this.currentGlobalStep, this.ctx.currentTime + 0.03);
    }
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
        const track = (project.tracks || []).find((t) => t.id === clip.trackId);
        if (!track) continue;

        if (isAudioTimelineClip(track, clip)) {
          if (this.loopClipId && this.loopClipId !== clip.id) continue;
          const clipStartStep = (Number(clip.bar) || 0) * 16;
          if (!this.triggeredAudioClipIds.has(clip.id) && clipStartStep >= stepIndex && clipStartStep < stepIndex + 1) {
            const strip = this.graph?.strips.get(track.id);
            if (strip) {
              const subOffsetSec = (clipStartStep - stepIndex) * baseStepDur;
              const clipDurSec = Math.max(0.05, (Number(clip.lengthBars) || 1) * 16 * baseStepDur);
              const voice = triggerAudioClipSlice(
                this.ctx,
                strip.input,
                clip,
                playTime + subOffsetSec,
                0,
                clipDurSec
              );
              this.registerAudioVoice(voice);
              this.triggeredAudioClipIds.add(clip.id);
            }
          }
          continue;
        }

        const startBar = clip.bar || 0;
        let lenBars = clip.lengthBars || 1;
        if (track.type !== "drumkit" && clip.notes && clip.notes.length) {
          let maxNoteEnd = 0;
          for (const n of clip.notes) {
            const end = (Number(n.start) || 0) + (Number(n.length) || 1);
            if (end > maxNoteEnd) maxNoteEnd = end;
          }
          lenBars = Math.max(lenBars, Math.ceil(maxNoteEnd / 16));
        }
        if (currentBar >= startBar && currentBar < startBar + lenBars) {
          const isDrum = track.type === "drumkit";
          const loopSteps = (clip.patternBars || 1) * 16;
          const stepOffset = (currentBar - startBar) * 16 + stepInBar;
          const localStep = isDrum ? (stepOffset % loopSteps) : stepOffset;
          scheduleClipStep(this.ctx, this.graph, track, clip, localStep, playTime, baseStepDur);
        }
      }

      this.visualQueue.push({ step: stepIndex, time: playTime });
      this.nextNoteTime += baseStepDur;

      if (this.isRecording) {
        // Never wrap playhead back to start while actively recording audio!
        this.currentGlobalStep = stepIndex + 1;
      } else {
        const loopClip = this.loopClipId ? (project.clips || []).find((c) => c.id === this.loopClipId) : null;
        if (loopClip) {
          const startStep = Math.floor((loopClip.bar || 0) * 16);
          const endStep = startStep + Math.max(1, Math.round((loopClip.lengthBars || 1) * 16));
          const next = stepIndex + 1;
          if (next >= endStep || next < startStep) {
            this.currentGlobalStep = startStep;
            this.triggeredAudioClipIds.clear();
          } else {
            this.currentGlobalStep = next;
          }
        } else {
          const totalSongSteps = this.getSongTotalSteps(project);
          const next = stepIndex + 1;
          if (next >= totalSongSteps) {
            // Reached the end of arrangement - stop instead of unwanted looping!
            this.stop(true);
            return;
          }
          this.currentGlobalStep = next;
        }
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
    const endBar = Math.ceil((Number(clip.bar) || 0) + (Number(clip.lengthBars) || 1));
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
      const track = (project.tracks || []).find((tr) => tr.id === clip.trackId);
      if (!track || isAudioTimelineClip(track, clip)) continue;
      const startBar = clip.bar || 0;
      let lenBars = clip.lengthBars || 1;
      if (track.type !== "drumkit" && clip.notes && clip.notes.length) {
        let maxNoteEnd = 0;
        for (const n of clip.notes) {
          const end = (Number(n.start) || 0) + (Number(n.length) || 1);
          if (end > maxNoteEnd) maxNoteEnd = end;
        }
        lenBars = Math.max(lenBars, Math.ceil(maxNoteEnd / 16));
      }
      if (currentBar >= startBar && currentBar < startBar + lenBars) {
        const isDrum = track.type === "drumkit";
        const loopSteps = (clip.patternBars || 1) * 16;
        const stepOffset = (currentBar - startBar) * 16 + stepInBar;
        const localStep = isDrum ? (stepOffset % loopSteps) : stepOffset;
        scheduleClipStep(offlineCtx, graph, track, clip, localStep, t, stepDur);
      }
    }
  }

  // Render all Audio Clips onto OfflineAudioContext
  for (const clip of project.clips || []) {
    const track = (project.tracks || []).find((tr) => tr.id === clip.trackId);
    if (!track || !isAudioTimelineClip(track, clip)) continue;
    const strip = graph.strips.get(track.id);
    if (!strip) continue;
    const startSec = 0.05 + (Number(clip.bar) || 0) * 16 * stepDur;
    const durSec = Math.max(0.05, (Number(clip.lengthBars) || 1) * 16 * stepDur);
    triggerAudioClipSlice(offlineCtx, strip.input, clip, startSec, 0, durSec);
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

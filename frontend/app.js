import { DRUM_ROWS, INSTRUMENT_PRESETS } from "./audio/instruments.js";
import { SonoraEngine, exportProjectToWav } from "./audio/engine.js";
import {
  DEMO_PROJECTS,
  createDrumTrack,
  createInstrumentTrack,
  createEmptyClip,
} from "./state/demos.js";
import { PianoRollView } from "./ui/pianoRoll.js";
import { ArrangementView } from "./ui/arrangement.js";

const TOKEN_KEY = "sonora_oneid_token";
const LOCAL_AUTOSAVE_KEY = "sonora_autosave_v2";

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
let project = DEMO_PROJECTS.neondrive();
let selectedClipId = project.clips?.[0]?.id || null;
let editingTrackId = null;
let editingClipId = null;
let synthTargetTrackId = null;

// DOM Elements
const projectTitleInput = document.querySelector("#projectTitleInput");
const playBtn = document.querySelector("#playBtn");
const stopBtn = document.querySelector("#stopBtn");
const lcdTime = document.querySelector("#lcdTime");
const bpmInput = document.querySelector("#bpmInput");
const swingInput = document.querySelector("#swingInput");
const metroBtn = document.querySelector("#metroBtn");
const spectrumCanvas = document.querySelector("#spectrumCanvas");
const specCtx = spectrumCanvas.getContext("2d");

const demoSelect = document.querySelector("#demoSelect");
const exportWavBtn = document.querySelector("#exportWavBtn");
const openCloudBtn = document.querySelector("#openCloudBtn");
const authBox = document.querySelector("#authBox");

const addDrumTrackBtn = document.querySelector("#addDrumTrackBtn");
const addInstTrackSelect = document.querySelector("#addInstTrackSelect");
const trackHeadersList = document.querySelector("#trackHeadersList");
const arrangementWrap = document.querySelector("#arrangementWrap");

const mixerStripsEl = document.querySelector("#mixerStrips");
const resetSoloMuteBtn = document.querySelector("#resetSoloMuteBtn");

// On-Demand Clip Editor Elements
const clipEditorBackdrop = document.querySelector("#clipEditorBackdrop");
const editorDot = document.querySelector("#editorDot");
const editorTitle = document.querySelector("#editorTitle");
const clipNameInput = document.querySelector("#clipNameInput");
const loopClipBtn = document.querySelector("#loopClipBtn");
const prTools = document.querySelector("#prTools");
const seqTools = document.querySelector("#seqTools");
const clipPatternBarsSelect = document.querySelector("#clipPatternBarsSelect");
const scaleSelect = document.querySelector("#scaleSelect");
const openSynthFromPrBtn = document.querySelector("#openSynthFromPrBtn");
const clearClipNotesBtn = document.querySelector("#clearClipNotesBtn");
const fill2StepHatBtn = document.querySelector("#fill2StepHatBtn");
const fill4FloorBtn = document.querySelector("#fill4FloorBtn");
const clearDrumClipBtn = document.querySelector("#clearDrumClipBtn");
const closeClipEditorBtn = document.querySelector("#closeClipEditorBtn");

const pianoRollEditorBody = document.querySelector("#pianoRollEditorBody");
const beatSequencerBody = document.querySelector("#beatSequencerBody");
const drumStepRows = document.querySelector("#drumStepRows");

// On-Demand VST Synth Modal Elements
const synthModal = document.querySelector("#synthModal");
const synthModalTitle = document.querySelector("#synthModalTitle");
const synthBody = document.querySelector("#synthBody");
const auditionSynthBtn = document.querySelector("#auditionSynthBtn");
const closeSynthBtn = document.querySelector("#closeSynthBtn");

// Cloud & Login Modals
const toastEl = document.querySelector("#toast");
const cloudModal = document.querySelector("#cloudModal");
const closeCloudBtn = document.querySelector("#closeCloudBtn");
const cloudSaveTitle = document.querySelector("#cloudSaveTitle");
const cloudPublicCheck = document.querySelector("#cloudPublicCheck");
const saveCloudBtn = document.querySelector("#saveCloudBtn");
const saveJsonBtn = document.querySelector("#saveJsonBtn");
const loadJsonInput = document.querySelector("#loadJsonInput");
const cloudAuthHint = document.querySelector("#cloudAuthHint");
const publicProjectsList = document.querySelector("#publicProjectsList");
const myProjectsList = document.querySelector("#myProjectsList");

const loginModal = document.querySelector("#loginModal");
const closeLoginBtn = document.querySelector("#closeLoginBtn");
const loginForm = document.querySelector("#loginForm");
const loginUsername = document.querySelector("#loginUsername");
const loginPassword = document.querySelector("#loginPassword");
const loginError = document.querySelector("#loginError");

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.hidden = true;
  }, 3000);
}

function persistLocal() {
  try {
    localStorage.setItem(LOCAL_AUTOSAVE_KEY, JSON.stringify(project));
  } catch {}
}

function getSelectedTrack() {
  return (project.tracks || []).find((t) => t.id === project.selectedTrackId) || project.tracks?.[0] || null;
}

function getEditingContext() {
  const track = (project.tracks || []).find((t) => t.id === editingTrackId);
  const clip = (project.clips || []).find((c) => c.id === editingClipId);
  if (!track || !clip) return null;
  return { project, track, clip };
}

// Audio Engine
const engine = new SonoraEngine(
  () => project,
  () => updateTransportReadout()
);

// Piano Roll & Arrangement Views
const pianoRoll = new PianoRollView(
  document.querySelector("#pianoRollCanvas"),
  document.querySelector("#pianoRollWrap"),
  {
    getEditingContext,
    onNotesChanged: () => {
      persistLocal();
      arrangementView.draw();
    },
    onAuditionNote: (track, midi, dur = 0.24) => engine.previewTrackNote(track, midi, dur),
  }
);

const arrangementView = new ArrangementView(
  document.querySelector("#arrangementCanvas"),
  arrangementWrap,
  {
    getProject: () => project,
    getSelectedClipId: () => selectedClipId,
    onSelectClip: (track, clip) => {
      project.selectedTrackId = track.id;
      selectedClipId = clip.id;
      renderTrackHeaders();
      renderMixer();
    },
    onOpenClipEditor: (track, clip) => {
      openClipEditor(track, clip);
    },
    onChanged: () => {
      persistLocal();
    },
    onSeekBar: (barIdx) => {
      engine.seekToBar(barIdx);
      updateTransportReadout();
    },
  }
);

// Sync Track Header vertical scroll with Arrangement Timeline
arrangementWrap.addEventListener("scroll", () => {
  trackHeadersList.scrollTop = arrangementWrap.scrollTop;
});

// Transport Controls
function togglePlay() {
  if (engine.isPlaying) {
    engine.stop(false);
    playBtn.classList.remove("playing");
    playBtn.textContent = "▶ PLAY";
  } else {
    engine.start();
    playBtn.classList.add("playing");
    playBtn.textContent = "⏸ PAUSE";
  }
}

playBtn.addEventListener("click", togglePlay);
stopBtn.addEventListener("click", () => {
  engine.stop(true);
  playBtn.classList.remove("playing");
  playBtn.textContent = "▶ PLAY";
  arrangementView.setPlayhead(-1);
  pianoRoll.setPlayhead(-1);
  highlightDrumStep(-1);
  updateTransportReadout();
});

bpmInput.addEventListener("input", () => {
  project.bpm = Math.max(40, Math.min(240, Number(bpmInput.value) || 120));
  engine.rebuildMixGraph();
  persistLocal();
});

swingInput.addEventListener("input", () => {
  project.swing = Math.max(0, Math.min(60, Number(swingInput.value) || 0));
  persistLocal();
});

projectTitleInput.addEventListener("input", () => {
  project.title = projectTitleInput.value.trim() || "New Session";
  persistLocal();
});

metroBtn.addEventListener("click", () => {
  engine.metronome = !engine.metronome;
  metroBtn.classList.toggle("active", engine.metronome);
});

// Adding Tracks in Arrangement
addDrumTrackBtn.addEventListener("click", () => {
  const num = (project.tracks || []).filter((t) => t.type === "drumkit").length + 1;
  const trk = createDrumTrack(null, { name: `Drum Kit ${num}` });
  project.tracks.push(trk);
  project.selectedTrackId = trk.id;
  const clip = createEmptyClip(trk, 0, 4);
  project.clips.push(clip);
  selectedClipId = clip.id;

  engine.rebuildMixGraph();
  engine.previewDrumRow(trk, "kick808");
  persistLocal();
  renderAll();
  showToast(`'${trk.name}' 트랙 추가됨 — 클립 더블클릭 또는 '🥁 비트' 버튼으로 리듬을 찍으세요.`);
});

addInstTrackSelect.addEventListener("change", () => {
  const presetId = addInstTrackSelect.value;
  if (!presetId) return;
  const trk = createInstrumentTrack(presetId);
  project.tracks.push(trk);
  project.selectedTrackId = trk.id;
  const clip = createEmptyClip(trk, 0, 4);
  project.clips.push(clip);
  selectedClipId = clip.id;

  addInstTrackSelect.value = "";
  engine.rebuildMixGraph();
  engine.previewTrackNote(trk, trk.baseMidi || 60, 0.28);
  persistLocal();
  renderAll();
  showToast(`'${trk.name}' 트랙 추가됨 — '🎛 악기'로 사운드 편집, '🎹 피아노롤'로 멜로디 입력!`);
});

// Render Left Track Headers
function renderTrackHeaders() {
  const tracks = project.tracks || [];
  trackHeadersList.innerHTML = tracks
    .map((trk) => {
      const isSel = trk.id === project.selectedTrackId;
      const isDrum = trk.type === "drumkit";
      const typeLabel = isDrum ? "DRUM RACK" : trk.category?.toUpperCase() || "SYNTH";

      const actionButtons = isDrum
        ? `<button class="trk-action-btn" data-open-seq="${escapeHtml(trk.id)}" type="button" title="비트 시퀀서 열기">🥁 비트 시퀀서</button>`
        : `
          <button class="trk-action-btn" data-open-vst="${escapeHtml(trk.id)}" type="button" title="신스 / 가상악기 설정 열기">🎛 악기</button>
          <button class="trk-action-btn" data-open-pr="${escapeHtml(trk.id)}" type="button" title="피아노롤 열기">🎹 피아노롤</button>
        `;

      return `
        <div class="track-header-row ${isSel ? "selected" : ""}" style="border-left-color:${escapeHtml(trk.color)}" data-trk-row="${escapeHtml(trk.id)}">
          <div class="th-top">
            <span class="th-name" data-rename-trk="${escapeHtml(trk.id)}" title="더블클릭하여 트랙 이름 변경">${escapeHtml(trk.name)}</span>
            <span class="th-type-tag">${escapeHtml(typeLabel)}</span>
          </div>
          <div class="th-bottom">
            <div class="th-btn-group">
              <button class="mute-btn ${trk.muted ? "on" : ""}" data-mute-trk="${escapeHtml(trk.id)}" type="button" title="뮤트">M</button>
              <button class="solo-btn ${trk.solo ? "on" : ""}" data-solo-trk="${escapeHtml(trk.id)}" type="button" title="솔로">S</button>
              ${actionButtons}
            </div>
            <button class="trk-action-btn" data-del-trk="${escapeHtml(trk.id)}" type="button" title="트랙 삭제">✕</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function getOrCreateClipForTrack(track) {
  let clip = (project.clips || []).find((c) => c.id === selectedClipId && c.trackId === track.id);
  if (!clip) {
    clip = (project.clips || []).find((c) => c.trackId === track.id);
  }
  if (!clip) {
    clip = createEmptyClip(track, 0, 4);
    project.clips.push(clip);
    persistLocal();
    arrangementView.resizeAndDraw();
  }
  selectedClipId = clip.id;
  return clip;
}

trackHeadersList.addEventListener("click", (e) => {
  const vstBtn = e.target.closest("[data-open-vst]");
  if (vstBtn) {
    const trk = project.tracks.find((t) => t.id === vstBtn.dataset.openVst);
    if (trk) {
      project.selectedTrackId = trk.id;
      renderTrackHeaders();
      renderMixer();
      openSynthModal(trk);
    }
    return;
  }

  const prBtn = e.target.closest("[data-open-pr]");
  if (prBtn) {
    const trk = project.tracks.find((t) => t.id === prBtn.dataset.openPr);
    if (trk) {
      project.selectedTrackId = trk.id;
      const clip = getOrCreateClipForTrack(trk);
      openClipEditor(trk, clip);
    }
    return;
  }

  const seqBtn = e.target.closest("[data-open-seq]");
  if (seqBtn) {
    const trk = project.tracks.find((t) => t.id === seqBtn.dataset.openSeq);
    if (trk) {
      project.selectedTrackId = trk.id;
      const clip = getOrCreateClipForTrack(trk);
      openClipEditor(trk, clip);
    }
    return;
  }

  const muteBtn = e.target.closest("[data-mute-trk]");
  if (muteBtn) {
    const trk = project.tracks.find((t) => t.id === muteBtn.dataset.muteTrk);
    if (trk) {
      trk.muted = !trk.muted;
      engine.rebuildMixGraph();
      persistLocal();
      renderTrackHeaders();
      renderMixer();
    }
    return;
  }

  const soloBtn = e.target.closest("[data-solo-trk]");
  if (soloBtn) {
    const trk = project.tracks.find((t) => t.id === soloBtn.dataset.soloTrk);
    if (trk) {
      trk.solo = !trk.solo;
      engine.rebuildMixGraph();
      persistLocal();
      renderTrackHeaders();
      renderMixer();
    }
    return;
  }

  const delBtn = e.target.closest("[data-del-trk]");
  if (delBtn) {
    const trkId = delBtn.dataset.delTrk;
    project.tracks = project.tracks.filter((t) => t.id !== trkId);
    project.clips = (project.clips || []).filter((c) => c.trackId !== trkId);
    if (project.selectedTrackId === trkId) {
      project.selectedTrackId = project.tracks[0]?.id || null;
    }
    engine.rebuildMixGraph();
    persistLocal();
    renderAll();
    return;
  }

  const row = e.target.closest("[data-trk-row]");
  if (row) {
    project.selectedTrackId = row.dataset.trkRow;
    const trk = getSelectedTrack();
    if (trk) engine.previewTrackNote(trk, trk.baseMidi || 60, 0.2);
    renderTrackHeaders();
    renderMixer();
    arrangementView.draw();
  }
});

trackHeadersList.addEventListener("dblclick", (e) => {
  const nameEl = e.target.closest("[data-rename-trk]");
  if (!nameEl) return;
  const trk = project.tracks.find((t) => t.id === nameEl.dataset.renameTrk);
  if (!trk) return;
  const next = prompt("트랙 이름 변경:", trk.name);
  if (next && next.trim()) {
    trk.name = next.trim().slice(0, 28);
    persistLocal();
    renderAll();
  }
});

// Console Mixer (Docked at Bottom)
function renderMixer() {
  const tracks = project.tracks || [];
  const stripsHtml = tracks
    .map(
      (trk) => `
      <div class="mixer-strip ${trk.id === project.selectedTrackId ? "selected" : ""}" data-strip-trk="${escapeHtml(trk.id)}">
        <span class="strip-name" style="color:${escapeHtml(trk.color)}">${escapeHtml(trk.name)}</span>
        <div class="fader-meter-wrap">
          <input class="v-fader" type="range" min="0" max="1.15" step="0.01" value="${trk.volume ?? 0.8}" data-mix-vol="${escapeHtml(trk.id)}" title="트랙 볼륨">
          <div class="meter-bar"><div class="meter-fill" id="meter_${escapeHtml(trk.id)}"></div></div>
        </div>
        <div class="strip-knobs">
          <div class="mini-knob-row">
            <span>PAN</span>
            <input type="range" min="-1" max="1" step="0.05" value="${trk.pan ?? 0}" data-mix-pan="${escapeHtml(trk.id)}">
          </div>
          <div class="mini-knob-row">
            <span>REV</span>
            <input type="range" min="0" max="0.9" step="0.02" value="${trk.reverbSend ?? 0.1}" data-mix-rev="${escapeHtml(trk.id)}">
          </div>
        </div>
        <div class="th-btn-group">
          <button class="mute-btn ${trk.muted ? "on" : ""}" data-mix-mute="${escapeHtml(trk.id)}" type="button">M</button>
          <button class="solo-btn ${trk.solo ? "on" : ""}" data-mix-solo="${escapeHtml(trk.id)}" type="button">S</button>
        </div>
      </div>
    `
    )
    .join("");

  const masterHtml = `
    <div class="mixer-strip master-strip">
      <span class="strip-name" style="color:var(--amber)">MASTER</span>
      <div class="fader-meter-wrap">
        <input class="v-fader" type="range" min="0" max="1.15" step="0.01" value="${project.masterVolume ?? 0.88}" id="masterVolFader" title="마스터 볼륨">
        <div class="meter-bar"><div class="meter-fill" id="meter_master"></div></div>
      </div>
      <div class="mini-knob-row"><span>LIMITER</span></div>
    </div>
  `;

  mixerStripsEl.innerHTML = masterHtml + stripsHtml;

  document.querySelector("#masterVolFader")?.addEventListener("input", (e) => {
    project.masterVolume = Number(e.target.value);
    engine.rebuildMixGraph();
    persistLocal();
  });
}

mixerStripsEl.addEventListener("input", (e) => {
  const { mixVol, mixPan, mixRev } = e.target.dataset;
  if (mixVol) {
    const trk = project.tracks.find((t) => t.id === mixVol);
    if (trk) trk.volume = Number(e.target.value);
  } else if (mixPan) {
    const trk = project.tracks.find((t) => t.id === mixPan);
    if (trk) trk.pan = Number(e.target.value);
  } else if (mixRev) {
    const trk = project.tracks.find((t) => t.id === mixRev);
    if (trk) trk.reverbSend = Number(e.target.value);
  } else {
    return;
  }
  engine.rebuildMixGraph();
  persistLocal();
});

mixerStripsEl.addEventListener("click", (e) => {
  const muteId = e.target.closest("[data-mix-mute]")?.dataset.mixMute;
  if (muteId) {
    const trk = project.tracks.find((t) => t.id === muteId);
    if (trk) {
      trk.muted = !trk.muted;
      engine.rebuildMixGraph();
      persistLocal();
      renderTrackHeaders();
      renderMixer();
    }
    return;
  }
  const soloId = e.target.closest("[data-mix-solo]")?.dataset.mixSolo;
  if (soloId) {
    const trk = project.tracks.find((t) => t.id === soloId);
    if (trk) {
      trk.solo = !trk.solo;
      engine.rebuildMixGraph();
      persistLocal();
      renderTrackHeaders();
      renderMixer();
    }
    return;
  }
  const strip = e.target.closest("[data-strip-trk]");
  if (strip && !e.target.matches("input, button")) {
    project.selectedTrackId = strip.dataset.stripTrk;
    renderTrackHeaders();
    renderMixer();
  }
});

resetSoloMuteBtn.addEventListener("click", () => {
  for (const t of project.tracks) {
    t.muted = false;
    t.solo = false;
  }
  engine.rebuildMixGraph();
  renderTrackHeaders();
  renderMixer();
});

// ON-DEMAND CLIP EDITOR (PIANO ROLL OR BEAT SEQUENCER)
function openClipEditor(track, clip) {
  editingTrackId = track.id;
  editingClipId = clip.id;
  selectedClipId = clip.id;
  project.selectedTrackId = track.id;

  editorDot.style.background = track.color || "#ff6bcb";
  clipNameInput.value = clip.name || "";
  loopClipBtn.classList.toggle("active", engine.loopClipId === clip.id);

  if (track.type === "drumkit") {
    editorTitle.textContent = `🥁 비트 시퀀서 · ${track.name}`;
    prTools.hidden = true;
    seqTools.hidden = false;
    pianoRollEditorBody.hidden = true;
    beatSequencerBody.hidden = false;
    renderBeatSequencerRows(track, clip);
  } else {
    editorTitle.textContent = `🎹 피아노롤 · ${track.name}`;
    prTools.hidden = false;
    seqTools.hidden = true;
    pianoRollEditorBody.hidden = false;
    beatSequencerBody.hidden = true;
    clipPatternBarsSelect.value = String(clip.patternBars || 1);
    scaleSelect.value = project.scale || "minor";
  }

  clipEditorBackdrop.hidden = false;
  renderTrackHeaders();
  renderMixer();
  arrangementView.draw();

  if (track.type !== "drumkit") {
    requestAnimationFrame(() => {
      pianoRoll.resizeAndDraw();
      pianoRoll.scrollToCenterOctave();
    });
  }
}

function closeClipEditor() {
  clipEditorBackdrop.hidden = true;
  if (engine.loopClipId) {
    engine.loopClipId = null;
    loopClipBtn.classList.remove("active");
  }
  editingTrackId = null;
  editingClipId = null;
  arrangementView.draw();
}

closeClipEditorBtn.addEventListener("click", closeClipEditor);
clipEditorBackdrop.addEventListener("click", (e) => {
  if (e.target === clipEditorBackdrop) closeClipEditor();
});

clipNameInput.addEventListener("input", () => {
  const ctx = getEditingContext();
  if (ctx?.clip) {
    ctx.clip.name = clipNameInput.value.trim() || "Clip";
    persistLocal();
    arrangementView.draw();
  }
});

loopClipBtn.addEventListener("click", () => {
  const ctx = getEditingContext();
  if (!ctx?.clip) return;
  if (engine.loopClipId === ctx.clip.id) {
    engine.loopClipId = null;
    loopClipBtn.classList.remove("active");
  } else {
    engine.loopClipId = ctx.clip.id;
    engine.seekToBar(ctx.clip.bar || 0);
    loopClipBtn.classList.add("active");
    if (!engine.isPlaying) togglePlay();
  }
});

clipPatternBarsSelect.addEventListener("change", () => {
  const ctx = getEditingContext();
  if (!ctx?.clip) return;
  ctx.clip.patternBars = Number(clipPatternBarsSelect.value) || 1;
  persistLocal();
  pianoRoll.resizeAndDraw();
  arrangementView.draw();
});

scaleSelect.addEventListener("change", () => {
  project.scale = scaleSelect.value;
  persistLocal();
  pianoRoll.draw();
});

openSynthFromPrBtn.addEventListener("click", () => {
  const ctx = getEditingContext();
  if (ctx?.track) openSynthModal(ctx.track);
});

clearClipNotesBtn.addEventListener("click", () => {
  const ctx = getEditingContext();
  if (ctx?.clip) {
    ctx.clip.notes = [];
    persistLocal();
    pianoRoll.draw();
    arrangementView.draw();
  }
});

// Beat Sequencer inside Clip Editor
function renderBeatSequencerRows(track, clip) {
  if (!clip.drumSteps) clip.drumSteps = {};
  drumStepRows.innerHTML = DRUM_ROWS.map((row) => {
    if (!clip.drumSteps[row.key]) clip.drumSteps[row.key] = new Array(16).fill(0);
    const arr = clip.drumSteps[row.key];
    const pads = arr
      .map((val, idx) => {
        const alt = Math.floor(idx / 4) % 2 === 1 ? "alt-group" : "";
        const act = val ? "active" : "";
        const bg = val ? `style="background:${escapeHtml(row.color)}"` : "";
        return `<button class="step-pad ${alt} ${act}" data-drum-key="${escapeHtml(row.key)}" data-step-idx="${idx}" ${bg} type="button"></button>`;
      })
      .join("");

    return `
      <div class="drum-row">
        <button class="drum-name-btn" style="border-left-color:${escapeHtml(row.color)}" data-preview-drum="${escapeHtml(row.key)}" type="button">
          ${escapeHtml(row.name)}
        </button>
        <div class="step-grid">${pads}</div>
      </div>
    `;
  }).join("");
}

drumStepRows.addEventListener("click", (e) => {
  const ctx = getEditingContext();
  if (!ctx?.track || !ctx?.clip) return;

  const previewBtn = e.target.closest("[data-preview-drum]");
  if (previewBtn) {
    engine.previewDrumRow(ctx.track, previewBtn.dataset.previewDrum);
    return;
  }

  const pad = e.target.closest("[data-drum-key]");
  if (pad) {
    const key = pad.dataset.drumKey;
    const idx = Number(pad.dataset.stepIdx);
    if (!ctx.clip.drumSteps[key]) ctx.clip.drumSteps[key] = new Array(16).fill(0);
    const next = ctx.clip.drumSteps[key][idx] ? 0 : 0.88;
    ctx.clip.drumSteps[key][idx] = next;
    if (next && !engine.isPlaying) {
      engine.previewDrumRow(ctx.track, key);
    }
    persistLocal();
    renderBeatSequencerRows(ctx.track, ctx.clip);
    arrangementView.draw();
  }
});

fill2StepHatBtn.addEventListener("click", () => {
  const ctx = getEditingContext();
  if (!ctx?.clip) return;
  ctx.clip.drumSteps.hihat = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 0.78 : 0));
  persistLocal();
  renderBeatSequencerRows(ctx.track, ctx.clip);
  arrangementView.draw();
});

fill4FloorBtn.addEventListener("click", () => {
  const ctx = getEditingContext();
  if (!ctx?.clip) return;
  ctx.clip.drumSteps.kick808 = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 0.94 : 0));
  persistLocal();
  renderBeatSequencerRows(ctx.track, ctx.clip);
  arrangementView.draw();
});

clearDrumClipBtn.addEventListener("click", () => {
  const ctx = getEditingContext();
  if (!ctx?.clip) return;
  for (const r of DRUM_ROWS) ctx.clip.drumSteps[r.key] = new Array(16).fill(0);
  persistLocal();
  renderBeatSequencerRows(ctx.track, ctx.clip);
  arrangementView.draw();
});

// ON-DEMAND VST SYNTH / VIRTUAL INSTRUMENT WINDOW
function openSynthModal(track) {
  if (!track || track.type === "drumkit") return;
  synthTargetTrackId = track.id;
  renderSynthBody(track);
  synthModal.hidden = false;
}

function renderSynthBody(track) {
  synthModalTitle.textContent = `${track.name} · 사운드 엔진`;
  const s = track.synth || {};

  const presetOptions = INSTRUMENT_PRESETS.map(
    (p) => `<option value="${p.id}" ${p.id === track.presetId ? "selected" : ""}>${escapeHtml(p.name)} (${p.category})</option>`
  ).join("");

  const waveButtons = ["sawtooth", "square", "triangle", "sine"]
    .map(
      (w) =>
        `<button class="wave-btn ${(s.waveform || "sawtooth") === w ? "active" : ""}" data-wave="${w}" type="button">${w.toUpperCase()}</button>`
    )
    .join("");

  synthBody.innerHTML = `
    <div class="synth-top-row">
      <label class="inline-label">가상악기 프리셋 변경
        <select id="synthPresetPicker" class="mini-select">${presetOptions}</select>
      </label>
      <div class="synth-wave-pills">${waveButtons}</div>
    </div>

    <div class="synth-knobs-grid">
      <label class="knob-card">
        <span>FILTER CUTOFF <strong id="valCutoff">${Math.round(s.cutoff ?? 3000)} Hz</strong></span>
        <input type="range" min="100" max="12000" step="20" value="${s.cutoff ?? 3000}" data-synth-param="cutoff">
      </label>
      <label class="knob-card">
        <span>RESONANCE (Q) <strong id="valRes">${Number(s.resonance ?? 1.5).toFixed(1)}</strong></span>
        <input type="range" min="0.5" max="14" step="0.1" value="${s.resonance ?? 1.5}" data-synth-param="resonance">
      </label>
      <label class="knob-card">
        <span>ATTACK <strong id="valAtk">${Math.round((s.attack ?? 0.01) * 1000)} ms</strong></span>
        <input type="range" min="0.002" max="0.8" step="0.005" value="${s.attack ?? 0.01}" data-synth-param="attack">
      </label>
      <label class="knob-card">
        <span>DECAY <strong id="valDec">${Math.round((s.decay ?? 0.25) * 1000)} ms</strong></span>
        <input type="range" min="0.04" max="1.2" step="0.01" value="${s.decay ?? 0.25}" data-synth-param="decay">
      </label>
      <label class="knob-card">
        <span>SUSTAIN <strong id="valSus">${Math.round((s.sustain ?? 0.6) * 100)}%</strong></span>
        <input type="range" min="0" max="1" step="0.02" value="${s.sustain ?? 0.6}" data-synth-param="sustain">
      </label>
      <label class="knob-card">
        <span>RELEASE <strong id="valRel">${Math.round((s.release ?? 0.2) * 1000)} ms</strong></span>
        <input type="range" min="0.02" max="1.5" step="0.02" value="${s.release ?? 0.2}" data-synth-param="release">
      </label>
      <label class="knob-card">
        <span>UNISON DETUNE <strong id="valDet">${Math.round(s.detune ?? 10)} ct</strong></span>
        <input type="range" min="0" max="45" step="1" value="${s.detune ?? 10}" data-synth-param="detune">
      </label>
      <label class="knob-card">
        <span>${track.engine === "fmkeys" ? "FM MODULATION" : "SUB OSCILLATOR"} <strong id="valSub">${Math.round((track.engine === "fmkeys" ? (s.fmAmount ?? 2) * 20 : (s.subMix ?? 0.2) * 100))}%</strong></span>
        <input type="range" min="0" max="${track.engine === "fmkeys" ? 5 : 1}" step="0.05" value="${track.engine === "fmkeys" ? s.fmAmount ?? 2 : s.subMix ?? 0.2}" data-synth-param="${track.engine === "fmkeys" ? "fmAmount" : "subMix"}">
      </label>
    </div>
  `;

  document.querySelector("#synthPresetPicker")?.addEventListener("change", (e) => {
    const preset = INSTRUMENT_PRESETS.find((p) => p.id === e.target.value);
    if (!preset) return;
    track.presetId = preset.id;
    track.name = preset.name;
    track.category = preset.category;
    track.color = preset.color;
    track.engine = preset.engine;
    track.baseMidi = preset.baseMidi;
    track.synth = { ...preset.synth };
    engine.previewTrackNote(track, track.baseMidi || 60, 0.3);
    persistLocal();
    renderSynthBody(track);
    renderAll();
  });
}

synthBody.addEventListener("click", (e) => {
  const waveBtn = e.target.closest("[data-wave]");
  if (!waveBtn) return;
  const track = project.tracks.find((t) => t.id === synthTargetTrackId);
  if (!track) return;
  track.synth.waveform = waveBtn.dataset.wave;
  engine.previewTrackNote(track, 60, 0.25);
  persistLocal();
  renderSynthBody(track);
});

synthBody.addEventListener("input", (e) => {
  const param = e.target.dataset.synthParam;
  if (!param) return;
  const track = project.tracks.find((t) => t.id === synthTargetTrackId);
  if (!track) return;
  const val = Number(e.target.value);
  track.synth[param] = val;

  if (param === "cutoff") document.querySelector("#valCutoff").textContent = `${Math.round(val)} Hz`;
  if (param === "resonance") document.querySelector("#valRes").textContent = val.toFixed(1);
  if (param === "attack") document.querySelector("#valAtk").textContent = `${Math.round(val * 1000)} ms`;
  if (param === "decay") document.querySelector("#valDec").textContent = `${Math.round(val * 1000)} ms`;
  if (param === "sustain") document.querySelector("#valSus").textContent = `${Math.round(val * 100)}%`;
  if (param === "release") document.querySelector("#valRel").textContent = `${Math.round(val * 1000)} ms`;
  if (param === "detune") document.querySelector("#valDet").textContent = `${Math.round(val)} ct`;
  if (param === "subMix") document.querySelector("#valSub").textContent = `${Math.round(val * 100)}%`;
  if (param === "fmAmount") document.querySelector("#valSub").textContent = `${Math.round(val * 20)}%`;

  persistLocal();
});

auditionSynthBtn.addEventListener("click", () => {
  const track = project.tracks.find((t) => t.id === synthTargetTrackId);
  if (track) engine.previewTrackNote(track, 60, 0.4);
});

closeSynthBtn.addEventListener("click", () => (synthModal.hidden = true));
synthModal.addEventListener("click", (e) => {
  if (e.target === synthModal) synthModal.hidden = true;
});

// Demo Loader & WAV Export
demoSelect.addEventListener("change", () => {
  const factory = DEMO_PROJECTS[demoSelect.value];
  if (!factory) return;
  const wasPlaying = engine.isPlaying;
  engine.stop(true);
  closeClipEditor();
  project = factory();
  selectedClipId = project.clips?.[0]?.id || null;
  engine.graph = null;
  persistLocal();
  renderAll();
  if (wasPlaying) {
    engine.start();
    playBtn.classList.add("playing");
    playBtn.textContent = "⏸ PAUSE";
  }
  showToast(`'${project.title}' 세션 로드 완료`);
});

exportWavBtn.addEventListener("click", async () => {
  exportWavBtn.disabled = true;
  exportWavBtn.textContent = "⏳ 렌더링…";
  try {
    const blob = await exportProjectToWav(project);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(project.title || "sonora_track").replace(/[^a-zA-Z0-9가-힣_-]/g, "_")}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("16-bit 스테레오 WAV 파일 추출 완료!");
  } catch (err) {
    showToast(`WAV 추출 실패: ${err.message}`);
  } finally {
    exportWavBtn.disabled = false;
    exportWavBtn.textContent = "⬇ WAV 추출";
  }
});

// Animation Loop
function highlightDrumStep(step) {
  if (beatSequencerBody.hidden) return;
  drumStepRows.querySelectorAll(".step-pad").forEach((pad) => {
    pad.classList.toggle("playing-step", Number(pad.dataset.stepIdx) === step);
  });
}

function updateTransportReadout() {
  const gStep = engine.pollPlayhead();
  const bar = Math.floor(gStep / 16) + 1;
  const beat = Math.floor((gStep % 16) / 4) + 1;
  const sixteenth = (gStep % 4) + 1;
  lcdTime.textContent = `${String(bar).padStart(2, "0")} : ${String(beat).padStart(2, "0")} : ${String(sixteenth).padStart(2, "0")}`;

  if (engine.isPlaying) {
    arrangementView.setPlayhead(gStep);

    const ctx = getEditingContext();
    if (ctx?.clip) {
      const clipStartStep = (ctx.clip.bar || 0) * 16;
      const clipEndStep = clipStartStep + (ctx.clip.lengthBars || 1) * 16;
      const patSteps = (ctx.clip.patternBars || 1) * 16;
      if (gStep >= clipStartStep && gStep < clipEndStep) {
        const localStep = (gStep - clipStartStep) % patSteps;
        pianoRoll.setPlayhead(localStep);
        highlightDrumStep(localStep % 16);
      } else {
        pianoRoll.setPlayhead(-1);
        highlightDrumStep(-1);
      }
    }
  }
}

function animationFrame() {
  updateTransportReadout();

  let masterPeak = 0;
  for (const trk of project.tracks || []) {
    const peak = engine.getTrackPeak(trk.id);
    if (peak > masterPeak) masterPeak = peak;
    const el = document.getElementById(`meter_${trk.id}`);
    if (el) el.style.height = `${Math.max(4, Math.round(peak * 100))}%`;
  }
  const masterEl = document.getElementById("meter_master");
  if (masterEl) masterEl.style.height = `${Math.max(4, Math.round(masterPeak * 100))}%`;

  specCtx.fillStyle = "#070a0f";
  specCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
  const bins = engine.getMasterSpectrum();
  if (bins) {
    const count = 20;
    const barW = spectrumCanvas.width / count;
    for (let i = 0; i < count; i++) {
      const val = bins[i * 2] / 255;
      const h = Math.max(2, val * (spectrumCanvas.height - 4));
      specCtx.fillStyle = i > 14 ? "#ff6bcb" : "#38bdf8";
      specCtx.fillRect(i * barW + 1, spectrumCanvas.height - h, barW - 2, h);
    }
  }

  requestAnimationFrame(animationFrame);
}

// Keyboard Shortcuts & Musical Typing
const KEY_TO_MIDI = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53, KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  KeyQ: 60, Digit2: 61, KeyW: 62, Digit3: 63, KeyE: 64, KeyR: 65, Digit5: 66, KeyT: 67, Digit6: 68, KeyY: 69, Digit7: 70, KeyU: 71, KeyI: 72,
};

window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Escape") {
    if (!synthModal.hidden) synthModal.hidden = true;
    else if (!clipEditorBackdrop.hidden) closeClipEditor();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
    return;
  }
  if (!e.repeat && KEY_TO_MIDI[e.code] !== undefined) {
    const trk = getSelectedTrack();
    if (trk) engine.previewTrackNote(trk, KEY_TO_MIDI[e.code], 0.3);
  }
});

// Cloud & ONEID Auth
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "요청 처리 실패");
  return data;
}

function renderAuth() {
  if (currentUser) {
    authBox.innerHTML = `
      <span class="user-chip">${escapeHtml(currentUser.nickname)}</span>
      <button id="logoutBtn" class="studio-btn" type="button">로그아웃</button>
    `;
    document.querySelector("#logoutBtn").addEventListener("click", () => {
      token = "";
      currentUser = null;
      localStorage.removeItem(TOKEN_KEY);
      renderAuth();
      showToast("로그아웃되었습니다.");
    });
    cloudAuthHint.textContent = `${currentUser.nickname} (${currentUser.username}) 계정으로 클라우드 저장이 활성화되었습니다.`;
  } else {
    authBox.innerHTML = `<button id="openLoginBtn" class="studio-btn primary" type="button">ONEID 로그인</button>`;
    document.querySelector("#openLoginBtn").addEventListener("click", () => {
      loginError.hidden = true;
      loginModal.hidden = false;
      loginUsername.focus();
    });
    cloudAuthHint.textContent = "ONEID 로그인 후 내 곡을 클라우드에 저장하고 커뮤니티에 공개할 수 있습니다.";
  }
}

closeLoginBtn.addEventListener("click", () => (loginModal.hidden = true));
closeCloudBtn.addEventListener("click", () => (cloudModal.hidden = true));

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  try {
    const res = await api("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { username: loginUsername.value.trim(), password: loginPassword.value },
    });
    token = res.access_token;
    currentUser = res.user;
    localStorage.setItem(TOKEN_KEY, token);
    loginModal.hidden = true;
    loginForm.reset();
    renderAuth();
    showToast(`${currentUser.nickname}님 환영합니다!`);
    if (!cloudModal.hidden) refreshCloudLists();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.hidden = false;
  }
});

openCloudBtn.addEventListener("click", () => {
  cloudSaveTitle.value = project.title || "New Session";
  cloudModal.hidden = false;
  refreshCloudLists();
});

async function refreshCloudLists() {
  publicProjectsList.innerHTML = `<small style="color:var(--muted)">불러오는 중…</small>`;
  try {
    const pub = await api("/api/projects/public", { auth: false });
    publicProjectsList.innerHTML = pub.length
      ? pub
          .map(
            (p) => `
          <div class="proj-item">
            <div class="proj-meta">
              <strong>${escapeHtml(p.title)}</strong>
              <small>by ${escapeHtml(p.nickname)} · ${p.bpm} BPM · ♥ ${p.likes}</small>
            </div>
            <div class="rack-actions">
              <button class="mini-btn accent" data-load-proj="${p.project_id}" type="button">불러오기</button>
              <button class="mini-btn" data-like-proj="${p.project_id}" type="button">♥</button>
            </div>
          </div>
        `
          )
          .join("")
      : `<small style="color:var(--muted)">아직 공개된 트랙이 없습니다.</small>`;
  } catch {
    publicProjectsList.innerHTML = `<small style="color:var(--muted)">목록을 불러오지 못했습니다.</small>`;
  }

  if (!currentUser) {
    myProjectsList.innerHTML = `<small style="color:var(--muted)">ONEID 로그인 후 내 클라우드 목록을 볼 수 있습니다.</small>`;
    return;
  }

  try {
    const mine = await api("/api/projects/my");
    myProjectsList.innerHTML = mine.length
      ? mine
          .map(
            (p) => `
          <div class="proj-item">
            <div class="proj-meta">
              <strong>${escapeHtml(p.title)}</strong>
              <small>${p.bpm} BPM · ${p.is_public ? "공개" : "비공개"}</small>
            </div>
            <div class="rack-actions">
              <button class="mini-btn accent" data-load-proj="${p.project_id}" type="button">열기</button>
              <button class="mini-btn" data-del-proj="${p.project_id}" type="button">삭제</button>
            </div>
          </div>
        `
          )
          .join("")
      : `<small style="color:var(--muted)">저장한 프로젝트가 없습니다.</small>`;
  } catch {
    myProjectsList.innerHTML = `<small style="color:var(--muted)">목록 조회 실패</small>`;
  }
}

saveCloudBtn.addEventListener("click", async () => {
  if (!currentUser) {
    loginModal.hidden = false;
    return;
  }
  const title = cloudSaveTitle.value.trim() || project.title || "New Session";
  project.title = title;
  projectTitleInput.value = title;
  saveCloudBtn.disabled = true;
  try {
    const res = await api("/api/projects", {
      method: "POST",
      body: {
        project_id: project.projectId || null,
        title,
        bpm: project.bpm,
        is_public: cloudPublicCheck.checked,
        project_data: project,
      },
    });
    project.projectId = res.project.project_id;
    persistLocal();
    showToast(res.message);
    refreshCloudLists();
  } catch (err) {
    showToast(err.message);
  } finally {
    saveCloudBtn.disabled = false;
  }
});

cloudModal.addEventListener("click", async (e) => {
  const loadId = e.target.closest("[data-load-proj]")?.dataset.loadProj;
  if (loadId) {
    try {
      const full = await api(`/api/projects/${loadId}`);
      if (!Array.isArray(full.project_data?.tracks)) {
        throw new Error("이전 버전 포맷 프로젝트입니다.");
      }
      engine.stop(true);
      project = full.project_data;
      project.projectId = full.project_id;
      engine.graph = null;
      persistLocal();
      renderAll();
      cloudModal.hidden = true;
      showToast(`'${full.title}' 프로젝트를 불러왔습니다.`);
    } catch (err) {
      showToast(err.message);
    }
    return;
  }

  const likeId = e.target.closest("[data-like-proj]")?.dataset.likeProj;
  if (likeId) {
    try {
      await api(`/api/projects/${likeId}/like`, { method: "POST", auth: false });
      refreshCloudLists();
    } catch {}
    return;
  }

  const delId = e.target.closest("[data-del-proj]")?.dataset.delProj;
  if (delId) {
    if (!confirm("이 클라우드 프로젝트를 삭제할까요?")) return;
    try {
      await api(`/api/projects/${delId}`, { method: "DELETE" });
      if (project.projectId === Number(delId)) project.projectId = null;
      refreshCloudLists();
      showToast("삭제되었습니다.");
    } catch (err) {
      showToast(err.message);
    }
  }
});

saveJsonBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(project.title || "sonora").replace(/[^a-zA-Z0-9가-힣_-]/g, "_")}.sonora.json`;
  a.click();
  URL.revokeObjectURL(url);
});

loadJsonInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.tracks)) throw new Error("유효한 SONORA 프로젝트 파일이 아닙니다.");
    engine.stop(true);
    project = parsed;
    engine.graph = null;
    persistLocal();
    renderAll();
    cloudModal.hidden = true;
    showToast(`파일 '${file.name}' 로드 완료!`);
  } catch (err) {
    showToast(err.message);
  }
});

function renderAll() {
  projectTitleInput.value = project.title || "New Session";
  bpmInput.value = project.bpm || 120;
  swingInput.value = project.swing || 0;

  renderTrackHeaders();
  renderMixer();
  arrangementView.resizeAndDraw();
}

// Initialize with clean 2-track Blank Session by default!
(async function init() {
  project = DEMO_PROJECTS.blank();
  try {
    const saved = localStorage.getItem(LOCAL_AUTOSAVE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.tracks)) {
        project = parsed;
      }
    }
  } catch {}

  if (token) {
    try {
      currentUser = await api("/api/auth/me");
    } catch {
      token = "";
      currentUser = null;
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  renderAuth();
  renderAll();
  requestAnimationFrame(animationFrame);
})();

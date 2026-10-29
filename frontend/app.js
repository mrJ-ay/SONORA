import { INSTRUMENT_PRESETS } from "./audio/instruments.js";
import { SonoraEngine, exportProjectToWav } from "./audio/engine.js";
import { DEMO_PROJECTS, cloneChannelFromPreset } from "./state/demos.js";
import { PianoRollView } from "./ui/pianoRoll.js";
import { ArrangementView } from "./ui/arrangement.js";

const TOKEN_KEY = "sonora_oneid_token";
const LOCAL_AUTOSAVE_KEY = "sonora_autosave_v1";

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
let project = DEMO_PROJECTS.neondrive();
let activeView = "split";

// DOM Elements
const projectTitleInput = document.querySelector("#projectTitleInput");
const modePatBtn = document.querySelector("#modePatBtn");
const modeSongBtn = document.querySelector("#modeSongBtn");
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

const patternListEl = document.querySelector("#patternList");
const addPatternBtn = document.querySelector("#addPatternBtn");
const clonePatternBtn = document.querySelector("#clonePatternBtn");
const viewTabs = document.querySelectorAll(".view-tab");
const workspaceEl = document.querySelector("#workspace");

const panels = {
  arrangement: document.querySelector("#secArrangement"),
  sequencer: document.querySelector("#secSequencer"),
  pianoroll: document.querySelector("#secPianoRoll"),
  synth: document.querySelector("#secSynth"),
  mixer: document.querySelector("#secMixer"),
};

const channelRackList = document.querySelector("#channelRackList");
const seqPatternLabel = document.querySelector("#seqPatternLabel");
const addChannelPresetSelect = document.querySelector("#addChannelPresetSelect");
const fillHatBtn = document.querySelector("#fillHatBtn");
const clearStepsBtn = document.querySelector("#clearStepsBtn");

const prTargetLabel = document.querySelector("#prTargetLabel");
const scaleSelect = document.querySelector("#scaleSelect");
const clearNotesBtn = document.querySelector("#clearNotesBtn");
const clearArrangementBtn = document.querySelector("#clearArrangementBtn");

const synthChannelLabel = document.querySelector("#synthChannelLabel");
const synthBody = document.querySelector("#synthBody");
const auditionSynthBtn = document.querySelector("#auditionSynthBtn");

const mixerStripsEl = document.querySelector("#mixerStrips");
const resetSoloMuteBtn = document.querySelector("#resetSoloMuteBtn");

const toastEl = document.querySelector("#toast");

// Modals
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
  }, 3200);
}

function getActivePattern() {
  return project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
}

function getSelectedChannel() {
  return project.channels.find((c) => c.id === project.selectedChannelId) || project.channels[0];
}

function persistLocal() {
  try {
    localStorage.setItem(LOCAL_AUTOSAVE_KEY, JSON.stringify(project));
  } catch {}
}

// Audio Engine
const engine = new SonoraEngine(
  () => project,
  () => updateTransportReadout()
);
engine.mode = "song";

// Canvas Sub-views
const pianoRoll = new PianoRollView(
  document.querySelector("#pianoRollCanvas"),
  document.querySelector("#pianoRollWrap"),
  {
    getProject: () => project,
    onNotesChanged: () => {
      persistLocal();
      arrangementView.draw();
    },
    onAuditionNote: (ch, midi, dur = 0.24) => engine.previewNote(ch, midi, dur),
  }
);

const arrangementView = new ArrangementView(
  document.querySelector("#arrangementCanvas"),
  document.querySelector("#arrangementWrap"),
  {
    getProject: () => project,
    onChanged: () => persistLocal(),
    onSelectPattern: (patId, openEditor) => {
      project.activePatternId = patId;
      renderAll();
      if (openEditor && activeView === "arrangement") setView("split");
    },
    onSeekBar: (barIdx) => {
      engine.seekToBar(barIdx);
      updateTransportReadout();
    },
  }
);

// Transport Controls
function setMode(mode) {
  engine.mode = mode;
  modePatBtn.classList.toggle("active", mode === "pattern");
  modeSongBtn.classList.toggle("active", mode === "song");
  if (engine.isPlaying) {
    engine.stop(true);
    engine.start(mode);
  }
}

modePatBtn.addEventListener("click", () => setMode("pattern"));
modeSongBtn.addEventListener("click", () => setMode("song"));

function togglePlay() {
  if (engine.isPlaying) {
    engine.stop(false);
    playBtn.classList.remove("playing");
    playBtn.textContent = "▶ PLAY";
  } else {
    engine.start(engine.mode);
    playBtn.classList.add("playing");
    playBtn.textContent = "⏸ PAUSE";
  }
}

playBtn.addEventListener("click", togglePlay);
stopBtn.addEventListener("click", () => {
  engine.stop(true);
  playBtn.classList.remove("playing");
  playBtn.textContent = "▶ PLAY";
  pianoRoll.setPlayhead(-1);
  arrangementView.setPlayhead(-1);
  highlightSequencerStep(-1);
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
  project.title = projectTitleInput.value.trim() || "Untitled Track";
  persistLocal();
});

metroBtn.addEventListener("click", () => {
  engine.metronome = !engine.metronome;
  metroBtn.classList.toggle("active", engine.metronome);
});

// View Switcher
function setView(viewName) {
  activeView = viewName;
  viewTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === viewName));

  if (viewName === "split") {
    workspaceEl.className = "workspace layout-split";
    Object.values(panels).forEach((p) => (p.hidden = false));
  } else {
    workspaceEl.className = "workspace layout-single";
    Object.entries(panels).forEach(([key, panel]) => {
      panel.hidden = key !== viewName;
    });
  }

  requestAnimationFrame(() => {
    pianoRoll.resizeAndDraw();
    arrangementView.resizeAndDraw();
  });
}

viewTabs.forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

// Pattern Strip
function renderPatterns() {
  patternListEl.innerHTML = project.patterns
    .map(
      (p) => `
      <button class="pat-pill ${p.id === project.activePatternId ? "active" : ""}" data-pat-id="${escapeHtml(p.id)}" type="button">
        <span class="pat-dot" style="background:${escapeHtml(p.color || "#54a0ff")}"></span>
        ${escapeHtml(p.name)}
      </button>
    `
    )
    .join("");
}

patternListEl.addEventListener("click", (e) => {
  const pill = e.target.closest("[data-pat-id]");
  if (!pill) return;
  project.activePatternId = pill.dataset.patId;
  renderAll();
});

patternListEl.addEventListener("dblclick", (e) => {
  const pill = e.target.closest("[data-pat-id]");
  if (!pill) return;
  const pat = project.patterns.find((p) => p.id === pill.dataset.patId);
  if (!pat) return;
  const nextName = prompt("패턴 이름 변경:", pat.name);
  if (nextName && nextName.trim()) {
    pat.name = nextName.trim().slice(0, 28);
    persistLocal();
    renderAll();
  }
});

const PAT_COLORS = ["#ff6bcb", "#54a0ff", "#1dd1a1", "#ff9f43", "#a29bfe", "#48dbfb", "#badc58"];

addPatternBtn.addEventListener("click", () => {
  const idx = project.patterns.length + 1;
  const steps = {};
  const notes = {};
  for (const ch of project.channels) {
    steps[ch.id] = new Array(16).fill(0);
    notes[ch.id] = [];
  }
  const newPat = {
    id: `pat_${Date.now()}`,
    name: `${idx} · Pattern ${idx}`,
    color: PAT_COLORS[(idx - 1) % PAT_COLORS.length],
    lengthSteps: 16,
    steps,
    notes,
  };
  project.patterns.push(newPat);
  project.activePatternId = newPat.id;
  persistLocal();
  renderAll();
  showToast(`새 패턴 '${newPat.name}' 생성 완료`);
});

clonePatternBtn.addEventListener("click", () => {
  const cur = getActivePattern();
  if (!cur) return;
  const idx = project.patterns.length + 1;
  const copy = {
    id: `pat_${Date.now()}`,
    name: `${cur.name} (복사)`,
    color: PAT_COLORS[(idx - 1) % PAT_COLORS.length],
    lengthSteps: cur.lengthSteps || 16,
    steps: JSON.parse(JSON.stringify(cur.steps || {})),
    notes: JSON.parse(JSON.stringify(cur.notes || {})),
  };
  project.patterns.push(copy);
  project.activePatternId = copy.id;
  persistLocal();
  renderAll();
  showToast(`패턴 복제 완료`);
});

// Beat Sequencer & Channel Rack
function renderSequencer() {
  const pat = getActivePattern();
  if (!pat) return;
  seqPatternLabel.textContent = `${pat.name}`;

  channelRackList.innerHTML = project.channels
    .map((ch) => {
      if (!pat.steps[ch.id]) pat.steps[ch.id] = new Array(16).fill(0);
      const stepsArr = pat.steps[ch.id];
      const isSelected = ch.id === project.selectedChannelId;
      const padsHtml = stepsArr
        .map((val, idx) => {
          const altGroup = Math.floor(idx / 4) % 2 === 1 ? "alt-group" : "";
          const active = val ? "active" : "";
          const bg = val ? `style="background:${escapeHtml(ch.color)}"` : "";
          return `<button class="step-pad ${altGroup} ${active}" data-step-ch="${escapeHtml(ch.id)}" data-step-idx="${idx}" ${bg} type="button" aria-label="스텝 ${idx + 1}"></button>`;
        })
        .join("");

      return `
        <div class="rack-row ${isSelected ? "selected" : ""}">
          <div class="rack-info">
            <button class="mute-btn ${ch.muted ? "on" : ""}" data-mute-ch="${escapeHtml(ch.id)}" type="button" title="뮤트(Mute)">M</button>
            <button class="solo-btn ${ch.solo ? "on" : ""}" data-solo-ch="${escapeHtml(ch.id)}" type="button" title="솔로(Solo)">S</button>
            <button class="ch-select-btn" style="border-left-color:${escapeHtml(ch.color)}" data-sel-ch="${escapeHtml(ch.id)}" type="button" title="클릭하여 피아노롤/신스 대상 선택 및 미리듣기">
              ${escapeHtml(ch.name)}
            </button>
          </div>
          <div class="step-grid">${padsHtml}</div>
          <div class="rack-actions">
            <button class="mini-btn" data-open-pr="${escapeHtml(ch.id)}" type="button" title="피아노롤 열기">🎹</button>
            ${project.channels.length > 1 ? `<button class="mini-btn" data-del-ch="${escapeHtml(ch.id)}" type="button" title="채널 삭제">✕</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

channelRackList.addEventListener("click", (e) => {
  const pad = e.target.closest("[data-step-ch]");
  if (pad) {
    const chId = pad.dataset.stepCh;
    const idx = Number(pad.dataset.stepIdx);
    const pat = getActivePattern();
    if (!pat.steps[chId]) pat.steps[chId] = new Array(16).fill(0);
    const nextVal = pat.steps[chId][idx] ? 0 : 0.86;
    pat.steps[chId][idx] = nextVal;
    project.selectedChannelId = chId;
    const ch = getSelectedChannel();
    if (nextVal && !engine.isPlaying) {
      engine.previewNote(ch, ch.baseMidi || 36, 0.18);
    }
    persistLocal();
    renderSequencer();
    renderSynth();
    pianoRoll.draw();
    arrangementView.draw();
    prTargetLabel.textContent = `${ch.name} (${pat.name})`;
    return;
  }

  const selBtn = e.target.closest("[data-sel-ch]");
  if (selBtn) {
    project.selectedChannelId = selBtn.dataset.selCh;
    const ch = getSelectedChannel();
    engine.previewNote(ch, ch.baseMidi || 60, 0.24);
    renderAll();
    return;
  }

  const muteBtn = e.target.closest("[data-mute-ch]");
  if (muteBtn) {
    const ch = project.channels.find((c) => c.id === muteBtn.dataset.muteCh);
    if (ch) {
      ch.muted = !ch.muted;
      engine.rebuildMixGraph();
      persistLocal();
      renderSequencer();
      renderMixer();
    }
    return;
  }

  const soloBtn = e.target.closest("[data-solo-ch]");
  if (soloBtn) {
    const ch = project.channels.find((c) => c.id === soloBtn.dataset.soloCh);
    if (ch) {
      ch.solo = !ch.solo;
      engine.rebuildMixGraph();
      persistLocal();
      renderSequencer();
      renderMixer();
    }
    return;
  }

  const prBtn = e.target.closest("[data-open-pr]");
  if (prBtn) {
    project.selectedChannelId = prBtn.dataset.openPr;
    renderAll();
    if (activeView === "sequencer") setView("pianoroll");
    return;
  }

  const delBtn = e.target.closest("[data-del-ch]");
  if (delBtn && project.channels.length > 1) {
    const chId = delBtn.dataset.delCh;
    project.channels = project.channels.filter((c) => c.id !== chId);
    if (project.selectedChannelId === chId) {
      project.selectedChannelId = project.channels[0].id;
    }
    engine.rebuildMixGraph();
    persistLocal();
    renderAll();
  }
});

addChannelPresetSelect.addEventListener("change", () => {
  const presetId = addChannelPresetSelect.value;
  const newCh = cloneChannelFromPreset(presetId);
  project.channels.push(newCh);
  for (const pat of project.patterns) {
    pat.steps[newCh.id] = new Array(16).fill(0);
    pat.notes[newCh.id] = [];
  }
  project.selectedChannelId = newCh.id;
  addChannelPresetSelect.selectedIndex = 0;
  engine.rebuildMixGraph();
  engine.previewNote(newCh, newCh.baseMidi || 60, 0.25);
  persistLocal();
  renderAll();
  showToast(`가상악기 '${newCh.name}' 채널 추가됨`);
});

fillHatBtn.addEventListener("click", () => {
  const pat = getActivePattern();
  const ch = getSelectedChannel();
  if (!pat || !ch) return;
  pat.steps[ch.id] = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 0.78 : 0));
  persistLocal();
  renderSequencer();
  arrangementView.draw();
});

clearStepsBtn.addEventListener("click", () => {
  const pat = getActivePattern();
  if (!pat) return;
  for (const ch of project.channels) {
    pat.steps[ch.id] = new Array(16).fill(0);
  }
  persistLocal();
  renderSequencer();
  arrangementView.draw();
});

// Piano Roll Toolbar
scaleSelect.addEventListener("change", () => {
  project.scale = scaleSelect.value;
  pianoRoll.draw();
  persistLocal();
});

clearNotesBtn.addEventListener("click", () => {
  const pat = getActivePattern();
  const ch = getSelectedChannel();
  if (pat && ch) {
    pat.notes[ch.id] = [];
    persistLocal();
    pianoRoll.draw();
    arrangementView.draw();
  }
});

clearArrangementBtn.addEventListener("click", () => {
  project.arrangement = [];
  persistLocal();
  arrangementView.draw();
});

// Synthesizer & Virtual Instrument Editor
function renderSynth() {
  const ch = getSelectedChannel();
  if (!ch) return;
  synthChannelLabel.textContent = `${ch.name} (${ch.category})`;
  const s = ch.synth || {};
  const isMelodic = ch.engine === "synth" || ch.engine === "fmkeys";

  const presetOptions = INSTRUMENT_PRESETS.map(
    (p) => `<option value="${p.id}" ${p.id === ch.presetId ? "selected" : ""}>${escapeHtml(p.name)} (${p.category})</option>`
  ).join("");

  const waveButtons = isMelodic
    ? ["sawtooth", "square", "triangle", "sine"]
        .map(
          (w) =>
            `<button class="wave-btn ${(s.waveform || "sawtooth") === w ? "active" : ""}" data-wave="${w}" type="button">${w.toUpperCase()}</button>`
        )
        .join("")
    : `<span class="tool-hint">드럼 전용 물리 모델링 엔진 (${escapeHtml(ch.engine.toUpperCase())})</span>`;

  synthBody.innerHTML = `
    <div class="synth-top-row">
      <label class="inline-label">프리셋 사운드 교체
        <select id="synthPresetPicker" class="mini-select">${presetOptions}</select>
      </label>
      <div class="synth-Wave-pills">${waveButtons}</div>
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
      ${
        isMelodic
          ? `
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
          <span>SUB / FM DEPTH <strong id="valSub">${Math.round((ch.engine === "fmkeys" ? (s.fmAmount ?? 2) * 20 : (s.subMix ?? 0.2) * 100))}%</strong></span>
          <input type="range" min="0" max="${ch.engine === "fmkeys" ? 5 : 1}" step="0.05" value="${ch.engine === "fmkeys" ? s.fmAmount ?? 2 : s.subMix ?? 0.2}" data-synth-param="${ch.engine === "fmkeys" ? "fmAmount" : "subMix"}">
        </label>
      `
          : ""
      }
    </div>
  `;

  document.querySelector("#synthPresetPicker")?.addEventListener("change", (e) => {
    const preset = INSTRUMENT_PRESETS.find((p) => p.id === e.target.value);
    if (!preset) return;
    ch.presetId = preset.id;
    ch.name = preset.name;
    ch.category = preset.category;
    ch.color = preset.color;
    ch.engine = preset.engine;
    ch.baseMidi = preset.baseMidi;
    ch.synth = { ...preset.synth };
    engine.previewNote(ch, ch.baseMidi || 60, 0.3);
    persistLocal();
    renderAll();
  });
}

synthBody.addEventListener("click", (e) => {
  const waveBtn = e.target.closest("[data-wave]");
  if (!waveBtn) return;
  const ch = getSelectedChannel();
  ch.synth.waveform = waveBtn.dataset.wave;
  engine.previewNote(ch, 60, 0.25);
  persistLocal();
  renderSynth();
});

synthBody.addEventListener("input", (e) => {
  const param = e.target.dataset.synthParam;
  if (!param) return;
  const ch = getSelectedChannel();
  const val = Number(e.target.value);
  ch.synth[param] = val;

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
  const ch = getSelectedChannel();
  engine.previewNote(ch, ch.category === "Drum" ? ch.baseMidi : 60, 0.4);
});

// Studio Console Mixer
function renderMixer() {
  const chStrips = project.channels
    .map(
      (ch) => `
      <div class="mixer-strip ${ch.id === project.selectedChannelId ? "selected" : ""}" data-strip-ch="${escapeHtml(ch.id)}">
        <span class="strip-name" style="color:${escapeHtml(ch.color)}">${escapeHtml(ch.name)}</span>
        <div class="fader-meter-wrap">
          <input class="v-fader" type="range" min="0" max="1.15" step="0.01" value="${ch.volume ?? 0.8}" data-mix-vol="${escapeHtml(ch.id)}" title="채널 볼륨">
          <div class="meter-bar"><div class="meter-fill" id="meter_${escapeHtml(ch.id)}"></div></div>
        </div>
        <div class="mini-knob-row">
          <span>PAN (${ch.pan > 0.04 ? "R" : ch.pan < -0.04 ? "L" : "C"})</span>
          <input type="range" min="-1" max="1" step="0.05" value="${ch.pan ?? 0}" data-mix-pan="${escapeHtml(ch.id)}">
        </div>
        <div class="mini-knob-row">
          <span>REVERB ${Math.round((ch.reverbSend ?? 0.1) * 100)}%</span>
          <input type="range" min="0" max="0.9" step="0.02" value="${ch.reverbSend ?? 0.1}" data-mix-rev="${escapeHtml(ch.id)}">
        </div>
        <div class="mini-knob-row">
          <span>DELAY ${Math.round((ch.delaySend ?? 0.05) * 100)}%</span>
          <input type="range" min="0" max="0.8" step="0.02" value="${ch.delaySend ?? 0.05}" data-mix-dly="${escapeHtml(ch.id)}">
        </div>
        <div class="rack-info">
          <button class="mute-btn ${ch.muted ? "on" : ""}" data-mix-mute="${escapeHtml(ch.id)}" type="button">M</button>
          <button class="solo-btn ${ch.solo ? "on" : ""}" data-mix-solo="${escapeHtml(ch.id)}" type="button">S</button>
        </div>
      </div>
    `
    )
    .join("");

  const masterStrip = `
    <div class="mixer-strip master-strip">
      <span class="strip-name" style="color:var(--amber)">MASTER</span>
      <div class="fader-meter-wrap">
        <input class="v-fader" type="range" min="0" max="1.15" step="0.01" value="${project.masterVolume ?? 0.88}" id="masterVolFader" title="마스터 출력 볼륨">
        <div class="meter-bar"><div class="meter-fill" id="meter_master"></div></div>
      </div>
      <div class="mini-knob-row"><span>LIMITER ON</span></div>
    </div>
  `;

  mixerStripsEl.innerHTML = masterStrip + chStrips;

  document.querySelector("#masterVolFader")?.addEventListener("input", (e) => {
    project.masterVolume = Number(e.target.value);
    engine.rebuildMixGraph();
    persistLocal();
  });
}

mixerStripsEl.addEventListener("input", (e) => {
  const { mixVol, mixPan, mixRev, mixDly } = e.target.dataset;
  if (mixVol) {
    const ch = project.channels.find((c) => c.id === mixVol);
    if (ch) ch.volume = Number(e.target.value);
  } else if (mixPan) {
    const ch = project.channels.find((c) => c.id === mixPan);
    if (ch) ch.pan = Number(e.target.value);
  } else if (mixRev) {
    const ch = project.channels.find((c) => c.id === mixRev);
    if (ch) ch.reverbSend = Number(e.target.value);
  } else if (mixDly) {
    const ch = project.channels.find((c) => c.id === mixDly);
    if (ch) ch.delaySend = Number(e.target.value);
  } else {
    return;
  }
  engine.rebuildMixGraph();
  persistLocal();
});

mixerStripsEl.addEventListener("click", (e) => {
  const muteId = e.target.closest("[data-mix-mute]")?.dataset.mixMute;
  if (muteId) {
    const ch = project.channels.find((c) => c.id === muteId);
    if (ch) {
      ch.muted = !ch.muted;
      engine.rebuildMixGraph();
      renderSequencer();
      renderMixer();
    }
    return;
  }
  const soloId = e.target.closest("[data-mix-solo]")?.dataset.mixSolo;
  if (soloId) {
    const ch = project.channels.find((c) => c.id === soloId);
    if (ch) {
      ch.solo = !ch.solo;
      engine.rebuildMixGraph();
      renderSequencer();
      renderMixer();
    }
  }
});

resetSoloMuteBtn.addEventListener("click", () => {
  for (const ch of project.channels) {
    ch.muted = false;
    ch.solo = false;
  }
  engine.rebuildMixGraph();
  renderSequencer();
  renderMixer();
});

// Demo Loader & WAV Export
demoSelect.addEventListener("change", () => {
  const factory = DEMO_PROJECTS[demoSelect.value];
  if (!factory) return;
  const wasPlaying = engine.isPlaying;
  engine.stop(true);
  project = factory();
  engine.graph = null;
  persistLocal();
  renderAll();
  pianoRoll.scrollToCenterOctave();
  if (wasPlaying) {
    engine.start(engine.mode);
    playBtn.classList.add("playing");
    playBtn.textContent = "⏸ PAUSE";
  }
  showToast(`'${project.title}' 로드 완료`);
});

exportWavBtn.addEventListener("click", async () => {
  exportWavBtn.disabled = true;
  exportWavBtn.textContent = "⏳ 렌더링 중…";
  try {
    const blob = await exportProjectToWav(project, engine.mode);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(project.title || "sonora_track").replace(/[^a-zA-Z0-9가-힣_-]/g, "_")}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("16-bit 스테레오 WAV 내보내기 완료!");
  } catch (err) {
    showToast(`WAV 추출 실패: ${err.message}`);
  } finally {
    exportWavBtn.disabled = false;
    exportWavBtn.textContent = "⬇ WAV 추출";
  }
});

// Real-time Animation Loop (Playhead, LCD, Spectrum, Peak Meters)
function highlightSequencerStep(step) {
  const pads = channelRackList.querySelectorAll(".step-pad");
  pads.forEach((pad) => {
    const idx = Number(pad.dataset.stepIdx);
    pad.classList.toggle("playing-step", idx === step);
  });
}

function updateTransportReadout() {
  const gStep = engine.pollPlayhead();
  const bar = Math.floor(gStep / 16) + 1;
  const beat = Math.floor((gStep % 16) / 4) + 1;
  const sixteenth = (gStep % 4) + 1;
  lcdTime.textContent = `${String(bar).padStart(2, "0")} : ${String(beat).padStart(2, "0")} : ${String(sixteenth).padStart(2, "0")}`;

  if (engine.isPlaying) {
    const localStep = gStep % 16;
    highlightSequencerStep(localStep);
    pianoRoll.setPlayhead(localStep);
    arrangementView.setPlayhead(engine.mode === "song" ? gStep : -1);
  }
}

function animationFrame() {
  updateTransportReadout();

  // Channel Peak Meters
  let masterPeak = 0;
  for (const ch of project.channels) {
    const peak = engine.getChannelPeak(ch.id);
    if (peak > masterPeak) masterPeak = peak;
    const el = document.getElementById(`meter_${ch.id}`);
    if (el) el.style.height = `${Math.max(3, Math.round(peak * 100))}%`;
  }
  const masterEl = document.getElementById("meter_master");
  if (masterEl) masterEl.style.height = `${Math.max(3, Math.round(masterPeak * 100))}%`;

  // Master Spectrum Canvas
  specCtx.fillStyle = "#070a0f";
  specCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
  const bins = engine.getMasterSpectrum();
  if (bins) {
    const count = 22;
    const barW = spectrumCanvas.width / count;
    for (let i = 0; i < count; i++) {
      const val = bins[i * 2] / 255;
      const h = Math.max(2, val * (spectrumCanvas.height - 4));
      specCtx.fillStyle = i > 15 ? "#ff6bcb" : "#38bdf8";
      specCtx.fillRect(i * barW + 1, spectrumCanvas.height - h, barW - 2, h);
    }
  }

  requestAnimationFrame(animationFrame);
}

// Computer Keyboard Musical Typing + Spacebar Play/Pause
const KEY_TO_MIDI = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53, KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  KeyQ: 60, Digit2: 61, KeyW: 62, Digit3: 63, KeyE: 64, KeyR: 65, Digit5: 66, KeyT: 67, Digit6: 68, KeyY: 69, Digit7: 70, KeyU: 71, KeyI: 72,
};

window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
    return;
  }
  if (!e.repeat && KEY_TO_MIDI[e.code] !== undefined) {
    const ch = getSelectedChannel();
    engine.previewNote(ch, KEY_TO_MIDI[e.code], 0.3);
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
  cloudSaveTitle.value = project.title || "Untitled Track";
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
      : `<small style="color:var(--muted)">아직 공개된 트랙이 없습니다. 첫 트랙을 공유해 보세요!</small>`;
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
  const title = cloudSaveTitle.value.trim() || project.title || "Untitled Track";
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

// Local JSON Export / Import
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
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.channels) || !Array.isArray(parsed.patterns)) {
      throw new Error("유효한 SONORA 프로젝트 파일이 아닙니다.");
    }
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
  projectTitleInput.value = project.title || "Untitled Track";
  bpmInput.value = project.bpm || 120;
  swingInput.value = project.swing || 0;
  scaleSelect.value = project.scale || "minor";

  const pat = getActivePattern();
  const ch = getSelectedChannel();
  prTargetLabel.textContent = `${ch?.name || ""} · ${pat?.name || ""}`;

  renderPatterns();
  renderSequencer();
  renderSynth();
  renderMixer();
  pianoRoll.resizeAndDraw();
  arrangementView.resizeAndDraw();
}

// Initialize
(async function init() {
  try {
    const saved = localStorage.getItem(LOCAL_AUTOSAVE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.channels) && Array.isArray(parsed.patterns)) {
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
  requestAnimationFrame(() => pianoRoll.scrollToCenterOctave());
  requestAnimationFrame(animationFrame);
})();

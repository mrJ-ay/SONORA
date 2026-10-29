import { DRUM_ROWS, INSTRUMENT_PRESETS, midiToName } from "./audio/instruments.js";
import { SonoraEngine, exportProjectToWav, getTrackDrumRows } from "./audio/engine.js";
import {
  importExternalInstrumentFile,
  exportSynthPatchJson,
  getSampleEntry,
  getSf2Metadata,
} from "./audio/externalLoader.js";
import {
  DEMO_PROJECTS,
  createDrumTrack,
  createInstrumentTrack,
  createSamplerTrack,
  createSf2Track,
  createEmptyClip,
} from "./state/demos.js";
import { PianoRollView, SNAP_OPTIONS } from "./ui/pianoRoll.js";
import { ArrangementView } from "./ui/arrangement.js";
import { WindowManager } from "./ui/windowManager.js";

const TOKEN_KEY = "sonora_oneid_token";
const LOCAL_AUTOSAVE_KEY = "sonora_autosave_v3";

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
let project = DEMO_PROJECTS.blank();
let selectedClipId = null;

// Track context for file picker callbacks:
// { mode: "new_track" } | { mode: "replace_track", trackId } | { mode: "drum_pad", trackId, drumKey, clipId } | { mode: "add_drum_pad", trackId, clipId }
let pendingFileAction = { mode: "new_track" };

// Active floating window registries
const openPianoRolls = new Map(); // clipId -> { winId, view, trackId }
const openBeatSeqs = new Map();   // clipId -> { winId, trackId, renderGrid, updatePlayhead, syncLoopBtn }
const openInstWins = new Map();   // trackId -> { winId, renderContent }

// DOM Elements
const projectTitleInput = document.querySelector("#projectTitleInput");
const playBtn = document.querySelector("#playBtn");
const stopBtn = document.querySelector("#stopBtn");
const lcdTime = document.querySelector("#lcdTime");
const bpmInput = document.querySelector("#bpmInput");
const swingInput = document.querySelector("#swingInput");
const metroBtn = document.querySelector("#metroBtn");
const spectrumCanvas = document.querySelector("#spectrumCanvas");
const layoutPresetSelect = document.querySelector("#layoutPresetSelect");
const demoSelect = document.querySelector("#demoSelect");
const exportWavBtn = document.querySelector("#exportWavBtn");
const cloudBtn = document.querySelector("#cloudBtn");
const authArea = document.querySelector("#authArea");

const dawDesktop = document.querySelector("#dawDesktop");
const windowTaskbar = document.querySelector("#windowTaskbar");
const winArrangementEl = document.querySelector("#winArrangementEl");
const winMixerEl = document.querySelector("#winMixerEl");
const dropOverlay = document.querySelector("#dropOverlay");
const externalInstFileInput = document.querySelector("#externalInstFileInput");

const addDrumTrackBtn = document.querySelector("#addDrumTrackBtn");
const addInstTrackSelect = document.querySelector("#addInstTrackSelect");
const importExternalTrackBtn = document.querySelector("#importExternalTrackBtn");
const trackHeadersList = document.querySelector("#trackHeadersList");
const arrangementWrap = document.querySelector("#arrangementWrap");
const arrangementCanvas = document.querySelector("#arrangementCanvas");

const mixerStrips = document.querySelector("#mixerStrips");
const unmuteAllBtn = document.querySelector("#unmuteAllBtn");

const ONEID_API_URL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : "https://oneid-icvq.onrender.com";
const ONEID_CLIENT_ID = "sonora";
const ONEID_VERIFIER_KEY = "sonora_oneid_verifier";
const ONEID_STATE_KEY = "sonora_oneid_state";

const cloudModal = document.querySelector("#cloudModal");
const cloudStatusMsg = document.querySelector("#cloudStatusMsg");
const cloudList = document.querySelector("#cloudList");
const saveCloudBtn = document.querySelector("#saveCloudBtn");
const saveAsNewCloudBtn = document.querySelector("#saveAsNewCloudBtn");
const saveJsonBtn = document.querySelector("#saveJsonBtn");
const loadJsonInput = document.querySelector("#loadJsonInput");
const toastEl = document.querySelector("#toast");

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3000);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function persistLocal() {
  try {
    localStorage.setItem(LOCAL_AUTOSAVE_KEY, JSON.stringify(project));
  } catch {}
}

// Multi-Window Manager
const wm = new WindowManager(dawDesktop, windowTaskbar);

// Audio Engine
const engine = new SonoraEngine(
  () => project,
  (globalStep, isPlaying) => {
    const bar = Math.floor(globalStep / 16) + 1;
    const beat = Math.floor((globalStep % 16) / 4) + 1;
    const sixteenth = (globalStep % 4) + 1;
    lcdTime.textContent = `${String(bar).padStart(2, "0")} : ${String(beat).padStart(2, "0")} : ${String(sixteenth).padStart(2, "0")}`;

    playBtn.classList.toggle("playing", isPlaying);
    playBtn.textContent = isPlaying ? "⏸ PAUSE" : "▶ PLAY";

    arrangementView.setPlayhead(isPlaying ? globalStep : -1);

    // Update playheads in ALL open Piano Roll windows simultaneously!
    for (const [clipId, prEntry] of openPianoRolls.entries()) {
      const clip = (project.clips || []).find((c) => c.id === clipId);
      if (!clip || !isPlaying) {
        prEntry.view.setPlayhead(-1);
        continue;
      }
      const clipStart = (clip.bar || 0) * 16;
      const clipEnd = clipStart + (clip.lengthBars || 1) * 16;
      if (globalStep >= clipStart && globalStep < clipEnd) {
        const localStep = (globalStep - clipStart) % ((clip.patternBars || 1) * 16);
        prEntry.view.setPlayhead(localStep);
      } else {
        prEntry.view.setPlayhead(-1);
      }
    }

    // Update playheads in ALL open Beat Sequencer windows simultaneously!
    for (const [clipId, bsEntry] of openBeatSeqs.entries()) {
      const clip = (project.clips || []).find((c) => c.id === clipId);
      if (!clip || !isPlaying) {
        bsEntry.updatePlayhead(-1);
        continue;
      }
      const clipStart = (clip.bar || 0) * 16;
      const clipEnd = clipStart + (clip.lengthBars || 1) * 16;
      if (globalStep >= clipStart && globalStep < clipEnd) {
        const localStep = (globalStep - clipStart) % ((clip.patternBars || 1) * 16);
        bsEntry.updatePlayhead(localStep);
      } else {
        bsEntry.updatePlayhead(-1);
      }
    }
  }
);

// Arrangement View
const arrangementView = new ArrangementView(arrangementCanvas, arrangementWrap, {
  getProject: () => project,
  getSelectedClipId: () => selectedClipId,
  onSelectTrack: (trackId) => {
    project.selectedTrackId = trackId;
    renderTrackHeaders();
    renderMixerSelection();
  },
  onSelectClip: (clipId) => {
    selectedClipId = clipId;
  },
  onOpenClipEditor: (trackId, clipId) => {
    openClipWindow(trackId, clipId);
  },
  onSeekBar: (barIdx) => {
    engine.seekToBar(barIdx);
  },
  onChanged: () => {
    persistLocal();
    cleanupOrphanClipWindows();
  },
});

// Sync vertical scroll between track headers and timeline canvas
arrangementWrap.addEventListener("scroll", () => {
  trackHeadersList.scrollTop = arrangementWrap.scrollTop;
});

function syncLoopButtons() {
  for (const bs of openBeatSeqs.values()) bs.syncLoopBtn();
  document.querySelectorAll("[data-pr-loop-clip]").forEach((btn) => {
    const cid = btn.dataset.prLoopClip;
    const isLoop = engine.loopClipId === cid;
    btn.classList.toggle("active", isLoop);
    btn.textContent = isLoop ? "🔁 이 클립만 루프 중 (해제)" : "🔁 이 클립만 루프 재생";
  });
}

function cleanupOrphanClipWindows() {
  const validClipIds = new Set((project.clips || []).map((c) => c.id));
  const validTrackIds = new Set((project.tracks || []).map((t) => t.id));

  for (const [cid, entry] of [...openPianoRolls.entries()]) {
    if (!validClipIds.has(cid)) wm.closeWindow(entry.winId);
  }
  for (const [cid, entry] of [...openBeatSeqs.entries()]) {
    if (!validClipIds.has(cid)) wm.closeWindow(entry.winId);
  }
  for (const [tid, entry] of [...openInstWins.entries()]) {
    if (!validTrackIds.has(tid)) wm.closeWindow(entry.winId);
  }
}

// TRACK HEADERS (LEFT SIDE OF ARRANGEMENT)
function renderTrackHeaders() {
  trackHeadersList.innerHTML = "";
  const tracks = project.tracks || [];

  tracks.forEach((trk) => {
    const row = document.createElement("div");
    row.className = `track-header-row ${project.selectedTrackId === trk.id ? "selected" : ""}`;
    row.style.borderLeftColor = trk.color || "#54a0ff";

    const isDrum = trk.type === "drumkit";
    const tagText = isDrum
      ? "DRUM"
      : trk.engine === "sampler"
        ? "SAMPLER"
        : trk.engine === "sf2"
          ? "SF2"
          : (trk.category || "SYNTH").toUpperCase();

    row.innerHTML = `
      <div class="th-top">
        <span class="th-name" style="color:${trk.color || "#eef3fb"}" title="더블클릭하여 트랙 이름 변경">${escapeHtml(trk.name)}</span>
        <span class="th-type-tag">${escapeHtml(tagText)}</span>
      </div>
      <div class="th-bottom">
        <div class="th-btn-group">
          <button class="ms-btn mute ${trk.muted ? "active" : ""}" data-act="mute" type="button" title="뮤트">M</button>
          <button class="ms-btn solo ${trk.solo ? "active" : ""}" data-act="solo" type="button" title="솔로">S</button>
          ${!isDrum ? `<button class="trk-action-btn" data-act="synth" type="button" title="독립 가상악기/신스/샘플러 창 열기">🎛 악기창</button>` : ""}
          <button class="trk-action-btn" data-act="editclip" type="button" title="독립 ${isDrum ? "비트 시퀀서" : "피아노롤"} 창 열기">${isDrum ? "🥁 비트창" : "🎹 피아노롤"}</button>
        </div>
        <button class="ms-btn" data-act="delete" type="button" title="트랙 삭제">✕</button>
      </div>
    `;

    row.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      project.selectedTrackId = trk.id;

      if (!btn) {
        renderTrackHeaders();
        renderMixerSelection();
        arrangementView.draw();
        return;
      }

      const act = btn.dataset.act;
      if (act === "mute") {
        trk.muted = !trk.muted;
        engine.rebuildMixGraph();
        persistLocal();
        renderTrackHeaders();
        renderMixer();
      } else if (act === "solo") {
        trk.solo = !trk.solo;
        engine.rebuildMixGraph();
        persistLocal();
        renderTrackHeaders();
        renderMixer();
      } else if (act === "synth") {
        openInstrumentWindow(trk.id);
      } else if (act === "editclip") {
        let clip = (project.clips || []).find((c) => c.trackId === trk.id && c.id === selectedClipId)
          || (project.clips || []).find((c) => c.trackId === trk.id);
        if (!clip) {
          clip = createEmptyClip(trk, 0, 2);
          project.clips.push(clip);
          persistLocal();
          arrangementView.resizeAndDraw();
        }
        selectedClipId = clip.id;
        openClipWindow(trk.id, clip.id);
      } else if (act === "delete") {
        if (project.tracks.length <= 1) {
          showToast("최소 1개의 트랙은 남겨두어야 합니다.");
          return;
        }
        project.tracks = project.tracks.filter((t) => t.id !== trk.id);
        project.clips = (project.clips || []).filter((c) => c.trackId !== trk.id);
        if (project.selectedTrackId === trk.id) {
          project.selectedTrackId = project.tracks[0]?.id || null;
        }
        engine.graph = null;
        engine.rebuildMixGraph();
        cleanupOrphanClipWindows();
        persistLocal();
        renderAll();
      }
    });

    // Double-click track name to rename inline
    row.querySelector(".th-name").addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const next = prompt("트랙 이름을 입력하세요:", trk.name);
      if (next && next.trim()) {
        trk.name = next.trim();
        persistLocal();
        renderTrackHeaders();
        renderMixer();
      }
    });

    trackHeadersList.appendChild(row);
  });
}

// ADD TRACKS + EXTERNAL INSTRUMENT LOADER
addDrumTrackBtn.addEventListener("click", () => {
  const drumCount = (project.tracks || []).filter((t) => t.type === "drumkit").length;
  const newTrack = createDrumTrack(undefined, {
    name: drumCount === 0 ? "Studio Drum Kit" : `Drum Kit ${drumCount + 1}`,
  });
  project.tracks.push(newTrack);
  project.selectedTrackId = newTrack.id;
  engine.graph = null;
  engine.rebuildMixGraph();
  persistLocal();
  renderAll();
  showToast(`'${newTrack.name}' 트랙이 추가되었습니다.`);
});

addInstTrackSelect.addEventListener("change", () => {
  const presetId = addInstTrackSelect.value;
  if (!presetId) return;
  addInstTrackSelect.value = "";

  const newTrack = createInstrumentTrack(presetId);
  project.tracks.push(newTrack);
  project.selectedTrackId = newTrack.id;
  engine.graph = null;
  engine.rebuildMixGraph();
  persistLocal();
  renderAll();
  openInstrumentWindow(newTrack.id);
  showToast(`'${newTrack.name}' 트랙 및 악기 창이 열렸습니다.`);
});

importExternalTrackBtn.addEventListener("click", () => {
  pendingFileAction = { mode: "new_track" };
  externalInstFileInput.value = "";
  externalInstFileInput.click();
});

async function handleImportedFiles(fileList, actionContext) {
  engine.ensureContext();
  for (const file of fileList) {
    try {
      const res = await importExternalInstrumentFile(file, engine.ctx);

      if (actionContext.mode === "drum_pad") {
        if (res.kind !== "sample") {
          showToast("드럼 패드에는 오디오 파일(.wav, .mp3, .ogg, .flac)을 선택해 주세요.");
          continue;
        }
        const trk = (project.tracks || []).find((t) => t.id === actionContext.trackId);
        if (trk) {
          if (!trk.drumSamples) trk.drumSamples = {};
          trk.drumSamples[actionContext.drumKey] = { sampleId: res.sampleId, name: res.name };
          // Also check customDrumRows
          if (Array.isArray(trk.customDrumRows)) {
            const cRow = trk.customDrumRows.find((r) => r.key === actionContext.drumKey);
            if (cRow) {
              cRow.drumSampleId = res.sampleId;
              cRow.name = res.name;
            }
          }
          persistLocal();
          const bs = openBeatSeqs.get(actionContext.clipId);
          if (bs) bs.renderGrid();
          engine.previewDrumRow(trk, actionContext.drumKey);
          showToast(`드럼 패드에 '${res.name}' 샘플이 적용되었습니다!`);
        }
        continue;
      }

      if (actionContext.mode === "add_drum_pad") {
        if (res.kind !== "sample") {
          showToast("커스텀 드럼 패드에는 오디오 샘플(.wav, .mp3 등)을 선택해 주세요.");
          continue;
        }
        const trk = (project.tracks || []).find((t) => t.id === actionContext.trackId);
        if (trk) {
          if (!Array.isArray(trk.customDrumRows)) trk.customDrumRows = [];
          const key = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
          trk.customDrumRows.push({
            key,
            name: res.name.slice(0, 16),
            color: "#55efc4",
            engine: "sampler",
            drumSampleId: res.sampleId,
            baseMidi: 48,
          });
          persistLocal();
          const bs = openBeatSeqs.get(actionContext.clipId);
          if (bs) bs.renderGrid();
          engine.previewDrumRow(trk, key);
          showToast(`커스텀 드럼 패드 '${res.name}' 추가 완료!`);
        }
        continue;
      }

      if (actionContext.mode === "replace_track") {
        const trk = (project.tracks || []).find((t) => t.id === actionContext.trackId);
        if (!trk) continue;
        applyExternalResultToTrack(trk, res);
        persistLocal();
        renderTrackHeaders();
        renderMixer();
        const iw = openInstWins.get(trk.id);
        if (iw) iw.renderContent();
        engine.previewTrackNote(trk, 60, 0.35);
        showToast(`'${trk.name}'에 외부 파일이 적용되었습니다!`);
        continue;
      }

      // Default: create a brand-new track from external file!
      let newTrack;
      if (res.kind === "sample") {
        newTrack = createSamplerTrack({ sampleId: res.sampleId, name: res.name });
      } else if (res.kind === "sf2") {
        const firstInstName = res.instruments[0]?.name || res.fileName.replace(/\.sf2$/i, "");
        newTrack = createSf2Track({ sf2Id: res.sf2Id, sf2InstIndex: 0, name: firstInstName });
      } else if (res.kind === "synth_patch") {
        newTrack = createInstrumentTrack("cyberlead", undefined, {
          name: res.name,
          color: res.color,
          synth: res.synth,
        });
        newTrack.engine = res.engine;
        newTrack.category = "EXT PATCH";
      }

      if (newTrack) {
        project.tracks.push(newTrack);
        project.selectedTrackId = newTrack.id;
        const starterClip = createEmptyClip(newTrack, 0, 2);
        starterClip.name = `${newTrack.name} Clip`;
        project.clips.push(starterClip);
        selectedClipId = starterClip.id;

        engine.graph = null;
        engine.rebuildMixGraph();
        persistLocal();
        renderAll();
        openInstrumentWindow(newTrack.id);
        engine.previewTrackNote(newTrack, 60, 0.35);
        showToast(`외부 악기 '${newTrack.name}' 트랙이 불러와졌습니다!`);
      }
    } catch (err) {
      showToast(err.message || "파일을 불러오지 못했습니다.");
    }
  }
}

function applyExternalResultToTrack(trk, res) {
  if (res.kind === "sample") {
    trk.engine = "sampler";
    trk.sampleId = res.sampleId;
    trk.rootMidi = 60;
    trk.name = res.name;
    trk.category = "SAMPLER";
    trk.color = "#1dd1a1";
    trk.synth = {
      ...trk.synth,
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
    };
  } else if (res.kind === "sf2") {
    trk.engine = "sf2";
    trk.sf2Id = res.sf2Id;
    trk.sf2InstIndex = 0;
    trk.name = res.instruments[0]?.name || res.fileName.replace(/\.sf2$/i, "");
    trk.category = "SF2";
    trk.color = "#ffd166";
  } else if (res.kind === "synth_patch") {
    trk.engine = res.engine;
    trk.name = res.name;
    trk.category = "EXT PATCH";
    trk.synth = { ...trk.synth, ...res.synth };
  }
}

externalInstFileInput.addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])];
  if (!files.length) return;
  await handleImportedFiles(files, pendingFileAction);
});

// Drag & Drop external instrument files onto Desktop
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types?.includes("Files")) {
    dragDepth++;
    dropOverlay.hidden = false;
  }
});
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener("drop", async (e) => {
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  await handleImportedFiles([...e.dataTransfer.files], { mode: "new_track" });
});

// FLOATING CLIP WINDOWS (PIANO ROLL OR BEAT SEQUENCER)
function openClipWindow(trackId, clipId) {
  const track = (project.tracks || []).find((t) => t.id === trackId);
  const clip = (project.clips || []).find((c) => c.id === clipId);
  if (!track || !clip) return;

  if (track.type === "drumkit") {
    openBeatSeqWindow(track, clip);
  } else {
    openPianoRollWindow(track, clip);
  }
}

// 1) INDEPENDENT FLOATING PIANO ROLL WINDOW (with 1/32, 1/64, Triplet, Free Timing, Slice, Zoom)
function openPianoRollWindow(track, clip) {
  const winId = `win-pr-${clip.id}`;
  if (openPianoRolls.has(clip.id)) {
    wm.toggleMinimize(winId, false);
    wm.focusWindow(winId);
    return;
  }

  const snapOptsHtml = SNAP_OPTIONS.map(
    (o) => `<option value="${o.value}" ${Number(o.step) === 0.5 ? "selected" : ""}>${o.label}</option>`
  ).join("");

  const win = wm.createWindow({
    id: winId,
    title: `피아노롤 · ${track.name} — ${clip.name || "MIDI Clip"}`,
    icon: "🎹",
    accentColor: track.color || "#54a0ff",
    closable: true,
    width: 920,
    height: 520,
    minWidth: 520,
    minHeight: 300,
    onResize: () => {
      const entry = openPianoRolls.get(clip.id);
      if (entry) entry.view.resizeAndDraw();
    },
    onClose: () => {
      const entry = openPianoRolls.get(clip.id);
      if (entry) {
        entry.view.destroy();
        openPianoRolls.delete(clip.id);
      }
      if (engine.loopClipId === clip.id) {
        engine.loopClipId = null;
        syncLoopButtons();
      }
    },
  });

  win.bodyEl.innerHTML = `
    <div class="pr-toolbar">
      <div class="pr-tool-group">
        <input class="clip-name-input" data-role="clip-name" type="text" value="${escapeHtml(clip.name || "MIDI Clip")}" title="클립 이름">
        <label class="pr-label">박자 스냅
          <select class="mini-select" data-role="snap-select">${snapOptsHtml}</select>
        </label>
        <button class="mini-btn active" data-role="tool-draw" type="button" title="그리기 / 이동 / 좌우 끝 길이 조절">✏️ 연필</button>
        <button class="mini-btn" data-role="tool-slice" type="button" title="클릭한 위치에서 노트 쪼개기 (Ctrl+클릭도 가능)">✂️ 칼 쪼개기</button>
        <button class="mini-btn" data-role="split-half" type="button" title="선택된 노트(또는 전체 노트)를 정확히 반박으로 2등분">÷2 반박 분할</button>
        <div class="pr-label">줌
          <button class="mini-btn" data-role="zoom-out" type="button">−</button>
          <button class="mini-btn" data-role="zoom-in" type="button">＋</button>
        </div>
      </div>
      <div class="pr-tool-group">
        <label class="pr-label">루프 길이
          <select class="mini-select" data-role="pattern-bars">
            <option value="1" ${(clip.patternBars || 1) === 1 ? "selected" : ""}>1마디</option>
            <option value="2" ${clip.patternBars === 2 ? "selected" : ""}>2마디</option>
            <option value="4" ${clip.patternBars === 4 ? "selected" : ""}>4마디</option>
            <option value="8" ${clip.patternBars === 8 ? "selected" : ""}>8마디</option>
          </select>
        </label>
        <label class="pr-label">스케일
          <select class="mini-select" data-role="scale-select">
            <option value="minor" ${(project.scale || "minor") === "minor" ? "selected" : ""}>C Minor</option>
            <option value="major" ${project.scale === "major" ? "selected" : ""}>C Major</option>
            <option value="pentatonic" ${project.scale === "pentatonic" ? "selected" : ""}>Pentatonic</option>
            <option value="chromatic" ${project.scale === "chromatic" ? "selected" : ""}>Chromatic</option>
          </select>
        </label>
        <button class="mini-btn" data-role="open-inst" type="button">🎛 악기 설정</button>
        <button class="mini-btn" data-pr-loop-clip="${clip.id}" type="button">🔁 이 클립만 루프 재생</button>
        <button class="mini-btn" data-role="clear-notes" type="button">비우기</button>
      </div>
    </div>
    <div class="piano-roll-scroll" data-role="pr-scroll">
      <canvas data-role="pr-canvas"></canvas>
    </div>
    <div class="pr-footer-hint">
      <span>💡 <b>Shift 누른 채 드래그</b>: 스냅 무시 완전 자유 박자 · <b>Ctrl+클릭(또는 ✂️)</b>: 노트 분할 · <b>양쪽 끝 드래그</b>: 앞/뒤 길이 자유 조절</span>
      <span>노트 위 휠: 벨로시티(강약) · 우클릭: 삭제</span>
    </div>
  `;

  const scrollEl = win.bodyEl.querySelector('[data-role="pr-scroll"]');
  const canvasEl = win.bodyEl.querySelector('[data-role="pr-canvas"]');

  const prView = new PianoRollView(canvasEl, scrollEl, {
    getEditingContext: () => ({
      project,
      track: (project.tracks || []).find((t) => t.id === track.id),
      clip: (project.clips || []).find((c) => c.id === clip.id),
    }),
    onNotesChanged: () => {
      persistLocal();
      arrangementView.draw();
    },
    onAuditionNote: (trk, midi, dur = 0.22, vel = 0.85) => {
      engine.previewTrackNote(trk, midi, dur, vel);
    },
  });

  openPianoRolls.set(clip.id, { winId, view: prView, trackId: track.id });

  const nameInput = win.bodyEl.querySelector('[data-role="clip-name"]');
  const snapSelect = win.bodyEl.querySelector('[data-role="snap-select"]');
  const drawBtn = win.bodyEl.querySelector('[data-role="tool-draw"]');
  const sliceBtn = win.bodyEl.querySelector('[data-role="tool-slice"]');
  const splitHalfBtn = win.bodyEl.querySelector('[data-role="split-half"]');
  const zoomOutBtn = win.bodyEl.querySelector('[data-role="zoom-out"]');
  const zoomInBtn = win.bodyEl.querySelector('[data-role="zoom-in"]');
  const patBarsSelect = win.bodyEl.querySelector('[data-role="pattern-bars"]');
  const scaleSelect = win.bodyEl.querySelector('[data-role="scale-select"]');
  const openInstBtn = win.bodyEl.querySelector('[data-role="open-inst"]');
  const loopBtn = win.bodyEl.querySelector(`[data-pr-loop-clip="${clip.id}"]`);
  const clearBtn = win.bodyEl.querySelector('[data-role="clear-notes"]');

  nameInput.addEventListener("input", () => {
    clip.name = nameInput.value;
    wm.setWindowTitle(winId, `피아노롤 · ${track.name} — ${clip.name || "MIDI Clip"}`);
    persistLocal();
    arrangementView.draw();
  });

  snapSelect.addEventListener("change", () => {
    const opt = SNAP_OPTIONS.find((o) => o.value === snapSelect.value);
    prView.setSnap(opt ? opt.step : 0.5);
  });

  drawBtn.addEventListener("click", () => {
    prView.setTool("draw");
    drawBtn.classList.add("active");
    sliceBtn.classList.remove("active");
  });

  sliceBtn.addEventListener("click", () => {
    prView.setTool("slice");
    sliceBtn.classList.add("active");
    drawBtn.classList.remove("active");
  });

  splitHalfBtn.addEventListener("click", () => {
    const cnt = prView.splitSelectedOrAllInHalf();
    if (cnt > 0) showToast(`${cnt}개 노트를 반박으로 분할했습니다.`);
    else showToast("분할할 노트가 없거나 이미 최소 길이입니다.");
  });

  zoomOutBtn.addEventListener("click", () => prView.setZoom(prView.zoom * 0.8));
  zoomInBtn.addEventListener("click", () => prView.setZoom(prView.zoom * 1.25));

  patBarsSelect.addEventListener("change", () => {
    clip.patternBars = Number(patBarsSelect.value) || 1;
    if ((clip.lengthBars || 1) < clip.patternBars) clip.lengthBars = clip.patternBars;
    persistLocal();
    prView.resizeAndDraw();
    arrangementView.resizeAndDraw();
  });

  scaleSelect.addEventListener("change", () => {
    project.scale = scaleSelect.value;
    persistLocal();
    for (const pr of openPianoRolls.values()) pr.view.draw();
  });

  openInstBtn.addEventListener("click", () => openInstrumentWindow(track.id));

  loopBtn.addEventListener("click", () => {
    if (engine.loopClipId === clip.id) {
      engine.loopClipId = null;
    } else {
      engine.loopClipId = clip.id;
      engine.seekToBar(clip.bar || 0);
      if (!engine.isPlaying) engine.start();
    }
    syncLoopButtons();
  });

  clearBtn.addEventListener("click", () => {
    clip.notes = [];
    persistLocal();
    prView.draw();
    arrangementView.draw();
  });

  syncLoopButtons();
  requestAnimationFrame(() => {
    prView.resizeAndDraw();
    prView.scrollToCenterOctave();
  });
}

// 2) INDEPENDENT FLOATING BEAT SEQUENCER WINDOW (16 / 32 반박 스텝 + 커스텀 드럼 샘플 로드)
function openBeatSeqWindow(track, clip) {
  const winId = `win-bs-${clip.id}`;
  if (openBeatSeqs.has(clip.id)) {
    wm.toggleMinimize(winId, false);
    wm.focusWindow(winId);
    return;
  }

  const win = wm.createWindow({
    id: winId,
    title: `비트 시퀀서 · ${track.name} — ${clip.name || "Beat Clip"}`,
    icon: "🥁",
    accentColor: track.color || "#ff5c5c",
    closable: true,
    width: 860,
    height: 390,
    minWidth: 480,
    minHeight: 250,
    onClose: () => {
      openBeatSeqs.delete(clip.id);
      if (engine.loopClipId === clip.id) {
        engine.loopClipId = null;
        syncLoopButtons();
      }
    },
  });

  win.bodyEl.innerHTML = `
    <div class="pr-toolbar">
      <div class="pr-tool-group">
        <input class="clip-name-input" data-role="clip-name" type="text" value="${escapeHtml(clip.name || "Beat Clip")}">
        <label class="pr-label">루프 길이
          <select class="mini-select" data-role="pattern-bars">
            <option value="1" ${(clip.patternBars || 1) === 1 ? "selected" : ""}>1마디</option>
            <option value="2" ${clip.patternBars === 2 ? "selected" : ""}>2마디</option>
            <option value="4" ${clip.patternBars === 4 ? "selected" : ""}>4마디</option>
          </select>
        </label>
        <label class="pr-label">박자 쪼개기
          <select class="mini-select" data-role="drum-subdiv">
            <option value="1" ${(clip.drumSubdiv || 1) === 1 ? "selected" : ""}>16스텝 (기본 1/16)</option>
            <option value="2" ${clip.drumSubdiv === 2 ? "selected" : ""}>32스텝 (반박 쪼개기 1/32)</option>
          </select>
        </label>
        <button class="mini-btn" data-role="add-custom-pad" type="button">+ 📂 외부 드럼 샘플 패드 추가</button>
      </div>
      <div class="pr-tool-group">
        <button class="mini-btn" data-role="loop-btn" type="button">🔁 이 클립만 루프 재생</button>
        <button class="mini-btn" data-role="clear-btn" type="button">비우기</button>
      </div>
    </div>
    <div class="beat-seq-scroll" data-role="bs-grid"></div>
  `;

  const gridWrap = win.bodyEl.querySelector('[data-role="bs-grid"]');
  const nameInput = win.bodyEl.querySelector('[data-role="clip-name"]');
  const patBarsSelect = win.bodyEl.querySelector('[data-role="pattern-bars"]');
  const subdivSelect = win.bodyEl.querySelector('[data-role="drum-subdiv"]');
  const addPadBtn = win.bodyEl.querySelector('[data-role="add-custom-pad"]');
  const loopBtn = win.bodyEl.querySelector('[data-role="loop-btn"]');
  const clearBtn = win.bodyEl.querySelector('[data-role="clear-btn"]');

  const renderGrid = () => {
    const trk = (project.tracks || []).find((t) => t.id === track.id);
    const cl = (project.clips || []).find((c) => c.id === clip.id);
    if (!trk || !cl) return;

    const subdiv = cl.drumSubdiv === 2 ? 2 : 1;
    const totalCols = (cl.patternBars || 1) * 16 * subdiv;
    if (!cl.drumSteps) cl.drumSteps = {};
    const rows = getTrackDrumRows(trk);

    gridWrap.innerHTML = "";
    rows.forEach((dRow) => {
      if (!Array.isArray(cl.drumSteps[dRow.key])) cl.drumSteps[dRow.key] = new Array(totalCols).fill(0);
      while (cl.drumSteps[dRow.key].length < totalCols) cl.drumSteps[dRow.key].push(0);

      const rowEl = document.createElement("div");
      rowEl.className = "drum-row";
      rowEl.style.setProperty("--row-color", dRow.color);

      const headEl = document.createElement("div");
      headEl.className = "drum-row-head";

      const padBtn = document.createElement("button");
      padBtn.type = "button";
      padBtn.className = "drum-pad-btn";
      padBtn.title = "클릭: 드럼 소리 미리듣기";
      padBtn.innerHTML = `<span class="drum-dot" style="background:${dRow.color}"></span><span>${escapeHtml(dRow.name)}</span>`;
      padBtn.addEventListener("click", () => engine.previewDrumRow(trk, dRow.key));

      const loadSmpBtn = document.createElement("button");
      loadSmpBtn.type = "button";
      loadSmpBtn.className = "mini-btn";
      loadSmpBtn.title = "이 드럼 패드에 외부 오디오 샘플(.wav/.mp3) 넣기";
      loadSmpBtn.textContent = "📂";
      loadSmpBtn.addEventListener("click", () => {
        pendingFileAction = { mode: "drum_pad", trackId: trk.id, drumKey: dRow.key, clipId: cl.id };
        externalInstFileInput.value = "";
        externalInstFileInput.click();
      });

      headEl.appendChild(padBtn);
      headEl.appendChild(loadSmpBtn);

      const cellsEl = document.createElement("div");
      cellsEl.className = "drum-steps-grid";
      cellsEl.style.gridTemplateColumns = `repeat(${totalCols}, minmax(${subdiv === 2 ? "16px" : "24px"}, 1fr))`;

      for (let i = 0; i < totalCols; i++) {
        const beatGroup = Math.floor(i / (4 * subdiv));
        const isSubHalf = subdiv === 2 && i % 2 === 1;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = `step-cell ${beatGroup % 2 === 1 ? "beat-alt" : ""} ${isSubHalf ? "sub-half" : ""} ${cl.drumSteps[dRow.key][i] ? "on" : ""}`;
        cell.dataset.colIdx = String(i);
        cell.addEventListener("click", () => {
          const next = cl.drumSteps[dRow.key][i] ? 0 : 0.88;
          cl.drumSteps[dRow.key][i] = next;
          cell.classList.toggle("on", Boolean(next));
          if (next) engine.previewDrumRow(trk, dRow.key);
          persistLocal();
          arrangementView.draw();
        });
        cellsEl.appendChild(cell);
      }

      rowEl.appendChild(headEl);
      rowEl.appendChild(cellsEl);
      gridWrap.appendChild(rowEl);
    });
  };

  const updatePlayhead = (local16thStep) => {
    const subdiv = clip.drumSubdiv === 2 ? 2 : 1;
    const targetCol = local16thStep < 0 ? -1 : local16thStep * subdiv;
    gridWrap.querySelectorAll(".step-cell").forEach((cell) => {
      cell.classList.toggle("playhead", Number(cell.dataset.colIdx) === targetCol);
    });
  };

  const syncLoopBtn = () => {
    const isLoop = engine.loopClipId === clip.id;
    loopBtn.classList.toggle("active", isLoop);
    loopBtn.textContent = isLoop ? "🔁 이 클립만 루프 중 (해제)" : "🔁 이 클립만 루프 재생";
  };

  nameInput.addEventListener("input", () => {
    clip.name = nameInput.value;
    wm.setWindowTitle(winId, `비트 시퀀서 · ${track.name} — ${clip.name || "Beat Clip"}`);
    persistLocal();
    arrangementView.draw();
  });

  patBarsSelect.addEventListener("change", () => {
    clip.patternBars = Number(patBarsSelect.value) || 1;
    if ((clip.lengthBars || 1) < clip.patternBars) clip.lengthBars = clip.patternBars;
    persistLocal();
    renderGrid();
    arrangementView.resizeAndDraw();
  });

  subdivSelect.addEventListener("change", () => {
    const prev = clip.drumSubdiv === 2 ? 2 : 1;
    const next = Number(subdivSelect.value) === 2 ? 2 : 1;
    if (prev !== next && clip.drumSteps) {
      // Rescale existing hits cleanly so beat positions stay aligned!
      for (const key of Object.keys(clip.drumSteps)) {
        const oldArr = clip.drumSteps[key] || [];
        if (next === 2 && prev === 1) {
          const expanded = new Array(oldArr.length * 2).fill(0);
          oldArr.forEach((v, idx) => { expanded[idx * 2] = v; });
          clip.drumSteps[key] = expanded;
        } else if (next === 1 && prev === 2) {
          const shrunk = new Array(Math.ceil(oldArr.length / 2)).fill(0);
          for (let i = 0; i < shrunk.length; i++) shrunk[i] = oldArr[i * 2] || oldArr[i * 2 + 1] || 0;
          clip.drumSteps[key] = shrunk;
        }
      }
    }
    clip.drumSubdiv = next;
    persistLocal();
    renderGrid();
    arrangementView.draw();
  });

  addPadBtn.addEventListener("click", () => {
    pendingFileAction = { mode: "add_drum_pad", trackId: track.id, clipId: clip.id };
    externalInstFileInput.value = "";
    externalInstFileInput.click();
  });

  loopBtn.addEventListener("click", () => {
    if (engine.loopClipId === clip.id) {
      engine.loopClipId = null;
    } else {
      engine.loopClipId = clip.id;
      engine.seekToBar(clip.bar || 0);
      if (!engine.isPlaying) engine.start();
    }
    syncLoopButtons();
  });

  clearBtn.addEventListener("click", () => {
    if (clip.drumSteps) {
      for (const k of Object.keys(clip.drumSteps)) clip.drumSteps[k].fill(0);
    }
    persistLocal();
    renderGrid();
    arrangementView.draw();
  });

  openBeatSeqs.set(clip.id, { winId, trackId: track.id, renderGrid, updatePlayhead, syncLoopBtn });
  renderGrid();
  syncLoopBtn();
}

// 3) INDEPENDENT FLOATING INSTRUMENT / SYNTH / SAMPLER / SF2 WINDOW
function openInstrumentWindow(trackId) {
  const trk = (project.tracks || []).find((t) => t.id === trackId);
  if (!trk || trk.type === "drumkit") return;

  const winId = `win-inst-${trk.id}`;
  if (openInstWins.has(trk.id)) {
    wm.toggleMinimize(winId, false);
    wm.focusWindow(winId);
    return;
  }

  const win = wm.createWindow({
    id: winId,
    title: `가상악기 / 신스 · ${trk.name}`,
    icon: "🎛️",
    accentColor: trk.color || "#ff6bcb",
    closable: true,
    width: 500,
    height: 510,
    minWidth: 380,
    minHeight: 340,
    onClose: () => {
      openInstWins.delete(trk.id);
    },
  });

  const renderContent = () => {
    const t = (project.tracks || []).find((x) => x.id === trackId);
    if (!t) return;
    if (!t.synth) t.synth = {};
    const s = t.synth;
    wm.setWindowTitle(winId, `가상악기 / 신스 · ${t.name}`);

    const presetOpts = INSTRUMENT_PRESETS.map(
      (p) => `<option value="${p.id}" ${t.presetId === p.id && t.engine !== "sampler" && t.engine !== "sf2" ? "selected" : ""}>${p.name} (${p.category})</option>`
    ).join("");

    let specificPanelHtml = "";

    if (t.engine === "sampler") {
      const smp = getSampleEntry(t.sampleId);
      const rootOpts = [];
      for (let m = 36; m <= 84; m++) {
        rootOpts.push(`<option value="${m}" ${(t.rootMidi || 60) === m ? "selected" : ""}>${midiToName(m)} (MIDI ${m})</option>`);
      }
      specificPanelHtml = `
        <div class="waveform-box">
          <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--muted);">
            <span>오디오 샘플러: <strong style="color:var(--green)">${escapeHtml(smp?.name || t.name)}</strong></span>
            <span>${smp ? `${smp.duration.toFixed(2)}s · ${smp.sampleRate}Hz` : "샘플 메모리 로드됨"}</span>
          </div>
          <canvas class="waveform-canvas" data-role="wave-canvas" width="440" height="68"></canvas>
        </div>
        <div class="synth-grid">
          <label class="synth-field">
            <span>기준 음정 (Root Key)</span>
            <select class="mini-select" data-param="rootMidi">${rootOpts.join("")}</select>
          </label>
          <label class="synth-field">
            <span>서스테인 무한 루프</span>
            <label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;margin-top:4px;cursor:pointer;">
              <input type="checkbox" data-param="loopSample" ${s.loopSample ? "checked" : ""}> 샘플 구간 반복 재생
            </label>
          </label>
          <label class="synth-field">
            <span>시작 지점 (Trim Start) <strong data-lbl="trimStart">${Math.round((s.trimStart ?? 0) * 100)}%</strong></span>
            <input type="range" min="0" max="0.9" step="0.01" value="${s.trimStart ?? 0}" data-param="trimStart">
          </label>
          <label class="synth-field">
            <span>끝 지점 (Trim End) <strong data-lbl="trimEnd">${Math.round((s.trimEnd ?? 1) * 100)}%</strong></span>
            <input type="range" min="0.1" max="1" step="0.01" value="${s.trimEnd ?? 1}" data-param="trimEnd">
          </label>
        </div>
      `;
    } else if (t.engine === "sf2") {
      const sf2 = getSf2Metadata(t.sf2Id);
      const instOpts = (sf2?.instruments || []).map(
        (inst, idx) => `<option value="${idx}" ${(t.sf2InstIndex || 0) === idx ? "selected" : ""}>${escapeHtml(inst.name)} (${inst.zones.length} zones)</option>`
      ).join("");
      specificPanelHtml = `
        <div class="waveform-box">
          <div style="font-size:0.75rem;color:var(--amber);font-weight:800;">🎼 SoundFont 2 (.sf2) 멀티샘플 가상악기: ${escapeHtml(sf2?.fileName || t.name)}</div>
          <label class="pr-label" style="margin-top:4px;">사운드폰트 내장 프리셋 선택
            <select class="mini-select" data-param="sf2InstIndex" style="flex:1;">${instOpts || "<option value='0'>Default Instrument</option>"}</select>
          </label>
        </div>
      `;
    } else {
      specificPanelHtml = `
        <div class="synth-grid">
          <label class="synth-field">
            <span>합성 엔진</span>
            <select class="mini-select" data-param="engine">
              <option value="synth" ${t.engine !== "fmkeys" ? "selected" : ""}>Analog Dual-Osc Synth</option>
              <option value="fmkeys" ${t.engine === "fmkeys" ? "selected" : ""}>2-Op FM Keys / Pluck</option>
            </select>
          </label>
          <label class="synth-field">
            <span>오실레이터 파형</span>
            <select class="mini-select" data-param="waveform">
              <option value="sawtooth" ${s.waveform === "sawtooth" ? "selected" : ""}>Sawtooth (풍성한 배음)</option>
              <option value="square" ${s.waveform === "square" ? "selected" : ""}>Square (레트로/리드)</option>
              <option value="triangle" ${s.waveform === "triangle" ? "selected" : ""}>Triangle (부드러운 톤)</option>
              <option value="sine" ${s.waveform === "sine" ? "selected" : ""}>Sine (순수 사인파)</option>
            </select>
          </label>
          <label class="synth-field">
            <span>유니즌 디튠 <strong data-lbl="detune">${Math.round(s.detune ?? 10)} ct</strong></span>
            <input type="range" min="0" max="40" step="1" value="${s.detune ?? 10}" data-param="detune">
          </label>
          <label class="synth-field">
            <span>서브 / FM 배음 <strong data-lbl="subMix">${Math.round((s.subMix ?? 0.2) * 100)}%</strong></span>
            <input type="range" min="0" max="1" step="0.01" value="${s.subMix ?? 0.2}" data-param="subMix">
          </label>
        </div>
      `;
    }

    // Build 13-key C4..C5 audition keyboard
    const blackSet = new Set([1, 3, 6, 8, 10]);
    let keysHtml = "";
    for (let m = 60; m <= 72; m++) {
      const isBlack = blackSet.has(m % 12);
      keysHtml += `<button type="button" class="aud-key ${isBlack ? "black" : ""}" data-midi="${m}">${midiToName(m)}</button>`;
    }

    win.bodyEl.innerHTML = `
      <div class="inst-win-scroll">
        <div class="inst-top-actions">
          <select class="mini-select" data-role="preset-switch" title="내장 가상악기 프리셋으로 전환">
            <option value="">내장 프리셋 변경...</option>
            ${presetOpts}
          </select>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button class="mini-btn accent" data-role="load-ext" type="button" title=".wav/.mp3 샘플, .sf2 사운드폰트, .json 신스 패치 파일 불러오기">📂 외부 악기/샘플 불러오기</button>
            <button class="mini-btn" data-role="export-patch" type="button" title="현재 신스 세팅을 .synth.json 파일로 내보내기">💾 패치 저장</button>
          </div>
        </div>

        ${specificPanelHtml}

        <div class="synth-grid">
          <label class="synth-field">
            <span>필터 컷오프 <strong data-lbl="cutoff">${Math.round(s.cutoff ?? 3200)} Hz</strong></span>
            <input type="range" min="100" max="15000" step="20" value="${s.cutoff ?? 3200}" data-param="cutoff">
          </label>
          <label class="synth-field">
            <span>레조넌스 (Q) <strong data-lbl="resonance">${Number(s.resonance ?? 1.5).toFixed(1)}</strong></span>
            <input type="range" min="0.2" max="16" step="0.1" value="${s.resonance ?? 1.5}" data-param="resonance">
          </label>
          <label class="synth-field">
            <span>어택 (Attack) <strong data-lbl="attack">${Number(s.attack ?? 0.01).toFixed(3)}s</strong></span>
            <input type="range" min="0.002" max="1.2" step="0.005" value="${s.attack ?? 0.01}" data-param="attack">
          </label>
          <label class="synth-field">
            <span>디케이 (Decay) <strong data-lbl="decay">${Number(s.decay ?? 0.25).toFixed(2)}s</strong></span>
            <input type="range" min="0.03" max="1.8" step="0.01" value="${s.decay ?? 0.25}" data-param="decay">
          </label>
          <label class="synth-field">
            <span>서스테인 <strong data-lbl="sustain">${Math.round((s.sustain ?? 0.6) * 100)}%</strong></span>
            <input type="range" min="0" max="1" step="0.01" value="${s.sustain ?? 0.6}" data-param="sustain">
          </label>
          <label class="synth-field">
            <span>릴리즈 (Release) <strong data-lbl="release">${Number(s.release ?? 0.2).toFixed(2)}s</strong></span>
            <input type="range" min="0.02" max="2.5" step="0.02" value="${s.release ?? 0.2}" data-param="release">
          </label>
          <label class="synth-field">
            <span>리버브 센드 <strong data-lbl="reverbSend">${Math.round((t.reverbSend ?? 0.2) * 100)}%</strong></span>
            <input type="range" min="0" max="0.9" step="0.01" value="${t.reverbSend ?? 0.2}" data-param="reverbSend">
          </label>
          <label class="synth-field">
            <span>딜레이 센드 <strong data-lbl="delaySend">${Math.round((t.delaySend ?? 0.12) * 100)}%</strong></span>
            <input type="range" min="0" max="0.8" step="0.01" value="${t.delaySend ?? 0.12}" data-param="delaySend">
          </label>
        </div>

        <div class="audition-bar">
          <span class="audition-label">실시간 건반 테스트 (클릭하여 현재 사운드 즉시 확인)</span>
          <div class="audition-keys">${keysHtml}</div>
        </div>
      </div>
    `;

    const drawWaveform = () => {
      const waveCanvas = win.bodyEl.querySelector('[data-role="wave-canvas"]');
      if (!waveCanvas || t.engine !== "sampler") return;
      const smp = getSampleEntry(t.sampleId);
      const wCtx = waveCanvas.getContext("2d");
      const W = waveCanvas.width;
      const H = waveCanvas.height;
      wCtx.fillStyle = "#06090e";
      wCtx.fillRect(0, 0, W, H);
      if (!smp || !smp.channels[0]) return;

      const data = smp.channels[0];
      const step = Math.max(1, Math.floor(data.length / W));
      wCtx.strokeStyle = "#1dd1a1";
      wCtx.lineWidth = 1;
      wCtx.beginPath();
      for (let x = 0; x < W; x++) {
        let min = 1, max = -1;
        const startIdx = x * step;
        for (let j = 0; j < step && startIdx + j < data.length; j++) {
          const v = data[startIdx + j];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        wCtx.moveTo(x, ((1 - max) * 0.5) * H);
        wCtx.lineTo(x, ((1 - min) * 0.5) * H);
      }
      wCtx.stroke();

      // Trim overlay
      const ts = Math.round((s.trimStart ?? 0) * W);
      const te = Math.round((s.trimEnd ?? 1) * W);
      wCtx.fillStyle = "rgba(0,0,0,0.62)";
      wCtx.fillRect(0, 0, ts, H);
      wCtx.fillRect(te, 0, W - te, H);
      wCtx.strokeStyle = "#ffd166";
      wCtx.beginPath();
      wCtx.moveTo(ts, 0); wCtx.lineTo(ts, H);
      wCtx.moveTo(te, 0); wCtx.lineTo(te, H);
      wCtx.stroke();
    };
    drawWaveform();

    // Events inside instrument window
    win.bodyEl.querySelector('[data-role="preset-switch"]').addEventListener("change", (e) => {
      const pid = e.target.value;
      const p = INSTRUMENT_PRESETS.find((x) => x.id === pid);
      if (!p) return;
      t.presetId = p.id;
      t.name = p.name;
      t.category = p.category;
      t.color = p.color;
      t.engine = p.engine;
      t.synth = { ...p.synth };
      persistLocal();
      renderTrackHeaders();
      renderMixer();
      arrangementView.draw();
      renderContent();
      engine.previewTrackNote(t, 60, 0.3);
    });

    win.bodyEl.querySelector('[data-role="load-ext"]').addEventListener("click", () => {
      pendingFileAction = { mode: "replace_track", trackId: t.id };
      externalInstFileInput.value = "";
      externalInstFileInput.click();
    });

    win.bodyEl.querySelector('[data-role="export-patch"]').addEventListener("click", () => {
      exportSynthPatchJson(t);
      showToast(`'${t.name}.synth.json' 패치 파일이 저장되었습니다.`);
    });

    win.bodyEl.querySelectorAll("[data-param]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const param = inp.dataset.param;
        const lbl = win.bodyEl.querySelector(`[data-lbl="${param}"]`);

        if (param === "engine") {
          t.engine = inp.value;
        } else if (param === "waveform") {
          s.waveform = inp.value;
        } else if (param === "rootMidi") {
          t.rootMidi = Number(inp.value);
        } else if (param === "loopSample") {
          s.loopSample = inp.checked;
        } else if (param === "sf2InstIndex") {
          t.sf2InstIndex = Number(inp.value);
          const sf2 = getSf2Metadata(t.sf2Id);
          if (sf2?.instruments[t.sf2InstIndex]) {
            t.name = sf2.instruments[t.sf2InstIndex].name;
            renderTrackHeaders();
            renderMixer();
            wm.setWindowTitle(winId, `가상악기 / 신스 · ${t.name}`);
          }
        } else if (param === "reverbSend" || param === "delaySend") {
          t[param] = Number(inp.value);
          if (lbl) lbl.textContent = `${Math.round(t[param] * 100)}%`;
          engine.rebuildMixGraph();
          renderMixer();
        } else {
          s[param] = Number(inp.value);
          if (param === "subMix") s.fmAmount = Number(inp.value) * 4.0;
          if (lbl) {
            if (param === "cutoff") lbl.textContent = `${Math.round(s[param])} Hz`;
            else if (param === "resonance") lbl.textContent = s[param].toFixed(1);
            else if (param === "attack") lbl.textContent = `${s[param].toFixed(3)}s`;
            else if (param === "decay" || param === "release") lbl.textContent = `${s[param].toFixed(2)}s`;
            else if (param === "detune") lbl.textContent = `${Math.round(s[param])} ct`;
            else lbl.textContent = `${Math.round(s[param] * 100)}%`;
          }
          if (param === "trimStart" || param === "trimEnd") drawWaveform();
        }
        persistLocal();
      });
    });

    win.bodyEl.querySelectorAll(".aud-key").forEach((kBtn) => {
      kBtn.addEventListener("mousedown", () => {
        engine.previewTrackNote(t, Number(kBtn.dataset.midi), 0.38);
      });
    });
  };

  openInstWins.set(trk.id, { winId, renderContent });
  renderContent();
}

// CONSOLE MIXER
const meterRefs = new Map();
let masterMeterRef = null;

function renderMixerSelection() {
  mixerStrips.querySelectorAll(".mixer-strip[data-track-id]").forEach((el) => {
    el.classList.toggle("selected", el.dataset.trackId === project.selectedTrackId);
  });
}

function renderMixer() {
  mixerStrips.innerHTML = "";
  meterRefs.clear();

  const masterEl = document.createElement("div");
  masterEl.className = "mixer-strip master-strip";
  masterEl.innerHTML = `
    <span class="strip-name" style="color:#ffd166">MASTER</span>
    <div class="fader-meter-wrap">
      <input class="v-fader" id="masterVolFader" type="range" min="0" max="1.15" step="0.01" value="${project.masterVolume ?? 0.88}">
      <div class="meter-bar"><div class="meter-fill" id="masterMeterFill"></div></div>
    </div>
    <span style="font-size:0.6rem;color:#8a99b5">LIMITER</span>
  `;
  mixerStrips.appendChild(masterEl);
  masterMeterRef = masterEl.querySelector("#masterMeterFill");

  masterEl.querySelector("#masterVolFader").addEventListener("input", (e) => {
    project.masterVolume = Number(e.target.value);
    engine.rebuildMixGraph();
    persistLocal();
  });

  for (const trk of project.tracks || []) {
    const strip = document.createElement("div");
    strip.className = `mixer-strip ${project.selectedTrackId === trk.id ? "selected" : ""}`;
    strip.dataset.trackId = trk.id;
    strip.innerHTML = `
      <span class="strip-name" style="color:${trk.color || "#eef3fb"}" title="${escapeHtml(trk.name)}">${escapeHtml(trk.name)}</span>
      <div class="fader-meter-wrap">
        <input class="v-fader" data-role="vol" type="range" min="0" max="1.15" step="0.01" value="${trk.volume ?? 0.8}">
        <div class="meter-bar"><div class="meter-fill" data-role="meter"></div></div>
      </div>
      <div class="strip-knobs">
        <div class="mini-knob-row">
          <div>PAN</div>
          <input data-role="pan" type="range" min="-1" max="1" step="0.05" value="${trk.pan ?? 0}" title="좌우 패닝">
        </div>
        <div class="mini-knob-row">
          <div>REV</div>
          <input data-role="rev" type="range" min="0" max="0.8" step="0.02" value="${trk.reverbSend ?? 0.15}" title="리버브 양">
        </div>
      </div>
      <div class="th-btn-group">
        <button class="ms-btn mute ${trk.muted ? "active" : ""}" data-role="mute" type="button">M</button>
        <button class="ms-btn solo ${trk.solo ? "active" : ""}" data-role="solo" type="button">S</button>
      </div>
    `;

    strip.addEventListener("click", (e) => {
      if (e.target.closest("input, button")) return;
      project.selectedTrackId = trk.id;
      renderTrackHeaders();
      renderMixerSelection();
      arrangementView.draw();
    });

    strip.querySelector('[data-role="vol"]').addEventListener("input", (e) => {
      trk.volume = Number(e.target.value);
      engine.rebuildMixGraph();
      persistLocal();
    });

    strip.querySelector('[data-role="pan"]').addEventListener("input", (e) => {
      trk.pan = Number(e.target.value);
      engine.rebuildMixGraph();
      persistLocal();
    });

    strip.querySelector('[data-role="rev"]').addEventListener("input", (e) => {
      trk.reverbSend = Number(e.target.value);
      engine.rebuildMixGraph();
      persistLocal();
    });

    strip.querySelector('[data-role="mute"]').addEventListener("click", () => {
      trk.muted = !trk.muted;
      engine.rebuildMixGraph();
      persistLocal();
      renderTrackHeaders();
      renderMixer();
    });

    strip.querySelector('[data-role="solo"]').addEventListener("click", () => {
      trk.solo = !trk.solo;
      engine.rebuildMixGraph();
      persistLocal();
      renderTrackHeaders();
      renderMixer();
    });

    meterRefs.set(trk.id, strip.querySelector('[data-role="meter"]'));
    mixerStrips.appendChild(strip);
  }
}

unmuteAllBtn.addEventListener("click", () => {
  for (const trk of project.tracks || []) {
    trk.muted = false;
    trk.solo = false;
  }
  engine.rebuildMixGraph();
  persistLocal();
  renderTrackHeaders();
  renderMixer();
});

// METERS & SPECTRUM LOOP
const specCtx = spectrumCanvas.getContext("2d");
const freqBuf = new Uint8Array(64);
const timeBuf = new Uint8Array(64);

function calcRmsPercent(analyser) {
  if (!analyser) return 2;
  analyser.getByteTimeDomainData(timeBuf);
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = (timeBuf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeBuf.length);
  return Math.min(100, Math.max(2, rms * 290));
}

function animationFrame() {
  if (engine.graph) {
    if (masterMeterRef && engine.graph.masterAnalyser) {
      masterMeterRef.style.height = `${calcRmsPercent(engine.graph.masterAnalyser)}%`;
    }
    for (const [id, el] of meterRefs.entries()) {
      const st = engine.graph.strips.get(id);
      if (st?.analyser) el.style.height = `${calcRmsPercent(st.analyser)}%`;
    }

    const ma = engine.graph.masterAnalyser;
    if (ma) {
      ma.getByteFrequencyData(freqBuf);
      specCtx.fillStyle = "#070a0f";
      specCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
      const bars = 20;
      const bw = spectrumCanvas.width / bars;
      for (let i = 0; i < bars; i++) {
        const val = freqBuf[i] / 255;
        const h = Math.max(1, val * (spectrumCanvas.height - 4));
        specCtx.fillStyle = i > 14 ? "#ff6bcb" : "#54a0ff";
        specCtx.fillRect(i * bw + 1, spectrumCanvas.height - h - 1, bw - 2, h);
      }
    }
  }
  requestAnimationFrame(animationFrame);
}

// TRANSPORT & TOP BAR CONTROLS
playBtn.addEventListener("click", () => {
  if (engine.isPlaying) {
    engine.stop(false);
  } else {
    engine.loopClipId = null;
    syncLoopButtons();
    engine.start();
  }
});

stopBtn.addEventListener("click", () => {
  engine.loopClipId = null;
  syncLoopButtons();
  engine.stop(true);
});

window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (engine.isPlaying) engine.stop(false);
    else engine.start();
  }
});

projectTitleInput.addEventListener("input", () => {
  project.title = projectTitleInput.value;
  persistLocal();
});

bpmInput.addEventListener("change", () => {
  project.bpm = Math.max(40, Math.min(240, Number(bpmInput.value) || 120));
  bpmInput.value = project.bpm;
  engine.rebuildMixGraph();
  persistLocal();
});

swingInput.addEventListener("change", () => {
  project.swing = Math.max(0, Math.min(60, Number(swingInput.value) || 0));
  swingInput.value = project.swing;
  persistLocal();
});

metroBtn.addEventListener("click", () => {
  engine.metronome = !engine.metronome;
  metroBtn.classList.toggle("active", engine.metronome);
});

layoutPresetSelect.addEventListener("change", () => {
  const val = layoutPresetSelect.value;
  if (!val) return;
  layoutPresetSelect.value = "";
  wm.applyLayoutPreset(val);
});

demoSelect.addEventListener("change", () => {
  const key = demoSelect.value;
  if (!key || !DEMO_PROJECTS[key]) return;
  demoSelect.value = "";
  engine.loopClipId = null;
  engine.stop(true);

  // Close open clip/instrument floating windows from previous session
  for (const [, pr] of [...openPianoRolls.entries()]) wm.closeWindow(pr.winId);
  for (const [, bs] of [...openBeatSeqs.entries()]) wm.closeWindow(bs.winId);
  for (const [, iw] of [...openInstWins.entries()]) wm.closeWindow(iw.winId);

  project = DEMO_PROJECTS[key]();
  selectedClipId = project.clips?.[0]?.id || null;
  engine.graph = null;
  persistLocal();
  renderAll();
  showToast(`'${project.title}' 세션을 불러왔습니다.`);
});

exportWavBtn.addEventListener("click", async () => {
  if (!project.clips || project.clips.length === 0) {
    showToast("먼저 전체 편집기에 클립을 찍고 노트를 입력해 주세요!");
    return;
  }
  const orig = exportWavBtn.textContent;
  exportWavBtn.disabled = true;
  exportWavBtn.textContent = "⏳ 렌더링...";
  try {
    const wavBlob = await exportProjectToWav(project);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(project.title || "sonora_mix").replace(/[^a-zA-Z0-9가-힣_-]/g, "_")}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("고음질 .wav 오디오 추출 완료!");
  } catch (err) {
    showToast(`추출 오류: ${err.message}`);
  } finally {
    exportWavBtn.disabled = false;
    exportWavBtn.textContent = orig;
  }
});

// ONEID AUTH & CLOUD PROJECTS
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "요청 처리에 실패했습니다.");
  return data;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteLen = 32) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function startOneIdLogin() {
  persistLocal();
  const verifier = randomUrlSafe(48);
  const state = randomUrlSafe(24);
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(hashBuf));
  const redirectUri = `${location.origin}${location.pathname}`;

  sessionStorage.setItem(ONEID_VERIFIER_KEY, verifier);
  sessionStorage.setItem(ONEID_STATE_KEY, state);

  const query = new URLSearchParams({
    client_id: ONEID_CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    state,
  });
  location.assign(`${ONEID_API_URL}/login.html?${query}`);
}

async function handleOneIdCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return;

  const state = params.get("state");
  const expectedState = sessionStorage.getItem(ONEID_STATE_KEY);
  const verifier = sessionStorage.getItem(ONEID_VERIFIER_KEY);
  history.replaceState(null, "", `${location.pathname}${location.hash}`);
  sessionStorage.removeItem(ONEID_STATE_KEY);
  sessionStorage.removeItem(ONEID_VERIFIER_KEY);

  if (!state || state !== expectedState || !verifier) {
    showToast("ONEID 로그인 상태 검증에 실패했습니다. 다시 시도해 주세요.");
    return;
  }

  try {
    const redirectUri = `${location.origin}${location.pathname}`;
    const res = await fetch(`${ONEID_API_URL}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: ONEID_CLIENT_ID,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
      }),
    });
    const session = await res.json().catch(() => ({}));
    if (!res.ok || !session.access_token) {
      throw new Error(session.detail || "ONEID 인증 토큰 발급에 실패했습니다.");
    }
    token = session.access_token;
    currentUser = session.user || null;
    localStorage.setItem(TOKEN_KEY, token);
    showToast(`${currentUser?.nickname || currentUser?.username || "ONEID"}님 로그인 완료!`);
  } catch (err) {
    showToast(err.message || "ONEID 로그인 처리 중 오류가 발생했습니다.");
  }
}

function renderAuth() {
  if (currentUser) {
    const label = currentUser.nickname || currentUser.name || currentUser.username;
    authArea.innerHTML = `
      <span class="user-chip">● ${escapeHtml(label)}</span>
      <button id="logoutBtn" class="studio-btn" type="button">로그아웃</button>
    `;
    authArea.querySelector("#logoutBtn").addEventListener("click", () => {
      token = "";
      currentUser = null;
      localStorage.removeItem(TOKEN_KEY);
      renderAuth();
      showToast("로그아웃되었습니다.");
    });
  } else {
    authArea.innerHTML = `<button id="loginOpenBtn" class="studio-btn primary" type="button">ONEID 로그인</button>`;
    authArea.querySelector("#loginOpenBtn").addEventListener("click", () => {
      startOneIdLogin();
    });
  }
}

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const el = document.getElementById(btn.dataset.close);
    if (el) el.hidden = true;
  });
});

async function refreshCloudList() {
  cloudList.innerHTML = "";
  if (!currentUser) {
    cloudStatusMsg.textContent = "클라우드 저장/불러오기는 ONEID 통합 로그인 후 이용할 수 있습니다. (비로그인 시 로컬 파일 저장을 이용해 주세요)";
    return;
  }
  cloudStatusMsg.textContent = "내 클라우드 프로젝트 목록을 불러오는 중...";
  try {
    const res = await api("/api/projects");
    const items = res.items || [];
    cloudStatusMsg.textContent = items.length
      ? `저장된 클라우드 프로젝트 ${items.length}개`
      : "아직 클라우드에 저장된 프로젝트가 없습니다.";

    for (const item of items) {
      const div = document.createElement("div");
      div.className = "cloud-item";
      const dateStr = new Date(item.updated_at).toLocaleString("ko-KR");
      div.innerHTML = `
        <div class="cloud-item-info">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${item.bpm} BPM · ${dateStr}</span>
        </div>
        <div class="cloud-item-btns">
          <button class="studio-btn primary" data-load="${item.id}" type="button">불러오기</button>
          <button class="studio-btn" data-del="${item.id}" type="button">삭제</button>
        </div>
      `;
      cloudList.appendChild(div);
    }
  } catch (err) {
    cloudStatusMsg.textContent = err.message;
  }
}

cloudBtn.addEventListener("click", () => {
  cloudModal.hidden = false;
  refreshCloudList();
});

async function saveToCloud(asNew = false) {
  if (!currentUser) {
    cloudModal.hidden = true;
    startOneIdLogin();
    return;
  }
  try {
    const res = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        project_id: asNew ? null : project.projectId || null,
        title: (project.title || "Untitled Session").trim(),
        bpm: project.bpm || 120,
        data: project,
      }),
    });
    project.projectId = res.id;
    persistLocal();
    showToast("클라우드에 프로젝트가 저장되었습니다!");
    refreshCloudList();
  } catch (err) {
    showToast(err.message);
  }
}

saveCloudBtn.addEventListener("click", () => saveToCloud(false));
saveAsNewCloudBtn.addEventListener("click", () => saveToCloud(true));

cloudList.addEventListener("click", async (e) => {
  const loadId = e.target.dataset.load;
  const delId = e.target.dataset.del;
  if (loadId) {
    try {
      const res = await api(`/api/projects/${loadId}`);
      if (res.data && Array.isArray(res.data.tracks)) {
        engine.stop(true);
        project = res.data;
        project.projectId = res.id;
        engine.graph = null;
        persistLocal();
        renderAll();
        cloudModal.hidden = true;
        showToast(`'${res.title}' 로드 완료!`);
      } else {
        showToast("구버전 프로젝트 포맷입니다.");
      }
    } catch (err) {
      showToast(err.message);
    }
  } else if (delId) {
    try {
      await api(`/api/projects/${delId}`, { method: "DELETE" });
      if (project.projectId === Number(delId)) project.projectId = null;
      refreshCloudList();
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

// INIT MULTI-WINDOW WORKSPACE
(async function init() {
  // Register Core Draggable/Resizable Windows: Arrangement + Console Mixer
  wm.createWindow({
    id: "win-arrangement",
    title: "전체 편집기 · ARRANGEMENT",
    icon: "🎞️",
    accentColor: "#54a0ff",
    closable: false,
    minWidth: 520,
    minHeight: 200,
    existingEl: winArrangementEl,
    onResize: () => arrangementView.resizeAndDraw(),
  });

  wm.createWindow({
    id: "win-mixer",
    title: "콘솔 믹서 · CONSOLE MIXER",
    icon: "🎚️",
    accentColor: "#ffd166",
    closable: false,
    minWidth: 380,
    minHeight: 170,
    existingEl: winMixerEl,
  });

  wm.applyLayoutPreset("top-bottom");

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

  await handleOneIdCallback();

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

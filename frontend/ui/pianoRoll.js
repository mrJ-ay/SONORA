import { midiToName } from "../audio/instruments.js";

const MIN_MIDI = 36; // C2
const MAX_MIDI = 84; // C6
const TOTAL_KEYS = MAX_MIDI - MIN_MIDI + 1;
const KEY_WIDTH = 56;
const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 18;

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
const SCALES = {
  chromatic: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  major: new Set([0, 2, 4, 5, 7, 9, 11]),
  minor: new Set([9, 11, 0, 2, 4, 5, 7]),
  pentatonic: new Set([9, 0, 2, 4, 7]),
};

export const SNAP_OPTIONS = [
  { value: "1",      step: 1,        label: "1/16 (기본 1칸)" },
  { value: "0.5",    step: 0.5,      label: "1/32 (반박 쪼개기)" },
  { value: "0.25",   step: 0.25,     label: "1/64 (초미세 쪼개기)" },
  { value: "2",      step: 2,        label: "1/8 (반박자)" },
  { value: "4",      step: 4,        label: "1/4 (한박자)" },
  { value: "0.6667", step: 2 / 3,    label: "1/8T (셋잇단음표)" },
  { value: "0.3333", step: 1 / 3,    label: "1/16T (반박 셋잇단)" },
  { value: "0",      step: 0,        label: "자유 배치 (스냅 OFF)" },
];

export class PianoRollView {
  constructor(canvas, container, { getEditingContext, onNotesChanged, onAuditionNote, onSeekStep }) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext("2d");
    this.getEditingContext = getEditingContext;
    this.onNotesChanged = onNotesChanged;
    this.onAuditionNote = onAuditionNote;
    this.onSeekStep = onSeekStep;

    this.snapStep = 0.5; // Default to 1/32 (반박 쪼개기 가능!) right out of the box
    this.tool = "draw";  // "draw" | "slice"
    this.zoom = 1.25;    // Horizontal zoom multiplier
    this.defaultNoteLen = 1;
    this.selectedNoteId = null;
    this.dragState = null;
    this.playheadStep = -1;
    this.destroyed = false;

    this._onMouseMove = (e) => this.handleMouseMove(e);
    this._onMouseUp = () => this.handleMouseUp();
    this.bindEvents();
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener("mousemove", this._onMouseMove);
    window.removeEventListener("mouseup", this._onMouseUp);
  }

  setSnap(stepVal) {
    const num = Number(stepVal);
    this.snapStep = Number.isFinite(num) && num >= 0 ? num : 0.5;
    if (this.snapStep > 0) {
      this.defaultNoteLen = Math.max(this.snapStep, Math.min(this.defaultNoteLen, 4));
    }
    this.draw();
  }

  setTool(toolName) {
    this.tool = toolName === "slice" ? "slice" : "draw";
    this.canvas.style.cursor = this.tool === "slice" ? "col-resize" : "crosshair";
  }

  setZoom(zoomVal) {
    this.zoom = Math.max(0.6, Math.min(4.0, Number(zoomVal) || 1.25));
    this.resizeAndDraw();
  }

  quantize(val, shiftKey = false, mode = "floor") {
    if (shiftKey || this.snapStep <= 0) {
      return Math.round(val * 100) / 100; // Free 0.01 step precision
    }
    const g = this.snapStep;
    const fn = mode === "floor" ? Math.floor : Math.round;
    return Math.round(fn(val / g) * g * 10000) / 10000;
  }

  minNoteLength(shiftKey = false) {
    if (shiftKey || this.snapStep <= 0) return 0.08;
    return Math.max(0.125, this.snapStep);
  }

  getGeometry() {
    const ctxData = this.getEditingContext();
    const clip = ctxData?.clip;
    let maxNoteEnd = 0;
    for (const n of clip?.notes || []) {
      const end = (Number(n.start) || 0) + (Number(n.length) || 1);
      if (end > maxNoteEnd) maxNoteEnd = end;
    }
    const stepWidth = Math.max(12, Math.round(36 * this.zoom));
    const containerWidth = this.container.clientWidth || 800;
    const scrollLeft = this.container.scrollLeft || 0;

    // 무제한 캔버스: 클립 기본 길이(최소 64스텝/4마디)에서 시작하여, 스크롤하거나 노트를 추가할 때 항상 32스텝씩 앞서 부드럽게 자동 확장
    const clipBars = Math.max(2, Math.ceil(Number(clip?.lengthBars) || 2));
    const baseClipSteps = clipBars * 16;
    const visibleEndStep = Math.ceil((scrollLeft + containerWidth - KEY_WIDTH) / stepWidth);
    const noteEndStep = Math.ceil((maxNoteEnd + 16) / 16) * 16;
    const steps = Math.max(baseClipSteps, 64, Math.ceil((visibleEndStep + 32) / 16) * 16, noteEndStep);
    const width = KEY_WIDTH + steps * stepWidth;
    const height = HEADER_HEIGHT + TOTAL_KEYS * ROW_HEIGHT;
    return { width, height, steps, stepWidth };
  }

  requestDraw() {
    if (this._rafPending || this.destroyed) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this.draw();
    });
  }

  resizeAndDraw() {
    if (this.destroyed) return;
    const ctxData = this.getEditingContext();
    if (!ctxData?.clip || !ctxData?.track) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.getGeometry();
    if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.draw();
  }

  scrollToCenterOctave() {
    const c4Row = MAX_MIDI - 64;
    this.container.scrollTop = Math.max(0, c4Row * ROW_HEIGHT - 80);
  }

  coordsFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { stepWidth, steps } = this.getGeometry();
    const row = Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT);
    const midi = MAX_MIDI - row;
    const rawStep = Math.max(0, (x - KEY_WIDTH) / stepWidth);
    return { x, y, midi, rawStep, stepWidth, steps };
  }

  findNoteAt(notes, stepFloat, midi) {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.midi === midi && stepFloat >= n.start && stepFloat <= n.start + n.length) {
        return n;
      }
    }
    return null;
  }

  // Split selected note (or all notes if none selected) cleanly in half!
  splitSelectedOrAllInHalf() {
    const ctxData = this.getEditingContext();
    if (!ctxData?.clip?.notes?.length) return 0;
    const notes = ctxData.clip.notes;
    const targets = this.selectedNoteId
      ? notes.filter((n) => n.id === this.selectedNoteId)
      : [...notes];

    let count = 0;
    for (const n of targets) {
      if (n.length <= 0.14) continue;
      const half = Math.round((n.length / 2) * 10000) / 10000;
      n.length = half;
      notes.push({
        id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        midi: n.midi,
        start: Math.round((n.start + half) * 10000) / 10000,
        length: half,
        velocity: n.velocity ?? 0.84,
      });
      count++;
    }
    if (count > 0) {
      this.onNotesChanged();
      this.draw();
    }
    return count;
  }

  sliceNoteAt(notes, hitNote, rawStep, shiftKey) {
    let cutPoint = this.quantize(rawStep, shiftKey, "round");
    // If quantized cutPoint falls outside note interior, split right at rawStep or exact midpoint
    if (cutPoint <= hitNote.start + 0.05 || cutPoint >= hitNote.start + hitNote.length - 0.05) {
      if (rawStep > hitNote.start + 0.05 && rawStep < hitNote.start + hitNote.length - 0.05) {
        cutPoint = Math.round(rawStep * 100) / 100;
      } else {
        cutPoint = Math.round((hitNote.start + hitNote.length / 2) * 10000) / 10000;
      }
    }
    const leftLen = Math.round((cutPoint - hitNote.start) * 10000) / 10000;
    const rightLen = Math.round((hitNote.start + hitNote.length - cutPoint) * 10000) / 10000;
    if (leftLen < 0.05 || rightLen < 0.05) return false;

    hitNote.length = leftLen;
    const rightNote = {
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      midi: hitNote.midi,
      start: cutPoint,
      length: rightLen,
      velocity: hitNote.velocity ?? 0.84,
    };
    notes.push(rightNote);
    this.selectedNoteId = rightNote.id;
    return true;
  }

  bindEvents() {
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Infinite scroll expansion on scroll
    this.container.addEventListener("scroll", () => {
      const { steps, stepWidth } = this.getGeometry();
      const visibleEndStep = (this.container.scrollLeft + this.container.clientWidth - KEY_WIDTH) / stepWidth;
      if (visibleEndStep > steps - 128) {
        this.resizeAndDraw();
      } else {
        this.draw();
      }
    });

    // Mouse Wheel:
    // - Shift+Wheel or horizontal scroll: smooth horizontal infinite scroll
    // - Ctrl+Wheel: horizontal zoom
    // - Wheel over note: adjust velocity
    this.canvas.addEventListener("wheel", (e) => {
      const ctxData = this.getEditingContext();
      if (!ctxData?.clip) return;

      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        this.setZoom(this.zoom * factor);
        return;
      }

      if (e.shiftKey || Math.abs(e.deltaX) > 0) {
        e.preventDefault();
        const delta = e.shiftKey ? (e.deltaY || e.deltaX) : e.deltaX;
        this.container.scrollLeft += delta * 1.5;
        return;
      }

      const pos = this.coordsFromEvent(e);
      if (pos.x >= KEY_WIDTH && pos.y >= HEADER_HEIGHT) {
        const hit = this.findNoteAt(ctxData.clip.notes || [], pos.rawStep, pos.midi);
        if (hit) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.06 : -0.06;
          hit.velocity = Math.max(0.15, Math.min(1.0, Math.round(((hit.velocity ?? 0.84) + delta) * 100) / 100));
          this.selectedNoteId = hit.id;
          this.onNotesChanged();
          this.draw();
          return;
        }
      }
    }, { passive: false });

    this.canvas.addEventListener("mousedown", (e) => {
      const ctxData = this.getEditingContext();
      if (!ctxData?.clip || !ctxData?.track) return;
      const { track, clip } = ctxData;
      if (!clip.notes) clip.notes = [];

      const pos = this.coordsFromEvent(e);

      // Top Ruler Click / Drag -> Scrub Playhead!
      if (pos.y < HEADER_HEIGHT) {
        if (pos.x >= KEY_WIDTH) {
          const step = Math.max(0, this.quantize(pos.rawStep, e.shiftKey, "round"));
          if (this.onSeekStep) this.onSeekStep(step);
          this.dragState = { mode: "scrub" };
          this.setPlayhead(step);
          this.draw();
        }
        return;
      }

      if (pos.midi < MIN_MIDI || pos.midi > MAX_MIDI) return;

      if (pos.x < KEY_WIDTH) {
        this.onAuditionNote(track, pos.midi);
        this.dragState = { mode: "key", lastAuditionMidi: pos.midi };
        this.draw();
        return;
      }

      const hit = this.findNoteAt(clip.notes, pos.rawStep, pos.midi);

      // Right-click or Alt+Click: delete note
      if (e.button === 2 || e.altKey) {
        if (hit) {
          const idx = clip.notes.indexOf(hit);
          if (idx >= 0) clip.notes.splice(idx, 1);
          if (this.selectedNoteId === hit.id) this.selectedNoteId = null;
          this.onNotesChanged();
          this.draw();
        }
        return;
      }

      // Slice tool OR Ctrl+Click on note -> Split note at cursor!
      if (hit && (this.tool === "slice" || e.ctrlKey || e.metaKey)) {
        if (this.sliceNoteAt(clip.notes, hit, pos.rawStep, e.shiftKey)) {
          this.onNotesChanged();
          this.draw();
        }
        return;
      }

      if (hit) {
        this.selectedNoteId = hit.id;
        const noteLeftPx = KEY_WIDTH + hit.start * pos.stepWidth;
        const noteRightPx = KEY_WIDTH + (hit.start + hit.length) * pos.stepWidth;
        const edgeZone = Math.min(9, Math.max(4, (noteRightPx - noteLeftPx) * 0.28));

        if (noteRightPx - pos.x <= edgeZone) {
          this.dragState = { mode: "resize-right", note: hit };
        } else if (pos.x - noteLeftPx <= edgeZone) {
          this.dragState = {
            mode: "resize-left",
            note: hit,
            endStepFixed: hit.start + hit.length,
          };
        } else {
          this.onAuditionNote(track, hit.midi, 0.16, hit.velocity ?? 0.84);
          this.dragState = {
            mode: "move",
            note: hit,
            grabOffsetSteps: pos.rawStep - hit.start,
            origMidi: hit.midi,
            startY: pos.y,
            lastAuditionMidi: hit.midi,
          };
        }
        this.draw();
      } else {
        if (this.tool === "slice") return;
        const startStep = Math.max(0, this.quantize(pos.rawStep, e.shiftKey, "floor"));
        const initLen = Math.max(
          this.minNoteLength(e.shiftKey),
          this.snapStep > 0 && !e.shiftKey ? Math.max(this.snapStep, this.defaultNoteLen) : this.defaultNoteLen
        );
        const newNote = {
          id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          midi: pos.midi,
          start: startStep,
          length: Math.round(initLen * 10000) / 10000,
          velocity: 0.85,
        };
        clip.notes.push(newNote);
        this.selectedNoteId = newNote.id;
        this.onAuditionNote(track, pos.midi, 0.2, 0.85);
        this.onNotesChanged();
        this.dragState = { mode: "create-drag", note: newNote, anchorStep: startStep };
        this.draw();
      }
    });

    window.addEventListener("mousemove", this._onMouseMove);
    window.addEventListener("mouseup", this._onMouseUp);
  }

  handleMouseMove(e) {
    if (!this.dragState || this.destroyed) return;
    const ctxData = this.getEditingContext();
    if (!ctxData?.clip || !ctxData?.track) return;
    const { track } = ctxData;
    const pos = this.coordsFromEvent(e);
    const minLen = this.minNoteLength(e.shiftKey);

    if (this.dragState.mode === "scrub") {
      const step = Math.max(0, this.quantize(pos.rawStep, e.shiftKey, "round"));
      if (this.onSeekStep) this.onSeekStep(step);
      this.setPlayhead(step);
      this.draw();
      return;
    }

    if (this.dragState.mode === "key") {
      if (pos.midi >= MIN_MIDI && pos.midi <= MAX_MIDI && pos.midi !== this.dragState.lastAuditionMidi) {
        this.dragState.lastAuditionMidi = pos.midi;
        this.onAuditionNote(track, pos.midi, 0.2);
        this.draw();
      }
      return;
    }

    if (this.dragState.mode === "move") {
      const rawTargetStart = pos.rawStep - this.dragState.grabOffsetSteps;
      const snappedStart = this.quantize(rawTargetStart, e.shiftKey, "round");
      const nextStart = Math.max(0, snappedStart);
      const dMidi = -Math.round((pos.y - this.dragState.startY) / ROW_HEIGHT);
      const nextMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, this.dragState.origMidi + dMidi));
      if (nextMidi !== this.dragState.lastAuditionMidi) {
        this.dragState.lastAuditionMidi = nextMidi;
        this.onAuditionNote(track, nextMidi, 0.14, this.dragState.note.velocity ?? 0.84);
      }
      this.dragState.note.start = Math.round(nextStart * 10000) / 10000;
      this.dragState.note.midi = nextMidi;
      this.requestDraw();
    } else if (this.dragState.mode === "resize-right" || this.dragState.mode === "create-drag") {
      const endSnapped = this.quantize(pos.rawStep, e.shiftKey, "round");
      const rawDiff = pos.rawStep - this.dragState.note.start;
      // Only resize on create-drag once user drags slightly past initial click
      if (this.dragState.mode === "create-drag" && Math.abs(rawDiff) < 0.12) return;
      const nextLen = Math.max(
        minLen,
        endSnapped - this.dragState.note.start
      );
      this.dragState.note.length = Math.round(nextLen * 10000) / 10000;
      this.defaultNoteLen = this.dragState.note.length;
      this.requestDraw();
    } else if (this.dragState.mode === "resize-left") {
      const newStart = Math.max(
        0,
        Math.min(this.dragState.endStepFixed - minLen, this.quantize(pos.rawStep, e.shiftKey, "round"))
      );
      this.dragState.note.start = Math.round(newStart * 10000) / 10000;
      this.dragState.note.length = Math.round((this.dragState.endStepFixed - newStart) * 10000) / 10000;
      this.requestDraw();
    }
  }

  handleMouseUp() {
    if (this.dragState) {
      const mode = this.dragState.mode;
      this.dragState = null;
      if (mode !== "key" && mode !== "scrub") {
        this.onNotesChanged();
      }
      this.draw();
    }
  }

  setPlayhead(step) {
    if (this.playheadStep !== step) {
      this.playheadStep = step;
      if (!this.destroyed && this.canvas.offsetParent !== null) {
        this.requestDraw();
      }
    }
  }

  draw() {
    if (this.destroyed) return;
    const ctxData = this.getEditingContext();
    if (!ctxData?.clip || !ctxData?.track) return;
    const { project, track, clip } = ctxData;
    const notes = clip.notes || [];

    const dpr = window.devicePixelRatio || 1;
    const { width, height, steps, stepWidth } = this.getGeometry();
    if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.ctx;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#10141d";
    ctx.fillRect(0, 0, width, height);

    const scrollLeft = this.container.scrollLeft || 0;
    const scrollTop = this.container.scrollTop || 0;
    const viewW = this.container.clientWidth || 800;
    const viewH = this.container.clientHeight || 500;

    const viewStartRow = Math.max(0, Math.floor((scrollTop - HEADER_HEIGHT - ROW_HEIGHT) / ROW_HEIGHT));
    const viewEndRow = Math.min(TOTAL_KEYS, Math.ceil((scrollTop + viewH - HEADER_HEIGHT + ROW_HEIGHT) / ROW_HEIGHT));

    const viewStartStep = Math.max(0, Math.floor((scrollLeft - KEY_WIDTH - stepWidth) / stepWidth));
    const viewEndStep = Math.min(steps, Math.ceil((scrollLeft + viewW - KEY_WIDTH + stepWidth) / stepWidth));

    const scaleSet = SCALES[project.scale || "minor"] || SCALES.chromatic;

    // Rows (culled to visible vertical viewport)
    for (let r = viewStartRow; r < viewEndRow; r++) {
      const midi = MAX_MIDI - r;
      const y = HEADER_HEIGHT + r * ROW_HEIGHT;
      const pc = midi % 12;
      const isBlack = BLACK_PCS.has(pc);
      const inScale = scaleSet.has(pc);

      ctx.fillStyle = !inScale ? "#0d1017" : isBlack ? "#141923" : "#181f2c";
      ctx.fillRect(KEY_WIDTH, y, width - KEY_WIDTH, ROW_HEIGHT);

      ctx.strokeStyle = pc === 0 ? "#2c3950" : "#1e2636";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(KEY_WIDTH, y + ROW_HEIGHT);
      ctx.lineTo(width, y + ROW_HEIGHT);
      ctx.stroke();
    }

    // Header background
    ctx.fillStyle = "#0b0e15";
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);

    // Sub-step vertical grid lines (culled to visible horizontal viewport)
    if (this.snapStep > 0 && this.snapStep < 1) {
      const subWidth = this.snapStep * stepWidth;
      if (subWidth >= 6) {
        ctx.strokeStyle = "rgba(84, 160, 255, 0.13)";
        ctx.lineWidth = 1;
        const startSub = Math.max(this.snapStep, Math.floor(viewStartStep / this.snapStep) * this.snapStep);
        for (let pos = startSub; pos <= viewEndStep; pos += this.snapStep) {
          if (Math.abs(pos - Math.round(pos)) < 0.01) continue;
          const x = KEY_WIDTH + pos * stepWidth;
          ctx.beginPath();
          ctx.moveTo(x, HEADER_HEIGHT);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
      }
    }

    // Main 16th / Beat / Bar grid lines (culled to visible horizontal viewport)
    for (let s = viewStartStep; s <= viewEndStep; s++) {
      const x = KEY_WIDTH + s * stepWidth;
      const isBeat = s % 4 === 0;
      const isBar = s % 16 === 0;
      ctx.strokeStyle = isBar ? "#586d91" : isBeat ? "#334159" : "#202838";
      ctx.lineWidth = isBar ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (s < steps && isBeat) {
        const barNum = Math.floor(s / 16) + 1;
        const beatInBar = Math.floor((s % 16) / 4) + 1;
        ctx.fillStyle = isBar ? "#e2e8f0" : "#8a99b5";
        ctx.font = isBar ? "800 11px Pretendard, system-ui, sans-serif" : "600 10px Pretendard, system-ui, sans-serif";
        ctx.fillText(`${barNum}.${beatInBar}`, x + 5, 17);
      } else if (s < steps && stepWidth >= 42) {
        ctx.fillStyle = "#4c5b75";
        ctx.font = "500 9px Pretendard, system-ui, sans-serif";
        ctx.fillText(`.${(s % 4) + 1}`, x + 3, 17);
      }
    }

    // Notes (culled to visible horizontal step window)
    const baseColor = track.color || "#ff6bcb";
    for (const n of notes) {
      if (n.midi < MIN_MIDI || n.midi > MAX_MIDI) continue;
      if (n.start + n.length < viewStartStep - 1 || n.start > viewEndStep + 1) continue;
      const r = MAX_MIDI - n.midi;
      const nx = KEY_WIDTH + n.start * stepWidth + 0.5;
      const ny = HEADER_HEIGHT + r * ROW_HEIGHT + 1.5;
      const nw = Math.max(4, n.length * stepWidth - 1);
      const nh = ROW_HEIGHT - 3;
      const vel = Math.max(0.15, Math.min(1, n.velocity ?? 0.84));
      const isSelected = n.id === this.selectedNoteId;

      ctx.save();
      ctx.globalAlpha = 0.45 + vel * 0.55;
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.roundRect(nx, ny, nw, nh, 3.5);
      ctx.fill();
      ctx.restore();

      if (isSelected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(nx, ny, nw, nh, 3.5);
        ctx.stroke();
      }

      // Velocity mini-indicator bar along bottom of note
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fillRect(nx + 2, ny + nh - 3.5, Math.max(0, nw - 4), 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(nx + 2, ny + nh - 3.5, Math.max(0, (nw - 4) * vel), 2);

      // Right resize handle
      if (nw > 12) {
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(nx + nw - 3.5, ny + 3, 2, nh - 7);
      }

      if (nw > 24) {
        ctx.fillStyle = "#080b10";
        ctx.font = "800 9.5px Pretendard, system-ui, sans-serif";
        ctx.fillText(midiToName(n.midi), nx + 4, ny + 10.5);
      }
    }

    // Playhead (Vertical scrubber indicator with neon glow, marker badge & off-screen tracker)
    if (this.playheadStep >= 0) {
      const px = KEY_WIDTH + this.playheadStep * stepWidth;
      const scrollLeft = this.container.scrollLeft || 0;
      const viewRight = scrollLeft + (this.container.clientWidth || 800);

      // Vertical glow scrubber line
      ctx.fillStyle = "rgba(251, 191, 36, 0.22)";
      ctx.fillRect(px - 3, 0, 6, height);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();

      // Top indicator triangle head on ruler
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.moveTo(px - 7, 0);
      ctx.lineTo(px + 7, 0);
      ctx.lineTo(px, HEADER_HEIGHT - 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Bar position badge
      const curBar = Math.floor(this.playheadStep / 16) + 1;
      const curBeat = Math.floor((this.playheadStep % 16) / 4) + 1;
      const badgeText = `${curBar}.${curBeat}`;
      ctx.font = "800 10px Pretendard, system-ui, sans-serif";
      const bw = ctx.measureText(badgeText).width + 8;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.roundRect(px - bw / 2, 1, bw, 13, 3);
      ctx.fill();
      ctx.fillStyle = "#000000";
      ctx.fillText(badgeText, px - bw / 2 + 4, 11);

      // Off-screen indicator on ruler if playhead is scrolled out of view
      if (px < scrollLeft + KEY_WIDTH) {
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.roundRect(scrollLeft + KEY_WIDTH + 4, 3, 58, 20, 4);
        ctx.fill();
        ctx.fillStyle = "#000000";
        ctx.font = "800 10px Pretendard, system-ui, sans-serif";
        ctx.fillText(`◀ Bar ${curBar}`, scrollLeft + KEY_WIDTH + 8, 17);
      } else if (px > viewRight) {
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.roundRect(viewRight - 66, 3, 58, 20, 4);
        ctx.fill();
        ctx.fillStyle = "#000000";
        ctx.font = "800 10px Pretendard, system-ui, sans-serif";
        ctx.fillText(`Bar ${curBar} ▶`, viewRight - 62, 17);
      }
    }

    // Sticky Piano Keys column on left (culled to visible vertical viewport)
    for (let r = viewStartRow; r < viewEndRow; r++) {
      const midi = MAX_MIDI - r;
      const y = HEADER_HEIGHT + r * ROW_HEIGHT;
      const pc = midi % 12;
      const isBlack = BLACK_PCS.has(pc);
      const isActiveKey = this.dragState?.mode === "key" && this.dragState.lastAuditionMidi === midi;

      ctx.fillStyle = isActiveKey ? baseColor : isBlack ? "#181d28" : "#dce4f2";
      ctx.fillRect(scrollLeft, y, KEY_WIDTH - 1, ROW_HEIGHT - 1);

      if (pc === 0 || isActiveKey) {
        ctx.fillStyle = isBlack && !isActiveKey ? "#dce4f2" : "#0f141e";
        ctx.font = "800 9.5px Pretendard, system-ui, sans-serif";
        ctx.fillText(midiToName(midi), scrollLeft + 6, y + 12.5);
      }
    }
    // Corner box above sticky keys
    ctx.fillStyle = "#0b0e15";
    ctx.fillRect(scrollLeft, 0, KEY_WIDTH, HEADER_HEIGHT);
    ctx.fillStyle = this.snapStep === 0 ? "#ffd166" : "#54a0ff";
    ctx.font = "800 9px Pretendard, system-ui, sans-serif";
    ctx.fillText(this.snapStep === 0 ? "FREE" : "SNAP", scrollLeft + 10, 16);

    ctx.restore();
  }
}

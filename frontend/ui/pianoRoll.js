import { midiToName } from "../audio/instruments.js";

const MIN_MIDI = 36; // C2
const MAX_MIDI = 83; // B5 (4 full octaves = 48 keys)
const TOTAL_KEYS = MAX_MIDI - MIN_MIDI + 1;
const KEY_WIDTH = 56;
const HEADER_HEIGHT = 24;
const ROW_HEIGHT = 18;

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
const SCALES = {
  chromatic: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  major: new Set([0, 2, 4, 5, 7, 9, 11]),     // C Major / A Minor
  minor: new Set([9, 11, 0, 2, 4, 5, 7]),     // A Natural Minor
  pentatonic: new Set([9, 0, 2, 4, 7]),       // A Minor Pentatonic
};

export class PianoRollView {
  constructor(canvas, container, { getProject, onNotesChanged, onAuditionNote }) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext("2d");
    this.getProject = getProject;
    this.onNotesChanged = onNotesChanged;
    this.onAuditionNote = onAuditionNote;

    this.defaultNoteLen = 2;
    this.dragState = null; // { mode: 'move'|'resize'|'key', note, origStart, origMidi, origLen, startX, startY, lastAuditionMidi }
    this.playheadStep = -1;

    this.bindEvents();
    window.addEventListener("resize", () => this.resizeAndDraw());
  }

  getActiveContext() {
    const project = this.getProject();
    const pattern = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
    const channel = project.channels.find((c) => c.id === project.selectedChannelId) || project.channels[0];
    if (!pattern.notes) pattern.notes = {};
    if (!pattern.notes[channel.id]) pattern.notes[channel.id] = [];
    return { project, pattern, channel, notes: pattern.notes[channel.id] };
  }

  getGeometry() {
    const { pattern } = this.getActiveContext();
    const steps = pattern.lengthSteps || 16;
    const width = Math.max(this.container.clientWidth || 720, KEY_WIDTH + steps * 36);
    const height = HEADER_HEIGHT + TOTAL_KEYS * ROW_HEIGHT;
    const stepWidth = (width - KEY_WIDTH) / steps;
    return { width, height, steps, stepWidth };
  }

  resizeAndDraw() {
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
    // Scroll vertically to around C4 (MIDI 60)
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
    const rawStep = (x - KEY_WIDTH) / stepWidth;
    const step = Math.max(0, Math.min(steps - 1, Math.floor(rawStep)));
    return { x, y, midi, step, rawStep, stepWidth, steps };
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

  bindEvents() {
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("mousedown", (e) => {
      const pos = this.coordsFromEvent(e);
      const { channel, notes, pattern } = this.getActiveContext();
      if (pos.y < HEADER_HEIGHT || pos.midi < MIN_MIDI || pos.midi > MAX_MIDI) return;

      // Left Piano Keyboard Click -> Audition key
      if (pos.x < KEY_WIDTH) {
        this.onAuditionNote(channel, pos.midi);
        this.dragState = { mode: "key", lastAuditionMidi: pos.midi };
        this.draw();
        return;
      }

      const hit = this.findNoteAt(notes, pos.rawStep, pos.midi);

      // Right-click or Alt+click -> Delete note
      if (e.button === 2 || e.altKey) {
        if (hit) {
          const idx = notes.indexOf(hit);
          if (idx >= 0) notes.splice(idx, 1);
          this.onNotesChanged();
          this.draw();
        }
        return;
      }

      if (hit) {
        const noteRightPx = KEY_WIDTH + (hit.start + hit.length) * pos.stepWidth;
        if (noteRightPx - pos.x <= 10) {
          this.dragState = {
            mode: "resize",
            note: hit,
            origLen: hit.length,
            startX: pos.x,
          };
        } else {
          this.onAuditionNote(channel, hit.midi, 0.16);
          this.dragState = {
            mode: "move",
            note: hit,
            origStart: hit.start,
            origMidi: hit.midi,
            startX: pos.x,
            startY: pos.y,
            lastAuditionMidi: hit.midi,
          };
        }
      } else {
        // Add new note
        const maxSteps = pattern.lengthSteps || 16;
        const len = Math.max(1, Math.min(this.defaultNoteLen, maxSteps - pos.step));
        const newNote = {
          id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          midi: pos.midi,
          start: pos.step,
          length: len,
          velocity: 0.84,
        };
        notes.push(newNote);
        this.onAuditionNote(channel, pos.midi, 0.2);
        this.onNotesChanged();
        this.dragState = {
          mode: "resize",
          note: newNote,
          origLen: len,
          startX: KEY_WIDTH + (pos.step + len) * pos.stepWidth,
        };
        this.draw();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.dragState) return;
      const pos = this.coordsFromEvent(e);
      const { channel, pattern } = this.getActiveContext();
      const maxSteps = pattern.lengthSteps || 16;

      if (this.dragState.mode === "key") {
        if (pos.midi >= MIN_MIDI && pos.midi <= MAX_MIDI && pos.midi !== this.dragState.lastAuditionMidi) {
          this.dragState.lastAuditionMidi = pos.midi;
          this.onAuditionNote(channel, pos.midi, 0.2);
          this.draw();
        }
        return;
      }

      if (this.dragState.mode === "move") {
        const dSteps = Math.round((pos.x - this.dragState.startX) / pos.stepWidth);
        const dMidi = -Math.round((pos.y - this.dragState.startY) / ROW_HEIGHT);
        const nextStart = Math.max(0, Math.min(maxSteps - this.dragState.note.length, this.dragState.origStart + dSteps));
        const nextMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, this.dragState.origMidi + dMidi));

        if (nextMidi !== this.dragState.lastAuditionMidi) {
          this.dragState.lastAuditionMidi = nextMidi;
          this.onAuditionNote(channel, nextMidi, 0.14);
        }
        this.dragState.note.start = nextStart;
        this.dragState.note.midi = nextMidi;
        this.draw();
      } else if (this.dragState.mode === "resize") {
        const endStep = Math.round((pos.x - KEY_WIDTH) / pos.stepWidth);
        const nextLen = Math.max(1, Math.min(maxSteps - this.dragState.note.start, endStep - this.dragState.note.start));
        this.dragState.note.length = nextLen;
        this.defaultNoteLen = nextLen;
        this.draw();
      }
    });

    window.addEventListener("mouseup", () => {
      if (this.dragState) {
        const changed = this.dragState.mode === "move" || this.dragState.mode === "resize";
        this.dragState = null;
        if (changed) this.onNotesChanged();
        this.draw();
      }
    });
  }

  setPlayhead(step) {
    if (this.playheadStep !== step) {
      this.playheadStep = step;
      this.draw();
    }
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height, steps, stepWidth } = this.getGeometry();
    const { project, pattern, channel, notes } = this.getActiveContext();
    const ctx = this.ctx;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#11151d";
    ctx.fillRect(0, 0, width, height);

    const scaleSet = SCALES[project.scale || "minor"] || SCALES.chromatic;

    // Rows (Pitch lanes)
    for (let r = 0; r < TOTAL_KEYS; r++) {
      const midi = MAX_MIDI - r;
      const y = HEADER_HEIGHT + r * ROW_HEIGHT;
      const pc = midi % 12;
      const isBlack = BLACK_PCS.has(pc);
      const inScale = scaleSet.has(pc);

      if (!inScale) {
        ctx.fillStyle = "#0d1017";
      } else if (isBlack) {
        ctx.fillStyle = "#151a24";
      } else {
        ctx.fillStyle = "#19202c";
      }
      ctx.fillRect(KEY_WIDTH, y, width - KEY_WIDTH, ROW_HEIGHT);

      ctx.strokeStyle = pc === 0 ? "#2a3548" : "#1f2735";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(KEY_WIDTH, y + ROW_HEIGHT);
      ctx.lineTo(width, y + ROW_HEIGHT);
      ctx.stroke();
    }

    // Step Vertical Lines & Header Bar
    ctx.fillStyle = "#0c0f16";
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);

    for (let s = 0; s <= steps; s++) {
      const x = KEY_WIDTH + s * stepWidth;
      const isBeat = s % 4 === 0;
      const isBar = s % 16 === 0;
      ctx.strokeStyle = isBar ? "#4a5a78" : isBeat ? "#2e394d" : "#1f2634";
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (s < steps && isBeat) {
        ctx.fillStyle = "#8a99b5";
        ctx.font = "600 11px Pretendard, system-ui, sans-serif";
        ctx.fillText(`${Math.floor(s / 4) + 1}박`, x + 5, 16);
      }
    }

    // Ghost notes from other channels in the same pattern
    for (const otherCh of project.channels) {
      if (otherCh.id === channel.id) continue;
      const otherNotes = pattern.notes?.[otherCh.id];
      if (!Array.isArray(otherNotes)) continue;
      ctx.fillStyle = "rgba(148, 163, 184, 0.16)";
      for (const gn of otherNotes) {
        if (gn.midi < MIN_MIDI || gn.midi > MAX_MIDI) continue;
        const r = MAX_MIDI - gn.midi;
        const nx = KEY_WIDTH + gn.start * stepWidth + 1;
        const ny = HEADER_HEIGHT + r * ROW_HEIGHT + 3;
        const nw = Math.max(4, gn.length * stepWidth - 2);
        ctx.fillRect(nx, ny, nw, ROW_HEIGHT - 6);
      }
    }

    // Active Channel Notes
    const baseColor = channel.color || "#ff6bcb";
    for (const n of notes) {
      if (n.midi < MIN_MIDI || n.midi > MAX_MIDI) continue;
      const r = MAX_MIDI - n.midi;
      const nx = KEY_WIDTH + n.start * stepWidth + 1;
      const ny = HEADER_HEIGHT + r * ROW_HEIGHT + 1.5;
      const nw = Math.max(6, n.length * stepWidth - 2);
      const nh = ROW_HEIGHT - 3;

      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.roundRect(nx, ny, nw, nh, 4);
      ctx.fill();

      // Right resize handle indicator
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillRect(nx + nw - 4, ny + 3, 2, nh - 6);

      if (nw > 26) {
        ctx.fillStyle = "#0b0e14";
        ctx.font = "700 10px Pretendard, system-ui, sans-serif";
        ctx.fillText(midiToName(n.midi), nx + 5, ny + 11.5);
      }
    }

    // Playhead
    if (this.playheadStep >= 0 && this.playheadStep < steps) {
      const px = KEY_WIDTH + this.playheadStep * stepWidth;
      ctx.fillStyle = "rgba(255, 214, 102, 0.14)";
      ctx.fillRect(px, HEADER_HEIGHT, stepWidth, height - HEADER_HEIGHT);
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }

    // Left Piano Keys
    for (let r = 0; r < TOTAL_KEYS; r++) {
      const midi = MAX_MIDI - r;
      const y = HEADER_HEIGHT + r * ROW_HEIGHT;
      const pc = midi % 12;
      const isBlack = BLACK_PCS.has(pc);
      const isAuditioning = this.dragState?.mode === "key" && this.dragState.lastAuditionMidi === midi;

      ctx.fillStyle = isAuditioning ? baseColor : isBlack ? "#1e2430" : "#e2e8f0";
      ctx.fillRect(0, y, KEY_WIDTH - 2, ROW_HEIGHT - 0.5);

      if (pc === 0 || isAuditioning) {
        ctx.fillStyle = isBlack && !isAuditioning ? "#cbd5e1" : "#0f172a";
        ctx.font = "700 10px Pretendard, system-ui, sans-serif";
        ctx.fillText(midiToName(midi), 6, y + 12.5);
      }
    }

    ctx.fillStyle = "#18202c";
    ctx.fillRect(0, 0, KEY_WIDTH, HEADER_HEIGHT);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 10px Pretendard, system-ui, sans-serif";
    ctx.fillText("KEY", 14, 15);

    ctx.restore();
  }
}

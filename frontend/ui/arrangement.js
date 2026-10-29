const TRACK_COUNT = 6;
const LABEL_WIDTH = 112;
const RULER_HEIGHT = 28;
const TRACK_HEIGHT = 48;
const BAR_WIDTH = 68;

export class ArrangementView {
  constructor(canvas, container, { getProject, onChanged, onSelectPattern, onSeekBar }) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext("2d");
    this.getProject = getProject;
    this.onChanged = onChanged;
    this.onSelectPattern = onSelectPattern;
    this.onSeekBar = onSeekBar;

    this.totalBars = 16;
    this.playheadGlobalStep = -1;
    this.dragState = null;

    this.bindEvents();
    window.addEventListener("resize", () => this.resizeAndDraw());
  }

  getGeometry() {
    const project = this.getProject();
    let maxBar = this.totalBars;
    for (const c of project.arrangement || []) {
      const end = (c.bar || 0) + (c.lengthBars || 1) + 2;
      if (end > maxBar) maxBar = end;
    }
    const bars = Math.max(16, maxBar);
    const width = Math.max(this.container.clientWidth || 720, LABEL_WIDTH + bars * BAR_WIDTH);
    const height = RULER_HEIGHT + TRACK_COUNT * TRACK_HEIGHT;
    const barW = (width - LABEL_WIDTH) / bars;
    return { width, height, bars, barW };
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

  coords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { bars, barW } = this.getGeometry();
    const track = Math.floor((y - RULER_HEIGHT) / TRACK_HEIGHT);
    const barFloat = (x - LABEL_WIDTH) / barW;
    const bar = Math.max(0, Math.min(bars - 1, Math.floor(barFloat)));
    return { x, y, track, bar, barFloat, bars, barW };
  }

  findClip(arrangement, track, barFloat) {
    for (let i = arrangement.length - 1; i >= 0; i--) {
      const c = arrangement[i];
      if (c.track === track && barFloat >= c.bar && barFloat <= c.bar + (c.lengthBars || 1)) {
        return c;
      }
    }
    return null;
  }

  bindEvents() {
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("dblclick", (e) => {
      const pos = this.coords(e);
      const project = this.getProject();
      const hit = this.findClip(project.arrangement || [], pos.track, pos.barFloat);
      if (hit && this.onSelectPattern) {
        this.onSelectPattern(hit.patternId, true);
      }
    });

    this.canvas.addEventListener("mousedown", (e) => {
      const pos = this.coords(e);
      const project = this.getProject();
      if (!project.arrangement) project.arrangement = [];

      // Click on top ruler -> seek song playhead
      if (pos.y < RULER_HEIGHT && pos.x >= LABEL_WIDTH) {
        if (this.onSeekBar) this.onSeekBar(pos.bar);
        return;
      }

      if (pos.x < LABEL_WIDTH || pos.track < 0 || pos.track >= TRACK_COUNT) return;

      const hit = this.findClip(project.arrangement, pos.track, pos.barFloat);

      if (e.button === 2 || e.altKey) {
        if (hit) {
          const idx = project.arrangement.indexOf(hit);
          if (idx >= 0) project.arrangement.splice(idx, 1);
          this.onChanged();
          this.draw();
        }
        return;
      }

      if (hit) {
        const rightPx = LABEL_WIDTH + (hit.bar + (hit.lengthBars || 1)) * pos.barW;
        if (rightPx - pos.x <= 12) {
          this.dragState = { mode: "resize", clip: hit };
        } else {
          this.dragState = {
            mode: "move",
            clip: hit,
            origBar: hit.bar,
            origTrack: hit.track,
            startX: pos.x,
            startY: pos.y,
          };
        }
      } else {
        // Place new clip of active pattern
        const newClip = {
          id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          track: pos.track,
          bar: pos.bar,
          lengthBars: 1,
          patternId: project.activePatternId || project.patterns[0]?.id,
        };
        project.arrangement.push(newClip);
        this.dragState = { mode: "resize", clip: newClip };
        this.onChanged();
        this.draw();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.dragState) return;
      const pos = this.coords(e);
      const { clip } = this.dragState;

      if (this.dragState.mode === "move") {
        const dBar = Math.round((pos.x - this.dragState.startX) / pos.barW);
        const dTrack = Math.round((pos.y - this.dragState.startY) / TRACK_HEIGHT);
        clip.bar = Math.max(0, Math.min(pos.bars - 1, this.dragState.origBar + dBar));
        clip.track = Math.max(0, Math.min(TRACK_COUNT - 1, this.dragState.origTrack + dTrack));
        this.draw();
      } else if (this.dragState.mode === "resize") {
        const endBar = Math.round((pos.x - LABEL_WIDTH) / pos.barW);
        clip.lengthBars = Math.max(1, Math.min(pos.bars - clip.bar, endBar - clip.bar));
        this.draw();
      }
    });

    window.addEventListener("mouseup", () => {
      if (this.dragState) {
        this.dragState = null;
        this.onChanged();
        this.draw();
      }
    });
  }

  setPlayhead(globalStep) {
    if (this.playheadGlobalStep !== globalStep) {
      this.playheadGlobalStep = globalStep;
      this.draw();
    }
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height, bars, barW } = this.getGeometry();
    const project = this.getProject();
    const ctx = this.ctx;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#11151d";
    ctx.fillRect(0, 0, width, height);

    // Track rows
    for (let t = 0; t < TRACK_COUNT; t++) {
      const y = RULER_HEIGHT + t * TRACK_HEIGHT;
      ctx.fillStyle = t % 2 === 0 ? "#151a24" : "#121720";
      ctx.fillRect(LABEL_WIDTH, y, width - LABEL_WIDTH, TRACK_HEIGHT);

      ctx.strokeStyle = "#222b3a";
      ctx.beginPath();
      ctx.moveTo(0, y + TRACK_HEIGHT);
      ctx.lineTo(width, y + TRACK_HEIGHT);
      ctx.stroke();

      // Track label header
      ctx.fillStyle = "#18202c";
      ctx.fillRect(0, y, LABEL_WIDTH, TRACK_HEIGHT - 1);
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "700 12px Pretendard, system-ui, sans-serif";
      ctx.fillText(`Track ${t + 1}`, 14, y + 28);
    }

    // Ruler & Bar grid lines
    ctx.fillStyle = "#0c0f16";
    ctx.fillRect(0, 0, width, RULER_HEIGHT);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 11px Pretendard, system-ui, sans-serif";
    ctx.fillText("TIMELINE (클릭 이동)", 8, 18);

    for (let b = 0; b <= bars; b++) {
      const x = LABEL_WIDTH + b * barW;
      const is4Bar = b % 4 === 0;
      ctx.strokeStyle = is4Bar ? "#3b4963" : "#222b3a";
      ctx.lineWidth = is4Bar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (b < bars) {
        ctx.fillStyle = is4Bar ? "#e2e8f0" : "#7c8ba1";
        ctx.font = "700 11px Pretendard, system-ui, sans-serif";
        ctx.fillText(`${b + 1}`, x + 6, 18);
      }
    }

    // Clips
    for (const clip of project.arrangement || []) {
      const pat = project.patterns.find((p) => p.id === clip.patternId);
      if (!pat || clip.track < 0 || clip.track >= TRACK_COUNT) continue;

      const x = LABEL_WIDTH + clip.bar * barW + 2;
      const y = RULER_HEIGHT + clip.track * TRACK_HEIGHT + 4;
      const w = Math.max(14, (clip.lengthBars || 1) * barW - 4);
      const h = TRACK_HEIGHT - 8;
      const color = pat.color || "#54a0ff";

      ctx.fillStyle = color + "30";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();

      // Top title ribbon
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 16, [6, 6, 0, 0]);
      ctx.fill();

      ctx.fillStyle = "#0b0e14";
      ctx.font = "700 10.5px Pretendard, system-ui, sans-serif";
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 4, y, Math.max(0, w - 10), 16);
      ctx.clip();
      ctx.fillText(pat.name, x + 6, y + 11.5);
      ctx.restore();

      // Mini preview dots inside clip body
      ctx.fillStyle = color;
      const barsLen = clip.lengthBars || 1;
      for (let lb = 0; lb < barsLen; lb++) {
        const bx = x + lb * barW;
        // Draw step hits
        let rowIdx = 0;
        for (const ch of project.channels.slice(0, 4)) {
          const st = pat.steps?.[ch.id];
          if (st) {
            for (let s = 0; s < 16; s++) {
              if (st[s]) {
                ctx.fillRect(bx + (s / 16) * barW + 2, y + 20 + rowIdx * 4, Math.max(2, barW / 22), 2.5);
              }
            }
          }
          rowIdx++;
        }
        // Draw melodic notes preview
        for (const ch of project.channels) {
          const ns = pat.notes?.[ch.id];
          if (Array.isArray(ns)) {
            for (const n of ns) {
              const nx = bx + (n.start / 16) * barW + 2;
              const nw = Math.max(3, (n.length / 16) * barW - 1);
              const ny = y + h - 5 - ((n.midi - 36) / 48) * (h - 22);
              ctx.fillRect(nx, Math.max(y + 18, Math.min(y + h - 4, ny)), nw, 2.5);
            }
          }
        }
      }

      // Resize handle
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(x + w - 5, y + 19, 2, h - 23);
    }

    // Playhead
    if (this.playheadGlobalStep >= 0) {
      const px = LABEL_WIDTH + (this.playheadGlobalStep / 16) * barW;
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();

      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.moveTo(px - 5, 0);
      ctx.lineTo(px + 5, 0);
      ctx.lineTo(px, 8);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

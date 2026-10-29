import { DRUM_ROWS } from "../audio/instruments.js";
import { getSampleEntry } from "../audio/externalLoader.js";
import { createEmptyClip } from "../state/demos.js";

export const RULER_HEIGHT = 28;
export const TRACK_ROW_HEIGHT = 64;
const BAR_WIDTH = 76;

export class ArrangementView {
  constructor(canvas, container, { getProject, getSelectedClipId, onSelectClip, onOpenClipEditor, onChanged, onSeekBar }) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext("2d");
    this.getProject = getProject;
    this.getSelectedClipId = getSelectedClipId;
    this.onSelectClip = onSelectClip;
    this.onOpenClipEditor = onOpenClipEditor;
    this.onChanged = onChanged;
    this.onSeekBar = onSeekBar;

    this.totalBars = 16;
    this.playheadGlobalStep = -1;
    this.liveRecording = null; // { trackId, startBar }
    this.dragState = null;

    this.bindEvents();
    window.addEventListener("resize", () => this.resizeAndDraw());
  }

  getGeometry() {
    const project = this.getProject();
    const tracks = project.tracks || [];
    let maxBar = this.totalBars;
    for (const c of project.clips || []) {
      const end = Math.ceil((Number(c.bar) || 0) + (Number(c.lengthBars) || 1)) + 2;
      if (end > maxBar) maxBar = end;
    }
    if (this.liveRecording && this.playheadGlobalStep >= 0) {
      const recEnd = Math.ceil(this.playheadGlobalStep / 16) + 4;
      if (recEnd > maxBar) maxBar = recEnd;
    }
    const bars = Math.max(16, maxBar);
    const width = Math.max(this.container.clientWidth || 640, bars * BAR_WIDTH);
    const height = Math.max(RULER_HEIGHT + Math.max(tracks.length, 1) * TRACK_ROW_HEIGHT, this.container.clientHeight || 260);
    const barW = width / bars;
    return { width, height, bars, barW, trackCount: tracks.length };
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
    const trackIdx = Math.floor((y - RULER_HEIGHT) / TRACK_ROW_HEIGHT);
    const barFloat = Math.max(0, x / barW);
    const bar = Math.max(0, Math.min(bars - 1, Math.floor(barFloat)));
    return { x, y, trackIdx, bar, barFloat, bars, barW };
  }

  findClip(clips, trackId, barFloat) {
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      if (c.trackId === trackId && barFloat >= c.bar && barFloat <= c.bar + (c.lengthBars || 1)) {
        return c;
      }
    }
    return null;
  }

  bindEvents() {
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("dblclick", (e) => {
      const pos = this.coords(e);
      if (pos.y < RULER_HEIGHT) return;
      const project = this.getProject();
      const track = (project.tracks || [])[pos.trackIdx];
      if (!track) return;
      let hit = this.findClip(project.clips || [], track.id, pos.barFloat);
      if (!hit) {
        if (track.type === "audio") {
          // On an Audio Track, double-clicking empty space opens the Audio Recorder / Importer window!
          this.onOpenClipEditor(track, null, pos.bar);
          return;
        }
        hit = createEmptyClip(track, pos.bar, 2);
        project.clips.push(hit);
        this.onChanged();
      }
      this.onOpenClipEditor(track, hit, pos.bar);
    });

    this.canvas.addEventListener("mousedown", (e) => {
      const pos = this.coords(e);
      const project = this.getProject();
      if (!project.clips) project.clips = [];

      if (pos.y < RULER_HEIGHT) {
        if (this.onSeekBar) this.onSeekBar(e.shiftKey ? pos.barFloat : Math.round(pos.barFloat * 4) / 4);
        return;
      }

      const track = (project.tracks || [])[pos.trackIdx];
      if (!track) return;

      project.selectedTrackId = track.id;
      const hit = this.findClip(project.clips, track.id, pos.barFloat);

      if (e.button === 2 || e.altKey) {
        if (hit) {
          const idx = project.clips.indexOf(hit);
          if (idx >= 0) project.clips.splice(idx, 1);
          this.onChanged();
          this.draw();
        }
        return;
      }

      if (hit) {
        this.onSelectClip(track, hit);
        const rightPx = (hit.bar + (hit.lengthBars || 1)) * pos.barW;
        if (rightPx - pos.x <= 12) {
          this.dragState = { mode: "resize", clip: hit, isAudio: hit.kind === "audio" || track.type === "audio" };
        } else {
          this.dragState = {
            mode: "move",
            clip: hit,
            isAudio: hit.kind === "audio" || track.type === "audio",
            origBar: hit.bar,
            origTrackIdx: pos.trackIdx,
            startX: pos.x,
            startY: pos.y,
          };
        }
        this.draw();
      } else {
        if (track.type === "audio") {
          // Audio tracks hold recorded/imported audio clips rather than blank MIDI clips
          this.onChanged();
          this.draw();
          return;
        }
        const newClip = createEmptyClip(track, pos.bar, 2);
        project.clips.push(newClip);
        this.onSelectClip(track, newClip);
        this.dragState = { mode: "resize", clip: newClip, isAudio: false };
        this.onChanged();
        this.draw();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.dragState) return;
      const pos = this.coords(e);
      const project = this.getProject();
      const tracks = project.tracks || [];
      const { clip, isAudio } = this.dragState;

      if (this.dragState.mode === "move") {
        const rawDelta = (pos.x - this.dragState.startX) / pos.barW;
        let nextBar = this.dragState.origBar + rawDelta;
        if (e.shiftKey) {
          nextBar = Math.round(nextBar * 64) / 64;
        } else if (isAudio) {
          nextBar = Math.round(nextBar * 4) / 4; // 1-beat snap for audio clips
        } else {
          nextBar = Math.round(nextBar);
        }
        clip.bar = Math.max(0, Math.min(pos.bars - 0.25, nextBar));

        const dTrack = Math.round((pos.y - this.dragState.startY) / TRACK_ROW_HEIGHT);
        const nextTrackIdx = Math.max(0, Math.min(tracks.length - 1, this.dragState.origTrackIdx + dTrack));
        const targetTrack = tracks[nextTrackIdx];
        const curTrack = tracks.find((t) => t.id === clip.trackId);
        if (targetTrack && curTrack) {
          if (isAudio) {
            if (targetTrack.type === "audio") clip.trackId = targetTrack.id;
          } else {
            const curIsDrum = curTrack.type === "drumkit";
            const tgtIsDrum = targetTrack.type === "drumkit";
            if ((curIsDrum === tgtIsDrum && targetTrack.type !== "audio") || targetTrack.type === "empty" || curTrack.type === "empty") {
              clip.trackId = targetTrack.id;
            }
          }
        }
        this.draw();
      } else if (this.dragState.mode === "resize") {
        const rawEnd = pos.x / pos.barW;
        if (isAudio) {
          const snappedEnd = e.shiftKey ? Math.round(rawEnd * 64) / 64 : Math.round(rawEnd * 4) / 4;
          clip.lengthBars = Math.max(0.15, Math.min(pos.bars - clip.bar, snappedEnd - clip.bar));
        } else {
          const endBar = Math.round(rawEnd);
          clip.lengthBars = Math.max(1, Math.min(pos.bars - clip.bar, endBar - clip.bar));
        }
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
    const tracks = project.tracks || [];
    const selectedClipId = this.getSelectedClipId ? this.getSelectedClipId() : null;
    const ctx = this.ctx;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#10141d";
    ctx.fillRect(0, 0, width, height);

    // Track lane backgrounds
    tracks.forEach((trk, idx) => {
      const y = RULER_HEIGHT + idx * TRACK_ROW_HEIGHT;
      const isSel = trk.id === project.selectedTrackId;
      ctx.fillStyle = isSel ? "#182030" : idx % 2 === 0 ? "#131924" : "#10151f";
      ctx.fillRect(0, y, width, TRACK_ROW_HEIGHT);

      ctx.strokeStyle = "#222c3f";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + TRACK_ROW_HEIGHT);
      ctx.lineTo(width, y + TRACK_ROW_HEIGHT);
      ctx.stroke();

      // Subtle hint on empty Audio Track
      if (trk.type === "audio") {
        const hasClip = (project.clips || []).some((c) => c.trackId === trk.id);
        if (!hasClip && (!this.liveRecording || this.liveRecording.trackId !== trk.id)) {
          ctx.fillStyle = "rgba(56, 189, 248, 0.48)";
          ctx.font = "600 11px Pretendard, system-ui, sans-serif";
          ctx.fillText("🎙️ [● 녹음] 버튼을 눌러 마이크·악기를 녹음하거나, 더블클릭 / 오디오 파일 드래그 앤 드롭으로 추가하세요", 14, y + 36);
        }
      }
    });

    // Empty hint if no tracks
    if (!tracks.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "700 13px Pretendard, system-ui, sans-serif";
      ctx.fillText("좌측 상단의 '+ 트랙 추가' 버튼을 눌러 트랙을 추가하세요.", 24, 70);
    }

    // Bar Ruler & Grid lines
    ctx.fillStyle = "#0b0e15";
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    for (let b = 0; b <= bars; b++) {
      const x = b * barW;
      const is4Bar = b % 4 === 0;
      ctx.strokeStyle = is4Bar ? "#3a4966" : "#1f2838";
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

    // Draw Clips
    for (const clip of project.clips || []) {
      const tIdx = tracks.findIndex((t) => t.id === clip.trackId);
      if (tIdx < 0) continue;
      const track = tracks[tIdx];

      const x = (Number(clip.bar) || 0) * barW + 2;
      const y = RULER_HEIGHT + tIdx * TRACK_ROW_HEIGHT + 5;
      const w = Math.max(14, (Number(clip.lengthBars) || 1) * barW - 4);
      const h = TRACK_ROW_HEIGHT - 10;
      const isAudioClip = clip.kind === "audio" || track.type === "audio";
      const color = isAudioClip ? (track.color || "#38bdf8") : (track.color || "#54a0ff");
      const isSelected = clip.id === selectedClipId;

      ctx.fillStyle = color + "2c";
      ctx.strokeStyle = isSelected ? "#ffffff" : color;
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();

      // Clip Header Bar
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 17, [6, 6, 0, 0]);
      ctx.fill();

      ctx.fillStyle = "#0b0e14";
      ctx.font = "700 10.5px Pretendard, system-ui, sans-serif";
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 4, y, Math.max(0, w - 12), 17);
      ctx.clip();
      const label = isAudioClip ? `🎙️ ${clip.name || "Audio Clip"}` : `${clip.name} (더블클릭 편집)`;
      ctx.fillText(label, x + 6, y + 12);
      ctx.restore();

      if (isAudioClip) {
        // Draw real Audio Waveform inside clip!
        const entry = getSampleEntry(clip.sampleId);
        const peaks = entry?.peaks?.length ? entry.peaks : (clip.peaks || []);
        const waveTop = y + 19;
        const waveH = h - 22;
        const midY = waveTop + waveH * 0.5;
        const gainScale = Math.min(1.8, Math.max(0.15, Number(clip.gain ?? 1.0)));

        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 2, midY);
        ctx.lineTo(x + w - 4, midY);
        ctx.stroke();

        if (peaks.length) {
          ctx.fillStyle = color;
          const innerW = Math.max(4, w - 8);
          const bpm = Math.max(40, Math.min(240, project.bpm || 120));
          const barSec = (60 / bpm) * 4;
          const totalSampleSec = entry?.duration || ((Number(clip.lengthBars) || 1) * barSec);
          const rate = Math.max(0.25, Math.min(4.0, Number(clip.playbackRate) || 1.0));
          const startRatio = totalSampleSec > 0 ? Math.min(0.98, (Number(clip.offsetSec) || 0) / totalSampleSec) : 0;
          const visibleRatio = totalSampleSec > 0
            ? Math.min(1 - startRatio, ((Number(clip.lengthBars) || 1) * barSec * rate) / totalSampleSec)
            : 1;

          const cols = Math.min(160, Math.max(8, Math.floor(innerW / 2.5)));
          const colW = innerW / cols;
          for (let i = 0; i < cols; i++) {
            const pPos = startRatio + (i / cols) * visibleRatio;
            const pIdx = Math.min(peaks.length - 1, Math.floor(pPos * peaks.length));
            const amp = Math.min(1, (peaks[pIdx] || 0.03) * gainScale);
            const barH = Math.max(2, amp * waveH * 0.92);
            ctx.fillRect(x + 4 + i * colW, midY - barH * 0.5, Math.max(1.4, colW - 0.8), barH);
          }
        }
      } else {
        // Mini Note / Drum Preview inside clip
        ctx.fillStyle = color;
        const lenBars = Math.ceil(clip.lengthBars || 1);
        const patSteps = (clip.patternBars || 1) * 16;

        for (let b = 0; b < lenBars; b++) {
          const bx = x + b * barW;
          const barOffsetStep = (b * 16) % patSteps;

          if (track.type === "drumkit") {
            DRUM_ROWS.forEach((row, rIdx) => {
              const st = clip.drumSteps?.[row.key];
              if (!st) return;
              for (let s = 0; s < 16; s++) {
                if (st[(barOffsetStep + s) % st.length]) {
                  ctx.fillRect(bx + (s / 16) * barW + 2, y + 21 + rIdx * 6, Math.max(2.5, barW / 20), 4);
                }
              }
            });
          } else {
            for (const n of clip.notes || []) {
              if (n.start >= barOffsetStep && n.start < barOffsetStep + 16) {
                const localS = n.start - barOffsetStep;
                const nx = bx + (localS / 16) * barW + 2;
                const nw = Math.max(3, Math.min(16 - localS, n.length) / 16 * barW - 1);
                const ny = y + h - 5 - ((n.midi - 36) / 48) * (h - 24);
                ctx.fillRect(nx, Math.max(y + 20, Math.min(y + h - 5, ny)), nw, 3.5);
              }
            }
          }
        }
      }

      // Right resize grip
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillRect(x + w - 5, y + 21, 2, h - 25);
    }

    // Live Recording Growing Red Clip Preview
    if (this.liveRecording) {
      const rIdx = tracks.findIndex((t) => t.id === this.liveRecording.trackId);
      if (rIdx >= 0) {
        const startBar = Number(this.liveRecording.startBar) || 0;
        const curBar = this.playheadGlobalStep >= 0 ? this.playheadGlobalStep / 16 : startBar + 0.25;
        const recLenBars = Math.max(0.25, curBar - startBar);
        const rx = startBar * barW + 2;
        const ry = RULER_HEIGHT + rIdx * TRACK_ROW_HEIGHT + 5;
        const rw = Math.max(28, recLenBars * barW - 4);
        const rh = TRACK_ROW_HEIGHT - 10;

        ctx.fillStyle = "rgba(255, 71, 87, 0.28)";
        ctx.strokeStyle = "#ff4757";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ff4757";
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, 17, [6, 6, 0, 0]);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "800 10.5px Pretendard, system-ui, sans-serif";
        ctx.fillText("● REC 실시간 녹음 중...", rx + 6, ry + 12);
      }
    }

    // Playhead
    if (this.playheadGlobalStep >= 0) {
      const px = (this.playheadGlobalStep / 16) * barW;
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();

      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.moveTo(px - 6, 0);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px, 9);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

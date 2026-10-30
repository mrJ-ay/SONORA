// Multi-Window Desktop Manager for SONORA Studio (FL Studio / Ableton style)
// Supports independent floating & dockable windows, drag-to-move, edge-snap zones,
// 4-edge/corner resize, z-index focus, minimize/maximize, taskbar pills, and layout presets.

export class WindowManager {
  constructor(desktopEl, taskbarEl) {
    this.desktop = desktopEl;
    this.taskbar = taskbarEl;
    this.windows = new Map(); // id -> { id, title, icon, el, bodyEl, closable, minimized, maximized, prevRect, onResize, onClose }
    this.topZ = 20;
    this.cascadeIndex = 0;
    this.activeDrag = null;
    this.focusedId = null;

    this.snapPreview = document.createElement("div");
    this.snapPreview.className = "snap-preview-box";
    this.snapPreview.hidden = true;
    this.desktop.appendChild(this.snapPreview);

    window.addEventListener("mousemove", (e) => this.onGlobalMouseMove(e));
    window.addEventListener("mouseup", (e) => this.onGlobalMouseUp(e));
    window.addEventListener("resize", () => this.clampAllToDesktop());
  }

  getDesktopRect() {
    return {
      width: Math.max(640, this.desktop.clientWidth || window.innerWidth),
      height: Math.max(420, this.desktop.clientHeight || window.innerHeight - 54),
    };
  }

  // Register an existing DOM element (like Arrangement or Console Mixer) OR create a new floating window
  createWindow({
    id,
    title,
    icon = "🪟",
    accentColor = "#54a0ff",
    closable = true,
    x,
    y,
    width = 760,
    height = 460,
    minWidth = 320,
    minHeight = 180,
    headerExtraHtml = "",
    existingEl = null,
    onResize = null,
    onClose = null,
  }) {
    if (this.windows.has(id)) {
      const existing = this.windows.get(id);
      if (existing.minimized) this.toggleMinimize(id, false);
      this.focusWindow(id);
      return existing;
    }

    const desk = this.getDesktopRect();
    if (x === undefined || y === undefined) {
      const offset = (this.cascadeIndex % 7) * 28;
      this.cascadeIndex++;
      x = Math.max(16, Math.min(desk.width - width - 16, Math.round((desk.width - width) * 0.5) - 60 + offset));
      y = Math.max(16, Math.min(desk.height - height - 16, 36 + offset));
    }

    const el = existingEl || document.createElement("section");
    el.classList.add("daw-window");
    el.dataset.winId = id;
    el.style.setProperty("--win-accent", accentColor);

    let titlebar = el.querySelector(":scope > .win-titlebar");
    let bodyEl = el.querySelector(":scope > .win-body");

    if (!titlebar) {
      titlebar = document.createElement("header");
      titlebar.className = "win-titlebar";
      titlebar.innerHTML = `
        <div class="win-title-left">
          <span class="win-drag-grip" title="드래그하여 창 이동 (화면 끝으로 끌면 자동 분할 스냅)">⠿</span>
          <span class="win-icon">${icon}</span>
          <span class="win-title-text">${title}</span>
          <div class="win-header-extra">${headerExtraHtml}</div>
        </div>
        <div class="win-controls">
          <button type="button" class="win-ctrl-btn" data-win-act="min" title="최소화 (하단 독으로 접기)">─</button>
          <button type="button" class="win-ctrl-btn" data-win-act="max" title="최대화 / 원래 크기">□</button>
          ${closable ? `<button type="button" class="win-ctrl-btn close" data-win-act="close" title="창 닫기">✕</button>` : ""}
        </div>
      `;
      el.prepend(titlebar);
    }

    if (!bodyEl) {
      bodyEl = document.createElement("div");
      bodyEl.className = "win-body";
      el.appendChild(bodyEl);
    }

    // Add resize handles (E, S, W, SE, SW)
    for (const dir of ["e", "s", "w", "se", "sw"]) {
      if (!el.querySelector(`:scope > .win-resize-${dir}`)) {
        const handle = document.createElement("div");
        handle.className = `win-resize-handle win-resize-${dir}`;
        handle.dataset.resizeDir = dir;
        el.appendChild(handle);
      }
    }

    if (!el.parentElement) {
      this.desktop.appendChild(el);
    }

    const record = {
      id,
      title,
      icon,
      accentColor,
      el,
      titlebar,
      bodyEl,
      closable,
      minWidth,
      minHeight,
      minimized: false,
      maximized: false,
      prevRect: null,
      rect: { x, y, width, height },
      onResize,
      onClose,
    };

    this.windows.set(id, record);
    this.applyRect(record, record.rect);
    this.bindWindowEvents(record);
    this.focusWindow(id);
    this.renderTaskbar();
    return record;
  }

  setWindowTitle(id, newTitle) {
    const win = this.windows.get(id);
    if (!win) return;
    win.title = newTitle;
    const tEl = win.titlebar.querySelector(".win-title-text");
    if (tEl) tEl.textContent = newTitle;
    this.renderTaskbar();
  }

  applyRect(win, rect, triggerCallback = true) {
    const desk = this.getDesktopRect();
    const w = Math.max(win.minWidth, Math.min(desk.width, Math.round(rect.width)));
    const h = Math.max(win.minHeight, Math.min(desk.height, Math.round(rect.height)));
    const x = Math.max(0, Math.min(desk.width - Math.min(w, 120), Math.round(rect.x)));
    const y = Math.max(0, Math.min(desk.height - 34, Math.round(rect.y)));

    win.rect = { x, y, width: w, height: h };
    win.el.style.left = `${x}px`;
    win.el.style.top = `${y}px`;
    win.el.style.width = `${w}px`;
    win.el.style.height = `${h}px`;

    if (triggerCallback && win.onResize && !win.minimized) {
      requestAnimationFrame(() => win.onResize(win.rect));
    }
  }

  focusWindow(id) {
    const win = this.windows.get(id);
    if (!win) return;
    this.topZ += 1;
    this.focusedId = id;
    win.el.style.zIndex = String(this.topZ);
    for (const [wid, w] of this.windows.entries()) {
      w.el.classList.toggle("focused", wid === id);
    }
    this.renderTaskbar();
  }

  getFocusedWindowId() {
    return this.focusedId;
  }

  toggleMinimize(id, forceState) {
    const win = this.windows.get(id);
    if (!win) return;
    win.minimized = forceState !== undefined ? forceState : !win.minimized;
    win.el.hidden = win.minimized;
    if (!win.minimized) {
      this.focusWindow(id);
      if (win.onResize) requestAnimationFrame(() => win.onResize(win.rect));
    }
    this.renderTaskbar();
  }

  toggleMaximize(id) {
    const win = this.windows.get(id);
    if (!win) return;
    const desk = this.getDesktopRect();
    if (!win.maximized) {
      win.prevRect = { ...win.rect };
      win.maximized = true;
      win.el.classList.add("maximized");
      this.applyRect(win, { x: 6, y: 6, width: desk.width - 12, height: desk.height - 12 });
    } else {
      win.maximized = false;
      win.el.classList.remove("maximized");
      if (win.prevRect) this.applyRect(win, win.prevRect);
    }
    this.focusWindow(id);
  }

  closeWindow(id) {
    const win = this.windows.get(id);
    if (!win) return;
    if (!win.closable) {
      this.toggleMinimize(id, true);
      return;
    }
    if (win.onClose) win.onClose();
    win.el.remove();
    if (this.focusedId === id) this.focusedId = null;
    this.windows.delete(id);
    this.renderTaskbar();
  }

  bindWindowEvents(win) {
    win.el.addEventListener("mousedown", () => {
      this.focusWindow(win.id);
    });

    // Double-click titlebar to maximize/restore
    win.titlebar.addEventListener("dblclick", (e) => {
      if (e.target.closest("button, input, select, label")) return;
      this.toggleMaximize(win.id);
    });

    // Drag window from titlebar
    win.titlebar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button, input, select, label, a")) return;
      e.preventDefault();
      this.focusWindow(win.id);

      if (win.maximized) {
        const ratio = e.clientX / Math.max(1, win.rect.width);
        win.maximized = false;
        win.el.classList.remove("maximized");
        const restoredW = win.prevRect?.width || 760;
        const restoredH = win.prevRect?.height || 440;
        const deskBox = this.desktop.getBoundingClientRect();
        this.applyRect(win, {
          x: e.clientX - deskBox.left - restoredW * ratio,
          y: e.clientY - deskBox.top - 16,
          width: restoredW,
          height: restoredH,
        });
      }

      this.activeDrag = {
        type: "move",
        win,
        startX: e.clientX,
        startY: e.clientY,
        origRect: { ...win.rect },
        snapRect: null,
      };
    });

    // Window control buttons
    win.titlebar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-win-act]");
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.winAct;
      if (act === "min") this.toggleMinimize(win.id);
      else if (act === "max") this.toggleMaximize(win.id);
      else if (act === "close") this.closeWindow(win.id);
    });

    // Resize handles
    win.el.querySelectorAll(".win-resize-handle").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.focusWindow(win.id);
        win.maximized = false;
        win.el.classList.remove("maximized");
        this.activeDrag = {
          type: "resize",
          dir: handle.dataset.resizeDir,
          win,
          startX: e.clientX,
          startY: e.clientY,
          origRect: { ...win.rect },
        };
      });
    });
  }

  computeEdgeSnap(clientX, clientY) {
    const box = this.desktop.getBoundingClientRect();
    const rx = clientX - box.left;
    const ry = clientY - box.top;
    const w = box.width;
    const h = box.height;
    const pad = 6;
    const edge = 20;

    if (ry <= edge) {
      return { x: pad, y: pad, width: w - pad * 2, height: Math.round(h * 0.56) - pad * 1.5 };
    }
    if (ry >= h - edge) {
      const topH = Math.round(h * 0.56);
      return { x: pad, y: topH + pad * 0.5, width: w - pad * 2, height: h - topH - pad * 1.5 };
    }
    if (rx <= edge) {
      return { x: pad, y: pad, width: Math.round(w * 0.5) - pad * 1.5, height: h - pad * 2 };
    }
    if (rx >= w - edge) {
      const leftW = Math.round(w * 0.5);
      return { x: leftW + pad * 0.5, y: pad, width: w - leftW - pad * 1.5, height: h - pad * 2 };
    }
    return null;
  }

  onGlobalMouseMove(e) {
    if (!this.activeDrag) return;
    const { type, win, startX, startY, origRect } = this.activeDrag;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (type === "move") {
      this.applyRect(win, {
        x: origRect.x + dx,
        y: origRect.y + dy,
        width: origRect.width,
        height: origRect.height,
      }, false);

      const snap = this.computeEdgeSnap(e.clientX, e.clientY);
      this.activeDrag.snapRect = snap;
      if (snap) {
        this.snapPreview.hidden = false;
        this.snapPreview.style.left = `${snap.x}px`;
        this.snapPreview.style.top = `${snap.y}px`;
        this.snapPreview.style.width = `${snap.width}px`;
        this.snapPreview.style.height = `${snap.height}px`;
      } else {
        this.snapPreview.hidden = true;
      }
      return;
    }

    if (type === "resize") {
      const dir = this.activeDrag.dir;
      let { x, y, width, height } = origRect;
      if (dir.includes("e")) width = origRect.width + dx;
      if (dir.includes("s")) height = origRect.height + dy;
      if (dir.includes("w")) {
        const nextW = Math.max(win.minWidth, origRect.width - dx);
        x = origRect.x + (origRect.width - nextW);
        width = nextW;
      }
      this.applyRect(win, { x, y, width, height }, true);
    }
  }

  onGlobalMouseUp() {
    if (!this.activeDrag) return;
    const { type, win, snapRect } = this.activeDrag;
    this.snapPreview.hidden = true;
    if (type === "move" && snapRect) {
      this.applyRect(win, snapRect, true);
    } else if (win.onResize) {
      win.onResize(win.rect);
    }
    this.activeDrag = null;
  }

  clampAllToDesktop() {
    for (const win of this.windows.values()) {
      this.applyRect(win, win.rect, true);
    }
  }

  applyLayoutPreset(preset = "top-bottom") {
    const desk = this.getDesktopRect();
    const pad = 6;
    const arr = this.windows.get("win-arrangement");
    const mix = this.windows.get("win-mixer");

    if (arr) this.toggleMinimize("win-arrangement", false);
    if (mix) this.toggleMinimize("win-mixer", false);

    if (preset === "top-bottom") {
      const arrH = Math.round(desk.height * 0.62) - pad * 1.5;
      const mixH = desk.height - arrH - pad * 3;
      if (arr) { arr.maximized = false; this.applyRect(arr, { x: pad, y: pad, width: desk.width - pad * 2, height: arrH }); }
      if (mix) { mix.maximized = false; this.applyRect(mix, { x: pad, y: arrH + pad * 2, width: desk.width - pad * 2, height: mixH }); }
    } else if (preset === "bottom-top") {
      const mixH = Math.round(desk.height * 0.38) - pad * 1.5;
      const arrH = desk.height - mixH - pad * 3;
      if (mix) { mix.maximized = false; this.applyRect(mix, { x: pad, y: pad, width: desk.width - pad * 2, height: mixH }); }
      if (arr) { arr.maximized = false; this.applyRect(arr, { x: pad, y: mixH + pad * 2, width: desk.width - pad * 2, height: arrH }); }
    } else if (preset === "left-right") {
      const arrW = Math.round(desk.width * 0.64) - pad * 1.5;
      const mixW = desk.width - arrW - pad * 3;
      if (arr) { arr.maximized = false; this.applyRect(arr, { x: pad, y: pad, width: arrW, height: desk.height - pad * 2 }); }
      if (mix) { mix.maximized = false; this.applyRect(mix, { x: arrW + pad * 2, y: pad, width: mixW, height: desk.height - pad * 2 }); }
    } else if (preset === "cascade") {
      let idx = 0;
      for (const win of this.windows.values()) {
        this.toggleMinimize(win.id, false);
        win.maximized = false;
        const w = Math.min(desk.width - 80, win.id === "win-arrangement" ? 960 : 780);
        const h = Math.min(desk.height - 80, win.id === "win-mixer" ? 260 : 460);
        this.applyRect(win, { x: 20 + idx * 32, y: 18 + idx * 30, width: w, height: h });
        this.focusWindow(win.id);
        idx++;
      }
    } else if (preset === "tile") {
      const visible = [...this.windows.values()];
      visible.forEach((w) => this.toggleMinimize(w.id, false));
      const count = visible.length;
      const cols = count <= 2 ? 1 : Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const cellW = Math.floor((desk.width - pad * (cols + 1)) / cols);
      const cellH = Math.floor((desk.height - pad * (rows + 1)) / rows);
      visible.forEach((win, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        win.maximized = false;
        this.applyRect(win, {
          x: pad + c * (cellW + pad),
          y: pad + r * (cellH + pad),
          width: cellW,
          height: cellH,
        });
      });
    }
  }

  renderTaskbar() {
    if (!this.taskbar) return;
    this.taskbar.innerHTML = "";
    for (const win of this.windows.values()) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `taskbar-pill ${win.el.classList.contains("focused") && !win.minimized ? "active" : ""} ${win.minimized ? "minimized" : ""}`;
      pill.style.setProperty("--pill-color", win.accentColor);
      pill.innerHTML = `<span>${win.icon}</span><span class="tp-label">${win.title}</span>`;
      pill.addEventListener("click", () => {
        if (win.minimized) {
          this.toggleMinimize(win.id, false);
        } else if (win.el.classList.contains("focused")) {
          this.toggleMinimize(win.id, true);
        } else {
          this.focusWindow(win.id);
        }
      });
      this.taskbar.appendChild(pill);
    }
  }
}

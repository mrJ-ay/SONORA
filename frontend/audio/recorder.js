import { registerDecodedSample } from "./externalLoader.js";

export class AudioRecorderManager {
  constructor() {
    this.stream = null;
    this.activeDeviceId = "";
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;
    this.recordingMeta = null; // { trackId, startBar, takeName, startedAtMs }

    this.sourceNode = null;
    this.analyser = null;
    this.monitorGain = null;
    this.boundCtx = null;
    this.monitoring = false;
    this.meterBuf = new Uint8Array(128);
  }

  async listInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "audioinput")
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `오디오 입력 / 마이크 ${idx + 1}`,
        }));
    } catch {
      return [];
    }
  }

  async ensureStream(audioCtx, deviceId = "", monitorDest = null) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저에서는 마이크/오디오 녹음(getUserMedia)을 지원하지 않습니다.");
    }

    const needNewStream =
      !this.stream ||
      !this.stream.active ||
      (deviceId && deviceId !== this.activeDeviceId);

    if (needNewStream) {
      this.releaseStreamOnly();
      let stream = null;
      try {
        const audioConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        };
        if (deviceId) audioConstraints.deviceId = { exact: deviceId };
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch {
        // Fallback if studio constraints or exact deviceId fail
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId } : true,
        });
      }
      this.stream = stream;
      const trackSettings = stream.getAudioTracks()[0]?.getSettings?.() || {};
      this.activeDeviceId = trackSettings.deviceId || deviceId || "";
      this.boundCtx = null;
    }

    if (audioCtx && this.stream && this.boundCtx !== audioCtx) {
      this.disconnectNodes();
      this.boundCtx = audioCtx;
      this.sourceNode = audioCtx.createMediaStreamSource(this.stream);
      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.meterBuf = new Uint8Array(this.analyser.fftSize);
      this.monitorGain = audioCtx.createGain();
      this.monitorGain.gain.value = this.monitoring ? 0.85 : 0;

      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.monitorGain);
      if (monitorDest) {
        this.monitorGain.connect(monitorDest);
      } else {
        this.monitorGain.connect(audioCtx.destination);
      }
    }

    return this.stream;
  }

  setMonitoring(enabled) {
    this.monitoring = Boolean(enabled);
    if (this.monitorGain && this.boundCtx) {
      this.monitorGain.gain.setTargetAtTime(this.monitoring ? 0.85 : 0, this.boundCtx.currentTime, 0.015);
    }
  }

  getInputLevelPercent() {
    if (!this.analyser || !this.stream?.active) return 0;
    this.analyser.getByteTimeDomainData(this.meterBuf);
    let max = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = Math.abs(this.meterBuf[i] - 128) / 128;
      if (v > max) max = v;
    }
    return Math.min(100, Math.round(max * 165));
  }

  async startRecording({ audioCtx, trackId, startBar = 0, takeName = "Rec Take", deviceId = "", monitorDest = null }) {
    if (this.isRecording) throw new Error("이미 녹음이 진행 중입니다.");
    const stream = await this.ensureStream(audioCtx, deviceId || this.activeDeviceId, monitorDest);

    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    let mimeType = "";
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported) {
      mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
    }

    this.chunks = [];
    this.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.recordingMeta = {
      trackId,
      startBar,
      takeName,
      startedAtMs: performance.now(),
      mimeType: this.mediaRecorder.mimeType || mimeType || "audio/webm",
    };
    this.isRecording = true;
    this.mediaRecorder.start(120);
    return this.recordingMeta;
  }

  stopRecording(audioCtx) {
    return new Promise((resolve, reject) => {
      if (!this.isRecording || !this.mediaRecorder) {
        this.isRecording = false;
        return resolve(null);
      }

      const meta = { ...this.recordingMeta };
      const recorder = this.mediaRecorder;
      this.mediaRecorder = null;
      this.isRecording = false;
      this.recordingMeta = null;

      recorder.onstop = async () => {
        try {
          if (!this.chunks.length) {
            return reject(new Error("녹음된 오디오 데이터가 없습니다."));
          }
          const blob = new Blob(this.chunks, { type: meta.mimeType });
          this.chunks = [];
          const arrayBuf = await blob.arrayBuffer();
          const Ctx = window.AudioContext || window.webkitAudioContext;
          const ctx = audioCtx || this.boundCtx || new Ctx();
          const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
          const sampleId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const entry = registerDecodedSample(sampleId, meta.takeName, decoded, 60, true);
          resolve({
            trackId: meta.trackId,
            startBar: meta.startBar,
            sampleId: entry.id,
            name: meta.takeName,
            duration: entry.duration,
            sampleRate: entry.sampleRate,
            peaks: entry.peaks,
          });
        } catch (err) {
          reject(new Error("녹음 오디오 디코딩에 실패했습니다: " + (err?.message || err)));
        }
      };

      try {
        recorder.stop();
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnectNodes() {
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    try { this.monitorGain?.disconnect(); } catch {}
    this.sourceNode = null;
    this.analyser = null;
    this.monitorGain = null;
    this.boundCtx = null;
  }

  releaseStreamOnly() {
    this.disconnectNodes();
    if (this.stream) {
      for (const tr of this.stream.getTracks()) {
        try { tr.stop(); } catch {}
      }
      this.stream = null;
    }
  }
}

// External Synth / Sample / SoundFont2 (.sf2) Loader & Sample Bank
// Supports:
//  1) Audio Instrument Samples (.wav, .mp3, .ogg, .flac, .m4a, .webm) -> Chromatic Sampler / Drum Sample
//  2) SoundFont 2 (.sf2) Binary Multi-Sampled Virtual Instruments
//  3) External Synth Patch Files (.json, .synth.json) -> Import & Export

const sampleBank = new Map(); // sampleId -> { name, sampleRate, channels: Float32Array[], rootMidi, loop, trimStart, trimEnd }
const sf2Bank = new Map();    // sf2Id -> { fileName, instruments: [{ name, zones: [...] }] }
const ctxBufferCache = new WeakMap(); // BaseAudioContext -> Map<cacheKey, AudioBuffer>

function getCtxCache(ctx) {
  let map = ctxBufferCache.get(ctx);
  if (!map) {
    map = new Map();
    ctxBufferCache.set(ctx, map);
  }
  return map;
}

export function registerDecodedSample(sampleId, name, audioBuffer, rootMidi = 60) {
  const channels = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(new Float32Array(audioBuffer.getChannelData(c)));
  }
  const entry = {
    id: sampleId,
    name,
    sampleRate: audioBuffer.sampleRate,
    length: audioBuffer.length,
    duration: audioBuffer.duration,
    channels,
    rootMidi,
  };
  sampleBank.set(sampleId, entry);
  return entry;
}

export function getSampleEntry(sampleId) {
  return sampleBank.get(sampleId) || null;
}

export function getSampleAudioBuffer(ctx, sampleId) {
  const entry = sampleBank.get(sampleId);
  if (!entry) return null;
  const cache = getCtxCache(ctx);
  const key = `smp:${sampleId}`;
  if (cache.has(key)) return cache.get(key);

  const buf = ctx.createBuffer(entry.channels.length, entry.length, entry.sampleRate);
  for (let c = 0; c < entry.channels.length; c++) {
    buf.copyToChannel(entry.channels[c], c);
  }
  cache.set(key, buf);
  return buf;
}

export function getSf2ZoneForNote(ctx, sf2Id, instIndex, midi) {
  const sf2 = sf2Bank.get(sf2Id);
  if (!sf2 || !sf2.instruments.length) return null;
  const inst = sf2.instruments[Math.min(instIndex || 0, sf2.instruments.length - 1)];
  if (!inst || !inst.zones.length) return null;

  // Find matching keyRange zone or closest root key
  let matched = inst.zones.find((z) => midi >= z.keyLow && midi <= z.keyHigh);
  if (!matched) {
    matched = inst.zones.reduce((best, z) =>
      Math.abs(z.rootMidi - midi) < Math.abs(best.rootMidi - midi) ? z : best
    , inst.zones[0]);
  }

  const cache = getCtxCache(ctx);
  const key = `sf2:${sf2Id}:${matched.zoneKey}`;
  let audioBuf = cache.get(key);
  if (!audioBuf) {
    audioBuf = ctx.createBuffer(1, matched.pcm.length, matched.sampleRate);
    audioBuf.copyToChannel(matched.pcm, 0);
    cache.set(key, audioBuf);
  }
  return { zone: matched, buffer: audioBuf };
}

export function getSf2Metadata(sf2Id) {
  return sf2Bank.get(sf2Id) || null;
}

// Parse SoundFont 2 (.sf2) RIFF sfbk binary format
export function parseSoundFont2(arrayBuffer, fileName = "SoundFont.sf2") {
  const view = new DataView(arrayBuffer);
  const readFourCC = (off) =>
    String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
  const readFixedStr = (off, len) => {
    let s = "";
    for (let i = 0; i < len; i++) {
      const ch = view.getUint8(off + i);
      if (ch === 0) break;
      s += String.fromCharCode(ch);
    }
    return s.trim();
  };

  if (readFourCC(0) !== "RIFF" || readFourCC(8) !== "sfbk") {
    throw new Error("유효한 SoundFont2 (.sf2) RIFF sfbk 파일이 아닙니다.");
  }

  let smplOffset = 0;
  let smplByteLen = 0;
  const pdtaChunks = {};

  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const id = readFourCC(pos);
    const size = view.getUint32(pos + 4, true);
    if (id === "LIST") {
      const listType = readFourCC(pos + 8);
      let sub = pos + 12;
      const listEnd = Math.min(view.byteLength, pos + 8 + size);
      while (sub + 8 <= listEnd) {
        const subId = readFourCC(sub);
        const subSize = view.getUint32(sub + 4, true);
        if (listType === "sdta" && subId === "smpl") {
          smplOffset = sub + 8;
          smplByteLen = subSize;
        } else if (listType === "pdta") {
          pdtaChunks[subId] = { offset: sub + 8, size: subSize };
        }
        sub += 8 + subSize + (subSize % 2);
      }
    }
    pos += 8 + size + (size % 2);
  }

  if (!smplOffset || !pdtaChunks.shdr) {
    throw new Error("SF2 파일 내 오디오 샘플 데이터(sdta/shdr)를 찾을 수 없습니다.");
  }

  const totalSamples = Math.floor(smplByteLen / 2);

  // Parse shdr (46 bytes each)
  const shdr = pdtaChunks.shdr;
  const shdrCount = Math.floor(shdr.size / 46);
  const sampleHeaders = [];
  for (let i = 0; i < shdrCount - 1; i++) {
    const o = shdr.offset + i * 46;
    sampleHeaders.push({
      name: readFixedStr(o, 20) || `Sample ${i + 1}`,
      start: view.getUint32(o + 20, true),
      end: view.getUint32(o + 24, true),
      startLoop: view.getUint32(o + 28, true),
      endLoop: view.getUint32(o + 32, true),
      sampleRate: view.getUint32(o + 36, true) || 44100,
      originalPitch: view.getUint8(o + 40),
      pitchCorrection: view.getInt8(o + 41),
      sampleType: view.getUint16(o + 44, true),
    });
  }

  // Helper to slice Int16 PCM -> Float32Array
  const extractPcm = (hdr) => {
    const start = Math.min(totalSamples, hdr.start);
    const end = Math.min(totalSamples, Math.max(start + 1, hdr.end));
    const len = end - start;
    const f32 = new Float32Array(len);
    let bytePtr = smplOffset + start * 2;
    for (let i = 0; i < len; i++) {
      f32[i] = view.getInt16(bytePtr, true) / 32768;
      bytePtr += 2;
    }
    return f32;
  };

  const instruments = [];

  if (pdtaChunks.inst && pdtaChunks.ibag && pdtaChunks.igen) {
    const instChunk = pdtaChunks.inst;
    const ibagChunk = pdtaChunks.ibag;
    const igenChunk = pdtaChunks.igen;

    const instCount = Math.floor(instChunk.size / 22);
    const ibagCount = Math.floor(ibagChunk.size / 4);
    const igenCount = Math.floor(igenChunk.size / 4);

    const instRecs = [];
    for (let i = 0; i < instCount; i++) {
      const o = instChunk.offset + i * 22;
      instRecs.push({
        name: readFixedStr(o, 20),
        bagNdx: view.getUint16(o + 20, true),
      });
    }

    const ibagRecs = [];
    for (let i = 0; i < ibagCount; i++) {
      const o = ibagChunk.offset + i * 4;
      ibagRecs.push({ genNdx: view.getUint16(o, true) });
    }

    const igenRecs = [];
    for (let i = 0; i < igenCount; i++) {
      const o = igenChunk.offset + i * 4;
      igenRecs.push({
        oper: view.getUint16(o, true),
        lo: view.getUint8(o + 2),
        hi: view.getUint8(o + 3),
        u16: view.getUint16(o + 2, true),
        i16: view.getInt16(o + 2, true),
      });
    }

    for (let i = 0; i < instRecs.length - 1; i++) {
      const bagStart = instRecs[i].bagNdx;
      const bagEnd = instRecs[i + 1].bagNdx;
      const zones = [];
      let globalSampleModes = 0;

      for (let b = bagStart; b < bagEnd && b + 1 < ibagRecs.length; b++) {
        const gStart = ibagRecs[b].genNdx;
        const gEnd = ibagRecs[b + 1].genNdx;
        let keyLow = 0;
        let keyHigh = 127;
        let sampleId = -1;
        let overrideRoot = -1;
        let coarseTune = 0;
        let fineTune = 0;
        let sampleModes = globalSampleModes;

        for (let g = gStart; g < gEnd && g < igenRecs.length; g++) {
          const gen = igenRecs[g];
          if (gen.oper === 43) { keyLow = gen.lo; keyHigh = gen.hi; }         // keyRange
          else if (gen.oper === 53) { sampleId = gen.u16; }                   // sampleID
          else if (gen.oper === 58) { overrideRoot = gen.i16; }               // overridingRootKey
          else if (gen.oper === 51) { coarseTune = gen.i16; }                 // coarseTune
          else if (gen.oper === 52) { fineTune = gen.i16; }                   // fineTune
          else if (gen.oper === 54) { sampleModes = gen.u16; }                // sampleModes
        }

        if (b === bagStart && sampleId < 0) {
          globalSampleModes = sampleModes;
          continue;
        }

        if (sampleId >= 0 && sampleId < sampleHeaders.length) {
          const sh = sampleHeaders[sampleId];
          // Skip right-channel linked stereo duplicate if left already covers or keep mono-compatible
          if (sh.sampleType === 2) continue;
          const rootRaw = overrideRoot >= 0 && overrideRoot <= 127
            ? overrideRoot
            : (sh.originalPitch <= 127 ? sh.originalPitch : 60);
          const rootMidi = rootRaw - coarseTune - (fineTune + (sh.pitchCorrection || 0)) / 100;
          const pcm = extractPcm(sh);
          const loopStartSec = Math.max(0, (sh.startLoop - sh.start) / sh.sampleRate);
          const loopEndSec = Math.max(loopStartSec, (sh.endLoop - sh.start) / sh.sampleRate);
          zones.push({
            zoneKey: `${i}_${b}_${sampleId}`,
            keyLow,
            keyHigh,
            rootMidi,
            sampleRate: sh.sampleRate,
            pcm,
            loop: (sampleModes & 1) === 1 && loopEndSec > loopStartSec + 0.005,
            loopStart: loopStartSec,
            loopEnd: loopEndSec,
          });
        }
      }

      if (zones.length > 0) {
        instruments.push({
          name: instRecs[i].name || `Instrument ${instruments.length + 1}`,
          zones,
        });
      }
    }
  }

  // Fallback if SF2 has raw sampleHeaders without inst bags
  if (instruments.length === 0 && sampleHeaders.length > 0) {
    const sh = sampleHeaders[0];
    instruments.push({
      name: sh.name || fileName.replace(/\.sf2$/i, ""),
      zones: [{
        zoneKey: "fallback_0",
        keyLow: 0,
        keyHigh: 127,
        rootMidi: sh.originalPitch <= 127 ? sh.originalPitch : 60,
        sampleRate: sh.sampleRate,
        pcm: extractPcm(sh),
        loop: false,
        loopStart: 0,
        loopEnd: 0,
      }],
    });
  }

  const sf2Id = `sf2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const record = {
    id: sf2Id,
    fileName,
    instruments,
  };
  sf2Bank.set(sf2Id, record);
  return record;
}

// Import external file (.wav, .mp3, .ogg, .flac, .m4a, .sf2, .json)
export async function importExternalInstrumentFile(file, audioCtx) {
  const name = file.name || "External Instrument";
  const ext = (name.split(".").pop() || "").toLowerCase();

  if (ext === "dll" || ext === "vst" || ext === "vst3" || ext === "component") {
    throw new Error(
      "운영체제 전용 바이너리(.vst3/.dll)는 브라우저 보안상 직접 실행되지 않습니다. 대신 .sf2(사운드폰트), .wav/.mp3/.ogg/.flac(악기 샘플), .json(신스 패치) 파일을 불러올 수 있습니다!"
    );
  }

  if (ext === "sf2") {
    const buf = await file.arrayBuffer();
    const sf2 = parseSoundFont2(buf, name);
    return {
      kind: "sf2",
      sf2Id: sf2.id,
      fileName: name,
      instruments: sf2.instruments.map((inst, idx) => ({ index: idx, name: inst.name, zoneCount: inst.zones.length })),
    };
  }

  if (ext === "json") {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // Support either full SONORA synth patch or generic synth object
    const synthSource = parsed.synth || parsed;
    if (typeof synthSource !== "object" || synthSource === null) {
      throw new Error("유효한 신스 패치 JSON 형식이 아닙니다.");
    }
    return {
      kind: "synth_patch",
      name: parsed.name || name.replace(/(\.synth)?\.json$/i, ""),
      engine: parsed.engine === "fmkeys" ? "fmkeys" : "synth",
      color: parsed.color || "#54a0ff",
      synth: {
        waveform: ["sine", "triangle", "sawtooth", "square"].includes(synthSource.waveform)
          ? synthSource.waveform
          : "sawtooth",
        cutoff: Number(synthSource.cutoff ?? 3200),
        resonance: Number(synthSource.resonance ?? 1.8),
        attack: Number(synthSource.attack ?? 0.01),
        decay: Number(synthSource.decay ?? 0.28),
        sustain: Number(synthSource.sustain ?? 0.65),
        release: Number(synthSource.release ?? 0.22),
        detune: Number(synthSource.detune ?? 10),
        subMix: Number(synthSource.subMix ?? 0.2),
        fmAmount: Number(synthSource.fmAmount ?? 0),
      },
    };
  }

  // Audio Sample (.wav, .mp3, .ogg, .flac, .m4a, .aac, .webm)
  const arrayBuf = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = audioCtx || new Ctx();
  const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  const sampleId = `smp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cleanName = name.replace(/\.[^.]+$/, "");
  const entry = registerDecodedSample(sampleId, cleanName, decoded, 60);

  return {
    kind: "sample",
    sampleId: entry.id,
    name: cleanName,
    duration: entry.duration,
    sampleRate: entry.sampleRate,
  };
}

export function exportSynthPatchJson(track) {
  const payload = {
    format: "sonora-synth-patch-v1",
    name: track.pluginName || track.name || "Custom Synth",
    engine: track.engine === "fmkeys" ? "fmkeys" : "synth",
    color: track.color || "#54a0ff",
    synth: { ...(track.synth || {}) },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(payload.name).replace(/[^a-zA-Z0-9가-힣_-]/g, "_")}.synth.json`;
  a.click();
  URL.revokeObjectURL(url);
}

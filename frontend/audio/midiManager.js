// Web MIDI API Hardware Integration Manager for SONORA
// Supports USB MIDI Keyboards, Master Controllers, Launchpads, Synthesizers

export class WebMidiManager {
  constructor({ onNoteOn, onNoteOff, onControlChange, onPitchBend, onDeviceStateChange }) {
    this.onNoteOn = onNoteOn || null;
    this.onNoteOff = onNoteOff || null;
    this.onControlChange = onControlChange || null;
    this.onPitchBend = onPitchBend || null;
    this.onDeviceStateChange = onDeviceStateChange || null;

    this.midiAccess = null;
    this.inputs = new Map();
    this.activeDevices = [];
    this.isSupported = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
    this.initialized = false;
    this.lastMidiEvent = null;
  }

  async init() {
    if (!this.isSupported) {
      console.warn("[SONORA MIDI] Web MIDI API is not supported in this browser.");
      return { success: false, reason: "unsupported" };
    }
    if (this.initialized && this.midiAccess) {
      return { success: true, devices: this.getDeviceList() };
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.initialized = true;
      this.bindInputs();

      this.midiAccess.onstatechange = (e) => {
        const wasCount = this.activeDevices.length;
        this.bindInputs();
        const nowCount = this.activeDevices.length;
        if (this.onDeviceStateChange) {
          this.onDeviceStateChange({
            devices: this.getDeviceList(),
            port: e.port,
            action: e.port?.state === "connected" ? "connected" : "disconnected",
            countChanged: wasCount !== nowCount,
          });
        }
      };

      if (this.onDeviceStateChange) {
        this.onDeviceStateChange({
          devices: this.getDeviceList(),
          action: "ready",
          countChanged: false,
        });
      }

      return { success: true, devices: this.getDeviceList() };
    } catch (err) {
      console.warn("[SONORA MIDI] Permission denied or device error:", err);
      return { success: false, error: err };
    }
  }

  bindInputs() {
    if (!this.midiAccess) return;
    this.inputs.clear();
    const list = [];

    for (const input of this.midiAccess.inputs.values()) {
      this.inputs.set(input.id, input);
      list.push({
        id: input.id,
        name: input.name || "USB MIDI Keyboard",
        manufacturer: input.manufacturer || "Generic",
        state: input.state,
      });
      // Attach message listener to all connected input ports
      input.onmidimessage = (e) => this.handleMidiMessage(e, input);
    }
    this.activeDevices = list;
  }

  getDeviceList() {
    return [...this.activeDevices];
  }

  handleMidiMessage(e, input) {
    if (!e.data || e.data.length < 2) return;
    const [status, data1, data2] = e.data;
    const cmd = status >> 4;
    const channel = (status & 0xf) + 1;
    const deviceName = input.name || "MIDI Keyboard";

    // 1) Note On (command 9 with velocity > 0)
    if (cmd === 9 && (data2 || 0) > 0) {
      const midiNote = data1;
      const velocity = Math.max(0.01, Math.min(1.0, data2 / 127));
      this.lastMidiEvent = { type: "noteon", note: midiNote, velocity, channel, deviceName, time: performance.now() };
      if (this.onNoteOn) {
        this.onNoteOn({ note: midiNote, velocity, channel, deviceName });
      }
      return;
    }

    // 2) Note Off (command 8 or command 9 with velocity 0)
    if (cmd === 8 || (cmd === 9 && (data2 || 0) === 0)) {
      const midiNote = data1;
      this.lastMidiEvent = { type: "noteoff", note: midiNote, channel, deviceName, time: performance.now() };
      if (this.onNoteOff) {
        this.onNoteOff({ note: midiNote, channel, deviceName });
      }
      return;
    }

    // 3) Control Change (command 11, e.g. CC 64 Sustain Pedal, CC 1 Mod Wheel)
    if (cmd === 11) {
      const controller = data1;
      const value = data2 ?? 0;
      this.lastMidiEvent = { type: "cc", controller, value, channel, deviceName, time: performance.now() };
      if (this.onControlChange) {
        this.onControlChange({ controller, value, channel, deviceName });
      }
      return;
    }

    // 4) Pitch Bend (command 14)
    if (cmd === 14) {
      const rawBend = ((data2 << 7) | data1) - 8192; // -8192 ~ +8191
      const normalizedBend = rawBend / 8192; // -1.0 ~ +1.0
      this.lastMidiEvent = { type: "pitchbend", bend: normalizedBend, channel, deviceName, time: performance.now() };
      if (this.onPitchBend) {
        this.onPitchBend({ bend: normalizedBend, channel, deviceName });
      }
    }
  }
}

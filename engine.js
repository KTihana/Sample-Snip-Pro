import { encode } from './encoding.js';
import { SESSION_LIMIT, validTrim } from './model.js';

export class PadEngine extends EventTarget {
  constructor() {
    super();
    this.buffers = new Map();
    this.pads = new Map();
    this.voices = new Set();
    this.mode = 'layer';
    this.recording = false;
    this.preparing = false;
    this.exporting = false;
    this.chunks = [];
    this.masterVolume = 0.8;
  }
  async initialize() {
    if (!this.initializing)
      this.initializing = (async () => {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.master = this.context.createGain();
        this.master.gain.value = this.masterVolume;
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -1;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0;
        this.limiter.release.value = 0.02;
        this.master.connect(this.limiter);
        this.limiter.connect(this.context.destination);
        await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
        this.recorder = new AudioWorkletNode(this.context, 'pcm-recorder', {
          channelCount: 2,
          channelCountMode: 'explicit',
          processorOptions: { autoStart: false, maxSeconds: SESSION_LIMIT },
        });
        this.limiter.connect(this.recorder);
        this.recorder.connect(this.context.destination);
        this.recorder.port.onmessage = ({ data }) => {
          if (data.type === 'started') {
            this.preparing = false;
            this.recording = true;
            this.recordStarted = this.context.currentTime;
            this.dispatchEvent(new Event('recording'));
            this.startResolve?.();
            this.startResolve = null;
          }
          if (data.type === 'chunk') this.chunks.push(data.chunk);
          if (data.type === 'finished') void this.finishRecording(data.frames, data.capped);
        };
        return this;
      })();
    return this.initializing;
  }
  async load(pad) {
    await this.initialize();
    if (!pad.data) {
      this.remove(pad.id);
      return;
    }
    const buffer = await this.context.decodeAudioData(await pad.data.arrayBuffer());
    const trim = validTrim(pad.start, pad.end, buffer.duration);
    Object.assign(pad, trim, { duration: buffer.duration });
    this.stopPad(pad.id);
    this.buffers.set(pad.id, buffer);
    this.pads.set(pad.id, pad);
    return buffer;
  }
  remove(id) {
    this.stopPad(id);
    this.buffers.delete(id);
    this.pads.delete(id);
  }
  async resume() {
    await this.initialize();
    if (this.context.state !== 'running') await this.context.resume();
  }
  trigger(id, forceOneShot = false) {
    if (!this.buffers.has(id)) return false;
    if (this.context.state !== 'running') {
      void this.resume()
        .then(() => this.trigger(id, forceOneShot))
        .catch((error) => this.dispatchEvent(new CustomEvent('error', { detail: error.message })));
      return true;
    }
    const pad = this.pads.get(id),
      buffer = this.buffers.get(id);
    const alreadyPlaying = [...this.voices].some((voice) => voice.id === id && !voice.stopped);
    this.stopPad(id);
    if (pad.loop && alreadyPlaying && !forceOneShot) return true;
    if (this.mode === 'cut') this.stopAll();
    // Bound polyphony during rapid retriggering; all sounds are already decoded.
    if (this.voices.size >= 48) this.stopVoice(this.voices.values().next().value);
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    const now = this.context.currentTime;
    const { start, end } = validTrim(pad.start, pad.end, buffer.duration);
    source.buffer = buffer;
    source.loop = !!pad.loop && !forceOneShot;
    source.loopStart = start;
    source.loopEnd = end;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(pad.volume, now + 0.003);
    if (!source.loop) {
      gain.gain.setValueAtTime(pad.volume, now + Math.max(0.003, end - start - 0.004));
      gain.gain.linearRampToValueAtTime(0, now + end - start);
    }
    source.connect(gain);
    gain.connect(this.master);
    const voice = { id, source, gain, stopped: false };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
      this.changed();
    };
    if (source.loop) source.start(now, start);
    else source.start(now, start, end - start);
    this.changed();
    return true;
  }
  stopVoice(voice) {
    if (!voice || voice.stopped) return;
    voice.stopped = true;
    this.voices.delete(voice);
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + 0.004);
    voice.source.stop(now + 0.005);
  }
  stopPad(id) {
    for (const voice of this.voices) if (voice.id === id) this.stopVoice(voice);
  }
  stopAll() {
    for (const voice of this.voices) this.stopVoice(voice);
    this.changed();
  }
  changed() {
    this.dispatchEvent(
      new CustomEvent('voices', {
        detail: new Set([...this.voices].filter((v) => !v.stopped).map((v) => v.id)),
      }),
    );
  }
  setVolume(value) {
    this.masterVolume = value;
    if (this.master) this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }
  async startRecording() {
    if (this.recording || this.preparing || this.exporting) return;
    this.preparing = true;
    try {
      await this.resume();
      this.chunks = [];
      await new Promise((resolve) => {
        this.startResolve = resolve;
        this.recorder.port.postMessage({ type: 'start' });
      });
    } catch (error) {
      this.preparing = false;
      throw error;
    }
  }
  stopRecording() {
    if (this.recording) this.recorder.port.postMessage({ type: 'stop' });
  }
  async finishRecording(frames, capped) {
    this.recording = false;
    this.exporting = true;
    this.dispatchEvent(
      new CustomEvent('exporting', {
        detail: { duration: frames / this.context.sampleRate, capped },
      }),
    );
    const chunks = this.chunks;
    this.chunks = [];
    try {
      const blob = await encode(chunks, this.context.sampleRate);
      this.dispatchEvent(
        new CustomEvent('recorded', {
          detail: {
            blob,
            duration: frames / this.context.sampleRate,
            capped,
            createdAt: Date.now(),
          },
        }),
      );
    } catch (error) {
      this.dispatchEvent(new CustomEvent('error', { detail: error.message }));
    } finally {
      this.exporting = false;
      this.dispatchEvent(new Event('idle'));
    }
  }
  async exportPad(id) {
    const pad = this.pads.get(id),
      buffer = this.buffers.get(id);
    if (!buffer) throw new Error('Load a sample first.');
    const first = Math.round(pad.start * buffer.sampleRate),
      last = Math.round(pad.end * buffer.sampleRate);
    const chunks = [];
    const left = buffer.getChannelData(0),
      right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
    for (let start = first; start < last; start += 8192) {
      const count = Math.min(8192, last - start),
        chunk = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        chunk[i * 2] = left[start + i];
        chunk[i * 2 + 1] = right[start + i];
      }
      chunks.push(chunk);
    }
    return encode(chunks, buffer.sampleRate);
  }
}

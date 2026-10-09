// Stereo PCM capture on the audio thread. Frame-count limits remain exact even
// when background-window timers are throttled. Reusable for multiple sessions.
class PCMRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions || {};
    this.maxFrames = Math.round(sampleRate * (config.maxSeconds || 60));
    this.recording = config.autoStart !== false;
    this.buffer = new Float32Array(8192);
    this.used = 0;
    this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start' && !this.recording) {
        this.frames = 0;
        this.used = 0;
        this.recording = true;
        this.port.postMessage({ type: 'started' });
      }
      if (data.type === 'stop') this.finish();
    };
  }
  flush() {
    if (!this.used) return;
    const chunk = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: 'chunk', chunk }, [chunk.buffer]);
    this.used = 0;
  }
  finish() {
    if (!this.recording) return;
    this.recording = false;
    this.flush();
    this.port.postMessage({
      type: 'finished',
      frames: this.frames,
      capped: this.frames >= this.maxFrames,
    });
  }
  process(inputs) {
    if (!this.recording) return true;
    const channels = inputs[0];
    const count = channels?.[0]?.length || 128;
    for (let i = 0; i < count; i++) {
      this.buffer[this.used++] = channels?.[0]?.[i] || 0;
      this.buffer[this.used++] = (channels?.[1] || channels?.[0])?.[i] || 0;
      this.frames++;
      if (this.used === this.buffer.length) this.flush();
      if (this.frames >= this.maxFrames) {
        this.finish();
        break;
      }
    }
    return true; // Outputs are silent; the audible mix has a separate connection.
  }
}
registerProcessor('pcm-recorder', PCMRecorder);

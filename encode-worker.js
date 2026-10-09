import { encodeWav } from './wav.js';
self.onmessage = ({ data }) => {
  try {
    const buffer = encodeWav(data.chunks, data.sampleRate);
    self.postMessage({ buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};

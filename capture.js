import { encode } from './encoding.js';
import { getPad, putPads } from './storage.js';
import { SAMPLE_LIMIT } from './model.js';
let status = 'idle',
  error = '',
  pad,
  stream,
  context,
  node,
  chunks = [],
  started = 0,
  result;
let finishing;
function state() {
  return {
    status,
    error,
    padId: pad?.id,
    elapsed: status === 'recording' ? Math.min(SAMPLE_LIMIT, (Date.now() - started) / 1000) : 0,
    result,
  };
}
function update(next) {
  status = next;
  chrome.runtime
    .sendMessage({ target: 'background', type: 'state-change', status })
    .catch(() => {});
  chrome.runtime
    .sendMessage({ target: 'studio', type: 'capture-state', state: state() })
    .catch(() => {});
}
async function release() {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
  stream = undefined;
  if (context) await context.close();
  context = undefined;
  node = undefined;
}
async function finish(frames) {
  if (finishing) return finishing;
  update('stopping');
  finishing = (async () => {
    try {
      const rate = context.sampleRate;
      await release();
      if (!frames) throw new Error('No audio was captured. Your previous pad has been kept.');
      const data = await encode(chunks, rate);
      const previous = (await getPad(pad.id)) || pad;
      await putPads([{ ...previous, data, start: 0, end: frames / rate, updatedAt: Date.now() }]);
      result = { padId: pad.id, version: Date.now() };
      update('ready');
    } catch (cause) {
      error = cause.message;
      update('error');
    } finally {
      chunks = [];
      await release();
    }
  })();
  return finishing;
}
async function start(streamId) {
  try {
    chunks = [];
    finishing = undefined;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
        optional: [
          { echoCancellation: false },
          { noiseSuppression: false },
          { autoGainControl: false },
        ],
      },
      video: false,
    });
    context = new AudioContext();
    await context.audioWorklet.addModule('pcm-worklet.js');
    const source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'pcm-recorder', {
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { maxSeconds: SAMPLE_LIMIT },
    });
    node.port.onmessage = ({ data }) => {
      if (data.type === 'chunk') chunks.push(data.chunk);
      if (data.type === 'finished') void finish(data.frames);
    };
    source.connect(context.destination); // Restore browser playback suppressed by tabCapture.
    source.connect(node);
    node.connect(context.destination);
    stream.getTracks().forEach((track) => {
      track.onended = () => stop();
    });
    await context.resume();
    started = Date.now();
    update('recording');
  } catch (cause) {
    error = cause.message;
    await release();
    update('error');
  }
  return state();
}
function stop() {
  if (status === 'recording') {
    update('stopping');
    node.port.postMessage({ type: 'stop' });
  }
  return state();
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'recorder') return;
  (async () => {
    if (message.type === 'prepare') {
      if (!message.pad?.id || !Number.isInteger(message.pad.index))
        throw new Error('Choose a pad first.');
      pad = message.pad;
      result = undefined;
      error = '';
      update('starting');
    }
    if (message.type === 'start') return start(message.streamId);
    if (message.type === 'stop') return stop();
    if (message.type === 'error') {
      error = message.error;
      update('error');
    }
    return state();
  })()
    .then(reply)
    .catch((cause) => reply({ status: 'error', error: cause.message }));
  return true;
});

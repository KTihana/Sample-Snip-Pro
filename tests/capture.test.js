import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { encodeWav } from '../wav.js';
import { emptyPad } from '../model.js';

function fixture({ failSave = false, failCapture = false } = {}) {
  const previous = {
    ...emptyPad(0, 0),
    name: 'My kick',
    key: 'j',
    volume: 0.6,
    data: new Blob(['original']),
  };
  let saved = previous,
    node,
    context,
    handler;
  const connections = [],
    tracks = [
      {
        stop() {
          this.stopped = true;
        },
      },
    ],
    constraints = [];
  const media = { getTracks: () => tracks };
  class Context {
    constructor() {
      context = this;
      this.sampleRate = 48000;
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    createMediaStreamSource() {
      return { connect: (target) => connections.push(target) };
    }
    async resume() {}
    async close() {
      this.closed = true;
    }
  }
  const scope = {
    SAMPLE_LIMIT: 60,
    Blob,
    Date,
    getPad: async () => saved,
    putPads: async (records) => {
      if (failSave) throw new Error('Disk full');
      saved = records[0];
    },
    encode: async (chunks, rate) => new Blob([encodeWav(chunks, rate)], { type: 'audio/wav' }),
    AudioContext: Context,
    AudioWorkletNode: class {
      constructor() {
        node = this;
        this.port = {
          postMessage: () => {
            this.port.onmessage({ data: { type: 'chunk', chunk: new Float32Array([0.2, -0.2]) } });
            this.port.onmessage({ data: { type: 'finished', frames: 1 } });
          },
        };
      }
      connect() {}
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async (input) => {
          constraints.push(input);
          if (failCapture) throw new Error('Tab unavailable');
          return media;
        },
      },
    },
    chrome: {
      runtime: {
        id: 'pro-test',
        sendMessage: async () => {},
        onMessage: {
          addListener: (callback) => {
            handler = callback;
          },
        },
      },
    },
  };
  const code = fs
    .readFileSync(new URL('../capture.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '');
  vm.runInNewContext(code, scope);
  async function send(type, extra = {}) {
    return new Promise((resolve) =>
      handler({ target: 'recorder', type, ...extra }, { id: 'pro-test' }, resolve),
    );
  }
  return {
    previous,
    send,
    constraints,
    connections,
    tracks,
    get context() {
      return context;
    },
    get node() {
      return node;
    },
    get saved() {
      return saved;
    },
  };
}
test('successful tab capture restores source playback and replaces only the sound and trim bounds', async () => {
  const f = fixture();
  await f.send('prepare', { pad: f.previous });
  await f.send('start', { streamId: 'tab-test' });
  assert.equal(f.constraints[0].audio.mandatory.chromeMediaSource, 'tab');
  assert.equal(f.constraints[0].audio.mandatory.chromeMediaSourceId, 'tab-test');
  assert.equal(f.constraints[0].video, false);
  assert.deepEqual(Object.keys(f.constraints[0].audio).sort(), ['mandatory', 'optional']);
  assert.ok(f.connections.includes(f.context.destination));
  assert.ok(f.connections.includes(f.node));
  await f.send('stop');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.send('status')).status, 'ready');
  assert.notEqual(f.saved.data, f.previous.data);
  assert.equal(f.saved.name, 'My kick');
  assert.equal(f.saved.key, 'j');
  assert.equal(f.saved.volume, 0.6);
  assert.equal(f.saved.end, 1 / 48000);
  assert.ok(f.tracks.every((track) => track.stopped));
  assert.ok(f.context.closed);
});
test('capture or local-storage failures preserve the previous saved sound', async () => {
  for (const failure of [{ failSave: true }, { failCapture: true }]) {
    const f = fixture(failure);
    await f.send('prepare', { pad: f.previous });
    await f.send('start', { streamId: 'tab-test' });
    if (!failure.failCapture) await f.send('stop');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await f.send('status')).status, 'error');
    assert.equal(f.saved, f.previous);
  }
});
test('closing the captured source flushes and saves the audio collected so far', async () => {
  const f = fixture();
  await f.send('prepare', { pad: f.previous });
  await f.send('start', { streamId: 'tab-test' });
  f.tracks[0].onended();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.send('status')).status, 'ready');
  assert.equal(f.saved.end, 1 / 48000);
});

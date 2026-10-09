import test from 'node:test';
import assert from 'node:assert/strict';
import { PadEngine } from '../engine.js';
import { emptyPad } from '../model.js';

// Keep scheduling tests deterministic: inspect audible node routing and start
// times rather than measuring wall time on a potentially overloaded machine.
class Param {
  constructor() {
    this.value = 1;
    this.calls = [];
  }
  setValueAtTime(value, at) {
    this.value = value;
    this.calls.push(['set', value, at]);
  }
  linearRampToValueAtTime(value, at) {
    this.calls.push(['ramp', value, at]);
  }
  setTargetAtTime(value, at) {
    this.value = value;
    this.calls.push(['target', value, at]);
  }
  cancelScheduledValues(at) {
    this.calls.push(['cancel', at]);
  }
}
class Node {
  constructor() {
    this.connections = [];
    this.gain = new Param();
  }
  connect(target) {
    this.connections.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  start(...args) {
    this.startArgs = args;
  }
  stop(at) {
    this.stopAt = at;
  }
}
function engineFixture() {
  const sources = [],
    engine = new PadEngine();
  engine.context = {
    currentTime: 12.5,
    state: 'running',
    sampleRate: 48000,
    createBufferSource() {
      const node = new Node();
      sources.push(node);
      return node;
    },
    createGain() {
      return new Node();
    },
  };
  engine.master = new Node();
  const buffer = { duration: 1.5, sampleRate: 48000 };
  for (let i = 0; i < 3; i++) {
    const pad = { ...emptyPad(0, i), start: 0.15, end: 0.8, volume: 0.7 };
    engine.pads.set(pad.id, pad);
    engine.buffers.set(pad.id, buffer);
  }
  return { engine, sources, buffer };
}
test('rapid pad hits schedule immediately from cached buffers, with no file or IPC work', () => {
  const { engine, sources, buffer } = engineFixture();
  for (let i = 0; i < 100; i++) assert.equal(engine.trigger(`0:${i % 3}`), true);
  assert.equal(sources.length, 100);
  for (const source of sources) {
    assert.equal(source.buffer, buffer);
    assert.deepEqual(source.startArgs, [12.5, 0.15, 0.65]);
    assert.equal(source.connections[0].connections[0], engine.master);
  }
  assert.equal(sources[0].stopAt, 12.505);
  assert.equal(engine.voices.size, 3, 'retriggering must not accumulate active voices');
});
test('layer mode preserves other pads, while cut mode stops them on the next hit', () => {
  const { engine, sources } = engineFixture();
  engine.trigger('0:0');
  engine.trigger('0:1');
  assert.equal(sources[0].stopAt, undefined);
  engine.mode = 'cut';
  engine.trigger('0:2');
  assert.equal(sources[0].stopAt, 12.505);
  assert.equal(sources[1].stopAt, 12.505);
  assert.equal(sources[2].stopAt, undefined);
});
test('a looping pad toggles off on its second trigger, using the selected trim boundaries', () => {
  const { engine, sources } = engineFixture();
  engine.pads.get('0:0').loop = true;
  engine.trigger('0:0');
  assert.equal(sources[0].loop, true);
  assert.deepEqual(sources[0].startArgs, [12.5, 0.15]);
  assert.equal(sources[0].loopStart, 0.15);
  assert.equal(sources[0].loopEnd, 0.8);
  engine.trigger('0:0');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].stopAt, 12.505);
});
test('loading a replacement preserves metadata, stops the previous voice and uses the new sound', async () => {
  const { engine, sources } = engineFixture();
  const nextBuffer = { duration: 0.3, sampleRate: 48000 };
  engine.initialize = async () => engine;
  let decodes = 0;
  engine.context.decodeAudioData = async () => {
    decodes++;
    return nextBuffer;
  };
  engine.trigger('0:0');
  const pad = {
    ...engine.pads.get('0:0'),
    name: 'My sound',
    key: 'j',
    start: 0,
    end: 0.3,
    data: new Blob(['replacement']),
  };
  await engine.load(pad);
  engine.trigger('0:0');
  assert.equal(decodes, 1);
  assert.equal(sources[0].stopAt, 12.505);
  assert.equal(sources[1].buffer, nextBuffer);
  assert.equal(engine.pads.get('0:0').name, 'My sound');
  assert.equal(engine.pads.get('0:0').key, 'j');
});
test('session recorder receives the limited master mix and excludes browser capture and microphone inputs', async () => {
  const originalContext = globalThis.AudioContext,
    originalWorklet = globalThis.AudioWorkletNode;
  class Context {
    constructor(options) {
      this.options = options;
      this.destination = new Node();
      this.audioWorklet = { addModule: async () => {} };
    }
    createGain() {
      return new Node();
    }
    createDynamicsCompressor() {
      const node = new Node();
      for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release'])
        node[key] = new Param();
      return node;
    }
    createAnalyser() {
      return new Node();
    }
  }
  globalThis.AudioContext = Context;
  globalThis.AudioWorkletNode = class extends Node {
    constructor(context, name, options) {
      super();
      this.options = options;
      this.port = {};
    }
  };
  try {
    const engine = new PadEngine();
    await engine.initialize();
    assert.equal(engine.context.options.latencyHint, 'interactive');
    assert.deepEqual(engine.master.connections, [engine.limiter]);
    assert.ok(engine.limiter.connections.includes(engine.context.destination));
    assert.ok(engine.limiter.connections.includes(engine.recorder));
    assert.equal(engine.recorder.options.processorOptions.maxSeconds, 300);
    assert.equal(engine.recorder.options.processorOptions.autoStart, false);
  } finally {
    globalThis.AudioContext = originalContext;
    globalThis.AudioWorkletNode = originalWorklet;
  }
});

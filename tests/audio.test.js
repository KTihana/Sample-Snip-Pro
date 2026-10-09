import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { encodeWav } from '../wav.js';
import { SESSION_LIMIT, SAMPLE_LIMIT, emptyPad, assignKey, validTrim } from '../model.js';
import { demoSample, demoPad } from '../demo.js';

function worklet({ rate = 48000, limit = SESSION_LIMIT, autoStart = true } = {}) {
  const messages = [];
  let Recorder;
  vm.runInNewContext(fs.readFileSync(new URL('../pcm-worklet.js', import.meta.url), 'utf8'), {
    sampleRate: rate,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (message) => messages.push(message) };
      }
    },
    registerProcessor: (_, implementation) => {
      Recorder = implementation;
    },
  });
  return { node: new Recorder({ processorOptions: { maxSeconds: limit, autoStart } }), messages };
}
test('session recording stops at exactly five minutes of stereo PCM, including silence', () => {
  const { node, messages } = worklet();
  const left = new Float32Array(128).fill(0.25),
    right = new Float32Array(128).fill(-0.5);
  // Simulate all 14,400,000 actual audio frames, without waiting five minutes.
  for (let i = 0; i < 112510; i++) node.process([[left, right]]);
  const finished = messages.filter((message) => message.type === 'finished');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].frames, 48000 * 300);
  assert.equal(finished[0].capped, true);
  const chunks = messages
    .filter((message) => message.type === 'chunk')
    .map((message) => message.chunk);
  const wav = new DataView(encodeWav(chunks, 48000));
  assert.equal(wav.getUint32(40, true) / wav.getUint32(28, true), 300);
  assert.equal(wav.getUint16(22, true), 2);
  assert.equal(wav.getInt16(44, true), 8192);
  assert.equal(wav.getInt16(46, true), -16384);
  const silent = worklet({ rate: 10 });
  for (let i = 0; i < 24; i++) silent.node.process([]);
  assert.equal(silent.messages.at(-1).frames, 3000);
  assert.equal(
    silent.messages
      .filter((message) => message.type === 'chunk')
      .every((message) => message.chunk.every((value) => value === 0)),
    true,
  );
});
test('Stop flushes the last partial block once, and the same recorder starts a clean second take', () => {
  const { node, messages } = worklet({ autoStart: false });
  node.process([[new Float32Array([1, 2])]]);
  assert.equal(messages.length, 0);
  node.port.onmessage({ data: { type: 'start' } });
  node.process([[new Float32Array([0.1, 0.2, 0.3]), new Float32Array([0.4, 0.5, 0.6])]]);
  node.port.onmessage({ data: { type: 'stop' } });
  node.port.onmessage({ data: { type: 'stop' } });
  assert.equal(messages.filter((message) => message.type === 'finished').length, 1);
  assert.deepEqual([...messages[1].chunk], [...new Float32Array([0.1, 0.4, 0.2, 0.5, 0.3, 0.6])]);
  assert.equal(messages[2].frames, 3);
  node.port.onmessage({ data: { type: 'start' } });
  node.process([[new Float32Array([0.8])]]);
  node.port.onmessage({ data: { type: 'stop' } });
  assert.equal(messages.at(-1).frames, 1);
  assert.deepEqual([...messages.at(-2).chunk], [...new Float32Array([0.8, 0.8])]);
});
test('pad capture has a separate exact sixty-second limit', () => {
  const { node, messages } = worklet({ rate: 48000, limit: SAMPLE_LIMIT });
  for (let i = 0; i < 22510; i++) node.process([[new Float32Array(128).fill(0.2)]]);
  assert.equal(messages.at(-1).frames, 2880000);
  assert.equal(messages.at(-1).capped, true);
});
test('WAV output clips safely, sanitizes invalid samples, and rejects incomplete frames', () => {
  const data = new DataView(encodeWav([new Float32Array([-2, 2, NaN, Infinity])], 48000));
  assert.deepEqual(
    Array.from({ length: 4 }, (_, i) => data.getInt16(44 + i * 2, true)),
    [-32768, 32767, 0, 0],
  );
  assert.throws(() => encodeWav([new Float32Array(3)], 48000), /Incomplete/);
});
test('reassigning a used key swaps bindings and preserves a unique trigger for all sixteen pads', () => {
  const pads = Array.from({ length: 16 }, (_, i) => emptyPad(0, i));
  assert.equal(assignKey(pads, 0, 'W'), 1);
  assert.equal(pads[0].key, 'w');
  assert.equal(pads[1].key, 'q');
  assert.equal(new Set(pads.map((pad) => pad.key)).size, 16);
  assert.equal(assignKey(pads, 0, 'J'), -1);
  assert.equal(pads[0].key, 'j');
  assert.throws(() => assignKey(pads, 0, 'Escape'), /letter or number/);
});
test('trim bounds never allow a negative, empty, reversed, or out-of-range clip', () => {
  for (const [start, end] of [
    [-20, 200],
    [10, 0],
    [0.4, 0.2],
    [NaN, NaN],
  ]) {
    const trim = validTrim(start, end, 0.5);
    assert.ok(trim.start >= 0 && trim.start < trim.end && trim.end <= 0.5);
  }
});
test('every demo sound is real, non-silent stereo audio with a valid duration', async () => {
  for (let i = 0; i < 16; i++) {
    const sample = demoSample(i),
      wav = new DataView(await sample.data.arrayBuffer());
    assert.equal(wav.getUint16(22, true), 2);
    assert.equal(wav.getUint16(34, true), 16);
    assert.ok(Math.abs(wav.getUint32(40, true) / wav.getUint32(28, true) - sample.end) < 0.001);
    let maximum = 0;
    for (let offset = 44; offset < wav.byteLength; offset += 2)
      maximum = Math.max(maximum, Math.abs(wav.getInt16(offset, true)));
    assert.ok(maximum > 100, `${sample.name} must be audible`);
  }
});
test('demo replacement overwrites a full recorded bank, resets trim, and preserves pad controls', () => {
  const recorded = Array.from({ length: 16 }, (_, index) => ({
    ...emptyPad(2, index),
    data: new Blob(['recorded']),
    name: 'Recorded sound',
    duration: 7,
    start: 2,
    end: 6,
    loop: true,
    volume: 0.6,
  }));
  recorded[0].key = 'j';
  const replaced = recorded.map(demoPad);
  assert.equal(replaced.length, 16);
  for (let index = 0; index < 16; index++) {
    const before = recorded[index],
      after = replaced[index];
    assert.notEqual(after.data, before.data);
    assert.notEqual(after.name, before.name);
    assert.equal(after.start, 0);
    assert.equal(after.end, after.duration);
    for (const key of ['id', 'bank', 'index', 'key', 'color', 'loop', 'volume'])
      assert.equal(after[key], before[key]);
  }
  assert.equal(replaced[0].name, 'Kick');
  assert.equal(replaced[0].key, 'j');
});

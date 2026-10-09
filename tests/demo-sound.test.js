import test from 'node:test';
import assert from 'node:assert/strict';
import { demoSample } from '../demo.js';

async function decoded(index) {
  const sample = demoSample(index),
    wav = new DataView(await sample.data.arrayBuffer());
  const rate = wav.getUint32(24, true),
    frames = wav.getUint32(40, true) / 4;
  const pcm = Float32Array.from(
    { length: frames },
    (_, i) => wav.getInt16(44 + i * 4, true) / 32768,
  );
  return { name: sample.name, rate, pcm };
}
function energyBetween(sound, start, end) {
  let energy = 0;
  for (
    let i = Math.round(start * sound.rate);
    i < Math.min(sound.pcm.length, Math.round(end * sound.rate));
    i++
  )
    energy += sound.pcm[i] ** 2;
  return energy;
}
function midpoint(sound) {
  const half = sound.pcm.reduce((energy, x) => energy + x * x, 0) / 2;
  let energy = 0;
  for (let i = 0; i < sound.pcm.length; i++) {
    energy += sound.pcm[i] ** 2;
    if (energy >= half) return i / sound.rate;
  }
}
function brightness(sound) {
  let signal = 0,
    difference = 0;
  for (let i = 1; i < sound.pcm.length; i++) {
    signal += sound.pcm[i] ** 2;
    difference += (sound.pcm[i] - sound.pcm[i - 1]) ** 2;
  }
  return difference / signal;
}
test('rendered kit has full-bandwidth WAVs, headroom and quiet boundaries without clipped samples', async () => {
  for (let index = 0; index < 16; index++) {
    const sound = await decoded(index);
    assert.equal(sound.rate, 48000);
    assert.equal(sound.pcm[0], 0);
    assert.equal(sound.pcm.at(-1), 0);
    assert.ok(
      sound.pcm.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.86),
      `${sound.name} must leave mix headroom`,
    );
    assert.ok(
      energyBetween(sound, 0, sound.pcm.length / sound.rate) > 0.1,
      `${sound.name} must contain audible audio`,
    );
  }
});
test('clap has separated hand bursts, hat is bright and short, shaker has a later rattling attack', async () => {
  const [clap, hat, shaker] = await Promise.all([1, 2, 10].map(decoded));
  assert.ok(
    energyBetween(clap, 0.012, 0.017) > energyBetween(clap, 0.008, 0.011) * 1.4,
    'clap needs a second hand burst',
  );
  assert.ok(
    energyBetween(clap, 0.025, 0.03) > energyBetween(clap, 0.021, 0.024) * 1.4,
    'clap needs a third hand burst',
  );
  assert.ok(midpoint(hat) < 0.015, 'closed hat needs a quick attack and decay');
  assert.ok(midpoint(shaker) > 0.06, 'shaker needs the distributed collisions of a wrist motion');
  assert.ok(
    brightness(hat) > brightness(clap) * 2,
    'metallic hat and midrange clap must not share the same spectrum',
  );
  assert.ok(
    brightness(hat) > brightness(shaker) * 1.3,
    'shaker should be softer than the metal hat',
  );
});
test('conga and rimshot are pitched percussion; snare has wires and open hat has a longer tail', async () => {
  const [conga, rim, snare, closed, open] = await Promise.all([3, 8, 9, 2, 14].map(decoded));
  assert.ok(
    brightness(snare) > brightness(conga) * 10,
    'snare wires must be spectrally separate from the conga body',
  );
  assert.ok(
    brightness(snare) > brightness(rim) * 4,
    'rimshot must be a wood hit rather than another noise burst',
  );
  assert.ok(midpoint(conga) > midpoint(rim) * 3, 'conga body must ring longer than the dry rim');
  assert.ok(
    energyBetween(open, 0.1, 0.3) > energyBetween(closed, 0.1, 0.3) * 30,
    'open hat must retain an audible cymbal tail',
  );
});

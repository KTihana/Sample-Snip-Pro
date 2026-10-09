import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEMO_SOUNDS, demoPcm, demoSample } from '../demo.js';
import { encodeWav } from '../wav.js';

const directory = new URL('../design/audio/', import.meta.url);
await mkdir(directory, { recursive: true });
const rate = 48000,
  rendered = DEMO_SOUNDS.map((_, index) => demoPcm(index));
for (let index = 0; index < rendered.length; index++) {
  const sample = demoSample(index);
  const name = `${String(index + 1).padStart(2, '0')}-${sample.name.toLowerCase().replaceAll(' ', '-')}.wav`;
  await writeFile(new URL(name, directory), Buffer.from(await sample.data.arrayBuffer()));
}
function mix(events, seconds) {
  const output = new Float32Array(Math.round(seconds * rate) * 2);
  for (const { sound, at, level = 1 } of events) {
    const { chunk } = rendered[sound],
      start = Math.round(at * rate) * 2;
    for (let i = 0; i < chunk.length && start + i < output.length; i++)
      output[start + i] += chunk[i] * level;
  }
  let maximum = 0;
  for (const value of output) maximum = Math.max(maximum, Math.abs(value));
  if (maximum > 0.9) for (let i = 0; i < output.length; i++) output[i] *= 0.9 / maximum;
  return encodeWav([output], rate);
}
const focus = [1, 2, 3, 8, 9, 10];
await writeFile(
  new URL('percussion-preview.wav', directory),
  Buffer.from(
    mix(
      focus.map((sound, i) => ({ sound, at: 0.15 + i * 1.2 })),
      7.4,
    ),
  ),
);
let cursor = 0.2;
const kit = rendered.map((sample, sound) => {
  const at = cursor;
  cursor += Math.max(0.65, sample.duration + 0.15);
  return { sound, at };
});
await writeFile(new URL('full-kit-preview.wav', directory), Buffer.from(mix(kit, cursor + 0.2)));

const beat = [],
  step = 60 / 108 / 4;
for (let bar = 0; bar < 4; bar++) {
  const at = (offset) => 0.15 + (bar * 16 + offset) * step;
  for (const offset of [0, 6, 8, 11]) beat.push({ sound: 0, at: at(offset), level: 0.8 });
  for (const offset of [4, 12])
    beat.push(
      { sound: 9, at: at(offset), level: 0.8 },
      { sound: 1, at: at(offset) + 0.012, level: 0.5 },
    );
  for (let offset = 0; offset < 16; offset += 2)
    beat.push({ sound: 2, at: at(offset), level: offset % 4 === 0 ? 0.65 : 0.4 });
  for (let offset = 1; offset < 16; offset += 2)
    beat.push({ sound: 10, at: at(offset), level: 0.5 });
  for (const offset of [7, 15]) beat.push({ sound: 3, at: at(offset), level: 0.45 });
  beat.push({ sound: 8, at: at(10), level: 0.35 }, { sound: 11, at: at(14), level: 0.25 });
  beat.push({ sound: 4, at: at(0), level: 0.48 }, { sound: 4, at: at(8), level: 0.35 });
  beat.push({ sound: 5, at: at(2), level: 0.4 }, { sound: 6, at: at(10), level: 0.2 });
  if (bar === 3)
    beat.push({ sound: 7, at: at(14), level: 0.6 }, { sound: 15, at: at(12), level: 0.45 });
}
await writeFile(
  new URL('kit-groove.wav', directory),
  Buffer.from(mix(beat, 0.15 + 64 * step + 1.5)),
);
console.log(
  `Rendered ${rendered.length} one-shots, percussion/full-kit previews and a groove to ${fileURLToPath(directory)}`,
);

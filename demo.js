import { encodeWav } from './wav.js';

const RATE = 48000;
const TAU = 2 * Math.PI;
// Original synthesized one-shots, with separate instrument models and no external audio.
export const DEMO_SOUNDS = [
  { name: 'Kick', duration: 0.55, peak: 0.85 },
  { name: 'Clap', duration: 0.32, peak: 0.72 },
  { name: 'Closed hat', duration: 0.15, peak: 0.48 },
  { name: 'Conga', duration: 0.38, peak: 0.72 },
  { name: 'Sub bass', duration: 0.9, peak: 0.78 },
  { name: 'EP keys', duration: 1.4, peak: 0.6 },
  { name: 'Soft chord', duration: 1.5, peak: 0.58 },
  { name: 'Low tom', duration: 0.65, peak: 0.78 },
  { name: 'Rimshot', duration: 0.12, peak: 0.66 },
  { name: 'Snare', duration: 0.36, peak: 0.78 },
  { name: 'Shaker', duration: 0.24, peak: 0.42 },
  { name: 'Cowbell', duration: 0.4, peak: 0.55 },
  { name: 'Warm pad', duration: 2, peak: 0.5 },
  { name: 'Pluck', duration: 0.85, peak: 0.64 },
  { name: 'Open hat', duration: 0.7, peak: 0.46 },
  { name: 'Tambourine', duration: 0.42, peak: 0.46 },
];

function random(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 1073741823.5 - 1;
  };
}
function signal(frames, fn) {
  return Float32Array.from({ length: frames }, (_, i) => fn(i / RATE, i));
}
function noise(frames, seed) {
  const next = random(seed);
  return signal(frames, () => next());
}
function filter(input, type, frequency, q = 0.707) {
  // RBJ biquad: filtering changes each noise instrument's spectrum, not just its label.
  const w = (TAU * frequency) / RATE,
    cosine = Math.cos(w),
    alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha,
    a1 = (-2 * cosine) / a0,
    a2 = (1 - alpha) / a0;
  const coefficients =
    type === 'highpass'
      ? [(1 + cosine) / 2, -(1 + cosine), (1 + cosine) / 2]
      : type === 'bandpass'
        ? [alpha, 0, -alpha]
        : [(1 - cosine) / 2, 1 - cosine, (1 - cosine) / 2];
  const [b0, b1, b2] = coefficients.map((value) => value / a0);
  const output = new Float32Array(input.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i],
      y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return output;
}
function burst(t, start, attack, decay) {
  const age = t - start;
  return age < 0 ? 0 : (1 - Math.exp(-age / attack)) * Math.exp(-age / decay);
}
function modes(t, frequencies, decays, amplitudes) {
  return frequencies.reduce(
    (sum, hz, i) => sum + Math.sin(TAU * hz * t) * Math.exp(-t / decays[i]) * amplitudes[i],
    0,
  );
}
function fallingPhase(t, floor, sweep, seconds) {
  // Integrate the pitch envelope so pitch drops are smooth and phase-continuous.
  return TAU * (floor * t + sweep * seconds * (1 - Math.exp(-t / seconds)));
}
function hat(frames, open) {
  // Six unrelated metal oscillators plus a band of air: cymbal-like, not a shaker.
  const frequencies = [401, 557, 811, 1133, 1721, 2411];
  const metal = signal(
    frames,
    (t) => frequencies.reduce((sum, hz) => sum + Math.tanh(7 * Math.sin(TAU * hz * t)), 0) / 6,
  );
  const bright = filter(filter(metal, 'highpass', 6800), 'lowpass', 14500);
  const air = filter(noise(frames, 5801), 'highpass', 8500);
  return signal(
    frames,
    (t, i) =>
      (bright[i] * 1.8 + air[i] * 0.13) *
      (open ? 0.72 * Math.exp(-t / 0.13) + 0.28 * Math.exp(-t / 0.26) : Math.exp(-t / 0.023)),
  );
}
function renderDrum(index, frames) {
  const raw = noise(frames, 8009 + index * 197);
  if (index === 0) {
    const beater = filter(raw, 'bandpass', 2400, 0.8);
    return signal(
      frames,
      (t, i) =>
        Math.tanh(1.3 * Math.sin(fallingPhase(t, 49, 125, 0.014))) * Math.exp(-t / 0.13) +
        0.21 * beater[i] * Math.exp(-t / 0.006),
    );
  }
  if (index === 1) {
    const hands = filter(filter(raw, 'highpass', 850), 'lowpass', 5300);
    const body = filter(raw, 'bandpass', 1700, 0.9);
    return signal(
      frames,
      (t, i) =>
        (hands[i] * 0.8 + body[i] * 0.35) *
        (burst(t, 0, 0.0004, 0.005) +
          0.85 * burst(t, 0.011, 0.0004, 0.005) +
          0.72 * burst(t, 0.024, 0.0005, 0.006) +
          0.38 * burst(t, 0.036, 0.001, 0.055)),
    );
  }
  if (index === 2 || index === 14) return hat(frames, index === 14);
  if (index === 3) {
    const slap = filter(raw, 'bandpass', 1100, 0.9);
    return signal(
      frames,
      (t, i) =>
        0.75 * Math.sin(fallingPhase(t, 190, 80, 0.01)) * Math.exp(-t / 0.09) +
        modes(t, [328, 476, 627], [0.055, 0.035, 0.02], [0.28, 0.16, 0.1]) +
        0.18 * slap[i] * Math.exp(-t / 0.005),
    );
  }
  if (index === 7) {
    const skin = filter(raw, 'lowpass', 1900);
    return signal(
      frames,
      (t, i) =>
        0.9 * Math.sin(fallingPhase(t, 96, 65, 0.025)) * Math.exp(-t / 0.15) +
        modes(t, [157, 221, 307], [0.09, 0.07, 0.038], [0.23, 0.14, 0.08]) +
        0.1 * skin[i] * Math.exp(-t / 0.012),
    );
  }
  if (index === 8) {
    // A stick against the rim: short tuned wood resonances, almost no noise tail.
    const stick = filter(raw, 'bandpass', 3300, 1.1);
    return signal(
      frames,
      (t, i) =>
        modes(t, [480, 850, 1760, 2950], [0.016, 0.01, 0.007, 0.004], [0.72, 0.4, 0.25, 0.1]) +
        0.08 * stick[i] * Math.exp(-t / 0.002),
    );
  }
  if (index === 9) {
    const wires = filter(filter(raw, 'highpass', 1800), 'lowpass', 10500);
    return signal(
      frames,
      (t, i) =>
        0.5 * Math.sin(fallingPhase(t, 180, 45, 0.01)) * Math.exp(-t / 0.036) +
        0.22 * Math.sin(TAU * 330 * t) * Math.exp(-t / 0.022) +
        0.7 * wires[i] * burst(t, 0, 0.0006, 0.05),
    );
  }
  if (index === 10) {
    // Individual seeds colliding in a single wrist motion: rounded, irregular grains.
    const sand = filter(filter(raw, 'highpass', 3200), 'lowpass', 9200);
    const next = random(4229),
      grains = [];
    for (let start = 0.003; start < 0.17; start += 0.006 + (next() + 1) * 0.002) {
      grains.push({ start, gain: 0.4 + (next() + 1) * 0.25, decay: 0.003 + (next() + 1) * 0.001 });
    }
    return signal(frames, (t, i) => {
      const motion = Math.sin(Math.PI * Math.min(t / 0.19, 1)) ** 1.4;
      const envelope = grains.reduce(
        (sum, grain) => sum + grain.gain * burst(t, grain.start, 0.0012, grain.decay),
        0,
      );
      return sand[i] * motion * envelope;
    });
  }
  if (index === 11) {
    const shell = filter(
      signal(
        frames,
        (t) =>
          0.6 * Math.tanh(6 * Math.sin(TAU * 540 * t)) +
          0.4 * Math.tanh(6 * Math.sin(TAU * 800 * t)),
      ),
      'bandpass',
      900,
      0.65,
    );
    return signal(
      frames,
      (t, i) => shell[i] * (0.65 * Math.exp(-t / 0.034) + 0.35 * Math.exp(-t / 0.095)),
    );
  }
  if (index === 15) {
    const jingles = [2300, 3187, 4213, 5791, 7319, 9173];
    const rattle = filter(raw, 'highpass', 5400);
    return signal(frames, (t, i) => {
      const metal = modes(
        t,
        jingles,
        [0.09, 0.11, 0.13, 0.1, 0.085, 0.075],
        [0.24, 0.2, 0.2, 0.16, 0.12, 0.08],
      );
      return (
        metal * (0.55 + 0.45 * Math.sin(TAU * 31 * t) ** 2) +
        0.18 * rattle[i] * Math.exp(-t / 0.055)
      );
    });
  }
  return null;
}
function renderTone(index, frames, duration) {
  // Bass, keys and pluck share A minor so they can be played together.
  if (index === 4)
    return signal(
      frames,
      (t) =>
        (Math.sin(TAU * 55 * t) + 0.18 * Math.sin(TAU * 110 * t) * Math.exp(-t / 0.12)) *
        (1 - Math.exp(-t / 0.008)) *
        Math.exp(-t / 0.28),
    );
  if (index === 5)
    return signal(
      frames,
      (t) =>
        [220, 261.6256, 329.6276].reduce(
          (sum, hz) =>
            sum +
            Math.sin(TAU * hz * t + 1.1 * Math.exp(-t / 0.12) * Math.sin(TAU * hz * 3.997 * t)) *
              Math.exp(-t / 0.38) +
            0.18 * Math.sin(TAU * hz * 2 * t) * Math.exp(-t / 0.14),
          0,
        ) *
        (1 - Math.exp(-t / 0.002)),
    );
  if (index === 6)
    return signal(
      frames,
      (t) =>
        [220, 261.6256, 329.6276].reduce((sum, hz, voice) => {
          const pitch = hz * (1 + (voice - 1) * 0.0015);
          return [1, 2, 3, 4].reduce(
            (partial, harmonic) =>
              partial +
              (Math.sin(TAU * pitch * harmonic * t) * Math.exp((-t * harmonic) / 0.55)) /
                harmonic ** 1.4,
            0,
          );
        }, 0) *
        (1 - Math.exp(-t / 0.012)),
    );
  if (index === 12)
    return signal(frames, (t) => {
      const swell = Math.sin((Math.PI * t) / duration) ** 1.5;
      return (
        [110, 130.8128, 164.8138].reduce(
          (sum, hz) =>
            sum +
            Math.sin(TAU * hz * 0.998 * t) +
            Math.sin(TAU * hz * 1.002 * t) +
            0.25 * Math.sin(TAU * hz * 2 * t),
          0,
        ) * swell
      );
    });
  if (index === 13) {
    // Karplus–Strong string: an excited delay line whose overtones decay separately.
    const length = Math.round(RATE / 440 - 0.5),
      next = random(6011);
    const string = Float32Array.from({ length }, () => next());
    return signal(frames, (_, i) => {
      const position = i % length,
        value = string[position];
      string[position] = 0.996 * 0.5 * (value + string[(position + 1) % length]);
      return value;
    });
  }
  throw new Error('Unknown demo sound.');
}
export function demoPcm(index) {
  const definition = DEMO_SOUNDS[index];
  if (!definition) throw new Error('Choose a demo pad from 1 to 16.');
  const frames = Math.round(RATE * definition.duration);
  const mono = renderDrum(index, frames) || renderTone(index, frames, definition.duration);
  // Remove DC, taper both edges and balance levels without driving the mix into clipping.
  let dc = 0;
  for (const value of mono) dc += value / frames;
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const fadeIn = Math.min(1, i / (RATE * 0.0003));
    const fadeOut = Math.min(1, (frames - 1 - i) / (RATE * 0.018));
    mono[i] = (mono[i] - dc) * fadeIn * fadeOut;
    peak = Math.max(peak, Math.abs(mono[i]));
  }
  const gain = definition.peak / Math.max(peak, 1e-6),
    chunk = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) chunk[i * 2] = chunk[i * 2 + 1] = mono[i] * gain;
  return { chunk, rate: RATE, duration: definition.duration };
}
export function demoSample(index) {
  const { chunk, rate, duration } = demoPcm(index);
  return {
    name: DEMO_SOUNDS[index].name,
    data: new Blob([encodeWav([chunk], rate)], { type: 'audio/wav' }),
    start: 0,
    end: duration,
  };
}
export function demoPad(pad) {
  const sample = demoSample(pad.index);
  return { ...pad, ...sample, duration: sample.end, updatedAt: Date.now() };
}

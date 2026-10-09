const peaks = new WeakMap();

function getPeaks(buffer) {
  if (peaks.has(buffer)) return peaks.get(buffer);
  const data = buffer.getChannelData(0),
    values = new Float32Array(96);
  for (let i = 0; i < values.length; i++) {
    const start = Math.floor((i * data.length) / values.length),
      end = Math.floor(((i + 1) * data.length) / values.length);
    let peak = 0;
    for (let frame = start; frame < end; frame += Math.max(1, Math.floor((end - start) / 250)))
      peak = Math.max(peak, Math.abs(data[frame]));
    values[i] = peak;
  }
  peaks.set(buffer, values);
  return values;
}
export function drawWaveform(canvas, buffer, pad, editor = false) {
  const rect = canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  if (!rect.width || !rect.height) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  if (!buffer) return;
  const width = rect.width,
    height = rect.height;
  const style = getComputedStyle(document.documentElement),
    color = style.getPropertyValue(`--${pad.color}`).trim();
  const values = getPeaks(buffer),
    maximum = Math.max(0.08, ...values);
  const spacing = width / values.length;
  ctx.fillStyle = color;
  for (let i = 0; i < values.length; i++) {
    const h = Math.max(1, (values[i] / maximum) * (height - (editor ? 20 : 4)));
    ctx.globalAlpha = 0.55 + (values[i] / maximum) * 0.45;
    ctx.fillRect(i * spacing, (height - h) / 2, Math.max(1, spacing * 0.6), h);
  }
  ctx.globalAlpha = 1;
  if (editor) {
    const start = (pad.start / buffer.duration) * width,
      end = (pad.end / buffer.duration) * width;
    ctx.fillStyle = style.getPropertyValue('--bg').trim();
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, start, height);
    ctx.fillRect(end, 0, width - end, height);
    ctx.globalAlpha = 1;
  }
}

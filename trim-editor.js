import { validTrim, time } from './model.js';

// One pointer gesture changes the preview live and saves once on release.
export function createTrimmer({
  area,
  startHandle,
  endHandle,
  selection,
  read,
  onChange,
  onCommit,
}) {
  let drag;
  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  function render() {
    const state = read(),
      pad = state.pad,
      duration = state.duration || 0;
    const disabled = state.disabled || !duration;
    area.classList.toggle('disabled', disabled);
    selection.hidden = disabled;
    for (const [handle, value, low, high] of [
      [startHandle, pad?.start || 0, 0, Math.max(0, (pad?.end || 0) - Math.min(0.01, duration))],
      [endHandle, pad?.end || 0, (pad?.start || 0) + Math.min(0.01, duration), duration],
    ]) {
      handle.disabled = disabled;
      handle.hidden = !duration;
      handle.style.left = `${duration ? (value / duration) * 100 : 0}%`;
      handle.setAttribute('aria-valuemin', String(low));
      handle.setAttribute('aria-valuemax', String(high));
      handle.setAttribute('aria-valuenow', String(value));
      handle.setAttribute('aria-valuetext', time(value, true));
    }
    selection.style.left = `${duration ? (pad.start / duration) * 100 : 0}%`;
    selection.style.width = `${duration ? ((pad.end - pad.start) / duration) * 100 : 0}%`;
  }
  function apply(pad, trim) {
    Object.assign(pad, trim);
    onChange(pad);
    render();
  }
  function edgeTrim(edge, value, pad, duration) {
    const gap = Math.min(0.01, duration);
    return edge === 'start'
      ? validTrim(clamp(value, 0, pad.end - gap), pad.end, duration)
      : validTrim(pad.start, clamp(value, pad.start + gap, duration), duration);
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const state = read();
    if (state.disabled || state.pad !== drag.pad) {
      finish(event, true);
      return;
    }
    const seconds = ((event.clientX - drag.rect.left) / drag.rect.width) * drag.duration;
    let trim;
    if (drag.edge === 'region') {
      const length = drag.original.end - drag.original.start;
      const start = clamp(drag.original.start + seconds - drag.anchor, 0, drag.duration - length);
      trim = { start, end: start + length };
    } else trim = edgeTrim(drag.edge, seconds, drag.pad, drag.duration);
    event.preventDefault();
    apply(drag.pad, trim);
  }
  function finish(event, cancel = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const ended = drag;
    drag = undefined;
    area.classList.remove('dragging');
    if (cancel) apply(ended.pad, ended.original);
    else onCommit(ended.pad);
    if (area.hasPointerCapture(ended.pointerId)) area.releasePointerCapture(ended.pointerId);
  }
  area.addEventListener('pointerdown', (event) => {
    const state = read(),
      rect = area.getBoundingClientRect();
    if (event.button !== 0 || state.disabled || !state.duration || !rect.width || drag) return;
    const seconds = clamp(
      ((event.clientX - rect.left) / rect.width) * state.duration,
      0,
      state.duration,
    );
    const pad = state.pad;
    const edge =
      event.target === startHandle || startHandle.contains(event.target)
        ? 'start'
        : event.target === endHandle || endHandle.contains(event.target)
          ? 'end'
          : seconds > pad.start && seconds < pad.end
            ? 'region'
            : Math.abs(seconds - pad.start) <= Math.abs(seconds - pad.end)
              ? 'start'
              : 'end';
    drag = {
      pointerId: event.pointerId,
      rect,
      duration: state.duration,
      pad,
      edge,
      anchor: seconds,
      original: { start: pad.start, end: pad.end },
    };
    area.setPointerCapture(event.pointerId);
    area.classList.add('dragging');
    event.preventDefault();
    if (edge !== 'region') {
      (edge === 'start' ? startHandle : endHandle).focus({ preventScroll: true });
      move(event);
    }
  });
  area.addEventListener('pointermove', move);
  area.addEventListener('pointerup', (event) => finish(event));
  area.addEventListener('pointercancel', (event) => finish(event, true));
  area.addEventListener('lostpointercapture', (event) => finish(event));
  for (const [handle, edge] of [
    [startHandle, 'start'],
    [endHandle, 'end'],
  ]) {
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const state = read();
      if (state.disabled || !state.duration || drag) return;
      const pad = state.pad,
        step = event.shiftKey ? 0.1 : 0.01;
      const value =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? state.duration
            : pad[edge] + (event.key === 'ArrowLeft' ? -step : step);
      apply(pad, edgeTrim(edge, value, pad, state.duration));
      onCommit(pad);
    });
  }
  return { render };
}

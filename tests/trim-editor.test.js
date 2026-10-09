import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrimmer } from '../trim-editor.js';

function fixture({ start = 0, end = 10, disabled = false } = {}) {
  function element() {
    return {
      style: {},
      attributes: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      addEventListener(type, callback) {
        this[type] = callback;
      },
      contains: () => false,
      focus() {},
    };
  }
  const area = element(),
    startHandle = element(),
    endHandle = element(),
    selection = element();
  const pad = { start, end },
    state = { pad, duration: 10, disabled },
    commits = [];
  const captured = new Set();
  area.getBoundingClientRect = () => ({ left: 20, width: 200 });
  area.setPointerCapture = (id) => captured.add(id);
  area.hasPointerCapture = (id) => captured.has(id);
  area.releasePointerCapture = (id) => {
    captured.delete(id);
    area.lostpointercapture({ pointerId: id });
  };
  const trimmer = createTrimmer({
    area,
    startHandle,
    endHandle,
    selection,
    read: () => state,
    onChange() {},
    onCommit: (value) => commits.push({ ...value }),
  });
  trimmer.render();
  function pointer(type, target, clientX, pointerId = 1) {
    area[type]({ target, clientX, pointerId, button: 0, preventDefault() {} });
  }
  return { pad, state, area, startHandle, endHandle, selection, commits, pointer, trimmer };
}
test('dragging trim edges updates bounds live, prevents crossing, and saves once on release', () => {
  const f = fixture();
  f.pointer('pointerdown', f.startHandle, 20);
  f.pointer('pointermove', f.startHandle, 60);
  assert.equal(f.pad.start, 2);
  assert.equal(f.commits.length, 0);
  f.pointer('pointerup', f.startHandle, 60);
  assert.equal(f.commits.length, 1);
  f.pointer('pointerdown', f.endHandle, 220);
  f.pointer('pointermove', f.endHandle, 180);
  f.pointer('pointerup', f.endHandle, 180);
  assert.equal(f.pad.end, 8);
  f.pointer('pointerdown', f.startHandle, 60);
  f.pointer('pointermove', f.startHandle, 500);
  f.pointer('pointerup', f.startHandle, 500);
  assert.ok(f.pad.start < f.pad.end);
  assert.ok(Math.abs(f.pad.end - f.pad.start - 0.01) < 1e-8);
  assert.equal(f.commits.length, 3);
  assert.equal(f.startHandle.attributes['aria-valuenow'], String(f.pad.start));
});
test('moving the selection keeps its length and clamps it to both ends of the sound', () => {
  const f = fixture({ start: 2, end: 8 });
  f.pointer('pointerdown', f.area, 100);
  f.pointer('pointermove', f.area, 500);
  assert.deepEqual(f.pad, { start: 4, end: 10 });
  f.pointer('pointermove', f.area, -100);
  assert.deepEqual(f.pad, { start: 0, end: 6 });
  f.pointer('pointerup', f.area, -100);
  assert.equal(f.commits.length, 1);
});
test('cancelled touches restore the original trim and never save partial edits', () => {
  const f = fixture({ start: 2, end: 8 });
  f.pointer('pointerdown', f.startHandle, 60);
  f.pointer('pointermove', f.startHandle, 100);
  assert.equal(f.pad.start, 4);
  f.pointer('pointercancel', f.startHandle, 100);
  assert.deepEqual(f.pad, { start: 2, end: 8 });
  assert.equal(f.commits.length, 0);
});
test('disabled recording pads reject dragging, and keyboard handles use the same safe bounds', () => {
  const f = fixture({ disabled: true });
  f.pointer('pointerdown', f.startHandle, 20);
  f.pointer('pointermove', f.startHandle, 100);
  f.pointer('pointerup', f.startHandle, 100);
  assert.equal(f.pad.start, 0);
  assert.equal(f.commits.length, 0);
  f.state.disabled = false;
  f.trimmer.render();
  f.startHandle.keydown({
    key: 'ArrowRight',
    shiftKey: true,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(f.pad.start, 0.1);
  f.endHandle.keydown({ key: 'Home', preventDefault() {}, stopPropagation() {} });
  assert.ok(f.pad.end > f.pad.start && f.pad.end <= 10);
  assert.equal(f.commits.length, 2);
});

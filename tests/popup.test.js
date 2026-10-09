import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function popup({ rejectOpen = false } = {}) {
  const elements = new Map(),
    events = [];
  let gesture = false;
  for (const id of ['theme', 'open-pads', 'popup-error', 'popup-hint']) {
    elements.set(id, {
      disabled: true,
      hidden: true,
      setAttribute() {},
      addEventListener(type, callback) {
        this[type] = callback;
      },
    });
  }
  const chrome = {
    runtime: {
      id: 'pro-test',
      async sendMessage(message) {
        events.push(message.type);
        return { windowId: 3, source: { id: 72, title: 'My audio tab' } };
      },
    },
    sidePanel: {
      open(options) {
        assert.ok(gesture, 'open must be called synchronously in the popup button gesture');
        events.push(['open', options.windowId]);
        return rejectOpen ? Promise.reject(new Error('Panel unavailable')) : Promise.resolve();
      },
    },
  };
  const storage = new Map();
  vm.runInNewContext(fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8'), {
    chrome,
    document: { getElementById: (id) => elements.get(id), documentElement: { dataset: {} } },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    window: { close: () => events.push('close') },
  });
  return {
    elements,
    events,
    click() {
      gesture = true;
      elements.get('open-pads').click();
      gesture = false;
    },
  };
}
test('toolbar popup opens persistent pads in the click gesture and closes only after success', async () => {
  const f = popup();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.events[0], 'choose-source');
  assert.equal(f.elements.get('open-pads').disabled, false);
  f.click();
  assert.equal(f.events.at(-1)[0], 'open');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.events.at(-1), 'close');
});
test('a failed panel open keeps the popup available for retry and shows the error', async () => {
  const f = popup({ rejectOpen: true });
  await new Promise((resolve) => setImmediate(resolve));
  f.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.events.includes('close'), false);
  assert.equal(f.elements.get('open-pads').disabled, false);
  assert.equal(f.elements.get('popup-error').hidden, false);
  assert.equal(f.elements.get('popup-error').textContent, 'Panel unavailable');
});

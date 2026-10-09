import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function background({
  rejectCapture = false,
  tab = { id: 72, windowId: 3, url: 'https://example.com/audio', title: 'My source' },
} = {}) {
  let clicked,
    messageHandler,
    gesture = false,
    offscreen = false;
  const memory = {},
    events = [];
  const chrome = {
    tabs: {
      query: async (options) => {
        events.push(['query', options]);
        return [tab];
      },
    },
    action: {
      onClicked: {
        addListener: (callback) => {
          clicked = callback;
        },
      },
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    sidePanel: {
      open(options) {
        assert.ok(gesture, 'panel must open before the toolbar user gesture expires');
        events.push(['panel', options]);
        return Promise.resolve();
      },
    },
    storage: {
      session: {
        async set(value) {
          Object.assign(memory, value);
        },
        async get(key) {
          return { [key]: memory[key] };
        },
      },
    },
    offscreen: {
      async createDocument() {
        offscreen = true;
        events.push(['offscreen']);
      },
    },
    tabCapture: {
      async getMediaStreamId(options) {
        events.push(['tab-capture', options]);
        if (rejectCapture) throw new Error('Permission expired');
        return 'source-stream';
      },
    },
    runtime: {
      id: 'pro-test',
      onMessage: {
        addListener: (callback) => {
          messageHandler = callback;
        },
      },
      getURL: (path) => `chrome-extension://pro-test/${path}`,
      async getContexts() {
        return offscreen ? [{}] : [];
      },
      async sendMessage(message) {
        events.push(['message', message]);
        if (message.type === 'status') return { status: 'idle' };
        if (message.type === 'prepare') return { status: 'starting' };
        if (message.type === 'start') return { status: 'recording' };
        if (message.type === 'error') return { status: 'error', error: message.error };
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8'), {
    chrome,
    console,
  });
  return {
    events,
    memory,
    click(tab) {
      gesture = true;
      clicked(tab);
      gesture = false;
    },
    send(type, extra = {}, url = 'chrome-extension://pro-test/popup.html') {
      return new Promise((resolve) =>
        messageHandler({ target: 'background', type, ...extra }, { id: 'pro-test', url }, resolve),
      );
    },
  };
}
test('toolbar fallback opens beside the browser in the click gesture and selects that exact tab', async () => {
  const f = background();
  f.click({ id: 72, windowId: 3, url: 'https://example.com/audio', title: 'My source' });
  assert.equal(f.events[0][0], 'panel');
  assert.equal(f.events[0][1].windowId, 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.memory.source.id, 72);
  const updated = f.events.find((event) => event[1]?.type === 'source-change');
  assert.equal(updated[1].source.id, 72);
  assert.equal(updated[1].target, 'studio');
});
test('the toolbar popup selects and broadcasts the active tab before capture', async () => {
  const f = background();
  const chosen = await f.send('choose-source');
  assert.equal(chosen.windowId, 3);
  assert.equal(chosen.source.id, 72);
  assert.equal(f.memory.source.id, 72);
  const state = await f.send('start', { pad: { id: '0:2', index: 2 } });
  assert.equal(state.status, 'recording');
  assert.equal(f.events.find((event) => event[0] === 'tab-capture')[1].targetTabId, 72);
  assert.equal(f.events.find((event) => event[1]?.type === 'source-change')[1].source.id, 72);
});
test('the popup clears stale sources on internal pages and other extension pages cannot choose sources', async () => {
  const f = background({ tab: { id: 90, windowId: 3, url: 'chrome://extensions' } });
  f.memory.source = { id: 72, title: 'Old source' };
  const chosen = await f.send('choose-source');
  assert.equal(chosen.source, null);
  assert.equal(f.memory.source, null);
  const state = await f.send('start', { pad: { id: '0:2' } });
  assert.equal(state.status, 'error');
  assert.equal(
    f.events.some((event) => event[0] === 'tab-capture'),
    false,
  );
  const denied = await f.send('choose-source', {}, 'chrome-extension://pro-test/studio.html');
  assert.equal(denied.status, 'error');
  assert.match(denied.error, /toolbar/);
});
test('Record sound obtains audio from the selected webpage and passes it to the background recorder', async () => {
  const f = background();
  f.click({ id: 72, windowId: 3, url: 'https://example.com/audio' });
  await new Promise((resolve) => setImmediate(resolve));
  const state = await f.send('start', { pad: { id: '0:2', index: 2 } });
  assert.equal(state.status, 'recording');
  assert.equal(f.events.find((event) => event[0] === 'tab-capture')[1].targetTabId, 72);
  const start = f.events.find((event) => event[1]?.type === 'start');
  assert.equal(start[1].target, 'recorder');
  assert.equal(start[1].streamId, 'source-stream');
  const prepare = f.events.find((event) => event[1]?.type === 'prepare');
  assert.equal(prepare[1].pad.id, '0:2');
});
test('expired browser permission produces a retryable error instead of a false recording state', async () => {
  const f = background({ rejectCapture: true });
  f.click({ id: 72, windowId: 3, url: 'https://example.com/audio' });
  await new Promise((resolve) => setImmediate(resolve));
  const state = await f.send('start', { pad: { id: '0:2', index: 2 } });
  assert.equal(state.status, 'error');
  assert.match(state.error, /Click the extension again/);
  assert.equal(
    f.events.some((event) => event[1]?.type === 'start'),
    false,
  );
});
test('Record sound uses the active webpage without requiring a saved source or capturing a stale tab', async () => {
  for (const stale of [undefined, { id: 41, title: 'Old tab' }]) {
    const f = background({
      tab: { id: 82, windowId: 3, url: 'https://example.com/music', title: 'Current music' },
    });
    f.memory.source = stale;
    const state = await f.send('start', { pad: { id: '0:2', index: 2 } });
    assert.equal(state.status, 'recording');
    assert.equal(f.events.find((event) => event[0] === 'tab-capture')[1].targetTabId, 82);
    assert.equal(f.memory.source.id, 82);
    assert.equal(f.events.find((event) => event[1]?.type === 'prepare')[1].pad.id, '0:2');
  }
});

let creating,
  starting = false;
async function ensureRecorder() {
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) return;
  if (!creating)
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA', 'BLOBS'],
        justification: 'Record a user-selected browser tab into a locally saved sample pad.',
      })
      .finally(() => {
        creating = undefined;
      });
  await creating;
}
chrome.action.onClicked.addListener((tab) => {
  const source =
    tab.id && /^https?:|^file:/.test(tab.url || '')
      ? { id: tab.id, title: tab.title || 'Browser tab' }
      : null;
  // open() must run directly in the toolbar-click gesture, before any await.
  const shown = chrome.sidePanel.open({ windowId: tab.windowId });
  const stored = source ? chrome.storage.session.set({ source }) : Promise.resolve();
  void Promise.all([shown, stored])
    .then(() => {
      if (source)
        return chrome.runtime
          .sendMessage({ target: 'studio', type: 'source-change', source })
          .catch(() => {});
    })
    .catch((error) => console.error('Could not open Sample Snip Pro:', error.message));
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'background') return;
  (async () => {
    if (message.type === 'choose-source') {
      if (sender.url !== chrome.runtime.getURL('popup.html'))
        throw new Error('Open Pro from the browser toolbar to choose a source.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.windowId) throw new Error('Choose a browser window first.');
      const source =
        tab.id && /^https?:|^file:/.test(tab.url || '')
          ? { id: tab.id, title: tab.title || 'Browser tab' }
          : null;
      await chrome.storage.session.set({ source });
      await chrome.runtime
        .sendMessage({ target: 'studio', type: 'source-change', source })
        .catch(() => {});
      return { source, windowId: tab.windowId };
    }
    if (message.type === 'source')
      return (await chrome.storage.session.get('source')).source || null;
    if (message.type === 'state-change') {
      await chrome.action.setBadgeText({
        text: ['starting', 'recording', 'stopping'].includes(message.status) ? 'REC' : '',
      });
      await chrome.action.setBadgeBackgroundColor({ color: '#ed657e' });
      return { ok: true };
    }
    if (message.type === 'status') {
      if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length)
        return { status: 'idle' };
    } else await ensureRecorder();
    if (message.type === 'start') {
      const state = await chrome.runtime.sendMessage({ target: 'recorder', type: 'status' });
      if (starting || ['starting', 'recording', 'stopping'].includes(state.status)) return state;
      starting = true;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !/^https?:|^file:/.test(tab.url || ''))
          throw new Error('Open a webpage with audio and click Pro on that tab first.');
        const source = { id: tab.id, title: tab.title || 'Browser tab' };
        await chrome.storage.session.set({ source });
        await chrome.runtime.sendMessage({ target: 'recorder', type: 'prepare', pad: message.pad });
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: source.id });
        return await chrome.runtime.sendMessage({ target: 'recorder', type: 'start', streamId });
      } catch (error) {
        return await chrome.runtime.sendMessage({
          target: 'recorder',
          type: 'error',
          error: `${error.message} Click the extension again on your source tab to retry.`,
        });
      } finally {
        starting = false;
      }
    }
    return chrome.runtime.sendMessage({ ...message, target: 'recorder' });
  })()
    .then(reply)
    .catch((error) => reply({ status: 'error', error: error.message }));
  return true;
});

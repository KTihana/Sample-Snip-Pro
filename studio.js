import { PadEngine } from './engine.js';
import {
  emptyPad,
  assignKey,
  validTrim,
  time,
  filename,
  SESSION_LIMIT,
  SAMPLE_LIMIT,
} from './model.js';
import { getPads, getPad, putPads, getSession, putSession } from './storage.js';
import { demoPad } from './demo.js';
import { createTrimmer } from './trim-editor.js';
import { readBankNames, renameBank, validBank } from './banks.js';
import { drawWaveform } from './waveform.js';

const $ = (id) => document.getElementById(id);
const engine = new PadEngine();
const extension = !!globalThis.chrome?.runtime?.id;
let bank = 0,
  selected = 0,
  pads = [],
  switching = false,
  importing = false,
  capturePending = false;
let captureState = { status: 'idle' },
  lastCaptureVersion,
  session,
  sessionURL,
  noticeTimer;
let bankNames = readBankNames(localStorage);
const trimmer = createTrimmer({
  area: $('trim-track'),
  startHandle: $('trim-start-handle'),
  endHandle: $('trim-end-handle'),
  selection: $('trim-selection'),
  read: () => ({
    pad: current(),
    duration: engine.buffers.get(current()?.id)?.duration || 0,
    disabled: selectedBusy() || !current()?.data,
  }),
  onChange: (pad) => {
    engine.stopPad(pad.id);
    if (pad !== current()) return;
    $('trim-start').value = pad.start.toFixed(2);
    $('trim-end').value = pad.end.toFixed(2);
    $('sample-duration').textContent =
      `${time(pad.end - pad.start, true)} · ${engine.buffers.get(pad.id).sampleRate / 1000} kHz`;
    drawWave($('editor-wave'), pad, true);
  },
  onCommit: (pad) => {
    void persist([pad]).catch(fail);
    renderPads();
    renderEditor();
  },
});

function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => {
      $('notice').hidden = true;
    },
    error ? 9000 : 4200,
  );
}
function fail(error) {
  console.error(error);
  notify(error.message || String(error), true);
}
function current() {
  return pads[selected];
}
function captureBusy() {
  return capturePending || ['starting', 'recording', 'stopping'].includes(captureState.status);
}
function selectedBusy() {
  return switching || importing || (captureBusy() && captureState.padId === current()?.id);
}
async function persist(records) {
  try {
    await putPads(records);
  } catch (error) {
    notify(`Could not save changes on this device: ${error.message}`, true);
    throw error;
  }
}
async function message(type, payload = {}) {
  if (!extension)
    throw new Error(
      'Browser capture is available in the Pro extension. You can try demo sounds or import audio here.',
    );
  const result = await chrome.runtime.sendMessage({ target: 'background', type, ...payload });
  if (result?.error && result.status !== 'error') throw new Error(result.error);
  return result;
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('snip-pro-theme', theme);
  $('theme').textContent = theme === 'dark' ? '☼' : '☾';
  $('theme').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  redraw();
}
function drawWave(canvas, pad, editor = false) {
  drawWaveform(canvas, engine.buffers.get(pad?.id), pad, editor);
}
function redraw() {
  document
    .querySelectorAll('.pad-wave')
    .forEach((canvas) => drawWave(canvas, pads[Number(canvas.dataset.index)]));
  drawWave($('editor-wave'), current(), true);
  trimmer.render();
}
function renderPads() {
  $('pads').replaceChildren();
  for (const pad of pads) {
    const cell = document.createElement('div');
    cell.className = 'pad-cell';
    cell.dataset.index = pad.index;
    cell.style.setProperty('--pad-color', `var(--${pad.color})`);
    const hit = document.createElement('button');
    hit.className = `pad-hit${pad.data ? '' : ' empty'}`;
    hit.setAttribute(
      'aria-label',
      `${pad.name}, ${pad.data ? 'play' : 'empty pad'}, key ${pad.key.toUpperCase()}`,
    );
    hit.innerHTML =
      '<canvas class="pad-wave" aria-hidden="true"></canvas><span class="empty-plus" aria-hidden="true">+</span><span class="pad-title"></span><span class="pad-bottom"><kbd class="pad-key"></kbd></span>';
    hit.querySelector('.pad-title').textContent = pad.data
      ? pad.name
      : pad.name.startsWith('Pad ')
        ? 'Add a sound'
        : pad.name;
    hit.querySelector('.pad-key').textContent = pad.key.toUpperCase();
    hit.querySelector('.pad-wave').dataset.index = pad.index;
    hit.querySelector('.pad-wave').hidden = !pad.data;
    hit.querySelector('.empty-plus').hidden = !!pad.data;
    hit.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || switching) return;
      event.preventDefault();
      if (pad.data) engine.trigger(pad.id);
      selectPad(pad.index);
      if (!pad.data) $('capture').focus({ preventScroll: true });
    });
    hit.addEventListener('click', (event) => {
      if (event.detail === 0 && !switching) {
        engine.trigger(pad.id);
        selectPad(pad.index);
      }
    });
    const edit = document.createElement('button');
    edit.className = 'pad-edit';
    edit.textContent = '⋯';
    edit.title = `Edit ${pad.name}`;
    edit.setAttribute('aria-label', `Select ${pad.name} for editing`);
    edit.addEventListener('click', () => {
      selectPad(pad.index);
      $('editor').open = true;
    });
    cell.append(hit, edit);
    $('pads').append(cell);
  }
  $('loaded-count').textContent = `${pads.filter((pad) => pad.data).length} / 16 sounds`;
  renderSelectedStrip();
  updatePadStates();
  redraw();
}
function updatePadStates(playing) {
  const active = playing || new Set([...engine.voices].filter((v) => !v.stopped).map((v) => v.id));
  document.querySelectorAll('.pad-cell').forEach((cell) => {
    const pad = pads[Number(cell.dataset.index)];
    cell.classList.toggle('selected', pad.index === selected);
    cell.classList.toggle('playing', active.has(pad.id));
    cell.classList.toggle('capturing', captureBusy() && captureState.padId === pad.id);
  });
}
function selectPad(index) {
  if (switching || importing) return;
  selected = index;
  updatePadStates();
  renderEditor();
}
function renderSelectedStrip() {
  const pad = current();
  if (!pad) return;
  $('selected-name').textContent = pad.name;
  $('selected-key').textContent = pad.key.toUpperCase();
}
function renderEditor() {
  const pad = current();
  if (!pad) return;
  const loaded = !!pad.data && engine.buffers.has(pad.id),
    busy = selectedBusy();
  $('pad-number').textContent = String(pad.index + 1).padStart(2, '0');
  renderSelectedStrip();
  $('sample-name').value = pad.name;
  $('sample-name').disabled = busy;
  $('sample-key').value = pad.key.toUpperCase();
  $('sample-key').disabled = busy;
  $('sample-duration').textContent = loaded
    ? `${time(pad.end - pad.start, true)} · ${engine.buffers.get(pad.id).sampleRate / 1000} kHz`
    : 'Empty pad';
  $('empty-wave').hidden = loaded;
  $('preview').disabled = !loaded || switching;
  $('trim-start').value = pad.start.toFixed(2);
  $('trim-end').value = pad.end.toFixed(2);
  $('trim-start').max = pad.duration || 0;
  $('trim-end').max = pad.duration || 0;
  for (const id of ['trim-start', 'trim-end', 'loop', 'pad-volume', 'export-sample', 'clear'])
    $(id).disabled = !loaded || busy;
  $('loop').checked = pad.loop;
  $('pad-volume').value = pad.volume;
  $('pad-volume-value').textContent = `${Math.round(pad.volume * 100)}%`;
  $('colors').replaceChildren();
  for (const color of ['amber', 'violet', 'cyan', 'rose', 'mint']) {
    const button = document.createElement('button');
    button.style.setProperty('--swatch', `var(--${color})`);
    button.title = color;
    button.setAttribute('aria-label', `${color} pad color`);
    button.setAttribute('aria-pressed', pad.color === color);
    button.disabled = busy;
    button.addEventListener('click', () => {
      pad.color = color;
      void persist([pad]).catch(fail);
      renderPads();
      renderEditor();
    });
    $('colors').append(button);
  }
  $('import').disabled = busy;
  updateCaptureControls();
  drawWave($('editor-wave'), pad, true);
  trimmer.render();
}
function updateCaptureControls() {
  const busy = captureBusy();
  $('capture').classList.toggle('recording', captureState.status === 'recording');
  $('capture').disabled =
    switching ||
    importing ||
    capturePending ||
    ['starting', 'stopping'].includes(captureState.status);
  $('capture-label').textContent =
    captureState.status === 'recording'
      ? 'Stop recording'
      : captureState.status === 'starting'
        ? 'Starting…'
        : captureState.status === 'stopping'
          ? 'Saving sound…'
          : 'Record sound';
  $('capture-time').textContent = time(captureState.elapsed || 0);
  $('capture-time').hidden = !['recording', 'stopping'].includes(captureState.status);
  $('bank').disabled = switching || importing;
  $('bank-name').disabled = switching || importing;
  $('demo').disabled = busy || switching || importing;
  $('source-hint').textContent = busy
    ? 'Capturing web audio into your pad. Up to 60 seconds.'
    : extension
      ? 'Play web audio, then press Record to save it to this pad.'
      : 'Try the pads below. Browser recording uses the extension.';
}
async function loadBank(next) {
  if (switching || importing || !validBank(next)) return;
  switching = true;
  updateCaptureControls();
  try {
    engine.stopAll();
    for (const id of [...engine.buffers.keys()]) engine.remove(id);
    bank = next;
    selected = 0;
    const saved = await getPads(bank);
    pads = Array.from(
      { length: 16 },
      (_, i) => saved.find((pad) => pad.index === i) || emptyPad(bank, i),
    );
    await Promise.all(
      pads
        .filter((pad) => pad.data)
        .map(async (pad) => {
          try {
            await engine.load(pad);
          } catch (error) {
            pad.data = null;
            notify(`Could not load ${pad.name}: ${error.message}`, true);
          }
        }),
    );
    localStorage.setItem('snip-pro-bank', String(bank));
    renderPads();
  } finally {
    switching = false;
    renderBanks();
    renderEditor();
  }
}
function renderBanks() {
  $('bank').replaceChildren(
    ...bankNames.map((name, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = name;
      return option;
    }),
  );
  $('bank').value = String(bank);
  $('bank').title = bankNames[bank];
  $('bank-name').value = bankNames[bank];
}
async function consumeCapture(state) {
  if (!state) return;
  const previousStatus = captureState.status;
  captureState = state;
  updateCaptureControls();
  updatePadStates();
  if (previousStatus !== state.status) renderEditor();
  if (state.status === 'error' && previousStatus !== 'error')
    notify(state.error || 'Capture could not start. Your previous sound has been kept.', true);
  if (state.result?.version && state.result.version !== lastCaptureVersion) {
    if (switching || importing) return;
    lastCaptureVersion = state.result.version;
    const saved = await getPad(state.result.padId);
    if (saved?.bank === bank) {
      // Keep a bank switch from racing the asynchronous audio decoder.
      importing = true;
      try {
        await engine.load(saved);
        pads[saved.index] = saved;
        renderPads();
      } finally {
        importing = false;
        renderEditor();
      }
    }
    notify('Sound saved to its pad. Ready to play.');
  }
}
function showSession(recording, expanded = false) {
  session = recording;
  if (sessionURL) URL.revokeObjectURL(sessionURL);
  sessionURL = URL.createObjectURL(session.blob);
  $('session-result').hidden = false;
  $('session-audio').src = sessionURL;
  $('session-result').open = expanded;
  $('session-name').value = session.name || 'My sample session';
  $('session-download').href = sessionURL;
  $('session-download').download = `${filename($('session-name').value)}.wav`;
  $('quick-download').hidden = false;
  $('quick-download').href = sessionURL;
  $('quick-download').download = $('session-download').download;
  $('session-time').textContent = time(session.duration);
}
function sessionControls() {
  const busy = engine.preparing || engine.exporting;
  $('record-session').disabled = busy || switching;
  $('session-button-label').textContent = engine.preparing
    ? 'Preparing…'
    : engine.exporting
      ? 'Saving mix…'
      : engine.recording
        ? 'Stop session'
        : 'Record session';
  document.querySelector('.session-panel').classList.toggle('recording', engine.recording);
  $('session-hint').textContent = engine.recording
    ? 'Recording your music. Keep playing.'
    : engine.exporting
      ? 'Preparing your download…'
      : 'Record the music you play on the pads.';
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$('theme').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
);
$('bank').addEventListener('change', () => void loadBank(Number($('bank').value)).catch(fail));
function saveBankName() {
  if (switching || importing) return;
  try {
    bankNames = renameBank(localStorage, bank, $('bank-name').value);
    renderBanks();
  } catch (error) {
    fail(error);
  }
}
$('bank-name').addEventListener('blur', saveBankName);
$('bank-name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveBankName();
    $('bank-name').blur();
  }
});
$('mode').value = localStorage.getItem('snip-pro-mode') || 'layer';
engine.mode = $('mode').value;
$('mode').addEventListener('change', () => {
  engine.mode = $('mode').value;
  localStorage.setItem('snip-pro-mode', engine.mode);
  engine.stopAll();
});
$('stop-all').addEventListener('click', () => engine.stopAll());
$('preview').addEventListener('click', () => engine.trigger(current().id, true));
$('sample-name').addEventListener('input', () => {
  if (selectedBusy()) return;
  const pad = current();
  pad.name = $('sample-name').value.trim() || `Pad ${String(pad.index + 1).padStart(2, '0')}`;
  renderPads();
  void persist([pad]).catch(fail);
  updateCaptureControls();
});
$('sample-key').addEventListener('keydown', (event) => {
  if (event.key === 'Tab') return;
  event.preventDefault();
  event.stopPropagation();
  if (selectedBusy() || event.ctrlKey || event.altKey || event.metaKey) return;
  try {
    const capturingConflict = pads.find(
      (pad) => pad.key === event.key.toLowerCase() && pad.id === captureState.padId,
    );
    if (captureBusy() && capturingConflict)
      throw new Error('Wait for that pad to finish recording before swapping its key.');
    const conflict = assignKey(pads, selected, event.key);
    void persist(conflict < 0 ? [current()] : [current(), pads[conflict]]).catch(fail);
    renderPads();
    renderEditor();
    notify(
      conflict < 0
        ? `Trigger set to ${current().key.toUpperCase()}.`
        : `Keys swapped with ${pads[conflict].name}.`,
    );
    $('sample-key').blur();
  } catch (error) {
    notify(error.message);
  }
});
for (const id of ['trim-start', 'trim-end'])
  $(id).addEventListener('change', () => {
    if (selectedBusy()) return;
    const pad = current();
    Object.assign(pad, validTrim($('trim-start').value, $('trim-end').value, pad.duration));
    engine.stopPad(pad.id);
    void persist([pad]).catch(fail);
    renderPads();
    renderEditor();
  });
$('loop').addEventListener('change', () => {
  if (selectedBusy()) return;
  current().loop = $('loop').checked;
  engine.stopPad(current().id);
  void persist([current()]).catch(fail);
  renderPads();
});
$('pad-volume').addEventListener('input', () => {
  current().volume = Number($('pad-volume').value);
  $('pad-volume-value').textContent = `${Math.round(current().volume * 100)}%`;
});
$('pad-volume').addEventListener('change', () => void persist([current()]).catch(fail));
$('master').value = localStorage.getItem('snip-pro-volume') ?? '0.8';
function masterVolume() {
  engine.setVolume(Number($('master').value));
  $('master-value').textContent = `${Math.round(engine.masterVolume * 100)}%`;
  localStorage.setItem('snip-pro-volume', String(engine.masterVolume));
}
$('master').addEventListener('input', masterVolume);
masterVolume();
$('capture').addEventListener('click', async () => {
  if (captureBusy()) {
    if (captureState.status === 'recording') {
      try {
        await consumeCapture(await message('stop'));
      } catch (error) {
        fail(error);
      }
    }
    return;
  }
  const pad = current();
  capturePending = true;
  captureState = { status: 'starting', padId: pad.id };
  renderEditor();
  updatePadStates();
  try {
    await persist([pad]);
    const { data, duration, ...metadata } = pad;
    const state = await message('start', { pad: metadata });
    capturePending = false;
    await consumeCapture(state);
  } catch (error) {
    capturePending = false;
    await consumeCapture({ status: 'error', error: error.message });
  }
});
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  $('file').value = '';
  if (!file || selectedBusy()) return;
  const target = current();
  importing = true;
  renderEditor();
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error('Choose an audio file smaller than 64 MB.');
    await engine.initialize();
    const buffer = await engine.context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > SAMPLE_LIMIT) throw new Error('Choose a sample up to 60 seconds long.');
    const next = {
      ...target,
      data: file,
      start: 0,
      end: buffer.duration,
      name:
        target.data || !target.name.startsWith('Pad ')
          ? target.name
          : file.name.replace(/\.[^.]+$/, '').slice(0, 40),
      updatedAt: Date.now(),
    };
    await persist([next]);
    await engine.load(next);
    pads[next.index] = next;
    renderPads();
    notify(`Saved to ${next.name}.`);
  } catch (error) {
    fail(error);
  } finally {
    importing = false;
    renderEditor();
  }
});
$('export-sample').addEventListener('click', async () => {
  const pad = current();
  $('export-sample').disabled = true;
  try {
    download(await engine.exportPad(pad.id), `${filename(pad.name)}.wav`);
  } catch (error) {
    fail(error);
  } finally {
    renderEditor();
  }
});
$('clear').addEventListener('click', async () => {
  if (selectedBusy()) return;
  const pad = current(),
    next = { ...pad, data: null, start: 0, end: 0, duration: 0, loop: false };
  try {
    await persist([next]);
    engine.remove(pad.id);
    pads[selected] = next;
    renderPads();
    renderEditor();
    notify('Pad cleared. Its name and key have been kept.');
  } catch (error) {
    fail(error);
  }
});
$('demo').addEventListener('click', async () => {
  if (captureBusy() || switching || importing) return;
  importing = true;
  $('demo').disabled = true;
  renderEditor();
  try {
    const added = pads.map(demoPad);
    engine.stopAll();
    await persist(added);
    await Promise.all(added.map((pad) => engine.load(pad)));
    for (const pad of added) pads[pad.index] = pad;
    renderPads();
    notify('All 16 sounds replaced with the demo kit. Ready to play.');
  } catch (error) {
    fail(error);
  } finally {
    importing = false;
    renderEditor();
  }
});
$('record-session').addEventListener('click', async () => {
  if (engine.recording) {
    engine.stopRecording();
    return;
  }
  if (!pads.some((pad) => pad.data)) {
    notify('Add some sounds or try the demo kit first.');
    return;
  }
  try {
    $('session-audio').pause();
    const promise = engine.startRecording();
    sessionControls();
    await promise;
    sessionControls();
  } catch (error) {
    fail(error);
    sessionControls();
  }
});
$('session-name').addEventListener('input', () => {
  if (!session) return;
  session.name = $('session-name').value.trim() || 'My sample session';
  $('session-download').download = `${filename(session.name)}.wav`;
  $('quick-download').download = $('session-download').download;
});
$('session-name').addEventListener('change', () => {
  if (session) void putSession(session).catch(fail);
});
engine.addEventListener('voices', (event) => updatePadStates(event.detail));
engine.addEventListener('recording', () => {
  $('session-time').textContent = '0:00';
  sessionControls();
});
engine.addEventListener('exporting', (event) => {
  $('session-time').textContent = time(event.detail.duration);
  sessionControls();
});
engine.addEventListener('idle', sessionControls);
engine.addEventListener('error', (event) => {
  notify(event.detail, true);
  sessionControls();
});
engine.addEventListener('recorded', async (event) => {
  const recording = { ...event.detail, name: 'My sample session' };
  showSession(recording, true);
  try {
    await putSession(recording);
    notify(
      recording.capped
        ? 'Five minutes captured. Your mix is ready to download.'
        : 'Your mix is saved. Give it a name and download it.',
    );
  } catch (error) {
    notify(`Your WAV is ready to download, but local saving failed: ${error.message}`, true);
  }
});
document.addEventListener('keydown', (event) => {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) ||
    event.target.isContentEditable
  )
    return;
  if (event.key === 'Escape') {
    engine.stopAll();
    return;
  }
  if (switching) return;
  const index = pads.findIndex((pad) => pad.key === event.key.toLowerCase());
  if (index < 0 || !pads[index].data) return;
  event.preventDefault();
  engine.trigger(pads[index].id);
  selectPad(index);
});
window.addEventListener('resize', redraw);
$('editor').addEventListener('toggle', redraw);
$('sound-options').addEventListener('toggle', redraw);
window.addEventListener('beforeunload', (event) => {
  if (engine.recording || engine.preparing || engine.exporting) {
    event.preventDefault();
    event.returnValue = '';
  }
});
if (extension) {
  chrome.runtime.onMessage.addListener((incoming, sender) => {
    if (sender.id !== chrome.runtime.id || incoming.target !== 'studio') return;
    if (incoming.type === 'capture-state') void consumeCapture(incoming.state).catch(fail);
  });
  setInterval(() => {
    void message('status')
      .then(consumeCapture)
      .catch(() => {});
  }, 500);
}
setInterval(() => {
  if (engine.recording)
    $('session-time').textContent = time(
      Math.min(SESSION_LIMIT, engine.context.currentTime - engine.recordStarted),
    );
}, 60);
async function start() {
  applyTheme(
    localStorage.getItem('snip-pro-theme') ||
      (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  );
  const savedBank = Number(localStorage.getItem('snip-pro-bank'));
  await loadBank(validBank(savedBank) ? savedBank : 0);
  const savedSession = await getSession();
  if (savedSession) showSession(savedSession);
  if (extension) await consumeCapture(await message('status'));
  else $('environment').textContent = 'Design preview · Sounds saved on this device';
  updateCaptureControls();
}
void start().catch(fail);

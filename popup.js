const $ = (id) => document.getElementById(id);
let windowId;
function theme(value) {
  document.documentElement.dataset.theme = value;
  localStorage.setItem('snip-pro-theme', value);
  $('theme').textContent = value === 'dark' ? '☼' : '☾';
  $('theme').setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} theme`);
}
function fail(error) {
  $('popup-error').hidden = false;
  $('popup-error').textContent = error.message || String(error);
}
theme(localStorage.getItem('snip-pro-theme') || 'dark');
$('theme').addEventListener('click', () =>
  theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
);
$('open-pads').addEventListener('click', () => {
  if (windowId === undefined) return;
  // Call directly in the button gesture; an async message would lose it.
  const opened = chrome.sidePanel.open({ windowId });
  $('open-pads').disabled = true;
  void opened
    .then(() => window.close())
    .catch((error) => {
      $('open-pads').disabled = false;
      fail(error);
    });
});
async function ready() {
  if (!globalThis.chrome?.runtime?.id) {
    $('popup-hint').textContent = 'Load Sample Snip Pro in Chrome, then click its toolbar icon.';
    return;
  }
  const result = await chrome.runtime.sendMessage({ target: 'background', type: 'choose-source' });
  if (result?.error) throw new Error(result.error);
  if (!Number.isInteger(result?.windowId))
    throw new Error('Could not select your browser window. Try opening Pro again.');
  windowId = result.windowId;
  if (!result.source)
    $('popup-hint').textContent =
      'You can play saved pads. Open a webpage with audio to record a sound.';
  $('open-pads').disabled = false;
}
void ready().catch(fail);

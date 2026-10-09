"""Package the extension runtime and README images, without tests or design drafts."""
import json
import shutil
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
files = [
    'manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js', 'studio.html', 'studio.css', 'studio.js',
    'capture.js', 'offscreen.html', 'engine.js', 'encoding.js',
    'encode-worker.js', 'pcm-worklet.js', 'storage.js', 'model.js', 'demo.js',
    'wav.js', 'trim-editor.js', 'banks.js', 'waveform.js', 'icons/logo.svg', 'README.md',
    'docs/screenshots/dark-samples.png', 'docs/screenshots/light-empty.png',
    *manifest['icons'].values(),
]
destination = root / 'release' / f"sample-snip-pro-{manifest['version']}.zip"
destination.parent.mkdir(exist_ok=True)
unpacked = destination.parent / 'sample-snip-pro-chrome'
with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
    staging = Path(temporary)
    for filename in files:
        source = root / filename
        if not source.is_file():
            raise FileNotFoundError(source)
        target = staging / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    if unpacked.exists():
        shutil.rmtree(unpacked)
    shutil.move(str(staging), unpacked)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for filename in files:
        source = root / filename
        if not source.is_file():
            raise FileNotFoundError(source)
        archive.write(source, filename)
print(destination)

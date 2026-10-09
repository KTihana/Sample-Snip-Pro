const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

(async () => {
  const root = path.join(__dirname, '..');
  const svg = await fs.readFile(path.join(root, 'icons', 'logo.svg'));
  for (const size of [16, 32, 48, 64, 128]) {
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(path.join(root, 'icons', `icon-${size}.png`));
  }
  console.log('Rendered Pro icons at 16, 32, 48, 64 and 128 pixels.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

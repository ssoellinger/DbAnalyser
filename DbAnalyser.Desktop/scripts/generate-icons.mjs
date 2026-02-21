import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resourcesDir = resolve(__dirname, '..', 'resources');
const publicDir = resolve(__dirname, '..', 'public');

const svgPath = resolve(resourcesDir, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

// Generate PNGs at various sizes
const sizes = [16, 32, 48, 64, 128, 256, 512];

async function main() {
  // Generate PNGs
  for (const size of sizes) {
    await sharp(svgBuffer, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(resolve(resourcesDir, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
  }

  // Copy 256px as the main icon.png
  await sharp(svgBuffer, { density: 300 })
    .resize(256, 256)
    .png()
    .toFile(resolve(resourcesDir, 'icon.png'));
  console.log('Generated icon.png (256x256)');

  // Generate .ico (Windows) with multiple sizes
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];
  for (const size of icoSizes) {
    const buf = await sharp(svgBuffer, { density: 300 })
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(buf);
  }
  const icoBuffer = await pngToIco(pngBuffers);
  writeFileSync(resolve(resourcesDir, 'icon.ico'), icoBuffer);
  console.log('Generated icon.ico');

  console.log('Done!');
}

main().catch(console.error);

/**
 * generate-icons.mjs
 *
 * Reads build/icon.svg, renders it to multiple PNG sizes using sharp,
 * then produces:
 *   build/icon.png        - 256x256 (Linux AppImage)
 *   build/icon@2x.png     - 512x512 (macOS Retina)
 *   build/icon.ico        - multi-size ICO (16, 32, 48, 64, 128, 256) (Windows)
 *   public/icon.png       - 256x256 copy for BrowserWindow/Tray at runtime
 *
 * Run: node scripts/generate-icons.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SVG_PATH = resolve(ROOT, 'build', 'icon.svg');
const OUT_PNG_256 = resolve(ROOT, 'build', 'icon.png');
const OUT_PNG_512 = resolve(ROOT, 'build', 'icon@2x.png');
const OUT_ICO = resolve(ROOT, 'build', 'icon.ico');
const OUT_PUBLIC_PNG = resolve(ROOT, 'public', 'icon.png');

// ICO sizes needed for a proper Windows multi-size .ico
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function renderSvgToPng(svgPath, size) {
  const svgBuffer = readFileSync(svgPath);
  return await sharp(svgBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  console.log('ExpressDelivery icon generator');
  console.log('================================');
  console.log(`SVG source : ${SVG_PATH}`);
  console.log('');

  // 1. Render 256x256 PNG
  console.log('Rendering 256x256 PNG...');
  const png256 = await renderSvgToPng(SVG_PATH, 256);
  writeFileSync(OUT_PNG_256, png256);
  console.log(`  -> ${OUT_PNG_256}`);

  // 2. Render 512x512 PNG (macOS @2x / icns source)
  console.log('Rendering 512x512 PNG...');
  const png512 = await renderSvgToPng(SVG_PATH, 512);
  writeFileSync(OUT_PNG_512, png512);
  console.log(`  -> ${OUT_PNG_512}`);

  // 3. Copy 256x256 to public/ for runtime use
  console.log('Copying 256x256 PNG to public/...');
  writeFileSync(OUT_PUBLIC_PNG, png256);
  console.log(`  -> ${OUT_PUBLIC_PNG}`);

  // 4. Generate multi-size ICO from multiple PNG renders
  console.log(`Rendering ${ICO_SIZES.join(', ')}px PNGs for ICO...`);
  const icoBuffers = await Promise.all(
    ICO_SIZES.map(size => renderSvgToPng(SVG_PATH, size))
  );
  console.log('Building ICO file...');
  const icoBuffer = await pngToIco(icoBuffers);
  writeFileSync(OUT_ICO, icoBuffer);
  console.log(`  -> ${OUT_ICO}`);

  // 5. Report file sizes
  console.log('');
  console.log('Output summary:');
  const outputs = [
    { label: 'build/icon.png (256px)', path: OUT_PNG_256 },
    { label: 'build/icon@2x.png (512px)', path: OUT_PNG_512 },
    { label: 'build/icon.ico (multi-size)', path: OUT_ICO },
    { label: 'public/icon.png (256px)', path: OUT_PUBLIC_PNG },
  ];
  for (const { label, path: p } of outputs) {
    const buf = readFileSync(p);
    console.log(`  ${label}: ${(buf.length / 1024).toFixed(1)} KB`);
  }
  console.log('');
  console.log('Done. Icon files generated successfully.');
}

main().catch(err => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});

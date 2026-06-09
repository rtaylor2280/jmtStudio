// Generates platform icon containers and the Linux icon set from
// assets/logo.png (and optionally assets/logo-mac.png for Mac styling).
// Overwrites existing icon files in place.
//
// Usage: npm run build:icons
//
// Inputs:
//   assets/logo.png            (the master raster — ideally 1024x1024 PNG;
//                               used for Windows ICO, Linux PNG set, and
//                               macOS ICNS unless a Mac-specific source exists)
//   assets/logo-mac.png        (OPTIONAL — Mac-styled source: square PNG
//                               with JMT Blue background, logo centered
//                               without the circle frame, padded per Apple
//                               convention. If present, this is used for
//                               icon.icns; if absent, falls back to logo.png)
//
// Outputs:
//   assets/icon.ico            (Windows multi-resolution ICO)
//   assets/icon.icns           (macOS multi-resolution ICNS)
//   build/icons/16x16.png      (Linux hicolor set)
//   build/icons/32x32.png
//   build/icons/48x48.png
//   build/icons/64x64.png
//   build/icons/128x128.png
//   build/icons/256x256.png
//   build/icons/512x512.png

const path = require('path');
const fs   = require('fs');
const sharp     = require('sharp');
const png2icons = require('png2icons');

const ROOT      = path.resolve(__dirname, '..');
const SRC       = path.join(ROOT, 'assets', 'logo.png');
const MAC_SRC   = path.join(ROOT, 'assets', 'logo-mac.png');
const ICO_OUT   = path.join(ROOT, 'assets', 'icon.ico');
const ICNS_OUT  = path.join(ROOT, 'assets', 'icon.icns');
const LINUX_DIR = path.join(ROOT, 'build', 'icons');
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}`);
    console.error(`Drop your master logo into assets/logo.png and re-run.`);
    process.exit(1);
  }

  const srcBuffer = fs.readFileSync(SRC);
  const meta = await sharp(srcBuffer).metadata();
  console.log(`Source: assets/logo.png  (${meta.width}x${meta.height}, ${meta.format})`);

  if (meta.width < 1024 || meta.height < 1024) {
    console.warn(`Warning: source smaller than 1024x1024 — larger icon sizes will be upscaled.`);
  }
  if (meta.width !== meta.height) {
    console.warn(`Warning: source is not square — icons will be distorted on platforms that expect square.`);
  }

  fs.mkdirSync(LINUX_DIR, { recursive: true });

  // Linux PNG set
  for (const size of LINUX_SIZES) {
    const outPath = path.join(LINUX_DIR, `${size}x${size}.png`);
    await sharp(srcBuffer).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(outPath);
    console.log(`  build/icons/${size}x${size}.png`);
  }

  // Windows ICO
  const ico = png2icons.createICO(srcBuffer, png2icons.BICUBIC, 0, false);
  if (!ico) {
    console.error('Failed to create ICO');
    process.exit(1);
  }
  fs.writeFileSync(ICO_OUT, ico);
  console.log(`  assets/icon.ico  (${ico.length} bytes)`);

  // macOS ICNS — use Mac-styled source if available (square + JMT Blue
  // background + circle-less logo) so the bundle icon matches Apple convention;
  // otherwise fall back to the round-on-transparent master.
  let icnsSource = srcBuffer;
  if (fs.existsSync(MAC_SRC)) {
    icnsSource = fs.readFileSync(MAC_SRC);
    const macMeta = await sharp(icnsSource).metadata();
    console.log(`Mac source: assets/logo-mac.png  (${macMeta.width}x${macMeta.height}, ${macMeta.format})`);
    if (macMeta.width !== macMeta.height) {
      console.warn(`Warning: Mac source is not square — Mac icon will be distorted.`);
    }
  } else {
    console.log(`Mac source: assets/logo.png  (no logo-mac.png found, using round master)`);
  }
  const icns = png2icons.createICNS(icnsSource, png2icons.BICUBIC, 0);
  if (!icns) {
    console.error('Failed to create ICNS');
    process.exit(1);
  }
  fs.writeFileSync(ICNS_OUT, icns);
  console.log(`  assets/icon.icns (${icns.length} bytes)`);

  console.log('\nAll icons regenerated from assets/logo.png.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

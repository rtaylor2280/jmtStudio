/**
 * copy-three.js
 * Copies three.module.js from node_modules into renderer/
 * so the app works offline and when packaged (no CDN dependency).
 * Run automatically via postinstall, or manually: node scripts/copy-three.js
 */

const fs   = require('fs');
const path = require('path');

const srcDir  = path.join(__dirname, '..', 'node_modules', 'three', 'build');
const destDir = path.join(__dirname, '..', 'renderer');

if (!fs.existsSync(srcDir)) {
  console.error('three not found in node_modules. Run: npm install');
  process.exit(1);
}

// Copy all .js files from the three build folder (three.module.js depends on three.core.js)
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
console.log(`Copying ${files.length} three.js build files to renderer/...`);
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}
console.log('Done.');

/**
 * copy-monaco.js
 * Copies monaco-editor min/vs files from node_modules into renderer/vs/
 * so the app works offline and when packaged (no CDN dependency).
 * Run automatically via postinstall, or manually: node scripts/copy-monaco.js
 */

const fs   = require('fs');
const path = require('path');

const src  = path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs');
const dest = path.join(__dirname, '..', 'renderer', 'vs');

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath  = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

if (!fs.existsSync(src)) {
  console.error('monaco-editor not found in node_modules. Run: npm install');
  process.exit(1);
}

console.log('Copying Monaco editor files to renderer/vs/...');
copyDir(src, dest);
console.log('Done.');

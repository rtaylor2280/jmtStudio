// No invisible control characters in source files.
//
// A regex written through a script as "\b" can land as a literal backspace (0x08) instead of a word
// boundary. It parses, it runs, and it never matches anything, with no error anywhere. One sat in
// _scanDisabledPresets for weeks, so a disabled preset's detail never listed its styles; two more
// were written and caught the night it was found (2026-10-22). Backspace, bell, vertical tab and form
// feed have no legitimate place in this codebase's source, so any of them is a defect.
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BAD = /[\x07\x08\x0b\x0c]/;

let files;
try {
  files = execSync('git ls-files', { cwd: ROOT, maxBuffer: 1 << 28 }).toString()
    .split('\n').map(s => s.trim())
    .filter(f => f && /\.(js|html|css|json|py)$/.test(f) && fs.existsSync(path.join(ROOT, f)));
} catch {
  console.log('  skip  not a git checkout');
  process.exit(0);
}

const hits = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!BAD.test(text)) continue;
  text.split('\n').forEach((line, i) => {
    const m = BAD.exec(line);
    if (m) hits.push(`${f}:${i + 1}  char 0x${m[0].charCodeAt(0).toString(16).padStart(2, '0')} near: ${JSON.stringify(line.slice(Math.max(0, m.index - 30), m.index + 20))}`);
  });
}

const ok = files.length > 100 && hits.length === 0;
console.log(`  ${ok ? 'ok  ' : 'FAIL'} no control characters in ${files.length} source files${hits.length ? '\n       ' + hits.join('\n       ') : ''}`);
console.log(ok ? '\nall passing' : '\n1 FAILED');
process.exit(ok ? 0 : 1);

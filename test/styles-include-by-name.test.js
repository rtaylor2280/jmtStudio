// The Style Library is included by name, and every compile puts it beside the config. [B-542]
//
//   1. A compile stages my_styles.h into the selected version's config folder, always, and removes
//      one left there when there is no library (proffieos.stageStylesForCompile).
//   2. A compile updates an include of the app's own library by its full path to "my_styles.h",
//      with a notice, after its save questions; every other include is left alone.
//   3. The Style Library counts both forms as linked, writes the name on a new link, and still
//      treats an include of some other my_styles.h as a conflict (_isOwnStylesInclude).
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const vm   = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

(async () => {
  console.log('1. staging on compile');
  {
    // proffieos.js reads electron's app for its paths; a scratch userData stands in.
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-styles-stage-'));
    const fakeElectron = { app: { getPath: () => userData, getAppPath: () => ROOT, isPackaged: false } };
    const origLoad = Module._load;
    Module._load = function (req, ...rest) { return req === 'electron' ? fakeElectron : origLoad.call(this, req, ...rest); };
    let proffie;
    try { proffie = require(path.join(ROOT, 'proffieos.js')); } finally { Module._load = origLoad; }

    proffie.setSelectedVersion('ProffieOS 8.10');
    const root = proffie.getProffieOSRoot();
    const cfgDir = path.join(root, 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    const staged = path.join(cfgDir, 'my_styles.h');

    fs.writeFileSync(proffie.getUserStylesPath(), 'using A = Red;\n');
    let r = proffie.stageStylesForCompile();
    check('the library is copied beside the config', r.ok && fs.readFileSync(staged, 'utf8') === 'using A = Red;\n', JSON.stringify(r));

    fs.writeFileSync(proffie.getUserStylesPath(), 'using A = Blue;\n');
    r = proffie.stageStylesForCompile();
    check('every compile copies it again', fs.readFileSync(staged, 'utf8') === 'using A = Blue;\n');

    fs.unlinkSync(proffie.getUserStylesPath());
    r = proffie.stageStylesForCompile();
    check('no library: the staged copy is removed', r.ok && !fs.existsSync(staged), JSON.stringify(r));
    r = proffie.stageStylesForCompile();
    check('and nothing there is not an error', r.ok);
  }

  console.log('2. the compile notice finds and rewrites the old link');
  {
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const start = html.indexOf('function _ownStylesFullPathLines(');
    let depth = 0, i = html.indexOf('{', start);
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(html.slice(start, i + 1), sb);
    const OWN = 'C:/Users/someone/AppData/Roaming/jmt-studio/my_styles.h';
    const hits = (text, own = OWN) => sb._ownStylesFullPathLines(text, own);
    const cfg = (inc) => `#ifdef CONFIG_PRESETS\n${inc}\nPreset p[] = {};\n#endif\n`;
    // The same edit window.updateStylesIncludeAndSave makes, applied to text.
    const apply = (text) => {
      const ls = text.split('\n');
      for (const h of hits(text)) {
        const l = ls[h.line - 1];
        ls[h.line - 1] = l.slice(0, h.col) + 'my_styles.h' + l.slice(h.col + h.len);
      }
      return ls.join('\n');
    };

    check('the app\'s own library by full path is found', hits(cfg(`#include "${OWN}"`)).length === 1);
    check('the edit writes #include "my_styles.h"', apply(cfg(`#include "${OWN}"`)) === cfg('#include "my_styles.h"'));
    check('found in a CRLF file too, and the line ending kept',
      apply(cfg(`#include "${OWN}"`).replace(/\n/g, '\r\n')) === cfg('#include "my_styles.h"').replace(/\n/g, '\r\n'));
    check('the name form is not found', hits(cfg('#include "my_styles.h"')).length === 0);
    check('some other my_styles.h by full path is left alone', hits(cfg('#include "D:/mine/my_styles.h"')).length === 0);
    check('a commented-out include is left alone', hits(cfg(`// #include "${OWN}"`)).length === 0);
    check('no library: nothing found', hits(cfg(`#include "${OWN}"`), '').length === 0);
    const bp = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');
    const savedAt = bp.indexOf("if (choice === 'save')   await window.saveStylesFile();");
    const noticeAt = bp.indexOf('window.stylesIncludeNeedsUpdate?.()');
    check('the compile asks after its save questions', savedAt > 0 && noticeAt > savedAt, `${savedAt} ${noticeAt}`);
    // promptConfirm answers a two-button question with a boolean, not a word: comparing to
    // 'confirm' would cancel every compile whichever button was pressed.
    check('the notice reads the two-button answer as a boolean', /await _notice !== true/.test(bp));
  }
  console.log('3. what the Style Library counts as linked');
  {
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const start = html.indexOf('function _isOwnStylesInclude(');
    let depth = 0, i = html.indexOf('{', start);
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
    const sb = { _stylesFilePath: 'C:/Users/someone/AppData/Roaming/jmt-studio/my_styles.h' };
    vm.createContext(sb);
    vm.runInContext(html.slice(start, i + 1), sb);
    const own = (l) => sb._isOwnStylesInclude(l);
    check('the name counts', own('#include "my_styles.h"'));
    check('the old full path counts', own(`#include "${sb._stylesFilePath}"`));
    check('another my_styles.h does not', !own('#include "D:/mine/my_styles.h"'));
    check('another file does not', !own('#include "my_other.h"'));
    check('a new link writes the name', /const STYLES_INCLUDE = '#include "my_styles\.h"';/.test(html)
      && /lines\.splice\(insertAfter \+ 1, 0, STYLES_INCLUDE\)/.test(html));
  }

  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall passed');
})();

// Style Library Code view's search and the view switch: matches lit with "n of N", stepping wraps,
// it starts at the cursor, follows edits, Esc clears; one button per view naming where it goes. [B-582]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

// A small stand-in for Monaco: findMatches over lines, case ignored.
const mk = (text, cursor = { lineNumber: 1, column: 1 }) => new Function('TEXT', 'CURSOR', `
  let text = TEXT, sel = null, revealed = null, deco = [];
  const els = {};
  const document = { getElementById: (id) => (els[id] ||= { textContent: '', disabled: false, value: '', style: {} }) };
  const range = (l, c, len) => ({ startLineNumber: l, startColumn: c, endLineNumber: l, endColumn: c + len });
  const _stylesEditorInstance = {
    getPosition: () => CURSOR,
    getModel: () => ({ findMatches: (q) => { const out = []; text.split('\\n').forEach((ln, i) => { let k = -1;
      while ((k = ln.toLowerCase().indexOf(q.toLowerCase(), k + 1)) > -1) out.push({ range: range(i + 1, k + 1, q.length) }); }); return out; } }),
    deltaDecorations: (old, d) => { deco = d; return d.map((_, i) => 'd' + i); },
    setSelection: (r) => { sel = r; }, revealRangeInCenterIfOutsideViewport: (r) => { revealed = r; },
  };
  let _stylesCodeFind = { q: '', matches: [], at: -1, deco: [] };
  ${fn('_stylesCodeFindRun')} ${fn('_stylesCodeFindShow')} ${fn('_stylesCodeFindStep')}
  return { search: (q) => { _stylesCodeFind.q = q; _stylesCodeFind.at = -1; _stylesCodeFindRun(true); _stylesCodeFindShow(true); },
    step: _stylesCodeFindStep, edit: (t) => { text = t; if (_stylesCodeFind.q) _stylesCodeFindRun(false); },
    count: () => els['styles-code-search-count'].textContent, sel: () => sel && sel.startLineNumber, deco: () => deco,
    prevOff: () => els['btn-styles-code-prev'].disabled };`)(text, cursor);

const LIB = ['using Absorbed = Layers<Red>;', 'using VolumePercentBlade = X;', 'using Other = Layers<VolumePercentBlade>;', 'using Last = Layers<volumepercentblade>;'].join('\n');
console.log('1. finding');
{
  const s = mk(LIB);
  s.search('VolumePercentBlade');
  check('counts every match, case ignored', s.count() === '1 of 3', s.count());
  check('selects the first and lights them all, the current one apart', s.sel() === 2 && s.deco().length === 3 && s.deco()[0].options.className === 'currentFindMatch' && s.deco()[1].options.className === 'findMatch');
  s.step(1); s.step(1);
  check('Enter steps on', s.count() === '3 of 3' && s.sel() === 4);
  s.step(1);
  check('and wraps to the first', s.count() === '1 of 3' && s.sel() === 2);
  s.step(-1);
  check('Shift+Enter steps back, wrapping', s.count() === '3 of 3');
}
{
  const s = mk(LIB, { lineNumber: 3, column: 1 });
  s.search('VolumePercentBlade');
  check('it starts at the cursor', s.count() === '2 of 3', s.count());
}
{
  const s = mk(LIB);
  s.search('nothing here');
  check('no match says so', s.count() === 'No matches' && s.prevOff());
  s.search('');
  check('an empty search says nothing and lights nothing', s.count() === '' && s.deco().length === 0);
}
{
  const s = mk(LIB);
  s.search('Layers');
  s.edit(LIB + '\nusing New = Layers<Blue>;');
  check('an edit finds them again', s.count() === '1 of 4', s.count());
}

console.log('2. wiring');
check('Ctrl+F in the code goes to the row', /addCommand\(monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyF, \(\) => _stylesCodeFindFocus\(\)\)/.test(html));
check('edits re-run it', /onDidChangeModelContent\(\(\) => \{ if \(_stylesCodeFind\.q\) _stylesCodeFindRun\(false\); \}\)/.test(html));
check('Enter, Shift+Enter and Esc', /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); _stylesCodeFindStep\(e\.shiftKey \? -1 : 1\); \}/.test(html) && /e\.key === 'Escape'\) \{[^}]*_stylesCodeFindClear\(\);/.test(html));
check('one switch per view, naming where it goes, plain not blue',
  /class="styles-tag-filter-btn styles-view-switch" id="btn-styles-view-code" title="Switch to Code view">&#x3C;\/&#x3E; Code</.test(html)
  && /class="styles-tag-filter-btn styles-view-switch" id="btn-styles-view-visual" title="Switch to Visual view">&#9638; Visual</.test(html)
  && !/styles-view-toggle/.test(html));
check('the switch sits after Visual\'s search count', /id="styles-search-count"[^\n]*\n[\s\S]{0,300}id="btn-styles-view-code"/.test(html));
check('Code view\'s row shows only in Code view', /if \(codeBar\) codeBar\.style\.display = showCode \? '' : 'none';/.test(html));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

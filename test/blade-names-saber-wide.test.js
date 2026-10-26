// Blade names, follows, blade moves and blade-position deletes are the saber's, not one bank's.
// [B-541]
//
// "A blade is a blade and it shared for the entire config." Every bank drives the same blades, so:
//   - a bank with no @jmt-labels / @jmt-follow line of its own reads the one another bank gives;
//   - naming, following, or clearing either writes the same line into every bank, in one edit;
//   - turning follow on copies in every bank (a Z-blade or a dual saber is hardware, not a bank);
//   - moving a blade moves it in every bank, and the names move with it everywhere;
//   - deleting an over-count blade position takes it out of every bank's over-count presets.
//
// The writers run as lifted from index.html over the real parser, on a small model that applies
// edits the way Monaco does (all ranges against the text before the edit).
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
function extractFn(fnName) {
  const start = HTML.indexOf(`function ${fnName}(`);
  if (start < 0) throw new Error(`${fnName} not found in index.html`);
  let depth = 0, i = HTML.indexOf(') {', start) + 2;   // the body, not a destructured parameter
  for (; i < HTML.length; i++) {
    // A line comment can hold a brace in its prose ("{ "Jinn_EP1;common", ..."); it is not code.
    if (HTML[i] === '/' && HTML[i + 1] === '/' && /^\s*$/.test(HTML.slice(HTML.lastIndexOf('\n', i) + 1, i))) {
      i = HTML.indexOf('\n', i); continue;
    }
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return (HTML.slice(start - 6, start) === 'async ' ? 'async ' : '') + HTML.slice(start, i + 1);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const pp = require('../renderer/presetParser.js');
const sandbox = { window: {}, console, presetParser: pp };
vm.createContext(sandbox);
vm.runInContext(`
  var _text = '', _activeArrayIndex = 0, _parseResult = null, toasts = [], confirmChoice = 'confirm';
  const lineStarts = () => { const a = [0]; for (let i = 0; i < _text.length; i++) if (_text[i] === '\\n') a.push(i + 1); return a; };
  const off = (p) => lineStarts()[p.lineNumber - 1] + p.column - 1;
  const pos = (o) => { const a = lineStarts(); let l = 0; while (l + 1 < a.length && a[l + 1] <= o) l++; return { lineNumber: l + 1, column: o - a[l] + 1 }; };
  const model = {
    getValue: () => _text,
    getOffsetAt: off,
    getPositionAt: pos,
    getLineContent: (n) => _text.split('\\n')[n - 1],
    getValueInRange: (r) => _text.slice(off({ lineNumber: r.startLineNumber, column: r.startColumn }),
                                        off({ lineNumber: r.endLineNumber,   column: r.endColumn })),
  };
  var editor = { getValue: () => _text, getModel: () => model, focus() {}, trigger() {} };
  const _atomicEdit = (ed, tag, list) => {
    const spans = list.map(e => ({ s: off({ lineNumber: e.range.startLineNumber, column: e.range.startColumn }),
                                   e: off({ lineNumber: e.range.endLineNumber,   column: e.range.endColumn }), t: e.text }))
                      .sort((a, b) => b.s - a.s);
    for (let i = 1; i < spans.length; i++) if (spans[i].e > spans[i - 1].s) throw new Error('overlapping edits');
    for (const x of spans) _text = _text.slice(0, x.s) + x.t + _text.slice(x.e);
  };
  const _scheduleRebuild = () => {};
  const _refreshTileAbbreviations = () => {};
  const showToast = (m) => toasts.push(m);
  const promptConfirm = async (o) => { confirms.push(o); return confirmChoice; };
  ${extractFn('_allOf')}
  ${extractFn('_lineIndent')}
  ${extractFn('_bladeLinesEdits')}
  ${extractFn('_writeBladeLabels')}
  ${extractFn('_setBladeLabel')}
  ${extractFn('_removeBladeLabel')}
  ${extractFn('_scanDisabledPresets')}
  ${extractFn('_presetSlotOffsets')}
  ${extractFn('_reorderRunEdit')}
  ${extractFn('_slotRunEdit')}
  ${extractFn('_bladeDisplayName')}
  ${extractFn('_reorderBlades')}
  ${extractFn('_slotRange')}
  ${extractFn('_slotDeleteRange')}
  const EMPTY_SLOT_EXPR = 'StylePtr<Black>()';
  ${extractFn('_slotIsEmpty')}
  ${extractFn('_collapseBladeSlot')}
  ${extractFn('_followInsertPoint')}
  ${extractFn('_bulkFollowEdits')}
  ${extractFn('_disabledFollowEdits')}
  ${extractFn('_setBladeFollow')}
  ${extractFn('_removeBladeFollow')}
  ${extractFn('_enableBladeFollow')}
  var confirms = [];
`, sandbox);

const bank = (name, labels, a, b, c) => [
  `Preset ${name}[] = {`,
  ...(labels ? [`  // @jmt-labels: ${labels}`, ''] : []),
  `  { "${name}1", "",`,
  `    StylePtr<${a}>(),`,
  `    StylePtr<${b}>(),`,
  `    StylePtr<${c}>(),`,
  `    "${name}" },`,
  '};',
];
const cfg = (sithLabels, jediLabels) => [
  '#define NUM_BLADES 3',
  ...bank('sith', sithLabels, 'R1', 'R2', 'R3'),
  ...bank('jedi', jediLabels, 'B1', 'B2', 'B3'),
  'BladeConfig blades[] = { { 0, WS281XBladePtr<1>(), CONFIGARRAY(sith) } };',
].join('\n');
const parse = () => pp.parsePresets(sandbox._text);
const styles = (ai) => parse().arrays[ai].presets[0].styles.map(s => sandbox._text.split('\n')[s.startLine - 1].trim());
const labelLines = () => sandbox._text.split('\n').filter(l => l.includes('@jmt-labels'));

console.log('1. a bank without its own names shows the saber\'s');
sandbox._text = cfg('B1="Main Blade" B2="Crystal Chamber" B3="Board Accent"', null);
let a = parse().arrays;
check('the unnamed bank reads the names the other bank gives',
  a[1].labels[1] === 'Main Blade' && a[1].labels[3] === 'Board Accent', JSON.stringify(a[1].labels));
check('its own line is still told apart (ownLabels empty)', Object.keys(a[1].ownLabels).length === 0);
sandbox._text = cfg('B1="Main"', 'B1="Hilt" B2="Ring"');
a = parse().arrays;
check('a bank\'s own name wins over another bank\'s', a[1].labels[1] === 'Hilt' && a[0].labels[2] === 'Ring',
  JSON.stringify([a[0].labels, a[1].labels]));

console.log('2. naming and clearing write every bank');
sandbox._text = cfg('B1="Main Blade"', null);
sandbox._activeArrayIndex = 1;
vm.runInContext('_setBladeLabel(2, "Crystal Chamber")', sandbox);
let ll = labelLines();
check('both banks now carry the same line', ll.length === 2 && ll[0].trim() === ll[1].trim()
  && ll[0].includes('B1="Main Blade" B2="Crystal Chamber"'), JSON.stringify(ll));
check('the new line sits above the first preset with a blank after it',
  /\[\] = \{\n  \/\/ @jmt-labels: [^\n]*\n\n  \{ "jedi1"/.test(sandbox._text));
check('the config still parses to 3 blades in both banks',
  parse().arrays.every(x => x.presets[0].styles.length === 3));
vm.runInContext('_removeBladeLabel(1)', sandbox);
ll = labelLines();
check('clearing a name clears it in every bank', ll.length === 2 && ll.every(l => !l.includes('Main Blade')),
  JSON.stringify(ll));
vm.runInContext('_removeBladeLabel(2)', sandbox);
check('the last name takes the line out of every bank', labelLines().length === 0, sandbox._text);
check('and its blank line with it', !/\[\] = \{\n\n/.test(sandbox._text), sandbox._text);

console.log('3. moving a blade moves it in every bank');
sandbox._text = cfg('B1="Main" B2="Crystal" B3="Accent"', null);
sandbox._activeArrayIndex = 0;
vm.runInContext('_reorderBlades(0, 2)', sandbox);
check('the active bank moved', JSON.stringify(styles(0)) === JSON.stringify(['StylePtr<R2>(),', 'StylePtr<R3>(),', 'StylePtr<R1>(),']),
  JSON.stringify(styles(0)));
check('the other bank moved the same way', JSON.stringify(styles(1)) === JSON.stringify(['StylePtr<B2>(),', 'StylePtr<B3>(),', 'StylePtr<B1>(),']),
  JSON.stringify(styles(1)));
a = parse().arrays;
check('the names followed the blade, in both banks',
  a.every(x => x.labels[1] === 'Crystal' && x.labels[2] === 'Accent' && x.labels[3] === 'Main'),
  JSON.stringify(a.map(x => x.labels)));
check('and both banks carry the line', labelLines().length === 2);
check('the toast counts every bank\'s presets', /in 2 presets\./.test(sandbox.toasts.at(-1)), sandbox.toasts.at(-1));

console.log('4. deleting an over-count blade position takes it from every bank');
sandbox._text = [
  '#define NUM_BLADES 2',
  'Preset sith[] = {',
  '  // @jmt-labels: B1="Main" B2="Spare" B3="Accent"',
  '',
  '  { "s", "",', '    StylePtr<R1>(),', '    StylePtr<R2>(),', '    StylePtr<R3>(),', '    "s" },',
  '};',
  'Preset jedi[] = {',
  '  { "j", "",', '    StylePtr<B1>(),', '    StylePtr<B2>(),', '    StylePtr<B3>(),', '    "j" },',
  '};',
].join('\n');
sandbox._activeArrayIndex = 0;
sandbox.confirmChoice = 'confirm';
vm.runInContext('_collapseBladeSlot(2, 0)', sandbox).then(() => {
  a = parse().arrays;
  check('both banks lost blade 2', a.every(x => x.presets[0].styles.length === 2)
    && /StylePtr<B1>\(\),\s*StylePtr<B3>\(\)/.test(sandbox._text), sandbox._text);
  check('the names closed up in both banks', a.every(x => x.labels[1] === 'Main' && x.labels[2] === 'Accent' && !x.labels[3]),
    JSON.stringify(a.map(x => x.labels)));
  check('and both banks carry them', labelLines().length === 2);

  return follows();
}).then(() => {
  console.log('9. no path is left that writes one bank\'s lines');
  check('the per-bank writers are gone',
    !/_renumberLabelsEdit|_updateLabelPairInLine|_labelSyncEdits|_renumberFollowsEdit|_followDeclEdit|_followPairRemovalEdit|_updateFollowPairInLine/.test(HTML));

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
}).catch(e => { console.log('  FAIL threw: ' + e.stack); process.exit(1); });

// Follows: a Z-blade or a dual saber is two blades one style by how they are built, in every bank.
async function follows() {
  const followLines = () => sandbox._text.split('\n').filter(l => l.includes('@jmt-follow'));
  const withFollow = (follow) => cfg('B1="Main"', null).replace('// @jmt-labels: B1="Main"',
    `// @jmt-labels: B1="Main"\n  // @jmt-follow: ${follow}`);

  console.log('5. a bank without its own follow line follows the saber\'s');
  sandbox._text = withFollow('B3=B1');
  a = parse().arrays;
  check('the other bank reads B3 following B1', a[1].follows[3] === 1 && Object.keys(a[1].ownFollows).length === 0,
    JSON.stringify(a[1]));

  console.log('6. setting and clearing a follow writes every bank');
  sandbox._text = cfg('B1="Main"', null);
  sandbox._activeArrayIndex = 1;
  vm.runInContext('_setBladeFollow(3, 1)', sandbox);
  let fl = followLines();
  check('both banks carry B3=B1', fl.length === 2 && fl.every(l => l.trim() === '// @jmt-follow: B3=B1'), JSON.stringify(fl));
  check('it sits under the names line where there is one',
    /\/\/ @jmt-labels: B1="Main"\n  \/\/ @jmt-follow: B3=B1\n\n  \{ "sith1"/.test(sandbox._text), sandbox._text);
  check('and above the first preset, with a blank, where there is not',
    /jedi\[\] = \{\n  \/\/ @jmt-follow: B3=B1\n\n  \{ "jedi1"/.test(sandbox._text), sandbox._text);
  vm.runInContext('_removeBladeFollow(3)', sandbox);
  check('clearing it clears every bank', followLines().length === 0, sandbox._text);
  check('the names line keeps its blank before the first preset',
    /\/\/ @jmt-labels: B1="Main"\n\n  \{ "sith1"/.test(sandbox._text), sandbox._text);
  check('the bank that had only the follow line is back as it was', /jedi\[\] = \{\n  \{ "jedi1"/.test(sandbox._text), sandbox._text);

  console.log('7. turning follow on copies in every bank, and the dialog names the banks');
  sandbox._text = cfg(null, null);
  sandbox._activeArrayIndex = 0;
  sandbox.confirmChoice = true;
  vm.runInContext('confirms = []', sandbox);
  const on = await vm.runInContext('_enableBladeFollow(3, 1)', sandbox);
  const msg = vm.runInContext('confirms', sandbox)[0]?.message || '';
  check('it turned on', on === true);
  check('the dialog breaks the count down by bank', msg.includes('(sith 1, jedi 1)'), msg);
  check('each bank\'s B3 took its own preset\'s B1',
    styles(0)[2] === 'StylePtr<R1>(),' && styles(1)[2] === 'StylePtr<B1>(),', JSON.stringify([styles(0), styles(1)]));
  check('both banks carry the follow line', followLines().length === 2);

  // A red Missing placeholder (what a reorder leaves mid-preset) and the black default hold nothing
  // anyone wrote, so filling them is not replacing and asks nothing.
  sandbox._text = [
    '#define NUM_BLADES 3',
    ...bank('sith', null, 'R1', 'R2', 'MISSING_STYLE'),
    ...bank('jedi', null, 'B1', 'B2', 'Black'),
  ].join('\n');
  vm.runInContext('confirms = []', sandbox);
  const quiet = await vm.runInContext('_enableBladeFollow(3, 1)', sandbox);
  check('empty and Missing blades are filled without a dialog',
    quiet === true && vm.runInContext('confirms', sandbox).length === 0, JSON.stringify(vm.runInContext('confirms', sandbox)));
  check('and both took their B1', styles(0)[2] === 'StylePtr<R1>(),' && styles(1)[2] === 'StylePtr<B1>(),',
    JSON.stringify([styles(0), styles(1)]));

  console.log('8. a move writes names and follows into a bank that had neither, as one block');
  sandbox._text = withFollow('B3=B2');
  sandbox._activeArrayIndex = 0;
  vm.runInContext('_reorderBlades(0, 1)', sandbox);
  a = parse().arrays;
  check('the follow renumbered with the move, everywhere', a.every(x => x.ownFollows[3] === 1), JSON.stringify(a.map(x => x.ownFollows)));
  check('the names moved with it', a.every(x => x.ownLabels[2] === 'Main'), JSON.stringify(a.map(x => x.ownLabels)));
  check('the bank that had neither got both, names first, then a blank',
    /jedi\[\] = \{\n  \/\/ @jmt-labels: B2="Main"\n  \/\/ @jmt-follow: B3=B1\n\n  \{ "jedi1"/.test(sandbox._text), sandbox._text);
  sandbox._text = withFollow('B3=B2');
  vm.runInContext('_reorderBlades(2, 0)', sandbox);
  check('a move that inverts a follow drops it everywhere and says so',
    followLines().length === 0 && /no longer fits the new order/.test(sandbox.toasts.at(-1)), sandbox._text + '\n' + sandbox.toasts.at(-1));
}

// A style card shows the style's colours, and its window every colour argument: read from the code,
// nothing written back. [B-603]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');
const html = read('index.html');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(read('effect-args.js'), sandbox);
vm.runInContext(read('styleArgResolver.js'), sandbox);
const { styleColors } = sandbox.window.styleArgResolver;
const same = (a, b) => JSON.stringify(Array.from(a || [])) === JSON.stringify(b);

const full = `using Full = StylePtr<Layers<
  RgbArg<OFF_COLOR_ARG,Black>,
  RgbArg<CLASH_COLOR_ARG,White>,
  RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,
  RgbArg<BASE_COLOR_ARG,Red>,
  RgbArg<SWING_COLOR_ARG,Green>,
  IntArg<IGNITION_TIME_ARG,300>
>>();`;
const r = styleColors(full);
const names = Array.from(r.args).map(a => a.name);
check('registry order, not the order written', names.join() === 'BASE_COLOR_ARG,CLASH_COLOR_ARG,SWING_COLOR_ARG,OFF_COLOR_ARG', names.join());
check('an argument used twice shows once, with its first default', same(r.args[0].rgb16, [0, 0, 65535]));
check('a black default is a colour', same(r.args[3].rgb16, [0, 0, 0]));
check('arguments have the registry\'s names', r.args[0].label === 'Primary Base Color');
check('no main colour when there are arguments', r.main === null);

check('a default that is not a colour yet is left out',
  styleColors('Layers<RgbArg<BASE_COLOR_ARG,baseCOLOR>,RgbArg<ALT_COLOR_ARG,Red>>').args.length === 1);
check('a commented-out argument does not count',
  styleColors('using A = Layers<Blue /* RgbArg<BASE_COLOR_ARG,Red> */>;\n// RgbArg<ALT_COLOR_ARG,Red>').args.length === 0);

check('no arguments: the main colour', same(styleColors('using A = StylePtr<Layers<Red,AudioFlicker<Blue,White>>>();').main, [65535, 0, 0]));
check('the style\'s own name is not its colour', same(styleColors('using Red = StylePtr<Blue>();').main, [0, 0, 65535]));
check('nothing to show', styleColors('using A = StylePtr<Layers<Black>>();').main === null && styleColors('using A = StylePtr<Layers<Black>>();').args.length === 0);

check('the card\'s set, in his order', /_CARD_COLORS = \['BASE_COLOR_ARG', 'ALT_COLOR_ARG', 'BLAST_COLOR_ARG', 'CLASH_COLOR_ARG',\s+'LOCKUP_COLOR_ARG', 'STAB_COLOR_ARG', 'OFF_COLOR_ARG'\]/.test(html));
const shortNames = html.match(/const _COLOR_NAMES = \{[\s\S]*?\};/)[0];
const unnamed = Array.from(sandbox.window.proffieArgs.registry).filter(r => r.kind === 'RgbArg' && !shortNames.includes(r.name + ':')).map(r => r.name);
check('every colour argument has a short name', unnamed.length === 0, unnamed.join());
check('hovering a short name shows the real one, on the card and in the window', /style-card-color-name" title="\$\{c\.real\}"/.test(html) && /<span title="\$\{c\.real\}">\$\{c\.label\}<\/span>/.test(html));
check('a style with no arguments says Detected, as a preset slot does', /label: 'Detected'/.test(html));
check('the window lines its colours up in a grid', /\.detail-colors-wrap \{ display: grid/.test(html));
check('a card reads through helpers and segments', /_styleColorList\(_withSegmentBodies\(entry\.usingCode, \[\.\.\.helpers, \.\.\.segmentEntries\]\), true\)/.test(html));
check('the window shows every argument', /_styleColorList\(_withSegmentBodies\(usingCode, blocks\), false\)/.test(html));
check('the slot and the card share one main-colour reader', /return window\.proffieArgs \? window\.proffieArgs\.earliestColor\(text\) : null/.test(html));
check('each colour renders once, at idle, and its dots share it', /_colorDotImages\.set\(key, image\)/.test(html) && /requestIdleCallback\(\(\) => \{\s+_colorDotIdle = false/.test(html));
check('only the hovered dot animates', (html.match(/animated: true, width: 14/g) || []).length === 1 && /dot\.addEventListener\('mouseenter'/.test(html));
check('the colours sit at the foot of the card, and cards in a grid match', /\.style-card-colors \{[^}]*margin-top: auto/.test(html) && /\.style-cards \{[^}]*grid-auto-rows: 1fr/.test(html));

const balanced = eval(`(${html.match(/function _balancedColorColumns[\s\S]*?\n\}/)[0]})`);
check('colours that fit stay on one row', balanced(7, 675) === 7, balanced(7, 675));
check('10 in a width that fits 8 go 5 and 5', balanced(10, 675) === 5, balanced(10, 675));
check('9 go 5 and 4, 16 go 8 and 8, 17 go 6, 6 and 5', balanced(9, 675) === 5 && balanced(16, 675) === 8 && balanced(17, 675) === 6, [balanced(9, 675), balanced(16, 675), balanced(17, 675)].join());
check('a narrow window still balances', balanced(10, 300) === 4, balanced(10, 300));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

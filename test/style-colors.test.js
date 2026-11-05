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
const { styleColors, mainColor } = sandbox.window.styleArgResolver;
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

const noBase = styleColors('Layers<AudioFlicker<Rgb<135,0,255>,Blue>,RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,RgbArg<OFF_COLOR_ARG,Red>>');
check('no Base: the colour outside its arguments, beside them', same(noBase.main, [135 * 257, 0, 65535]) && noBase.args.length === 2, noBase.main);
check('an argument\'s default is not the detected colour',
  same(styleColors('Layers<RgbArg<CLASH_COLOR_ARG,Red>,AudioFlicker<Blue,White>>').main, [0, 0, 65535]));
check('only arguments, and no Base: nothing detected', styleColors('Layers<RgbArg<OFF_COLOR_ARG,Red>>').main === null);
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
check('a card reads through helpers and segments', /_styleColorList\(entry\.usingCode, \[\.\.\.helpers, \.\.\.segmentEntries\], true\)/.test(html) && /styleColors\(_withSegmentBodies\(code, blocks\),/.test(html));
check('the window shows every argument', /_styleColorList\(usingCode, blocks, false\)/.test(html));
const clashFirst = 'Layers<RgbArg<CLASH_COLOR_ARG,Red>,AudioFlicker<Blue,Cyan>>';
check('the main colour is read past the arguments', mainColor(clashFirst).matchStr === 'Blue');
check('and its place is where it sits in the code, so a slot can still edit it', clashFirst.slice(mainColor(clashFirst).matchIndex).startsWith('Blue,Cyan'));
check('only arguments: no main colour, so a slot falls to its last resort', mainColor('Layers<RgbArg<OFF_COLOR_ARG,Red>>') === null);
const blade = 'Layers<AudioFlicker<Blue,Cyan>,RgbArg<CLASH_COLOR_ARG,Red>,VolSeg<Blue>>';
const written = blade.replace('VolSeg<Blue>', 'AlphaL<RgbArg<BASE_COLOR_ARG,Blue>,Int<0>>');
const viaSegment = styleColors(written, blade);
check('a Base only a segment brings is not the style\'s Base', same(viaSegment.main, [0, 0, 65535]) && viaSegment.args.map(a => a.name).join() === 'CLASH_COLOR_ARG', viaSegment);
const ownBase = styleColors('Layers<RgbArg<BASE_COLOR_ARG,Green>,AlphaL<RgbArg<BASE_COLOR_ARG,Blue>,Int<0>>>', 'Layers<RgbArg<BASE_COLOR_ARG,Green>,VolSeg<Blue>>');
check('a style\'s own Base stands, with a segment beside it', ownBase.main === null && same(ownBase.args[0].rgb16, [0, 65535, 0]));
check('a segment\'s other colours still read', styleColors('Layers<Blue,RgbArg<CLASH_COLOR_ARG,Red>>', 'Layers<Blue,ClashSeg>').args.map(a => a.name).join() === 'CLASH_COLOR_ARG');
check('the card and the window read Base with the segments left out', /_withSegmentBodies\(code, blocks\.filter\(b => !b\.isSegment\)\)/.test(html));
check('the slot and the card share one main-colour reader', /return window\.styleArgResolver \? window\.styleArgResolver\.mainColor\(text\) : null/.test(html));
check('each colour renders once, at idle, and its dots share it', /_colorDotImages\.set\(key, image\)/.test(html) && /requestIdleCallback\(\(\) => \{\s+_colorDotIdle = false/.test(html));
check('only the hovered dot animates', (html.match(/animated: true, width: 14/g) || []).length === 1 && /dot\.addEventListener\('mouseenter'/.test(html));
check('the colours sit at the foot of the card, and cards in a grid match', /\.style-card-colors \{[^}]*margin-top: auto/.test(html) && /\.style-cards \{[^}]*grid-auto-rows: 1fr/.test(html));

check('the detected colour is named as the code spells it', styleColors('Layers<AudioFlicker<Rgb<135,0,255>,Blue>,RgbArg<OFF_COLOR_ARG,Red>>').mainText === 'Rgb<135,0,255>');
check('a colour in the window searches the code, as Ctrl+F does', /addEventListener\('click', \(\) => _findInDetailCode\(colors\[i\]\.find\)\)/.test(html)
  && /getContribution\('editor\.contrib\.findController'\)/.test(html) && /searchString: text, isRegex: false/.test(html) && /find\.moveToNextMatch\(\)/.test(html));
check('a colour on a card narrows to that slot and leaves the card shut', /data-slot-color="\$\{c\.slot\}\|\$\{c\.rgb16\.join\(\)\}"/.test(html) && /e\.stopPropagation\(\);\s+flipSlot\(el, i, _activeFilterSlots, _activeFilterSlotsMissing\);/.test(html));
check('a narrowed colour counts as filtering, and shows and clears as a chip', /_activeFilterSlots\.size > 0 \|\| _activeFilterSlotsMissing\.size > 0;/.test(html) && /case 'slot':\s+_activeFilterSlots\.delete\(v\)/.test(html)
  && /_activeFilterSlots = new Map\(\);\s+_activeFilterSlotsMissing = new Map\(\);\s+_activeFilterEffects = new Set\(\);/.test(html) && /&& _styleInSlotScope\(card\);/.test(html));

check('right-clicking a colour leaves it out, as a facet does, and clears as a chip', /e\.preventDefault\(\);\s+e\.stopPropagation\(\);\s+flipSlot\(el, i, _activeFilterSlotsMissing, _activeFilterSlots\);/.test(html)
  && /!\[\.\.\._activeFilterSlotsMissing\.keys\(\)\]\.some\(has\)/.test(html) && /case 'slot-without':\s+_activeFilterSlotsMissing\.delete\(v\)/.test(html));
check('Detected and Base are one slot, and the chip says Base', /slot: 'BASE_COLOR_ARG', label: 'Detected'/.test(html) && /`\$\{_COLOR_NAMES\[c\.slot\]\}: /.test(html));

const balanced = eval(`(${html.match(/function _balancedColorColumns[\s\S]*?\n\}/)[0]})`);
check('colours that fit stay on one row', balanced(7, 675) === 7, balanced(7, 675));
check('10 in a width that fits 8 go 5 and 5', balanced(10, 675) === 5, balanced(10, 675));
check('9 go 5 and 4, 16 go 8 and 8, 17 go 6, 6 and 5', balanced(9, 675) === 5 && balanced(16, 675) === 8 && balanced(17, 675) === 6, [balanced(9, 675), balanced(16, 675), balanced(17, 675)].join());
check('a narrow window still balances', balanced(10, 300) === 4, balanced(10, 300));

const { colorFamily, colorFamilies, namedColors } = sandbox.window.proffieArgs;
const family = (n) => colorFamily(namedColors[n]);
const expected = { Red: 'Red', HaltRed: 'Red', MistyRose: 'Red', Maroon: 'Red', SafetyOrange: 'Orange', Orange: 'Orange', Amber: 'Orange',
  SchoolBus: 'Yellow', Yellow: 'Yellow', LightYellow: 'Yellow', LimeZest: 'Green', Green: 'Green', Aquamarine: 'Green', Cyan: 'Cyan',
  MasterSwordBlue: 'Cyan', DeepSkyBlue: 'Blue', Blue: 'Blue', Purple: 'Purple', Magenta: 'Purple', HotPink: 'Pink', Pink: 'Pink',
  White: 'White', Snow: 'White', Ivory: 'White', AliceBlue: 'White' };
const wrong = Object.entries(expected).filter(([n, f]) => namedColors[n] && family(n) !== f).map(([n, f]) => `${n}=${family(n)} not ${f}`);
check('named colours land in the family you would expect', wrong.length === 0, wrong.join());
check('black has no family', family('Black') === null);
check('a custom colour has a family', colorFamily([65535, 2570, 0]) === 'Red' && colorFamily([0, 5140, 65535]) === 'Blue');
check('the families read as the wheel, nine of them', Array.from(colorFamilies).map(f => f.name).join() === 'Red,Orange,Yellow,Green,Cyan,Blue,Purple,Pink,White');
check('each family has a colour for its dot', Array.from(colorFamilies).every(f => namedColors[f.swatch]));
check('the picker and the filter share one wheel', /const _colorOrder = _pa\.colorOrder;/.test(html) && !/const _colorOrder = \(r16/.test(html));
check('a card is filed by Base or Detected only', /c\.real === 'BASE_COLOR_ARG' \|\| c\.label === 'Detected'/.test(html));
check('Color filters as the other dropdowns do', /&& _styleInColorScope\(card\) &&/.test(html) && /own !== 'color' && !_styleInColorScope/.test(html));
check('Color counts as filtering, and shows and clears as a chip', /_activeFilterColors\.size > 0 \|\| _activeFilterColorsMissing\.size > 0/.test(html)
  && /case 'color':\s+_activeFilterColors\.delete\(v\)/.test(html) && /case 'color-without':\s+_activeFilterColorsMissing\.delete\(v\)/.test(html)
  && /_activeFilterColors = new Set\(\);\s+_activeFilterColorsMissing = new Set\(\);\s+_activeFilterSlots = new Map\(\);/.test(html));
check('Color keeps its wheel order, with no sort bar', /fixedOrder: true/.test(html) && /fixedOrder \? '' : _facetSortBarHtml\(\)/.test(html));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

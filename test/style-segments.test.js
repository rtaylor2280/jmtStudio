// Style segments: a layer saved once and added to styles by name, where ProffieOS needs it. [B-177]
//
// Runs the real code out of renderer/index.html:
//   1. the file: a segment is a helper tagged @jmt:segment, sorted before the styles using it;
//   2. where it goes: last in the Layers, after the ignition, power save then battery then volume; a style that is
//      not a Layers is wrapped (Layers<A,L1,L2> is Layers<Layers<A,L1>,L2> in the source, so it is the same style);
//   3. already there, and the same layer written in (a swap);
//   4. effects read through segments, and the wiring.
'use strict';

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const fn = (name) => {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) return '';
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); }
  }
  return '';
};
const constLine = (name) => (html.match(new RegExp(`^const ${name} = .*$`, 'm')) || [''])[0];
const names = ['_styleExprHead', '_segmentRank', '_splitArgsRaw', '_addSegmentToExpr', '_swapNestedExact', '_withSegmentBodies', '_layerTint', '_colourDifference',
  '_segmentParams', '_segmentBodyWith', '_segmentRef', '_matchSegmentLayer', '_styleColoursFor', '_mapSegmentRefs', '_expandSegmentRefs',
  '_restateSegmentRefs', '_segmentColourArgs', '_parameteriseSegment',
  '_wrapSegmentLayers', '_buildHelperBlock', '_classifyStyleEntries', '_parseStyleEntries', '_parseStyleMeta', '_findUsingExprEnd'];
const missing = names.filter((n) => !fn(n));
check('located', !missing.length, missing.join(', '));
const env = new Function(`
  const _SL_CHARGING_SYMBOL_RE = /\\bChargeFullPropF\\b/; const _SL_PIXEL_RELAY_SYMBOL_RE = /\\bPixelRelayL?\\b/;
  ${constLine('_stripComments')}
  ${constLine('_SEGMENT_ORDER')}
  ${constLine('_COLOUR_RE')}
  ${constLine('_COLOUR_TOKEN')}
  ${names.map(fn).join('\n')}
  return { add: _addSegmentToExpr, block: _buildHelperBlock, classify: (t) => _classifyStyleEntries(_parseStyleEntries(t)),
    bodies: _withSegmentBodies, params: _segmentParams, ref: _segmentRef, match: _matchSegmentLayer, colours: _segmentColourArgs,
    param: _parameteriseSegment, restate: _restateSegmentRefs, expand: _expandSegmentRefs };`)();

const PS = { name: 'PowerSaveSeg',
  usingCode: 'using PowerSaveSeg = EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<0>>>;' };
const BAT = { name: 'BatterySeg',
  usingCode: 'using BatterySeg = TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>;' };
const VOL = { name: 'VolumeSeg',
  usingCode: 'using VolumeSeg = TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Blue>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>;' };
const GLOW = { name: 'GlowSeg', usingCode: 'using GlowSeg = TransitionEffectL<TrConcat<TrInstant,Red,TrFade<300>>,EFFECT_USER1>;' };
const SEGS = [PS, BAT, VOL, GLOW];
const IG = 'InOutTrL<TrWipe<300>,TrWipeIn<500>>';

console.log('1. the file');
const lib = [
  env.block('PowerSaveSeg', 'Dims the lit blade in 25% steps', '', PS.usingCode, true, true),
  env.block('Glow', '', '', 'using Glow = AudioFlicker<Blue,Cyan>;', true),
  `\n/*------ Mine ------*/\nusing Mine = Layers<Glow,${IG},PowerSaveSeg>;\n/*\nAdd to preset as StylePtr<Mine>()\n----*/\n`,
].join('');
check('a segment is written with its tag, and no position line', /\/\/ @jmt:segment\nusing PowerSaveSeg = /.test(lib) && !/position:/.test(lib), lib);
const es = env.classify(lib);
const seg = es.find((e) => e.name === 'PowerSaveSeg'), helper = es.find((e) => e.name === 'Glow'), style = es.find((e) => e.name === 'Mine');
check('it reads back as a segment, a helper in the file',
  seg && seg.isSegment && seg.isHelper && helper && !helper.isSegment && helper.isHelper && style && !style.isHelper,
  JSON.stringify(es.map((e) => [e.name, e.isSegment, e.isHelper])));
check('a style using it is listed in its uses', (seg.usedBy || []).join() === 'Mine', JSON.stringify(seg.usedBy));
const older = env.classify(lib.replace('// @jmt:segment\n', '// @jmt:segment\n// position: under\n'));
check('a segment saved with the old position line still reads as a segment', older.find((e) => e.name === 'PowerSaveSeg').isSegment === true);

console.log('2. where it goes: last, as Fett263 orders them');
const S = `Layers<Red,ResponsiveClashL<White>,${IG}>`;
check('any segment goes last, after the ignition', env.add(S, PS, SEGS).expr === `Layers<Red,ResponsiveClashL<White>,${IG},PowerSaveSeg>`, env.add(S, PS, SEGS).expr);
const preon = `Layers<Red,${IG},TransitionEffectL<TrConcat<TrInstant,White,TrFade<300>>,EFFECT_PREON>>`;
check('after preon and postoff too', env.add(preon, BAT, SEGS).expr === `${preon.slice(0, -1)},BatterySeg>`, env.add(preon, BAT, SEGS).expr);
const both = `Layers<Red,${IG},BatterySeg,VolumeSeg>`;
check('power save added after battery and volume still goes under them', env.add(both, PS, SEGS).expr === `Layers<Red,${IG},PowerSaveSeg,BatterySeg,VolumeSeg>`, env.add(both, PS, SEGS).expr);
check('battery added after volume goes under it', env.add(`Layers<Red,${IG},VolumeSeg>`, BAT, SEGS).expr === `Layers<Red,${IG},BatterySeg,VolumeSeg>`);
check('volume goes after battery', env.add(`Layers<Red,${IG},PowerSaveSeg,BatterySeg>`, VOL, SEGS).expr === `Layers<Red,${IG},PowerSaveSeg,BatterySeg,VolumeSeg>`);
check('any other segment is an effect: just under the ignition, readouts untouched',
  env.add(`Layers<Red,ResponsiveClashL<White>,${IG},PowerSaveSeg,VolumeSeg>`, GLOW, SEGS).expr === `Layers<Red,ResponsiveClashL<White>,GlowSeg,${IG},PowerSaveSeg,VolumeSeg>`,
  env.add(`Layers<Red,ResponsiveClashL<White>,${IG},PowerSaveSeg,VolumeSeg>`, GLOW, SEGS).expr);
check('an effect segment with no ignition at that level goes last', env.add('Layers<Red,ResponsiveClashL<White>>', GLOW, SEGS).expr === 'Layers<Red,ResponsiveClashL<White>,GlowSeg>');
const writtenBat = 'TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Int<10000>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>';
check('a battery layer written in (not a segment) still counts in the order', env.add(`Layers<Red,${IG},${writtenBat}>`, PS, SEGS).expr === `Layers<Red,${IG},PowerSaveSeg,${writtenBat}>`);
check('a style that is not a Layers is wrapped', env.add('CrystalWrap<Mine>', PS, SEGS).expr === 'Layers<CrystalWrap<Mine>,PowerSaveSeg>', env.add('CrystalWrap<Mine>', PS, SEGS).expr);
const cm = `Layers</* base */ Red,/* clash, */ ResponsiveClashL<White>,${IG} /* end */>`;
check('comments, even with commas, are kept and do not split', env.add(cm, PS, SEGS).expr === `Layers</* base */ Red,/* clash, */ ResponsiveClashL<White>,${IG} /* end */,PowerSaveSeg>`, env.add(cm, PS, SEGS).expr);

console.log('3. already there, a swap');
check('a style already using it says so', env.add(`Layers<Red,${IG},PowerSaveSeg>`, PS, SEGS).already === true);
const inline = `Layers<Red,${IG},EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<0>>>,BatterySeg>`;
const sw = env.add(inline, PS, SEGS);
check('power save written in: offered as a swap, and the segment takes its place in the order',
  sw.swap === true && sw.expr === `Layers<Red,${IG},PowerSaveSeg,BatterySeg>`, JSON.stringify(sw));
check('a different TransitionEffectL (clash) is not taken for it', !env.add(`Layers<Red,TransitionEffectL<TrInstant,EFFECT_CLASH>,${IG}>`, BAT, SEGS).swap);
{
  // 2026-11-04: a swap stays where the old layer was. Position is reported, never acted on.
  const OLD = 'EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<0>>>';
  const psUnder = `Layers<Red,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<0>>>,${IG},BatterySeg>`;
  const under = env.add(psUnder, PS, SEGS);
  check('a different version swaps where it stands, and says the position differs', under.swap === true && under.same === false && under.position === true
    && under.expr === `Layers<Red,PowerSaveSeg,${IG},BatterySeg>`, JSON.stringify(under));
  const PSCODE = PS.usingCode.replace(/^using\s+\w+\s*=\s*/, '').replace(/;\s*$/, '');
  const low = env.add(`Layers<Red,${PSCODE},${IG},BatterySeg>`, PS, SEGS);
  check('the same code is identical wherever it sits, and says the position differs', low.swap === true && low.same === true && low.position === true
    && low.expr === `Layers<Red,PowerSaveSeg,${IG},BatterySeg>`, JSON.stringify(low));
  const right = env.add(`Layers<Red,${IG},${PSCODE},BatterySeg>`, PS, SEGS);
  check('the same code where a new one would go has no position note', right.same === true && !right.position
    && right.expr === `Layers<Red,${IG},PowerSaveSeg,BatterySeg>`, JSON.stringify(right));
  const two = env.add(`Layers<Red,${OLD},${IG},${PSCODE}>`, PS, SEGS);
  check('two of a readout are left to the person', two.many === true && !two.expr, JSON.stringify(two));
  const namedAndOld = env.add(`Layers<Red,${OLD},${IG},PowerSaveSeg>`, PS, SEGS);
  check('the name beside another of the kind is more than one, not already', namedAndOld.many === true && !namedAndOld.already, JSON.stringify(namedAndOld));
  check('the name where it belongs is already, with no note', env.add(`Layers<Red,${IG},PowerSaveSeg>`, PS, SEGS).already === true && !env.add(`Layers<Red,${IG},PowerSaveSeg>`, PS, SEGS).position);
  const lowName = env.add(`Layers<Red,PowerSaveSeg,${IG}>`, PS, SEGS);
  check('the name in another position is already, and says so', lowName.already === true && lowName.position === true && !lowName.expr, JSON.stringify(lowName));
  const BLAST2 = { name: 'BlastTwo', usingCode: 'using BlastTwo = TransitionEffectL<TrInstant,EFFECT_BLAST>;' };
  check('a segment that is not a readout stays already, with no note', env.add(`Layers<Red,BlastTwo,${IG}>`, BLAST2, [BLAST2]).already === true && !env.add(`Layers<Red,BlastTwo,${IG}>`, BLAST2, [BLAST2]).position);
  const inner = `Mix<Int<1>,Red,Remap<Int<0>,Layers<Blue,${OLD}>>>`;
  const nested = env.add(`Layers<${inner},${IG}>`, PS, SEGS);
  check('a readout built into another layer is reported, and left out of a swap', nested.nested === true && !nested.swap, JSON.stringify(nested));
  const deep = env.add(`Layers<Mix<Int<1>,Red,Remap<Int<0>,Layers<Blue,${PSCODE}>>>,${IG}>`, PS, SEGS);
  check('the exact code at any depth becomes the name, and nothing else changes', deep.swap === true && deep.same === true
    && deep.expr === `Layers<Mix<Int<1>,Red,Remap<Int<0>,Layers<Blue,PowerSaveSeg>>>,${IG}>`, JSON.stringify(deep));
  const spaced = env.add(`Layers<Mix<Int<1>,Red,${PSCODE.replace(/,/g, ', ')}>,${IG}>`, PS, SEGS);
  check('spacing does not hide it', spaced.same === true && /Red,PowerSaveSeg>/.test(spaced.expr), JSON.stringify(spaced));
  check('a style that is not a Layers can hold it too', env.add(`Mix<Int<1>,Red,${PSCODE}>`, PS, SEGS).same === true);
  check('two exact copies inside are not guessed at', env.add(`Layers<Mix<Int<1>,${PSCODE},${PSCODE}>,${IG}>`, PS, SEGS).same !== true);
  // 2026-11-04: a segment of several layers answers for every readout it holds, and matches them side by side.
  const VOL = 'TransitionEffectL<TrInstant,EFFECT_VOLUME_LEVEL>', BATL = 'TransitionEffectL<TrInstant,EFFECT_BATTERY_LEVEL>', PSL = 'EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<0>>>';
  const SET = { name: 'SetSeg', usingCode: `using SetSeg = Layers<${PSL},${BATL},${VOL}>;` };
  const OLDB = 'TransitionEffectL<TrFade<9>,EFFECT_BATTERY_LEVEL>';
  const setRun = env.add(`Layers<Red,${IG},${PSL},${BATL},${VOL}>`, SET, [SET]);
  check('its layers side by side are an exact match, Layers<> or not', setRun.same === true && setRun.expr === `Layers<Red,${IG},SetSeg>`, JSON.stringify(setRun));
  const setSpaced = env.add(`Layers<Red,${IG},${PSL.replace(/,/g, ', ')}, ${BATL},${VOL}>`, SET, [SET]);
  check('spacing does not change that', setSpaced.same === true, JSON.stringify(setSpaced));
  const setInner = env.add(`Layers<Red,${IG},${OLD},AlphaL<${OLDB},Int<1>>>`, SET, [SET]);
  check('one of its readouts inside another layer counts as built in, not replaced', setInner.nested === true && !setInner.swap, JSON.stringify(setInner));
  const setOrder = env.add(`Layers<Red,${IG},${VOL},${BATL},${PSL}>`, SET, [SET]);
  check('the same layers in another order are a partial match: replaceable, position flagged', setOrder.swap === true && setOrder.same === false && setOrder.position === true, JSON.stringify(setOrder));
  const setOld = env.add(`Layers<Red,${IG},${OLD},${OLDB}>`, SET, [SET]);
  check('old layers of each readout it holds are replaced together', setOld.swap === true && setOld.same === false && setOld.expr === `Layers<Red,${IG},SetSeg>`, JSON.stringify(setOld));
  const setPart = env.add(`Layers<Red,${IG},${OLDB}>`, SET, [SET]);
  check('an old layer of just one of them still counts', setPart.swap === true && setPart.expr === `Layers<Red,${IG},SetSeg>`, JSON.stringify(setPart));
  check('two of one readout are left to the person', env.add(`Layers<Red,${IG},${OLD},${PSL},${OLDB}>`, SET, [SET]).many === true);
  check('the name alone is already', env.add(`Layers<Red,${IG},SetSeg>`, SET, [SET]).already === true);
  check('the name beside an old readout is more than one', env.add(`Layers<Red,${IG},${OLDB},SetSeg>`, SET, [SET]).many === true);
  const SETC = { name: 'SetC', usingCode: 'using SetC = Layers<TransitionEffectL<RgbArg<BASE_COLOR_ARG,baseCOLOR>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<RgbArg<BASE_COLOR_ARG,baseCOLOR>,EFFECT_VOLUME_LEVEL>>;', params: [{ name: 'baseCOLOR', def: 'Blue', arg: 'BASE_COLOR_ARG' }] };
  const setC = env.add(`Layers<Red,${IG},TransitionEffectL<RgbArg<BASE_COLOR_ARG,Green>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<RgbArg<BASE_COLOR_ARG,Green>,EFFECT_VOLUME_LEVEL>>`, SETC, [SETC]);
  check('a run in the style\'s own colour is exact, and keeps the colour', setC.same === true && setC.expr === `Layers<Red,${IG},SetC<Green>>`, JSON.stringify(setC));
  // 2026-11-04: a using holds one thing, so a pasted list of layers is wrapped when saved.
  const blockOf = (code) => env.block('Set', '', '', code, true, true);
  check('layers pasted into a segment are wrapped', blockOf('using Set = A<1>,B<2,3>,C;').includes('using Set = Layers<A<1>,B<2,3>,C>;'));
  check('a trailing comma from the paste is dropped', blockOf('using Set = A<1>, B<2>, ;').includes('Layers<A<1>, B<2>>;'));
  check('one layer is left as it is', blockOf('using Set = A<1,2>;').includes('using Set = A<1,2>;') && !blockOf('using Set = A<1,2>;').includes('Layers<'));
  check('a segment already in Layers is left as it is', blockOf('using Set = Layers<A,B>;').includes('using Set = Layers<A,B>;'));
  check('a helper is not wrapped', env.block('H', '', '', 'using H = A,B;', true, false).includes('using H = A,B;'));
  check('a layer that only has it nested inside is not replaced', env.add(`Layers<Red,AlphaL<${OLD},Int<1>>,${IG}>`, PS, SEGS).nested === true);
  check('a style that is not a Layers with it inside is reported too', env.add(OLD, PS, SEGS).nested === true);
  const BLASTSEG = { name: 'BlastSeg', usingCode: 'using BlastSeg = TransitionEffectL<TrInstant,EFFECT_BLAST>;' };
  const B1 = 'TransitionEffectL<TrFade<100>,EFFECT_BLAST>', B2 = 'TransitionEffectL<TrFade<200>,EFFECT_BLAST>';
  const blasts = env.add(`Layers<Red,${B1},${B2},${IG}>`, BLASTSEG, [BLASTSEG]);
  check('anything but a readout replaces only the first of several', blasts.swap === true && !blasts.many
    && blasts.expr === `Layers<Red,BlastSeg,${B2},${IG}>`, JSON.stringify(blasts));
  const blastExact = env.add(`Layers<Red,TransitionEffectL<TrInstant,EFFECT_BLAST>,${B2},${IG}>`, BLASTSEG, [BLASTSEG]);
  check('an effect with the same code is named where it is', blastExact.same === true
    && blastExact.expr === `Layers<Red,BlastSeg,${B2},${IG}>`, JSON.stringify(blastExact));
  const LOCK = { name: 'LockSeg', usingCode: 'using LockSeg = LockupTrL<AlphaL<White,Int<16000>>,TrWipe<100>,TrFade<300>,SaberBase::LOCKUP_NORMAL>;' };
  const MELT = 'LockupTrL<AlphaL<Orange,Int<16000>>,TrWipe<100>,TrFade<300>,SaberBase::LOCKUP_MELT>';
  const lockStyle = `Layers<Red,LockupTrL<AlphaL<Blue,Int<16000>>,TrWipe<100>,TrFade<300>,SaberBase::LOCKUP_NORMAL>,${MELT},${IG}>`;
  const lk = env.add(lockStyle, LOCK, [...SEGS, LOCK]);
  check('a lockup layer is recognised by its LOCKUP_ name, and the melt one is left', lk.swap === true && lk.same === false
    && lk.expr === `Layers<Red,LockSeg,${MELT},${IG}>`, JSON.stringify(lk));
  const LB = { name: 'LBSeg', usingCode: 'using LBSeg = ResponsiveLightningBlockL<Strobe<White,AudioFlicker<White,Blue>,50,1>,TrInstant,TrFade<100>>;' };
  const lb = env.add(`Layers<Red,ResponsiveLightningBlockL<Strobe<White,AudioFlicker<White,Blue>,50,1>,TrInstant,TrFade<100>>,${IG}>`, LB, [LB]);
  check('a Responsive...L layer is recognised by its template', lb.swap === true && lb.same === true && lb.expr === `Layers<Red,LBSeg,${IG}>`, JSON.stringify(lb));
  // 2026-10-30: a style using another power save BY NAME got a second one added, as if it had none.
  const PS20 = { name: 'PowerSave20',
    usingCode: 'using PowerSave20 = EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<6554>>,AlphaL<Black,Int<0>>>;' };
  const named = env.add(`Layers<Red,${IG},PowerSave20,BatterySeg>`, PS, [...SEGS, PS20]);
  check('another segment of the kind, by name, is a swap that names it, in its place', named.swap === true && named.same === false
    && named.other === 'PowerSave20' && named.expr === `Layers<Red,${IG},PowerSaveSeg,BatterySeg>`, JSON.stringify(named));
  check('a segment of another kind by name is not taken for it',
    !env.add(`Layers<Red,${IG},BatterySeg>`, PS, SEGS).swap);
  check('a lockup setting (LOCKUP_POSITION_ARG) is not taken for a lockup',
    !env.add(`Layers<Red,Mix<IntArg<LOCKUP_POSITION_ARG,16000>,Red,Blue>,${IG}>`, { name: 'MixSeg', usingCode: 'using MixSeg = Mix<Int<1>,Red,Blue>;' }, []).swap);
}

console.log('3d. a swap that is only a colour apart says so');
{
  const vol = (c) => `TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<${c},SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>`;
  const VSEG = { name: 'VolumeSeg', usingCode: `using VolumeSeg = ${vol('RgbArg<BASE_COLOR_ARG,Blue>')};` };
  const fb = env.add(`Layers<Red,${IG},${vol('RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>')}>`, VSEG, [VSEG]);
  check('a different fallback colour: named, and called a fallback', fb.swap && fb.same === false && fb.colours
    && fb.colours.theirs === 'Rgb<255,0,0>' && fb.colours.mine === 'Blue' && fb.colours.fallback === true, JSON.stringify(fb.colours));
  const FSEG = { name: 'FixedSeg', usingCode: `using FixedSeg = ${vol('White')};` };
  const fx = env.add(`Layers<Red,${IG},${vol('DodgerBlue')}>`, FSEG, [FSEG]);
  check('a different fixed colour: named, not a fallback', fx.swap && fx.colours && fx.colours.theirs === 'DodgerBlue' && fx.colours.mine === 'White' && fx.colours.fallback === false, JSON.stringify(fx.colours));
  const mixed = env.add(`Layers<Red,${IG},${vol('DodgerBlue')}>`, VSEG, [VSEG]);
  check("a preset's colour against a fixed one is not called a colour difference", mixed.swap && !mixed.colours, JSON.stringify(mixed));
  check('the question says which', /has this layer with a different fallback colour \(\$\{c\.theirs\} here, \$\{c\.mine\} in \$\{segName\}\)\. The fallback only shows when a preset sets no base colour\./.test(html)
    && /has this layer in a different colour \(\$\{c\.theirs\} here, \$\{c\.mine\} in \$\{segName\}\)\. The blade will show/.test(html));
}

console.log('3e. a segment that takes its colours from the style');
{
  const VBODY = 'TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,baseCOLOR>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>';
  const vUsing = `using VolSeg = ${VBODY};`;
  const ps = env.params('// @jmt:segment\ntemplate<class baseCOLOR = White>\n', vUsing);
  check('its parameter, default and the argument it is the fallback of are read', ps && ps.length === 1 && ps[0].name === 'baseCOLOR' && ps[0].def === 'White' && ps[0].arg === 'BASE_COLOR_ARG', JSON.stringify(ps));
  check('a template it cannot fill in (an int) is null', env.params('template<int N = 3>\n', 'using X = Int<N>;') === null);
  const VS = { name: 'VolSeg', usingCode: vUsing, params: ps };
  const vol = (c) => VBODY.replace('baseCOLOR', c);
  check('C++ needs the brackets: the default is VolSeg<>', env.ref(VS, ['White']) === 'VolSeg<>' && env.ref(VS, []) === 'VolSeg<>' && env.ref(VS, ['Rgb<255,0,0>']) === 'VolSeg<Rgb<255,0,0>>');
  check('a written layer in any colour matches, its colour read back', JSON.stringify(env.match(VS, vol('Rgb<255,0,0>'))) === '["Rgb<255,0,0>"]'
    && JSON.stringify(env.match(VS, vol('DodgerBlue'))) === '["DodgerBlue"]');
  check('a fixed colour (no RgbArg) does not match', env.match(VS, VBODY.replace('RgbArg<BASE_COLOR_ARG,baseCOLOR>', 'DodgerBlue')) === null);
  const style = (c) => `Layers<HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Black,50>,${IG},${vol(c)}>`;
  const sw = env.add(style('Rgb<255,0,0>'), VS, [VS]);
  check('a swap keeps the layer\'s own fallback colour: nothing changes on the blade', sw.swap && sw.same === true
    && sw.expr === `Layers<HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Black,50>,${IG},VolSeg<Rgb<255,0,0>>>`, JSON.stringify(sw));
  const ad = env.add(`Layers<HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Black,50>,${IG}>`, VS, [VS]);
  check('added new, it takes the style\'s own base colour', ad.expr === `Layers<HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Black,50>,${IG},VolSeg<Rgb<0,0,255>>>`, ad.expr);
  check('a style with no base colour of its own gets the default', env.add(`Layers<Red,${IG}>`, VS, [VS]).expr === `Layers<Red,${IG},VolSeg<>>`);
  check('one already there with <colours> counts as already there', env.add(`Layers<Red,${IG},VolSeg<Red>>`, VS, [VS]).already === true);
  const PSG = { name: 'PowerSaveSeg', usingCode: PS.usingCode, params: [] };
  check('the order still holds past a name with <colours>: power save goes under it',
    env.add(`Layers<Red,${IG},VolSeg<Red>>`, PSG, [PSG, VS]).expr === `Layers<Red,${IG},PowerSaveSeg,VolSeg<Red>>`);
  check('written in with the colour it was given', env.expand(`Layers<Red,VolSeg<Rgb<1,2,3>>>`, VS) === `Layers<Red,${vol('Rgb<1,2,3>')}>`
    && env.expand('Layers<Red,VolSeg<>>', VS) === `Layers<Red,${vol('White')}>`);
  check('a style naming it the old way is restated with its own colour',
    env.restate('using A = Layers<HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Black,50>,VolSeg>;', VS) === 'using A = Layers<HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Black,50>,VolSeg<Rgb<255,0,0>>>;');
  const found = env.colours(`using V = ${vol('White')};`);
  check('a fixed fallback is found, named after its argument (baseCOLOR, not ProffieOS\'s BASE_COLOR)',
    found.length === 1 && found[0].name === 'baseCOLOR' && found[0].colour === 'White' && found[0].arg === 'BASE_COLOR_ARG', JSON.stringify(found));
  const pz = env.param(`using V = ${vol('White')};`, found);
  check('and offered as a parameter with that default', pz.tmpl === 'template<class baseCOLOR = White>' && pz.code === `using V = ${VBODY};`, JSON.stringify(pz));
  check('LB_COLOR_ARG becomes lbCOLOR', env.colours('using L = AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Int<1>>;')[0].name === 'lbCOLOR');
  check('wired: offered on Create and on edit; an edit that changes what it takes updates its styles or saves a copy',
    /\(\{ tmpl: addTmpl, code: codeToWrite \} = await _offerColourParams\(newName, editorTmpl, codeToWrite\)\);/.test(html)
    && /\(\{ tmpl: editTmpl, code: editCode \} = await _offerColourParams\(targetName, editorTmpl, compacted\)\);/.test(html)
    && /middleText: 'Save as a copy', confirmText: 'Update them'/.test(html) && /_restateSegmentRefs\(u\.usingCode, restate\.seg\)/.test(html)
    && /if \(target\.isSegment && editTmpl !== editorTmpl\) await _useNewSegmentInLibrary\(targetName, null\);/.test(html)
    && /cancelText: 'Keep as is', confirmText: 'Let each style fill it in'/.test(html));
}

console.log('3c. Create Segment from Selection');
{
  const sel = new Function(`${constLine('_stripComments')}\n${fn('_styleExprHead')}\n${fn('_splitArgsRaw')}\n${fn('_layerFromSelection')}\nreturn _layerFromSelection;`)();
  const full = `using Mine =\n  Layers<\n    Red,\n    TransitionEffectL<\n      TrInstant,\n      EFFECT_BLAST\n    >,\n    ${IG}\n  >;`;
  check('a whole layer selected (with its comma) is offered', sel(full, 'TransitionEffectL<\n      TrInstant,\n      EFFECT_BLAST\n    >,') === 'TransitionEffectL<\n      TrInstant,\n      EFFECT_BLAST\n    >');
  check('the base is not a layer', sel(full, 'Red') === null && sel(full, 'Red,') === null);
  check('part of a layer is not offered', sel(full, 'TrInstant,\n      EFFECT_BLAST') === null);
  check('several whole layers side by side can be selected', sel('using M = Layers<Red,AlphaL<Blue,Int<1>>,AlphaL<Green,Int<2>>,AlphaL<Red,Int<3>>>;', 'AlphaL<Blue,Int<1>>,\n  AlphaL<Green,Int<2>>') === 'AlphaL<Blue,Int<1>>,AlphaL<Green,Int<2>>');
  check('a selection that stops mid-layer is not offered', sel('using M = Layers<Red,AlphaL<Blue,Int<1>>,AlphaL<Green,Int<2>>>;', 'AlphaL<Blue,Int<1>>,AlphaL<Green') === null);
  check('layers that are not side by side are not offered', sel('using M = Layers<Red,AlphaL<Blue,Int<1>>,X,AlphaL<Green,Int<2>>>;', 'AlphaL<Blue,Int<1>>,AlphaL<Green,Int<2>>') === null);
  check('the base is not offered with the layers', sel('using M = Layers<Red,AlphaL<Blue,Int<1>>>;', 'Red,AlphaL<Blue,Int<1>>') === null);
  check('a segment already used by name is not offered', sel('using M = Layers<Red,PowerSaveSeg>;', 'PowerSaveSeg') === null);
  check('a style that is not a Layers offers nothing', sel('using W = CrystalWrap<Mine>;', 'Mine') === null);
  const swapExact = new Function(`${constLine('_stripComments')}\n${fn('_styleExprHead')}\n${fn('_splitArgsRaw')}\n${fn('_swapExactLayer')}\nreturn _swapExactLayer;`)();
  const blast = 'TransitionEffectL<TrInstant,EFFECT_BLAST>';
  check('an exact layer is swapped for the name in its own place', swapExact(`Layers<Red,${blast},${IG}>`, 'TransitionEffectL< TrInstant, EFFECT_BLAST >', 'BlastSeg') === `Layers<Red,BlastSeg,${IG}>`);
  check('a near match (another colour) is not swapped', swapExact(`Layers<Red,TransitionEffectL<TrInstant,EFFECT_CLASH>,${IG}>`, blast, 'BlastSeg') === null);
  check('the base is never swapped', swapExact(`Layers<${blast},Red>`, blast, 'BlastSeg') === null);
  check('after a new segment saves: its style uses it, and exact copies elsewhere are offered',
    /if \(madeSegment\) await _useNewSegmentInLibrary\(newName, origin\);/.test(html)
    && /if \(styleName\) _segmentOrigin = \{ styleName, layer \};/.test(html)
    && /no longer has that layer, so it still has its own copy\./.test(html)
    && /'this layer written in \(each keeps its own colour\)' : 'this exact layer written in'/.test(html) && /Nothing changes on the blade\./.test(html)
    && /cancelText: 'Not now', \.\.\.\(mine \? \{ middleText: `Only \$\{mine\.entry\.name\}` \} : \{\}\),/.test(html)
    && /confirmText: all === 1 \? 'Use in 1 style' : `All \$\{all\} styles`/.test(html)
    && /this layer in a different colour\. \$\{near === 1 \? 'It keeps its' : 'They keep their'\} own copy for now\./.test(html)
    && /\(tip \? `<br><br><em>\$\{esc\(tip\)\}<\/em>` : ''\)/.test(html) && /if \(tip\) note = note \? `\$\{note\} \$\{tip\}` : tip;/.test(html)
    && /function _closeHelperEditor\(\) \{\s*_helperEditorMode = 'edit';\s*_helperEditorKind = 'helper';\s*_segmentOrigin = null;/.test(html));
  check('deleting one in use writes it into what uses it (helpers too), one undo; one taking values still warns',
    /confirmText: 'Delete and replace', confirmKind: 'primary' \}\)\) return;/.test(html) && /so every blade stays as it is\./.test(html)
    && /middleText: 'Delete and remove', confirmText: 'Delete and replace', confirmKind: 'primary'/.test(html) && /removeIt \? _removeTopLevelLayer\(user\.usingCode, target\.name\) : null/.test(html)
    && /\.filter\(e => e\.name !== entry\.name && re\.test\(_stripComments\(e\.usingCode\)\)\)\.map\(e => e\.name\);/.test(html)
    && /const plain = entry\.isSegment \? _segmentParams\(entry\.gapText, entry\.usingCode\) !== null : !_getHelperTemplateParams\(entry\.name\)\.length;/.test(html)
    && /takes values, so it cannot be written into what uses it\./.test(html)
    && /const title = `Delete \$\{kind\}`;/.test(html) && !/title:\s*`Delete Helper`/.test(html));
  check('wired: the style window right-click, shown only for such a selection, opening the Create segment form',
    /id: 'jmt-create-segment-from-selection',\s*label: 'Create Segment from Selection',\s*precondition: 'jmtLayerSelected',/.test(html)
    && /_showHelpersPane\(\);\s*_openHelperAdd\('segment'\);/.test(html));
}

console.log('4. effects through segments, and wiring');
check('a style using a segment reads its effects through it', /EFFECT_POWERSAVE/.test(env.bodies('Layers<Red,PowerSaveSeg>', [PS])));
check('cards and the detail panel scan through segments',
  /_scanEffects\(_withSegmentBodies\(entry\.usingCode, segmentEntries\)\)/.test(html) && /_scanEffects\(_withSegmentBodies\(usingCode, _librarySegments\(\)\)\)/.test(html));
check('the pane lists segments in their own group, helpers without them',
  /const helpers    = allEntries\.filter\(e =>  e\.isHelper && !e\.isSegment\);/.test(html)
  && /_addLibGroup\('helpers', 'Helpers', _HELPER_TIP, helpers\);\s*_addLibGroup\('segments', 'Segments', _SEGMENT_TIP, segmentEntries\);/.test(html)
  && /_openHelperAdd\(key === 'segments' \? 'segment' : 'helper'\)/.test(html));
check('B-578: no panel until one exists; Create makes the first; width only by a drag; one group open',
  /helpersPanel\.style\.display = \(helpers\.length \|\| segmentEntries\.length \|\| _helperEditorMode === 'add'\) \? '' : 'none';/.test(html)
  && /id="btn-styles-create-helper"/.test(html) && /id="btn-styles-create-segment"/.test(html)
  && /pick\('segment'\)/.test(html) && /if \(!entries\.length\) return;/.test(html)
  && /\.forEach\(g => g\.classList\.toggle\('collapsed', g\.dataset\.group !== key\)\);/.test(html)
  && !/_computeHelpersSidebarWidth|_applySidebarWidth|_onHelperEditorOpened/.test(html));
check('folded, the pane shows HELPERS and SEGMENTS labels', /data-go="helpers"[^>]*>HELPERS</.test(html) && /data-go="segments"[^>]*>SEGMENTS</.test(html));
check('no Position anywhere: no control, no state, no tip', !/helper-segment-position|_SEGMENT_POSITION|segmentPosition|_inferSegmentPosition|noIgnition/.test(html));
check('Add Segment in the style window (on screen, one undo) and on a card\'s right-click',
  /id="btn-style-detail-add-segment"/.test(html) && /executeEdits\('add-segment'/.test(html)
  && /segItem\.textContent = 'Add style segment';/.test(html) && /_addSegmentToLibraryStyle\(styleName, segName\)/.test(html));

console.log('3b. a swap says whether the written-in layer is the same code');
{
  const same = env.add(`Layers<Red,${IG},EffectSequence<EFFECT_POWERSAVE, AlphaL<Black,Int<8192>>, AlphaL<Black,Int<16384>>, AlphaL<Black,Int<0>>>>`, PS, SEGS);
  const diff = env.add(`Layers<Red,${IG},EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<0>>>>`, PS, SEGS);
  check('the same code, laid out differently: same', same.swap && same.same === true, JSON.stringify(same));
  check('a two-step power save against a three-step segment: not the same', diff.swap && diff.same === false, JSON.stringify(diff));
  check('an identical replacement is not asked; a different version is', /if \(r\.swap && !r\.same\) \{/.test(html)
    && /has a different version of this layer\. The blade will do what \$\{segName\} does instead\./.test(html));
  check('Copy Style writes segments and helpers in', /const indep = _independentStyle\(built\.expr\);\s*const copyExpr = indep\.error \? built\.expr : indep\.expr;/.test(html)
    && /parts\.push\(`StylePtr<\$\{copyExpr\}>\(\)`\);/.test(html));
}

console.log('4b. what they mean, on hover');
check('Helpers and Segments say what they are',
  /const _HELPER_TIP = 'Named style code used by name/.test(html) && /const _SEGMENT_TIP = 'A layer added to styles by name/.test(html)
  && /set\(document\.getElementById\('btn-styles-create-helper'\), _HELPER_TIP\);/.test(html)
  && /set\(document\.getElementById\('btn-styles-create-segment'\), _SEGMENT_TIP\);/.test(html));
check('no em dash in what the user reads', !/—/.test((html.match(/const _HELPER_TIP = [^\n]*\nconst _SEGMENT_TIP = [^\n]*/) || [''])[0]));

console.log('5. a name ProffieOS or an add-on already owns');
{
  const win = {};
  new Function('window', 'globalThis', fs.readFileSync(path.join(__dirname, '..', 'renderer', 'proffie-names.js'), 'utf8'))(win, win);
  check('the generated list has ProffieOS names', win.PROFFIE_NAMES && ['VolumeLevel', 'BatteryLevel', 'Red', 'Layers', 'InOutTrL', 'EffectSequence'].every((n) => win.PROFFIE_NAMES.has(n)));
  const LIBTEXT = 'using Mine = Layers<Red,ChargeFullPropF<Int<1>>,InOutTrL<TrWipe<300>,TrWipeIn<500>>>;\nusing Other = Layers<Blue,Mine>;\n';
  const clash = new Function('window', 'LIB', `let _stylesEditorInstance = { getValue: () => LIB }; let _silentStylesText = null;
    ${fn('_parseStyleEntries')}\n${fn('_parseStyleMeta')}\n${fn('_findUsingExprEnd')}\n${fn('_styleNameOutsideClash')}
    return _styleNameOutsideClash;`)(win, LIBTEXT);
  check('VolumeLevel is refused, and says why', /VolumeLevel is a ProffieOS name/.test(clash('VolumeLevel')), clash('VolumeLevel'));
  check('a name the library uses but does not define (an add-on) is refused', /ChargeFullPropF is already used in 1 of your styles/.test(clash('ChargeFullPropF')), clash('ChargeFullPropF'));
  check('an ordinary new name, and an entry keeping its own name, pass', clash('VolumeLevelSeg') === '' && clash('Mine') === '' && clash('VolumeLevel', 'VolumeLevel') === '');
  check('the shared name check uses it, and the helper editor and its Add refuse it',
    /return _styleNameOutsideClash\(n\);/.test(html) && /nameError = _styleNameOutsideClash\(name, _helperEditorMode === 'edit' \? _helperEditorOrigName : ''\);/.test(html)
    && /const clash = _styleNameOutsideClash\(newName\);/.test(html));
  check('renaming away from a ProffieOS name changes only the definition',
    /&& !\(window\.PROFFIE_NAMES && window\.PROFFIE_NAMES\.has\(_helperEditorOrigName\)\);/.test(html));
  check('such an entry is never written into a style (Test, effects)',
    /if \(window\.PROFFIE_NAMES && window\.PROFFIE_NAMES\.has\(e\.name\)\) continue;/.test(html)
    && /window\.PROFFIE_NAMES && window\.PROFFIE_NAMES\.has\(s\.name\)\) continue;/.test(html));
  check('the list loads before the app', /<script src="\.\/effect-args\.js"><\/script>\s*<script src="\.\/proffie-names\.js"><\/script>/.test(html));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

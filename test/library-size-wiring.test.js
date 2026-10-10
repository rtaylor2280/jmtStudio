// The library size readout has to be REACHABLE, not just correct.  [B-318]
//
// soundFontLibrarySize.js and its unit tests can be perfect while the footer stays blank forever,
// because every link in the chain is in a different file: module -> IPC handler -> preload bridge
// -> renderer call -> an element that exists in the markup. A unit test sees none of that. This
// file walks the chain.
//
// It also pins the two design decisions that a later edit would quietly undo:
//   - the figure recomputes unconditionally, so no mutating operation has to remember anything
//   - the swatch legend renders into its own span, so it cannot wipe the size readout beside it
//
// Run: node test/library-size-wiring.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const main = read('main.js');
const pre  = read('preload.js');
const H    = read('renderer/index.html');
const mod  = read('soundFontLibrarySize.js');

console.log('library size wiring');

// ── the chain, link by link ───────────────────────────────────────────────────
ok('the module exports what the handler needs',
   /module\.exports\s*=\s*\{[^}]*\bread\b[^}]*\brefresh\b/s.test(mod));
ok('main.js requires it',
   /require\('\.\/soundFontLibrarySize'\)/.test(main));
ok('main.js exposes soundFonts:size',
   /ipcMain\.handle\('soundFonts:size'/.test(main));
ok('the handler calls BOTH read and refresh',
   /soundFontLibrarySize\.read\(/.test(main) && /soundFontLibrarySize\.refresh\(/.test(main),
   'read is what goes on screen now; refresh is what makes it true');
ok('preload bridges it', /soundFontsSize:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('soundFonts:size'\)/.test(pre));
ok('preload bridges the push channel too',
   /onSoundFontsSizeUpdated:/.test(pre) && /ipcRenderer\.on\('soundFonts:sizeUpdated'/.test(pre),
   'without this the first figure a user sees is never replaced by the fresh one');
ok('main.js actually sends on that channel',
   /send\('soundFonts:sizeUpdated'/.test(main));
ok('the renderer calls the bridge',
   /electronAPI\.soundFontsSize\(\)/.test(H));
ok('the renderer subscribes to the push channel',
   /electronAPI\.onSoundFontsSizeUpdated/.test(H));

// ── the element it renders into has to exist ──────────────────────────────────
ok('#sf-lib-size is in the markup',
   /id="sf-lib-size"/.test(H),
   'getElementById returns null and the function returns silently — a blank footer, no error');
ok('#sf-lib-size has styling',
   /#sf-lib-size\s*\{/.test(H));
{
  // The footer bar collapsed in testing because the readout was absolutely positioned: with no
  // config open the swatch legend is empty, so the bar had no in-flow content, shrank to its
  // padding, and the figures spilled off the bottom of the window where they could not even be
  // hovered. Both children have to be real grid items.
  const bar = /#sf-legend\.styles-legend\s*\{([^}]*)\}/.exec(H);
  const size = /#sf-lib-size\s*\{([^}]*)\}/.exec(H);
  ok('the footer bar lays out as a grid', !!bar && /display:\s*grid/.test(bar[1]),
     'flex with an out-of-flow child is how the bar lost its height');
  ok('and it keeps a third column so the legend centres on the BAR',
     !!bar && /grid-template-columns:\s*1fr\s+auto\s+1fr/.test(bar[1]),
     'without the trailing 1fr the legend centres on the leftover space, not the bar');
  ok('the readout is in flow, not absolutely positioned',
     !!size && !/position:\s*absolute/.test(size[1]),
     'an out-of-flow readout contributes no height and the bar collapses when the legend is empty');
  ok('the readout is hit-testable despite the bar disabling pointer events',
     !!size && /pointer-events:\s*auto/.test(size[1]),
     '.styles-legend sets pointer-events:none, which kills the tooltip without this');

  // Explicit grid-column placement does NOT reorder the flow: auto-placement refuses to go
  // backwards, so a child written first and placed in a later column takes row 1 by itself and
  // shunts the other onto row 2. That happened, and it put the figures on their own line.
  const items = /#sf-legend-items\s*\{([^}]*)\}/.exec(H);
  const colOf = (m) => { const c = m && /grid-column:\s*(\d+)/.exec(m[1]); return c ? +c[1] : null; };
  const domOrder = H.indexOf('id="sf-legend-items"') < H.indexOf('id="sf-lib-size"');
  ok('both footer children are explicitly placed', colOf(items) !== null && colOf(size) !== null);
  ok('DOM order matches column order, so they share one row',
     domOrder === (colOf(items) < colOf(size)),
     'the earlier element must sit in the earlier column or the bar wraps to two rows');
}
ok('#sf-legend-items is in the markup',
   /id="sf-legend-items"/.test(H));

// ── the readout is actually invoked, not merely defined ───────────────────────
{
  // The whole defect class this file exists for: a complete, tested, unreachable feature.
  const callers = (H.match(/_sfRequestLibrarySize\?\.\(\)|_sfRequestLibrarySize\(\)/g) || []).length;
  ok(`_sfRequestLibrarySize has a real caller (${callers} call sites)`, callers >= 1,
     'defined and never called is the exact shape that passes every unit test and does nothing');
  const inRefresh = /window\.refreshSoundFontsView\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]{0,600}?_sfRequestLibrarySize/.test(H);
  ok('and it is called from refreshSoundFontsView', inRefresh,
     'that funnel is the end of every library-changing path; anywhere else leaves holes');
}

// ── the recompute-always decision ─────────────────────────────────────────────
ok('no staleness API survives in the module',
   !/function markStale|function isStale|function ensureFresh/.test(mod),
   'reintroducing it reintroduces the hole: one operation forgets and the figure is silently wrong');
ok('nothing still calls a staleness API',
   !/markStale|isStale|ensureFresh/.test(main) && !/soundFontsSizeStale/.test(pre + H),
   'a leftover call would be a reference error at the moment the user opens the panel');
ok('the handler guards against stacking walks',
   /_sfSizeWalk/.test(main),
   'a refresh per panel reload with no guard means N concurrent walks of 15,000 files');

// ── the legend must not wipe the size beside it ───────────────────────────────
{
  // Both live in #sf-legend. The legend re-renders on every config edit; if it still wrote to the
  // bar's innerHTML it would delete the size readout and the footer would blank mid-session.
  //
  // Scoped to the SF function on purpose. The Style Library footer has its own `legendEl` holding
  // #styles-legend, which still legitimately hides itself — an unscoped match reads that one and
  // fails for the wrong reason.
  const at = H.indexOf("getElementById('sf-legend')");
  ok('the SF legend render block is findable', at > 0);
  const block = H.slice(at, at + 4000);
  // Control: the window has to actually REACH the write it is judging, or the two checks below
  // pass by looking at nothing.
  ok('the scoped window reaches the legend write',
     /itemsEl\.innerHTML\s*=\s*items\.join/.test(block),
     'the 4000-char window is too short — the assertions below would be vacuous');
  ok('the legend renders into #sf-legend-items, not into the bar',
     /getElementById\('sf-legend-items'\)/.test(block) && !/legendEl\.innerHTML\s*=/.test(block),
     'legendEl.innerHTML = ... erases #sf-lib-size on the next config keystroke');
  ok('the legend no longer hides the whole bar',
     !/legendEl\.style\.display/.test(block),
     'display:none on the bar takes the size readout down with it');
  ok('and the bar is not shipped hidden',
     !/id="sf-legend"[^>]*display\s*:\s*none/.test(H),
     'the footer is persistent now — it carries the size whether or not any swatch applies');
}

// ── the claim the tooltip makes has to be backed by the figure ────────────────
{
  // Every field the tooltip prints must be one compute() actually returns, or the user hovers a
  // number the feature exists to let them verify and reads "undefined".
  const fields = ['apparent', 'onDisk', 'saved', 'files', 'folders', 'distinct'];
  const computed = /return \{\s*schema: SCHEMA,([\s\S]*?)\};/.exec(mod);
  ok('compute() returns every field the readout prints',
     !!computed && fields.every(f => computed[1].includes(f)),
     'missing: ' + fields.filter(f => !computed || !computed[1].includes(f)).join(', '));
  ok('the tooltip carries exact bytes, not just the rounded figure',
     /toLocaleString\(\)/.test(H) && /figure\.apparent/.test(H),
     'the rounded GB cannot be reconciled against a Properties dialog; the byte count can');
}

console.log(failed ? `\n${failed} FAILURE(S)` : '\nall library size wiring checks passed');
process.exit(failed ? 1 : 0);

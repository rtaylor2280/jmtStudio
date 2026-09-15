/**
 * A form that cannot produce an import must not open  [B-363, second half]
 *
 * The first half of this entry fixed the REVIEW screen: an already-owned font
 * arrives unchecked with a green have-it note, and the user may still check it
 * and rename it. That was the right answer for a MIXED import — some new fonts,
 * some owned.
 *
 * This half is the case where the review screen has nothing to offer at all.
 * The source is new — different bytes, a different download, so the
 * source-level duplicate prompt does not fire — but every font inside it
 * already exists in the library by content, possibly under other names. The
 * user would fill in vendor, website, link, acquisition date, notes and proof
 * of purchase, press Add to Library, and import nothing.
 *
 * ⭐ Ryan, dev test 2026-09-14: "if there's nothing to import at all... then it
 * shouldn't even get to the import screen." And on the door that stays open:
 * "don't block them. they want to they can. will potentially need a new name
 * but that's ok."
 *
 * ⚠️ THE DANGEROUS DIRECTION IS A FALSE POSITIVE. Intercepting when there IS
 * something to import takes a real import away from the user and leaves no way
 * to reach it. So the predicate must answer "carry on to the review" for every
 * uncertainty — a failed match, a short result set, one unmatched candidate —
 * and most of this file is about proving it does.
 *
 * Run: node test/nothing-to-import-intercept.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Lift a function out of the page by walking its braces, so the real shipped
// body is what runs below — not a copy of it that can drift.
const lift = (name) => {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let i = html.indexOf('{', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return html.slice(start, end);
};

// ── the predicate, executed for real ───────────────────────────────────────
//
// It reads `_sfImport` from its enclosing scope, so the harness supplies one
// and hands back a setter. Everything else is pure.
let setImport, nothingLeft;
{
  const src = `let _sfImport = null;
${lift('_sfNothingLeftToImport')}
return { set: (v) => { _sfImport = v; }, fn: _sfNothingLeftToImport };`;
  const h = new Function(src)();
  setImport = h.set; nothingLeft = h.fn;
  ok('the predicate lifted and compiled', typeof nothingLeft === 'function');
}

const owned   = (name, matchName) => ({ name, path: `/p/${name}`, fullyOwned: true,  matchName });
const variant = (name)            => ({ name, path: `/p/${name}`, fullyOwned: false, matchName: name });
const cands   = (...names)        => names.map(n => ({ name: n, path: `/p/${n}` }));

// ── it fires when, and only when, nothing can be imported ──────────────────
{
  setImport({ candidates: cands('Maul') });
  const hit = nothingLeft({ ok: true, results: [owned('Maul', 'Maul Redux')] });
  ok('⭐ one candidate, fully owned → intercept', !!hit && hit.length === 1);
  ok('and it hands back the matched rows, so the dialog can name them',
     !!hit && hit[0].matchName === 'Maul Redux',
     'the names differ on purpose — that is the whole reason this dialog exists');

  setImport({ candidates: cands('Maul', 'Vader', 'Ahsoka') });
  ok('⭐ a whole bundle, every font owned → intercept',
     !!nothingLeft({ ok: true, results: [owned('Maul', 'Maul'), owned('Vader', 'Vader'), owned('Ahsoka', 'A2')] }));
}

// ── every uncertainty carries on to the review ─────────────────────────────
//
// ⚠️ These are the assertions that keep a real import reachable. Each one is a
// way the match can come back less than certain, and every one of them must
// return null.
{
  setImport({ candidates: cands('Maul', 'Vader') });
  ok('⭐ one owned + one NOT owned → no intercept',
     nothingLeft({ ok: true, results: [owned('Maul', 'Maul'), variant('Vader')] }) === null,
     'this is the mixed case the first half of B-363 already handles correctly');

  ok('⭐ fewer results than candidates → no intercept',
     nothingLeft({ ok: true, results: [owned('Maul', 'Maul')] }) === null,
     'the backend SKIPS a candidate it cannot match (continue, not a null row), so a '
     + 'short result set means an unmatched font — something to import');

  ok('a failed match → no intercept', nothingLeft({ ok: false, error: 'boom' }) === null);
  ok('a null match → no intercept',   nothingLeft(null) === null);
  ok('ok but no results array → no intercept', nothingLeft({ ok: true }) === null);
  ok('an empty result set → no intercept', nothingLeft({ ok: true, results: [] }) === null);
  ok('a null row among the results → no intercept',
     nothingLeft({ ok: true, results: [owned('Maul', 'Maul'), null] }) === null);

  setImport({ candidates: [] });
  ok('no candidates at all → no intercept',
     nothingLeft({ ok: true, results: [] }) === null,
     'an archive with no font in it is B-296, a different answer entirely');

  setImport(null);
  ok('no import in flight → no intercept', nothingLeft({ ok: true, results: [] }) === null);
}

// ── the interception sits on the FRESH path, and only there ────────────────
//
// ⚠️ Add-more and duplicate mode reach _sfPopulateReview by their own routes
// and BOTH expect to be looking at fonts the library already holds. Fire this
// there and their whole purpose breaks. Anchoring on the call sites themselves
// rather than a line range, because a range moves and a call site does not.
{
  const sites = [];
  const re = /_sfPopulateReview\(sourcePath\)/g;
  let m; while ((m = re.exec(html))) sites.push(m.index);
  ok('all three _sfPopulateReview(sourcePath) call sites still exist', sites.length === 3,
     `${sites.length} found`);

  const showAt = html.indexOf('_sfShowDuplicateFont(_allOwned');
  ok('the interception is wired at exactly one place', showAt > 0
     && html.indexOf('_sfShowDuplicateFont(_allOwned', showAt + 1) === -1);

  // It must precede the FIRST call site and follow no other.
  ok('⭐ it runs BEFORE the fresh-import review renders',
     showAt > 0 && showAt < sites[0],
     'intercepting after _sfPopulateReview would mean the form was already built');
  ok('⭐ and it is nowhere near the add-more / duplicate call sites',
     showAt < sites[1] && showAt < sites[2],
     'those two modes EXPECT already-owned fonts — an interception there is a bug');

  // The guard that makes it safe to await mid-flow.
  const win = html.slice(showAt - 900, showAt + 400);
  ok('the run-id guard is re-checked after the match await',
     /_sfImport\.runId !== myRun/.test(win),
     'the user can still press Cancel while the match is running');
}

// ── one match, two readers ─────────────────────────────────────────────────
{
  ok('the match is funnelled through a single helper',
     html.includes('async function _sfMatchCandidatesOnce()'));
  const direct = (html.match(/electronAPI\.matchSourceCandidates\(/g) || []).length;
  ok('⭐ and nothing calls the IPC directly any more', direct === 1,
     `${direct} direct calls — the only one allowed is inside _sfMatchCandidatesOnce`);
  ok('the review screen reads through the helper too',
     html.includes('_sfMatchCandidatesOnce().then('),
     'otherwise the fresh path pays for the same answer twice');
  // ⚠️ Keyed by runId and stored on _sfImport, NOT a module-level Map: cancel an
  // import and pick the same folder again and the second run must look afresh —
  // the first run may have put those very fonts in the library.
  const helper = lift('_sfMatchCandidatesOnce');
  ok('the cached answer is keyed to the import run',
     /_matchRunId === _sfImport\.runId/.test(helper) && /_sfImport\._matchRunId =/.test(helper),
     helper.slice(0, 200));
}

// ── the dialog, and the door that must stay open ───────────────────────────
{
  ok('the dialog markup exists', html.includes('id="modal-sf-duplicate-font"'));
  for (const id of ['sf-dupfont-title', 'sf-dupfont-body', 'sf-dupfont-open',
                    'sf-dupfont-import', 'sf-dupfont-cancel']) {
    ok(`  #${id} is present`, html.includes(`id="${id}"`));
  }
  const els = html.slice(html.indexOf('const _sfDupFontEls = {'),
                         html.indexOf('const _sfDupFontEls = {') + 520);
  for (const id of ['sf-dupfont-open', 'sf-dupfont-import', 'sf-dupfont-cancel']) {
    ok(`  and #${id} is actually looked up`, els.includes(id),
       'markup with no handle behind it is the silent half of a dead button');
  }

  const dlg = lift('_sfShowDuplicateFont');
  // ⭐⭐ NOT A BLOCK. Ryan rejected the disabled checkbox on 2026-09-13 for the
  // same reason: the app may say "you already have this", never "you may not".
  ok('⭐ import-anyway resolves TRUE, so the review still opens',
     /const onImport = \(\) => \{[^}]*resolve\(true\)/.test(dlg),
     dlg.slice(dlg.indexOf('const onImport'), dlg.indexOf('const onImport') + 120));
  ok('open-existing and cancel resolve FALSE',
     /resolve\(false\)/.test(dlg) && (dlg.match(/resolve\(false\)/g) || []).length === 2);
  ok('missing markup never traps the import',
     /if \(!els\.modal\) \{ resolve\(true\)/.test(dlg),
     'a dialog that failed to load must fall through to the review, not deadlock');

  // Both names, or the dialog cannot answer "no, mine is called something else".
  //
  // ⚠️ THIS CHECK USED TO BE THREE SUBSTRING GREPS AND WAS VACUOUS: a mutant that
  // hard-wired the name comparison to false still contained every one of those
  // strings, so this passed while the behaviour it names was gone. Caught by
  // mutation-testing the suite on 2026-09-14 — the same "passes for the wrong
  // reason" shape that cost seven instruments that day. It now asserts the GATE,
  // which is the thing that can actually break.
  ok('⭐ the copy names what arrived AND what it matched',
     dlg.includes('m.matchName') && dlg.includes('m.name')
       && /you have it as/.test(dlg)
       && /from\.toLowerCase\(\) !== to\.toLowerCase\(\)/.test(dlg),
     'both names, and a live comparison deciding whether to show the second');
  ok('identical names collapse to one, rather than saying "X — you have it as X"',
     /return \(to && from\.toLowerCase\(\) !== to\.toLowerCase\(\)\)/.test(dlg),
     'the ternary must still be GATED on that comparison, not on a constant');
  // ⚠️ Font names come off a downloaded archive: they are untrusted text going
  // into innerHTML.
  ok('⭐ names are escaped before they reach innerHTML',
     /replace\(\/&\/g, '&amp;'\)/.test(dlg) && /esc\(from\)/.test(dlg) && /esc\(to\)/.test(dlg),
     'a folder named with a < in it must not be able to write markup');

  ok('the import modal is stashed, not stacked on',
     /importModal\?\.classList\.contains\('active'\)/.test(dlg)
       && /if \(importWasActive\) importModal\.classList\.remove\('active'\)/.test(dlg),
     'house rule: full modal over full modal = stash and restore');
  ok('every listener it adds is removed again',
     (dlg.match(/addEventListener\('click'/g) || []).length === 3
       && (dlg.match(/removeEventListener\('click'/g) || []).length === 3);
  ok('the single-match button opens that font by name',
     /_sfOpenEntryDetail\(target\)/.test(dlg));
  ok('and with several matches it offers the library instead of guessing one',
     /Back to my library/.test(dlg) && /const one = matched\.length === 1/.test(dlg));
  ok('choosing not to import drops the orphan source',
     (dlg.match(/_sfCloseImport\(\)/g) || []).length === 2,
     'the source is on disk by this point; open-existing and cancel both owe its removal');
  ok('the list styling exists for the multi-font case',
     html.includes('.sf-dupfont-list {'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall nothing-to-import tests passed');
process.exit(failures ? 1 : 0);

// The seam between an export handler's result and the renderer that reads it.
//
// ⭐⭐ WHY THIS EXISTS. 2026-09-23 produced THREE defects of one shape in a single day, none of
// which could turn a suite red:
//
//   • a feature read `r.hash` while the producing module wrote `r.fileHash`, so it returned an
//     empty array forever and every test passed;
//   • the export progress DELTA channel carried no `name` field at all, so three doors showed
//     bytes moving and never said what was moving;
//   • the source export door started returning a LIST of exports, and the success summary went on
//     reading `r.destPath` / `r.format` off the root - printing "undefined" for the path, and
//     describing a FOLDER export as "a Zip archive" because an undefined `format` failed the
//     folder test. Wrong information, not merely missing.
//
// ⚠️⚠️ THE REASON THE SUITE COULD NOT SEE ANY OF THEM: every test builds its own input and hands
// it straight to the consumer. Nothing crosses the seam, so the seam is the one place with no
// coverage. "A fixture I authored tests my fixture" is the existing rule; this is its sibling -
// a SHAPE ASSUMPTION about a neighbour, with no fixture involved at all.
//
// ── WHAT THIS CHECKS, AND WHAT IT HONESTLY DOES NOT ──
//
// ⭐ A DECLARED CONTRACT IN THE MIDDLE, the same pattern as test/export-door-map.test.js - which
// caught a brand-new handler the moment it existed, before anyone looked. Inferring a producer's
// keys statically is not viable here: 11 export handlers return `{ ok: true, ...result }`, so the
// fields come from a module the regex cannot follow. Declaring them makes the contract explicit
// and makes ADDING a field a deliberate edit with a diff.
//
// ⚠️ IT CANNOT CATCH THE DELTA-CHANNEL CASE. There, NEITHER side had `name` - a field that should
// have flowed and did not exist anywhere. A producer/consumer diff sees nothing wrong with two
// sides that agree on being incomplete. That one needed comparing two channels serving the same
// purpose against each other, and is not attempted here. Claiming otherwise would make this the
// kind of check that reads as coverage it does not have.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const H = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// ── THE CONTRACT ─────────────────────────────────────────────────────
//
// What the renderer is allowed to rely on from each export result. Adding a field here is the
// deliberate act; reading one that is not here is the defect this file exists for.
//
// ⚠️ `ok`, `error` and `canceled` are on every result by construction (the cancel-normalising
// rule), so they are implicit rather than repeated per entry.
const UNIVERSAL = ['ok', 'error', 'canceled'];
// ⚠️ WRITTEN FROM MEMORY THE FIRST TIME AND WRONG IN THREE PLACES - `kept`, `observed` and
// `observedItem` are all genuinely returned and were missing here. That is not an embarrassment to
// hide, it is the argument for the file: a contract recalled is a contract that drifts, and the
// only way to find the gaps was to check it against the code rather than against my confidence.
// ⚠️ `vars` is for the one door whose call is INDIRECTED - it wraps the bridge in a local helper
// and assigns the result elsewhere, so no `const x = await window.electronAPI.fn(` exists to find.
// Naming the variable is honest; guessing at dataflow is how a static check starts lying.
const CONTRACT = {
  // The multi-source door. Per-export facts live on the RECORDS, never on the root - that
  // distinction is the whole reason this file exists.
  exportManySourcesToDownloads: {
    // ⚠️⚠️ A BARE VARIABLE NAME IS NOT AN ANCHOR. The first cut scanned for `res = await`
    // anywhere in the renderer and produced FORTY-SEVEN failures - `res` is used all over the
    // file, so it attributed every unrelated result's fields to this contract. A check with that
    // noise ratio gets ignored within a day, which is worse than not having it.
    // ⭐ So the scan is scoped to the door's own body: the function is the anchor, the variable is
    // only meaningful inside it.
    within: 'const _sfRunSourceExport = async',
    // ⚠️⚠️ TWO MARKERS, NEVER A CHARACTER COUNT. The first cut sliced 6000 chars from the anchor
    // and broke within the hour - comments added to the door pushed the call past the window and
    // the check reported "nobody calls this bridge". That is the SAME fixed-width-slice defect
    // test/export-runner-ratchet.test.js warns about in its own header ("a fixed-width slice over
    // this file has silently stopped covering its target three times"), written by me on the same
    // day I quoted it. The end marker is the next declaration, so the region grows with the door.
    until: 'const _sfExportSourceBeforeDelete = async',
    vars: ['res'],
    fields: [
      // [{ uuid, label, destDir, destPath, format, fileCount, totalBytes, curation, ... }]
      // ⚠️ `destDir` (the chosen destination) is NOT `destPath` (what we created in it). The eject
      // offer resolves removable media from the DIRECTORY, and passing destPath worked only because
      // a folder export's destPath is a directory - an archive export's is a file. Added 2026-09-23
      // as a deliberate contract edit, which is the whole point of declaring these.
      'exported',
      'count', 'totalBytes', 'fileCount',
      'tooBig', 'slowWrite',
      'wroteCount', 'rolledBack', 'partialRemoved', 'leftovers',
      'refusedForSpace', 'blockedDelete',
    ],
  },
  exportEntryToFolder: {
    fields: [
      'destPath', 'written', 'refused', 'skipped',
      'observed', 'observedItem',
      // [B-005 item 7b, 2026-09-26] Bytes the differential write did not have to move because the
      // card already had them. The summary states this number, so it has to cross IPC declared
      // rather than arriving by luck.
      'savedBytes',
      'tooBig', 'slowWrite', 'wroteCount', 'partialRemoved', 'restored', 'leftovers',
      'offerCleanup', 'teardownIncomplete',
    ],
  },
  sharedTracksExportToFolder: {
    fields: [
      'added', 'replaced', 'unchanged', 'kept', 'refused', 'observed', 'observedItem',
      'destPath', 'wroteCount', 'tooBig', 'slowWrite',
    ],
  },
};

// ── CONSUMER SIDE: does the renderer read anything undeclared? ────────
//
// ⚠️ THE WINDOW IS A HEURISTIC AND IT IS BOUNDED DELIBERATELY. A variable named `r` is reused all
// over this file, so an unbounded scan would attribute someone else's `r.` to this call - which is
// exactly how a regex over a block whose end was GUESSED clobbered an unrelated handler earlier
// today. The scan stops at a re-assignment of the same name, and a false positive here costs one
// line in the contract above rather than a wrong edit.
const readsAfter = (src, idx, varName, limit = 120) => {
  const lines = src.slice(idx).split('\n').slice(0, limit);
  const out = new Set();
  const reassign = new RegExp(`(const|let|var)\\s+${varName}\\b|^\\s*${varName}\\s*=`);
  for (let i = 1; i < lines.length; i++) {
    if (reassign.test(lines[i])) break;
    const m = lines[i].matchAll(new RegExp(`\\b${varName}\\.([a-zA-Z_][a-zA-Z0-9_]*)`, 'g'));
    for (const x of m) out.add(x[1]);
  }
  return out;
};

const findCalls = (src, fn) => {
  const out = [];
  const re = new RegExp(`(?:const|let)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*=\\s*await\\s+window\\.electronAPI\\.${fn}\\(`, 'g');
  let m;
  while ((m = re.exec(src))) out.push({ varName: m[1], idx: m.index });
  return out;
};

for (const [fn, spec] of Object.entries(CONTRACT)) {
  const allowed = new Set([...spec.fields, ...UNIVERSAL]);
  const calls = findCalls(H, fn);
  if (spec.within && (spec.vars || []).length) {
    // The indirected case: the bridge is wrapped in a local helper, so there is no
    // `const x = await window.electronAPI.fn(` to find. Anchor on the FUNCTION and look only
    // inside it.
    const from = H.indexOf(spec.within);
    ok(`${fn}: its door body was located`, from > -1,
       `re-anchor \`within\` - "${spec.within}" is not in the renderer, so this contract is `
       + 'checking nothing at all');
    if (from > -1) {
      const stop = spec.until ? H.indexOf(spec.until, from) : -1;
      ok(`${fn}: its end marker was found`, !spec.until || stop > from,
         `"${spec.until}" no longer follows the anchor - re-anchor rather than widening a window`);
      const body = H.slice(from, stop > from ? stop : from + 6000);
      for (const v of spec.vars) {
        const re = new RegExp(`\\b${v}\\s*=\\s*await\\b`, 'g');
        let m;
        while ((m = re.exec(body))) calls.push({ varName: v, idx: from + m.index });
      }
    }
  }
  ok(`${fn}: at least one renderer caller was found`, calls.length > 0,
     'the contract describes a bridge nobody calls - either it is dead, or the call shape changed '
     + 'and this check has silently stopped looking at anything');
  for (const c of calls) {
    const read = [...readsAfter(H, c.idx, c.varName)];
    const undeclared = read.filter((f) => !allowed.has(f));
    ok(`${fn}: every field read off \`${c.varName}\` is declared`,
       undeclared.length === 0,
       `reads ${undeclared.map((f) => `\`${c.varName}.${f}\``).join(', ')} which the contract does `
       + 'not list. Either main returns it and the contract is stale, or it returns undefined and '
       + 'the consumer is reading a shape that moved.');
  }
}

// ── ⚠️⚠️ AND THE CHECK PROVES IT CAN FAIL ────────────────────────────
// A contract check that reports clean is indistinguishable from one whose matcher stopped
// matching - which is precisely how the 12-line window reported an already-fixed site as broken
// earlier today, and only a control caught it.
{
  // ⚠️ Uses a DIRECTLY-called bridge on purpose: the control must exercise the same matcher the
  // checks above rely on, and the indirected door has no `const x = await ...` to find.
  const fn = 'exportEntryToFolder';
  const calls = findCalls(H, fn);
  ok('the control located a real call site', calls.length > 0);
  if (calls.length) {
    const c = calls[0];
    const mutated = H.slice(0, c.idx) + H.slice(c.idx).replace(
      new RegExp(`window\\.electronAPI\\.${fn}\\(`),
      `window.electronAPI.${fn}(`) ;
    // Inject a read of a field no contract lists, right after the call.
    const injected = mutated.slice(0, c.idx) +
      mutated.slice(c.idx).replace(/\n/, `\n            const _canary = ${c.varName}.notAContractField;\n`);
    const read = readsAfter(injected, c.idx, c.varName);
    ok('⚠️⚠️ an undeclared field read IS caught', read.has('notAContractField'),
       'the scanner cannot see a read it should flag, so its clean result means nothing');
  }
}

console.log(failed ? `\nexport-result-contract: ${failed} failing`
                   : '\nexport-result-contract: all passing');
process.exit(failed ? 1 : 0);

/**
 * Clearing NEW in bulk  [B-297]
 *
 * Said immediately after bulk-importing 191 fonts: "no way to clear the new tag... in
 * bulk..."
 *
 * ⭐ THE FEATURE WAS CORRECT AND ITS EXIT WAS MISSING. NEW means "never seen", stamped
 * by exactly four writers — opening the detail, assigning to a preset, exporting to a
 * card, and a successful flash. Every one is per-font and deliberate, which is right
 * for a library that grows a few fonts at a time. It does not survive a bulk import:
 * 191 arrive New at once and the only way out was 191 individual actions.
 *
 * BOTH DOORS, and they are not alternatives — they answer different questions:
 *   * the chip beside the New count — "I just imported everything, clear it"
 *   * the selection button          — "clear these twelve"
 *
 * ⚠️ ONE WRITE PATH. Both walk `markEntrySeen`, the same call the single-font helper
 * uses, rather than touching meta directly — so the write-once rule lives in one place.
 *
 * Run: node test/mark-seen-bulk.test.js
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

// ── both controls exist ────────────────────────────────────────────────────
{
  ok('the chip-side control exists', /id="btn-sf-mark-all-seen"/.test(html));
  ok('the selection-side control exists', /id="btn-sf-bulk-mark-seen"/.test(html));
  // ⚠️⚠️ THIS ASSERTION WAS INVERTED ON 2026-09-18 AND THE INVERSION IS THE POINT. [B-297]
  // It used to require the control to sit BESIDE THE NEW FILTER, in the chip row. He looked at
  // that live and would not pass it: it "looks like a filter". A row of filters is where you go
  // to change the VIEW, not your data, so an action there reads as a view toggle no matter how it
  // is styled. Placement was the whole fix; the old test had encoded the rejected design.
  // ⚠️ Anchor on the MARKUP spelling. `btn-sf-select-in-use` appears in the stylesheet thousands
  // of lines earlier, so a bare indexOf measures the distance from a CSS rule to a button and
  // reports a correct layout as wrong.
  const selectInUseAt = html.indexOf('<button id="btn-sf-select-in-use"');
  const markAllAt     = html.indexOf('<button id="btn-sf-mark-all-seen"');
  ok('both buttons were found in the markup', selectInUseAt > 0 && markAllAt > 0);
  ok('the control sits in the always-visible action group, not the chip row',
     markAllAt > selectInUseAt && markAllAt - selectInUseAt < 1400,
     `${markAllAt - selectInUseAt} chars from Select in-use — it belongs with the library-scoped actions`);
  ok('and it is NOT back in the filter chip row',
     html.indexOf('<button id="btn-sf-mark-all-seen" class="styles-tag-filter-btn"') === -1,
     'the filter-chip class is back on it — that is the placement he rejected');
  ok('the selection control sits with the other bulk actions',
     Math.abs(html.indexOf('id="btn-sf-bulk-mark-seen"') - html.indexOf('id="btn-sf-bulk-tag"')) < 600);
}

// ── neither offers to do nothing ───────────────────────────────────────────
{
  const chip = html.slice(html.indexOf("const markAllBtn = document.getElementById('btn-sf-mark-all-seen')"),
                          html.indexOf("const markAllBtn = document.getElementById('btn-sf-mark-all-seen')") + 600);
  ok('the chip control hides when nothing is New',
     /markAllBtn\.style\.display = newCount > 0 \? '' : 'none';/.test(chip), chip);
  // ⚠️ The label references the BADGE, not the mechanism. "seen" is not a clear opposite of
  // "NEW" and quietly claims the user looked at something. His own words for the gap:
  // "no way to clear the new tag". seenAt stays the field name in code. [B-297]
  ok('and it names the count, referencing the badge', /Clear all New \(\$\{newCount\}\)/.test(chip), chip);

  const sel = html.slice(html.indexOf("const seenBtn = document.getElementById('btn-sf-bulk-mark-seen')"),
                         html.indexOf("const seenBtn = document.getElementById('btn-sf-bulk-mark-seen')") + 700);
  ok('the selection control counts only the NEW ones in the selection',
     /!\(e\.meta && e\.meta\.seenAt\)/.test(sel), sel);
  ok('and hides when none of the selection is New',
     /seenBtn\.style\.display = newInSel > 0 \? '' : 'none';/.test(sel), sel);
  ok('its label is the count that will CHANGE, not the selection size',
     /Clear New \(\$\{newInSel\}\)/.test(sel), sel);   // [B-297] names the badge, not the mechanism
  ok('it is hidden again when the selection empties',
     /getElementById\('btn-sf-bulk-mark-seen'\); if \(sb\) sb\.style\.display = 'none';/.test(html));
}

// ── one write path ─────────────────────────────────────────────────────────
{
  const bulk = html.slice(html.indexOf('const _sfMarkSeenBulk = async'),
                          html.indexOf('const _sfMarkSeenBulk = async') + 2200);
  ok('the bulk helper exists', bulk.length > 100);
  ok('it goes through markEntrySeen', /window\.electronAPI\.markEntrySeen\(\{ name \}\)/.test(bulk),
     'not a direct meta write — the write-once rule lives on the main side');
  ok('it shows progress like the other bulk passes',
     /_sfDeleteProgress\.show\(/.test(bulk) && /_sfDeleteProgress\.hide\(\)/.test(bulk));
  ok('it names the item being worked on', /list\.length\}\)`, name,/.test(bulk), bulk.slice(0, 400));
  ok('it repaints ONCE at the end, not per font',
     (bulk.match(/_sfRenderGrid\(\)/g) || []).length === 1, bulk);

  // ⚠️ A run where everything was already seen must not claim success.
  ok('it distinguishes "nothing to do" from "done"',
     /already marked as seen/.test(bulk), bulk);
  ok('and reports failures rather than swallowing them',
     /could not be updated/.test(bulk), bulk);
  ok('an empty list is a no-op', /if \(!list\.length\) return/.test(bulk));
}

// ── the handlers ───────────────────────────────────────────────────────────
{
  ok('both handlers stopPropagation',
     (html.match(/btn-sf-(bulk-mark-seen|mark-all-seen)'\)\?\.addEventListener\('click', async \(e\) => \{\s*\r?\n\s*e\.stopPropagation\(\);/g) || []).length === 2,
     'the document-level click handler would otherwise clear the selection first');

  const allHandler = html.slice(html.indexOf("getElementById('btn-sf-mark-all-seen')?.addEventListener"),
                                html.indexOf("getElementById('btn-sf-mark-all-seen')?.addEventListener") + 600);
  // "All" has to mean the same set the chip counted, or the button lies about its own
  // number — the grid may be filtered to something narrower at the time.
  ok('"all" means every New entry, not just the visible ones',
     /_sfAllEntries/.test(allHandler) && !/_sfLastMatchingNames/.test(allHandler), allHandler);

  ok('markEntrySeen is actually exposed on the preload bridge',
     fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8').includes('markEntrySeen'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall mark-seen bulk tests passed');
process.exit(failures ? 1 : 0);

// The import side's eject offer reuses the export side's eject, and gives the shared bar back.
//
// WHY THIS EXISTS. [B-424] The ask was to offer eject where you IMPORT from a card, not only
// where you export to one - "add the eject option to this screen and to the import finish summary
// as well as the eject when complete." The entry says plainly that this is a wiring job and that
// if it turns into new eject code, something has been missed. These checks are what make that
// claim falsifiable instead of a sentence in a backlog entry.
//
// THE HAZARD IT GUARDS IS THE SHARED BUTTON BAR. The eject row is INJECTED into a modal's
// `.modal-btns`, which outlives any single run. A row left behind is a live Eject button wired to
// a finished import's card, sitting on the next screen that borrows that bar. The export side
// already learned this the hard way and left a comment saying so ("whatever we add to a shared
// surface, we take away"); this is the import side inheriting the rule rather than rediscovering
// it.
//
// WHAT THIS CANNOT DO: it reads source text. It cannot prove the row renders, that eject
// succeeds, or that the checkbox is visible at the right moment on screen. Those are a dev pass
// and QA. What it can prove is that the wiring points at the shared implementation and cleans up.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const H = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (detail) console.log(`       ${detail}`);
}

// ── It reuses the export side's helpers rather than reimplementing eject ──────
// THE ORDER IS THE ASSERTION, NOT THE PRESENCE, AND THIS CHECK WAS WRONG FIRST. It matched
// `const X =` and `window.X =` anywhere in the file and went green on a build that could not start:
// the export block sat ABOVE `const _sfWireEjectRow`, and reading a `const` before its declaration
// is evaluated is a temporal-dead-zone ReferenceError. It threw, abandoned the rest of that IIFE,
// and collapsed the editor pane to zero height. Found in DevTools; the suite was green.
// A check that cannot see position cannot see this bug, and "both strings exist" was never the
// guarantee - "the read happens after the write" was.
const EJECT_HELPERS = ['_sfEjectContext', '_sfEjectRowHtml', '_sfWireEjectRow',
                       '_sfPlaceEjectRowInButtons', '_sfRemoveEjectRow'];
for (const fn of EJECT_HELPERS) {
  const decl = H.indexOf(`const ${fn} =`);
  // The export block assigns with padded alignment, so match the assignment specifically rather
  // than any mention - the guarded CALL sites (`window._sfEjectRowHtml &&`) are not assignments.
  const exp = H.search(new RegExp(`window\\.${fn}\\s*=\\s*${fn};`));
  ok(`${fn} is declared, then exported`, decl > 0 && exp > 0 && decl < exp,
     decl > 0 && exp > 0 && decl > exp
       ? `EXPORTED AT ${exp} BUT DECLARED AT ${decl} - temporal dead zone. This throws at load and`
         + ' takes the rest of the IIFE with it.'
       : `declared at ${decl}, exported at ${exp}`);
}
{
  // The whole block must clear the LAST declaration, which is the invariant a per-name check can
  // satisfy one name at a time while the block still sits in the wrong place for another.
  const lastDecl = Math.max(...EJECT_HELPERS.map(f => H.indexOf(`const ${f} =`)));
  const blockAt = H.indexOf('window._sfEjectContext           = _sfEjectContext;');
  ok('the export block sits below EVERY declaration it names',
     blockAt > 0 && blockAt > lastDecl,
     `last declaration ends at ${lastDecl}, export block at ${blockAt}`);
}

// AND THE CALLS MUST BE GUARDED. An unguarded `window._sfEjectRowHtml(...)` in the summary
// builder throws and blanks the whole summary, which is the failure the builder's own `_fmtSaved`
// comment already warns about for `window._sfFormatBytes`.
{
  const calls = H.match(/window\._sfEject(?:Context|RowHtml)\(/g) || [];
  const guards = H.match(/window\._sfEject(?:Context|RowHtml)\b(?!\()/g) || [];
  ok('every eject helper call in the import scope sits behind a truthiness guard',
     calls.length > 0 && guards.length >= calls.length,
     `${calls.length} calls, ${guards.length} guard references`);
}

// ── The shared bar is given back ──────────────────────────────────────────────
{
  const i = H.indexOf('const closeModal = ');
  const j = H.indexOf("els.modal?.classList.remove('active')", i);
  const body = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('the bulk import closeModal was located', body.length > 0);
  ok('closeModal removes the injected eject row',
     /window\._sfRemoveEjectRow\s*\(\)/.test(body),
     'a leftover row is a live Eject button on the next run, pointing at the previous card');
  ok('closeModal clears the eject offer state',
     /ejectOffer\s*=\s*\{\s*available:\s*false/.test(body),
     'an offer inherited from a previous run is a promise nobody made');
  ok('closeModal unchecks the box',
     /els\.ejectBox\.checked\s*=\s*false/.test(body),
     'otherwise a tick carries into an import of a different card');
}

// ── The removable rule is not re-derived ──────────────────────────────────────
{
  // `_sfEjectContext` already returns {} for anything that is not `removable === true`, so the
  // import side must take that as its answer. A second removable check here is how two surfaces
  // start disagreeing about the same card.
  // ANCHORED ON THE COMMENT BANNER, NOT ON `ejectOffer = { available: false`. That assignment
  // appears three times - the declaration, the reset in closeModal, and the reset here - and
  // indexOf takes the FIRST, so the slice covered the declaration and the region under test was
  // never read. It reported a real-looking failure about code that was correct.
  // RE-ANCHORED 2026-10-06 ONTO THE DECLARATION. This read `H.indexOf('ARM THE EJECT OFFER')`,
  // a comment banner inside `_runAnalyze`. The arming moved out of the analyze that day - a
  // common-folders-only plan skips the analyze, so arming there meant door 9 got no eject offer at
  // all - and the banner went with it, leaving the slice empty. A declaration survives a move; a
  // sentence in a comment does not.
  const i = H.indexOf('const armEjectOffer = (root) =>');
  const j = H.indexOf('})();', i);
  const arm = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('the arming block was located', arm.length > 200 && /_sfEjectContext/.test(arm),
     'a slice that missed its target makes every assertion over it vacuously true');
  ok('availability comes from the shared eject context',
     /window\._sfEjectContext\(/.test(arm) && /ctx\.ejectTarget/.test(arm),
     'the context is the removable check; re-asking is a second opinion that can disagree');
  ok('the import side does NOT run its own removable lookup',
     !/_sfDestIdentity\.removable/.test(arm),
     'that would be a parallel answer to a question the context already answered');
}

// ── One visibility rule, in the one place the file already settles them ───────
{
  const hits = H.match(/els\.ejectWrap\.style\.display/g) || [];
  ok('the checkbox visibility rule exists in exactly one place', hits.length === 1,
     `${hits.length} sites. [B-294] cost a leaked control because ONE checkbox in this dialog was`
     + ' driven from call sites instead of showPhase. A rule spread across call sites is a rule'
     + ' the next phase forgets.');

  const i = H.indexOf('const showPhase = (phase) =>');
  const j = H.indexOf('const closeModal = ', i);
  const fn = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('and it lives inside showPhase', /els\.ejectWrap\.style\.display/.test(fn));
  // REWRITTEN 2026-10-05 [B-462]. This asserted the two offers could never be on screen at
  // once, because both labels carried `margin-right:auto` and two left-aligned children collide.
  // They now CAN coexist by design: ticking "continue to quick import" is what makes the run
  // unattended, and that is precisely when the eject offer starts to mean something, so gating the
  // second on the first is the rule.
  // The collision the old assertion guarded is REAL and still has to be prevented — so the
  // check moves from "they are mutually exclusive" to "only one box is left-aligned": the labels
  // sit in a container that carries the margin for them.
  ok('the eject offer is unlocked by the quick-import tick, not by the run starting',
     /phase === 'progress' && unattended && ejectOffer\.available/.test(fn)
     && /const unattended = runInFlight \|\| _bulkAutoContinue;/.test(fn),
     'the offer has to appear while the decision to walk away is being made, not after');
  ok('and only ONE child of the button row is left-aligned, so they cannot fight for the slot',
     /class="sf-bulk-left-stack"/.test(H)
     && /\.sf-bulk-left-stack \{[^}]*margin-right: auto/.test(H)
     && !/id="sf-bulk-prog-auto-wrap"[\s\S]{0,80}margin-right:auto/.test(H)
     && !/id="sf-bulk-import-eject-wrap"[\s\S]{0,80}margin-right:auto/.test(H),
     'the container carries margin-right:auto; neither label may carry its own');
}

// ── The late-arrival race ─────────────────────────────────────────────────────
//
// THIS IS THE ONE THAT SHIPPED BROKEN (2026-09-30). The removability lookup is fired without
// awaiting at the start of the run. A two-source import finishes in about a SECOND; the lookup does
// not. The summary read the flag once at build time, got false, and nothing rebuilt it - so the row
// appeared on slow imports and never on fast ones, which is the worst shape a race can take,
// because it works while you are testing it.
// The guarantee is not "the row is built somewhere". It is that BOTH arrival orders end with the
// row on screen, which means one idempotent renderer called from both.
{
  const i = H.indexOf('const syncSummaryEjectRow');
  const j = H.indexOf('import eject row did not render', i);
  const fn = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('the summary eject row has ONE renderer', fn.length > 200,
     'inline construction in the summary builder cannot be re-run when the lookup arrives after it');
  ok('it is idempotent - it removes any existing row first',
     /_sfRemoveEjectRow/.test(fn),
     'it is called twice in the fast path; without this that is two Eject buttons');
  ok('it refuses to draw unless the summary is the screen that is up',
     /shownPhase !== 'summary'/.test(fn),
     'otherwise a late arrival paints a row onto the run screen or a closed dialog');

  const armAt = H.indexOf('const armEjectOffer = (root) =>');
  const arm = H.slice(armAt, H.indexOf('})();', armAt));
  ok('a late lookup repairs the SUMMARY, not only the run screen',
     /else syncSummaryEjectRow\(\);/.test(arm),
     'the first version only re-ran showPhase for the progress phase, so a fast import - the'
     + ' common case - finished with no Eject at all');
  ok('and a lookup that lands while the run is still up reveals the checkbox',
     /if \(shownPhase === 'progress'\) showPhase\('progress'\);/.test(arm));
}

// ── The summary reads ITS OWN checkbox ────────────────────────────────────────
{
  const i = H.indexOf('[B-424] THE EJECT ROW');
  const j = H.indexOf('import eject row did not render', i);
  const body = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('the summary eject block was located', body.length > 0);
  ok('it places the row in the BULK modal button bar, not the confirm dialog',
     /_sfPlaceEjectRowInButtons\('#modal-sf-bulk-import \.modal-btns'\)/.test(body),
     'the helper defaults to #modal-confirm, which is not this modal');
  // THE NEGATIVE HALF MATCHES THE CALL, NOT THE WORD. A bare /wantsEject\(\)/ tripped on the
  // COMMENT in this very block explaining why that helper is not used - a prose false positive,
  // and the same trap the divider test had to be written around. Match the qualified call.
  ok('auto comes from the import dialog\'s own checkbox',
     /els\.ejectBox && els\.ejectBox\.checked/.test(body)
       && !/_sfDeleteProgress\.wantsEject\(\)/.test(body),
     'reading the progress modal\'s wantsEject() would be a guarantee about a surface this run'
     + ' never showed');
}

// ── The generalised placement helper did not break its existing callers ───────
{
  ok('the placement helper still defaults to the confirm dialog',
     /_sfPlaceEjectRowInButtons = \(btnsSel = '#modal-confirm \.modal-btns'\)/.test(H),
     'the export summaries call it with no argument; a required parameter would break them');
  const bare = (H.match(/_sfPlaceEjectRowInButtons\(\)/g) || []).length;
  ok(`existing no-argument callers still exist and are unchanged (${bare})`, bare >= 2,
     'if this dropped to zero the export side was rewritten, which was not the job');
}

// ── Surface 3: the card report's own footer ───────────────────────────────────
{
  const i = H.indexOf('async function _sdSyncEjectRow');
  const j = H.indexOf('card report eject row did not render', i);
  const fn = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('the card report eject sync was located', fn.length > 300);

  ok('it places the row in the card report footer, left justified',
     /_sfPlaceEjectRowInButtons\('#sd-report-overlay \.modal-btns'\)/.test(fn),
     'settled 2026-09-30: "in the footer with other buttons but left justified"');
  ok('it removes the previous row before deciding on a new one',
     /_sfRemoveEjectRow/.test(fn),
     'the report overlay is built once and outlives every card it shows');
  ok('a browsed FOLDER gets no eject offer',
     /card\.isFolder/.test(fn),
     'the report is reachable via "Browse a folder or drive", so its subject is not always a card'
     + ' - this is the screen the removable rule exists for');
  ok('availability comes from the shared context, not a second removable lookup',
     /window\._sfEjectContext\(/.test(fn) && !/_sfDestIdentity\.removable/.test(fn));
  ok('the async lookup is sequenced against a card switch',
     /seq !== _sdEjectSeq/.test(fn),
     'a stale row is an Eject button labelled for one card and wired to another, which is the'
     + ' worst shape this particular control can take');
  ok('nothing on this screen auto-ejects',
     /auto: false/.test(fn),
     'there is no checkbox here; someone is standing in front of the report choosing to eject now');

  // The two entry points, so going back from a card clears the row rather than stranding it.
  ok('the browse render syncs the row', /_sdRenderBrowse[\s\S]{0,900}?_sdSyncEjectRow\(\)/.test(H));
  ok('the card chooser syncs it too (which removes it)',
     /_sdRenderList[\s\S]{0,700}?_sdSyncEjectRow\(\)/.test(H),
     'with several cards listed there is no single subject to eject');
  {
    const c = H.indexOf("ov.querySelector('#sd-rpt-close').onclick");
    const seg = c > 0 ? H.slice(c, c + 420) : '';
    ok('closing the report removes the row and abandons the lookup',
       /_sfRemoveEjectRow/.test(seg) && /_sdEjectSeq\+\+/.test(seg),
       'otherwise the next open starts with a live button wired to the previous card');
  }
}

// ── After the eject, the card report stops claiming to be live ────────────────
//
// ALL THREE OF THESE SHIPPED WRONG AND TESTING FOUND THEM IN ONE PASS (2026-09-30): the file list
// still showed 34 folders for a card that was gone, clicking one produced a raw `scandir` error,
// and that navigation REBUILT the eject row so a spent control came back live. Plus the status dot
// stayed green on a volume that had been released.
{
  ok('the shared eject helper can report success to its caller',
     /const _sfWireEjectRow = \(\{ target, vocab, auto, onEjected \}\)/.test(H),
     'a dialog that stays on screen has to know; a summary about to be dismissed does not');
  ok('and it calls it on the ejected branch, including alreadyGone',
     /typeof onEjected === 'function'\) onEjected\(res\)/.test(H),
     'alreadyGone means the volume is gone too - ignoring it leaves the stale listing up in the'
     + ' case where it is most certainly wrong');
  ok('the card report supplies it', /onEjected: _sdMarkEjected/.test(H));

  const i = H.indexOf('function _sdMarkEjected');
  const j = H.indexOf('async function _sdSyncEjectRow', i);
  const fn = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('the ejected-state handler was located', fn.length > 200);
  ok('it replaces the stale listing rather than re-scanning',
     /sd-rpt-body/.test(fn) && !/listSdDir/.test(fn),
     're-reading a volume that is gone paints an error where a plain sentence belongs');
  ok('and it repaints the header so the dot can change', /_sdCardSummaryHtml/.test(fn));

  const sync = H.slice(H.indexOf('async function _sdSyncEjectRow'), H.indexOf('card report eject row did not render'));
  ok('navigating after an eject does NOT rebuild the row',
     /if \(_sdReport\.ejected\) return;/.test(sync),
     'this is the "clunky" one: every render calls the sync, so without the guard a spent button'
     + ' comes back live for a card that is not there');

  ok('the status dot greys once ejected',
     /_sdReport\.ejected && _sdReport\.card === c/.test(H),
     'a live-status colour on a released volume asserts something the dialog can no longer know');
  ok('the header keeps the card name and gains a DISCONNECTED badge',
     /sd-disconnected-badge[^`]*DISCONNECTED/.test(H),
     'his ask: the header stays and says what it WAS, with an indicator after the name');
  ok('the badge is appended to the label, so both render sites get it from one place',
     /const label = _sdEsc\(_sdDriveLabel\(c\)\)[\s\S]{0,200}sd-disconnected-badge/.test(H),
     'added at each call site instead, the browse header and the chooser row would drift');
  ok('the ejected body does not restate "Safe to remove."',
     !/This card has been ejected\. Safe to remove\./.test(H),
     'the footer status says it, the badge says it and the dot says it - a fourth copy two inches'
     + ' away is the sentence that tells the reader nothing new');
  {
    const i = H.indexOf('function _sdMarkEjected');
    const j = H.indexOf('async function _sdSyncEjectRow', i);
    const fn = H.slice(i, j);
    ok('and it does not rebuild the action row',
       !/_sdActionRowHtml/.test(fn),
       '"Import fonts to library" on a released card is an offer that cannot be honoured');
  }
  const resets = (H.match(/_sdReport\.ejected = false/g) || []).length;
  ok(`the flag is reset at every report entry point (${resets})`, resets >= 2,
     'a stale true suppresses the eject offer on the NEXT card, which reads as the feature'
     + ' silently disappearing rather than as a bug');
}

// ── The backup restore door: MERGE AND REPLACE GET THE SAME OFFER ────────────
// Both branches read the same backup from the same card, so both owe the same eject. [B-401] is
// the entry about fixing one of these two and not the other, and it happened again on 2026-10-07:
// the row went onto both close-outs but the ARMING only onto merge, so Replace finished with no
// eject at all. Reported: "eject offer completely missing on replace."
//
// Counted rather than merely present, because "it exists somewhere" is what let one branch keep
// missing it.
{
  const arms = (H.match(/_sfArmBackupEject\(zipPath\)/g) || []).length;
  ok('both backup branches arm the eject offer (merge + replace)', arms === 2,
     `found ${arms} arming call(s) - one per branch is the requirement; a single call means `
     + 'whichever branch lacks it ends with no eject at all');

  const wires = (H.match(/_sfWireBackupEjectRow\(\);/g) || []).length;
  ok('and both close-outs wire the row', wires === 2,
     `found ${wires} - "Merge complete" and "Import complete" each need one`);

  // No subtraction: the helper is declared `_sfBackupEjectRowHtml = () =>`, which this pattern does
  // not match, so every hit is a call. (Subtracting one for "the definition" is a mistake I made
  // twice on 2026-10-07 — check the declaration's spelling before compensating for it.)
  const rows = (H.match(/_sfBackupEjectRowHtml\(\)/g) || []).length;
  ok('and both close-outs build the row', rows === 2,
     `found ${rows} build site(s) - "Merge complete" and "Import complete" each need one`);

  ok('the offer is scoped to the restore, never the backup EXPORT it shares a modal with',
     /bkEjectWrap/.test(H) && !/sf-backup-eject-wrap[\s\S]{0,400}?display: *''/.test(
       H.slice(H.indexOf('const _sfOpenExportBackup'), H.indexOf('const _sfOpenExportBackup') + 3000)),
     'writing a backup TO a card is a different operation about a different volume');
}

// THE CONTROL. Every check above is a regex over source text, the shape that has passed while
// asserting nothing. Prove the anchors are real rather than trusting that a green run means the
// regions were found.
{
  ok('the control: a deliberately wrong anchor finds nothing',
     H.indexOf('const closeModalThatDoesNotExist = ') === -1,
     'if a bogus anchor matched, indexOf-based slicing here proves nothing');
  const i = H.indexOf('const showPhase = (phase) =>');
  const j = H.indexOf('const closeModal = ', i);
  ok('the slices used above are non-empty', i > 0 && j > i && (j - i) > 200,
     'an empty slice makes every assertion over it vacuously true - the exact defect that let a'
     + ' migration test pass while asserting the opposite of its intent');
}

console.log(`\nimport-eject-wiring: ${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);

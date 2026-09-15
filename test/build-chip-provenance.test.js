/**
 * The build-status chips say WHICH build, not just that one happened  [B-028]
 *
 * THE REPRO, app left open ~9h overnight: compiled + flashed (9:22 PM), disconnected the
 * board, ran a second compile purely to warm the cache (9:55 PM), left it. In the
 * morning the chips read
 *     "Compile restored from cache"  +  "Flash successful"
 * together, which says "the current file is on the board". False twice over: the flash
 * predates the current build, and there was no board attached at all.
 *
 * ⭐ THE FLASH CHIP WAS A SESSION FLAG. It recorded that a flash had succeeded at some
 * point, never WHICH build it put there, so nothing could ever contradict it.
 *
 * ⚠️ AND THE MISLABEL HAD ITS OWN TRIGGER, pinned the same morning: clicking CLOSE on
 * the still-open build modal re-runs the content-hash cache check, which HITS — that
 * compile just populated the cache — and relabelled this session's own build "restored
 * from cache". The check could not tell "this hit IS the build I just made" from
 * "restored a prior build on open".
 *
 * Run: node test/build-chip-provenance.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src  = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ⚠️ SLICE TO THE END OF THE THING, NEVER A FIXED CHARACTER COUNT.
// These blocks were cut at 1600 / 900 chars. On 2026-09-15 the provenance function grew and
// four assertions started reading past their own subject - they did not report a gap, they
// simply stopped covering the lines that moved out of the window. A stale slice fails in the
// one direction a test must never fail in: quietly.
// ⚠️⚠️ THESE MUST FAIL LOUDLY WHEN THEY CANNOT FIND THE END, AND THAT IS NOT PEDANTRY.
// The first version looked for '\n}\n' and fell back to src.slice(start) when it found
// nothing. renderer/buildPanel.js is CRLF, so '\n}\n' NEVER matched, and every single
// assertion built on these was silently scanning the whole REST OF THE FILE rather than one
// function - including the ones asserting that a given string is ABSENT from a function.
// A slice that widens on failure turns every negative assertion into a coin flip and reports
// PASS either way. Found 2026-09-15, the same day the helpers were written. Line endings are
// normalised and a missing terminator now throws. (Same family as the fixed-length slices
// these replaced: both fail quietly, in the direction of looking green.)
const nsrc = src.replace(/\r\n/g, '\n');
function sliceTo(startNeedle, endNeedle, tailLen, what) {
  const start = nsrc.indexOf(startNeedle);
  if (start < 0) throw new Error(`test helper: cannot find ${what} "${startNeedle}"`);
  const end = nsrc.indexOf(endNeedle, start);
  if (end < 0) throw new Error(`test helper: no terminator for ${what} "${startNeedle}"`);
  return nsrc.slice(start, end + tailLen);
}
const fnBody     = name => sliceTo(`function ${name}`, '\n}\n',  2, 'function');
const arrowBody  = decl => sliceTo(decl,               '\n};\n', 3, 'arrow');
const objLiteral = decl => sliceTo(decl,               '};',     2, 'object literal');

// ⚠️ NEGATIVE ASSERTIONS MUST NOT SEE COMMENTS, and this bit twice on 2026-09-15.
// Good comments quote the wording or the mechanism they REPLACED, to say why it went - so
// "this string is gone" and "this guard is gone" both failed on the explanation rather than
// on a regression. Positive assertions are fine either way; anything asserting ABSENCE runs
// against code only.
const codeOnly = s => s.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ── the flash chip carries an identity ─────────────────────────────────────
{
  ok('a flashed build is stamped', /let _flashedBuildKey\s+= null;/.test(src));
  const stamp = objLiteral('_flashedBuildKey = {');
  ok('the stamp records the config hash', /configHash:\s+\(_currentBuildKey && _currentBuildKey\.configHash\) \|\| null/.test(stamp), stamp);
  ok('and when it happened', /at: Date\.now\(\)/.test(stamp), stamp);
  ok('it is only set on a SUCCESSFUL flash',
     /if \(ok\) \{[\s\S]{0,400}?_flashedBuildKey = \{/.test(src));
}

// ── it degrades honestly instead of lying ──────────────────────────────────
{
  const fn = fnBody('_refreshFlashProvenance');
  ok('the provenance check exists', fn.length > 200);
  // ⭐ SPECIFICS BELONG IN THE TOOLTIP, NOT THE LABEL (2026-09-15). The label used
  // to read "Board has an older build (Sep 15, 1:27 PM)", so the status bar got wider as the
  // state got worse and the scannable part sat behind a date. Asserted both ways round.
  ok('a superseded build says so', /'Board has an older build'/.test(fn), fn);
  ok('and the DATE moved to the hover, not the label',
     /Flashed \$\{when\}, from a different version/.test(fn)
       && !/setStatus\('flash', 'warn', when \?/.test(codeOnly(fn)), fn);
  ok('no flash LABEL carries an interpolated value',
     (codeOnly(fn).match(/setStatus\('flash',[^)]*\)/g) || [])
       .every(s => !/\$\{/.test(s)),
     'a label is the state; when, which board and which target are hover material');
  ok('it degrades rather than clearing',
     /setStatus\('flash', 'warn'/.test(fn),
     'the board really does have something on it; a date is more use than going blank');
  // Copy shortened 2026-09-15 to the one-line tooltip convention; "Flash again to update it"
  // went with it, because consequence and next-step are exactly what that rule cuts.
  ok('and the hover names which version went on', /from a different version of this config/.test(fn), fn);

  // ⚠️ THREE WAYS THIS COULD BECOME THE SAME BUG POINTED THE OTHER WAY.
  // No longer "says nothing": it states the session-scoped truth and lets the hover carry
  // the file's record. What it must still never do is invent a flash that never happened.
  // ⚠️ "Not flashed this session" was an over-correction of an invented problem: the bare
  // wording was argued to assert a negative about the board, and a qualifier shipped for it.
  // Reverted 2026-09-15. A qualifier earns its place only when there is something to contrast
  // against, and with nothing flashed there is nothing to contrast.
  ok('no flash this session makes no claim about the board',
     /if \(!_flashedBuildKey\) \{/.test(fn) && /'Not flashed'/.test(fn), fn);
  ok('and the label carries no qualifier that is doing no work',
     !/Not flashed this session/.test(src), 'nothing had happened, so there was nothing to contrast');
  ok('and it never reports a success it did not observe',
     !/setStatus\('flash', 'ok'[\s\S]{0,120}?!_flashedBuildKey/.test(fn));
  ok('an unknown hash on either side is NOT a mismatch',
     /if \(!_lastKnownConfigHash \|\| !_flashedBuildKey\.configHash\) return;/.test(fn),
     'calling the board stale because WE failed to identify a build is the same lie');

  // ⭐ OWNERSHIP IS ASKED, NOT PATTERN-MATCHED. The old guard tested /^Flash/ against the
  // label, and "Flash error" passes it - which is how a routine cache check wrote success
  // over a failed flash. Asserting the absence of that regex too, so it cannot come back.
  ok('it does not seize the chip while a flash is running',
     /if \(window\._isFlashing\) return;/.test(fn), fn);
  ok('a failed flash is sticky and cannot be refreshed away',
     /if \(_flashFailed\) \{/.test(fn) && /return;/.test(fn), fn);
  ok('and the failure REASON is re-attached on every refresh',
     /text\.title = _flashErrorTip;/.test(fn),
     'setStatus writes title = label, so any other chip update would leave the hover repeating "Flash error"');
  // Asserted against the MECHANISM, not the old regex's text - the comment above the guard
  // names /^Flash/ to explain why it went, and a negative assertion on the text would trip
  // on the explanation rather than on a regression.
  ok('and ownership is never decided by reading our own label',
     !/\.test\(text\.textContent/.test(codeOnly(fn)) && !/\/\^Flash\//.test(codeOnly(fn)),
     '"Flash error" matches /^Flash/, so a label match could never protect an error state');

  // ⭐ A TARGET CHANGE IS A MISMATCH EVEN WHEN THE CONFIG TEXT IS IDENTICAL.
  ok('the build TARGET is compared, not only the config text',
     /_lastKnownBuildPkgHash !== _flashedBuildKey\.buildPkgHash/.test(fn),
     'buildPkgHash was stamped at flash time and never compared: V2 -> V3 left "Flash successful" over a V2 binary');
  ok('and it says so in its own words',
     /Board has a build for a different target/.test(fn), fn);
  ok('the target check runs BEFORE the config-text check',
     fn.indexOf('_flashedBuildKey.buildPkgHash') < fn.indexOf('!_lastKnownConfigHash'),
     'it is the more specific statement of the two');
}

// ── WHICH BOARD, asked before anything about the build ────────────────────
// "no board attached" was half of this entry's founding repro and the half left unbuilt on
// 2026-09-13: the chip read "Flash successful" all night with nothing plugged in.
{
  const fn    = fnBody('_refreshFlashProvenance');
  const stamp = objLiteral('_flashedBuildKey = {');
  ok('the flash stamp records WHICH BOARD',
     /sn:\s+isDfuMode \? null : \(_flashTargetSN \|\| selectedPortSN \|\| null\)/.test(stamp),
     'from the frozen target, because the touch-reset nulls selectedPortSN before the handler runs');
  // ⚠️ AND IT STAMPS NOTHING ON A DFU FLASH. That path sets no _flashTargetSN, so
  // selectedPortSN still holds the board selected BEFORE entering the bootloader - a different
  // board entirely if one was swapped. Stamping it produced a confident "A different board was
  // flashed" about the very board just flashed (2026-09-15). Unknown beats wrong; the real
  // serial arrives when the board re-enumerates.
  ok('a DFU flash stamps no serial until the board re-enumerates',
     /isDfuMode \? null/.test(stamp), stamp);
  const watcher = fnBody('watchForSerialAfterDfu');
  ok('and the post-DFU watcher fills it in there',
     /if \(_flashedBuildKey && !_flashedBuildKey\.sn\) _flashedBuildKey\.sn = lastFlashedSN;/.test(watcher),
     watcher);
  ok('and re-reads the chip once it knows',
     /_refreshFlashProvenance\(\);/.test(watcher), watcher);
  ok('a missing board is not called a match', /if \(!selectedPortSN\) \{/.test(fn), fn);
  ok('and a connected board with no serial is distinguished from an empty port',
     /selectedPortIsProffieboard/.test(fn),
     'a board reporting no SN is the one genuine unknown; do not tell the user nothing is plugged in');
  ok('a different board is named as such', /A different board was flashed/.test(fn), fn);
  ok('the board question precedes the build question',
     fn.indexOf('!selectedPortSN') < fn.indexOf('_flashedBuildKey.buildPkgHash'),
     'a statement about the wrong board is wrong whatever its hashes say');
  // ⚠️ REVERSED 2026-09-15. This asserted that entering DFU SETS "Board in bootloader mode",
  // on the reasoning that a board in its bootloader is not running firmware so the old claim
  // would be a lie. The connection METHOD has no bearing on the firmware: DFU is a transport.
  // The board still holds what was flashed to it, so
  // the claim stays true and overwriting it lost a real fact to report a connection mode that
  // the DFU indicator beside the port already shows. Reset state #8 was never a reset state.
  ok('bootloader mode leaves the chip alone', /if \(isDfuMode\) return;/.test(fn), fn);
  ok('and does not write a transport state over a firmware fact',
     !/Board in bootloader mode/.test(codeOnly(fn)), codeOnly(fn));
}

// ── the reset states have real triggers, not just a function that could run ─
{
  const apply = fnBody('applyDetectedBoard');
  const clear = fnBody('clearDetectedBoard');
  const dfu   = fnBody('_setupDfuModeUI');
  const exit  = fnBody('exitDfuMode');
  ok('a board arriving re-reads the chip',    /_refreshFlashProvenance\(\);/.test(apply), apply);
  ok('a board leaving re-reads the chip',     /_refreshFlashProvenance\(\);/.test(clear), clear);
  ok('entering bootloader mode does NOT re-read it',
     !/_refreshFlashProvenance\(\);/.test(codeOnly(dfu)),
     'entering DFU changes nothing the flash chip reports');
  // Leaving DFU DOES matter, and not because of the transport: exitDfuMode nulls selectedPort
  // and selectedPortIsProffieboard, so the BOARD question has a new answer and must be re-asked.
  ok('leaving bootloader mode re-reads it', /_refreshFlashProvenance\(\);/.test(exit), exit);
  ok('the board re-read is NOT gated on having an FQBN',
     apply.indexOf('_refreshFlashProvenance();') < apply.indexOf('if (selectedFqbn)'),
     'the board question does not depend on an FQBN; the cache check does');
}

// ── ⭐ THE EVIDENCE RULE: the LABEL is session-scoped, the HOVER may read the file ─
// Settled 2026-09-15: metadata is fair for a hover. A stored record is honest as
// history and dishonest as a present claim - it says what we once did, never that nothing
// has happened since. This asserts the split rather than trusting it to stay.
{
  const fn  = fnBody('_refreshFlashProvenance');
  const dec = fnBody('_decorateFlashChip');
  ok('the label never reads the persisted record',
     !/getMetaFlashed|getMetaBoardSN/.test(fn),
     'metadata driving the LABEL would re-assert a certainty that ended when the board was unplugged');
  ok('and the hover does', /getMetaFlashed/.test(dec) && /getMetaBoardSN/.test(dec), dec);

  // ⭐ THE HOVER'S SUBJECT IS THE FILE, NOT THE OPEN CONTENT. Found in dev testing
  // 2026-09-15: a draft read "This config records a flash on <date>", which reads as a claim
  // about what is on screen - and the file had been flashed at 9:26 and edited at 10:16. The
  // @jmt block carries no flashed config hash, so that question cannot be answered here at
  // all. "Last flashed" states the file's history and claims nothing about the open version.
  ok('the hover speaks about the FILE, never the open version',
     /Last flashed/.test(dec) && !/This config records/.test(codeOnly(dec)), codeOnly(dec));
  ok('and it does not imply the open version is on the board',
     !/records a flash/.test(codeOnly(dec)), codeOnly(dec));
  // Changed 2026-09-15: a tooltip has more room than a label, so it should add value rather
  // than fall silent. With no record there is still
  // something worth saying - "Not flashed" reads as a claim about the BOARD, and this scopes
  // it to our own history, which is all we actually know.
  ok('no record still says something the label does not',
     /no record of flashing this config/.test(dec), dec);

  // ⭐⭐ AND THE RECORD MAY ONLY SPEAK IF IT COULD BE ABOUT WHAT IS OPEN. Dev testing
  // 2026-09-15: an edited config showed "Not flashed" hovering "Last flashed 2:00 PM" beside a
  // compile chip reading "Config changed". A config not even compiled cannot ever have been
  // flashed - you cannot flash what was never built, so content that is not a known build
  // cannot be the one the record describes.
  ok('the file record is gated on the open content being a known build',
     /if \(!_openContentIsBuilt\) return;/.test(dec), dec);
  ok('and that gate sits BEFORE the record is read',
     dec.indexOf('!_openContentIsBuilt') < dec.indexOf('getMetaFlashed'),
     'reading it first and then discarding it would still be a claim assembled about the wrong version');

  // ⚠️⚠️ AND THE GATE MUST NOT READ `compileSuccess` - the bug found minutes after the gate
  // shipped. That flag is assigned INSIDE the `if (result.hit)` branch, and the provenance
  // call was hoisted ABOVE that branch so it fires on a miss too - so the gate saw a stale
  // false on every restart and silently suppressed a legitimate hover: after a flash and a
  // restart the label was right and the tooltip simply absent. The value is decided at the
  // cache check now, where it is known.
  ok('the gate does not read a flag assigned after the call that uses it',
     !/compileSuccess/.test(codeOnly(dec)),
     'compileSuccess is set inside the hit branch, below the hoisted provenance call');
  const body2 = sliceTo('async function checkCacheForConfig', '// ── DFU mode', 0, 'function');
  ok('the cache check decides it where the answer is known',
     /_refreshFlashProvenance\(result\.configHash, result\.buildPkgHash,[\s\S]{0,80}?result\.hit \|\| result\.buildOutputMatches/.test(body2),
     body2.slice(body2.indexOf('_refreshFlashProvenance'), body2.indexOf('_refreshFlashProvenance') + 220));

  // ⚠️ TOOLTIP LENGTH IS A CONVENTION, NOT TASTE - local/ui-conventions.md, "one line,
  // roughly 12 words", and "fix the whole set when one is flagged". Every one of these ran
  // to two or three sentences on the first pass and was cut. Asserted so they cannot regrow.
  // ⚠️ MEASURE EACH STRING, NOT THE STATEMENT. The first version of this matched
  // `text.title = <up to the semicolon>`, which swallows both arms of a multi-line ternary -
  // so two one-sentence tooltips counted as a two-sentence one. It still found a real
  // two-sentence tooltip, but for the wrong reason, which is its own kind of false green.
  const stmts = (fnBody('_refreshFlashProvenance') + dec).match(/text\.title\s*=[^;]+;/g) || [];
  const tips  = stmts.join('\n').match(/(['`])(?:\\.|(?!\1)[\s\S])*\1/g) || [];
  // ⚠️ THE CONVENTION IS LENGTH, NOT SENTENCE COUNT, and my first version of this asserted the
  // wrong one. local/ui-conventions.md says "one line, roughly 12 words" - two short sentences
  // on one line satisfy that, and a single rambling sentence does not. Measuring periods
  // flagged correct copy and would have let a 200-character one-liner through.
  const long = tips.filter(t => t.replace(/\$\{[^}]*\}/g, 'Sep 15, 1:27 PM').length > 104);
  ok('every flash tooltip fits one line', tips.length > 0 && long.length === 0,
     long.join('\n') || '(none)');
  ok('and none of them uses a contraction',
     !/\b(it|that|can|do|does|would|will|is|has|have)n?'(s|t|ll|ve|re)\b/i.test(tips.join(' ')),
     'no contractions appear anywhere in the app\'s user-facing strings; one stands out');
  ok('and no em dash reaches a user-facing toolchain message',
     !/—/.test((fs.readFileSync(path.join(ROOT,'toolchain.js'),'utf8')
       .match(/msg = '[^']+'/g) || []).join(' ')),
     'flagged 2026-09-15 in the flash-failure modal, and a second instance was sitting beside it');
}

// ── a failed flash is recorded, and only a real flash clears it ────────────
{
  ok('a failure sets the sticky flag', /_flashFailed\s*=\s*!ok;/.test(src),
     'and a success clears it, which is the only thing that legitimately can');

  // ⚠️⚠️ THE HANDLER MUST NOT REFERENCE A PARAMETER IT DOES NOT HAVE. 2026-09-15: the flash and
  // compile branches were given `_firstSentence(error || message)` in the belief that they sat
  // in onBuildDone, which destructures `error`. They sit in onBuildStatus, which does not - so
  // every failed flash and every failed compile threw "error is not defined" and the handler
  // died BEFORE setStatus could write the terminal label. That is why an interrupted flash sat
  // on "Flashing on COM6..." indefinitely.
  // ⚠️ Neither `node --check` nor this suite could see it: it is a runtime ReferenceError in a
  // function nothing here executes - it surfaced in the DevTools console. This assertion is
  // the narrow backstop, not a substitute for a linter with no-undef.
  const statusFn = fnBody('onBuildStatus');
  const declared = (statusFn.match(/^function onBuildStatus\(\{([^}]*)\}/) || [, ''])[1]
                     .split(',').map(s => s.trim().split(/[:=]/)[0].trim()).filter(Boolean);
  ok('onBuildStatus does not destructure `error`', !declared.includes('error'),
     `it declares: ${declared.join(', ')}`);
  ok('and therefore never reads a bare `error` value',
     !/[^.\w'"]error\s*(\|\||\)|,|;)/.test(codeOnly(statusFn)),
     'main sends the reason AS `message` for this channel');
  ok('and captures the reason at the one moment we have it',
     /_flashErrorTip\s*=\s*ok \? '' : _firstSentence\(message\)/.test(src),
     'after this the cause is only in the build log, which scrolls');
  const reset = arrowBody('window.resetBuildStatusForFileLoad');
  ok('loading another file clears the sticky error too', /_flashFailed\s*=\s*false;/.test(reset),
     'carrying it across would pin an error on a config that was never flashed');
  ok('and drops the stale reason with it', /_flashErrorTip\s*=\s*'';/.test(reset), reset);
  ok('and clears the remembered build identity', /_lastKnownConfigHash\s+= null;/.test(reset), reset);
}

// ── the cache hit knows whose build it is ──────────────────────────────────
{
  ok('the session records what it genuinely compiled',
     /const _sessionBuiltHashes = new Set\(\);/.test(src));
  ok('a real compile files its hash as ours',
     /checkCacheForConfig\(false, \{ afterCompile: true \}\)/.test(src),
     'the compile result does not carry the hash; the cache check is where it is learned');
  ok('only an afterCompile check may file one',
     /if \(opts && opts\.afterCompile && result\.configHash\) _sessionBuiltHashes\.add/.test(src),
     'otherwise opening a config would claim its cached build as this session\'s work');

  const label = src.slice(src.indexOf("setStatus('compile', 'ok',\n"), src.indexOf("setStatus('compile', 'ok',\n") + 320)
             || src.slice(src.indexOf("_sessionBuiltHashes.has(result.configHash)") - 200, src.indexOf("_sessionBuiltHashes.has(result.configHash)") + 200);
  ok('a hit on OUR build reads "Compile successful"',
     /_sessionBuiltHashes\.has\(result\.configHash\)\)?\s*\r?\n?\s*\?\s*'Compile successful'/.test(src), label);
  ok('and a genuine restore still says so',
     /:\s*'Compile restored from cache'/.test(src), label);
}

// ── the re-read runs on a MISS too, which is the state a person sits in ────
//
// Found 2026-09-15 during the dev test, by editing a config and watching the chips:
// "Config changed - recompile needed" sat beside "Flash successful", which together
// still say the current file is on the board. The call lived inside the hit branch,
// and an edit is a MISS - that content has never been compiled - so it never fired.
// The chip could recover but never degrade, because editing BACK to compiled content
// IS a hit: it only ever moved toward the optimistic claim.
// ⚠️ The old TC-3271 passed over this. It said "compile again", and after a recompile
// the new content hits, the re-read fires and the chip degrades correctly. The case
// only ever sampled AFTER a recompile and never the window in between.
{
  const body = src.slice(src.indexOf('async function checkCacheForConfig'),
                         src.indexOf('// ── DFU mode'));
  // Matched on the call, not its exact argument list - a third argument was added 2026-09-15
  // and this assertion broke on the text while the property it guards was still true.
  const callIdx = body.indexOf('_refreshFlashProvenance(result.configHash');
  const hitIdx  = body.indexOf('if (result.hit) {');
  ok('the flash re-read runs BEFORE the hit/miss branch',
     callIdx > -1 && hitIdx > -1 && callIdx < hitIdx,
     'inside the hit branch it cannot fire on an edit, which is the only time it matters');
  ok('one call site, so the two paths cannot drift',
     (body.match(/_refreshFlashProvenance\(/g) || []).length === 1);
}

// ── the fact the fix rests on, asserted where it is PRODUCED ───────────────
// A miss knows the hash - hashing is how it decided it was a miss. If this return
// ever stops carrying configHash the re-read above goes quiet on the miss path and
// nothing here would notice, so the assertion lives against the producer.
{
  const cm = fs.readFileSync(path.join(ROOT, 'cacheManager.js'), 'utf8');
  ok('a cache MISS still returns the config hash',
     /if \(!entry\) return \{ hit: false, buildOutputMatches: inOutput, configHash, buildPkgHash \};/.test(cm),
     'without it the miss path has nothing to compare against the flashed build');
}

// ── the stamp does not outlive its file ────────────────────────────────────
{
  const reset = arrowBody('window.resetBuildStatusForFileLoad');
  ok('opening another config clears the flash stamp', /_flashedBuildKey = null;/.test(reset), reset);
  // The hover is no longer hardcoded here - it is rebuilt from the newly-loaded file's own
  // @jmt record, which is the only thing that can be true about a file we just opened.
  ok('and rebuilds the hover from the new file\'s record',
     /_decorateFlashChip\(\);/.test(reset), reset);
}

// ── every current flash carries its timestamp ──────────────────────────────
{
  ok('a successful flash gets hover provenance', /if \(ok\) _decorateFlashChip\(\);/.test(src));
  const dec = fnBody('_decorateFlashChip');
  ok('which names when it happened', /Flashed \$\{when\}/.test(dec), dec);
  // Added 2026-09-15: the mismatch case names both serials, so a success naming none was the
  // odd one out. "Which board did this go to" is exactly what the hover is for.
  // ⭐ Sharpened the same day: it must SAY which board, not print a serial to be compared
  // against the Detected field by eye. That comparison was already made to choose the label,
  // so leaving it to be repeated is the same failure as a hover that repeats its label.
  ok('and WHICH BOARD it went to, in words',
     /to this board \(SN: \$\{sn\}\)/.test(dec), dec);
  ok('the file record distinguishes this board from a different one',
     /to this board \(SN: \$\{metaSN\}\)/.test(dec)
       && /to a different board \(SN: \$\{metaSN\}\)/.test(dec), dec);
  ok('and states neither when nothing is connected to compare against',
     /if \(!selectedPortSN\)\s*\{ text\.title = `Last flashed \$\{metaWhen\} to SN: \$\{metaSN\}`/.test(dec), dec);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall build chip provenance tests passed');
process.exit(failures ? 1 : 0);

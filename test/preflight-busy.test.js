// Every blocking destination call goes through one helper.            [B-203, B-238]
//
// ⭐⭐ WHY THIS IS A TEST AND NOT A CONVENTION. The bar started per-door, and per-door is
// exactly the shape that has failed here three times: enumerating export doors BY READING
// the file missed one every single time, and he found each of them by clicking - the zip
// door, "Export font folder…", the common-folder door. A rule that lives only in a comment
// gets obeyed by whoever remembers it.
//
// So the rule is mechanical: no renderer code calls checkExportDest / classifyExportDest /
// sourceExportSize on the bridge directly. It goes through _sfCheckFit, _sfClassifyDest or
// _sfSourceExportSize. A new door written next year has no other way to ask the question.
//
// ⚠️⚠️ THIS FILE INVERTED ON 2026-09-23 AND THAT IS THE POINT OF THE REWRITE. It used to
// assert that each helper WRAPS `_sfPreflightBusy` - a 150 ms-delayed `_sdBusy` overlay. That
// was correct while most doors had no progress surface of their own. Once the runner began
// supplying a modal to every door, the overlay became a SECOND surface for the same wait, and
// these assertions were quietly requiring the shape that produced the bug: passing meant the
// overlay was still wired in. His call was to delete it rather than guard it.
//
// ⭐ So the rule flipped rather than relaxed. The helpers still exist and are still the only
// door; what they must NOT do any more is paint. The new assertion is the one that would have
// caught this class: nothing on the export path may reach `_sdBusy`.
//
// ⚠️ KNOWN AND TEMPORARY: doors 3, 4, 11, 12 and 13 now check their destination with nothing
// on screen, because they are not on the runner yet. Silence is the deliberate signal for
// "not migrated" in a dev build. When the OFF list is empty this stops being a trade-off.
//
// ⚠️ ONE EXEMPTION, AND IT IS SPELLED OUT IN THE SOURCE: the background transport prime.
// Nothing awaits it, so it never blocked anyone. It carries a `preflight-busy-exempt:` marker
// within a few lines of the call; nothing else may.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'renderer', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`);
}

const GUARDED = ['checkExportDest', 'classifyExportDest', 'sourceExportSize'];

// The helper definitions are the intended direct calls; find them by the shape they are
// written in rather than by line number, which moves with every edit.
// ⚠️ RE-ANCHORED 2026-09-23 with the overlay's removal: the helpers used to be a two-line
// wrapped form and are now a one-line direct call, so the old shape matched nothing and every
// helper definition would have been reported as a bare violation of its own rule.
const isWrapperLine = (l) =>
  /^\s*const _sf\w+ = \(args\) => window\.electronAPI\.\w+\(args\);\s*$/.test(l);

// ── Rule: no bare bridge call outside a wrapper or the marked exemption ──
for (const fn of GUARDED) {
  const bad = [];
  lines.forEach((line, i) => {
    if (!line.includes(`window.electronAPI.${fn}(`)) return;
    if (isWrapperLine(line)) return;
    // The exemption marker must sit in the handful of lines just above the call, so it is
    // read together with the call it excuses.
    const near = lines.slice(Math.max(0, i - 6), i).join('\n');
    if (near.includes('preflight-busy-exempt:')) return;
    bad.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
  });
  ok(`${fn} is only reached through its named helper`, bad.length === 0,
    bad.length ? `bare call at ${bad.join(' | ')}` : '');
}

// ── Rule: a probe is a destination call, and there is only one ──
// The probe walks the selection AND spawns the device lookup, so it is the slowest
// pre-flight of all. A `probe: true` anywhere but inside _sfProbeExport is either a bare
// slow call or - worse - a copy-paste that dropped the flag and became a write.
{
  const bad = [];
  lines.forEach((line, i) => {
    if (!/probe:\s*true/.test(line)) return;
    // ⚠️ A comment that NAMES the rule is not a violation of it. The first run of this
    // test failed on its own explanatory comment, which is the source-grep version of a
    // test passing for the wrong reason - in reverse.
    if (/^\s*(\/\/|\*)/.test(line)) return;
    // ⚠️ RE-ANCHORED 2026-09-23: the probe used to be identified by the `_sfPreflightBusy` wrap
    // on its own or the preceding line. With the wrap gone the anchor is the helper's own name.
    if (line.includes('_sfProbeExport') || lines[i - 1]?.includes('_sfProbeExport')) return;
    bad.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
  });
  ok('probe: true appears only inside _sfProbeExport', bad.length === 0, bad.join(' | '));
  ok('_sfProbeExport calls the bridge directly, with no overlay around it',
    /const _sfProbeExport = \(args\) =>\s*\n?\s*window\.electronAPI\.sfExportFiles\(\{ \.\.\.args, probe: true \}\)/.test(src));
  // A probe that throws must come back null, not reject - the caller treats null as
  // "the question was not asked" and lets main ask again.
  ok('_sfProbeExport swallows its own failure to null',
    /const _sfProbeExport[\s\S]{0,260}?\.catch\(\(\) => null\)/.test(src));
}

// ── Rule: the multi-path door asks before it raises the bar ──
// ⚠️ THE ACTUAL BUG HE REPORTED: "does the regular progress bar before the 'this will
// take a while' message." The probe must precede _sfRunWithByteProgress, not follow it.
{
  const door = src.slice(src.indexOf('const _sfExportFiles = async'),
                         src.indexOf('// Unified dispatcher'));
  // ⚠️⚠️ RE-ANCHORED 2026-09-22. The rule is unchanged and is the whole point of this file: the
  // probe must run BEFORE anything is on screen, because asking over a live bar is the two-phase
  // handshake he caught on a 57-file source export ("does the regular progress bar before the
  // 'this will take a while' message").
  //
  // ⭐ What changed is WHO enforces it. The door used to sequence probe-then-bar by hand; the
  // runner now calls `plan()` before it raises the modal, so the ordering is structural. The
  // assertion moves with it: the probe must live inside `plan`, and `plan` must come before
  // `produce` in the door object.
  const probeAt = door.indexOf('_sfProbeExport(');
  const planAt = door.indexOf('plan: async');
  const produceAt = door.indexOf('produce: async');
  ok('the probe runs before the progress bar is raised',
     probeAt > -1 && planAt > -1 && produceAt > -1 && planAt < probeAt && probeAt < produceAt,
     'the probe belongs in plan(), which the runner calls before it raises anything. Outside '
     + 'plan it either asks over a live bar or does not size the runner\'s preflight at all');
  // ⚠️ RE-ANCHORED 2026-09-22. This asserted the door caught main's `slowWrite` REPLY and
  // raised the dialog itself - the shape of a door that lets the backend ask. The single-item
  // branch now picks its own destination up front and the runner asks before any work, so there
  // is no reply to catch: the door passes `confirmSlow: true` precisely because the question has
  // already been answered on this side.
  ok('the lone-item branch asks BEFORE the write, not in reply to it',
    /confirmSlow: true/.test(door) && !/res\.slowWrite/.test(door),
    'catching a slowWrite reply means main asked after starting - the two-phase handshake this '
    + 'file exists to keep out');
}

// ── Rule: the helpers exist and call the bridge with nothing in between ──
for (const [name, fn] of [['_sfCheckFit', 'checkExportDest'],
                          ['_sfClassifyDest', 'classifyExportDest'],
                          ['_sfSourceExportSize', 'sourceExportSize']]) {
  const def = new RegExp(`const ${name} = \\(args\\) => window\\.electronAPI\\.${fn}\\(args\\);`);
  ok(`${name} calls ${fn} directly`, def.test(src));
}

// ── Rule: the export path never reaches the small overlay ──
//
// ⭐⭐ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE DOUBLE SURFACE, and it is written as a
// REACHABILITY rule rather than a spelling one. `_sdBusy` is a legitimate shared overlay - the
// SD read, the config scan and the health check all use it. What must never happen again is an
// export-side helper raising it while the runner's modal is saying the same words.
//
// ⚠️ The old version of this file asserted the opposite and passed the whole time.
{
  const helpersFrom = src.indexOf('// ── The only four ways a door talks to a destination');
  const helpersTo = src.indexOf('window._sfProbeExport');
  ok('the destination helpers block was found', helpersFrom > -1 && helpersTo > helpersFrom,
    'anchor moved - re-find it before trusting this file');
  const helpers = helpersFrom > -1 && helpersTo > helpersFrom
    ? src.slice(helpersFrom, helpersTo) : '';
  ok('the destination helpers do not raise the busy overlay',
    helpers.length > 0 && !/_sdBusy\(/.test(helpers));

  const pfFrom = src.indexOf('async function _sfPreflightDestination');
  const pfTo = src.indexOf('window._sfPreflightDestination');
  ok('_sfPreflightDestination was found', pfFrom > -1 && pfTo > pfFrom);
  const pf = pfFrom > -1 && pfTo > pfFrom ? src.slice(pfFrom, pfTo) : '';
  ok('the shared preflight does not raise the busy overlay',
    pf.length > 0 && !/_sdBusy\(/.test(pf));

  // The wrapper itself must be gone, not merely unused: a dormant definition is what gets
  // wired back in by the next person who wants a bar on a slow call.
  ok('_sfPreflightBusy is deleted, not left dormant',
    !/(async )?function _sfPreflightBusy/.test(src) && !/window\._sfPreflightBusy =/.test(src));
}

// ── Rule: the slow-write threshold is tested before any device lookup is made ──
//
// ⚠️⚠️ THESE THREE ASSERTIONS USED TO CHECK `_sfWarnSlowWrite`'s INTERNALS, AND THAT FUNCTION
// HAD NO CALLERS. [2026-09-23] They passed the whole time - it named the threshold constant, it
// made the board-card call, it did them in order - describing a function the last door stopped
// calling on 2026-09-22. ⭐ A test can keep a corpse warm, and green over dead code is
// indistinguishable from green over working code. The function is deleted; the RULE it was
// protecting is real and now asserted where the behaviour actually lives.
//
// ⭐ The rule: a job under the limits must not trigger the ~1.9s device lookup at all, so the
// threshold has to be computed before `classify` is requested, not after.
const pfBody = src.slice(src.indexOf('async function _sfPreflightDestination'),
                         src.indexOf('window._sfPreflightDestination'));
ok('the shared preflight was located', pfBody.length > 200,
  're-anchor before trusting the positions below');
ok('the shared preflight computes the slow-write threshold itself',
  pfBody.indexOf('SF_SLOW_WRITE_MIN_FILES') >= 0 && pfBody.indexOf('wantsDevice') >= 0);
ok('and it decides the threshold BEFORE asking for the device lookup',
  pfBody.indexOf('wantsDevice') >= 0
  && pfBody.indexOf('wantsDevice') < pfBody.indexOf('classify: wantsDevice'));

// ── Rule: the deleted per-door warner stays deleted ──
// It is superseded by the block above. A door re-adding it is a door going back to asking the
// same two questions in two places, which is what [B-005 item 4] removed.
ok('_sfWarnSlowWrite is gone, not merely uncalled',
  !/function _sfWarnSlowWrite/.test(src) && !/window\._sfWarnSlowWrite =/.test(src));

// ── Rule: a quantity never wraps away from its unit, and the check is mechanical ──
//
// ⭐⭐ WHY THIS IS HERE. His catch on the first real refusal was that the dialog broke the line
// mid-quantity - "496.2" above, "MB more room." below - which reads as two separate facts. The
// fix is a non-breaking space between number and unit, swapped in at the dialog rather than in
// `_sfFormatBytes`, which other surfaces measure and match against.
//
// ⚠️⚠️ AND IT WAS NOT ACTUALLY APPLIED FOR AN UNKNOWN NUMBER OF DAYS. [2026-09-23] Both shared
// dialogs read `.replace(' ', ' ')` - a PLAIN space replaced by a PLAIN space, which does
// nothing at all. The one correct copy, with a real U+00A0, lived in `_sfFmtSpace` in the
// primary export - a function with zero callers. So the fix existed only where it could never
// run, and the two places that do run looked right and did nothing.
//
// ⭐ THE READING LESSON: a literal non-breaking space is INVISIBLE in a diff, in a review and in
// an editor. It survives being typed once and is lost by every copy-paste after. So the source
// now uses the ESCAPE `\u00A0`, which cannot be flattened silently, and this asserts the escape
// rather than the character.
{
  // An identity replace is always a no-op and always a mistake.
  const noops = [];
  lines.forEach((l, i) => {
    const m = l.match(/\.replace\((['"])(.*?)\1\s*,\s*(['"])(.*?)\3\)/);
    if (!m) return;
    if (m[2] === m[4]) noops.push(`${i + 1}: ${l.trim().slice(0, 80)}`);
  });
  ok('no string formatter replaces a character with itself', noops.length === 0,
    noops.join(' | ') + ' - an identity replace reads as a transformation and performs none');

  for (const fn of ['_sfRefuseNotEnoughRoom', '_sfSlowWriteDialog']) {
    const i = src.indexOf(`async function ${fn}`);
    const j = src.indexOf('\n}', i);
    const body = (i > -1 && j > i) ? src.slice(i, j) : '';
    ok(`${fn} was located`, body.length > 0, 're-anchor before trusting the check below');
    ok(`${fn} joins the number to its unit with a hard space`,
      /\.replace\(' ', '\\u00A0'\)/.test(body),
      'a plain space lets the dialog wrap between "496.2" and "MB", which he reported as two '
      + 'different things on one line');
  }
}

// ── Rule: the busy overlay it leans on still exists ──
ok('_sdBusy is still the shared indeterminate overlay',
  /function _sdBusy\(show, text, opts\)/.test(src)
  && /sf-import-progress-bar indeterminate/.test(src));

console.log(failures ? `\npreflight-busy: ${failures} failing` : '\npreflight-busy: all passing');
process.exit(failures ? 1 : 0);

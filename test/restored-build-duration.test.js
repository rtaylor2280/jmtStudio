// A restored build must describe ITS OWN compile, including the duration.  [B-474]
//
// ⚠️ THIS IS A SEAM TEST AND SAYS SO. The setter lives in index.html and the
// conversion sits inside a closure in buildPanel.js, so neither can be required()
// and every assertion here is over source text. That is a weaker instrument than
// running the code, and it is the right one for this defect: the bug was never a
// wrong calculation, it was a value that existed and was not passed.
//
// ⭐ WHAT IT IS GUARDING. Four runs on one config, 2026-10-05:
//      15:42  fresh compile 7.15 +JMT  -> 98
//      15:48  fresh compile 7.14 +JMT  -> 108
//      15:54  RESTORE of the 15:42 build -> 108, the time of an unrelated compile
//      15:57  fresh compile 7.14 +JMT  -> 93
// Every other field on that restore was right. This one named a different build.

const fs   = require('fs');
const path = require('path');

let failures = 0;
function ok(label, cond, extra) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (extra) console.log(`       ${extra}`);
}

const root       = path.join(__dirname, '..');
const buildPanel = fs.readFileSync(path.join(root, 'renderer', 'buildPanel.js'), 'utf8');
const html       = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const cacheMgr   = fs.readFileSync(path.join(root, 'cacheManager.js'), 'utf8');

// ── The value has to EXIST before anything can pass it ───────────────
// Producer/consumer reconciliation: if the cache ever stops returning this field,
// the restore path goes quietly back to writing null forever and the symptom
// changes from "wrong number" to "no number" without a single test going red.
ok('the cache entry still returns compileDurationMs',
   /compileDurationMs:\s*meta\.compileDurationMs/.test(cacheMgr),
   'the restore reads result.metadata.compileDurationMs; if the producer drops it, this breaks silently');

// ── The restore passes it, in the right units ────────────────────────
ok('the restore reads the duration off the ENTRY',
   /const _ms\s*=\s*result\.metadata\.compileDurationMs;/.test(buildPanel),
   'passing undefined is what left the previous build\'s number standing');

// ⚠️ UNITS. The cache stores milliseconds; the setter takes seconds. A missing
// conversion is a 1000x error that still looks like a plausible number in a field
// nobody validates.
ok('it converts ms to seconds',
   /Math\.round\(_ms \/ 1000\)/.test(buildPanel),
   'cacheManager stores ms, setCompiledTimestamp takes seconds');

ok('a missing stored duration becomes null, not undefined',
   /\(typeof _ms === 'number'\) \? Math\.round\(_ms \/ 1000\) : null/.test(buildPanel),
   'undefined would re-enter the old behaviour through the back door');

ok('the converted value is the second argument to the setter',
   /setCompiledTimestamp\(result\.metadata\.compiledAt, _dur,/.test(buildPanel),
   'positional - second slot is durationSec');

// ── The setter can express "unknown" ─────────────────────────────────
ok('the setter assigns the duration unconditionally',
   /metaCompileDuration = \(typeof durationSec === 'number'\) \? durationSec : null;/.test(html));

// ⭐ THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. The old line was
// `if (durationSec) metaCompileDuration = durationSec;` and a truthiness guard
// simply cannot say "I do not know how long this took".
ok('the old truthiness guard is gone',
   !/if \(durationSec\)\s*metaCompileDuration/.test(html),
   'a guard that skips on null keeps an unrelated build\'s number');

// ── Null has to be harmless downstream ───────────────────────────────
// Making it clearable is only safe if every reader tolerates null. Both do today;
// this is what notices if one stops.
ok('the serializer omits the line when the duration is unknown',
   /if \(metaCompileDuration\) lines\.push\(`\/\/ @jmt:compile_duration/.test(html),
   'without the guard a cleared value would write "@jmt:compile_duration null" into his config');

ok('the Last compile label renders empty rather than "null"',
   /_lastEl\.textContent = _lastDur/.test(buildPanel) &&
   /:\s*'';/.test(buildPanel.slice(buildPanel.indexOf('_lastEl.textContent = _lastDur'),
                                   buildPanel.indexOf('_lastEl.textContent = _lastDur') + 300)),
   'the consumer of getLastCompileDuration must treat null as "no label"');

// ── Control ──────────────────────────────────────────────────────────
// ⚠️ Every assertion above is a regex over a file. If a file failed to load, or an
// anchor moved, they could all pass or all fail for reasons unrelated to the fix.
ok('CONTROL: all three sources loaded and contain their anchors',
   buildPanel.length > 1000 && html.length > 1000 && cacheMgr.length > 1000 &&
   buildPanel.includes('setCompiledTimestamp') &&
   html.includes('window.setCompiledTimestamp') &&
   cacheMgr.includes('compileDurationMs'),
   'if this fails, treat every result above as unread rather than as passing');

console.log(failures
  ? `\nrestored-build-duration: ${failures} FAILED`
  : '\nrestored-build-duration: all checks passed');
process.exit(failures ? 1 : 0);

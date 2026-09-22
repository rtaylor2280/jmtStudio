// Every blocking destination call wears the busy bar.                 [B-203, B-238]
//
// ⭐⭐ WHY THIS IS A TEST AND NOT A CONVENTION. The bar started per-door, and per-door is
// exactly the shape that has failed here three times: enumerating export doors BY READING
// the file missed one every single time, and he found each of them by clicking - the zip
// door, "Export font folder…", the common-folder door. A rule that lives only in a comment
// gets obeyed by whoever remembers it.
//
// So the rule is mechanical: no renderer code calls checkExportDest / classifyExportDest /
// sourceExportSize on the bridge directly. It goes through _sfCheckFit, _sfClassifyDest or
// _sfSourceExportSize, which wrap _sfPreflightBusy. A new door written next year inherits
// the bar by having no other way to ask the question.
//
// ⚠️ ONE EXEMPTION, AND IT IS SPELLED OUT IN THE SOURCE: the background transport prime.
// Nothing awaits it, so an overlay there would cover an idle window. It carries a
// `preflight-busy-exempt:` marker within a few lines of the call; nothing else may.
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

// The wrapper definitions are the intended bare calls; find them by the shape they are
// written in rather than by line number, which moves with every edit.
const isWrapperLine = (l) => /^\s*\(\) => window\.electronAPI\.\w+\(args\)\);\s*$/.test(l);

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
  ok(`${fn} is only reached through the busy wrapper`, bad.length === 0,
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
    if (line.includes('_sfPreflightBusy') || lines[i - 1]?.includes('_sfPreflightBusy')) return;
    bad.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
  });
  ok('probe: true appears only inside _sfProbeExport', bad.length === 0, bad.join(' | '));
  ok('_sfProbeExport wraps the probe in the busy bar',
    /const _sfProbeExport = \(args\) => _sfPreflightBusy\([\s\S]{0,160}?probe: true/.test(src));
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
  const probeAt = door.indexOf('_sfProbeExport(');
  const barAt = door.indexOf("_sfRunWithByteProgress('Exporting files'");
  ok('the probe runs before the progress bar is raised',
    probeAt > -1 && barAt > -1 && probeAt < barAt);
  ok('a lone folder still handles the slow-write reply',
    /One item: the handler still asks[\s\S]{0,1400}?res\.slowWrite[\s\S]{0,400}?_sfSlowWriteDialog/.test(door));
}

// ── Rule: the wrappers exist and actually route through _sfPreflightBusy ──
for (const [name, fn] of [['_sfCheckFit', 'checkExportDest'],
                          ['_sfClassifyDest', 'classifyExportDest'],
                          ['_sfSourceExportSize', 'sourceExportSize']]) {
  const def = new RegExp(`const ${name} = \\(args\\) => _sfPreflightBusy\\([\\s\\S]{0,120}?window\\.electronAPI\\.${fn}\\(args\\)`);
  ok(`${name} wraps ${fn} in _sfPreflightBusy`, def.test(src));
}

// ── Rule: the overlay is delayed, never immediate ──
// ⚠️ THE DELAY IS LOad-BEARING. It is what makes it safe to wrap the cheap calls too: a
// fast destination answers inside the timer and shows nothing. Remove it and every export
// on an internal disk flashes an overlay for two frames.
const busyFn = src.slice(src.indexOf('async function _sfPreflightBusy'),
                         src.indexOf('window._sfPreflightBusy'));
ok('_sfPreflightBusy shows the overlay on a timer, not immediately',
  /setTimeout\([\s\S]*?_sdBusy\(true/.test(busyFn) && !/^\s*_sdBusy\(true/m.test(busyFn));
ok('_sfPreflightBusy clears the timer and hides in a finally',
  /finally\s*{[\s\S]*?clearTimeout\(timer\)[\s\S]*?_sdBusy\(false\)/.test(busyFn));
// A throw from the IPC must not strand the overlay over a dead export.
ok('_sfPreflightBusy returns the call through, not a wrapped value',
  /try\s*{\s*return await fn\(\);\s*}/.test(busyFn));

// ── Rule: the slow-write threshold is tested before any call is made ──
// Otherwise a small export raises an overlay to ask a question it does not need answered.
const warn = src.slice(src.indexOf('async function _sfWarnSlowWrite'),
                       src.indexOf('window._sfWarnSlowWrite'));
// ⚠️ RE-ANCHORED 2026-09-21. The call it makes is now `_sfDestIdentity.boardCard`, which goes
// through `_sfClassifyDest` internally but CACHES - so above the threshold the first door pays
// and the rest are free. The ordering rule is untouched and is still the point: a small export
// must not raise an overlay to ask a question whose answer cannot change anything.
// ⚠️ `indexOf` returns -1 for a name that is no longer there, and "-1 is less than anything"
// makes a stale anchor FAIL rather than pass - which is how this one surfaced. Assert the
// marker exists before comparing positions, so a future rename cannot pass vacuously instead.
ok('_sfWarnSlowWrite still names the threshold constant',
  warn.indexOf('SF_SLOW_WRITE_MIN_FILES') >= 0);
ok('_sfWarnSlowWrite still makes the board-card call',
  warn.indexOf('_sfDestIdentity.boardCard') >= 0);
ok('_sfWarnSlowWrite checks its thresholds before calling out',
  warn.indexOf('SF_SLOW_WRITE_MIN_FILES') < warn.indexOf('_sfDestIdentity.boardCard'));

// ── Rule: the busy overlay it leans on still exists ──
ok('_sdBusy is still the shared indeterminate overlay',
  /function _sdBusy\(show, text, opts\)/.test(src)
  && /sf-import-progress-bar indeterminate/.test(src));

console.log(failures ? `\npreflight-busy: ${failures} failing` : '\npreflight-busy: all passing');
process.exit(failures ? 1 : 0);

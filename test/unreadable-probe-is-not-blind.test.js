/**
 * The readability probe must SEE a file it cannot read, and the obvious API does not.  [B-478]
 *
 * THIS IS A CONTROL TEST, NOT A FEATURE TEST. The feature is covered by
 * `backup-skips-unreadable.test.js`, which feeds the exporter a path and checks it is honoured.
 * That test would pass just as happily if the probe could not detect anything at all, because it
 * supplies the path itself. This one supplies a file and asks the probe to FIND it.
 *
 * WHAT IT PINS, measured 2026-10-12 against a file carrying a Windows DENY ace:
 *     fs.accessSync(p, R_OK)  ->  returns OK        <- the obvious choice, and it is blind
 *     fs.openSync(p, 'r')     ->  throws EPERM      <- what the probe actually uses
 * An access check cannot see an ACL denial. A readability sweep built on it reports a clean
 * library, the user is told nothing, and the export still stops on the file - the exact failure
 * the gate was added to prevent, wearing a green check.
 *
 * So the second assertion below is deliberately asserting a WEAKNESS in `fs.access`. If a future
 * Node makes it ACL-aware the assertion goes red, and that is the correct outcome: it means the
 * reasoning recorded here no longer describes the platform, and the comment in soundFontBackup.js
 * needs rewriting rather than quietly becoming folklore.
 *
 * WINDOWS ONLY, and it skips cleanly elsewhere - a DENY ace has no POSIX equivalent that a
 * non-root user can create. Everything it touches is inside its own temp directory.
 *
 * Run: node test/unreadable-probe-is-not-blind.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

if (process.platform !== 'win32') {
  console.log('SKIP  not Windows - a DENY ace has no portable equivalent');
  process.exit(0);
}

const backup = require(path.join(__dirname, '..', 'soundFontBackup.js'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b478-acl-'));
  const userData = path.join(tmp, 'userData');
  const stRoot = path.join(userData, 'soundFonts', 'sharedTracks');
  fs.mkdirSync(stRoot, { recursive: true });

  const good = path.join(stRoot, 'readable.wav');
  const bad  = path.join(stRoot, 'denied.wav');
  fs.writeFileSync(good, Buffer.alloc(2048, 7));
  fs.writeFileSync(bad,  Buffer.alloc(2048, 9));

  const whoami = execFileSync('whoami', { encoding: 'utf8' }).trim();
  let denied = false;

  try {
    execFileSync('icacls', [bad, '/deny', `${whoami}:(R)`], { stdio: 'pipe' });
    denied = true;

    // ASSERT THE FIXTURE BEFORE ASSERTING ANYTHING ABOUT THE PROBE. An icacls that silently did
    // not take would leave a perfectly readable file, and every assertion below would pass for
    // the wrong reason. A control is a hypothesis too.
    let reallyUnreadable = false;
    let fd = null;
    try { fd = fs.openSync(bad, 'r'); }
    catch { reallyUnreadable = true; }
    finally { if (fd !== null) try { fs.closeSync(fd); } catch {} }
    ok('fixture precondition: the file really cannot be opened', reallyUnreadable,
       'icacls reported success but the file still opens - the rest of this run would be vacuous');

    if (reallyUnreadable) {
      // ── The control: the obvious API is blind to this ──────────────────────────────
      let accessSaidFine = false;
      try { fs.accessSync(bad, fs.constants.R_OK); accessSaidFine = true; } catch {}
      ok('fs.access is blind to a DENY ace (this is why the probe uses open)', accessSaidFine,
         'fs.access now detects it - revisit the comment in soundFontBackup.js, the platform changed');

      // ── The probe finds it by walking, with nobody telling it where to look ────────
      const survey = await backup.surveyLibraryAsync(userData, { probeReadability: true });
      const found = (survey.unreadable || []).map(u => path.resolve(u.path));
      ok('the probe finds the unreadable file', found.includes(path.resolve(bad)),
         JSON.stringify(survey.unreadable));
      ok('the probe does not flag the readable one beside it', !found.includes(path.resolve(good)),
         JSON.stringify(survey.unreadable));
      ok('it reports an error code with the path',
         (survey.unreadable || []).every(u => typeof u.code === 'string' && u.code.length > 0),
         JSON.stringify(survey.unreadable));
    }
  } finally {
    // THE ACE COMES OFF FIRST, THEN THE FILES. A temp directory holding a file nobody can read
    // is a thing that outlives the test run.
    if (denied) { try { execFileSync('icacls', [bad, '/remove:d', whoami], { stdio: 'pipe' }); } catch {} }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });

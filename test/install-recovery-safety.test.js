/**
 * Install recovery verifies, and never deletes on its own initiative  [B-299]
 *
 * FOUND 2026-09-02 chasing an UnhandledPromiseRejectionWarning that had been printing
 * on every dev launch and that nobody had read to the end:
 *
 *     TypeError: Store.delete is not a function
 *         at _recoverInterruptedInstall (main.js:335)
 *
 * ⭐⭐ THE TRAP IS THAT IT LOOKS LIKE A ONE-LINE FIX. Store defined only get and set;
 * two call sites used delete. Add the missing method and the code underneath it starts
 * working — and what it does is `cancelCoreInstall(pending)`, which removes the entire
 * versioned core tree.
 *
 * The two failures compound:
 *   1. the `end:` hook threw, so the marker was NEVER taken down after a SUCCESSFUL
 *      install;
 *   2. so a standing marker stopped meaning "interrupted" and started meaning "the
 *      last install finished and could not say so";
 *   3. so every launch would have deleted a healthy core;
 *   4. and did not, ONLY because Store.delete threw one line before the removal.
 *
 * Measured on the dev profile 2026-09-02 and still true 2026-09-13:
 * pendingPluginInstall = "3.6.0" with a complete, in-use 802 MB core under it.
 *
 * HIS RULING 2026-09-13: "verify first, never auto delete."
 *
 * Run: node test/install-recovery-safety.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── Store.delete exists and behaves ────────────────────────────────────────
{
  ok('Store has a delete method', /^\s*delete\(key\) \{/m.test(main),
     'both callers of Store.delete threw without it');

  // Reimplemented here rather than imported: main.js pulls in Electron at require
  // time. The method is six lines and the behaviour that matters is observable.
  const tmp = path.join(process.env.TEMP || '/tmp', `b299-${process.pid}.json`);
  const Store = {
    _path: tmp,
    get(k) { try { return JSON.parse(fs.readFileSync(this._path, 'utf8'))[k]; } catch { return null; } },
    set(k, v) { let d = {}; try { d = JSON.parse(fs.readFileSync(this._path, 'utf8')); } catch {}
                d[k] = v; fs.writeFileSync(this._path, JSON.stringify(d), 'utf8'); },
    delete(k) { let d = {}; try { d = JSON.parse(fs.readFileSync(this._path, 'utf8')); } catch { return; }
                if (!(k in d)) return; delete d[k]; fs.writeFileSync(this._path, JSON.stringify(d), 'utf8'); },
  };
  try {
    Store.set('pendingPluginInstall', '3.6.0');
    Store.set('keepMe', 'yes');
    ok('the marker reads back', Store.get('pendingPluginInstall') === '3.6.0');
    Store.delete('pendingPluginInstall');
    // ⚠️ `== null`, not `=== null`, and the difference is real: Store.get returns
    // UNDEFINED for a key missing from a readable file, and NULL when the file itself
    // cannot be read. Both are falsy, so `if (!pending) return;` treats them alike —
    // but a test asserting one exact value would be asserting the wrong thing.
    ok('delete removes the key', Store.get('pendingPluginInstall') == null,
       JSON.stringify(Store.get('pendingPluginInstall')));
    ok('delete leaves every other key alone', Store.get('keepMe') === 'yes');
    Store.delete('neverExisted');
    ok('deleting an absent key is a no-op, not a throw', Store.get('keepMe') === 'yes');
  } finally { try { fs.unlinkSync(tmp); } catch {} }

  // ⚠️ A missing prefs file must not throw either — recovery runs at startup, before
  // anything guarantees the file exists.
  const gone = path.join(process.env.TEMP || '/tmp', `b299-absent-${process.pid}.json`);
  const S2 = { _path: gone,
    delete(k) { let d = {}; try { d = JSON.parse(fs.readFileSync(this._path, 'utf8')); } catch { return; }
                if (!(k in d)) return; delete d[k]; fs.writeFileSync(this._path, JSON.stringify(d), 'utf8'); } };
  let threw = false;
  try { S2.delete('anything'); } catch { threw = true; }
  ok('delete on a missing prefs file does not throw', !threw);
  ok('and does not create the file', !fs.existsSync(gone));
}

// ── recovery never removes a tree ──────────────────────────────────────────
{
  const fn = main.slice(main.indexOf('async function _recoverInterruptedInstall'),
                        main.indexOf('toolchain.setPluginHooks'));
  ok('_recoverInterruptedInstall was located', fn.length > 100 && fn.length < 4000, `${fn.length} chars`);

  // ⭐⭐ THE ASSERTION THIS FILE EXISTS FOR. If cancelCoreInstall ever comes back into
  // this function, a healthy 800 MB toolchain is one launch away from deletion.
  ok('recovery NEVER calls cancelCoreInstall', !/cancelCoreInstall/.test(fn),
     'this function must not remove a core tree on the app\'s own initiative');
  ok('recovery calls no other remover', !/rmSync|rimraf|removeCore|uninstall/i.test(fn), fn);

  ok('it verifies against the disk first', /isVersionInstalled\(/.test(fn));
  ok('the verify comes BEFORE the marker is cleared',
     fn.indexOf('isVersionInstalled(') < fn.indexOf('Store.delete('),
     'clearing first would lose the only record that a check is owed');
  ok('it resolves the tree with getCoreTreePath, which adopts the legacy tree',
     /getCoreTreePath\(/.test(fn), 'a hand-built join misreads an in-place upgrade');

  // ⚠️ A verify that FAILED is not a verify that said "incomplete". Knowing nothing
  // must leave everything as it is, marker included, so the question is asked again.
  const catchBlock = fn.slice(fn.indexOf('catch (e)'), fn.indexOf('catch (e)') + 500);
  ok('a failed verify returns without clearing the marker',
     /return;/.test(catchBlock), catchBlock.slice(0, 200));
}

// ── the hook that started it all ───────────────────────────────────────────
{
  ok('the end: hook still clears the marker',
     /end:\s*\(\)\s*=>\s*Store\.delete\(PENDING_INSTALL_KEY\)/.test(main),
     'this is the write that never landed, and why a standing marker meant nothing');
  ok('the begin: hook still sets it',
     /begin:\s*\(v\)\s*=>\s*Store\.set\(PENDING_INSTALL_KEY/.test(main));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall install recovery safety tests passed');
process.exit(failures ? 1 : 0);

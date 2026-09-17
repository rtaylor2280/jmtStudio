/**
 * The export summary names the destination, it does not just spell it  [B-403]
 *
 * 2026-09-17, on the last pass of [B-402]: "when we write to an SD card... it shows K:/
 * which is really short and hard to read. I think in SD card read we solved this by
 * naming it..."
 *
 * ⭐ He is right that it was already solved — `_sdDriveLabel` renders "RevantedJMT (F:)"
 * and, for a card with no volume name, "Removable Disk (K:)". Both were on his screen at
 * the same moment the export summary said "Saved to K:\". Two surfaces, one card, two
 * names. This reuses the existing form rather than inventing a second one.
 *
 * ⚠️ ONLY A DRIVE ROOT IS SUBSTITUTED. A deeper path already ends in a folder name that
 * carries meaning, and replacing its prefix would produce a hybrid that is neither a name
 * nor a path you could type.
 *
 * ⚠️⚠️ THE ONE THAT ACTUALLY BROKE, and the reason this file lifts the regex out of the
 * source instead of restating it: the character class shipped as `[\/]` rather than
 * `[\\/]` — one backslash eaten in transit — so `K:\`, the single most common form on
 * Windows, silently failed to match while `K:` and `K:/` passed. A retyped copy of the
 * predicate would have tested the copy and gone green over a broken app.
 *
 * Run: node test/export-dest-label.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html    = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const mainJs  = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── the helper exists and the summary actually uses it ─────────────────────
{
  ok('_sfDestDisplay exists',
     /async function _sfDestDisplay\(destDir\) \{/.test(html));

  // ⚠️ PRESENCE IS NOT EXECUTION. A helper nothing calls is a helper that fixes nothing.
  ok('⭐ the summary link is built from it, not from the raw path',
     /id="sf-export-summary-path"[^`]*\$\{esc\(await _sfDestDisplay\(destDir\)\)\}/.test(html),
     'the link text must come through the helper');
  ok('⚠️ and the raw path is no longer what the link wears',
     !/id="sf-export-summary-path"[^`]*\$\{esc\(destDir\)\}/.test(html));

  // The label is cosmetic; the link must still open the real folder.
  ok('⚠️ clicking still opens destDir itself',
     /window\.electronAPI\.openFolder\(destDir\)/.test(html),
     'naming the destination must not change how it is reached');
}

// ── the IPC it depends on ──────────────────────────────────────────────────
{
  ok('main exposes the volume lookup',
     /ipcMain\.handle\('sdcard:volumeInfo'/.test(mainJs));
  ok('preload bridges it',
     /volumeInfo: \(p\) => ipcRenderer\.invoke\('sdcard:volumeInfo', p\)/.test(preload));
  ok('⚠️ it reuses the SD module rather than shelling out again',
     /sdCardDetect\.enumerateAllVolumes\(\)/.test(mainJs));
}

// ── the lookup is started EARLY, not at the summary ────────────────────────
// ⚠️⚠️ THIS IS THE ONE THAT SHIPPED WRONG AND PASSED EVERY TEST. The query MEASURED 2666ms
// on his machine; the first attempt raced it against a 2500ms timeout at summary-build time
// and lost by 166ms. Every unit assertion was green and the card still wore a bare "K:\".
// Timing was the defect, so timing is what these assert.
{
  ok('⭐⭐ the volume lookup is primed when the destination is picked',
     /const destDir = pick\.dirPath;\s*\n\s*_sfPrimeVolume\(destDir\);/.test(html));

  // ⚠️ BOTH export flows pick a destination. One primed and one not is [B-357]'s
  // "three per-kind strings, two wired" for the third time this week.
  ok('⚠️ EVERY destination pick primes it, not just one',
     (html.match(/const destDir = pick\.dirPath;/g) || []).length
     === (html.match(/_sfPrimeVolume\(destDir\);/g) || []).length,
     'a pick site without a prime silently falls back to the bare drive letter');

  ok('⚠️ priming starts the work without awaiting it',
     /_sfVolPrime = \{[\s\S]*?p: Promise\.resolve\(\)[\s\S]*?\.then\(\(\) => window\.electronAPI\.volumeInfo\(raw\)\)[\s\S]*?\.catch\(\(\) => null\),/.test(html),
     'awaiting here would move the stall to the picker instead of removing it');

  ok('⭐ the summary consumes the primed promise rather than starting a second query',
     /const primed = _sfVolPrime && _sfVolPrime\.dir === raw \? _sfVolPrime\.p : null;/.test(html));

  // ⚠️⚠️ A swapped card must not inherit the previous card's name. The dir equality above
  // is what enforces that, and there must be no session-wide cache behind it.
  ok('⚠️⚠️ nothing is cached across operations',
     !/_sfVolCache|volumeCache|_volMemo/.test(html),
     'keyed by drive letter, a swapped card would wear the previous one\'s name');
}

// ── it can never hold the summary hostage ──────────────────────────────────
{
  // [B-204]: a summary that fails to appear left the app with no way out, because the
  // scan overlay has no cancel. A PowerShell spawn in front of it is exactly that risk.
  ok('⭐⭐ the lookup still races a timeout',
     /Promise\.race\(\[\s*primed \|\| window\.electronAPI\.volumeInfo\(raw\),[\s\S]*?new Promise\(r => setTimeout\(\(\) => r\(null\), primed \? (\d+) : (\d+)\)\),\s*\]\)/.test(html),
     'a hung volume query must not be able to block the dialog');

  // The primed budget must clear the measured cost with real headroom; the unprimed one
  // must stay short, because nothing is overlapping it.
  const t = /setTimeout\(\(\) => r\(null\), primed \? (\d+) : (\d+)\)/.exec(html);
  ok('⭐ the primed budget clears the 2666ms measurement with headroom',
     !!t && Number(t[1]) >= 5000, t && `primed budget is ${t[1]}ms`);
  ok('⚠️ the unprimed budget stays short enough not to stall the dialog',
     !!t && Number(t[2]) <= 3000, t && `unprimed budget is ${t[2]}ms`);

  ok('⚠️ and a throw falls through to the raw path',
     /\} catch \{\}\s*if \(!v\) return raw;/.test(html));
}

// ── the predicate and the formatter, LIFTED FROM SOURCE ────────────────────
// Everything below runs the shipped code. Restating it here would test the restatement.
{
  const i = html.indexOf('async function _sfDestDisplay(destDir)');
  const body = html.slice(i, html.indexOf('\n}', i) + 2);
  const m = /if \(!(\/\^\[A-Za-z\]:\[[^\n]*?\]\?\$\/)\.test\(raw\)\) return raw;/.exec(body);
  ok('the root predicate can be lifted out of the source', !!m);

  if (m) {
    const ROOT_RE = eval(m[1]);   // eslint-disable-line no-eval

    // ⭐⭐ THE SHARED BUILDER, ALSO LIFTED FROM SOURCE. Both surfaces run this one function,
    // so a reword of the SD card's naming reaches the export summary by construction — and
    // if the summary ever stops calling it, these cases go red instead of quietly drifting.
    const dl = /function _sdDriveLabel\(c\) \{[\s\S]*?\n\}/.exec(html);
    ok('_sdDriveLabel can be lifted out of the source', !!dl);
    const _sdDriveLabel = dl ? eval(`(${dl[0]})`) : null;   // eslint-disable-line no-eval

    const display = (raw, v) => {
      if (!ROOT_RE.test(raw)) return raw;
      if (!v) return raw;
      const named = v.label && String(v.label).trim();
      if (named || v.driveType === 2) return _sdDriveLabel({ drive: v.drive, label: v.label });
      return raw;
    };

    const NAMED   = { drive: 'K:', label: 'PROFFIE', driveType: 2 };
    const UNNAMED = { drive: 'K:', label: '',        driveType: 2 };
    const FIXED   = { drive: 'E:', label: '',        driveType: 3 };

    const CASES = [
      // ⚠️⚠️ THIS IS THE ONE THAT SHIPPED BROKEN. Keep it first.
      ['a card root with a backslash',   'K:\\',                   NAMED,   'PROFFIE (K:)'],
      ['a bare drive letter',            'K:',                     NAMED,   'PROFFIE (K:)'],
      ['a forward-slash root',           'K:/',                    NAMED,   'PROFFIE (K:)'],
      // His own K: card has no volume name — verified on screen 2026-09-17.
      ['⭐ an UNNAMED removable root',   'K:\\',                   UNNAMED, 'Removable Disk (K:)'],
      // ⚠️ "Removable Disk" would be a lie about a fixed drive.
      ['a fixed drive root, unnamed',    'E:\\',                   FIXED,   'E:\\'],
      ['the lookup failing or timing out','K:\\',                  null,    'K:\\'],
      ['a deeper path on a card',        'K:\\fonts',              NAMED,   'K:\\fonts'],
      ['an ordinary folder',             'D:\\Desktop\\B402_Dest', null,    'D:\\Desktop\\B402_Dest'],
      ['a UNC share',                    '\\\\nas\\media',         null,    '\\\\nas\\media'],
      ['nothing at all',                 '',                       null,    ''],
    ];
    for (const [what, raw, vol, want] of CASES) {
      const got = display(raw, vol);
      ok(`${what} -> ${JSON.stringify(want)}`, got === want, `got ${JSON.stringify(got)}`);
    }
  }
}

// ── ONE builder, not two copies that happen to match ───────────────────────
// His question, 2026-09-17, and it is the right one to ask of any two surfaces that agree:
// "do they agree because written the same or because it's one shared builder?"
// Matching spellings agree right up until one of them is reworded. Only the call is proof.
{
  ok('⭐⭐ the summary CALLS _sdDriveLabel rather than restating it',
     /return _sdDriveLabel\(\{ drive: v\.drive, label: v\.label \}\);/.test(html));

  // ⚠️ The literal must appear exactly ONCE in the renderer — inside the builder itself.
  // This is the assertion the first draft of this file got backwards: it checked that both
  // copies were spelled the same, which passes hardest precisely when the duplication is
  // worst. Counting is what catches a second copy being added later.
  ok('⚠️ "Removable Disk" is written down exactly once',
     (html.match(/Removable Disk \(\$\{/g) || []).length === 1,
     'a second copy is a second spelling waiting to drift apart');

  // ⚠️ And the gate, which is the one thing the summary does NOT delegate: the builder's
  // fallback assumes a removable volume, which is a lie about a fixed drive.
  ok('⚠️ the call is gated so a fixed unnamed drive keeps its path',
     /if \(named \|\| v\.driveType === 2\) return _sdDriveLabel/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall export destination label tests passed');
process.exit(failures ? 1 : 0);

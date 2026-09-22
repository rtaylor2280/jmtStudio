// Safe eject — the verification logic, run against real and synthetic state.  [B-005 item 4]
//
// ⭐ THE ASSERTIONS HERE ENCODE MEASUREMENTS, NOT INTENTIONS. Every rule this file checks came
// out of ejecting three volumes on 2026-09-20 while a 250 ms poll watched:
//
//     E:  proffieboard    gone 20.18s, never returned      letter LINGERS (Size=<null>)
//     I:  card-reader     gone 31.67 -> BACK 31.93 -> gone  letter LINGERS
//     F:  card-slot       gone 67.50s, clean                letter VANISHES entirely
//
// The two behaviours are why verification is `fs.existsSync`, and the blip is why it debounces.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../safeEject');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// ── mediaPresent: the instrument choice ──────────────────────────────
//
// ⚠️ TAKES A MOUNT PATH, NOT A DRIVE LETTER (changed 2026-09-21). The letter was the Windows
// shape leaking into a shared contract; `fs.existsSync` on a mount path is identical on all
// three platforms, which is what makes the macOS and Linux ports additions rather than
// signature changes. These assertions used to pass bare letters.
ok('a real mount path reads present', E.mediaPresent('C:\\'));
ok('a path with no media reads absent', !E.mediaPresent('Q:\\'),
   'this is the state an ejected-but-still-listed reader is in');
ok('garbage input is absent, not a throw', !E.mediaPresent('') && !E.mediaPresent(null));

// ── resolveTarget: the platform-neutral seam ─────────────────────────
{
  const t = E.resolveTarget('C:\\Windows');
  ok('a destination resolves to a mount path and a label',
     !!t && t.mountPath === 'C:\\' && t.label === 'C:',
     'the module owns this mapping so no caller re-derives a drive letter');
  ok('⚠️⚠️ a non-path is REFUSED, not coerced into a drive',
     E.resolveTarget('not-a-path') === null && E.resolveTarget('Ahsoka') === null,
     'the first cut took the first character, so "not-a-path" became N:\\ - an eject aimed '
     + 'by a typo at an unrelated volume is the worst thing this module could do');
}

// ── Every platform supplies the same shape ───────────────────────────
//
// ⭐ This is what "wireframed" has to mean: macOS and Linux are UNVALIDATED, but they are
// present and structurally complete, so extending is filling in behaviour behind a contract
// that already holds rather than inventing the contract at the same time.
{
  const need = ['osName', 'mountPathOf', 'label', 'invoke', 'vocab'];
  const vneed = ['lingersAfterEject', 'volumeNoun', 'lingerNote', 'busyNote'];
  for (const osKey of ['win32', 'darwin', 'linux']) {
    const p = E._PLATFORMS[osKey];
    ok(`${osKey} is present`, !!p);
    if (!p) continue;
    ok(`${osKey} supplies the full interface`, need.every((k) => k in p));
    ok(`${osKey} supplies the full vocabulary`, vneed.every((k) => k in p.vocab));
  }
  // ⭐⭐ THE BEHAVIOUR FLAG, NOT A STRING. Windows leaves the drive letter behind as an empty
  // drive; the others remove the mount point. A per-OS string TABLE would have shipped the
  // Windows explanation everywhere - this is why it is a flag and a nullable note.
  ok('only Windows reports a lingering volume',
     E._PLATFORMS.win32.vocab.lingersAfterEject === true
     && E._PLATFORMS.darwin.vocab.lingersAfterEject === false
     && E._PLATFORMS.linux.vocab.lingersAfterEject === false);
  ok('and only Windows carries a lingerNote',
     typeof E._PLATFORMS.win32.vocab.lingerNote === 'function'
     && E._PLATFORMS.darwin.vocab.lingerNote === null
     && E._PLATFORMS.linux.vocab.lingerNote === null,
     'null is the signal to OMIT the sentence, not to translate it');

  // Path mapping per platform, exercised without needing the OS.
  const CASES = [
    ['darwin', '/Volumes/MYCARD/fonts/Ahsoka', '/Volumes/MYCARD'],
    ['darwin', '/Users/ryan/Desktop', null],
    ['linux', '/media/ryan/MYCARD/fonts', '/media/ryan/MYCARD'],
    ['linux', '/run/media/ryan/MYCARD/fonts', '/run/media/ryan/MYCARD'],
    ['linux', '/home/ryan/Desktop', null],
  ];
  for (const [osKey, input, want] of CASES) {
    ok(`${osKey}: ${input} -> ${want}`, E._PLATFORMS[osKey].mountPathOf(input) === want);
  }
}

// ── The debounce, which is the part a single poll would have got wrong ──
//
// ⚠️⚠️ SIMULATING HIS I: BLIP. The volume went absent, reappeared for one 250 ms sample, then
// went absent for good. A verifier that returned on the first absent reading would have called
// the eject finished while the volume was still coming back; one that treated the reappearance
// as failure would have reported a successful eject as a failure. Both are wrong, and only a
// debounce gets both right.
{
  // Drive a fake clock of readings through the same rule waitForMediaGone applies.
  const STABLE = E.STABLE_MS, POLL = E.POLL_MS;
  const run = (readings) => {
    let goneSince = null, t = 0, settledAt = null;
    for (const present of readings) {
      if (!present) {
        if (goneSince === null) goneSince = t;
        if (settledAt === null && t - goneSince >= STABLE) settledAt = t;
      } else { goneSince = null; }
      t += POLL;
    }
    return settledAt;
  };
  const absent = (n) => Array(n).fill(false);

  ok('⚠️ a single absent reading is NOT enough to declare success',
     run([false]) === null,
     'his I: was absent for one sample and then came back');

  // gone, back for one sample, then gone for good
  const blip = [true, false, true, ...absent(10)];
  const settled = run(blip);
  ok('⚠️⚠️ a one-sample reappearance does not settle early',
     settled !== null && settled >= 3 * POLL + STABLE,
     'the stable window must restart when the volume comes back');

  ok('a clean disappearance settles after the stable window',
     run([true, ...absent(10)]) === POLL + STABLE);

  ok('a volume that never leaves never settles',
     run(Array(20).fill(true)) === null,
     'this is the busy case - the one the whole feature exists to surface');

  ok('the stable window is at least a second',
     E.STABLE_MS >= 1000,
     'shorter than the observed blip gap and the debounce stops working');
}

// ── ejectVolume: the three honest outcomes exist and are distinct ─────
{
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'safeEject.js'), 'utf8');
  for (const s of ['ejected', 'returned', 'busy']) {
    ok(`'${s}' is a distinct reported outcome`, SRC.includes(`'${s}'`));
  }
  ok("⚠️ 'returned' and 'busy' are told apart by re-reading the media",
     /status: mediaPresent\(t\.mountPath\) \? 'busy' : 'returned'/.test(SRC),
     'collapsing them would tell the user the wrong thing about a card in their hand');
  ok('⚠️ the eject verb\'s return value is NOT used as the verdict',
     /const res = await waitForMediaGone/.test(SRC)
     && !/if \(inv\.ok\) return \{ status: 'ejected'/.test(SRC),
     'InvokeVerb is fire-and-forget; trusting it would report success it cannot know');
  ok('⚠️ the eject is aimed at a VOLUME, not a device',
     /Namespace\(17\)\.ParseName/.test(SRC),
     'his dual-slot reader holds two letters on one device - a device eject takes both');
  ok('non-Windows degrades to unsupported rather than claiming success',
     /status: 'unsupported'/.test(SRC));
}

// ── ⚠️⚠️ THE VERB IS FOUND, NOT NAMED ────────────────────────────────
//
// Measured 2026-09-21: the Eject verb's display name on his machine is `E&ject`, carrying the menu
// accelerator. The shipped call was `InvokeVerb("Eject")` - a match against that display name, which
// returns nothing whether it hits or misses.
//
// ⭐⭐ AND THE DISPLAY NAME IS LOCALISED: `Aus&werfen` on German Windows, `&Éjecter` on French. A
// literal "Eject" matches neither, so every eject on a non-English Windows would silently do
// nothing, wait out the full timeout, and report the card as in use. That is invisible in testing
// on an English machine, and indistinguishable from a genuinely busy volume in the wild - which is
// exactly why it needs a test rather than a comment.
{
  // ⚠️ Its own read. `SRC` above is block-scoped, and borrowing it across blocks is the exact
  // defect that cost 2026-09-21 in the renderer: a top-level function reading a const declared
  // inside an `if`, throwing where a try/catch written for something else swallowed it.
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'safeEject.js'), 'utf8');

  ok('the Eject verb is located by enumerating Verbs(), not by naming it',
     /\$item\.Verbs\(\)/.test(SRC),
     'InvokeVerb("Eject") is a display-name string match and misses on any localised Windows');
  ok('⚠️ the accelerator is stripped before comparing',
     /-replace\s*'&'\s*,\s*''/.test(SRC),
     "the real name is `E&ject`; comparing against `Eject` without removing `&` never matches");
  ok('the matched verb is actually fired',
     /\$verb\.DoIt\(\)/.test(SRC));

  // ⚠️ `raw` IS EVIDENCE, NOT DECORATION. It always said "invoked", which is what made an
  // instrumented in-app failure unreadable: it could not distinguish a refused verb from a wait
  // that ran out. Each branch must name itself.
  for (const branch of ['ejected', 'no-verb', 'no-item']) {
    ok(`raw names the '${branch}' branch`,
       new RegExp(`'${branch}'|"${branch}"`).test(SRC),
       'a flat "invoked" for every outcome is why the failure could not be diagnosed');
  }
  ok('⚠️ no-verb is NOT reported as busy',
     /raw === 'no-verb'[\s\S]{0,200}status: 'unsupported'/.test(SRC),
     '"something has it open" tells the user to close files, which cannot help when nothing '
     + 'was ever asked to release the card');

  // ⚠️ The English name survives as a FALLBACK only - removing it entirely would regress any
  // volume whose verb list cannot be enumerated.
  ok('the literal verb name remains as a fallback',
     /InvokeVerb\("Eject"\)/.test(SRC),
     'the fallback is what keeps the fixed path no worse than the shipped one');
}

// ── Already-gone is not an error, and not a boast ────────────────────
(async () => {
  // ⚠️⚠️ A MOUNT PATH WITH NO MEDIA, AND THIS TEST MUST NEVER TOUCH A REAL ONE. On 2026-09-21
  // a "smoke test" called ejectVolume against E:, which was mounted at the time, and ejected
  // a real card. A check that acts on hardware is not a check. Q:\ is chosen because nothing
  // is ever mounted there; if that stops being true, change the letter rather than the rule.
  const r = await E.ejectVolume('Q:\\');
  ok('ejecting a path with no media reports ejected/alreadyGone',
     r.status === 'ejected' && r.alreadyGone === true,
     'a card already out is a fine state, not a failure to report');
  ok('⚠️ and it did NOT invoke a real eject to find that out',
     r.ms === 0 && !('raw' in r),
     'the already-gone branch must return before the platform invoke');

  const bad = await E.ejectVolume('');
  ok('a malformed letter is refused, not attempted', bad.status === 'busy' || bad.status === 'unsupported');

  console.log(failed ? `\n${failed} FAILED` : '\nsafe-eject: all passing');
  process.exit(failed ? 1 : 0);
})();

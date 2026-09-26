// Replace mode must never leave the user with neither font.  [B-005 items 4 and 7b]
//
// ⚠️⚠️ THE RULE, from the incident that produced it: Replace used to `rm` the existing font tree
// and THEN start copying, so a cancel or an error mid-copy left a half-written font and no
// original - the ordering that destroyed 708 MB on 2026-09-02. Move the original aside, put the
// new one in place, and only then delete the original. At no instant may the destination be empty
// while the replacement is still a hope.
//
// ⚠️⚠️ THIS FILE USED TO SAY "SO IT RUNS ON REAL FILES" AND DID NOT. [2026-09-26] Every assertion
// in it was a regex over source text. The guard for the worst data-loss incident in this project
// had never once been exercised - and the gap only surfaced because [B-005 item 7b] rewrote the
// recovery model underneath it and two greps went red. A test that names a hazard it does not
// execute reads as coverage while providing none.
//
// So there are now two layers, and the order matters: the BEHAVIOURAL block runs the real export
// against real files and is what actually protects the rule; the STRUCTURAL block below it pins
// the specific lines whose absence would be silent.
//
// ⭐ The naming (2026-09-20): ORIGINAL.<name> is the parked real font and must never be deleted by
// a user tidying up; DELETE.<name> is disposable. The names carry the instruction because a person
// browsing the card is the one who has to tell them apart.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const entries = require('../soundFontEntries');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const write = (root, files) => {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
};
const readTree = (root) => {
  const out = {};
  const walk = (abs, rel) => {
    let es = [];
    try { es = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const a = path.join(abs, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile()) out[r] = fs.readFileSync(a, 'utf8');
    }
  };
  walk(root, '');
  return out;
};

function setup(libFiles, cardFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-replace-'));
  const userData = path.join(root, 'userData');
  const dest = path.join(root, 'card');
  const libDir = path.join(userData, 'soundFonts', 'library', 'Ahsoka');
  fs.mkdirSync(libDir, { recursive: true });
  write(libDir, libFiles);
  fs.writeFileSync(path.join(libDir, 'meta.json'), JSON.stringify({ schemaVersion: 1, name: 'Ahsoka' }));
  write(path.join(dest, 'Ahsoka'), cardFiles);
  return { userData, dest, font: path.join(dest, 'Ahsoka') };
}

const LIB = {
  'hum.wav':           'LIB-hum-aaaaaaaa',
  'swing1.wav':        'LIB-swing-bbbbbb',
  'bgndrag/drag1.wav': 'LIB-drag-cccccccc',
};

(async () => {
  // ══ BEHAVIOURAL ══════════════════════════════════════════════════════
  {
    // ⭐⭐ MAKE IT MATCH, and the whole of [B-005 item 7b] in one case: one file differs, one
    // extra is on the card, one file is already correct.
    const card = { ...LIB, 'hum.wav': 'CARD-hum-DIFFERS', 'song1.wav': 'AN-EXTRA' };
    const { userData, dest, font } = setup(LIB, card);
    const untouchedBefore = fs.statSync(path.join(font, 'swing1.wav')).mtimeMs;
    await new Promise((r) => setTimeout(r, 1100));   // so a rewrite would move the mtime visibly

    const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'replace', null,
      { syncManifest: false });
    const after = readTree(font);

    ok('a replace reports success', res && res.ok === true, JSON.stringify(res));
    ok('⭐ the differing file now matches the library', after['hum.wav'] === LIB['hum.wav'],
       `got ${JSON.stringify(after['hum.wav'])}`);
    ok('⭐⭐ the extra the library does not have is GONE', after['song1.wav'] === undefined,
       'Replace means MAKE IT MATCH - an additive write that never removes leaves this behind, '
       + 'which is the opposite of what Replace was asked for');
    ok('every library file is present', Object.keys(LIB).every((k) => after[k] === LIB[k]));
    ok('⭐⭐ and the file that already matched was NOT rewritten',
       fs.statSync(path.join(font, 'swing1.wav')).mtimeMs === untouchedBefore,
       'this is the entire point of 7b. A rewritten file gets a new mtime; measured cost of the '
       + 'old behaviour was 44.6 MB moved to restore 2.1 MB, and 64.3 MB moved to write nothing');
    ok('no ORIGINAL. or DELETE. folder is left behind',
       !fs.existsSync(path.join(dest, 'ORIGINAL.Ahsoka')) && !fs.existsSync(path.join(dest, 'DELETE.Ahsoka')),
       'the parked copies are disposed of once the replacement is whole');
  }

  {
    // ⚠️⚠️ THE 09-02 RULE ITSELF, EXECUTED. Stop the export partway and the user's folder must be
    // exactly what it was - including the extra, because a cancel means "leave it as it was", not
    // "do half of what I asked".
    for (const after of [1, 3, 5, 8]) {
      const card = { ...LIB, 'hum.wav': 'CARD-hum-DIFFERS', 'song1.wav': 'AN-EXTRA' };
      const { userData, dest, font } = setup(LIB, card);
      const before = readTree(font);
      let n = 0;
      const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'replace', null,
        { syncManifest: false, shouldStop: () => (++n > after) });
      const now = readTree(font);
      ok(`⭐⭐ cancelled after ${after} checks: the folder is EXACTLY as it was`,
         JSON.stringify(now) === JSON.stringify(before),
         'this is the rule the 708 MB incident produced, and until today nothing executed it.\n'
         + `       before=${JSON.stringify(before)}\n       after =${JSON.stringify(now)}`);
      ok(`   and it is reported as a cancel, not a success (${after})`,
         res && res.ok === true && res.canceled === true, JSON.stringify(res));
      ok(`   and nothing is parked under ORIGINAL. (${after})`,
         !fs.existsSync(path.join(dest, 'ORIGINAL.Ahsoka')),
         'a font of theirs left under a name they never chose is the loss the rule prevents');
    }
  }

  {
    // ⭐⭐ THE BAR HAS TO ARRIVE, AND IT MUST NOT ARRIVE EARLY. [B-005 item 7b, 2026-09-26]
    //
    // ⚠️⚠️ THIS CASE USED TO ASSERT THE OPPOSITE AND IT PASSED BOTH TIMES. It required
    // `wrote + skipped === libTotal` - written when crediting the unwritten bytes into the
    // NUMERATOR was the mechanism. That produced the reported symptom: the bar sitting at 100%
    // for most of the run, reading 42.0 MB of 42.1 MB before a byte moved. Once the fix sized the
    // DENOMINATOR instead, that assertion could only pass if the fix had not happened. A test
    // whose subject is the thing being changed inverts silently.
    //
    // ⭐ SO THE INVARIANT IS RECONCILIATION, NOT A FINAL VALUE: what the bar is SIZED to must
    // equal what the bar INTEGRATES. Sized = the font's size plus the planned correction;
    // integrated = every delta the bar receives, bytes and per-file units alike. Asserting a
    // final 100% would pass on a clamp, and [B-360] is explicit that a clamp is not the fix.
    const card = { ...LIB, 'hum.wav': 'CARD-hum-DIFFERS', 'song1.wav': 'AN-EXTRA' };
    const { userData, dest } = setup(LIB, card);
    const libTotal = Object.values(LIB).reduce((n, v) => n + Buffer.byteLength(v), 0);
    // ⭐ THE DENOMINATOR NOW COMES FROM THE PLAN, taken BEFORE the export runs - which is exactly
    // what the door does in its `plan:` hook so the bar is the right size on its first frame.
    const pre = await entries.planFolderWrite(userData, 'Ahsoka', dest, {});
    const denominator = entries.planWorkBytes(pre);
    let wrote = 0, units = 0;
    const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'replace',
      (n) => { wrote += n; },
      { syncManifest: false, plan: pre, onUnits: (n) => { units += n; } });
    const integrated = wrote + units;        // what the bar actually receives
    ok(`⭐⭐ the bar arrives exactly (${integrated} of ${denominator})`,
       res.ok === true && integrated === denominator,
       'sized and integrated are the same quantity computed two ways, so any drift between them '
       + 'is a bar that stops short or claims done early');
    ok('⚠️ the work is not merely the bytes, or this would prove nothing',
       denominator > (pre.bytesToWrite || 0) && pre.parkCount > 0,
       `a fixture with nothing parked cannot tell a per-file term from a missing one. `
       + `parkCount=${pre.parkCount}, bytesToWrite=${pre.bytesToWrite}, work=${denominator}`);
    ok('⚠️⚠️ per-file units do NOT arrive on the written channel',
       wrote < libTotal && units > 0,
       'the caller\'s onBytes sink also feeds `token.wrote.bytes`, which decides whether removing '
       + 'what landed is slow enough to be worth offering. Parking and disposing write nothing to '
       + 'the card, so putting them through it answers that question with work that never happened');
    ok('⚠️ and the export still reports what it saved',
       res.savedBytes === libTotal - wrote && res.savedBytes > 0,
       `the summary says this number, so it has to be the measured one. Got ${res.savedBytes}`);
  }

  {
    // ⭐⭐ A SUPPLIED PLAN IS OBEYED, NOT RECOMPUTED. [B-005 item 7b, 2026-09-26]
    //
    // ⚠️⚠️ THIS IS THE ONLY THING STANDING BETWEEN ONE WALK AND TWO, and on a board card a walk
    // is a USB round trip per file - 2,263 of them for a 29-font card. The doors plan in their
    // `plan:` hook so the bar can be sized before it is drawn, then hand that plan to the export.
    // If the export ever quietly plans again, every number stays correct, every test stays green,
    // and the cost silently doubles on the one destination where it hurts. Nothing else can see
    // that, so it is asserted behaviourally here.
    //
    // ⭐ THE PROBE IS A DOCTORED PLAN: one differing file is removed from `toWrite`. Obeyed, that
    // file keeps its tampered content. Recomputed, the export finds the difference itself and
    // repairs it - which is the friendlier outcome and the wrong one for this contract.
    const card = { ...LIB, 'hum.wav': 'CARD-hum-DIFFERS', 'swing1.wav': 'CARD-swing-DIFFERS' };
    const { userData, dest, font } = setup(LIB, card);
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest, {});
    ok('⚠️ the probe fixture really does present two differing files',
       p.toWrite.includes('hum.wav') && p.toWrite.includes('swing1.wav'),
       `if the plan does not list both, this case proves nothing. Got ${JSON.stringify(p.toWrite)}`);
    const doctored = { ...p, toWrite: p.toWrite.filter((r) => r !== 'swing1.wav') };
    const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'replace', null,
      { syncManifest: false, plan: doctored });
    const now = readTree(font);
    ok('⭐⭐ the export wrote exactly what the supplied plan said, and did not re-plan',
       res.ok === true && now['hum.wav'] === LIB['hum.wav']
         && now['swing1.wav'] === 'CARD-swing-DIFFERS',
       'swing1 was withheld from the plan. Repairing it anyway means the export walked the '
       + 'destination again, which is the second USB round trip per file this design exists to '
       + `avoid. hum=${now['hum.wav']}, swing1=${now['swing1.wav']}`);
  }

  {
    // ⭐⭐ THE PLAN REUSES WHAT THE COMPARE ALREADY HASHED, RATHER THAN READING IT AGAIN.
    // [B-005 item 7b, the `known` item, 2026-09-26]
    //
    // The compare scan hashes the destination files the card's manifest cannot vouch for. Those
    // findings are not committed to the manifest until the END of the operation, so the plan that
    // follows seconds later used to hash the very same files off the very same card.
    //
    // ⚠️⚠️ THE OBSERVATIONS COME FROM `entryMatchesAt`, NOT FROM A LITERAL I WROTE. A fixture I
    // author tests my idea of the shape; the bug this guards against is the two modules
    // disagreeing about it - which is exactly how a field read as `r.hash` against a producer
    // writing `r.fileHash` shipped green and did nothing. If the compare's format drifts, this
    // has to go red.
    //
    // ⭐ THE COUNTS ARE THE INSTRUMENT. `planFolderWrite` reports `hashed` and `reused`, so the
    // saving is observable rather than inferred - and the control below proves the same call
    // DOES hash without the observations, so a zero cannot be mistaken for a plan that did
    // nothing at all.
    const card = { ...LIB, 'hum.wav': 'CARD-hum-EDITED!' };   // same COUNT, one file edited
    const { userData, dest } = setup(LIB, card);
    const m = await entries.entryMatchesAt(userData, 'Ahsoka', dest, { writeCache: false });
    ok('⚠️ the compare did the per-file pass and returned observations',
       m.ok === true && Array.isArray(m.observed) && m.observed.length > 0,
       'a compare that short-circuits on counts returns none, and then this case proves nothing. '
       + `Got reason=${m.reason}, observed=${(m.observed || []).length}`);

    const control = await entries.planFolderWrite(userData, 'Ahsoka', dest, {});
    ok('⚠️ CONTROL: without the observations the plan really does read the card',
       control.hashed > 0,
       `if this is already zero the treatment below proves nothing. hashed=${control.hashed}`);

    const reuse = await entries.planFolderWrite(userData, 'Ahsoka', dest,
      { known: new Map(m.observed) });
    ok(`⭐⭐ with them it hashes nothing (${control.hashed} -> ${reuse.hashed})`,
       reuse.hashed === 0 && reuse.reused >= control.reused,
       `the compare already paid for these reads. hashed=${reuse.hashed}, reused=${reuse.reused}`);

    // ⚠️ AND IT MUST NOT HAVE CHANGED THE ANSWER. A faster plan that decides something different
    // is not an optimisation, it is a second opinion - and the one that skipped the reading is
    // the one that would be believed.
    ok('⚠️⚠️ and the plan it produces is identical to the one that read the card',
       JSON.stringify([...reuse.toWrite].sort()) === JSON.stringify([...control.toWrite].sort())
         && reuse.parkCount === control.parkCount
         && reuse.bytesToWrite === control.bytesToWrite,
       `reuse=${JSON.stringify(reuse.toWrite)} control=${JSON.stringify(control.toWrite)}`);
  }

  {
    // ⚠️ A FAILURE THAT IS NOT A CANCEL. An unreadable library file mid-copy must leave the
    // destination untouched, not half-converted.
    const card = { ...LIB, 'hum.wav': 'CARD-hum-DIFFERS' };
    const { userData, dest, font } = setup(LIB, card);
    const before = readTree(font);
    // ⚠️ THE FAILURE IS INJECTED THROUGH `shouldStop` THROWING A PLAIN ERROR, so it lands on the
    // real-failure path rather than the cancel one - `isCancel` distinguishes them, and it is the
    // failure path that used to swap a whole folder for a handful of parked files.
    // ⚠️ An earlier version of this case made the library file a DIRECTORY instead. That is not a
    // failure at all: the copy walker cheerfully creates a directory of that name, which then
    // reads as "the replacement arrived". It found a different bug and proved nothing about this
    // one - a fixture that does not produce the condition it names.
    let n = 0;
    const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'replace', null,
      { syncManifest: false, shouldStop: () => { if (++n > 5) throw new Error('injected failure'); return false; } });
    const now = readTree(font);
    ok('⚠️⚠️ a mid-write failure leaves the card\'s font intact',
       now['hum.wav'] === before['hum.wav'] && Object.keys(before).every((k) => now[k] === before[k]),
       'the outer catch used to rm the target and swap the aside in - correct when the aside was a '
       + 'whole font, catastrophic once the target IS the font.\n'
       + `       before=${JSON.stringify(before)}\n       after =${JSON.stringify(now)}`);
    ok('   and the font is not left parked under ORIGINAL.',
       !fs.existsSync(path.join(dest, 'ORIGINAL.Ahsoka')), JSON.stringify(res));
  }

  {
    // A font not on the card at all still copies wholesale, and 'rename'/'skip' are untouched.
    const { userData, dest } = setup(LIB, {});
    fs.rmSync(path.join(dest, 'Ahsoka'), { recursive: true, force: true });
    const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'replace', null,
      { syncManifest: false });
    const after = readTree(path.join(dest, 'Ahsoka'));
    ok('a font absent from the card is written in full',
       res.ok && Object.keys(LIB).every((k) => after[k] === LIB[k]), JSON.stringify(after));
  }

  {
    const card = { ...LIB, 'hum.wav': 'CARD-hum-DIFFERS' };
    const { userData, dest } = setup(LIB, card);
    const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'skip', null,
      { syncManifest: false });
    ok('skip still leaves the card alone',
       res.ok && res.skipped === true
       && readTree(path.join(dest, 'Ahsoka'))['hum.wav'] === 'CARD-hum-DIFFERS',
       JSON.stringify(res));
  }

  {
    const card = { ...LIB, 'hum.wav': 'CARD-hum-DIFFERS' };
    const { userData, dest } = setup(LIB, card);
    const res = await entries.exportEntryToFolder(userData, 'Ahsoka', dest, 'rename', null,
      { syncManifest: false });
    ok('rename still mints a new folder and leaves the original',
       res.ok && fs.existsSync(path.join(dest, 'Ahsoka_2'))
       && readTree(path.join(dest, 'Ahsoka'))['hum.wav'] === 'CARD-hum-DIFFERS',
       JSON.stringify(res));
  }

  // ══ STRUCTURAL ═══════════════════════════════════════════════════════
  // Cheap pins on lines whose absence would be silent. Anchored on text that must exist, never
  // on a character count - a window chosen by eye is a sample, and a negative drawn from a sample
  // is unfalsifiable by the evidence that produced it.
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'soundFontEntries.js'), 'utf8');
  const START = 'let asideDir = null;';
  const END   = 'Best-effort cleanup of a partial copy on failure';
  const i = SRC.indexOf(START), j = SRC.indexOf(END, i);
  const fn = (i === -1 || j === -1) ? '' : SRC.slice(i, j);
  ok('found the replace path to examine (both anchors present)', fn.length > 0,
     'an anchor moved - fix the anchor rather than widening a guess');

  ok('⚠️⚠️ superseded files are MOVED aside, never deleted, before the write',
     /_moveAside\(targetDir, asideDir, rel\)/.test(fn),
     'an rm before the replacement lands is the 2026-09-02 bug exactly, at file scale');
  ok('no rm of the live font before the copy starts',
     !/rm\(path\.join\(destDir, targetName\)/.test(fn),
     'that call emptied the destination while the replacement was still a hope');
  ok('the aside uses the ORIGINAL. prefix',
     /`ORIGINAL\.\$\{targetName\}`/.test(fn), 'his naming - a folder a user must not delete');
  ok('the junk uses the DELETE. prefix',
     /`DELETE\.\$\{targetName\}`/.test(fn), 'his naming - a folder a user may safely delete');
  ok('⚠️ cancel restores what it moved', /_undoDifferential\(/.test(fn),
     'a cancel that only removed the partial would leave the user with no font at all');
  ok('cancel reports leftovers it could not clear', /out\.leftovers\.push/.test(fn),
     'a whole font sitting under ORIGINAL.<name> must be named, not silently left');
  ok('⚠️ a non-cancel failure also restores', /restoredOriginal = true/.test(fn),
     'a full card mid-copy would otherwise park the font under ORIGINAL.<name> forever');

  // ⚠️⚠️ THE ONE THAT WOULD HAVE DESTROYED FONTS, now guarded twice over: the differential write
  // must never reach it at all, because targetDir is the user's own folder rather than our partial.
  ok('⚠️⚠️ the outer catch will NOT rm a restored original, NOR a differential target',
     /if \(!restoredOriginal && !_differential\) \{\s*try \{ fs\.rmSync\(targetDir/.test(SRC),
     'unguarded, the failure path restores the font and the next line deletes it');

  ok('a successful replace disposes of the superseded copies',
     /rename\(asideDir, junk\)/.test(fn),
     'otherwise a replace silently leaves parked files on the card');
  ok('and reports it when disposal failed rather than erroring', /replacedLeftover/.test(SRC),
     'the export succeeded - a leftover folder is untidy, not a failure');
  ok('a leftover ORIGINAL. from an interrupted run is cleared first',
     /if \(fs\.existsSync\(asideDir\)\)/.test(fn),
     'otherwise the second attempt fails on a name that is already taken');

  console.log(failed ? `\n${failed} FAILED` : '\nreplace-aside-behavior: all passing');
  process.exit(failed ? 1 : 0);
})();

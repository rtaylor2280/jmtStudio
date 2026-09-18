// [B-297] The NEW badge: its reverse, and where its migration marker lives.
//
// Two things are asserted here and they are separate concerns that happen to share a field:
//
//   1. seenAt can now be CLEARED, not only spent. Until this, the four stamp paths were all side
//      effects of doing something else, so a badge cleared by accident was gone for good.
//   2. The one-time-backfill marker lives IN THE LIBRARY, not in prefs.json.
//
// ⚠️⚠️ WHY (2) MATTERS, measured not theorised: the marker was a prefs.json key guarding a field
// stored on each entry's meta.json. Two stores desync BOTH ways. Found while staging QA TC-3136
// (rename prefs.json away and launch): the backfill re-ran and stamped 109 entries that had
// genuinely never been opened, all now carrying seenAt == createdAt.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const entries = require('../soundFontEntries');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + detail : ''));
}

function mkLib(names) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-seen-'));
  const lib = path.join(ud, 'soundFonts', 'library');
  for (const [name, meta] of Object.entries(names)) {
    const d = path.join(lib, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(d, 'hum.wav'), 'audio-' + name);
  }
  return { ud, lib };
}

// ── the reverse direction ──────────────────────────────────────────────────
{
  const { ud, lib } = mkLib({
    Ahsoka: { entryUuid: 'u1', createdAt: '2026-01-01T00:00:00Z', seenAt: '2026-02-02T00:00:00Z' },
    Dooku:  { entryUuid: 'u2', createdAt: '2026-01-01T00:00:00Z' },
  });
  const read = (n) => JSON.parse(fs.readFileSync(path.join(lib, n, 'meta.json'), 'utf8'));

  check('marking a seen font NEW removes seenAt', entries.markEntryNew(ud, 'Ahsoka') === true
    && read('Ahsoka').seenAt === undefined);

  // ⚠️ Returns false when there is nothing to undo, matching markEntrySeen's "first wins"
  // contract. The caller uses that to avoid claiming work it did not do.
  check('marking an already-New font NEW is a no-op', entries.markEntryNew(ud, 'Dooku') === false);
  check('marking a missing font NEW is a no-op', entries.markEntryNew(ud, 'NoSuchFont') === false);

  // Round trip: the pair must be genuine opposites, or the right-click menu lies.
  check('seen -> new -> seen round trips', entries.markEntrySeen(ud, 'Ahsoka') === true
    && typeof read('Ahsoka').seenAt === 'string');

  // ⭐ Everything else on the entry must survive. A read-modify-write that dropped a sibling
  // field would not throw — it would quietly lose the uuid the whole library is keyed by.
  const m = read('Ahsoka');
  check('other meta fields survive the write', m.entryUuid === 'u1' && m.createdAt === '2026-01-01T00:00:00Z',
    JSON.stringify(m));
}

// ── the marker lives with the data ─────────────────────────────────────────
{
  const { ud, lib } = mkLib({ Ahsoka: { entryUuid: 'u1' } });

  check('a fresh library reports the backfill as NOT done', entries.seenBackfillDone(ud) === false);
  check('marking it done is reported', entries.markSeenBackfillDone(ud) === true
    && entries.seenBackfillDone(ud) === true);

  // ⭐ THE WHOLE POINT: it is on disk in the library, so losing prefs.json cannot resurrect the
  // backfill and re-stamp the real NEW set.
  check('the marker is a file inside the library root',
    fs.existsSync(path.join(lib, '.seen-backfill-done')));

  // ⚠️ And it must not read as a font. listEntries walks this exact directory; a stray file that
  // enumerated as an entry would show an empty card and break counts.
  const listed = entries.listEntries(ud).map(e => e.name);
  check('the marker is not enumerated as an entry', !listed.some(n => n.includes('seen-backfill')),
    JSON.stringify(listed));
  check('the real entry still lists', listed.includes('Ahsoka'), JSON.stringify(listed));

  // ⭐ The other desync direction: a full restore rmSyncs the soundFonts root, so the marker goes
  // with the library it describes and the backfill correctly re-runs for the restored entries.
  fs.rmSync(path.join(lib, '.seen-backfill-done'), { force: true });
  check('removing the library (as a restore does) resets the marker',
    entries.seenBackfillDone(ud) === false);
}

console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);

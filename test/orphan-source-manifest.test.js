// A deleted source must not leave its hash manifest behind.            [B-310]
//
// THE MANIFEST LIVES OUTSIDE THE SOURCE FOLDER, in a central store keyed by uuid, which is
// what lets the two get out of step. `deleteSource` always dropped it on the way out, but the
// drop sat BELOW an early return taken when the folder was already missing. So the stranded
// case was permanent: once the directory was gone by any other route, every later call
// returned ok and nothing could ever reclaim the manifest.
//
// MEASURED RATHER THAN IMAGINED, dev library 2026-10-16: 29 source folders, 30 manifests. The
// orphan was two days old, so this was live behaviour and not historical debris.
//
// Everything here runs against a temporary tree. Nothing reads or writes a real library.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sources = require(path.join(__dirname, '..', 'soundFontSources.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b310-'));
const sfRoot    = path.join(root, 'soundFonts');
const srcRoot   = path.join(sfRoot, 'sources');
const libRoot   = path.join(sfRoot, 'library');
const manSrc    = path.join(sfRoot, '.filehashes', 'sources');
const manEnt    = path.join(sfRoot, '.filehashes', 'entries');
for (const d of [srcRoot, libRoot, manSrc, manEnt]) fs.mkdirSync(d, { recursive: true });

const mkSource = (uuid, { withDir = true, withManifest = true } = {}) => {
  if (withDir) {
    fs.mkdirSync(path.join(srcRoot, uuid), { recursive: true });
    fs.writeFileSync(path.join(srcRoot, uuid, 'meta.json'), JSON.stringify({ attachments: [] }));
  }
  if (withManifest) fs.writeFileSync(path.join(manSrc, `${uuid}.json`), '{"records":[]}');
};
const manifestExists = (uuid) => fs.existsSync(path.join(manSrc, `${uuid}.json`));

// ── the ordinary delete still cleans up ───────────────────────────────────
{
  mkSource('aaa');
  ok('fixture: the manifest is there before the delete', manifestExists('aaa'));
  const r = sources.deleteSource(root, 'aaa');
  ok('a normal delete reports deleted', !!(r && r.ok && r.deleted), JSON.stringify(r));
  ok('and takes the manifest with it', !manifestExists('aaa'));
}

// ── 🚨 THE CASE THAT WAS PERMANENT ────────────────────────────────────────
{
  mkSource('bbb', { withDir: false });   // folder already gone, manifest stranded
  ok('fixture: a stranded manifest with no source folder', manifestExists('bbb')
     && !fs.existsSync(path.join(srcRoot, 'bbb')));
  const r = sources.deleteSource(root, 'bbb');
  ok('delete still reports ok with nothing to remove', !!(r && r.ok && r.deleted === false),
     JSON.stringify(r));
  ok('🚨 and the stranded manifest is reclaimed anyway', !manifestExists('bbb'),
     'this is the case that could never be cleaned: the early return fired first');
}

// ── the sweep finds what is already stranded ──────────────────────────────
{
  mkSource('ccc');                          // healthy
  mkSource('ddd', { withDir: false });      // orphan

  // 🚨 AN ENTRY'S MANIFEST IS KEYED BY ITS entryUuid, NOT BY ITS FOLDER NAME. The folder is
  // called Live_Font and the manifest is <uuid>.json. Comparing manifests against folder names
  // calls every live entry an orphan - measured against a real library mid-build: 25 live,
  // 25 manifests, and all 25 reported as orphaned. A remove pass on that reading empties the
  // store. This fixture is shaped like the real thing for exactly that reason.
  const LIVE_UUID = '11111111-2222-3333-4444-555555555555';
  const GONE_UUID = '99999999-8888-7777-6666-555555555555';
  fs.mkdirSync(path.join(libRoot, 'Live_Font'), { recursive: true });
  fs.writeFileSync(path.join(libRoot, 'Live_Font', 'meta.json'),
                   JSON.stringify({ entryUuid: LIVE_UUID }));
  fs.writeFileSync(path.join(manEnt, `${LIVE_UUID}.json`), '{}');
  fs.writeFileSync(path.join(manEnt, `${GONE_UUID}.json`), '{}');

  const found = sources.findOrphanManifests(root);
  ok('the orphaned source is found', found.sources.map((x) => x.uuid).includes('ddd'),
     JSON.stringify(found.sources));
  ok('the healthy source is not', !found.sources.map((x) => x.uuid).includes('ccc'));
  ok('the orphaned entry is found', found.entries.map((x) => x.uuid).includes(GONE_UUID),
     JSON.stringify(found.entries));
  ok('🚨 and the LIVE entry is not, though its folder name matches no manifest',
     !found.entries.map((x) => x.uuid).includes(LIVE_UUID)
     && !found.skipped.some((s) => /entries/.test(s)),
     `entries=${JSON.stringify(found.entries)} skipped=${JSON.stringify(found.skipped)}`);

  // 🚨 REPORTING IS NOT REMOVING. A diagnostic that deletes as a side effect of running is
  // how a measurement becomes an incident.
  ok('🚨 a plain call removes nothing', manifestExists('ddd') && found.removed === 0,
     'the default must be a report');

  const swept = sources.findOrphanManifests(root, { remove: true });
  ok('and remove:true reclaims them', swept.removed === 2 && !manifestExists('ddd'),
     `removed=${swept.removed}`);
  ok('🚨 leaving the healthy ones alone', manifestExists('ccc')
     && fs.existsSync(path.join(manEnt, `${LIVE_UUID}.json`)),
     'a live entry losing its manifest to the sweep is the worst outcome available here');
}

// ── 🚨 AN UNREADABLE OR EMPTY OWNER SIDE MUST NOT CONDEMN THE STORE ───────
// If the live folder cannot be read, every manifest looks orphaned. A remove pass on that
// reading would take the entire store, which is the worst possible outcome of a cleanup.
{
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'b310b-'));
  const m2 = path.join(root2, 'soundFonts', '.filehashes', 'sources');
  fs.mkdirSync(m2, { recursive: true });
  fs.mkdirSync(path.join(root2, 'soundFonts', 'sources'), { recursive: true });  // readable, EMPTY
  fs.writeFileSync(path.join(m2, 'eee.json'), '{}');
  fs.writeFileSync(path.join(m2, 'fff.json'), '{}');

  const r = sources.findOrphanManifests(root2, { remove: true });
  ok('🚨 an empty live side with manifests present is refused, not swept',
     r.removed === 0 && r.sources.length === 0,
     JSON.stringify(r));
  // The substance, not the count: a later addition that records another skip is not a
  // regression, and pinning the length made it look like one.
  ok('and it says why', r.skipped.some((s) => /sources.*refusing to judge/.test(s)),
     JSON.stringify(r.skipped));
  ok('both manifests survive', fs.existsSync(path.join(m2, 'eee.json'))
     && fs.existsSync(path.join(m2, 'fff.json')));
  fs.rmSync(root2, { recursive: true, force: true });
}

// ── 🚨 AN ENTRY WHOSE OWNER CANNOT BE IDENTIFIED STOPS THE WHOLE SIDE ─────
// Not hypothetical: the real dev library has a `Dark_Beskar_2` folder with no meta.json, so
// its entryUuid is unknowable. A folder like that could own ANY manifest in the store, so
// there is no safe way to call anything there an orphan. Refuse the side and say so.
{
  const r3 = fs.mkdtempSync(path.join(os.tmpdir(), 'b310c-'));
  const lib3 = path.join(r3, 'soundFonts', 'library');
  const man3 = path.join(r3, 'soundFonts', '.filehashes', 'entries');
  fs.mkdirSync(path.join(lib3, 'Has_Meta'), { recursive: true });
  fs.mkdirSync(path.join(lib3, 'No_Meta'), { recursive: true });   // the Dark_Beskar_2 shape
  fs.mkdirSync(man3, { recursive: true });
  fs.writeFileSync(path.join(lib3, 'Has_Meta', 'meta.json'), JSON.stringify({ entryUuid: 'uuid-known' }));
  fs.writeFileSync(path.join(man3, 'uuid-known.json'), '{}');
  fs.writeFileSync(path.join(man3, 'uuid-mystery.json'), '{}');

  const r = sources.findOrphanManifests(r3, { remove: true });
  ok('🚨 an unidentifiable owner refuses the entries side',
     r.entries.length === 0 && r.removed === 0,
     JSON.stringify(r));
  ok('and names the reason',
     r.skipped.some((s) => /entries.*could not be identified/.test(s)), JSON.stringify(r.skipped));
  ok('so the manifest that might be theirs survives',
     fs.existsSync(path.join(man3, 'uuid-mystery.json')));
  fs.rmSync(r3, { recursive: true, force: true });
}

// ── 🚨 "I COULD NOT LOOK" IS NOT "NOTHING IS WRONG" ───────────────────────
// A missing store and a clean store both produce an empty list. Only one of them means the
// library is healthy, and reading the other as an answer is how a mistyped path becomes a
// confident all-clear.
{
  const r4 = fs.mkdtempSync(path.join(os.tmpdir(), 'b310d-'));
  fs.mkdirSync(path.join(r4, 'soundFonts', 'sources'), { recursive: true });
  const r = sources.findOrphanManifests(r4);
  ok('🚨 a missing manifest store is reported, not passed over',
     r.skipped.some((s) => /no manifest store at/.test(s)), JSON.stringify(r.skipped));
  fs.rmSync(r4, { recursive: true, force: true });
}

// ── 🚨 THE ENTRY SIDE: THE MANIFEST FOLLOWS THE FOLDER, NOT THE RETURN VALUE ──
// `deleteEntry` dropped the manifest only on its success path, so a removal that tore the
// directory down and then threw left the manifest behind - and the retry took the
// missing-folder early return, making it permanent. That is the shape of the 2026-10-15 bulk
// delete: the two items the dialog named as FAILED were the ones whose folders went away.
//
// The second check is the control for the first. Dropping unconditionally on an error passes
// the torn-down case and fails this one, because an entry whose folder is still intact is
// still live and must keep its hashes.
async function entryChecks() {
  const entries = require(path.join(__dirname, '..', 'soundFontEntries.js'));
  const ENT_UUID = 'cafe0000-1111-2222-3333-444455556666';
  const mkEntry = (name) => {
    const dir = path.join(libRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ entryUuid: ENT_UUID }));
    fs.writeFileSync(path.join(dir, 'hum.wav'), 'x');
    fs.writeFileSync(path.join(manEnt, `${ENT_UUID}.json`), '{"records":[]}');
    return dir;
  };
  const entManExists = () => fs.existsSync(path.join(manEnt, `${ENT_UUID}.json`));
  const realRm = fs.promises.rm;

  {
    mkEntry('Plain_Delete');
    const r = await entries.deleteEntry(root, 'Plain_Delete');
    ok('an ordinary entry delete reports deleted', !!(r && r.ok && r.deleted), JSON.stringify(r));
    ok('and takes its manifest with it', !entManExists());
  }

  {
    const dir = mkEntry('Torn_Down');
    fs.promises.rm = async (p, opts) => {
      await realRm(p, opts);
      const err = new Error(`EPERM: operation not permitted, rmdir '${p}'`);
      err.code = 'EPERM';
      throw err;
    };
    let r;
    try { r = await entries.deleteEntry(root, 'Torn_Down'); }
    finally { fs.promises.rm = realRm; }
    ok('fixture: the folder really is gone', !fs.existsSync(dir));
    ok('a removal that throws after tearing the folder down reports failure',
       !!(r && r.ok === false), JSON.stringify(r));
    ok('🚨 and the manifest goes anyway', !entManExists(),
       'this is the case the 10-15 bulk delete left behind');
  }

  {
    const dir = mkEntry('Held_Open');
    fs.promises.rm = async (p) => {
      const err = new Error(`EPERM: operation not permitted, rmdir '${p}'`);
      err.code = 'EPERM';
      throw err;
    };
    let r;
    try { r = await entries.deleteEntry(root, 'Held_Open'); }
    finally { fs.promises.rm = realRm; }
    ok('fixture: the folder survived the failed removal', fs.existsSync(dir));
    ok('a failed removal reports failure', !!(r && r.ok === false), JSON.stringify(r));
    ok('🚨 and a LIVE entry keeps its manifest', entManExists(),
       'the folder is intact, so the entry still owns its hashes');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(manEnt, `${ENT_UUID}.json`), { force: true });
  }
}

entryChecks().catch((err) => { failures++; console.log('FAIL  entry checks threw', err); })
  .then(() => {
    fs.rmSync(root, { recursive: true, force: true });
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nall B-310 checks passed');
    process.exit(failures ? 1 : 0);
  });

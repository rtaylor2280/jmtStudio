// Every branch of copyAcrossLocations flags the destination entry dirty. [2026-10-08]
//
// THE DEFECT THIS EXISTS FOR, found by pressing the door rather than by reading:
// "adding from library isn't marking as customized... if I add from browse it gets customized".
//
// copyAcrossLocations has two bodies — an async branch for `src.kind === 'source'` and the
// on-disk branch for entry/common sources. Each ended with its OWN tail.
// `_maybeIndexSharedTracksAdds` was deliberately called from both; the content-dirty flag was
// added later and landed in only the on-disk one. The library picker DEFAULTS its target to the
// entry's own source, so the ordinary "Add from library" took exactly the branch that never
// flagged the entry — the content hash was never recomputed and the Customized marker never
// appeared. "+ Add → Browse…" goes through addFilesAt, which marks, which is why the two doors
// disagreed about the same font.
//
// ⚠️ THE ASSERTIONS READ meta.json, NOT THE SOURCE TEXT. A regex over the module would pass on a
// line that exists and never runs; the only question that matters is whether the flag is on disk
// after the call, and that is answerable from the filesystem.
//
// ⚠️⚠️ AND THE SOURCE BRANCH IS THE ONE THAT WAS BROKEN, so a suite that only exercised the
// on-disk branch would have been green through the whole defect. Both are asserted here, and the
// mutation control at the end proves these cases can actually fail.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const S = require('../soundFontSources');
const E = require('../soundFontEntries');
const fileOps = require('../soundFontFileOps');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii'); head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24); head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-cmd-' + t + '-'));

const metaOf = (userData, name) =>
  JSON.parse(fs.readFileSync(path.join(E.entriesRoot(userData), name, 'meta.json'), 'utf8'));

// Clear the flags so each case starts from a known-false state. Without this a
// case could "pass" on a flag some earlier step happened to leave set, which is
// the shape of a check that cannot fail.
function clearDirty(userData, name) {
  const p = path.join(E.entriesRoot(userData), name, 'meta.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete m.contentHashDirty;
  delete m.effectsDirty;
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
}

async function setup() {
  const picked = tmp('picked');
  fs.mkdirSync(path.join(picked, 'Ahsoka', 'extras'), { recursive: true });
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'hum.wav'), wav('HUM-VENDOR'));
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'extras', 'quote1.wav'), wav('QUOTE-ONE'));
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'extras', 'quote2.wav'), wav('QUOTE-TWO'));
  const userData = tmp('ud');
  const imp = await S.importSource({ userData, sourcePath: picked, originalName: 'Bundle', metadata: {} });
  const a = await E.createEntry({ userData, sourceUuid: imp.uuid, candidate: { path: 'Ahsoka' }, name: 'Ahsoka' });
  const b = await E.createEntry({ userData, sourceUuid: imp.uuid, candidate: { path: 'Ahsoka' }, name: 'Ezra' });
  return { userData, sourceUuid: imp.uuid, a: a.name, b: b.name };
}

(async () => {

  {
    console.log('the SOURCE branch flags the destination entry (the reported defect)');
    const t = await setup();
    clearDirty(t.userData, t.a);
    const before = metaOf(t.userData, t.a);
    check('CONTROL: the entry starts NOT dirty',
      !before.contentHashDirty && !before.effectsDirty,
      `contentHashDirty=${before.contentHashDirty} effectsDirty=${before.effectsDirty}`);

    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/extras/quote1.wav'],
      dest: { kind: 'entry', id: t.a, subPath: '' },
    });
    check('CONTROL: the copy actually landed a file',
      !!(r && r.ok && (r.added || []).length === 1),
      `ok=${r && r.ok} added=${JSON.stringify(r && r.added)}`);

    const after = metaOf(t.userData, t.a);
    check('contentHashDirty is set after adding from a source', after.contentHashDirty === true);
    check('effectsDirty is set after adding from a source', after.effectsDirty === true);
  }

  {
    console.log('the SOURCE branch flags it for a whole FOLDER too');
    const t = await setup();
    clearDirty(t.userData, t.a);
    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/extras'],
      dest: { kind: 'entry', id: t.a, subPath: '' },
    });
    check('CONTROL: the folder copy landed', !!(r && r.ok && (r.added || []).length === 1));
    check('contentHashDirty is set after adding a folder from a source',
      metaOf(t.userData, t.a).contentHashDirty === true);
  }

  {
    console.log('the ON-DISK branch still flags it (the half that already worked)');
    const t = await setup();
    clearDirty(t.userData, t.b);
    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'entry', id: t.a }, srcPaths: ['hum.wav'],
      dest: { kind: 'entry', id: t.b, subPath: '' },
    });
    check('CONTROL: the entry-to-entry copy landed', !!(r && r.ok && (r.added || []).length === 1));
    check('contentHashDirty is set after adding from another font',
      metaOf(t.userData, t.b).contentHashDirty === true);
  }

  {
    console.log('a copy that adds NOTHING does not flag the entry');
    const t = await setup();
    clearDirty(t.userData, t.a);
    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/does-not-exist.wav'],
      dest: { kind: 'entry', id: t.a, subPath: '' },
    });
    check('CONTROL: nothing was added', (r && (r.added || []).length) === 0);
    check('a failed copy leaves the entry un-flagged',
      metaOf(t.userData, t.a).contentHashDirty !== true);
  }

  {
    // ⚠️⚠️ THE MUTATION CONTROL. Everything above passes against the FIXED module, and a case that
    // cannot fail is worth less than no case at all - it is what stops anyone looking. So run the
    // source branch against a copy of the module with the shared exit's marking removed and
    // require that it goes RED. If this block reports the flag still set, these assertions are
    // not reaching the behaviour they claim to test.
    //
    // ⚠️ The mutation is applied to a COPY ON DISK in a temp dir, never to the tracked file. A
    // tracked file edited to test something has a cleanup step, and that cleanup is what discarded
    // ~1,400 lines of uncommitted work on 2026-10-06.
    console.log('MUTATION CONTROL: removing the marking makes the source-branch case fail');
    const srcText = fs.readFileSync(path.join(__dirname, '..', 'soundFontFileOps.js'), 'utf8');
    const needle = '    _markLocationDirty(userData, dest.kind, dest.id);';
    let mutantOk = false;
    if (!srcText.includes(needle)) {
      check('CONTROL: the mutation target exists in the module', false,
        'marking line not found - this control can no longer mutate anything');
    } else {
      const mutantDir = tmp('mutant');
      // The module requires its siblings by relative path, so the mutant has to sit beside them.
      // Writing it into the repo would be mutating the tree; instead point require() at a copy in
      // tmp and give it a package-relative shim via module paths.
      const mutantPath = path.join(mutantDir, 'soundFontFileOps.js');
      fs.writeFileSync(mutantPath, srcText.replace(needle, '    /* mutated: marking removed */'));
      const Module = require('module');
      const repoRoot = path.join(__dirname, '..');
      const mutant = new Module(mutantPath, null);
      mutant.filename = mutantPath;
      // Resolve the mutant's requires against the REPO, so it loads the real siblings.
      mutant.paths = Module._nodeModulePaths(repoRoot).concat([repoRoot]);
      // ⚠️ THE HOOK HAS TO STAY UP ACROSS THE CALL, NOT JUST THE COMPILE. copyAcrossLocations
      // does `require('./soundFontSources')` LAZILY, inside the source branch - so restoring the
      // resolver after _compile left the mutant unable to resolve its own siblings the moment it
      // ran. The first cut did exactly that and threw MODULE_NOT_FOUND, which reads like a broken
      // mutant rather than a broken shim.
      const origResolve = Module._resolveFilename;
      Module._resolveFilename = function (request, parent, ...rest) {
        if (parent === mutant && request.startsWith('./')) {
          return path.join(repoRoot, request.slice(2) + (request.endsWith('.js') ? '' : '.js'));
        }
        return origResolve.call(this, request, parent, ...rest);
      };
      const t = await setup();
      clearDirty(t.userData, t.a);
      try {
        mutant._compile(fs.readFileSync(mutantPath, 'utf8'), mutantPath);
        await mutant.exports.copyAcrossLocations({
          userData: t.userData,
          src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/extras/quote1.wav'],
          dest: { kind: 'entry', id: t.a, subPath: '' },
        });
      } finally {
        Module._resolveFilename = origResolve;
      }
      mutantOk = metaOf(t.userData, t.a).contentHashDirty !== true;
      check('the mutant does NOT set the flag, so these cases can fail', mutantOk);
    }
  }

  console.log(failures === 0 ? '\nall ok' : `\n${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();

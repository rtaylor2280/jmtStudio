// Removing a program from the managed store: DELETE it, or QUARANTINE it inert.
//
// WHY THIS EXISTS ([B-364]). The export guard refuses to carry a program out of the
// library, and for 1.8 that refusal now has to come with a way to act. His scope call,
// 2026-09-11: "the scope is on export. The reason is, on import we're not deleting
// anything because we don't own the cards - that's a 1.9 decision. But for 1.8, we own
// and manage the source data. User doesn't know where it is, nor do we want them poking
// around and trying to delete things."
//
// So OWNERSHIP is the test. A card is the user's and we only ever report on it; the
// managed store is ours and we may act on it with the user's consent. And the second
// half of his argument is the stronger one: the alternative to acting is not inaction,
// it is sending the user into AppData to hand-edit a store the app manages.
//
// ⚠️ DELETION IS ALREADY POLICY, NOT A NEW RULE. importSource purges the extracted tree
// before storing it, so a program in a managed source cannot have arrived by importing.
// Removing it enforces the rule we already have at the only other moment we look.
//
// ⚠️ AND THE FILE IS EVIDENCE, which is the whole reason for the second button. The user
// may want to hash it, submit it to a vendor, or work out what put it there. Quarantine
// preserves every byte; delete does not. Neither is silent and neither is automatic.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The four stores we manage, and the only four places this module will touch.
// Kept here rather than imported so the shape of every managed path is visible in
// one place; each mirrors the root helper in its own module.
function _managedRoot(userData, kind, id) {
  if (kind === 'entry')        return path.join(userData, 'soundFonts', 'library', String(id));
  if (kind === 'common')       return path.join(userData, 'soundFonts', 'common', String(id), 'files');
  if (kind === 'source')       return path.join(userData, 'soundFonts', 'sources', String(id), 'source');
  if (kind === 'sharedTracks') return path.join(userData, 'soundFonts', 'sharedTracks');
  return null;
}

// Resolve (kind, id, relPath) to a real file inside the store.
//
// ⚠️ THE PATH ESCAPE CHECK IS NOT OPTIONAL. relPath arrives from the renderer, and this
// module's whole job is deleting files. Every byte reader in the app already refuses a
// target that resolves outside its root ("Path escapes entry folder"); a writer that
// skipped the same check would be strictly worse than the readers that have it.
function resolveManagedFile(userData, kind, id, relPath) {
  const root = _managedRoot(userData, kind, id);
  if (!root) return { ok: false, error: `Unknown kind: ${kind}` };
  if (!relPath) return { ok: false, error: 'Missing path' };
  const target = path.resolve(path.join(root, String(relPath).replace(/\//g, path.sep)));
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) {
    return { ok: false, error: 'Path escapes the managed store' };
  }
  if (!fs.existsSync(target)) return { ok: false, error: 'File not found' };
  return { ok: true, absPath: target, root: base };
}

// ⚠️ A ZIP-FORMAT SOURCE CANNOT HAVE ONE FILE REMOVED FROM IT, and saying so is better
// than pretending. Measured 2026-09-11: all 162 sources on the dev machine are folder
// format and there is no source.zip anywhere on disk, because the architecture no longer
// archives ("we don't have any zips anymore... that architecture has been changed"). This
// branch exists for a legacy source that predates that change, and it REFUSES rather than
// silently doing nothing, because a delete that reports success and changes nothing is the
// worst outcome available here.
function _zipFormatRefusal(userData, kind, id) {
  if (kind !== 'source') return null;
  const metaPath = path.join(userData, 'soundFonts', 'sources', String(id), 'meta.json');
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return null; }
  if (meta && meta.format && meta.format !== 'folder') {
    return { ok: false, error: 'This source is stored as a single archive, so one file cannot be removed from it.' };
  }
  return null;
}

// ⚠️ RE-VERIFY BEFORE DESTROYING, ALWAYS. The caller tells us which file to remove, but
// the caller is the renderer and the only justification for removing anything here is
// that it IS a program. Trusting the instruction instead of the bytes means a bug
// anywhere upstream deletes somebody's wav. Costs one 256-byte read at the moment it
// matters, and it is the difference between enforcing a policy and following orders.
function _confirmProgram(absPath, relPath) {
  // checkCarryableFile, not the executable test alone ([B-368], his question 2026-09-11:
  // "if there's no way to import a rar and no way to export a rar, then why are we keeping
  // a rar?"). An archive we cannot open can never enter, never leave and never be read -
  // it is bytes the user stores for nothing. So it leaves on the same terms, and SAVE A
  // COPY matters MORE for it than for a program: export cannot carry it, so quarantine is
  // the only way it ever comes back out.
  const { checkCarryableFile } = require('./sdCardDetect');
  const v = checkCarryableFile(absPath, String(relPath).split('/').pop());
  if (!v.blocked) {
    return { ok: false, error: 'That file is allowed in the library, so it was left alone.' };
  }
  return { ok: true, kind: v.kind, reason: v.reason, disguised: !!v.disguised };
}

// Tell the owning store its content signature is stale. A single-file removal changes
// the tree, and a stamped contentHash that no longer describes it would be read as
// current by every later export and backup.
function _markDirty(userData, kind, id) {
  try {
    if (kind === 'entry')  require('./soundFontEntries').markEntryContentDirty(userData, id);
    if (kind === 'common') require('./soundFontCommon').markCommonContentDirty(userData, id);
    if (kind === 'source') require('./soundFontSources').markSourceContentDirty(userData, id);
  } catch { /* a stale marker costs a recompute, never correctness */ }
}

// ⭐ A FONT FOLDER HAS NO FILES OF ITS OWN — THEY ARE ALL POINTERS (his note,
// 2026-09-11, and it changed this module). Measured on the real library the same
// minute: 85 of 86 files in an entry have nlink 2 and share an inode with the source
// file; the one exception is meta.json, the app artifact, which exports already skip.
//
// TWO CONSEQUENCES, and the second is a defect this fixes:
//   1. A program sitting AT A POINTER can only mean the shared inode's bytes were
//      modified in place. Nobody can "add a file to a font folder" — a new file
//      written into a source is nlink 1 and the entry has no pointer to it at all.
//   2. ⚠️ SO UNLINKING ONE NAME DOES NOT REMOVE THE FILE. Drop the entry's pointer and
//      the source name still reaches the same bytes; drop the source name and the
//      entry's pointer survives with its content untouched. Either way the program is
//      still in the library and the app would have reported success.
//
// HIS SCOPE CALL, which is what this implements: removal is POLICY, not a preference.
// "Those files are not allowed in Studio. That means that they must be removed and
// either way they choose they're going to be removed. The quarantine is merely kindness
// to let somebody like me who wants to evaluate where it came from to do so, but either
// way it's coming out of Studio."
//
// ⭐ AND THE UI CONSEQUENCE: "we don't have to tell them every location that it came out
// of, merely that it's been removed." There is no second store from the user's point of
// view. There is Studio, and the file is out of it. Enumerating our internal locations
// would be explaining our storage layout to someone who should never need it.
// The SIDECAR still records every path, because that is evidence for the person who
// chose quarantine in order to evaluate it.
function _findAllNames(userData, absPath) {
  let st;
  try { st = fs.statSync(absPath); } catch { return [absPath]; }
  // nlink 1 is the common case (a file written straight into a source) and needs no
  // walk at all. Only a genuinely multi-named file pays for the search.
  if (typeof st.nlink !== 'number' || st.nlink < 2) return [absPath];

  const sfRoot = path.join(userData, 'soundFonts');
  const searchRoots = [];
  const pushChildren = (parent, tail) => {
    let kids;
    try { kids = fs.readdirSync(parent, { withFileTypes: true }); } catch { return; }
    for (const k of kids) {
      if (!k.isDirectory()) continue;
      const p = tail ? path.join(parent, k.name, tail) : path.join(parent, k.name);
      if (fs.existsSync(p)) searchRoots.push(p);
    }
  };
  pushChildren(path.join(sfRoot, 'library'), '');
  pushChildren(path.join(sfRoot, 'common'), 'files');
  pushChildren(path.join(sfRoot, 'sources'), 'source');
  const tracks = path.join(sfRoot, 'sharedTracks');
  if (fs.existsSync(tracks)) searchRoots.push(tracks);

  const found = [];
  const seen = new Set();
  // ⚡ BASENAME PASS FIRST. A hardlinked copy almost always wears the same filename,
  // so comparing names before calling stat turns ~35,000 stat calls into ~35,000 string
  // compares plus a handful of stats. Measured cost of NOT doing this: a multi-second
  // freeze on a two-name file (his catch, 2026-09-11). It is an optimisation, never the
  // answer: if it does not account for every link the full pass below still runs, so a
  // copy stored under a different name is still found.
  const targetBase = path.basename(absPath);
  // Early exit the moment we have as many names as the link count promises — on a
  // two-name file that usually ends the walk in the first store rather than the last.
  const walk = (dir, namesOnly) => {
    if (found.length >= st.nlink) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (found.length >= st.nlink) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs, namesOnly); continue; }
      if (!e.isFile()) continue;
      if (namesOnly && e.name !== targetBase) continue;
      let s;
      try { s = fs.statSync(abs); } catch { continue; }
      if (s.ino === st.ino && s.dev === st.dev && !seen.has(abs)) {
        seen.add(abs);
        found.push(abs);
      }
    }
  };
  for (const r of searchRoots) walk(r, true);
  // Fall back to the exhaustive pass only when names did not account for every link.
  if (found.length < st.nlink) { for (const r of searchRoots) walk(r, false); }
  if (!seen.has(absPath)) found.push(absPath);
  return found;
}

// ⚠️ ORDER MATTERS AND IT IS THE SAME ORDER deleteEntry USES ([B-316], 2026-09-05).
// Pooled content is kept exactly as long as something uses it, and the filesystem is
// what answers that: the pool holds one name, so a file with any user has nlink >= 2.
// The link count only falls once OUR name is actually gone, so sweeping first would
// find the file still in use and free nothing.
//
// ⭐ AND THIS IS WHY UNLINKING ONE NAME IS SAFE EVEN WHEN THE FILE IS POOLED. Removing a
// name never touches another entry's name for the same bytes - that is what a hardlink
// is. The pool copy survives until its last user is gone. So there is no cross-font
// damage available here, which was the hazard worth checking before writing any of this.
// Removes EVERY name for the file, not just the one the export happened to walk into.
// Returns the paths actually removed so the sidecar can record them; the UI does not
// use them, deliberately.
function _unlinkAndSweep(userData, kind, id, absPath) {
  const names = _findAllNames(userData, absPath);
  const removed = [];
  for (const n of names) {
    try { fs.unlinkSync(n); removed.push(n); } catch { /* keep going: a name we cannot
      remove must not stop us removing the others */ }
  }
  // Every store that lost a name now has a stale content signature, not just the one
  // the caller named. Derive which from the path rather than trusting `kind`.
  _markDirtyForPaths(userData, removed);
  _markDirty(userData, kind, id);
  try { require('./soundFontContentIndex').releasePoolOrphans(userData); } catch {}
  return removed;
}

// Map each removed path back to the store that owns it, so a removal that spanned an
// entry and its source marks both. Reading the layout off the path is what keeps this
// correct when the caller only knew about one of them.
function _markDirtyForPaths(userData, paths) {
  const sfRoot = path.resolve(path.join(userData, 'soundFonts'));
  for (const p of paths) {
    const rel = path.relative(sfRoot, path.resolve(p)).split(path.sep);
    if (rel.length < 2) continue;
    const [bucket, id] = rel;
    if (bucket === 'library') _markDirty(userData, 'entry', id);
    else if (bucket === 'common') _markDirty(userData, 'common', id);
    else if (bucket === 'sources') _markDirty(userData, 'source', id);
  }
}

// ── THE HOLDING AREA ────────────────────────────────────────────────────────────
//
// ⭐ HIS DESIGN, 2026-09-11, and it inverts the order the first build used: "essentially
// the quarantine becomes a temp file. In the process, if the user closes the app in the
// middle of it, it's already gone. It should always be deleted by the time we report it,
// and the quarantine is whether they want to take it out of the temporary folder and put
// it somewhere else - and then we delete it immediately - or it ends up getting deleted
// because they left."
//
// WHAT THAT FIXES. The first build asked the question and removed the file only if the
// user answered, which left a state where dismissing the dialog kept a program in the
// library. Now removal happens AT DETECTION and the report is a statement of fact, not a
// request for permission. The remaining choice is only whether they keep a copy.
// It also means the app never has to be trusted to finish: if they close it mid-decision,
// the sweep collects the holding area and the outcome is the same.
//
// MODELLED ON clearStagedSources ([B-298]), which is the same lifecycle already proven
// here: swept at STARTUP and at QUIT, "the two moments nothing can be in flight". Same
// reasoning applies exactly - an impounded file cannot be adopted by a later session, so
// across sessions it is garbage, always.
//
// ⚠️ INERT IN THE HOLDING AREA TOO. It carries the .quarantine suffix from the moment it
// lands, not only when the user saves a copy. A folder inside the app's own data
// directory is not a safe place to park a file that Windows would happily launch.
//
// SAME VOLUME as the store on purpose: userData to userData means a rename, so impounding
// is instant and does not duplicate a large file.
function holdingRoot(userData) {
  return path.join(userData, 'soundFonts', '_impound');
}

// ⚠️⚠️ A SECOND NAME FOR A FILE WE ALREADY SWEPT IS NOT A FAILURE ([B-394], his export
// 2026-09-16). The content-addressed store HARDLINKS one file into several buckets, and
// `_unlinkAndSweep` deliberately removes EVERY name `_findAllNames` can reach — leaving one
// behind would leave the program in the library. So a batch that refused the same file once
// per bucket arrives here a second time pointing at a path the FIRST call already removed,
// `resolveManagedFile` says "File not found", and the honest outcome gets reported as
// "1 could not be removed".
//
// ⭐ THAT IS THE WORST POSSIBLE DIRECTION FOR THIS LIE. It tells the user a program survived
// in their library — the one outcome we can actually prove did not happen. His dialog said
// exactly that about "8.21打印.rar" while BOTH of its names were already gone: one quarantine
// file, two paths in its `Found in:`, and a clean store.
//
// Answered from the holding area rather than from a caller-side "already swept" set, because
// the hardlink knowledge lives HERE. A renderer batch cannot know two records share an inode,
// and the import path has no bucket to compute a comparable path from.
function _alreadyImpounded(userData, kind, id, relPath) {
  const root = _managedRoot(userData, kind, id);
  if (!root) return null;
  const sfRoot = path.resolve(path.join(userData, 'soundFonts'));
  const want = path.relative(sfRoot,
    path.resolve(path.join(root, String(relPath).replace(/\//g, path.sep))))
    .split(path.sep).join('/');
  const hold = holdingRoot(userData);
  let tokens;
  try { tokens = fs.readdirSync(hold, { withFileTypes: true }); } catch { return null; }
  for (const t of tokens) {
    if (!t.isDirectory()) continue;
    let f;
    try { f = JSON.parse(fs.readFileSync(path.join(hold, t.name, 'finding.json'), 'utf8')); }
    catch { continue; }
    if (Array.isArray(f.foundAt) && f.foundAt.includes(want)) return { token: t.name, finding: f };
  }
  return null;
}

// Remove a program from the store and park its bytes. Returns a token the caller hands
// back if the user decides to keep a copy.
function impoundProgram(userData, { kind, id, relPath } = {}) {
  const zr = _zipFormatRefusal(userData, kind, id);
  if (zr) return zr;
  const r = resolveManagedFile(userData, kind, id, relPath);
  if (!r.ok) {
    // Only "File not found" can be a prior sweep. An escaping path or an unknown kind is a
    // real error and still has to surface as one.
    const prior = r.error === 'File not found' && _alreadyImpounded(userData, kind, id, relPath);
    if (prior) {
      const f = prior.finding || {};
      // nameCount 0: this call removed nothing. The sweep that DID is already counted.
      return { ok: true, impounded: true, alreadyImpounded: true, token: prior.token,
        relPath: String(relPath), name: String(relPath).split('/').pop(),
        sha256: f.sha256, size: f.size, nameCount: 0,
        disguised: f.disguised, kind: f.kind };
    }
    return r;
  }
  const c = _confirmProgram(r.absPath, relPath);
  if (!c.ok) return c;

  const baseName = String(relPath).split('/').pop();
  try {
    const root = holdingRoot(userData);
    fs.mkdirSync(root, { recursive: true });
    // One folder per impound, so two findings with the same name cannot collide and the
    // sidecar always sits beside the file it describes.
    const token = crypto.randomBytes(8).toString('hex');
    const dir = path.join(root, token);
    fs.mkdirSync(dir, { recursive: true });

    const buf = fs.readFileSync(r.absPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const held = path.join(dir, baseName + QUARANTINE_SUFFIX);
    fs.writeFileSync(held, buf);

    // Resolved BEFORE removal, because afterwards there is nothing left to find. Kept in
    // the sidecar only - the screen never enumerates our storage.
    const sfRoot = path.resolve(path.join(userData, 'soundFonts'));
    const foundAt = _findAllNames(userData, r.absPath)
      .map(p => path.relative(sfRoot, path.resolve(p)).split(path.sep).join('/'));
    fs.writeFileSync(path.join(dir, 'finding.json'), JSON.stringify({
      quarantinedBy: 'JMT Studio',
      quarantinedAt: new Date().toISOString(),
      originalName: baseName,
      storePath: String(relPath),
      store: { kind, id: String(id) },
      foundAt,
      sha256,
      size: buf.length,
      finding: c.reason,
      kind: c.kind,
      disguised: c.disguised,
      note: 'Renamed so it cannot run on a double-click. Every byte is unchanged.',
    }, null, 2));

    const removed = _unlinkAndSweep(userData, kind, id, r.absPath);
    return { ok: true, impounded: true, token, relPath: String(relPath), name: baseName,
      sha256, size: buf.length, nameCount: removed.length, disguised: c.disguised, kind: c.kind };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// The user chose to keep a copy. Copy out, then drop the holding entry immediately —
// "and then we delete it immediately". Nothing waits for the sweep once they have it.
// ⚠️ IT LANDS IN ITS OWN LABELLED FOLDER, NEVER LOOSE IN THE CHOSEN DIRECTORY (his
// catch on the first dev pass, 2026-09-11: "one file but there are two here... and it
// should have come in its own folder, properly labeled for what it is, as potentially it
// can be dangerous").
//
// TWO THINGS WERE WRONG. The file and its sidecar dropped straight onto his Desktop as
// two anonymous icons whose names were both truncated to "blst99.wav...." — so one
// finding looked like two files and neither said what it was. And a file we have just
// told the user is a program has no business sitting unlabelled among their own things.
//
// The folder carries the warning, the README explains the rename, and a batch lands
// together instead of scattering N pairs across the destination.
// ⚠️ ONE TEXT FILE, NOT A JSON PER FINDING (his catch, 2026-09-11: "what's the json?
// shouldn't we be handing a text file if there's going to be information?"). He is right
// and it fixes the count problem at the same time: a .json is a developer artifact, and
// pairing one with every quarantined file is what made a single finding look like two
// files on his Desktop. Everything the sidecar carried now reads as prose in READ ME.txt,
// which a person can actually open - and a hash copies out of a text file just as well as
// out of JSON.
function _readmeHeader() {
  const L = [
    'QUARANTINED BY JMT STUDIO',
    '',
    'The files in this folder were found inside your sound font library and',
    'removed from it. They are programs. A program cannot get into a font by',
    'importing one, so something else on this computer put them there.',
    '',
    'Each one has been renamed to end in ".quarantine" so that it cannot run if',
    'it is double-clicked. Nothing else has been changed - every byte is exactly',
    'as it was found, so it can still be checked or sent for analysis.',
    '',
    'DO NOT rename a file back to its original extension unless you know exactly',
    'what you are doing.',
    '',
    'This text file is safe to read. The files themselves are in the folder next',
    'to it, called "' + _FILES_SUBDIR + '".',
    '',
    '----------------------------------------------------------------------',
  ];
  return L.join('\r\n');
}

// One block per file, APPENDED. There is no state file: the folder's own README is the
// record, and appending to it is what removed the need for one.
function _readmeBlock(b) {
  const L = [];
  {
    L.push('');
    L.push(`FILE:        ${b.savedAs}`);
    L.push(`Original:    ${b.originalName || '(unknown)'}`);
    if (b.finding)       L.push(`Why:         ${b.finding}`);
    if (b.disguised)     L.push('             It was disguised as a sound file: its name said one');
    if (b.disguised)     L.push('             thing and its contents said another.');
    if (b.size != null)  L.push(`Size:        ${b.size} bytes`);
    if (b.sha256)        L.push(`SHA-256:     ${b.sha256}`);
    if (b.quarantinedAt) L.push(`Removed:     ${b.quarantinedAt}`);
    if (b.foundAt && b.foundAt.length) {
      L.push('Found in:');
      for (const p of b.foundAt) L.push('             ' + p);
    }
  }
  L.push('');
  return L.join('\r\n');
}


// ⚠️ THE FILES SIT ONE LEVEL DOWN, IN A FOLDER THAT NAMES ITSELF (his shape, 2026-09-11:
// "a folder with a text file saying something about it's safe to read, and then a folder
// labeled quarantined files with the file in it"). Opening the quarantine folder should
// put a readable explanation in front of you, not the programs themselves. Anyone who
// reaches the files has passed a folder called "Quarantined Files" to get there.
const _FILES_SUBDIR = 'Quarantined Files';

function releaseImpounded(userData, { token, destDir, batchLabel } = {}) {
  if (!token || !destDir) return { ok: false, error: 'Missing token or destination' };
  const dir = path.join(holdingRoot(userData), String(token));
  if (!path.resolve(dir).startsWith(path.resolve(holdingRoot(userData)) + path.sep)) {
    return { ok: false, error: 'Invalid token' };
  }
  if (!fs.existsSync(dir)) return { ok: false, error: 'That file is no longer being held.' };
  try {
    const files = fs.readdirSync(dir).filter(n => n !== 'finding.json');
    if (!files.length) return { ok: false, error: 'That file is no longer being held.' };

    // One folder per quarantine action. The label comes from the caller so every file in
    // a batch lands in the SAME folder rather than one folder each.
    const label = String(batchLabel || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim();
    const folderName = `JMT Studio Quarantine${label ? ' - ' + label : ''}`;
    let outDir = path.join(destDir, folderName);
    // Reuse the folder within a batch; only step aside for a genuinely older one.
    if (fs.existsSync(outDir) && !fs.existsSync(path.join(outDir, 'READ ME.txt'))) {
      for (let n = 1; fs.existsSync(outDir); n++) outDir = path.join(destDir, `${folderName} (${n})`);
    }
    fs.mkdirSync(outDir, { recursive: true });
    const filesDir = path.join(outDir, _FILES_SUBDIR);
    fs.mkdirSync(filesDir, { recursive: true });

    const src = path.join(dir, files[0]);
    let outPath = path.join(filesDir, files[0]);
    for (let n = 1; fs.existsSync(outPath); n++) {
      const stem = files[0].slice(0, -QUARANTINE_SUFFIX.length);
      outPath = path.join(filesDir, `${stem} (${n})${QUARANTINE_SUFFIX}`);
    }
    fs.copyFileSync(src, outPath);
    // Carry the finding forward as prose. The notes dotfile accumulates across a batch so
    // READ ME.txt can be rewritten complete each time rather than appended to blindly.
    let finding = {};
    try { finding = JSON.parse(fs.readFileSync(path.join(dir, 'finding.json'), 'utf8')); } catch {}
    try {
      const readme = path.join(outDir, 'READ ME.txt');
      if (!fs.existsSync(readme)) fs.writeFileSync(readme, _readmeHeader());
      fs.appendFileSync(readme, _readmeBlock({ ...finding, savedAs: path.basename(outPath) }));
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, destPath: outPath, folder: outDir };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// The user chose Delete. Drop the held bytes now rather than waiting for the sweep.
//
// ⚠️ FROM THE USER'S SIDE THIS IS THE WHOLE OF "DELETE" — they are not told the file was
// parked anywhere, because the holding area is our bookkeeping and not their business
// (his call, 2026-09-11: "the underworks of it, the fact that we're putting it in a temp
// file and all that stuff, is irrelevant to the user"). Dismissing the dialog reaches the
// same end by a slower road: the sweep takes it at quit.
function discardImpounded(userData, { token } = {}) {
  if (!token) return { ok: false, error: 'Missing token' };
  const root = holdingRoot(userData);
  const dir = path.join(root, String(token));
  if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) {
    return { ok: false, error: 'Invalid token' };
  }
  // Already gone is a success: the file is absent, which is what was asked for.
  if (!fs.existsSync(dir)) return { ok: true, discarded: true };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, discarded: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Swept at startup and at quit. Unconditional by design: everything in here is either
// already saved elsewhere or was abandoned, and neither survives its session.
function sweepImpounded(userData) {
  const root = holdingRoot(userData);
  const result = { removed: 0, bytes: 0 };
  if (!fs.existsSync(root)) return result;
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return result; }
  for (const d of dirs) {
    const abs = path.join(root, d.name);
    try {
      for (const f of fs.readdirSync(abs)) {
        try { result.bytes += fs.statSync(path.join(abs, f)).size; } catch {}
      }
      fs.rmSync(abs, { recursive: true, force: true });
      result.removed++;
    } catch {}
  }
  return result;
}

// DELETE — kept for the direct case, and it is what impound uses underneath.
function deleteManagedFile(userData, { kind, id, relPath } = {}) {
  const zr = _zipFormatRefusal(userData, kind, id);
  if (zr) return zr;
  const r = resolveManagedFile(userData, kind, id, relPath);
  if (!r.ok) return r;
  const c = _confirmProgram(r.absPath, relPath);
  if (!c.ok) return c;
  try {
    const size = (() => { try { return fs.statSync(r.absPath).size; } catch { return 0; } })();
    const removed = _unlinkAndSweep(userData, kind, id, r.absPath);
    // `removed` is how many NAMES went, which is an internal fact. The caller reports
    // that the file is gone, never where from.
    return { ok: true, deleted: true, relPath: String(relPath), size, nameCount: removed.length };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// QUARANTINE — keep every byte, somewhere the user picked, and make it inert.
//
// ⚠️ A PLAIN MOVE IS WORSE THAN DOING NOTHING. Moving foo.exe to their Desktop turns a
// file nobody could reach into a runnable program somewhere they might double-click.
// Windows picks its launcher from the EXTENSION (proved 2026-09-10), so writing it as
// foo.exe.quarantine makes the double-click inert while preserving the file exactly.
// NEVER write a quarantined file under its original executable extension.
//
// COPY THEN UNLINK, never rename: the destination is a folder the user chose and may be
// on another volume, and a pooled file must be copied to become independent of the pool
// before its name in the store goes away.
const QUARANTINE_SUFFIX = '.quarantine';

function quarantineManagedFile(userData, { kind, id, relPath, destDir } = {}) {
  if (!destDir) return { ok: false, error: 'Missing destination' };
  const zr = _zipFormatRefusal(userData, kind, id);
  if (zr) return zr;
  const r = resolveManagedFile(userData, kind, id, relPath);
  if (!r.ok) return r;
  const c = _confirmProgram(r.absPath, relPath);
  if (!c.ok) return c;

  const baseName = String(relPath).split('/').pop();
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    // Collision-safe, same " (N)" convention the rest of the app uses for a folder the
    // user picked: never overwrite something already sitting there.
    let outPath = path.join(destDir, baseName + QUARANTINE_SUFFIX);
    for (let n = 1; fs.existsSync(outPath); n++) {
      outPath = path.join(destDir, `${baseName} (${n})${QUARANTINE_SUFFIX}`);
    }
    const buf = fs.readFileSync(r.absPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    fs.writeFileSync(outPath, buf);
    // ⭐ EVERY LOCATION GOES IN THE SIDECAR, AND NOWHERE ELSE. Quarantine exists for the
    // user who wants to work out where the file came from ("merely kindness to let
    // somebody like me who wants to evaluate where it came from do so"), so the evidence
    // has to be complete. The SCREEN still says only that it was removed.
    // Resolved BEFORE the removal, because afterwards there is nothing left to find.
    const sfRoot = path.resolve(path.join(userData, 'soundFonts'));
    const foundAt = _findAllNames(userData, r.absPath)
      .map(p => path.relative(sfRoot, path.resolve(p)).split(path.sep).join('/'));
    // Written BEFORE the original goes, so a failure here leaves the store untouched.
    fs.writeFileSync(outPath + '.json', JSON.stringify({
      quarantinedBy: 'JMT Studio',
      quarantinedAt: new Date().toISOString(),
      originalName: baseName,
      storePath: String(relPath),
      store: { kind, id: String(id) },
      foundAt,
      sha256,
      size: buf.length,
      finding: c.reason,
      disguised: c.disguised,
      note: 'Renamed so it cannot run on a double-click. Every byte is unchanged.',
    }, null, 2));
    const removed = _unlinkAndSweep(userData, kind, id, r.absPath);
    return { ok: true, quarantined: true, relPath: String(relPath), destPath: outPath,
      sha256, size: buf.length, nameCount: removed.length };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  resolveManagedFile,
  deleteManagedFile,
  quarantineManagedFile,
  impoundProgram,
  releaseImpounded,
  discardImpounded,
  sweepImpounded,
  holdingRoot,
  QUARANTINE_SUFFIX,
};

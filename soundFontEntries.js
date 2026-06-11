// Sound Fonts — library entry storage (Phase 1, slice 5).
//
// A "library entry" is a curated Proffie sound font extracted from one
// candidate inside a source. Entries live at userData/soundFonts/library/
// <name>/ with a meta.json that links back to the source by UUID. One source
// can produce many entries; each entry references exactly one source.
//
// Extraction handles two source-side shapes:
//   - Simple: candidate.path points at a folder inside the source; the
//     source's extractTo method copies the subtree directly.
//   - Nested: candidate.path points at an inner .zip inside the source
//     (Greyscale's Proffie.zip board flavor, Power_Of_Many's per-character
//     zips). We spool the inner zip to a temp file, open it, extract its
//     contents into the entry dir, and clean up temp.

const fs = require('fs');
const path = require('path');
const os = require('os');
const StreamZip = require('node-stream-zip');
const soundFontSources = require('./soundFontSources');

function entriesRoot(userData) {
  return path.join(userData, 'soundFonts', 'library');
}

function ensureEntriesRoot(userData) {
  const root = entriesRoot(userData);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function _readEntryMeta(entryDir) {
  try { return JSON.parse(fs.readFileSync(path.join(entryDir, 'meta.json'), 'utf8')); }
  catch { return null; }
}

function listEntries(userData) {
  const root = entriesRoot(userData);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = _readEntryMeta(path.join(root, entry.name));
    if (meta) out.push({ name: entry.name, meta });
  }
  return out;
}

function findEntryByName(userData, name) {
  if (!name) return null;
  const dir = path.join(entriesRoot(userData), name);
  if (!fs.existsSync(dir)) return null;
  const meta = _readEntryMeta(dir);
  return meta ? { name, meta } : null;
}

// Sanitize a user-supplied entry name to a Proffie-safe form. The entry
// folder name ends up on the saber's SD card and is referenced by name in
// the user's ProffieOS config presets, so it has to be more conservative
// than filesystem-safe: spaces become underscores (Proffie config syntax
// chokes on spaced font names), then characters disallowed by Windows /
// Linux / Mac filesystems are replaced, then length is capped.
function _sanitizeEntryName(name) {
  return String(name || '').trim()
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 200);
}

// Spool the bytes of an inner zip from a source to a temp file, open it,
// extract its contents to destDir. Used for the nested-zip candidate case
// (Greyscale Proffie.zip, Power_Of_Many's per-character zips).
async function _extractNestedZipToDir(source, innerZipPath, destDir, onProgress) {
  const buf = await source.readFile(innerZipPath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-sf-nested-'));
  const tmpZip = path.join(tmpDir, 'nested.zip');
  try {
    await fs.promises.writeFile(tmpZip, buf);
    const zip = new StreamZip.async({ file: tmpZip, skipEntryNameValidation: true });
    try {
      const entryMap = await zip.entries();
      const destDirResolved = path.resolve(destDir);
      let fileCount = 0;
      let totalBytes = 0;
      const keys = Object.keys(entryMap).sort();
      // Wrapper-strip detection: if every meaningful entry inside the inner
      // zip shares a single top-level folder prefix (Greyscale's Proffie.zip
      // wraps everything under "Proffie/"), strip it so the extracted entry
      // dir has the real Proffie content at root.
      const meaningfulNames = keys
        .map(k => entryMap[k].name)
        .filter(n => n && n !== '/' && !/\/$/.test(n));
      const topLevels = new Set();
      for (const n of meaningfulNames) {
        const slash = n.indexOf('/');
        topLevels.add(slash === -1 ? n : n.slice(0, slash));
      }
      let stripPrefix = '';
      if (topLevels.size === 1) {
        const only = [...topLevels][0];
        // Confirm it's a folder (something lives under it).
        if (meaningfulNames.some(n => n.startsWith(only + '/'))) {
          stripPrefix = only + '/';
        }
      }
      for (const key of keys) {
        const e = entryMap[key];
        if (!e.name || e.name === '/' || e.isDirectory) continue;
        if (stripPrefix && !e.name.startsWith(stripPrefix)) continue;
        const relName = stripPrefix ? e.name.slice(stripPrefix.length) : e.name;
        if (!relName) continue;
        const destPath = path.join(destDir, relName.replace(/\//g, path.sep));
        const resolved = path.resolve(destPath);
        if (resolved !== destDirResolved && !resolved.startsWith(destDirResolved + path.sep)) {
          throw new Error(`Refused to extract outside destination: ${relName}`);
        }
        const parent = path.dirname(destPath);
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
        await new Promise((resolve, reject) => {
          zip.stream(e.name)
            .then(stream => {
              const writeStream = fs.createWriteStream(destPath);
              stream.on('error', reject);
              writeStream.on('error', reject);
              writeStream.on('finish', resolve);
              stream.pipe(writeStream);
            })
            .catch(reject);
        });
        fileCount++;
        totalBytes += e.size || 0;
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: relName });
      }
      return { fileCount, totalBytes };
    } finally {
      await zip.close();
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// createEntry({ userData, sourceUuid, candidate, name?, metadata?, onProgress? })
//
// Extracts the candidate from the source into a new library entry. The name
// defaults to the candidate's suggested name; the caller is expected to have
// run findEntryByName first if they want to surface a friendlier collision
// message than the generic "already exists" error.
//
// Returns one of:
//   { ok: true, name, meta }
//   { ok: false, error: <string>, existing?: true }
async function createEntry({ userData, sourceUuid, candidate, name, metadata, onProgress }) {
  if (!userData) return { ok: false, error: 'Missing userData' };
  if (!sourceUuid) return { ok: false, error: 'Missing sourceUuid' };
  if (!candidate) return { ok: false, error: 'Missing candidate' };

  const entryName = _sanitizeEntryName(name || candidate.name);
  if (!entryName) return { ok: false, error: 'Invalid entry name' };

  if (findEntryByName(userData, entryName)) {
    return { ok: false, error: `Entry already exists: ${entryName}`, existing: true };
  }

  const source = soundFontSources.openSource(userData, sourceUuid);
  if (!source) return { ok: false, error: `Source not found: ${sourceUuid}` };

  const root = ensureEntriesRoot(userData);
  const entryDir = path.join(root, entryName);

  const emit = (stage, payload) => {
    if (onProgress) onProgress({ stage, ...payload });
  };

  try {
    fs.mkdirSync(entryDir, { recursive: true });
    emit('extracting', { percent: 0 });

    let result;
    if (candidate.nested) {
      result = await _extractNestedZipToDir(source, candidate.path, entryDir, (p) => {
        emit('extracting', p);
      });
    } else {
      result = await source.extractTo(candidate.path || '', entryDir, (p) => {
        emit('extracting', p);
      });
    }

    const meta = {
      schemaVersion: 1,
      name: entryName,
      sourceUuid,
      candidatePath: candidate.path || '',
      multiBoard: !!candidate.multiBoard,
      otherFlavors: candidate.otherFlavors || [],
      nested: !!candidate.nested,
      linkedStyleLibraryEntry: (metadata && metadata.linkedStyleLibraryEntry) || null,
      purchased: !!(metadata && metadata.purchased),
      author: (metadata && metadata.author) || '',
      acquisitionDate: (metadata && metadata.acquisitionDate) || new Date().toISOString().slice(0, 10),
      description: (metadata && metadata.description) || '',
      userNotes: (metadata && metadata.userNotes) || '',
      addedFromSource: [],
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(entryDir, 'meta.json'), JSON.stringify(meta, null, 2));
    emit('done', { fileCount: result.fileCount, totalBytes: result.totalBytes });
    return { ok: true, name: entryName, meta };
  } catch (err) {
    // Cleanup partial entry so the library stays consistent.
    try { fs.rmSync(entryDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  entriesRoot,
  ensureEntriesRoot,
  listEntries,
  findEntryByName,
  createEntry,
};

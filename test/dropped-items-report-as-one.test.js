/**
 * A font and the source it came from report as ONE loss, and the count is the FAULT  [2026-10-15]
 *
 * TWO DEFECTS ON THE SAME SCREEN, both found by reading a real export's completion dialog:
 *
 *   1. A font and its source were listed as two unrelated losses. They are one thing to the user,
 *      and a bad sector usually takes both — the library dedups by content and hardlinks the
 *      copies, so a font and its source are frequently the same bytes. One ACE on one physical
 *      file lit SIX paths across both buckets on the measured run.
 *   2. The headline summed each dropped item's whole file count, so one unreadable file inside a
 *      305-file source reported as 305 files that "could not be read". Measured: 368 claimed
 *      against 9 that genuinely could not be read. That is a false statement about the disk, in
 *      red, on the screen that reports the backup finished.
 *
 * THE RULE DID NOT CHANGE, ONLY THE REPORT. A readable source whose font is damaged is still
 * carried: it is the original purchase archive and the half that can rebuild the font. Combining
 * the report is not combining the drop decision, and the grouping asserts that below.
 *
 * THESE ARE RENDERER FUNCTIONS, SO THEY ARE EXECUTED, NOT GREPPED. The renderer has no module
 * boundary, so each is brace-matched out of index.html and run. Grep cannot tell a function that
 * is present from one that is reached, and both defects here are in output, not in source text.
 *
 * Run: node test/dropped-items-report-as-one.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const HTML   = path.join(ROOT, 'renderer', 'index.html');
// Overridable so a control run can point at a copy with the groupKey stamp removed. The
// stay-separate assertions pass for free when nothing is ever grouped, so they are only worth
// anything beside a run that proves the combining ones can fail.
const backup = require(process.env.DROPREPORT_MODULE || path.join(ROOT, 'soundFontBackup.js'));

let failures = 0;
let barCheck = Promise.resolve();
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── lift the functions out of the page ────────────────────────────────────
// Brace-matched from the declaration, so a body that grows or moves still comes out whole.
// CRLF normalised: the source-text assertions below anchor on line breaks, and a pattern written
// with \n silently never matches a \r\n file. Brace matching is unaffected either way.
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
function lift(name) {
  const decl = `const ${name} = `;
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`cannot find ${name} in index.html`);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced body for ${name}`);
  return src.slice(start, end);
}

const NAMES = ['_sfGroupDropped', '_sfDroppedLabel', '_sfDroppedRowHtml'];
const stubs = `
  const _sfEscape = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const _sfPathLinkHtml = (p) => '<a data-path="' + _sfEscape(p) + '">' + _sfEscape(p) + '</a>';
  const _sfItemNoun = (bucket) => (
    bucket === 'library' ? 'sound font'
    : bucket === 'sources' ? 'source'
    : bucket === 'common' ? 'common folder'
    : bucket === 'attachments' ? 'proof of purchase'
    : 'item');
`;
// Only the presentation helpers are stubbed. Everything under test is the page's own code.
const F = new Function(`${stubs}\n${NAMES.map(lift).join(';\n')};\nreturn { ${NAMES.join(', ')} };`)();
ok('the three report functions lift and evaluate', NAMES.every(n => typeof F[n] === 'function'));

// ── the input comes from the REAL producer, not from a fixture I shaped ───
// A fixture built by hand would agree with whatever the renderer expects. describeSkipConsequence
// is the function that actually feeds this dialog, so it decides the shape AND the groupKey.
function buildLibrary() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-'));
  const SF = path.join(ud, 'soundFonts');
  const SRC = 'aaaaaaaa-0000-4000-9000-000000000001';

  const srcDir = path.join(SF, 'sources', SRC, 'source');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'bgndrag.wav'), 'x');
  fs.writeFileSync(path.join(srcDir, 'hum.wav'), 'y');
  fs.writeFileSync(path.join(SF, 'sources', SRC, 'meta.json'), JSON.stringify({
    schemaVersion: '1', uuid: SRC, format: 'folder', originalName: 'font-the-watcher',
  }, null, 2));

  // Two fonts from the one source: the combining rule has to tell "the source went too" from
  // "two fonts that share a healthy source", and one font alone cannot show the difference.
  for (const name of ['The_Watcher', 'The_Watcher_Alt']) {
    const d = path.join(SF, 'library', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'bgndrag.wav'), 'x');
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({
      schemaVersion: '1', name, entryUuid: `e-${name}`, sourceUuid: SRC,
    }, null, 2));
  }

  // An unrelated font with no source at all — it must never join someone else's group.
  const lone = path.join(SF, 'library', 'Orphan');
  fs.mkdirSync(lone, { recursive: true });
  fs.writeFileSync(path.join(lone, 'hum.wav'), 'z');
  fs.writeFileSync(path.join(lone, 'meta.json'),
    JSON.stringify({ schemaVersion: '1', name: 'Orphan', entryUuid: 'e-orphan' }, null, 2));

  // A loose track: the bucket with no items, so it exercises the file half of the consequence.
  fs.mkdirSync(path.join(SF, 'sharedTracks'), { recursive: true });
  fs.writeFileSync(path.join(SF, 'sharedTracks', 'loose.wav'), 'abcdefghij');

  return { ud, SF, SRC };
}

const { ud, SF, SRC } = buildLibrary();
const P = (...p) => path.join(SF, ...p);

// ── the producer stamps a groupKey that pairs a font with its source ──────
{
  const c = backup.describeSkipConsequence(ud, [
    { path: P('sources', SRC, 'source', 'bgndrag.wav'), code: 'EPERM' },
    { path: P('library', 'The_Watcher', 'bgndrag.wav'), code: 'EPERM' },
  ]);
  ok('precondition: the producer returns both items', c.items.length === 2,
     JSON.stringify(c.items.map(i => i.bucket)));
  const keys = c.items.map(i => i.groupKey);
  ok('THE FONT AND ITS SOURCE CARRY THE SAME GROUP KEY',
     keys[0] && keys[0] === keys[1], JSON.stringify(keys));

  const groups = F._sfGroupDropped(c.items);
  ok('so they report as ONE row, not two', groups.length === 1,
     JSON.stringify(groups.map(g => g.map(i => i.bucket))));
  ok('and the row names the font, which is the name the user recognises',
     F._sfDroppedLabel(groups[0]) === 'The_Watcher sound font and its source',
     F._sfDroppedLabel(groups[0]));

  const html = F._sfDroppedRowHtml(groups[0], 'done');
  ok('the row reads as one loss in the past tense',
     html.includes('<strong>Your whole The_Watcher sound font and its source were left out</strong>'),
     html);
  ok('THE COUNT IS THE FAULT: 2 unreadable, not the 4 files they contain',
     /2 files could not be read, invalidating the copy\./.test(html), html);
  ok('and the row does not report the size of the hole',
     !/\b4 files\b/.test(html) && !/not in this backup/.test(html), html);
  // [2026-10-15] The sub-line states what happened. It does not describe the item as missing
  // part of itself or predict how a restore would look.
  ok('the sub-line carries no personification',
     !/missing part of itself|looking complete/.test(html), html);
  ok('both paths are offered, because they are two places on disk',
     html.includes(P('sources', SRC)) && html.includes(P('library', 'The_Watcher')), html);

  const asked = F._sfDroppedRowHtml(groups[0], 'ask');
  ok('the gate asks about the same single loss, in the present tense',
     asked.includes('Your whole The_Watcher sound font and its source cannot be backed up'), asked);
}

// ── a source taking SEVERAL of its fonts is still one row ─────────────────
{
  const c = backup.describeSkipConsequence(ud, [
    { path: P('sources', SRC, 'source', 'bgndrag.wav'), code: 'EPERM' },
    { path: P('library', 'The_Watcher', 'bgndrag.wav'), code: 'EPERM' },
    { path: P('library', 'The_Watcher_Alt', 'bgndrag.wav'), code: 'EPERM' },
  ]);
  const groups = F._sfGroupDropped(c.items);
  ok('a source and both its fonts are one row', groups.length === 1);
  ok('and it is named by the SOURCE once more than one font is involved',
     F._sfDroppedLabel(groups[0]) === 'font-the-watcher source and its 2 sound fonts',
     F._sfDroppedLabel(groups[0]));
}

// ── THE RULE DID NOT CHANGE: fonts sharing a HEALTHY source stay separate ─
// The dangerous over-reach. Rolling two fonts under a source that was carried would describe a
// loss that never happened, and it is the one case a naive groupKey join gets wrong.
{
  const c = backup.describeSkipConsequence(ud, [
    { path: P('library', 'The_Watcher', 'bgndrag.wav'), code: 'EPERM' },
    { path: P('library', 'The_Watcher_Alt', 'bgndrag.wav'), code: 'EPERM' },
  ]);
  ok('precondition: the source itself is not among the dropped items',
     !c.items.some(i => i.bucket === 'sources'), JSON.stringify(c.items.map(i => i.bucket)));
  const groups = F._sfGroupDropped(c.items);
  ok('TWO FONTS WITH A HEALTHY SOURCE ARE TWO LOSSES, NOT ONE', groups.length === 2,
     JSON.stringify(groups.map(g => g.map(i => i.item))));
  ok('each names only itself',
     groups.map(g => F._sfDroppedLabel(g)).sort().join(' | ')
       === 'The_Watcher sound font | The_Watcher_Alt sound font',
     groups.map(g => F._sfDroppedLabel(g)).join(' | '));
  ok('and neither claims the source went with it',
     !groups.some(g => F._sfDroppedLabel(g).includes('its source')));
}

// ── a font with no source at all keeps its own row ────────────────────────
{
  const c = backup.describeSkipConsequence(ud, [
    { path: P('sources', SRC, 'source', 'bgndrag.wav'), code: 'EPERM' },
    { path: P('library', 'The_Watcher', 'bgndrag.wav'), code: 'EPERM' },
    { path: P('library', 'Orphan', 'hum.wav'), code: 'EPERM' },
  ]);
  const groups = F._sfGroupDropped(c.items);
  ok('a sourceless font is never absorbed into another group', groups.length === 2,
     JSON.stringify(groups.map(g => g.map(i => i.item))));
  ok('and it reports plainly as itself',
     groups.some(g => F._sfDroppedLabel(g) === 'Orphan sound font'),
     groups.map(g => F._sfDroppedLabel(g)).join(' | '));
}

// ── the headline counts unreadable files, not the files they took with them ─
// The arithmetic the completion screen does, run here against the producer's own numbers.
{
  const c = backup.describeSkipConsequence(ud, [
    { path: P('sources', SRC, 'source', 'bgndrag.wav'), code: 'EPERM' },
    { path: P('library', 'The_Watcher', 'bgndrag.wav'), code: 'EPERM' },
  ]);
  const unreadable = c.items.reduce((a, it) => a + (it.unreadable || 0), 0) + c.files.length;
  const wholeItems = c.items.reduce((a, it) => a + (it.files || 0), 0) + c.files.length;
  ok('precondition: the two numbers genuinely differ in this fixture', unreadable !== wholeItems,
     `unreadable=${unreadable} wholeItems=${wholeItems}`);
  ok('the producer offers an unreadable count worth using', unreadable === 2, `got ${unreadable}`);
  ok('and a whole-item count that must NOT be used', wholeItems === 5, `got ${wholeItems}`);

  // THE TWO ABOVE ARE ARITHMETIC THIS FILE DOES, so on their own they prove only that the
  // producer supplies both numbers. The completion screen's sum is inline rather than a named
  // function, so it is pinned at the source: a ratchet on WHICH FIELD it reduces over. Reading
  // `it.files` here is the defect, and it is one character from coming back.
  const sum = src.match(/const missingFiles = skipped\.length[\s\S]{0,160}?;/);
  ok('the completion headline reduces over the unreadable count',
     !!sum && /it\.unreadable/.test(sum[0]) && !/it\.files/.test(sum[0]),
     sum ? sum[0] : 'missingFiles expression not found in index.html');
}

// ── an escaped name survives exactly once ─────────────────────────────────
// The label is plain text so the dialog title can take it raw; the row escapes it. Both, and a
// name with an ampersand is the case that catches a double-escape.
{
  const g = [{ bucket: 'library', item: 'Bob & Ray', path: 'C:/x', unreadable: 1, files: 2,
               groupKey: 'src:q' }];
  ok('the label itself is plain text', F._sfDroppedLabel(g) === 'Bob & Ray sound font',
     F._sfDroppedLabel(g));
  const html = F._sfDroppedRowHtml(g, 'done');
  ok('and the row escapes it exactly once',
     html.includes('Bob &amp; Ray sound font') && !html.includes('&amp;amp;'), html);
}

// ── THE SUMMARY LINE DESCRIBES THE ARCHIVE, NOT THE LIBRARY ───────────────
// Third defect on the same screen and the same cause: the confirm screen quoted the pre-flight
// survey AFTER the user had agreed to drop items, and the completion repeated that text. Measured
// on a real export: 21 sources / 13 fonts on screen over an archive holding 20 and 12.
{
  const survey = {
    counts: { sources: 21, library: 13, common: 16, sharedTracks: 10, attachments: 3 },
    totals: { sources: 1000, library: 500, common: 300, sharedTracks: 100, attachments: 50 },
    totalBytes: 1950,
  };
  const adj = backup.applySkipAdjustment(survey, {
    skipped: [{ bucket: 'sharedTracks', name: 'a.wav', bytes: 10 },
              { bucket: 'sharedTracks', name: 'b.wav', bytes: 10 }],
    skippedItems: [{ bucket: 'sources', bytes: 400 }, { bucket: 'library', bytes: 200 }],
  });
  ok('a dropped item comes off its bucket count',
     adj.counts.sources === 20 && adj.counts.library === 12,
     JSON.stringify(adj.counts));
  ok('a skipped TRACK comes off the count, because that bucket counts files',
     adj.counts.sharedTracks === 8, JSON.stringify(adj.counts));
  ok('a bucket with nothing dropped is untouched',
     adj.counts.common === 16 && adj.counts.attachments === 3, JSON.stringify(adj.counts));
  ok('bytes come off the bucket total and the grand total',
     adj.totals.sources === 600 && adj.totalBytes === 1330,
     `${adj.totals.sources} / ${adj.totalBytes}`);
  ok('the survey it was given is not mutated',
     survey.counts.sources === 21 && survey.totalBytes === 1950,
     'the survey still drives the progress bar and the fit check');

  const none = backup.applySkipAdjustment(survey, {});
  ok('with nothing skipped the figures are unchanged',
     none.counts.sources === 21 && none.totalBytes === 1950, JSON.stringify(none.counts));
}

// ── THE BAR MEASURES WHAT WILL BE WRITTEN ─────────────────────────────────
// A REAL EXPORT WITH A REAL DROP. `skipPaths` is the same input the renderer hands over after the
// user agrees, so this exercises the whole path rather than the arithmetic alone — and the dropped
// item is never walked, so a bar measured against the raw survey can never reach its own total.
{
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-'));
  const SF2 = path.join(ud2, 'soundFonts');
  for (const name of ['Keep', 'Drop']) {
    const d = path.join(SF2, 'library', name);
    fs.mkdirSync(d, { recursive: true });
    // Different sizes, so a denominator that counted the wrong one is visible in the number.
    fs.writeFileSync(path.join(d, 'hum.wav'), Buffer.alloc(name === 'Drop' ? 4096 : 1024, 7));
    fs.writeFileSync(path.join(d, 'meta.json'),
      JSON.stringify({ schemaVersion: '1', name, entryUuid: `u-${name}` }, null, 2));
  }

  const seen = [];
  const dest = path.join(ud2, 'out.zip');
  // The only asynchronous check in the file; awaited just before the tally so its results are
  // counted rather than reported after the process has already decided its exit code.
  barCheck = (async () => {
    const res = await backup.exportBackup({
      userData: ud2, destPath: dest, appVersion: 'test',
      skipPaths: [path.join(SF2, 'library', 'Drop', 'hum.wav')],
      onProgress: (p) => {
        if (typeof p.totalBytes === 'number' && p.totalBytes > 0) seen.push(p.totalBytes);
      },
    });
    ok('precondition: the export really dropped the item',
       (res.skippedItems || []).some(i => i.top === 'Drop'), JSON.stringify(res.skippedItems));
    ok('precondition: progress was actually reported', seen.length > 0, `${seen.length} emits`);

    const manifestTotal = res.manifest.totals.totalBytes;
    const distinct = [...new Set(seen)];
    ok('THE BAR AND THE MANIFEST QUOTE ONE TOTAL',
       distinct.length === 1 && distinct[0] === manifestTotal,
       `bar totals ${JSON.stringify(distinct)} vs manifest ${manifestTotal}`);
    ok('and that total excludes the dropped item, so the bar can finish',
       manifestTotal < 4096 + 1024, `${manifestTotal}`);

    try { fs.rmSync(ud2, { recursive: true, force: true }); } catch {}
  })();
}

// ── ONE SENTENCE, ONE RULE ────────────────────────────────────────────────
// The two summary lines drifted because each was written out longhand. Source-pinned on purpose:
// the defect is a SECOND COPY appearing, which no behavioural test on either line can see.
{
  // ONE construction of the sentence, and it is the builder's own body. A second match is a
  // screen writing it out longhand again, which is exactly how the two came apart.
  const built = src.match(/`Library: \$\{[^`]*source\$\{/g) || [];
  ok('the summary sentence is constructed in exactly one place',
     built.length === 1,
     `${built.length} constructions: ${built.join(' | ')}`);
  ok('there is exactly one builder for it',
     (src.match(/const _sfLibrarySummary = /g) || []).length === 1);
  ok('and both screens call it',
     (src.match(/_sfLibrarySummary\(/g) || []).length >= 3,
     'one definition plus a call on the confirm screen and a call on the completion screen');

  // The completion must read the MANIFEST. Reading `survey` there is the original defect.
  const completion = src.match(/const summaryLine = [\s\S]{0,400}?const message/);
  ok('the completion summary is built from the manifest',
     !!completion && /_mf\.counts/.test(completion[0]) && /_mf\.totals/.test(completion[0]),
     completion ? completion[0] : 'completion summaryLine not found');
}

// ── the confirm screen uses the adjusted figure once a skip is agreed ─────
{
  ok('the confirm screen prefers prep.adjusted when something was skipped',
     /_bkSkipPaths\.length && prep && prep\.adjusted\) \? prep\.adjusted : survey/.test(src),
     'without the skip guard an ordinary export would read a figure that does not exist');

  const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  ok('main builds it with the same function the manifest uses',
     /applySkipAdjustment\(survey,\s*\n?\s*\{ skipped: consequence\.files, skippedItems: consequence\.items \}\)/
       .test(mainSrc),
     'two copies of this arithmetic is how the promise and the report came apart');

  // The loose-file half of that input needs bytes, and it had none: describeSkipConsequence
  // returned the raw probe records. An adjustment over byteless files silently subtracts zero.
  const c = backup.describeSkipConsequence(ud, [
    { path: P('sharedTracks', 'loose.wav'), code: 'EPERM' },
  ]);
  ok('precondition: the loose file is classified as a file, not an item',
     c.files.length === 1 && c.items.length === 0);
  ok('and it carries the bucket and bytes the adjustment needs',
     c.files[0].bucket === 'sharedTracks' && typeof c.files[0].bytes === 'number',
     JSON.stringify(c.files[0]));
}

barCheck
  .catch((e) => ok('the progress-total export completed', false, String(e && e.message || e)))
  .then(() => {
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
    console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });

/**
 * A whole-list write needs a whole-list read  [B-377]
 *
 * 2026-09-12 23:50: "deleted a favorite. reordered, favorite came back." Eleven cards
 * after the delete, twelve after a drag, with "Baylan Skoll v2.2" restored.
 *
 * THE SHAPE. The delete patched the DOM — remove the card, drop the path from the Set
 * — and left `present`, the array the render closure was built from, still holding the
 * deleted favourite. The drop handler then built its new order from `present` and
 * called reorderFavorites with it. That API takes a COMPLETE list, so writing a stale
 * one is not a reorder: it is a restore.
 *
 * ⚠️ THE PART WORTH REMEMBERING: the drop handler ALREADY called getFavorites(), and
 * used the result only for the missing-file paths. So it read current truth for one
 * half of a list it wrote whole, and stale truth for the other. Code that looks
 * careful — it does fetch! — while being wrong in exactly the half that matters.
 *
 * ⭐ SAME CLASS AS [B-371] one layer up: an action computing from a snapshot another
 * action already invalidated. There it was editor coordinates; here it is a list. Both
 * fixes are the same move — derive from the store at the moment of the write, so there
 * is no snapshot left to go stale.
 *
 * Run: node test/favorites-reorder-freshness.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── A. the bug, as arithmetic ──────────────────────────────────────────────
//
// Modelled rather than mocked: the defect is entirely in WHICH array is written, so a
// faithful model of the two handlers proves it without an Electron harness.
{
  const store = () => ([
    { filePath: 'a.h', exists: true }, { filePath: 'b.h', exists: true },
    { filePath: 'c.h', exists: true }, { filePath: 'gone.h', exists: false },
  ]);

  // The OLD pair: delete mutates nothing the drop reads, drop writes from the snapshot.
  const oldWay = () => {
    let db = store();
    const present = db.filter(i => i.exists);          // captured at render
    db = db.filter(i => i.filePath !== 'b.h');         // the delete
    const reordered = [...present];                    // stale
    const [moved] = reordered.splice(0, 1);
    reordered.splice(2, 0, moved);
    const missing = db.filter(i => !i.exists).map(i => i.filePath);
    return [...reordered.map(p => p.filePath), ...missing];   // written whole
  };

  // The NEW pair: the drop reads the store it is about to write.
  const newWay = () => {
    let db = store();
    db = db.filter(i => i.filePath !== 'b.h');         // the delete
    const all = db;                                    // getFavorites() at drop time
    const live = all.filter(i => i.exists);
    const srcIdx = live.findIndex(p => p.filePath === 'a.h');
    const tgtIdx = live.findIndex(p => p.filePath === 'c.h');
    if (srcIdx === -1 || tgtIdx === -1) return null;
    const reordered = [...live];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);
    const missing = all.filter(i => !i.exists).map(i => i.filePath);
    return [...reordered.map(p => p.filePath), ...missing];
  };

  const before = oldWay();
  ok('THE BUG: the deleted favourite is written back', before.includes('b.h'), before.join(', '));
  ok('and the list grows back to its old length', before.filter(p => p !== 'gone.h').length === 3);

  const after = newWay();
  ok('THE FIX: the deleted favourite stays deleted', !after.includes('b.h'), after.join(', '));
  ok('the reorder still actually reorders', after.indexOf('a.h') > after.indexOf('c.h'),
     after.join(', '));
  ok('missing files are still preserved at the end',
     after[after.length - 1] === 'gone.h', after.join(', '));

  // ⚠️ A drag whose source or target vanished cannot be placed. Writing a whole list
  // while unable to locate one of its members is how the resurrection happened.
  const vanished = (() => {
    const all = store().filter(i => i.filePath !== 'a.h');
    const live = all.filter(i => i.exists);
    return live.findIndex(p => p.filePath === 'a.h');
  })();
  ok('a vanished drag source is not found, so the write is refused', vanished === -1);
}

// ── B. the handlers actually do this ───────────────────────────────────────
{
  // ⚠️ ANCHOR ON SOMETHING UNIQUE. The first draft sliced from the first
  // `card.addEventListener('drop'` in the file and landed on the STYLE card's drop
  // handler — a different feature entirely — then reported three failures about code
  // this entry never touched. There are two of each of these anchors; `reorderFavorites`
  // appears once, so the region is found backwards from the call being asserted about.
  const reorderAt = html.indexOf('electronAPI.reorderFavorites');
  ok('the favourites drop handler was located', reorderAt > 0);
  const drop = html.slice(Math.max(0, reorderAt - 1800), reorderAt + 400);

  // ⚠️⚠️ AN ORDERING ASSERTION MUST READ CODE, NOT COMMENTARY, AND THIS ONE DID NOT.
  // It compared indexOf('getFavorites()') against indexOf('findIndex') over the raw
  // slice. The `6a1d59c` fix added a comment explaining the race — "...gives null,
  // findIndex returns -1, and the guard below..." — and that sentence sits ABOVE the
  // fetch. So indexOf found the word in the prose, concluded the call came first, and
  // the entry's own suite went red against correct code. The commit that fixed the bug
  // broke its own test by explaining itself.
  //
  // Same family as the anchor warning above: a static test is only as good as the text
  // it selects, and comments are text. Strip them before asking about order.
  // ⚠️ `[^\r\n]*`, NOT `.*$`. index.html is CRLF, and `.` does not match `\r` while an
  // unanchored-by-`m` `$` demands end of STRING — so `/\/\/.*$/` matched nothing at all
  // on a line ending in `\r`, and the first version of this stripper silently stripped
  // no line comments whatsoever. A comment-remover that removes no comments looks
  // exactly like one that works, right up until the assertion it feeds reads prose.
  const codeOnly = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');
  const dropCode = codeOnly(drop);
  ok('the drop fetches before computing indices',
     dropCode.indexOf('getFavorites()') >= 0
     && dropCode.indexOf('getFavorites()') < dropCode.indexOf('findIndex'),
     'getFavorites must come first — it is the list being written');
  ok('the drop derives its order from the fetch, not the snapshot',
     /const live = allItems\.filter/.test(drop) && /\[\.\.\.live\]/.test(drop), drop.slice(0, 200));
  ok('the drop no longer builds from `present`', !/\[\.\.\.present\]/.test(drop));
  ok('an unplaceable drag refuses and re-renders',
     /if \(srcIdx === -1 \|\| tgtIdx === -1\) \{ await refreshEmptyStateFavs\(\); return; \}/.test(drop));

  // The delete must re-render rather than patch the DOM, or `present` goes stale again
  // the moment anyone adds a second reader of it.
  // Same anchoring care: `removeFavorite(filePath)` inside the favourites card click.
  const delAt = html.indexOf('[B-377] This used to patch the DOM by hand');
  ok('the favourites delete handler was located', delAt > 0);
  const del = html.slice(delAt, delAt + 1200);
  ok('the delete re-renders', /await refreshEmptyStateFavs\(\);/.test(del));
  ok('the delete no longer hand-patches the DOM',
     !/card\.remove\(\);/.test(del) && !/favoritePaths\.delete\(/.test(del), del.slice(0, 300));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall favourites freshness tests passed');
process.exit(failures ? 1 : 0);

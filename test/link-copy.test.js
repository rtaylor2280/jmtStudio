// A copy that keeps hard links as hard links [B-503], checked with the three assertions [B-498]
// will use: same path -> content, same folders (an empty one too), same sharing. The control is
// an ordinary copy, which keeps content and folders and loses the sharing; if the third check
// cannot tell those apart it is not a check.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../fsLinkCopy.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-lcopy-${n}-`));

// a.wav, b.wav and sub/c.wav are one file under three names; d.wav stands alone; e/ is empty.
function buildCorpus() {
  const root = tmp('src');
  fs.writeFileSync(path.join(root, 'a.wav'), Buffer.alloc(4096, 1));
  fs.linkSync(path.join(root, 'a.wav'), path.join(root, 'b.wav'));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.linkSync(path.join(root, 'a.wav'), path.join(root, 'sub', 'c.wav'));
  fs.writeFileSync(path.join(root, 'd.wav'), Buffer.alloc(2048, 2));
  fs.mkdirSync(path.join(root, 'e'));
  return root;
}

(async () => {
  const dirs = [];
  const src = buildCorpus(); dirs.push(src);
  const before = L.treeSignature(src);
  check('the corpus really shares: three names, one file', [...before.groups].some((g) => g.split('|').length === 3),
        JSON.stringify([...before.groups]));

  console.log('the link-keeping copy');
  {
    const out = path.join(tmp('dst'), 'copy'); dirs.push(path.dirname(out));
    const r = await L.copyTreePreservingLinks(src, out);
    check('it succeeds and says links were kept', r.ok && r.linksPreserved === true, JSON.stringify(r));
    check('one copy written, two linked', r.copied === 2 && r.linked === 2, JSON.stringify({ c: r.copied, l: r.linked }));
    const cmp = L.compareTreeSignatures(before, L.treeSignature(out));
    check('content, folders and sharing all match', cmp.same, cmp.problems.join('; '));
  }

  console.log('control: an ordinary copy');
  {
    const out = path.join(tmp('ctl'), 'copy'); dirs.push(path.dirname(out));
    fs.cpSync(src, out, { recursive: true });
    const cmp = L.compareTreeSignatures(before, L.treeSignature(out));
    check('content and folders still match', cmp.sameContent, cmp.problems.join('; '));
    check('the sharing check catches the expanded links', cmp.sameSharing === false, cmp.problems.join('; '));
  }

  console.log('a destination that cannot hold links');
  {
    const out = path.join(tmp('fat'), 'copy'); dirs.push(path.dirname(out));
    const noLinks = async () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; };
    const r = await L.copyTreePreservingLinks(src, out, { linkFn: noLinks });
    check('it still succeeds, with full copies', r.ok && r.copied === 4 && r.linked === 0, JSON.stringify(r));
    check('and says the sharing was not kept', r.linksPreserved === false);
    const cmp = L.compareTreeSignatures(before, L.treeSignature(out));
    check('every file is there with the right content', cmp.sameContent, cmp.problems.join('; '));
  }

  console.log('what it refuses');
  {
    const busy = tmp('busy'); dirs.push(busy);
    fs.writeFileSync(path.join(busy, 'keep.txt'), 'mine');
    const r1 = await L.copyTreePreservingLinks(src, busy);
    check('a destination that is not empty', !r1.ok && fs.readFileSync(path.join(busy, 'keep.txt'), 'utf8') === 'mine', JSON.stringify(r1));
    const r2 = await L.copyTreePreservingLinks(src, path.join(src, 'inner'));
    check('a destination inside the source', !r2.ok && !fs.existsSync(path.join(src, 'inner')), JSON.stringify(r2));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });

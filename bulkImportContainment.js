// ⭐⭐ THE FULL SOURCE WINS. [B-415]
//
// His rule, 2026-09-19: "it's really the full source wins. duplicate font but one has more stuff
// around it... that wins." And the case that produced it, both paths handed over by him and
// measured rather than imagined:
//
//   G:\...\Original Font Files\1.2-lightsaber of the  bells   213 files  291 MB
//        top level: GoldenHarvest, Verso, asteria, cfx, proffie, xenopixelv3
//   D:\Desktop\lightsaber of the bells                         32 files   20 MB
//        top level: the CONTENTS of that proffie folder - hum01.wav, blst/, clsh/, config.ini
//
//   29 distinct hashes in the desktop copy. 29 of them present in the original. ZERO unique to it.
//   100% contained, with five other board flavors sitting alongside in the package it came from.
//
// ⚠️⚠️ EQUALITY CANNOT SEE THIS AND NEVER WILL. Those two sources share no contentHash - one
// digest covers 213 files, the other covers 32 - so the intra-batch twin check ([B-314], and its
// [B-415] extension to contentHash) finds nothing, and BOTH import. His words: "those would both
// import and be called identical fonts." The relationship is CONTAINMENT, not equality, and it is
// the normal shape of a real folder rather than an exotic one: a full download kept for reference
// plus the one font somebody pulled out of it to actually use.
//
// ⚠️ WHY NOT COMPARE THE DETECTED FONTS INSTEAD. detectCandidates knows exactly this - it reports
// `{name:'Electro', path:'Proffie', multiBoard:true, otherFlavors:['Asteria','cfx',...]}` - but it
// runs at COMMIT, after the user has decided, while the twin check runs during ANALYZE. Asking for
// it earlier means a detection pass over every staged source in the batch. The file hashes are
// already in hand from the contentHash pass, so this answers the same question for free.
// ⭐ THAT FREENESS IS THE POINT. [B-415] said to look for the cheap path before building the
// expensive one, because a second walk over extracted content is precisely what [B-398] spent a
// day making yield so the window would stop freezing. Nothing here touches the disk.
'use strict';

// ⚠️ A DEFENSIVE CEILING ON THE PAIRWISE WORK, not a correctness knob. The comparison below is
// driven by an inverted index, so it only ever looks at sources that actually share a file - but a
// batch of voicepacks is thousands of sources sharing hundreds of identical wavs each, and that is
// the shape that turns "only what shares" into everything. If a single file is this widely shared
// it says nothing about whose package is fuller, so skipping it loses no signal.
const MAX_POSTINGS = 400;

/**
 * Rank sources against each other by containment.
 *
 * @param {Array<{idx:number, hashes:string[]}>} sources
 * @returns {Map<number, {container:number, contained:number, of:number}>}
 *   keyed by the LOSING idx - the source whose content is wholly inside another's.
 */
function rankByContainment(sources) {
  const list = (sources || []).filter(s => s && Array.isArray(s.hashes) && s.hashes.length);
  const out = new Map();
  if (list.length < 2) return out;

  const sets = new Map();
  for (const s of list) sets.set(s.idx, new Set(s.hashes));

  // hash -> the sources holding it. Only sources sharing at least one file are ever compared.
  const index = new Map();
  for (const s of list) {
    for (const h of sets.get(s.idx)) {
      let p = index.get(h);
      if (!p) index.set(h, (p = []));
      p.push(s.idx);
    }
  }

  // For each source, how many of ITS files each other source also has.
  const overlap = new Map();
  for (const [, postings] of index) {
    if (postings.length < 2 || postings.length > MAX_POSTINGS) continue;
    for (const a of postings) {
      let row = overlap.get(a);
      if (!row) overlap.set(a, (row = new Map()));
      for (const b of postings) {
        if (a === b) continue;
        row.set(b, (row.get(b) || 0) + 1);
      }
    }
  }

  for (const [a, row] of overlap) {
    const sizeA = sets.get(a).size;
    let best = null;
    for (const [b, shared] of row) {
      // ⚠️⚠️ EVERY ONE OF A's FILES MUST BE IN B. A partial overlap is NOT containment: two fonts
      // from the same creator share a font.wav and a readme without either being a copy of the
      // other, and discarding a source over that would lose a font the user owns.
      if (shared !== sizeA) continue;
      const sizeB = sets.get(b).size;
      // ⚠️ STRICTLY FULLER, so mutual containment - the exact-twin case, identical sets - is NOT
      // decided here. That is [B-314]'s job and it has its own tie-break; deciding it in both
      // places is how two mechanisms come to disagree.
      if (sizeB <= sizeA) continue;
      if (!best || sizeB > best.size || (sizeB === best.size && b < best.idx)) best = { idx: b, size: sizeB };
    }
    // ⚠️ The largest container wins, and ties break on the lower index so the outcome never
    // depends on the order the folder happened to be walked in.
    if (best) out.set(a, { container: best.idx, contained: sizeA, of: best.size });
  }

  // ⚠️⚠️ NO CHAINS. If A is inside B and B is inside C, B has been marked a loser - and A must not
  // be held back in favour of a source that is itself being discarded. Re-point A at the survivor.
  for (const [a, info] of out) {
    let c = info.container, guard = 0;
    while (out.has(c) && guard++ < 16) c = out.get(c).container;
    if (c !== info.container) out.set(a, { ...info, container: c, of: sets.get(c).size });
  }
  return out;
}

module.exports = { rankByContainment, MAX_POSTINGS };

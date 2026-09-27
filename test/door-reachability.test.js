// A progress channel with no consumer is a measurement nobody shows.  [B-389, B-435]
//
// ⚠️⚠️ THIS FILE EXISTS BECAUSE OF WHAT AUDITING PROGRESS BARS TURNED UP, WHICH IS NOT WHERE
// ANYONE WOULD LOOK FOR IT. Three IPC channels were being emitted with nothing subscribed. Two of
// them belonged to doors nothing could invoke - `sources:extractTo` and `soundFonts:importFont`,
// each with a handler, a preload bridge and zero callers, and `git log -S` said neither ever had
// one. Both were REMOVED 2026-09-26 [B-434]: one wrote to the pre-library layout and the other
// duplicated a capability `sources:import` already owns.
//
// ⭐⭐ AND THE REASON THAT MATTERED WAS NOT THE DEAD CODE. `sources:extractTo` was named by
// export-door-map, import-door-map AND export-cancel as a live door, and on 2026-09-20 it was
// given a cancel it had been missing. A hardening pass and three maps spent on a door nobody
// could open, every test green - because they check MAIN-SIDE properties (the handler exists, it
// runs under the cancel gate) and not one of them asked whether a user can reach it.
//
// ⭐ SO WHAT THIS FILE KEEPS DOING, now that those two are gone: it watches the channel that is
// still orphaned, and it will not let the removed ones come back unnoticed. A send() with no
// listener fails silently - no error, no warning - so nothing else in the suite can see it.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const main    = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

// Every renderer file, so "no consumer" means nowhere rather than not-in-the-file-I-opened.
const rendererDir = path.join(root, 'renderer');
const rendererText = fs.readdirSync(rendererDir)
  .filter((f) => /\.(js|html)$/i.test(f))
  .map((f) => fs.readFileSync(path.join(rendererDir, f), 'utf8'))
  .join('\n');

// ── 1. The removed doors stay removed ────────────────────────────────
//
// ⚠️ NOT HOUSEKEEPING. Re-adding either handler without a renderer caller rebuilds exactly the
// state that cost a cancel and three map entries: something that looks covered and cannot be
// reached. If one is genuinely wanted, it arrives WITH its caller and this entry comes out.
const REMOVED = {
  'soundFonts:importFont': 'wrote to userData/soundFonts/<name>, the pre-library layout; '
                         + 'superseded by sources:import + createEntry',
  'sources:extractTo':     'the extractTo MODULE method is alive and used in four places; only '
                         + 'this user-facing door was never built',
};
for (const [handler, why] of Object.entries(REMOVED)) {
  ok(`${handler} is still gone`, !main.includes(`ipcMain.handle('${handler}'`),
     `it is back. If that is deliberate it needs a renderer caller and door-map coverage in the `
     + `same change, or it is unreachable again. (removed because: ${why})`);
}

// ── 2. Channels emitted with nobody listening ────────────────────────
//
// `bulkImport:enrichProgress` is the live one, and it is [B-389]'s own known instance: the bulk
// analyze bar stalls short because the enrich phase reports to a channel no renderer subscribes
// to. That is [B-435]. Adding a sub-percent to the emitter would have changed nothing.
const ORPHAN_CHANNELS = {
  'bulkImport:enrichProgress':
    'the operation IS reachable, so this is a genuinely missing consumer rather than a dead '
    + 'door - [B-435]. Fixing it means subscribing, which trips this assertion; clearing this '
    + 'entry is part of that fix.',
};

for (const [channel, note] of Object.entries(ORPHAN_CHANNELS)) {
  if (!main.includes(`'${channel}'`)) { ok(`${channel} is no longer emitted`, true); continue; }
  // What decides is whether a RENDERER subscribes - a preload bridge can exist unused.
  const bridge = (preload.match(new RegExp(`(\\w+)\\s*:\\s*\\(cb\\)[^}]*?'${channel}'`, 's')) || [])[1];
  const consumed = bridge ? new RegExp(`\\b${bridge}\\s*\\(`).test(rendererText) : false;
  ok(`${channel} still has no renderer consumer`, !consumed,
     `a consumer appeared - that is the fix, so remove this entry. (${note})`);
}

// ── 3. No NEW channel may be emitted with nothing listening ──────────
//
// ⭐ The generalisation, and the reason this file is worth more than its three assertions: the
// two dead doors were found by noticing an emit with no listener. This catches the next one
// instead of waiting for another audit to stumble over it.
const emitted = new Set(
  (main.match(/\.send\('([A-Za-z]+:[A-Za-z]+Progress)'/g) || [])
    .map((s) => s.replace(/^.*\.send\('/, '').replace(/'$/, ''))
);
for (const channel of [...emitted].sort()) {
  if (channel in ORPHAN_CHANNELS) continue;
  const bridge = (preload.match(new RegExp(`(\\w+)\\s*:\\s*\\(cb\\)[^}]*?'${channel}'`, 's')) || [])[1];
  ok(`${channel} has a renderer consumer`,
     !!bridge && new RegExp(`\\b${bridge}\\s*\\(`).test(rendererText),
     bridge ? `${channel} is bridged as ${bridge} and no renderer subscribes to it. Either wire `
              + `a consumer or stop emitting - a progress event nobody receives is invisible at `
              + `runtime and costs a phase its bar.`
            : `${channel} is emitted but preload does not bridge it at all, so no renderer could `
              + `receive it even if one tried.`);
}

console.log(`\ndoor-reachability: ${failed === 0 ? 'all passing' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);

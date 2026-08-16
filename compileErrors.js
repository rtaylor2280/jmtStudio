// Compile-failure summarisation. Pure text in, pure text out - no fs, no child
// process, no electron - which is the entire reason it lives in its own file.
//
// It used to live in toolchain.js, and test/compile-error-extract.test.js could
// not require toolchain (cacheManager pulls in electron), so the test carried its
// OWN COPY of every function below. That copy passed while the real one failed:
// on 2026-08-15 a genuine FLASH overflow reached the user as
//     .../ld.exe: region…
//     collect2.exe: error: ld returned 1 exit status
// with the byte count clipped away, and the suite was green the whole time.
//
// A test that reimplements the thing it tests is testing itself. One owner,
// imported by both. (2026-08-15)

'use strict';

const _ANSI_RE = /\[[0-9;]*[A-Za-z]/g;
function _stripAnsi(s) { return String(s).replace(_ANSI_RE, ''); }

// g++ invocation - every -D, every -I - on ONE line, so a naive tail slice is
// thousands of characters of include paths. These are never the reason a build
// failed, so they are never the summary.
const _CMD_ECHO_RE = /^>|-mcpu=|\/bin\/arm-none-eabi-|[\\/]ctags/;

// Lines that do carry a reason when no compiler diagnostic was produced at all.
const _FAILURE_SIGNAL_RE = new RegExp([
  'Error during build', 'fatal error', 'undefined reference', 'overflowed by',
  'will not fit', 'collect2', 'internal compiler error', 'cc1plus', 'Killed',
  'out of memory', 'std::bad_alloc', 'lto-wrapper',
  'No such file or directory', 'Invalid FQBN', 'not installed',
].join('|'), 'i');

// The compile failed but produced no `error:` diagnostic. The old fallback
// returned the last ten non-empty lines verbatim, which for an arduino-cli
// failure is its own post-failure "Used library / Used platform" table plus the
// echoed compiler command - presented to the user as the reason their build
// failed. Prefer lines that state a reason, drop command echoes, and clip.
// (2026-08-12)
// Toolchain diagnostics arrive prefixed with the full path to the tool that
// produced them, and that path is longer than the message. The real case:
//
//   C:/Users/.../arm-none-eabi/bin/ld.exe: region `FLASH' overflowed by 167560 bytes
//   ^------------------ 174 chars ------------------^ ^------ 41 chars ------^
//
// Clipping at 180 from the front therefore spent the whole budget on the path
// and cut the answer off one word early - the user saw "…/ld.exe: region…" on
// the one failure where the byte count is the entire point.
//
// Deliberately narrow: only strips when the path ends in an EXECUTABLE (.exe,
// or a bare `ld`/`collect2` on POSIX). A source diagnostic like
// `C:\...\my_config.h:431:1: error: …` must never match, or the summary would
// lose the file the user has to open. (2026-08-15)
const _TOOL_PATH_PREFIX_RE =
  /^(?:[A-Za-z]:)?[\\/][^\s]*?[\\/](?:ld|collect2|[^\\/\s]+\.exe):\s+/i;
function _stripToolPathPrefix(line) {
  return line.replace(_TOOL_PATH_PREFIX_RE, '');
}

function _fallbackFailureSummary(lines) {
  const MAX = 180;
  const clip = l => (l.length > MAX ? l.slice(0, MAX) + '…' : l);
  const usable = lines.filter(l =>
    l.trim() && !_CMD_ECHO_RE.test(l)
    // Was applied in extractCompileError only. This is the path an ld failure
    // actually takes, since "region `FLASH' overflowed" says neither "error"
    // nor "warning" - so the exit-status line reached the summary here even
    // though a comment three lines below explains why it must not. (2026-08-15)
    && !_LD_EXIT_NOISE_RE.test(l)
  );
  // NOT filtered here: `Error during build: exit status 1`. It is noise whenever
  // a real reason exists, but when arduino-cli reports nothing else it is the
  // only thing we can honestly say - and a test pins that. Dropping it wholesale
  // replaced a thin answer with no answer. (2026-08-15)
  const signal = usable.filter(l => _FAILURE_SIGNAL_RE.test(l));
  const picked = (signal.length ? signal : usable)
    .slice(-3)
    .map(l => clip(_stripToolPathPrefix(l.trim())));
  if (!picked.length) return 'The compiler stopped without reporting a reason.';
  return picked.join('\n');
}

// `collect2: error: ld returned 1 exit status` matches ` error: ` but is only the
// linker's exit announcement - the REASON is the line above it, e.g. "region
// `FLASH' overflowed by 5400 bytes", which says neither "error" nor "warning".
// Left in, it won the summary slot and hid the byte count on exactly the failure
// a flash-tight V2 owner most needs to read. (2026-08-12)
const _LD_EXIT_NOISE_RE = /collect2[^:]*:\s*error:\s*ld returned/i;

// ── Translated failures ────────────────────────────────────────────────────
//
// FIRST MIGRATED SIGNATURE of the error-translation matrix. The wording and the
// measurements below are not invented here - they come from `flash-overflow` in
// local/crucible/error-translations.js, which carries 44 signatures derived from
// ~180 real broken-config compiles, and whose own note reads "Backlogged as
// SURFACE THE OUT-OF-SPACE ERROR. We hold the measured numbers for the fix."
//
// It lives HERE rather than being required from local/ because local/ is not in a
// packaged build. Wiring the whole matrix in means deciding where 44 signatures
// live in a shipping app and how the git-hosted update path reaches them - real
// work, deliberately not done at once. When that lands, this function is the
// thing it replaces; do not let a second copy of these numbers appear meanwhile.
//
// WHY THIS ONE FIRST: it is the failure the per-plugin work exists for. Someone
// on a flash-tight V2.2 who picks an older Proffieboard Plugin to save space is
// exactly the person who hits this, and what they got was:
//   collect2.exe: error: ld returned 1 exit status
// (2026-08-15)
const _FLASH_OVERFLOW_RE = /region [`'"]?FLASH['"`]? overflowed by (\d+) bytes/i;

// Every number here is MEASURED, none derived.
//
// An earlier draft also quoted "one distinct style costs roughly 7,600 bytes,
// a preset about 24" from the translation corpus. Those are averages over ~180
// other people's configs, and printing them beside this user's byte count reads
// as a statement about THIS build. It is not one. Dropped.
//
// The capacity is likewise not computed. `used = capacity + overflow` is exact
// on a Proffieboard V2, where boards.txt (262,144) and the linker's FLASH region
// agree - but on a V3 they differ by 16 KB (507,904 vs 524,288), and the overflow
// is measured against the linker's. So the total would be quietly 16 KB light on
// the most common board. Report the two figures that were measured and let the
// reader add them. (2026-08-15)
function _translateKnownFailure(text, ctx) {
  const m = text.match(_FLASH_OVERFLOW_RE);
  if (!m) return null;
  const n     = Number(m[1]);
  const over  = n.toLocaleString('en-US');
  // With the capacity line below, "over." needs no object - the next line names
  // the board and the limit. Without it, the sentence has to carry its own.
  const lines = [(ctx && ctx.maxFlash)
    ? `Config overflow: ${over} bytes over.`
    : `Config overflow: ${over} bytes over the board's flash.`];
  if (ctx && ctx.maxFlash) {
    const cap = Number(ctx.maxFlash);
    // `used` is the one derived figure here, and it is exact wherever boards.txt
    // and the linker's FLASH region agree - which they do on the V1 and V2
    // (262,144 both). On a V3 they differ by 16 KB (507,904 vs 524,288) and the
    // overflow is measured against the linker's, so this understates a V3 by
    // that much. Conservative direction, and it only arises on a config over
    // 524 KB. Recorded rather than hidden. (2026-08-15)
    // "Using X of Y available" contradicts itself - you cannot use more than is
    // available, and "of Y available" sets Y up as the pool being drawn from. A
    // reader stops on it and wonders whether the numbers are backwards. "Needs"
    // can exceed available; "using" cannot. And it takes a subject, or it is a
    // fragment the reader has to complete. (2026-08-15)
    lines.push(`Your config needs ${(cap + n).toLocaleString('en-US')} bytes. `
             + `${ctx.boardName} holds ${cap.toLocaleString('en-US')}.`);
  }
  // A BLANK LINE is how a message asks for separation. The renderer turns it into
  // a margin rather than an empty row, so the message states WHERE the break is
  // and the display decides what it costs. Messages without one are untouched.
  lines.push('', 'Reduce preset count or reuse styles across presets to fit.');
  return lines.join('\n');
}

function extractCompileError(raw, ctx) {
  const lines = _stripAnsi(raw).split(/\r?\n/);
  // Checked before the generic paths: when we can say what a failure MEANS, the
  // compiler's own phrasing adds nothing. `ctx` carries facts the text cannot
  // supply - board capacity is never printed on a FAILED link - and is optional,
  // so every existing caller and test keeps working without it. (2026-08-15)
  const translated = _translateKnownFailure(lines.join('\n'), ctx);
  if (translated) return translated;
  const errorLines = lines.filter(l =>
    / error: /.test(l) && !/ note: /.test(l) && !l.startsWith('>')
      && !_LD_EXIT_NOISE_RE.test(l)
  );
  if (!errorLines.length) {
    return _fallbackFailureSummary(lines);
  }
  const MAX_MSG = 180;
  const summarize = (line) => {
    const m = line.match(/^(?:.*[\\/])?([^\\/:]+):(\d+)(?::\d+)?:\s+error:\s+(.*)$/);
    if (!m) {
      return line.length > MAX_MSG ? line.slice(0, MAX_MSG) + '…' : line;
    }
    const file = m[1];
    const ln   = m[2];
    let msg    = m[3];
    if (msg.length > MAX_MSG) msg = msg.slice(0, MAX_MSG) + '…';
    return `${file}:${ln} — ${msg}`;
  };
  const summary = errorLines.slice(0, 3).map(summarize).join('\n');
  const moreCount = errorLines.length - 3;
  return moreCount > 0
    ? `${summary}\n…and ${moreCount} more (full output in Build Output panel)`
    : summary;
}


module.exports = {
  extractCompileError,
  _stripAnsi,
  // Exported for tests only - each is a rule that has been got wrong once.
  _fallbackFailureSummary,
  _stripToolPathPrefix,
  _translateKnownFailure,
};

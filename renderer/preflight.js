/**
 * PREFLIGHT CHECK REGISTRY  [B-224]
 *
 * The thesis, 2026-08-24, and it is not decoration: "a preflight check is cheap and
 * a compile fail costs our users time and potential confusion. the more we can help
 * guide before a compile check the better our messaging gets and we become more
 * helpful when it matters."
 *
 * WHY THIS EXISTS RATHER THAN A FOURTH HAND-WRITTEN GATE. There were three, chained
 * by hand in doCompile, each parsing the config itself and each owning its own
 * dialog. The entry predicted where that ends — "add five and every new check is an
 * edit to the compile path" — and it was right: [B-365] was built as the third one
 * on 2026-09-12 without anyone reading this. Adding a check should be adding to a
 * list.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 *
 * A check is data:
 *
 *     { id, severity, title, run(ctx) }
 *
 *   severity   'block' — the compile cannot succeed.
 *              'warn'  — it compiles, and something is wrong afterwards.
 *
 *   ⚠️ SEVERITY NAMES THE CONSEQUENCE OF IGNORING, NOT THE IMPORTANCE, and the
 *   entry is emphatic that this ranks them BACKWARDS if you let it. A build
 *   failure costs minutes at the desk with an error pointing at it. A config that
 *   compiles and misbehaves is found after flashing, with the saber closed up,
 *   possibly by a customer, with nothing in the world to mention it. The ignorable
 *   class is the expensive one.
 *
 *   run(ctx) returns one of THREE answers, and the third is the one that matters:
 *
 *     null                     nothing wrong.
 *     { findings: [...] }      these things are wrong.
 *     { unsure: 'reason' }     I cannot tell, so say nothing.
 *
 *   ⭐ "I CANNOT TELL" IS A FIRST-CLASS ANSWER (settled 2026-09-12: "I really
 *   don't ever want to be wrong"). A check that is only mostly right is worse than
 *   no check: one false positive costs the user time AND teaches them the gate is
 *   noise, after which it stops working even when it is right. Measured precedent,
 *   same day: the blade-count rule blocked 3 of 173 real configs that compile fine,
 *   because it trusted a single reading of the parse. Silence is always available
 *   and always cheap. USE IT.
 *
 * A finding is:
 *
 *     { title, detail, items, fix }
 *
 *   ⭐ THE ROW IS THE FINDING, NOT THE ITEM. One finding may cover 58 presets; it
 *   is still one row with one fix. Splitting it per item turns a real 58-preset
 *   voicepack case into 58 clicks.
 *
 *   fix is optional: { label, plan(ctx) -> [edits] }. Remediation lives WITH its
 *   finding, in the row — never as a button at the bottom of the dialog. Two
 *   checks that both offer a fix would otherwise both want the same button.
 *
 * ⚠️ EVERY FIX THE USER ACCEPTS IS APPLIED AS ONE ATOMIC BATCH, by the caller, and
 * that is a property of the mechanism rather than a courtesy. Edits are computed
 * against the document as it is NOW; apply one fix and the coordinates the next
 * fix computed are stale. That exact failure corrupted a config on 2026-09-12
 * ([B-371]) from a single writer. With N checks it would be the normal case.
 *
 * ── WHAT A CHECK MAY NOT DO ────────────────────────────────────────────────
 *
 * CONFIG ONLY. Never inspect the SD card or the sound font library. At compile
 * time we cannot see the card, and an unverifiable warning is noise. That rule was
 * cut into the voicepack check twice by hand; here it is a property of the
 * mechanism, because `ctx` simply does not carry a card.
 *
 * No DOM, no dialogs, no editor. A check reads ctx and returns data. That is what
 * makes the whole set testable outside the app — which is not a nicety: three
 * changes passed every check that existed on 2026-09-03 and none of them worked,
 * because nothing that ran could see the screen.
 */
(function (root) {
  'use strict';

  // ── Context ──────────────────────────────────────────────────────────────
  //
  // ONE SHARED CONTEXT, computed once and handed to every check. Otherwise each
  // check re-parses and a gate that runs on every compile gets slow in proportion
  // to how thorough it is — which would punish exactly the behaviour we want.
  //
  // Everything the outside world supplies comes in as a parameter, including the
  // file reader. That is what lets a check that walks prop headers be tested with
  // a fake tree instead of a real ProffieOS install.
  // In the app presetParser is a global loaded by an earlier <script>; under node
  // it is a module. Resolved here rather than at every call site, and still
  // overridable through opts so a test can hand in a stub.
  function _defaultParser() {
    if (root.presetParser) return root.presetParser;
    try { return require('./presetParser.js'); } catch { return null; }
  }

  function buildContext(opts) {
    const o = opts || {};
    const text = String(o.text || '');
    const parser = o.presetParser || _defaultParser();

    let parsed = null;
    try { parsed = parser ? parser.parsePresets(text) : null; } catch { parsed = null; }

    return {
      text,
      // Comment-stripped once, for every check that reasons about what the
      // PREPROCESSOR sees rather than what the file says. Doing this per check
      // is the cost the shared context exists to avoid.
      // ⚠️ Fine on config text, which has no JS regex literals — the one shape
      // this stripper mis-reads. Do not point it at our own source; see
      // test/reference-integrity.test.js for what that costs.
      cleanText: stripComments(text),
      parsed,
      bladeCount: (parsed && parsed.bladeCount) || 0,
      // The selected OS version and board, for checks whose answer depends on
      // them. Absent is normal and must be handled as "cannot tell", never as a
      // default.
      versionName: o.versionName || '',
      board:       o.board || '',
      // readVersionFile(versionName, relPath) -> Promise<{ok, content}|null>
      readVersionFile: typeof o.readVersionFile === 'function'
        ? o.readVersionFile
        : async () => null,
      // searchVersionFiles(versionName, query) -> Promise<{ok, results:[{path,...}]}|null>
      // Lets a check DERIVE a fact from the selected OS instead of carrying a list
      // that goes stale. Absent is normal and must read as "cannot tell".
      searchVersionFiles: typeof o.searchVersionFiles === 'function'
        ? o.searchVersionFiles
        : async () => null,

      defines: _configDefines(text),
    };
  }

  // Comment stripper with a real state machine. A regex pass gets this wrong on
  // decorative banners like //*********, whose "/*" substring reads as a comment
  // open and blanks every real line up to the next "*/". That exact bug cost a
  // night of false positives in the voicepack lint harness, which is why this is
  // copied in shape from the one that was fixed rather than written fresh.
  function stripComments(src) {
    let out = '', i = 0; const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
        i += 2; continue;
      }
      if (c === '"' || c === "'") {
        const q = c; out += src[i++];
        while (i < n && src[i] !== q) { if (src[i] === '\\' && i + 1 < n) out += src[i++]; out += src[i++]; }
        if (i < n) out += src[i++];
        continue;
      }
      out += src[i++];
    }
    return out;
  }

  function _configDefines(text) {
    const set = new Set();
    for (const m of stripComments(text).matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)/gm)) set.add(m[1]);
    return set;
  }

  // The body of a `#ifdef NAME ... #endif` section, or null when there is none.
  // Nested #if/#ifdef/#ifndef are counted so an inner block cannot end the outer
  // one early. Give it COMMENT-STRIPPED text: a commented-out #endif would
  // otherwise close a section that is still open.
  function sectionBody(src, name) {
    const m = String(src || '').match(new RegExp('#ifdef\\s+' + name + '\\b'));
    if (!m) return null;
    const rest = String(src).slice(m.index + m[0].length);
    let depth = 1;
    const acc = [];
    for (const line of rest.split('\n')) {
      if (/^\s*#\s*(if|ifdef|ifndef)\b/.test(line)) depth++;
      else if (/^\s*#\s*endif\b/.test(line)) { depth--; if (depth === 0) break; }
      acc.push(line);
    }
    return acc.join('\n');
  }

  // ── The font path model ──────────────────────────────────────────────────
  //
  // A preset's font value is a ProffieOS SEARCH PATH, not a name. Segment 0 is the
  // font directory; every segment after it is another directory searched in order.
  // So a SHARED folder is identified by POSITION, never by being spelled "common" —
  // a card organised around "MC" is exactly as valid.
  //
  // This lives here because a check needs it and a check may not touch the DOM.
  // index.html delegates to these rather than keeping its own copy: the literal
  // -string test was once written out separately in a dozen places and each copy
  // failed differently — a `;MC` config read as though its fonts were missing, the
  // checkbox beside it read unticked, ticking it appended a folder that did not
  // exist, and swapping a font silently DROPPED the shared segment. One model,
  // consumed everywhere. [B-326]
  //
  // ⚠️ Empties are preserved at index 0 on purpose: ";common" means "no font yet,
  // plus the shared folder", which is a different state from having no shared
  // folder at all. Callers wanting a real name use the filtered accessors.
  function fontPathParts(fontValue) {
    return String(fontValue ?? '').split(';').map(s => s.trim());
  }
  // The font directory. '' when the value leads with ';'.
  function fontDir(fontValue) { return fontPathParts(fontValue)[0] || ''; }
  // Every shared directory this preset declares, in order. Empty array = none.
  function sharedDirs(fontValue) { return fontPathParts(fontValue).slice(1).filter(Boolean); }

  // ── The registry ─────────────────────────────────────────────────────────
  const CHECKS = [];

  function register(check) {
    if (!check || !check.id || typeof check.run !== 'function') {
      throw new Error('preflight.register needs { id, run }');
    }
    if (check.severity !== 'block' && check.severity !== 'warn') {
      throw new Error(`preflight check ${check.id} needs severity 'block' or 'warn'`);
    }
    if (CHECKS.some(c => c.id === check.id)) {
      throw new Error(`preflight check ${check.id} is already registered`);
    }
    CHECKS.push(check);
    return check;
  }

  function checks() { return CHECKS.slice(); }
  function _resetForTests() { CHECKS.length = 0; }

  // ── Running ──────────────────────────────────────────────────────────────
  //
  // Every check runs, always. An early return on the first block would hide the
  // rest, and the entry is explicit that a user "cannot see how much is wrong
  // until they have clicked through all of it" — which is the same failure as a
  // chain of modals, one layer down.
  //
  // ⚠️ A CHECK THAT THROWS IS A CHECK THAT SAYS NOTHING. It must never take the
  // compile with it: the user asked to build, and our inability to inspect their
  // config is our problem, not a reason to stop them. Recorded in `errors` so it
  // is debuggable rather than silent.
  async function run(ctx) {
    const findings = [];
    const unsure   = [];
    const errors   = [];

    for (const check of CHECKS) {
      let res = null;
      try {
        res = await check.run(ctx);
      } catch (err) {
        errors.push({ id: check.id, error: String((err && err.message) || err) });
        continue;
      }
      if (!res) continue;
      if (res.unsure) { unsure.push({ id: check.id, reason: res.unsure }); continue; }
      for (const f of (res.findings || [])) {
        findings.push({
          checkId:  check.id,
          severity: check.severity,
          title:    f.title || '',
          detail:   f.detail || '',
          items:    f.items || [],
          fix:      f.fix || null,
        });
      }
    }

    // Blocks first: they are the reason the compile is stopping, so they are what
    // the user reads first. Order within a severity is registration order, which
    // is stable and therefore testable.
    findings.sort((a, b) => (a.severity === b.severity) ? 0 : (a.severity === 'block' ? -1 : 1));

    return {
      findings,
      unsure,
      errors,
      blocking: findings.some(f => f.severity === 'block'),
    };
  }

  const api = {
    buildContext, register, checks, run,
    stripComments, configDefines: _configDefines, sectionBody,
    fontPathParts, fontDir, sharedDirs,
    _resetForTests,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.preflight = api;

}(typeof globalThis !== 'undefined' ? globalThis : this));

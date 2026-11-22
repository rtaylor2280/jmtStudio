// Which files the OS Versions tree offers "Link Prop" on.
//
// The predicate is a single regex, and getting it wrong is silent: the button and
// the right-click item simply never appear, with no error anywhere. That is exactly
// how it shipped broken on 2026-08-10 — the regex was anchored `^props/`, but the
// tree is rooted at 'ProffieOS' (versionsPanel.js passes that as the initial
// subPath) and searchVersionFiles builds `ProffieOS/${rel}`, so every real path has
// a leading segment and nothing ever matched.
//
// The regex is read out of index.html rather than copied here, so this test fails
// if the real one changes rather than quietly testing a stale duplicate.
'use strict';

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

const m = html.match(/window\._LINKABLE_PROP_RE\s*=\s*(\/.+?\/[gimsuy]*)\s*;/);
assert.ok(m, 'window._LINKABLE_PROP_RE not found in index.html — did it get renamed?');

const [, src] = m;
const body  = src.slice(1, src.lastIndexOf('/'));
const flags = src.slice(src.lastIndexOf('/') + 1);
const RE = new RegExp(body, flags);

const isLinkable = p => RE.test(String(p || '').replace(/\\/g, '/'));

let failures = 0;
const check = (input, expected, why) => {
  const got = isLinkable(input);
  if (got !== expected) {
    failures++;
    console.log(`FAIL  ${JSON.stringify(input)} -> ${got}, expected ${expected}  (${why})`);
  }
};

// The shapes the app actually produces. Tree rows and search results both carry
// the 'ProffieOS' root segment.
check('ProffieOS/props/saber_fett263_buttons.h', true,  'real tree path — the case that was broken');
check('ProffieOS/props/prop_base.h',             true,  'real tree path');
check('ProffieOS/props/jmt_fett263_wrapper.h',   true,  'our own wrapper is linkable like any other');
check('props/saber.h',                           true,  'root-relative form still accepted');
check('ProffieOS\\props\\saber.h',               true,  'backslashes normalised before matching');
check('ProffieOS/PROPS/Saber.H',                 true,  'case-insensitive');

// Not props.
check('ProffieOS/styles/my_styles.h',            false, 'wrong folder');
check('ProffieOS/config/my_config.h',            false, 'a config is not a prop');
check('ProffieOS/ProffieOS.ino',                 false, 'not a header');
check('ProffieOS/props/README.md',               false, 'not a .h');
check('ProffieOS/props',                         false, 'the folder itself');
check('',                                        false, 'empty');
check(null,                                      false, 'null');

// Depth: `../props/<file>.h` from a config can only reach files directly in props/,
// so anything nested must be refused rather than linked into a broken include.
check('ProffieOS/props/sub/saber.h',             false, 'nested under props/');
check('a/b/props/saber.h',                       false, 'too many leading segments');
check('ProffieOS/other/props/saber.h',           false, 'props/ that is not the tree root props/');

// The directory the props lookup is aimed at, derived from the browsed path.
// Getting this wrong is the second way this feature shipped broken on 2026-08-10:
// it passed a bare 'props', but a version folder holds ProffieOS/ above props/,
// so the listing failed and every prop reported as missing.
const propsDirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : 'props');

const checkDir = (input, expected) => {
  const got = propsDirOf(input);
  if (got !== expected) {
    failures++;
    console.log(`FAIL  propsDir(${JSON.stringify(input)}) -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }
};

checkDir('ProffieOS/props/saber_fett263_buttons.h', 'ProffieOS/props');
checkDir('props/saber.h',                           'props');
checkDir('saber.h',                                 'props');

if (failures) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log('link-prop-path: all cases pass');

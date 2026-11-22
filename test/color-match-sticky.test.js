// Sticky Match B1: a colour matched to B1 moves when B1's colour moves.
//
// The rule, 2026-10-21: "once you match it stays matched till you either delete/change the style
// for it (B2 in this case) or manually change the color." Nothing records the match; a colour set on
// a blade that still equals B1's OLD colour is matched, so rematchColors rewrites exactly those.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effect-args.js'), 'utf8'), sandbox);
const pa = sandbox.window.proffieArgs;

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const RED = [65535, 0, 0];
const BLUE = [0, 0, 65535];
const GREEN = [0, 65535, 0];
const base = (p) => Array.from(pa.readRegistryArg('BASE_COLOR_ARG', p).values);
const alt = (p) => Array.from(pa.readRegistryArg('ALT_COLOR_ARG', p).values);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('sticky colour match');
{
  const p = pa.writeRegistryArg('BASE_COLOR_ARG', RED, '');
  const r = pa.rematchColors(p, RED, BLUE);
  check('A COLOUR STILL EQUAL TO B1\'S OLD COLOUR MOVES TO ITS NEW ONE', r !== null && eq(base(r), BLUE), r);
}
{
  const p = pa.writeRegistryArg('BASE_COLOR_ARG', GREEN, '');
  check('a colour changed by hand stays where it is', pa.rematchColors(p, RED, BLUE) === null);
}
{
  const p = pa.writeRegistryArg('ALT_COLOR_ARG', GREEN, pa.writeRegistryArg('BASE_COLOR_ARG', RED, ''));
  const r = pa.rematchColors(p, RED, BLUE);
  check('only the matched colour moves; the blade\'s other colours keep theirs', eq(base(r), BLUE) && eq(alt(r), GREEN), r);
}
{
  const p = pa.writeRegistryArg('ALT_COLOR_ARG', RED, pa.writeRegistryArg('BASE_COLOR_ARG', RED, ''));
  const r = pa.rematchColors(p, RED, BLUE);
  check('every colour matched on the blade moves (any colour row can be matched)', eq(base(r), BLUE) && eq(alt(r), BLUE), r);
}
{
  const p = pa.writeRegistryArg('ALT_COLOR_ARG', GREEN, '');
  check('A DEFAULT IS NEVER A MATCH: an unset colour is not touched', pa.rematchColors(p, [0, 0, 0], BLUE) === null);
}
{
  const r = pa.rematchColors('65535,0,0', RED, BLUE);
  check('the bare "r,g,b" form moves too', r !== null && eq(base(r), BLUE), r);
}
check('no parens, nothing to do', pa.rematchColors('', RED, BLUE) === null);

console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);

// A selection a filter would hide stays in the results on both tabs, with a chip saying why and a
// button showing just it. The chip's x takes it out of the results, never out of the selection. [B-600]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

console.log('Style Library');
const styleVis = (view, selected, matches) => view === 'only' ? selected : matches || (selected && !view);
check('the predicate is the one tested here', /const vis = _stylesSelectedView === 'only' \? selected : matches \|\| \(selected && !_stylesSelectedView\);/.test(html));
check('selected adds to the results, past the filters and the search box', styleVis('', true, false) === true);
check('the x takes it out', styleVis('hidden', true, false) === false);
check('what matches stays, selected or not', styleVis('hidden', true, true) === true && styleVis('', false, true) === true);
check('Selected shows just the selection', styleVis('only', true, false) === true && styleVis('only', false, true) === false);
check('the chip counts, reads as or, and the x hides or leaves only', /sf-filter-join">or<\/span>' \+ selectedChip/.test(html)
  && /case 'selected': _stylesSelectedView = _stylesSelectedView === 'only' \? '' : 'hidden'/.test(html) && /\(selectedOnly \|\| _stylesSelectedHeld \? 1 : 0\);/.test(html));
check('the x never touches the selection', !/case 'selected':.*_stylesSelected\b/.test(html));
check('a selection change refilters, and an empty one resets', /_applyStylesSearch\(\);   \/\/ who is showing/.test(html) && /if \(!_stylesSelected\.size\) _stylesSelectedView = '';/.test(html));
check('Clear all resets it', /_stylesInUseFilter   = '';\s+_stylesSelectedView  = '';/.test(html));
check('the button shows while anything is selected, whatever the view', /selBtn\.style\.display = _stylesSelected\.size \? '' : 'none'/.test(html) && /id="btn-styles-selected-filter"/.test(html));

console.log('Sound Fonts');
check('the same three views', /_sfSelectedView === 'only' \? _sfSelectedNames\.has\(f\.name\) :/.test(html)
  && /\(\(_sfSelectedNames\.has\(f\.name\) && !_sfSelectedView\) \|\| matchesFilters\(f\)\)/.test(html));
check('search is one of the filters it gets past, and the name set still gates it', /const matchesFilters = \(f\) => matchesSearch\(f\) &&/.test(html) && /matchesNameFilter\(f\) && \(\(_sfSelectedNames/.test(html));
check('the chip is counted in the gate', /const total = selectedActive \+ searchActive/.test(html));
check('the x hides or leaves only, and leaves the selection', /_sfSelectedView = _sfSelectedView === 'only' \? '' : 'hidden';\s+_sfRenderGrid\(\);/.test(html));
check('Clear all resets it, and an empty selection does', /_sfInUseFilter = '';\s+_sfSelectedView = '';/.test(html) && /if \(!_sfSelectedNames\.size\) _sfSelectedView = '';/.test(html));
check('the button shows while anything is selected', /selBtn\.style\.display = _sfSelectedNames\.size \? '' : 'none'/.test(html) && /id="btn-sf-selected-filter"/.test(html));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

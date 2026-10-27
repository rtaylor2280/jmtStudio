// Picking a suggestion in a tag box adds the tag at once, as Enter does; typing does not. [B-565]
'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const at = html.indexOf("const JMT_TAG_SUGGESTION_LISTS = [");
const src = at > -1 ? html.slice(at, html.indexOf('}, true);', at) + 9) : '';
check('located', src.length > 300, 're-anchor: an empty slice runs nothing');

let listener = null;
const document = { addEventListener: (t, fn) => { if (t === 'input') listener = fn; } };
class KeyboardEvent { constructor(type, o) { this.type = type; Object.assign(this, o); } }
new Function('document', 'KeyboardEvent', src)(document, KeyboardEvent);

const box = (list, value, options) => {
  const sent = [];
  return { sent, tagName: 'INPUT', value, getAttribute: (a) => (a === 'list' ? list : null),
    list: { options: options.map((v) => ({ value: v })) }, dispatchEvent: (ev) => sent.push(ev.key) };
};
const fire = (el, inputType) => listener({ target: el, inputType });

let el = box('sf-all-tags-datalist', 'Luke Skywalker', ['Luke Skywalker', 'Vader']);
fire(el, undefined);
check('a suggestion picked in a font tag box presses Enter', el.sent.join() === 'Enter', el.sent.join());
el = box('style-all-tags-datalist', 'vader', ['Vader']);
fire(el, 'insertReplacementText');
check('a Style Library tag box too, any case', el.sent.join() === 'Enter', el.sent.join());
el = box('sf-all-tags-datalist', 'Vader', ['Vader']);
fire(el, 'insertText');
check('typing that happens to spell a tag adds nothing', el.sent.length === 0, el.sent.join());
el = box('sf-all-tags-datalist', 'Vad', ['Vader']);
fire(el, undefined);
check('a value that is not a suggestion adds nothing', el.sent.length === 0);
el = box('sf-creators-datalist', 'Kyberphonic', ['Kyberphonic']);
fire(el, undefined);
check('a box with other suggestions (a creator) is left alone', el.sent.length === 0);
check('every tag box uses one of the two lists',
  (html.match(/list="sf-all-tags-datalist"/g) || []).length === 4 && (html.match(/list="style-all-tags-datalist"/g) || []).length === 1);

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);

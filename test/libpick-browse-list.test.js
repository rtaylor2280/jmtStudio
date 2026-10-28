// "Add files from the library": the Browse box opens an in-app list with collapsible groups. [B-573]
//
// Runs the real list code out of renderer/index.html against a small fake DOM:
//   · a click on the select opens the list instead of the browser's (default prevented);
//   · one heading per group with its count; the group holding the current choice is open, the rest closed;
//   · a heading toggles its group;
//   · picking an item sets the select and fires change once; picking the current one fires nothing;
//   · Escape and a click outside close it; the list is capped to the space below the box.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const start = html.indexOf('      let _sfLibPickBrowseDrop = null;');
const endMarker = "        if (_sfLibPickBrowseDrop) _sfCloseBrowseDrop(); else _sfOpenBrowseDrop();\n      });";
const end = html.indexOf(endMarker, start) + endMarker.length;
check('the code under test was found', start > 0 && end > start);
const src = html.slice(start, end);

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.style = {};
    this.className = ''; this.textContent = ''; this.title = ''; this.listeners = {}; this.value = ''; this.label = '';
    const self = this;
    this.classList = {
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (c) => { self.className = self.className.split(' ').filter((x) => x !== c).join(' '); },
      contains: (c) => self.className.split(' ').includes(c),
      toggle: (c) => { if (self.classList.contains(c)) { self.classList.remove(c); return false; } self.classList.add(c); return true; },
    };
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  contains(t) { return t === this || this.children.some((c) => c.contains(t)); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) { ev.target = ev.target || this; for (const f of this.listeners[ev.type] || []) f(ev); return true; }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
  querySelector(sel) { const c = sel.replace(/^\./, ''); return this.all().slice(1).find((e) => e.classList.contains(c)) || null; }
  getBoundingClientRect() { return { left: 100, bottom: 200, width: 480 }; }
  scrollIntoView() {}
  focus() {}
}
const doc = new El('document');
doc.body = new El('body');
doc.createElement = (t) => new El(t);
const opt = (value, text) => { const o = new El('option'); o.value = value; o.textContent = text; return o; };
const group = (label, items) => { const g = new El('optgroup'); g.label = label; items.forEach((i) => g.appendChild(i)); return g; };

const sel = new El('select');
sel.appendChild(opt('sharedTracks::t', 'Shared Tracks'));
sel.appendChild(group('Sources', [opt('source::a', 'A.zip'), opt('source::b', 'B.zip  (this font’s source)')]));
sel.appendChild(group('Fonts', [opt('entry::x', 'X'), opt('entry::y', 'Y'), opt('entry::z', 'Z')]));
sel.appendChild(group('Common folders', [opt('source::c', 'Voicepack.zip')]));
sel.value = 'source::b';
let changes = 0;
sel.addEventListener('change', () => { changes++; });

const timers = [];
const ctx = { document: doc, window: { innerHeight: 900 }, Event: class { constructor(t) { this.type = t; } },
  setTimeout: (fn) => timers.push(fn), Array, _sfLibPickEls: { target: sel } };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.isOpen = () => !!_sfLibPickBrowseDrop; this.drop = () => _sfLibPickBrowseDrop;', ctx);
const flush = () => { while (timers.length) timers.shift()(); };
const mousedown = (el) => { let prevented = false; el.dispatchEvent({ type: 'mousedown', target: el, preventDefault: () => { prevented = true; } }); return prevented; };

const prevented = mousedown(sel);
flush();
check('a click on Browse opens the list, not the browser\'s', prevented && ctx.isOpen());
const d = ctx.drop();
const allHeads = d.children.map((s) => s.children[0]);
check('each group is its own section, heading first (so the heading sticks within it)',
  d.children.length === 4 && allHeads.every((h) => h.classList.contains('sf-libpick-browse-head')));
check('one heading per group with its count, Shared Tracks first as a group of its own',
  allHeads.map((h) => h.textContent).join('|') === 'Shared Tracks (1)|Sources (2)|Fonts (3)|Common folders (1)',
  allHeads.map((h) => h.textContent).join('|'));
const heads = allHeads.slice(1);
const bodyOf = (h) => h.parent.children[1];
check('the group holding the current choice is open, the others closed (Shared Tracks too)',
  allHeads[0].classList.contains('collapsed')
  && !heads[0].classList.contains('collapsed') && bodyOf(heads[0]).style.display !== 'none'
  && heads[1].classList.contains('collapsed') && bodyOf(heads[1]).style.display === 'none'
  && heads[2].classList.contains('collapsed'));
check('the headings stick to the top of the list', /\.sf-libpick-browse-head \{[^}]*position: sticky; top: 0;/.test(html));
check('the Browse box can shrink to its column', /\.sf-libpick-target-select \{ flex: 1; min-width: 0;/.test(html));
check('the current choice is marked', d.querySelector('.current') && d.querySelector('.current').textContent.startsWith('B.zip'));
check('the list is capped to the space below the box', d.style.maxHeight === '688px', d.style.maxHeight);

mousedown(heads[1]);
check('a heading opens its group', !heads[1].classList.contains('collapsed') && bodyOf(heads[1]).style.display === '');
mousedown(heads[1]);
check('and closes it again', heads[1].classList.contains('collapsed') && bodyOf(heads[1]).style.display === 'none');

mousedown(bodyOf(heads[1]).children[1]);
check('picking an item sets Browse and fires change once', sel.value === 'entry::y' && changes === 1 && !ctx.isOpen());

mousedown(sel); flush();
mousedown(ctx.drop().querySelector('.current'));
check('picking the current one fires nothing', changes === 1 && !ctx.isOpen());

mousedown(sel); flush();
let stopped = false;
doc.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
check('Escape closes the list and is kept from closing the picker', !ctx.isOpen() && stopped);

mousedown(sel); flush();
doc.dispatchEvent({ type: 'mousedown', target: doc.body });
check('a click outside closes it', !ctx.isOpen());

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

// Style Blocks: the side panel's editor opens in a larger window and goes back on ✕ or Esc, the same
// editor moved both ways so unsaved text stays; closing the block while expanded goes back too.
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
const iife = (name) => { const i = html.indexOf(`(function ${name}() {`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 4); } } };

console.log('1. markup');
check('an expand button in the editor header, then paste, then Save', /<button id="btn-helper-expand"[^>]*>&#10530;<\/button>\s*<button id="btn-helper-paste"[\s\S]*?<\/button>\s*<button id="btn-helper-save"/.test(html));
check('a modal with a ✕ and a slot for the editor', /id="modal-helper-expanded"[\s\S]{0,200}id="btn-helper-expanded-close"[\s\S]{0,200}id="helper-expanded-slot"/.test(html));
check('the modal is a style window\'s size', /#modal-helper-expanded \.modal \{ width: 820px; max-width: 96vw; height: min\(90vh, 700px\);/.test(html));

// A small DOM: enough elements, classes and parents to run the real functions.
class El {
  constructor(id) { this.id = id; this.parent = null; this.children = []; this.cls = new Set(); this.listeners = {};
    const el = this;
    this.classList = { add: c => { el.cls.add(c); el._mut(); }, remove: c => { el.cls.delete(c); el._mut(); }, contains: c => el.cls.has(c) }; }
  _mut() { (this._observers || []).forEach(o => o.pending = true); }
  appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.push(c); return c; }
  after(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); const p = this.parent; c.parent = p; p.children.splice(p.children.indexOf(this) + 1, 0, c); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
}
const els = {};
for (const id of ['styles-helpers-panel', 'styles-helpers-list', 'styles-helper-editor-area', 'modal-helper-expanded',
  'helper-expanded-slot', 'btn-helper-expand', 'btn-helper-expanded-close', 'btn-helper-paste']) els[id] = new El(id);
els['btn-helper-paste'].dataset = {};
els['styles-helpers-panel'].appendChild(els['styles-helpers-list']);
els['styles-helpers-panel'].appendChild(els['styles-helper-editor-area']);
els['modal-helper-expanded'].appendChild(els['helper-expanded-slot']);
const observers = [];
const docListeners = {};
const document = {
  getElementById: id => els[id] || null,
  querySelectorAll: () => Object.values(els).filter(e => e.id.startsWith('modal-') && e.cls.has('active')),
  addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
};
class MutationObserver { constructor(cb) { this.cb = cb; observers.push(this); }
  observe(target) { (target._observers ||= []).push(this); } }
const flush = () => observers.forEach(o => { if (o.pending) { o.pending = false; o.cb(); } });
let layouts = 0;
const editor = { layout: () => layouts++, focus: () => {}, updateOptions: () => {}, getAction: () => null };
const run = new Function('document', 'MutationObserver', 'requestAnimationFrame', '_stylesHelperEditor',
  `${fn('_helperEditorExpanded')}\n${fn('_expandHelperEditor')}\n${fn('_collapseHelperEditor')}\n${iife('_initHelperExpand')}
   return { _expandHelperEditor, _collapseHelperEditor, _helperEditorExpanded };`);
const api = run(document, MutationObserver, f => f(), editor);
const area = els['styles-helper-editor-area'];
const esc = () => { let prevented = false; const e = { key: 'Escape', defaultPrevented: false, preventDefault: () => { prevented = true; } };
  (docListeners.keydown || []).forEach(f => f(e)); return prevented; };

console.log('2. behaviour');
api._expandHelperEditor(); flush();
check('nothing open in the panel: expand does nothing', !api._helperEditorExpanded() && area.parent === els['styles-helpers-panel']);
area.classList.add('active'); flush();
els['btn-helper-expand'].listeners.click[0](); flush();
check('expand moves the editor into the window and shows it', api._helperEditorExpanded() && area.parent === els['helper-expanded-slot'] && layouts > 0);
els['btn-helper-expanded-close'].listeners.click[0](); flush();
check('✕ moves it back, right after the list, still open', !api._helperEditorExpanded() && area.parent === els['styles-helpers-panel']
  && els['styles-helpers-panel'].children.indexOf(area) === els['styles-helpers-panel'].children.indexOf(els['styles-helpers-list']) + 1
  && area.cls.has('active'));
api._expandHelperEditor(); flush();
const ov = els['modal-helper-expanded'];
ov.listeners.click[0]({ target: els['helper-expanded-slot'] }); flush();
check('a click inside the window stays', api._helperEditorExpanded());
ov.listeners.click[0]({ target: ov }); flush();
check('a click beside it goes back, as ✕ does', !api._helperEditorExpanded() && area.parent === els['styles-helpers-panel']);
api._expandHelperEditor(); flush();
check('Esc goes back too', esc() && !api._helperEditorExpanded() && area.parent === els['styles-helpers-panel']);
check('Esc with the window not open is left alone', !esc());
api._expandHelperEditor(); flush();
els['modal-other'] = new El('modal-other'); els['modal-other'].classList.add('active');
check('Esc belongs to a window opened over it', !esc() && api._helperEditorExpanded());
delete els['modal-other'];
area.classList.remove('active'); flush();
check('the block closing while expanded goes back to the panel', !api._helperEditorExpanded() && area.parent === els['styles-helpers-panel']);
area.classList.add('active'); api._expandHelperEditor();
area.classList.remove('active'); area.classList.add('active'); flush();
check('a rebuild that reopens the block in the same pass stays expanded', api._helperEditorExpanded());

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

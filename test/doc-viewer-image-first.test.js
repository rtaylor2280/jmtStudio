// The file viewer opens on an image already decoded and sized, never as an empty frame, and files reach
// the window as raw bytes rather than a list of numbers. [B-511]
'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

(async () => {
  console.log('1. the viewer');
  const at = html.indexOf('let _sfDocViewerShowToken = 0;');
  const end = html.indexOf('const _sfHideDocViewer = () => {', at);
  const src = at > -1 && end > at ? html.slice(at, end) : '';
  check('the show function was located', src.length > 1000, 're-anchor: an empty slice runs nothing');

  // Run it with a stub page: record the order of decode, fit and show.
  const log = [];
  let resolveDecode;
  const img = { decode: () => new Promise((r) => { resolveDecode = () => { log.push('decoded'); r(); }; }), set src(v) { log.push('src'); } };
  const classList = (name) => ({ add: (c) => log.push(`${name}+${c}`), remove: (c) => log.push(`${name}-${c}`), toggle() {}, contains: (c) => name === 'font' && c === 'active' });
  const modalEl = {};
  const body = { classList: classList('body'), set innerHTML(v) {}, querySelector: () => img, closest: () => modalEl };
  const els = { modal: { classList: classList('viewer') }, name: {}, size: {}, body, actions: { style: {} }, openExt: { style: {} }, remove: {} };
  const document = { getElementById: (id) => (id === 'modal-sf-entry-detail' ? { classList: classList('font') } : null) };
  const run = new Function('_sfDocViewerEls', 'document', '_jmtFitViewerImage', 'URL',
    `let _sfDocViewerBlobUrl = null, _sfDocViewerPop = null, _sfDocViewerRemove = null, _sfDocViewerStashedModalIds = [];
     let _sfDocViewerOrigin = null; const _sfRenderDocStyleActions = () => {};   // [B-569] style file actions
     ${src}
     return { show: _sfShowDocViewer, hide: () => { _sfDocViewerShowToken++; } };`)(
    els, document, (m, i) => log.push(i ? 'fit' : 'fit-none'), { revokeObjectURL() {} });

  run.show('ben.png', 1600940, '', { kind: 'image', blobUrl: 'blob:x' });
  check('nothing changes on screen while the image decodes', !log.some((l) => l.startsWith('viewer+') || l.startsWith('font-')), log.join(' '));
  resolveDecode();
  await new Promise((r) => setTimeout(r, 0));
  const order = log.filter((l) => ['decoded', 'fit', 'font-active', 'viewer+active'].includes(l)).join(' > ');
  check('then: decoded, sized, the font window hidden, the viewer shown, in that order',
    order === 'decoded > fit > font-active > viewer+active', order);

  log.length = 0;
  run.show('ben.png', 1, '', { kind: 'image', blobUrl: 'blob:y' });
  run.hide();
  resolveDecode();
  await new Promise((r) => setTimeout(r, 0));
  check('closed while decoding: it does not open afterwards', !log.includes('viewer+active'), log.join(' '));

  log.length = 0;
  run.show('notes.txt', 10, 'hello');
  check('text still shows at once', log.includes('viewer+active'), log.join(' '));

  console.log('2. raw bytes');
  check('no file handler sends a list of numbers', !/bytes: Array\.from\(/.test(main));
  for (const ch of ['sources:readDocBytes', 'entries:readDocBytes', 'common:readFileBytes', 'sharedTracks:readFileBytes']) {
    const i = main.indexOf(`ipcMain.handle('${ch}'`);
    check(`${ch} returns the Buffer`, i > -1 && /return \{ ok: true, bytes: buf \};/.test(main.slice(i, i + 500)));
  }
  const readers = html.match(/(Uint8Array\.from|new Uint8Array)\((res|r)\.bytes/g) || [];
  check('every reader wraps the result in a Uint8Array (works on raw bytes too)', readers.length >= 8, String(readers.length));

  console.log('3. layer');
  const z = (id) => Number((html.match(new RegExp(`#${id} \\{ z-index: (\\d+); \\}`)) || [])[1] || 0);
  check('the viewer opens above every window it opens from, and below confirms [B-567]',
    z('modal-sf-doc-viewer') > z('modal-sf-library-picker') && z('modal-sf-doc-viewer') > z('modal-sf-reorganize')
    && z('modal-sf-doc-viewer') < z('modal-confirm') && z('modal-sf-library-picker') > 0,
    JSON.stringify({ viewer: z('modal-sf-doc-viewer'), picker: z('modal-sf-library-picker'), confirm: z('modal-confirm') }));

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();

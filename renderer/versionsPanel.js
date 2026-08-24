// @ts-nocheck
/**
 * versionsPanel.js
 * Renderer-side logic for the OS Version Manager tab.
 * Loaded by index.html when the Versions tab is first activated.
 */

let _vpVersions       = [];
let _vpSelected       = null;
let _vpFileViewer     = null; // Monaco editor instance for file viewer
let _vpNotesOriginal  = '';   // tracks saved state for dirty detection
let _vpNotesDirty     = false;

async function _vpDoSaveNotes() {
  const notesEl  = document.getElementById('vp-notes');
  const saveBtn  = document.getElementById('vp-btn-save-notes');
  const statusEl = document.getElementById('vp-notes-status');
  if (!_vpSelected || !notesEl) return;
  // _btnBusy/_btnIdle live in index.html's script, which has already run by the
  // time this file is injected. Label without the ellipsis; the class animates it.
  if (saveBtn) saveBtn.disabled = true;
  _btnBusy(saveBtn, 'Saving');
  const result = await window.electronAPI.writeVersionNotes(_vpSelected.name, notesEl.value);
  if (result.ok) {
    _vpNotesOriginal = notesEl.value;
    _vpNotesDirty    = false;
    _vpSelected.notes       = notesEl.value;
    _vpSelected.notesPreview = notesEl.value.split('\n').find(l => l.trim()) || null;
    if (statusEl) { statusEl.textContent = 'Saved'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
    _vpRenderCards();
  } else {
    if (statusEl) statusEl.textContent = `Error: ${result.error}`;
  }
  _btnIdle(saveBtn, 'Save Notes');
  if (saveBtn) saveBtn.disabled = notesEl.value === _vpNotesOriginal;
}

// ── Helpers ────────────────────────────────────────────

function _vpFmtBytes(b) {
  if (!b || b === 0) return '0 B';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function _vpEsc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _vpFmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function _vpLang(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    h: 'cpp', cpp: 'cpp', c: 'cpp', ino: 'cpp', cc: 'cpp',
    md: 'markdown', markdown: 'markdown',
    json: 'json',
    py: 'python',
    yml: 'yaml', yaml: 'yaml',
    txt: 'plaintext', log: 'plaintext', csv: 'plaintext',
    sh: 'shell', bat: 'bat',
    js: 'javascript', ts: 'typescript',
    xml: 'xml', html: 'html', css: 'css',
  };
  return map[ext] || 'plaintext';
}

function _vpFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isHidden = name.startsWith('.');
  if (isHidden) return '·';
  const map = { h: 'h', cpp: 'c', ino: 'c', c: 'c', cc: 'c', md: 'm', json: 'j', txt: 't', yml: 'y', yaml: 'y', py: 'p', sh: 's', bat: 's', gitignore: 'g', gitattributes: 'g', mk: 'k', makefile: 'k' };
  return map[ext] || '·';
}

// ── Semver helpers ─────────────────────────────────────

function _semverCompare(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return  1;
    if (na < nb) return -1;
  }
  return 0;
}

// ── Init ───────────────────────────────────────────────

async function initVersionsPanel(initialName) {
  await vpRefresh(initialName);
}

async function vpRefresh(preferName) {
  const versions = await window.electronAPI.listVersionsDetails();
  // The starred default is read here as well as by the config dropdown, because
  // this panel can be opened before anything has repopulated that dropdown.
  await window.loadDefaultOSVersion?.();
  _vpVersions = versions;
  _vpRenderCards();
  const preferred = preferName ? versions.find(v => v.name === preferName) : null;
  const still     = _vpSelected ? versions.find(v => v.name === _vpSelected.name) : null;
  _vpSelectVersion(preferred || still || versions[0] || null);
}

// ── Default version ────────────────────────────────────
// The star state is owned by index.html, not by this panel — the config
// dropdown needs the answer at boot and this file is only loaded when the
// Versions tab is first opened. Both helpers degrade to null/no-op if that
// script has not defined them yet.

function _vpDefaultName() {
  return window.getEffectiveDefaultOSVersion?.(_vpVersions.map(v => v.name)) ?? null;
}

async function _vpSetDefault(name) {
  if (!name) return;
  // Deliberately NOT guarded against the currently-shown star. Until something
  // is stored the shown default is the versions[0] fallback, which drifts the
  // moment a higher-sorting name is imported; clicking it is how the user pins
  // it. setDefaultOSVersion guards against a redundant write itself.
  await window.setDefaultOSVersion?.(name);
  _vpRenderCards();
  // Patch the detail badge in place rather than re-rendering the pane —
  // _vpRenderDetail resets _vpNotesOriginal from the stored record, which would
  // silently drop whatever the user has typed into the notes box.
  _vpUpdateDetailDefaultBadge();
}

function _vpUpdateDetailDefaultBadge() {
  const slot = document.getElementById('vp-detail-default-badge');
  if (!slot) return;
  const show = _vpVersions.length > 1 && _vpSelected && _vpSelected.name === _vpDefaultName();
  slot.innerHTML = show
    ? '<span class="vp-badge lg" title="Pre-selected for new configs">&#9733; Default</span>'
    : '';
}

// The sidebar is only a selector — its header holds a title and nothing else,
// and every field on a card is repeated in the detail pane. With fewer than two
// versions there is no selection to make, so it goes away entirely rather than
// collapsing: a collapsed chooser still advertises a decision that does not
// exist. Download / Import live in the view's top-right chrome, not in here, so
// nothing becomes unreachable.
function _vpApplyLayout() {
  document.querySelector('.vp-sidebar')?.classList.toggle('is-hidden', _vpVersions.length < 2);
}

// ── Cards ──────────────────────────────────────────────

function _vpRenderCards() {
  _vpApplyLayout();
  const list = document.getElementById('vp-list');
  if (!list) return;
  list.innerHTML = '';

  if (_vpVersions.length === 0) {
    list.innerHTML = '<div class="vp-empty-list">No versions installed.</div>';
    return;
  }

  // With a single version installed there is no choice to express, so the star
  // is hidden entirely — same gate the common folder cards use.
  const showStars   = _vpVersions.length > 1;
  const defaultName = _vpDefaultName();

  _vpVersions.forEach(v => {
    const card = document.createElement('div');
    card.className = 'vp-card' + (v.name === _vpSelected?.name ? ' active' : '');
    card.dataset.name = v.name;
    const isDefault = v.name === defaultName;
    const starBtn = showStars
      ? `<button class="vp-card-star${isDefault ? ' is-starred' : ''}" data-star-name="${_vpEsc(v.name)}" title="${isDefault ? 'Default OS version for new configs' : 'Set as default'}">${isDefault ? '&#9733;' : '&#9734;'}</button>`
      : '';
    card.innerHTML = `
      <div class="vp-card-top">
        <span class="vp-card-name">${_vpEsc(v.name)}</span>
        ${starBtn}
      </div>
      <div class="vp-card-meta">
        <span class="vp-card-size">${_vpFmtBytes(v.size)}</span>
        ${v.modified ? `<span class="vp-card-date">${_vpFmtDate(v.modified)}</span>` : ''}
      </div>
      ${v.proffieVersion ? `<div class="vp-card-proffie-ver">ProffieOS ${_vpEsc(v.proffieVersion)}</div>` : ''}
      ${v.notesPreview ? `<div class="vp-card-notes-preview">${_vpEsc(v.notesPreview)}</div>` : ''}
    `;
    card.addEventListener('click', async (e) => {
      // The star sits inside the card, so its click would otherwise also
      // select the card and run the unsaved-notes prompt on the way.
      const starEl = e.target.closest?.('.vp-card-star');
      if (starEl) {
        e.stopPropagation();
        await _vpSetDefault(starEl.dataset.starName);
        return;
      }
      if (_vpNotesDirty) {
        const choice = await (window.promptUnsaved?.('Unsaved notes — save before switching versions?') ?? Promise.resolve('discard'));
        if (choice === 'cancel') return;
        if (choice === 'save') await _vpDoSaveNotes();
      }
      _vpSelectVersion(v);
    });
    list.appendChild(card);
  });
}

// ── Detail pane ────────────────────────────────────────

function _vpSelectVersion(v) {
  _vpSelected = v;
  document.querySelectorAll('.vp-card').forEach(c => {
    c.classList.toggle('active', c.dataset.name === v?.name);
  });
  _vpRenderDetail(v);
}

function _vpRenderDetail(v) {
  const pane = document.getElementById('vp-detail');
  if (!pane) return;

  if (!v) {
    // Two different nothings. With versions installed this is a transient
    // no-selection state and the sidebar is on screen to fix it. With none
    // installed it is the first thing a new user sees, and the sidebar that
    // used to carry "No versions installed." is hidden — so the route to a
    // version has to be named here or the pane dead-ends.
    pane.innerHTML = _vpVersions.length === 0
      ? `<div class="vp-empty-detail">
           <div class="vp-empty-detail-title">No ProffieOS versions installed</div>
           <div class="vp-empty-detail-body">
             JMT Studio builds your config against a copy of the ProffieOS source on this
             computer. Use <strong>Download Version</strong> above to fetch an official
             release, or <strong>Import Version</strong> if you already have a ProffieOS
             folder on disk.
           </div>
         </div>`
      : '<div class="vp-no-selection">Select a version to view details.</div>';
    return;
  }

  const notesVal = _vpEsc(v.notes || '');
  _vpNotesOriginal = v.notes || '';

  pane.innerHTML = `
    <div class="vp-detail-header">
      <div class="vp-detail-title-row">
        <h2 class="vp-detail-name">${_vpEsc(v.name)}</h2>
        <span id="vp-detail-default-badge"></span>
      </div>
      <div class="vp-detail-stats">
        <span>${_vpFmtBytes(v.size)}</span>
        ${v.modified ? `<span>·</span><span>Modified ${_vpFmtDate(v.modified)}</span>` : ''}
        <span>·</span><span style="color:${v.proffieVersion ? 'var(--c-text-sub)' : 'var(--c-text-dim)'}">ProffieOS ${v.proffieVersion || 'version unknown'}</span>
      </div>
    </div>

    <div class="vp-detail-actions">
      <button class="vp-action-btn" id="vp-btn-duplicate" title="Create a copy of this version">⧉ Duplicate</button>
      <button class="vp-action-btn" id="vp-btn-export" title="Copy version folder to a location you choose">↗ Export</button>
      <button class="vp-action-btn" id="vp-btn-rename" title="Rename this version">✎ Rename</button>
      <button class="vp-action-btn danger" id="vp-btn-delete" title="Permanently delete this version">✕ Delete</button>
      <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${v.jmtVersion ? `<span id="vp-jmt-version-label" style="font-size:0.75rem;color:var(--c-text-dim);">Includes JMT Add-ons v${_vpEsc(v.jmtVersion)}</span>` : '<span id="vp-jmt-version-label" style="display:none;font-size:0.75rem;color:var(--c-text-dim);"></span>'}
          <button class="vp-action-btn vp-jmt-btn" id="vp-btn-jmt" title="${v.jmtVersion ? 'Check for updates to JMT add-on files' : 'Add JMT add-on files to this version'}">
            ${v.jmtVersion ? '⚙ Check for Updates' : '⚙ Add JMT Features'}
          </button>
        </div>
        <a href="#" id="vp-jmt-learn-more" title="https://jmtfoundry.com/jmt-addons" style="font-size:0.74rem;color:#4a9edd;text-decoration:underline;">Learn more</a>
        ${window._jmtDevMode ? `
        <div id="vp-jmt-branch-toggle" style="display:flex;align-items:center;gap:6px;font-size:0.7rem;margin-top:2px;" title="Dev-only: switch JMT add-ons source between main and dev branches">
          <span style="color:var(--c-text-faint);">Source:</span>
          <button id="vp-jmt-branch-main" style="border:1px solid var(--c-border);background:transparent;color:var(--c-text-muted);padding:1px 8px;border-radius:9px;cursor:pointer;font-size:0.7rem;line-height:1;">main</button>
          <button id="vp-jmt-branch-dev"  style="border:1px solid var(--c-border);background:transparent;color:var(--c-text-muted);padding:1px 8px;border-radius:9px;cursor:pointer;font-size:0.7rem;line-height:1;">DEV</button>
        </div>` : ''}
      </div>
    </div>

    <div id="vp-jmt-panel" style="display:none;margin-bottom:18px;padding:12px;background:var(--c-bg-inset);border:1px solid var(--c-border);border-radius:5px;font-size:0.82rem;"></div>

    <div class="vp-section" id="vp-core-section">
      <div class="vp-section-label">Proffieboard Plugin</div>
      <div id="vp-core-body" style="font-size:0.82rem;color:var(--c-text-dim);">Loading…</div>
    </div>

    <div class="vp-section">
      <div class="vp-section-label">Notes</div>
      <textarea id="vp-notes" class="vp-notes-editor" spellcheck="false" placeholder="Add notes about this version: changes, known issues, source, etc.">${notesVal}</textarea>
      <div class="vp-notes-footer">
        <span id="vp-notes-status" class="vp-notes-status"></span>
        <button class="vp-action-btn primary" id="vp-btn-save-notes" disabled>Save Notes</button>
      </div>
    </div>

    <div class="vp-section">
      <div class="vp-section-label" style="display:flex;align-items:center;gap:6px;">
        File Browser
        <button id="vp-btn-open-folder" title="Open in system folder" style="background:none;border:none;padding:1px 3px;cursor:pointer;font-size:0.85rem;opacity:0.5;line-height:1;border-radius:3px;filter:grayscale(1);" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">📂</button>
      </div>
      <div class="vp-search-wrap">
        <input type="text" id="vp-search" class="vp-search-input" placeholder="Search files and folders…" autocomplete="off" spellcheck="false" />
        <span id="vp-search-clear" class="vp-search-clear" style="display:none;">&#10005;</span>
      </div>
      <div id="vp-tree" class="vp-tree"></div>
    </div>
  `;

  // Notes
  const notesEl  = document.getElementById('vp-notes');
  const saveBtn  = document.getElementById('vp-btn-save-notes');
  const statusEl = document.getElementById('vp-notes-status');

  _vpNotesDirty = false;

  notesEl.addEventListener('focus', () => { notesEl.spellcheck = true; });
  notesEl.addEventListener('blur',  () => { notesEl.spellcheck = false; });

  notesEl.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  notesEl.addEventListener('input', () => {
    const dirty = notesEl.value !== _vpNotesOriginal;
    _vpNotesDirty = dirty;
    saveBtn.disabled = !dirty;
    statusEl.textContent = dirty ? 'Unsaved changes' : '';
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    _btnBusy(saveBtn, 'Saving');
    const result = await window.electronAPI.writeVersionNotes(v.name, notesEl.value);
    if (result.ok) {
      _vpNotesOriginal = notesEl.value;
      _vpNotesDirty = false;
      v.notes = notesEl.value;
      v.notesPreview = notesEl.value.split('\n').find(l => l.trim()) || null;
      statusEl.textContent = 'Saved';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
      _vpRenderCards();
    } else {
      statusEl.textContent = `Error: ${result.error}`;
    }
    _btnIdle(saveBtn, 'Save Notes');
    saveBtn.disabled = notesEl.value === _vpNotesOriginal;
  });

  // Action buttons
  _vpUpdateDetailDefaultBadge();
  document.getElementById('vp-btn-duplicate')?.addEventListener('click', () => _vpDuplicate(v));
  document.getElementById('vp-btn-open-folder')?.addEventListener('click', () => window.electronAPI.openVersionFolder(v.name));
  document.getElementById('vp-btn-export')?.addEventListener('click', () => _vpExport(v));
  document.getElementById('vp-btn-rename')?.addEventListener('click', () => _vpRename(v));
  document.getElementById('vp-btn-delete')?.addEventListener('click', () => _vpDelete(v));
  document.getElementById('vp-btn-jmt')?.addEventListener('click', () => _vpJmtFlow(v));

  // Populated after render because it needs the board index, which can touch
  // the network. Rendering the pane synchronously and filling this in keeps a
  // slow or unreachable index from stalling the whole detail view.
  _vpRenderCoreSection(v);

  // Dev-mode branch toggle. Only present when window._jmtDevMode is true (set via
  // the 7-tap unlock in Settings). Flipping the branch refetches the manifest and
  // re-runs the same JMT flow as the regular button — hashes won't match across
  // branches, so the existing integrity path naturally prompts to reinstall.
  if (window._jmtDevMode) {
    const mainPill = document.getElementById('vp-jmt-branch-main');
    const devPill  = document.getElementById('vp-jmt-branch-dev');
    const applyPillState = (branch) => {
      if (!mainPill || !devPill) return;
      const isDev = branch === 'dev';
      mainPill.style.background  = isDev ? 'transparent' : 'var(--c-bg-card)';
      mainPill.style.color       = isDev ? 'var(--c-text-muted)' : 'var(--c-text)';
      mainPill.style.fontWeight  = isDev ? '400' : '700';
      mainPill.style.borderColor = isDev ? 'var(--c-border)' : 'var(--c-text-faint)';
      devPill.style.background  = isDev ? '#e44' : 'transparent';
      devPill.style.color       = isDev ? '#fff' : 'var(--c-text-muted)';
      devPill.style.fontWeight  = isDev ? '700' : '400';
      devPill.style.borderColor = isDev ? '#e44' : 'var(--c-border)';
    };
    window.electronAPI.getAddonBranch().then(applyPillState).catch(() => applyPillState('main'));
    const flip = async (branch) => {
      const r = await window.electronAPI.setAddonBranch(branch);
      if (r?.ok) applyPillState(r.branch);
      _vpJmtFlow(v);
    };
    mainPill?.addEventListener('click', () => flip('main'));
    devPill?.addEventListener('click',  () => flip('dev'));
  }

  document.getElementById('vp-jmt-learn-more')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI?.openExternal?.('https://jmtfoundry.com/jmt-addons');
  });

  // File tree — start inside ProffieOS/
  const treeEl = document.getElementById('vp-tree');
  _vpInitVersionTree(v.name, treeEl);

  // Search
  let _searchTimer = null;
  const searchEl = document.getElementById('vp-search');
  const searchClear = document.getElementById('vp-search-clear');
  searchEl.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = searchEl.value.trim();
    searchClear.style.display = q ? '' : 'none';
    if (!q) { _vpInitVersionTree(v.name, treeEl); return; }
    _searchTimer = setTimeout(() => _vpSearch(v.name, q, treeEl), 260);
  });
  searchClear.addEventListener('click', () => {
    searchEl.value = '';
    searchClear.style.display = 'none';
    _vpInitVersionTree(v.name, treeEl);
    searchEl.focus();
  });
}

// ── Version tree: ProffieOS as the fixed root ──────────

// Which Proffieboard Plugin version this ProffieOS version compiles with.
//
// Called "Proffieboard Plugin" throughout, never "core" and never "build tools".
// That is the community's own name for it, verified rather than assumed
// (2026-08-12): Arduino's Boards Manager lists the package as literally
// "Proffieboard Plugin", pod.hubbe.net's setup page tells users to install
// "the latest version Proffieboard Plugin", and profezzorn titles his own
// release threads "Arduino-Proffieboard Plugin v3.6 beta" / "Arduino-proffieboard
// plugin 4.6 beta". In running copy the forum shortens it to "plugin 4.6".
//
// "core" is arduino-cli's word (`core install`) and stays internal. "Build
// tools" was OUR invention and was worse than both: it matched nothing the user
// had ever seen. Someone who set this up in Arduino IDE has read the exact
// string "Proffieboard Plugin", so using it is free recognition.
//
// Worth a control rather than a constant because the choice decides whether a
// build links at all: a style-heavy config can fit on 3.6 and overflow 4.6 by
// kilobytes, which on a 256 KB V2 or V2.2 is a quarter of the board.
//
// There is deliberately no "follow latest" option. A version that followed
// latest would change compiler the day a new release shipped - cache misses, an
// unrequested download, and a config that only just fitted possibly failing to
// link. Versions are pinned; a newer release is reported as a fact to act on.
//
// The select is styled inline on purpose. A class name renders an unstyled
// native control; the declarations below are copied from the include-common
// picker, which is the reference for selects in this app.
// The three phases arduino-cli actually reports, and the words the panel shows
// for them. Module scope because BOTH install paths paint them now: one started
// from the dropdown here, one started by ensureCore at startup. Same work, so
// the same labels and the same moving bar. (2026-08-15)
// Local three-part normaliser. The panel cannot require coreVersions, and
// `3.6` vs `3.6.0` from two different senders would otherwise never match.
const coreVersions_normalize = v => String(v || '').trim().split('.').slice(0, 3)
  .concat(['0', '0', '0']).slice(0, 3).join('.');

const _VP_PHASE = {
  index:       'Checking for plugin',
  downloading: 'Downloading plugin',
  installing:  'Installing plugin',
};
// Unsubscribed and re-taken on every render, so a repaint cannot leave a
// listener behind writing into an element that no longer exists.
let _vpPhaseUnsub = null;

const _VP_SELECT_CSS =
  'width:100%;max-width:320px;padding:6px 8px;background:var(--c-bg-inset);' +
  'color:var(--c-text);border:1px solid var(--c-border-strong);border-radius:3px;' +
  'font-size:0.82rem;';

// opts.autoInstall: the user just PICKED this core, so if it is missing, fetch it
// without making them confirm the thing they already said. Deliberately not the
// default: merely rendering the panel must never start a several-hundred-megabyte
// download, so the button still exists for that state and for retrying a failure.
async function _vpRenderCoreSection(v, opts = {}) {
  const body = document.getElementById('vp-core-body');
  if (!body) return;

  let avail, current;
  try {
    [avail, current] = await Promise.all([
      window.electronAPI.listCoreVersions(),
      window.electronAPI.getCoreForVersion(v.name),
    ]);
  } catch {
    body.textContent = 'Could not read the list of available Proffieboard Plugin versions.';
    return;
  }
  // The pane may have moved on to another version while this was in flight.
  if (!document.getElementById('vp-core-body') || current.name !== v.name) return;

  const sources = avail.sources || {};

  // Already filtered and newest-first by the main process: at or above the
  // floor, plus anything present on the machine. Every entry is a real choice.
  //
  // "system" and "installed" are different facts and the user should see which.
  // A system core lives in their own Arduino tree - usable, but never ours to
  // remove - while an installed one we downloaded and a reset can reclaim.
  const options = (avail.versions || []).map(ver => {
    const src   = sources[ver];
    const badge = src === 'system' ? ' · system' : src === 'jmt' ? ' · installed' : '';
    return `<option value="${_vpEsc(ver)}"${current.pinned === ver ? ' selected' : ''}>` +
           `${_vpEsc(ver)}${badge}</option>`;
  }).join('');

  // Explanation lives in a tooltip, not inline. An inline paragraph is height
  // every user pays on every visit, including everyone who already knows.
  const sectionTitle =
    'The Proffieboard Plugin version this ProffieOS version compiles with - the same ' +
    'plugin you would install in Arduino IDE. Each plugin brings its own compiler, so ' +
    'the version you pick changes how large the firmware is and can decide whether a ' +
    'big config fits on a 256 KB board. Which one comes out smaller depends on the ' +
    'ProffieOS version, so it is worth trying both. This never changes on its own.';

  body.innerHTML = `
    <div title="${_vpEsc(sectionTitle)}" style="display:flex;flex-direction:column;gap:8px;">
      <select id="vp-core-select" style="${_VP_SELECT_CSS}">${options}</select>
      <div id="vp-core-status" style="display:flex;align-items:center;gap:10px;min-height:24px;"></div>
    </div>
  `;

  try { _vpPhaseUnsub?.(); } catch {}
  _vpPhaseUnsub = null;

  const sel    = document.getElementById('vp-core-select');
  const status = document.getElementById('vp-core-status');

  // A render can land WHILE an install is running - this function re-renders
  // itself on success, and a refresh can come from elsewhere - and each one
  // builds a fresh select that is enabled by default. Re-apply the lock, or the
  // race reopens for whatever is left of the download. (2026-08-15)
  if (sel && window._coreInstallInFlight) sel.disabled = true;

  // Runs the download and owns the whole visible arc of it. Shared by the auto
  // path and the button so there is one behaviour, not two that drift.
  async function doInstall(pinned, revertTo = null) {
    // One at a time, whatever the entry point. The select is locked while an
    // install runs, but this function is also reached from the Install button
    // and from autoInstall on a re-render, and two concurrent arduino-cli runs
    // against overlapping trees is the failure this whole lock exists to stop.
    if (window._coreInstallInFlight || window._backgroundPluginInstall) return;

    // Several hundred megabytes with no percentage available, so a static line
    // is indistinguishable from a hung app. Same moving bar the build modal uses.
    // Three labels, and they DO flip back and forth - that is correct, not a defect.
    //
    // arduino-cli works package by package: download a tool, install it, download the platform,
    // install it. So the display crosses between Downloading and Installing more than once, and it
    // is reporting exactly what is happening at that moment. Collapsing them into one label was
    // tried on 2026-08-14 and reverted the same hour: it hid real work to make the sequence look
    // tidier, which is a lie about a thing the user can otherwise watch happen.
    // Do not "fix" the flipping. Let it do its thing.
    const PHASE = _VP_PHASE;
    const paintPhase = (label) => {
      const t = document.getElementById('vp-core-phase');
      if (t) t.textContent = `${label} ${pinned}…`;
    };
    // Open on the FIRST REAL PHASE, not a placeholder. This used to read "Getting plugin X…"
    // until the first progress event replaced it, which put a state in front of the user that
    // never described anything: getting, then downloading, then installing, where the first was
    // only "we have not heard back yet". Starting at `index` costs nothing - it is what is
    // actually happening at that instant - and the sequence loses a step nobody needed.
    // (2026-08-14)
    // Cancel is the way out, since the dropdown is locked for the duration. It
    // is not merely a stop: the handler removes the partially written tree, so
    // the machine ends where it started rather than holding a plugin that is
    // present, unusable, and reported as installed. (2026-08-15)
    status.innerHTML =
      `<span id="vp-core-phase" style="color:var(--c-text-dim);">${PHASE.index} ${_vpEsc(pinned)}…</span>` +
      `<span class="vp-wait-track"><div class="bm-bar-knightrider"></div></span>` +
      `<button class="vp-action-btn" id="vp-core-cancel">Cancel</button>`;

    let cancelled = false;
    document.getElementById('vp-core-cancel')?.addEventListener('click', async () => {
      cancelled = true;
      const btn = document.getElementById('vp-core-cancel');
      // Was hand-rolled here; routed through the shared helper so this file has one
      // way of showing a working state. (2026-08-15)
      if (btn) btn.disabled = true;
      _btnBusy(btn, 'Cancelling');
      const phaseEl = document.getElementById('vp-core-phase');
      if (phaseEl) phaseEl.textContent = 'Stopping and cleaning up…';
      const res = await window.electronAPI.cancelCoreInstall?.(pinned).catch(() => null);
      // The install's own finally runs too and re-renders; this only reports a
      // cleanup that FAILED, since a clean cancel needs no announcement.
      if (res && !res.ok) {
        const s = document.getElementById('vp-core-status');
        if (s) s.innerHTML = `<span style="color:#e44;">${_vpEsc(res.error)}</span>`;
      }
    });

    // Downloading and installing are two long waits, and giving both one label
    // makes the second one look like the first has stalled.
    const stopPhase = window.electronAPI.onCoreInstallProgress?.(({ phase }) => {
      if (phase && PHASE[phase]) paintPhase(PHASE[phase]);
    });

    // Compile must not be available against a plugin that is still arriving.
    window._coreInstallInFlight = pinned;
    window.updateCompileButton?.();
    // Neither may the SELECT. It was live for the whole download, and switching
    // during one started a second install while the first was still running:
    // two arduino-cli processes against overlapping trees, two phase listeners
    // repainting a status element that a re-render had already replaced, and a
    // visible error before it settled. The pin is a one-line write and the
    // download is minutes, so the control has to be held for the long half.
    //
    // Held rather than cancelled, deliberately. Aborting mid-install leaves a
    // partially written plugin tree, and there is no cleanup for that today -
    // refusing the change is honest, while a Cancel that strands a half tree
    // would be worse than the race it replaced. (2026-08-15)
    sel.disabled = true;
    // ...and the status bar must not still read "Toolchain ready" while it arrives. That indicator
    // is written at startup and never revisited, so without this the app disabled Compile for a
    // reason its own status line contradicted. (2026-08-14)
    window.setToolchainBusy?.(`Installing Proffieboard Plugin ${pinned}...`);
    let res = null;
    try {
      res = await window.electronAPI.installCoreVersion(pinned);
    } catch { res = null; }
    finally {
      // Every install would otherwise leave a live listener behind, and each one
      // repaints a status element from an install that already finished.
      try { stopPhase?.(); } catch {}
      window._coreInstallInFlight = null;
      window.updateCompileButton?.();
      window.clearToolchainBusy?.();
      // The element may have been replaced by a re-render while we waited, so
      // re-read rather than trusting the captured reference.
      const live = document.getElementById('vp-core-select');
      if (live) live.disabled = false;
    }
    if (res && res.ok) { _vpRenderCoreSection(v); return; }
    // A cancelled install is not a failure and must not be reported as one. The
    // killed CLI returns not-ok exactly like a real error would, so without this
    // the user's own deliberate stop came back as "Could not get the plugin."
    // Re-render instead: the tree is gone, so it lands on the honest
    // "not installed yet" state with an Install button. (2026-08-15)
    if (cancelled) {
      // Put the pin back where it was. Choosing a plugin and downloading it are
      // ONE action from the user's side - the pick is what starts the download -
      // so cancelling has to undo both halves. Leaving the pin on a plugin that
      // is now provably absent is the state that made the toolbar lie.
      //
      // `revertTo` is null when the install came from the Install button rather
      // than from a change: there the pin was already what the user wanted and
      // only the download was cancelled, so moving it would undo a decision they
      // never revisited. (2026-08-15)
      if (revertTo && revertTo !== pinned) {
        try {
          const back = await window.electronAPI.setCoreForVersion(v.name, revertTo);
          if (back && back.ok && back.appliedToActive) {
            window.onCoreVersionChanged?.(`Proffieboard Plugin changed to ${back.pinned} — recompile needed`);
          }
        } catch { /* the re-render below still shows the truth */ }
      }
      _vpRenderCoreSection(v);
      return;
    }
    // Failure is where the button earns its place: offline is the common case,
    // and the choice stays pinned so it can simply be retried later.
    paintStatus(pinned, false, avail.stale, current.newerAvailable,
                (res && res.error) || 'Could not get the plugin.', current.dormant);
  }

  function paintStatus(pinned, installed, stale, newerAvailable, failure, dormant) {
    // Keep the build toolbar honest. This panel is the only place that knows the
    // pinned plugin is absent, and the toolbar's indicator is a startup snapshot
    // that would otherwise keep saying "Toolchain ready" over a plugin the next
    // build has to download first. Only speaks for the version being BUILT with;
    // editing another version's pin must not change what the toolbar reports.
    // (2026-08-15)
    const activeVersion = document.getElementById('input-version')?.value || null;
    if (!activeVersion || activeVersion === v.name) {
      window.setToolchainPluginMissing?.(installed ? null : pinned);
    }
    const bits = [];
    // An install started by the MAIN process - ensureCore, at startup or on a
    // version switch - is running right now. "Not installed" is TRUE at this
    // instant and completely useless: the plugin is on its way, and the button
    // beside it offers to fetch what is already being fetched.
    //
    // Not merely disabled. doInstall refuses re-entry while the flag is set, so
    // the button was already inert - and an inert button is a dead click, which
    // reads as the app having stopped responding. Show the work instead, with
    // the same moving bar the panel's own installs use. (2026-08-15)
    // Either kind of install running in the main process: the startup/toolchain
    // one, or a background repair of this very plugin.
    const healing = window._backgroundPluginInstall &&
                    coreVersions_normalize(window._backgroundPluginInstall) === coreVersions_normalize(pinned);
    const mainInstalling = !installed && (!!window._coreInstallInFlight || !!healing);

    if (mainInstalling) {
      const flag  = window._coreInstallInFlight || window._backgroundPluginInstall;
      const which = typeof flag === 'string' ? flag : pinned;
      bits.push(
        `<span id="vp-core-phase" style="color:var(--c-text-dim);">` +
        `${_VP_PHASE.index} ${_vpEsc(which)}…</span>` +
        `<span class="vp-wait-track"><div class="bm-bar-knightrider"></div></span>`
      );
    } else if (!installed) {
      // NO "Install X" BUTTON, and no "not installed yet". (2026-08-15)
      //
      // "yet" claims the plugin was never here, and this panel cannot know that -
      // it may have been removed five minutes ago by another Arduino tool. Nor
      // can it say "anymore". So it states what IS true: not installed, and what
      // will happen about it.
      //
      // The button went for a plainer reason: it was never the thing that got a
      // plugin onto the machine. Installs fire on their own - when the pin
      // changes, at startup, and again the next time the toolchain initialises,
      // which is what quietly fixes it when a connection comes back. The button
      // duplicated all of that and only ever appeared in the window where it
      // could not work.
      //
      // "Try again" survives, because after a FAILURE the user has just been told
      // something went wrong and offering the retry is the coherent next move.
      // "missing" and "not installed" are different facts, and only the record
      // can tell them apart. Missing means JMT Studio put it here and something
      // took it away - a machine that has drifted. Not installed means it was
      // simply never fetched. Neither says what will happen next, because
      // offline that is not knowable. (2026-08-15)
      // Two facts, no story: it is expected, and it is not here. Saying it "was
      // installed by JMT Studio and has been removed since" names an agent and
      // an event we cannot know - hand deletion today, a backup restore that
      // omitted it tomorrow, or something else entirely. (2026-08-15)
      const absence = dormant
        ? `Proffieboard Plugin ${_vpEsc(pinned)} is expected but is not on this computer. ` +
          `Saved builds made with it are kept.`
        : `Proffieboard Plugin ${_vpEsc(pinned)} is not installed.`;
      bits.push(
        failure
          ? `<span style="color:var(--c-text-dim);">${absence}</span>` +
            `<span style="color:#e44;">${_vpEsc(failure)}</span>` +
            `<button class="vp-action-btn" id="vp-core-install">Try again</button>`
          : `<span style="color:var(--c-text-dim);">${absence}</span>`
      );
    } else {
      bits.push(`<span style="color:var(--c-text-dim);">Building with ${_vpEsc(pinned)}.</span>`);
    }
    // A fact, not a nudge. Someone pinned to 3.6 because 4.6 overflows their
    // board needs to know a newer release exists without being pushed toward a
    // build that cannot link for them, so this states it and offers nothing.
    // The dropdown above is how they take it, if they want it.
    if (newerAvailable) {
      bits.push(`<span style="color:var(--c-text-faint);">${_vpEsc(newerAvailable)} is available.</span>`);
    }
    // Said plainly rather than hidden, because "newest" from a cached list is a
    // claim we cannot currently stand behind.
    if (stale) {
      bits.push('<span style="color:var(--c-text-faint);">Could not reach the board index, so this list may be out of date.</span>');
    }
    status.innerHTML = bits.join('');

    // Follow the phases of an install we did not start. Without this the line
    // sat on "Checking" for the whole download, which is the static-label
    // problem the moving bar exists to avoid, just one level up.
    if (mainInstalling) {
      const flag2  = window._coreInstallInFlight || window._backgroundPluginInstall;
      const which2 = typeof flag2 === 'string' ? flag2 : pinned;
      _vpPhaseUnsub = window.electronAPI.onCoreInstallProgress?.(({ phase }) => {
        const t = document.getElementById('vp-core-phase');
        if (t && phase && _VP_PHASE[phase]) t.textContent = `${_VP_PHASE[phase]} ${which2}…`;
      }) || null;
    }

    document.getElementById('vp-core-install')
      // No revertTo: this button installs the pin the user is already on, so
      // cancelling stops a download without undoing a choice they did not just make.
      ?.addEventListener('click', () => doInstall(pinned));
  }

  paintStatus(current.pinned, current.installed, avail.stale, current.newerAvailable, null, current.dormant);

  // Picking a core IS asking for it. Making someone click Install afterwards is
  // asking them to confirm what they just said, so the only time that button is
  // the right answer is when getting it failed, or when the panel is merely
  // showing a pin that predates the tools being present.
  if (opts.autoInstall && !current.installed) doInstall(current.pinned, opts.revertTo || null);

  // Tracks the last committed selection so a cancelled or failed change can put
  // the control back. Reassigned on success: a value captured once at render
  // would revert to the original choice after the second change, not the last.
  let previousValue = sel.value;

  sel.addEventListener('change', async () => {
    const choice   = sel.value;
    const priorPin = previousValue;

    // Warn before the switch, not after. Changing the build tools changes the
    // cache key, so builds cached under the old ones stop being reachable.
    //
    // They are NOT deleted, and saying so matters. evictOldEntries is scoped to
    // one build-package directory, so compiling with the new tools only evicts
    // within their own directory, and the orphan sweep keeps anything whose
    // ProffieOS hash still matches an installed version AND whose tools are
    // still installed. Switching back therefore hits the old builds again.
    // Calling that "lost" would push people into copying things they do not need
    // to copy, and would make a reversible choice feel permanent.
    //
    // Stated from what is recorded, never estimated - the rule the Clear-cache
    // dialog set after an invented duration turned out to be wrong by 25x.
    const impact = await window.electronAPI
      .coreSwitchImpact(v.name, choice)
      .catch(() => null);

    if (impact && impact.ok && impact.changed && impact.losing > 0) {
      const one    = impact.losing === 1;
      const builds = one ? '1 cached build' : `${impact.losing} cached builds`;
      const lines  = [
        `<p>${builds} for <strong>${_vpEsc(v.name)}</strong> ` +
        `${one ? 'was' : 'were'} compiled with plugin ` +
        `<strong>${_vpEsc(impact.fromCore)}</strong> and cannot be reused with ` +
        `<strong>${_vpEsc(impact.toCore)}</strong>. The first compile of each config ` +
        `with the new plugin runs from scratch.</p>`,
        // The reassurance is the important half. Nothing is deleted, so this is
        // a reversible choice and nobody needs to copy anything to keep it.
        `<p style="color:var(--c-text-dim);">${one ? 'It is' : 'They are'} not deleted. ` +
        `Switch back to ${_vpEsc(impact.fromCore)} later and ${one ? 'it' : 'they'} ` +
        `will be reused again.</p>`,
      ];
      // Only claim a duration when one was actually recorded.
      if (impact.longestLosingMs != null) {
        const secs = Math.round(impact.longestLosingMs / 1000);
        const fmt  = window._sfFormatDuration ? window._sfFormatDuration(secs) : `${secs}s`;
        lines.push(`<p>The longest of those took <strong>${_vpEsc(fmt)}</strong> to build.</p>`);
      }
      if (impact.keeping > 0) {
        lines.push(`<p style="color:var(--c-text-dim);">${impact.keeping} build` +
                   `${impact.keeping === 1 ? '' : 's'} already cached against ` +
                   `${_vpEsc(impact.toCore)} will still be reused.</p>`);
      }
      if (!impact.installed) {
        lines.push(`<p style="color:var(--c-text-dim);">Plugin ${_vpEsc(impact.toCore)} ` +
                   `is not installed yet and will need to be downloaded.</p>`);
      }

      const go = await window.promptConfirm({
        title:       'Change the Proffieboard Plugin?',
        messageHtml: lines.join(''),
        confirmText: 'Change',
        confirmKind: 'danger',
      });
      if (!go) { sel.value = previousValue; return; }
    }

    sel.disabled = true;
    const res = await window.electronAPI.setCoreForVersion(v.name, choice);
    sel.disabled = false;
    if (!res || !res.ok) {
      sel.value = previousValue;
      status.innerHTML = `<span style="color:#e44;">${_vpEsc((res && res.error) || 'Could not save that choice.')}</span>`;
      return;
    }
    v.coreVersion = res.pinned;
    previousValue = sel.value;
    // Re-render rather than repaint: the newer-available line depends on what is
    // now pinned, and a stale one would claim an update exists after it is taken.
    // autoInstall, because reaching here means the user chose this core.
    // The pin before this change, so a cancelled download can put it back. It
    // has to travel through opts: the re-render replaces this closure, and
    // `previousValue` does not survive it.
    _vpRenderCoreSection(v, { autoInstall: true, revertTo: priorPin });

    // If this is the version being built with, the compiled state is now stale.
    // Drop it the same way a board or USB change does, or Flash stays armed
    // over a binary made by the previous tools.
    if (res.appliedToActive && window.onCoreVersionChanged) {
      window.onCoreVersionChanged(`Proffieboard Plugin changed to ${res.pinned} — recompile needed`);
    }
  });
}

function _vpInitVersionTree(versionName, container) {
  container.innerHTML = '';
  // Static ProffieOS root row — no toggle, always expanded
  const rootRow = document.createElement('div');
  rootRow.className = 'vp-tree-row vp-tree-dir vp-tree-root';
  rootRow.innerHTML = `
    <span class="vp-tree-toggle"></span>
    <span class="vp-tree-icon">📂</span>
    <span class="vp-tree-name" style="font-weight:600;color:var(--c-text-bright);">ProffieOS</span>
  `;
  const childWrap = document.createElement('div');
  childWrap.className = 'vp-tree-children';
  container.appendChild(rootRow);
  container.appendChild(childWrap);
  _vpLoadTree(versionName, 'ProffieOS', childWrap, 1);
}

async function _vpSearch(versionName, query, container) {
  container.innerHTML = '<div class="vp-tree-loading">Searching…</div>';
  const result = await window.electronAPI.searchVersionFiles(versionName, query);
  container.innerHTML = '';
  if (!result.ok) {
    container.innerHTML = `<div class="vp-tree-error">${_vpEsc(result.error)}</div>`;
    return;
  }
  if (result.results.length === 0) {
    container.innerHTML = '<div class="vp-tree-empty">No matches found.</div>';
    return;
  }

  // Summary line
  const nameCount    = result.results.filter(r => r.matchType === 'name').length;
  const contentCount = result.results.filter(r => r.matchType === 'content').length;
  const parts = [];
  if (nameCount)    parts.push(`${nameCount} name match${nameCount    !== 1 ? 'es' : ''}`);
  if (contentCount) parts.push(`${contentCount} file${contentCount !== 1 ? 's' : ''} with content`);
  const summary = document.createElement('div');
  summary.className = 'vp-search-summary';
  summary.textContent = parts.join(' · ');
  container.appendChild(summary);

  result.results.forEach(entry => {
    const row = document.createElement('div');
    row.className = `vp-tree-row vp-tree-${entry.type} vp-search-result`;
    row.style.paddingLeft = '10px';

    if (entry.type === 'dir') {
      row.innerHTML = `
        <span class="vp-tree-toggle"></span>
        <span class="vp-tree-icon">📁</span>
        <div class="vp-search-result-body">
          <span class="vp-tree-name">${_vpEsc(entry.path)}</span>
        </div>
      `;
    } else {
      const icon = _vpFileIcon(entry.name);
      const badge = entry.matchType === 'content'
        ? `<span class="vp-search-badge">${entry.matchCount} match${entry.matchCount !== 1 ? 'es' : ''}</span>`
        : '';
      const preview = entry.matchLine
        ? `<div class="vp-search-preview">${_vpEsc(entry.matchLine)}</div>`
        : '';
      row.innerHTML = `
        <span class="vp-tree-toggle"></span>
        <span class="vp-tree-file-icon">${icon}</span>
        <div class="vp-search-result-body">
          <div class="vp-search-result-top">
            <span class="vp-tree-name">${_vpEsc(entry.path)}</span>
            ${badge}
            <span class="vp-tree-size">${entry.size != null ? _vpFmtBytes(entry.size) : ''}</span>
          </div>
          ${preview}
        </div>
      `;
      row.title = `Click to view ${entry.name}`;
      row.addEventListener('click', () => _vpOpenFile(versionName, entry.path, entry.name, query));
      _vpAttachPropCtxMenu(row, entry.path, entry.name, versionName);
    }
    container.appendChild(row);
  });

  if (result.results.length >= 300) {
    const cap = document.createElement('div');
    cap.className = 'vp-tree-empty';
    cap.textContent = 'Results capped at 300. Narrow your search.';
    container.appendChild(cap);
  }
}

// ── File tree ──────────────────────────────────────────

async function _vpLoadTree(versionName, subPath, container, depth) {
  container.innerHTML = '<div class="vp-tree-loading">Loading…</div>';
  const result = await window.electronAPI.listVersionDir(versionName, subPath);
  container.innerHTML = '';

  if (!result.ok) {
    container.innerHTML = `<div class="vp-tree-error">${_vpEsc(result.error)}</div>`;
    return;
  }

  result.entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = `vp-tree-row vp-tree-${entry.type}`;
    row.style.paddingLeft = `${depth * 16 + 10}px`;

    if (entry.type === 'dir') {
      row.innerHTML = `
        <span class="vp-tree-toggle">▶</span>
        <span class="vp-tree-icon dir-icon">📁</span>
        <span class="vp-tree-name">${_vpEsc(entry.name)}</span>
      `;
      const childWrap = document.createElement('div');
      childWrap.className = 'vp-tree-children';
      childWrap.style.display = 'none';
      let loaded = false;

      row.addEventListener('click', async () => {
        const expanded = row.dataset.expanded === '1';
        if (!expanded) {
          row.dataset.expanded = '1';
          row.querySelector('.vp-tree-toggle').textContent = '▼';
          row.querySelector('.dir-icon').textContent = '📂';
          if (!loaded) {
            loaded = true;
            const childPath = subPath ? `${subPath}/${entry.name}` : entry.name;
            await _vpLoadTree(versionName, childPath, childWrap, depth + 1);
          }
          childWrap.style.display = 'block';
        } else {
          row.dataset.expanded = '0';
          row.querySelector('.vp-tree-toggle').textContent = '▶';
          row.querySelector('.dir-icon').textContent = '📁';
          childWrap.style.display = 'none';
        }
      });

      container.appendChild(row);
      container.appendChild(childWrap);
    } else {
      const icon = _vpFileIcon(entry.name);
      row.innerHTML = `
        <span class="vp-tree-toggle"></span>
        <span class="vp-tree-file-icon">${icon}</span>
        <span class="vp-tree-name">${_vpEsc(entry.name)}</span>
        <span class="vp-tree-size">${entry.size != null ? _vpFmtBytes(entry.size) : ''}</span>
      `;
      const filePath = subPath ? `${subPath}/${entry.name}` : entry.name;
      row.title = `Click to view ${entry.name}`;
      row.addEventListener('click', () => _vpOpenFile(versionName, filePath, entry.name));
      _vpAttachPropCtxMenu(row, filePath, entry.name, versionName);
      container.appendChild(row);
    }
  });

  if (result.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vp-tree-empty';
    empty.style.paddingLeft = `${(depth + 1) * 16 + 10}px`;
    empty.textContent = '(empty)';
    container.appendChild(empty);
  }
}

// ── File viewer ────────────────────────────────────────

// The prop currently open in the viewer as { filePath, versionName }, or null.
// versionName matters because the tree can be browsing a version the config does
// not build with. Read by the Link Prop button in index.html.
let _vpViewerProp = null;

// Link Prop is only offered for a prop header, and only when there is a config
// open for it to be written into.
function _vpUpdateLinkPropBtn() {
  const btn = document.getElementById('vp-file-modal-link-prop-btn');
  if (!btn) return;
  const eligible = !!_vpViewerProp && !!(window.isConfigOpen && window.isConfigOpen());
  btn.style.display = eligible ? '' : 'none';
}

async function _vpOpenFile(versionName, filePath, fileName, searchQuery) {
  const modal    = document.getElementById('vp-file-modal');
  const titleEl  = document.getElementById('vp-file-modal-title');
  const editorEl = document.getElementById('vp-file-modal-editor');

  _vpViewerProp = (window._isLinkablePropPath && window._isLinkablePropPath(filePath))
    ? { filePath, versionName }
    : null;
  _vpUpdateLinkPropBtn();

  titleEl.textContent = filePath;
  modal.classList.add('active');
  editorEl.innerHTML = '<div style="padding:20px;color:var(--c-text-muted);font-size:0.82rem;">Loading…</div>';

  // Dispose previous editor
  if (_vpFileViewer) { _vpFileViewer.dispose(); _vpFileViewer = null; }

  const result = await window.electronAPI.readVersionFile(versionName, filePath);
  editorEl.innerHTML = '';

  if (!result.ok) {
    editorEl.innerHTML = `<div style="padding:20px;color:#e44;font-size:0.82rem;">${_vpEsc(result.error)}</div>`;
    return;
  }

  const isDark = !document.documentElement.classList.contains('light-mode');
  _vpFileViewer = monaco.editor.create(editorEl, {
    value: result.content,
    language: _vpLang(fileName),
    theme: isDark ? 'vs-dark' : 'vs',
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 13,
    lineNumbers: 'on',
    wordWrap: 'off',
    find: { seedSearchStringFromSelection: 'always' },
  });

  // If opened from a search result, select first match so Monaco seeds the find widget from it.
  if (searchQuery) {
    requestAnimationFrame(() => {
      if (!_vpFileViewer) return;
      const editor = _vpFileViewer;
      const model  = editor.getModel();
      if (!model) return;

      const matches = model.findMatches(searchQuery, true, false, false, null, false, 1);
      const firstMatch = matches[0];
      if (firstMatch) {
        editor.setSelection(firstMatch.range);
        editor.revealRangeInCenter(firstMatch.range);
      }
      editor.focus();
      editor.getAction('actions.find')?.run();
    });
  }
}

function _vpCloseFileModal() {
  document.getElementById('vp-file-modal').classList.remove('active');
  if (_vpFileViewer) { _vpFileViewer.dispose(); _vpFileViewer = null; }
  _vpViewerProp = null;
  _vpUpdateLinkPropBtn();
}

// Right-click a prop header in the tree to link it without opening it first.
// Reuses the shared preset-ctx-menu DOM every other browser in the app uses,
// including its mousedown-to-activate convention.
function _vpAttachPropCtxMenu(row, filePath, fileName, versionName) {
  if (!window._isLinkablePropPath || !window._isLinkablePropPath(filePath)) return;
  row.addEventListener('contextmenu', e => {
    // Nothing to link it into, so offer nothing rather than a dead item.
    if (!(window.isConfigOpen && window.isConfigOpen())) return;
    e.preventDefault();
    const menu = document.getElementById('preset-ctx-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const item = document.createElement('div');
    item.className   = 'preset-ctx-item';
    item.textContent = `\u{1F517} Link ${fileName} as this config's prop`;
    item.addEventListener('mousedown', ev => {
      ev.stopPropagation();
      menu.style.display = 'none';
      if (window._linkPropFromVersion) window._linkPropFromVersion(filePath, versionName);
    });
    menu.appendChild(item);
    menu.style.left = Math.min(e.clientX, window.innerWidth - 320) + 'px';
    menu.style.top  = Math.min(e.clientY, window.innerHeight - 60) + 'px';
    menu.style.display = 'block';
  });
}

// ── Version actions ────────────────────────────────────

function _vpDuplicate(v) {
  // Hand off to the import modal running in duplicate mode
  if (window.openImportVersionModalForDuplicate) {
    window.openImportVersionModalForDuplicate(v.name);
  }
}

async function _vpExport(v) {
  const result = await window.electronAPI.exportVersion(v.name);
  if (!result.ok && result.error !== 'cancelled') {
    // No native-alert fallback: this file is lazy-loaded from index.html
    // (index.html:33923), which defines promptError long before the panel exists.
    window.promptError('Export failed', result.error);
  }
  // On success, shell.showItemInFolder is called from main process
}

function _vpRename(v) {
  const nameEl = document.querySelector('.vp-detail-name');
  if (!nameEl || nameEl.dataset.renaming) return;
  nameEl.dataset.renaming = '1';

  const original = v.name;
  const wrap = nameEl.parentElement;

  const input = document.createElement('input');
  input.value = original;
  input.style.cssText = 'flex:1;font-size:1.05rem;font-weight:700;padding:2px 6px;background:var(--c-bg-inset);border:1px solid var(--c-border-strong);border-radius:3px;color:var(--c-text-bright);outline:none;min-width:0;';

  const confirm = document.createElement('button');
  confirm.textContent = '✓';
  confirm.className   = 'vp-action-btn primary';
  confirm.style.cssText = 'padding:2px 8px;font-size:0.8rem;';

  const cancel = document.createElement('button');
  cancel.textContent = '✕';
  cancel.className   = 'vp-action-btn';
  cancel.style.cssText = 'padding:2px 8px;font-size:0.8rem;';

  const errEl = document.createElement('span');
  errEl.style.cssText = 'font-size:0.75rem;color:#e44;margin-left:6px;';

  nameEl.replaceWith(input);
  wrap.appendChild(confirm);
  wrap.appendChild(cancel);
  wrap.appendChild(errEl);
  input.focus();
  input.select();

  const finish = () => {
    confirm.remove(); cancel.remove(); errEl.remove();
    input.replaceWith(nameEl);
    delete nameEl.dataset.renaming;
  };

  const doRename = async () => {
    const trimmed = input.value.trim();
    if (!trimmed || trimmed === original) { finish(); return; }
    confirm.disabled = cancel.disabled = true;
    const result = await window.electronAPI.renameVersion(original, trimmed);
    if (result.ok) {
      _vpSelected = { ...v, name: result.newName };
      finish();
      await vpRefresh();
      window.vpSelectVersion(result.newName);
      if (window.refreshVersionDropdown) {
        const verSel = document.getElementById('input-version');
        const currentSel = verSel?.value;
        await window.refreshVersionDropdown(currentSel === original ? result.newName : currentSel);
      }
    } else {
      errEl.textContent = result.error;
      confirm.disabled = cancel.disabled = false;
      input.focus();
    }
  };

  confirm.addEventListener('click', doRename);
  cancel.addEventListener('click', finish);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  doRename();
    if (e.key === 'Escape') finish();
  });
}

function _vpDelete(v) {
  const panel = document.getElementById('vp-jmt-panel');
  if (!panel) return;

  panel.style.display = '';
  panel.innerHTML = `
    <div style="margin-bottom:10px;"><strong>Delete "${_vpEsc(v.name)}"?</strong></div>
    <div style="font-size:0.8rem;color:var(--c-text-sub);margin-bottom:12px;">This will permanently remove the version folder and cannot be undone.</div>
    <div style="display:flex;gap:8px;">
      <button id="vp-del-confirm" class="vp-action-btn danger">Delete</button>
      <button id="vp-del-cancel"  class="vp-action-btn">Cancel</button>
      <span   id="vp-del-error"   style="font-size:0.78rem;color:#e44;"></span>
    </div>
  `;

  document.getElementById('vp-del-cancel').addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML = '';
  });

  document.getElementById('vp-del-confirm').addEventListener('click', async () => {
    document.getElementById('vp-del-confirm').disabled = true;
    document.getElementById('vp-del-cancel').disabled  = true;
    const result = await window.electronAPI.deleteVersion(v.name);
    if (result.ok) {
      _vpSelected = null;
      await vpRefresh();
      if (window.refreshVersionDropdown) await window.refreshVersionDropdown();
    } else {
      document.getElementById('vp-del-error').textContent = result.error;
      document.getElementById('vp-del-confirm').disabled = false;
      document.getElementById('vp-del-cancel').disabled  = false;
    }
  });
}

// ── JMT Features flow ──────────────────────────────────

function _vpJmtWireConfirm(v, btn, panel, isFirstTime, isMajorUpdate) {
  const _setAllDisabled = (disabled) => {
    ['vp-jmt-copy-update', 'vp-jmt-confirm', 'vp-jmt-cancel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  };

  document.getElementById('vp-jmt-cancel')?.addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML     = '';
    btn.disabled        = false;
  });

  if (isMajorUpdate) {
    document.getElementById('vp-jmt-copy-update')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('vp-jmt-status');
      _setAllDisabled(true);
      if (statusEl) statusEl.textContent = 'Creating backup...';
      const backupName = v.name + ' (backup)';
      const dupResult = await window.electronAPI.duplicateVersion(v.name, backupName);
      if (!dupResult.ok) {
        if (statusEl) statusEl.textContent = 'Backup failed: ' + dupResult.error;
        _setAllDisabled(false);
        return;
      }
      if (statusEl) statusEl.textContent = 'Backup created. Applying update...';
      _vpDoApply(v, btn, panel, isFirstTime, (applyResult) => {
        panel.innerHTML = `<span style="color:#4a4;">✓ Backup created and JMT Add-ons v${_vpEsc(applyResult.jmtVersion)} applied successfully.</span>`;
        setTimeout(async () => {
          panel.style.display = 'none';
          panel.innerHTML = '';
          if (window.vpRefresh) await window.vpRefresh();
          if (window.refreshVersionDropdown) await window.refreshVersionDropdown();
        }, 3000);
      });
    });
  }

  document.getElementById('vp-jmt-confirm')?.addEventListener('click', () => {
    _setAllDisabled(true);
    _vpDoApply(v, btn, panel, isFirstTime);
  });
}

async function _vpDoApply(v, btn, panel, isFirstTime, onSuccess) {
  const statusEl = document.getElementById('vp-jmt-status');

  const unsub = window.electronAPI.onJmtProgress(({ file, done, total }) => {
    if (statusEl) statusEl.textContent = `${done}/${total}: ${file}`;
  });

  const applyResult = await window.electronAPI.applyJmtFeatures(v.name);
  unsub();

  if (!applyResult.ok) {
    panel.innerHTML = `<span style="color:#e44;">Failed: ${_vpEsc(applyResult.error)}</span>`;
    btn.disabled = false;
    return;
  }

  v.jmtVersion    = applyResult.jmtVersion;
  btn.disabled    = false;
  btn.textContent = '⚙ Check for Updates';

  const labelEl = document.getElementById('vp-jmt-version-label');
  if (labelEl) {
    labelEl.textContent = `Includes JMT Add-ons v${applyResult.jmtVersion}`;
    labelEl.style.display = '';
  }

  if (isFirstTime && !v.name.includes('+JMT')) {
    // Pick the first available `+JMT` / `+JMT2` / `+JMT3` … name. If the user already
    // has a folder named `<v.name> +JMT` (e.g. an earlier copy of the same version
    // that's already JMT-tagged), the rename collides — fall forward to a numbered
    // suffix instead of silently failing and leaving the version with its original
    // un-tagged name (which previously caused the toolbar "Link JMT Add-ons" button
    // to not pick up the new state on the next config switch).
    let renameResult = null;
    for (let n = 1; n <= 99; n++) {
      const candidate = n === 1 ? `${v.name} +JMT` : `${v.name} +JMT${n}`;
      renameResult    = await window.electronAPI.renameVersion(v.name, candidate);
      if (renameResult.ok) break;
      // Only retry on name-collision errors — bail on permission / validation issues
      // where another attempt won't help.
      if (!/already exists/i.test(renameResult.error || '')) break;
    }
    if (renameResult?.ok) {
      _vpSelected = { ...v, name: renameResult.newName, jmtVersion: applyResult.jmtVersion };
      await vpRefresh();
      window.vpSelectVersion(renameResult.newName);
      if (window.refreshVersionDropdown) {
        const verSel = document.getElementById('input-version');
        const currentSel = verSel?.value;
        await window.refreshVersionDropdown(currentSel === v.name ? renameResult.newName : currentSel);
      }
    }
  }

  // Apply changed files on disk — any active file-browser search is now potentially
  // stale (results may reference deleted files, or miss newly-added ones). Clear the
  // search input and re-initialize the tree against the current state so the user
  // isn't reading invalidated data. For first-time + rename, vpRefresh already
  // rebuilt the detail view, so these elements are fresh — the calls are no-ops.
  const _searchEl    = document.getElementById('vp-search');
  const _searchClear = document.getElementById('vp-search-clear');
  const _treeEl      = document.getElementById('vp-tree');
  if (_searchEl) {
    _searchEl.value = '';
    if (_searchClear) _searchClear.style.display = 'none';
  }
  if (_treeEl) _vpInitVersionTree(_vpSelected?.name || v.name, _treeEl);

  // The just-applied version's source files changed — main.js already invalidated
  // its cached folder hash. If this version is the one the build panel is currently
  // compiling against, re-run the same recheck the OS-version dropdown does so the
  // Compile button picks up the new buildPkg identity. Skip when modifying a
  // non-active version (its compile state isn't affected).
  try {
    // getSelectedVersion's IPC returns `{ name }`, not a bare string — comparing
    // the object directly to `modifiedName` is always false, which silently
    // disabled the post-apply invalidate hook. Pull the name out explicitly.
    const activeSel    = await window.electronAPI.getSelectedVersion();
    const activeName   = activeSel?.name || null;
    const modifiedName = _vpSelected?.name || v.name;
    if (activeName && activeName === modifiedName && typeof window.onOsVersionChange === 'function') {
      window.onOsVersionChange();
    }
  } catch {}

  if (onSuccess) {
    onSuccess(applyResult);
  } else {
    panel.innerHTML = `<span style="color:#4a4;">✓ JMT Add-ons v${_vpEsc(applyResult.jmtVersion)} ${isFirstTime ? 'added' : 'updated'} successfully.</span>`;
    setTimeout(() => { panel.style.display = 'none'; panel.innerHTML = ''; }, 3000);
  }
}

async function _vpJmtFlow(v) {
  const panel  = document.getElementById('vp-jmt-panel');
  const btn    = document.getElementById('vp-btn-jmt');
  if (!panel || !btn) return;

  btn.disabled   = true;
  panel.style.display = '';
  panel.innerHTML = '<span style="color:var(--c-text-sub);">Fetching manifest…</span>';

  const result = await window.electronAPI.fetchJmtManifest();
  if (!result.ok) {
    panel.innerHTML = `<span style="color:#e44;">Could not fetch JMT manifest: ${_vpEsc(result.error)}</span>`;
    btn.disabled = false;
    return;
  }

  const manifest      = result.manifest;
  const installedVer  = v.jmtVersion || null;
  const hasUpdate     = installedVer && _semverCompare(manifest.version, installedVer) > 0;
  const isFirstTime   = !installedVer;
  const proffieVer    = v.proffieVersion || null;

  // Studio version gate — addons can require a minimum JMT Studio version when a
  // release introduces coupling Studio must know about (new hardcoded guard symbol,
  // changed manifest schema, etc.). Null / missing means no requirement. Hard refusal:
  // the Studio code that would handle the addon's contract doesn't exist yet.
  if (manifest.minStudioVersion) {
    let studioVer = null;
    try { studioVer = await window.electronAPI.getAppVersion(); } catch {}
    if (studioVer && _semverCompare(studioVer, manifest.minStudioVersion) < 0) {
      panel.innerHTML = `<span style="color:#e44;">⛔ Requires JMT Studio ${_vpEsc(manifest.minStudioVersion)} or higher. Current version is ${_vpEsc(studioVer)}. Update JMT Studio first.</span>`;
      btn.disabled = false;
      return;
    }
  }

  // Compatibility
  let compatHtml = '';
  if (!proffieVer) {
    compatHtml = `<div style="color:var(--c-text-dim);margin-bottom:8px;">⚠ ProffieOS version unknown — cannot verify compatibility.</div>`;
  } else if (_semverCompare(proffieVer, manifest.minProffieVersion) < 0) {
    panel.innerHTML = `<span style="color:#e44;">⛔ Requires ProffieOS ${_vpEsc(manifest.minProffieVersion)} or higher. This version is ${_vpEsc(proffieVer)}.</span>`;
    btn.disabled = false;
    return;
  } else if (_semverCompare(proffieVer, manifest.testedUpTo) > 0) {
    compatHtml = `<div style="color:#c90;margin-bottom:8px;">⚠ Not yet tested with ProffieOS ${_vpEsc(proffieVer)} (tested up to ${_vpEsc(manifest.testedUpTo)}). Proceed at your own risk.</div>`;
  } else {
    compatHtml = `<div style="color:#4a4;margin-bottom:8px;">✓ Compatible with ProffieOS ${_vpEsc(proffieVer)}.</div>`;
  }

  // Always fetch integrity so toRemove is available even when the manifest has no
  // hashes. `bad` is only meaningful when hashes exist; toRemove just needs the path
  // list, which is always present.
  const integrity   = await window.electronAPI.checkJmtIntegrity(v.name, manifest.files);
  const hasHashes   = manifest.files.some(f => f.sha256);
  const bad         = (integrity.ok && hasHashes) ? integrity.results.filter(r => r.status !== 'ok') : [];
  const toRemove    = integrity.ok ? (integrity.toRemove || []) : [];
  const removeListHtml = toRemove.length > 0
    ? `<div style="color:#c90;margin-bottom:6px;">The following file${toRemove.length > 1 ? 's are' : ' is'} no longer part of JMT Add-ons and will be removed:</div>
       <ul style="margin:0 0 12px 16px;padding:0;font-size:0.78rem;">${toRemove.map(p => `<li style="color:var(--c-text-sub);margin:2px 0;">${_vpEsc(p)}</li>`).join('')}</ul>`
    : '';

  if (!isFirstTime && !hasUpdate) {
    if (bad.length > 0 || toRemove.length > 0) {
      const badHtml = bad.length > 0
        ? `<div style="color:#c90;margin-bottom:8px;">⚠ ${bad.length} JMT file${bad.length > 1 ? 's have' : ' has'} been modified or is missing:</div>
           <ul style="margin:0 0 12px 16px;padding:0;font-size:0.78rem;">${bad.map(r => `<li style="color:var(--c-text-sub);margin:2px 0;">${_vpEsc(r.path)} <span style="color:#e44;">(${r.status})</span></li>`).join('')}</ul>`
        : '';
      panel.innerHTML = `
        ${compatHtml}
        ${badHtml}
        ${removeListHtml}
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="vp-jmt-confirm" class="vp-action-btn primary">Reinstall</button>
          <button id="vp-jmt-cancel"  class="vp-action-btn">Cancel</button>
          <span   id="vp-jmt-status"  style="font-size:0.78rem;color:var(--c-text-sub);"></span>
        </div>`;
      _vpJmtWireConfirm(v, btn, panel, false);
      return;
    }
    panel.innerHTML = `${compatHtml}<span style="color:var(--c-text-sub);">JMT Add-ons v${_vpEsc(installedVer)} is up to date.</span>`;
    btn.disabled = false;
    return;
  }

  const action   = isFirstTime ? 'Add' : 'Update';
  const fromTo   = isFirstTime ? `v${_vpEsc(manifest.version)}` : `v${_vpEsc(installedVer)} → v${_vpEsc(manifest.version)}`;
  const fileList = manifest.files.map(f => `<li style="color:var(--c-text-sub);margin:2px 0;">${_vpEsc(f.path)}</li>`).join('');

  const installedMajor = installedVer ? parseInt(installedVer.split('.')[0], 10) : null;
  const manifestMajor  = parseInt(manifest.version.split('.')[0], 10);
  const isMajorUpdate  = !isFirstTime && installedMajor !== null && manifestMajor > installedMajor;

  const majorWarnHtml = isMajorUpdate
    ? `<div style="color:#c90;margin-bottom:8px;font-size:0.8rem;">⚠ This is a major version update. Your existing configs may reference features that have changed — review them after updating.</div>`
    : '';

  const overwriteNote = !isFirstTime
    ? `<div style="margin-bottom:12px;font-size:0.75rem;color:var(--c-text-dim);font-style:italic;">Existing JMT files will be overwritten. Your ProffieOS source files are not modified.</div>`
    : `<div style="margin-bottom:12px;font-size:0.75rem;color:var(--c-text-dim);font-style:italic;">These files do not modify existing ProffieOS source files and are only used if included in a config. Any existing copies will be replaced.</div>`;

  // What's New — render changelog entries newer than installedVer (and ≤ manifest.version)
  // so the user can see what they're getting before clicking Update. Skipped for first-time
  // installs (no anchor version to filter from) and when the manifest doesn't carry a
  // changelog field (graceful degradation for older manifests).
  let releaseNotesHtml = '';
  if (!isFirstTime && Array.isArray(manifest.changelog) && manifest.changelog.length > 0) {
    const relevant = manifest.changelog
      .filter(c => c && c.version
        && _semverCompare(c.version, installedVer)    > 0
        && _semverCompare(c.version, manifest.version) <= 0)
      .sort((a, b) => _semverCompare(b.version, a.version));
    if (relevant.length > 0) {
      const entries = relevant.map(c => `
        <div style="margin-bottom:8px;">
          <div style="font-size:0.78rem;font-weight:600;color:var(--c-text);">v${_vpEsc(c.version)}${c.date ? ` <span style="color:var(--c-text-dim);font-weight:400">— ${_vpEsc(c.date)}</span>` : ''}</div>
          <div style="font-size:0.75rem;color:var(--c-text-sub);white-space:pre-wrap;margin-top:2px;">${_vpEsc(c.notes || '').replace(/\n/g, '<br>')}</div>
        </div>`).join('');
      releaseNotesHtml = `
        <div style="margin-bottom:12px;border:1px solid var(--c-border);border-radius:4px;padding:8px 10px;background:var(--c-bg-inset);">
          <div style="font-size:0.7rem;color:var(--c-text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;">What's New</div>
          ${entries}
        </div>`;
    }
  }

  panel.innerHTML = `
    ${compatHtml}
    ${majorWarnHtml}
    <div style="margin-bottom:8px;"><strong>${action} JMT Add-ons ${fromTo}</strong></div>
    ${releaseNotesHtml}
    <div style="margin-bottom:8px;color:var(--c-text-dim);font-size:0.78rem;">The following files will be ${isFirstTime ? 'added to' : 'updated in'} this ProffieOS version:</div>
    <ul style="margin:0 0 8px 16px;padding:0;font-size:0.78rem;">${fileList}</ul>
    ${removeListHtml}
    ${overwriteNote}
    <div style="display:flex;gap:8px;align-items:center;">
      ${isMajorUpdate ? `<button id="vp-jmt-copy-update" class="vp-action-btn primary">Copy &amp; Update</button>` : ''}
      <button id="vp-jmt-confirm" class="vp-action-btn${isMajorUpdate ? '' : ' primary'}">${action}</button>
      <button id="vp-jmt-cancel"  class="vp-action-btn">Cancel</button>
      <span   id="vp-jmt-status"  style="font-size:0.78rem;color:var(--c-text-sub);"></span>
    </div>
  `;

  _vpJmtWireConfirm(v, btn, panel, isFirstTime, isMajorUpdate);
}

// ── Exports ────────────────────────────────────────────

window.initVersionsPanel = initVersionsPanel;
window.vpRefresh         = vpRefresh;
window.vpCloseFileModal  = _vpCloseFileModal;
window.vpOpenFind        = () => { if (_vpFileViewer) _vpFileViewer.trigger('keyboard', 'actions.find', null); };
window.vpViewerProp      = () => _vpViewerProp;
window.vpSelectVersion   = (name) => {
  const v = _vpVersions.find(x => x.name === name);
  if (v) _vpSelectVersion(v);
};
window.vpSelectedName    = () => _vpSelected?.name || null;
window.vpHasUnsavedNotes = () => _vpNotesDirty;
window.vpSaveCurrentNotes = _vpDoSaveNotes;

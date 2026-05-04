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
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
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
  if (saveBtn) { saveBtn.textContent = 'Save Notes'; saveBtn.disabled = notesEl.value === _vpNotesOriginal; }
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
  _vpVersions = versions;
  _vpRenderCards();
  const preferred = preferName ? versions.find(v => v.name === preferName) : null;
  const still     = _vpSelected ? versions.find(v => v.name === _vpSelected.name) : null;
  _vpSelectVersion(preferred || still || versions[0] || null);
}

// ── Cards ──────────────────────────────────────────────

function _vpRenderCards() {
  const list = document.getElementById('vp-list');
  if (!list) return;
  list.innerHTML = '';

  if (_vpVersions.length === 0) {
    list.innerHTML = '<div class="vp-empty-list">No versions installed.</div>';
    return;
  }

  _vpVersions.forEach(v => {
    const card = document.createElement('div');
    card.className = 'vp-card' + (v.name === _vpSelected?.name ? ' active' : '');
    card.dataset.name = v.name;
    card.innerHTML = `
      <div class="vp-card-top">
        <span class="vp-card-name">${_vpEsc(v.name)}</span>
      </div>
      <div class="vp-card-meta">
        <span class="vp-card-size">${_vpFmtBytes(v.size)}</span>
        ${v.modified ? `<span class="vp-card-date">${_vpFmtDate(v.modified)}</span>` : ''}
      </div>
      ${v.proffieVersion ? `<div class="vp-card-proffie-ver">ProffieOS ${_vpEsc(v.proffieVersion)}</div>` : ''}
      ${v.notesPreview ? `<div class="vp-card-notes-preview">${_vpEsc(v.notesPreview)}</div>` : ''}
    `;
    card.addEventListener('click', async () => {
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
    pane.innerHTML = '<div class="vp-no-selection">Select a version to view details.</div>';
    return;
  }

  const notesVal = _vpEsc(v.notes || '');
  _vpNotesOriginal = v.notes || '';

  pane.innerHTML = `
    <div class="vp-detail-header">
      <div class="vp-detail-title-row">
        <h2 class="vp-detail-name">${_vpEsc(v.name)}</h2>
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
      <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
        ${v.jmtVersion ? `<span id="vp-jmt-version-label" style="font-size:0.75rem;color:var(--c-text-dim);">Includes JMT Add-ons v${_vpEsc(v.jmtVersion)}</span>` : '<span id="vp-jmt-version-label" style="display:none;font-size:0.75rem;color:var(--c-text-dim);"></span>'}
        <button class="vp-action-btn vp-jmt-btn" id="vp-btn-jmt" title="${v.jmtVersion ? 'Check for updates to JMT add-on files' : 'Add JMT add-on files to this version'}">
          ${v.jmtVersion ? '⚙ Check for Updates' : '⚙ Add JMT Features'}
        </button>
      </div>
    </div>

    <div id="vp-jmt-panel" style="display:none;margin-bottom:18px;padding:12px;background:var(--c-bg-inset);border:1px solid var(--c-border);border-radius:5px;font-size:0.82rem;"></div>

    <div class="vp-section">
      <div class="vp-section-label">Notes</div>
      <textarea id="vp-notes" class="vp-notes-editor" spellcheck="false" placeholder="Add notes about this version — changes, known issues, source, etc.">${notesVal}</textarea>
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
    saveBtn.textContent = 'Saving…';
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
    saveBtn.textContent = 'Save Notes';
    saveBtn.disabled = notesEl.value === _vpNotesOriginal;
  });

  // Action buttons
  document.getElementById('vp-btn-duplicate')?.addEventListener('click', () => _vpDuplicate(v));
  document.getElementById('vp-btn-open-folder')?.addEventListener('click', () => window.electronAPI.openVersionFolder(v.name));
  document.getElementById('vp-btn-export')?.addEventListener('click', () => _vpExport(v));
  document.getElementById('vp-btn-rename')?.addEventListener('click', () => _vpRename(v));
  document.getElementById('vp-btn-delete')?.addEventListener('click', () => _vpDelete(v));
  document.getElementById('vp-btn-jmt')?.addEventListener('click', () => _vpJmtFlow(v));

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
    }
    container.appendChild(row);
  });

  if (result.results.length >= 300) {
    const cap = document.createElement('div');
    cap.className = 'vp-tree-empty';
    cap.textContent = 'Results capped at 300 — narrow your search.';
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
      row.title = `Click to view ${entry.name}`;
      row.addEventListener('click', () => {
        const filePath = subPath ? `${subPath}/${entry.name}` : entry.name;
        _vpOpenFile(versionName, filePath, entry.name);
      });
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

async function _vpOpenFile(versionName, filePath, fileName, searchQuery) {
  const modal    = document.getElementById('vp-file-modal');
  const titleEl  = document.getElementById('vp-file-modal-title');
  const editorEl = document.getElementById('vp-file-modal-editor');

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
    alert(`Export failed: ${result.error}`);
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
    if (statusEl) statusEl.textContent = `${done}/${total} — ${file}`;
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
    const newName      = `${v.name} +JMT`;
    const renameResult = await window.electronAPI.renameVersion(v.name, newName);
    if (renameResult.ok) {
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

  if (!isFirstTime && !hasUpdate) {
    if (manifest.files.some(f => f.sha256)) {
      const integrity = await window.electronAPI.checkJmtIntegrity(v.name, manifest.files);
      const bad = integrity.ok ? integrity.results.filter(r => r.status !== 'ok') : [];
      if (bad.length > 0) {
        const badList = bad.map(r => `<li style="color:var(--c-text-sub);margin:2px 0;">${_vpEsc(r.path)} <span style="color:#e44;">(${r.status})</span></li>`).join('');
        panel.innerHTML = `
          ${compatHtml}
          <div style="color:#c90;margin-bottom:8px;">⚠ ${bad.length} JMT file${bad.length > 1 ? 's have' : ' has'} been modified or is missing:</div>
          <ul style="margin:0 0 12px 16px;padding:0;font-size:0.78rem;">${badList}</ul>
          <div style="display:flex;gap:8px;align-items:center;">
            <button id="vp-jmt-confirm" class="vp-action-btn primary">Reinstall</button>
            <button id="vp-jmt-cancel"  class="vp-action-btn">Cancel</button>
            <span   id="vp-jmt-status"  style="font-size:0.78rem;color:var(--c-text-sub);"></span>
          </div>`;
        _vpJmtWireConfirm(v, btn, panel, false);
        return;
      }
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

  panel.innerHTML = `
    ${compatHtml}
    ${majorWarnHtml}
    <div style="margin-bottom:8px;"><strong>${action} JMT Add-ons ${fromTo}</strong></div>
    <div style="margin-bottom:8px;color:var(--c-text-dim);font-size:0.78rem;">The following files will be ${isFirstTime ? 'added to' : 'updated in'} this ProffieOS version:</div>
    <ul style="margin:0 0 8px 16px;padding:0;font-size:0.78rem;">${fileList}</ul>
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
window.vpSelectVersion   = (name) => {
  const v = _vpVersions.find(x => x.name === name);
  if (v) _vpSelectVersion(v);
};
window.vpSelectedName    = () => _vpSelected?.name || null;
window.vpHasUnsavedNotes = () => _vpNotesDirty;
window.vpSaveCurrentNotes = _vpDoSaveNotes;

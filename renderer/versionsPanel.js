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
        ${v.isBuiltIn ? '<span class="vp-badge">Built-in</span>' : ''}
      </div>
      <div class="vp-card-meta">
        <span class="vp-card-size">${_vpFmtBytes(v.size)}</span>
        ${v.modified ? `<span class="vp-card-date">${_vpFmtDate(v.modified)}</span>` : ''}
      </div>
      ${v.notesPreview ? `<div class="vp-card-notes-preview">${_vpEsc(v.notesPreview)}</div>` : ''}
    `;
    card.addEventListener('click', () => _vpSelectVersion(v));
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
        ${v.isBuiltIn ? '<span class="vp-badge builtin-lg" title="Bundled with JMT Studio — cannot be renamed or deleted">Built-in</span>' : ''}
      </div>
      <div class="vp-detail-stats">
        <span>${_vpFmtBytes(v.size)}</span>
        ${v.modified ? `<span>·</span><span>Modified ${_vpFmtDate(v.modified)}</span>` : ''}
        <span>·</span><span class="vp-detail-source">${v.isBuiltIn ? 'Bundled' : 'User-imported'}</span>
      </div>
    </div>

    <div class="vp-detail-actions">
      <button class="vp-action-btn" id="vp-btn-duplicate" title="Create a copy of this version">⧉ Duplicate</button>
      <button class="vp-action-btn" id="vp-btn-export" title="Copy version folder to a location you choose">↗ Export</button>
      ${!v.isBuiltIn ? `
        <button class="vp-action-btn" id="vp-btn-rename" title="Rename this version">✎ Rename</button>
        <button class="vp-action-btn danger" id="vp-btn-delete" title="Permanently delete this version">✕ Delete</button>
      ` : ''}
    </div>

    <div class="vp-section">
      <div class="vp-section-label">Notes</div>
      <textarea id="vp-notes" class="vp-notes-editor" placeholder="Add notes about this version — changes, known issues, source, etc.">${notesVal}</textarea>
      <div class="vp-notes-footer">
        <span id="vp-notes-status" class="vp-notes-status"></span>
        <button class="vp-action-btn primary" id="vp-btn-save-notes" disabled>Save Notes</button>
      </div>
    </div>

    <div class="vp-section">
      <div class="vp-section-label">File Browser</div>
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

  notesEl.addEventListener('input', () => {
    const dirty = notesEl.value !== _vpNotesOriginal;
    saveBtn.disabled = !dirty;
    statusEl.textContent = dirty ? 'Unsaved changes' : '';
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const result = await window.electronAPI.writeVersionNotes(v.name, notesEl.value);
    if (result.ok) {
      _vpNotesOriginal = notesEl.value;
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
  document.getElementById('vp-btn-export')?.addEventListener('click', () => _vpExport(v));
  document.getElementById('vp-btn-rename')?.addEventListener('click', () => _vpRename(v));
  document.getElementById('vp-btn-delete')?.addEventListener('click', () => _vpDelete(v));

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

async function _vpRename(v) {
  const newName = prompt(`Rename "${v.name}" to:`, v.name);
  if (newName === null || newName.trim() === v.name) return;
  const result = await window.electronAPI.renameVersion(v.name, newName.trim());
  if (result.ok) {
    _vpSelected = { ...v, name: result.newName };
    await vpRefresh();
  } else {
    alert(`Could not rename: ${result.error}`);
  }
}

async function _vpDelete(v) {
  const confirmed = confirm(
    `Delete "${v.name}"?\n\nThis will permanently remove the version folder and cannot be undone.`
  );
  if (!confirmed) return;
  const result = await window.electronAPI.deleteVersion(v.name);
  if (result.ok) {
    _vpSelected = null;
    await vpRefresh();
  } else {
    alert(`Could not delete: ${result.error}`);
  }
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

/**
 * AWS Cost Builder Extension — Popup Logic
 *
 * Manages the profile state in chrome.storage.local and provides:
 * - Page capture (via content script)
 * - Manual service entry
 * - Nested group tree (add/rename/delete/nest)
 * - Dimension editing
 * - HCL serialization + export (.hcl download and .tar.gz archive)
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  schema_version: '3.0',
  project_name: '',
  description: null,
  groups: [],
};

let capturedData = null;
let selectedGroupPath = null; // dot-path to selected group

// ─── Storage ──────────────────────────────────────────────────────────────────

async function saveState() {
  await chrome.storage.local.set({ awsCostProfile: state });
}

async function loadState() {
  const result = await chrome.storage.local.get('awsCostProfile');
  if (result.awsCostProfile) {
    state = result.awsCostProfile;
  }
}

// ─── Group utilities ──────────────────────────────────────────────────────────

/**
 * Get a flat list of all groups (depth-first, with path labels).
 * @param {Array} groups
 * @param {string} prefix
 * @returns {Array<{path: string, label: string, group: object}>}
 */
function flatGroups(groups, prefix = '') {
  const result = [];
  for (const g of groups || []) {
    const path = prefix ? `${prefix}.${g.group_name}` : g.group_name;
    result.push({ path, label: g.label || g.group_name, group: g });
    if (g.groups && g.groups.length > 0) {
      result.push(...flatGroups(g.groups, path));
    }
  }
  return result;
}

/**
 * Resolve a group by dot-path.
 * @param {Array} groups
 * @param {string} path
 * @returns {object|null}
 */
function resolveGroupByPath(groups, path) {
  const parts = path.split('.');
  let current = groups;
  let found = null;
  for (const part of parts) {
    found = (current || []).find(g => g.group_name === part);
    if (!found) return null;
    current = found.groups || [];
  }
  return found;
}

/**
 * Remove a group by path. Returns true if removed.
 * @param {Array} groups
 * @param {string} path
 * @returns {boolean}
 */
function removeGroupByPath(groups, path) {
  const parts = path.split('.');
  if (parts.length === 1) {
    const idx = groups.findIndex(g => g.group_name === parts[0]);
    if (idx !== -1) { groups.splice(idx, 1); return true; }
    return false;
  }
  const parent = resolveGroupByPath(groups, parts.slice(0, -1).join('.'));
  if (!parent || !parent.groups) return false;
  const idx = parent.groups.findIndex(g => g.group_name === parts[parts.length - 1]);
  if (idx !== -1) { parent.groups.splice(idx, 1); return true; }
  return false;
}

// ─── HCL Serializer (browser-side) ───────────────────────────────────────────

function hclValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const str = String(value);
  const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function serializeServiceHCL(service, ind) {
  const p = ' '.repeat(ind);
  const pp = ' '.repeat(ind + 2);
  const lines = [];
  const label = service.human_label || service.service_name;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  lines.push(`${p}service ${hclValue(service.service_name)} ${hclValue(slug)} {`);
  lines.push(`${pp}region      = ${hclValue(service.region || 'us-east-1')}`);
  lines.push(`${pp}human_label = ${hclValue(label)}`);
  const dims = service.dimensions || {};
  const keys = Object.keys(dims).sort();
  if (keys.length > 0) {
    lines.push('');
    const maxLen = Math.max(...keys.map(k => k.length));
    for (const key of keys) {
      const d = dims[key];
      const val = d.user_value !== null && d.user_value !== undefined ? d.user_value : d.default_value;
      const pad = ' '.repeat(maxLen - key.length);
      lines.push(`${pp}dimension ${hclValue(key)}${pad} = ${hclValue(val)}`);
    }
  }
  lines.push(`${p}}`);
  return lines.join('\n');
}

function serializeGroupHCL(group, ind) {
  const p = ' '.repeat(ind);
  const pp = ' '.repeat(ind + 2);
  const lines = [];
  lines.push(`${p}group ${hclValue(group.group_name)} {`);
  if (group.label) lines.push(`${pp}label = ${hclValue(group.label)}`);
  const children = group.groups || [];
  const services = group.services || [];
  if (children.length > 0 || services.length > 0) lines.push('');
  for (const child of children) {
    lines.push(serializeGroupHCL(child, ind + 2));
    lines.push('');
  }
  for (const svc of services) {
    lines.push(serializeServiceHCL(svc, ind + 2));
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  lines.push(`${p}}`);
  return lines.join('\n');
}

function serializeHCL(profileData) {
  const lines = [];
  lines.push(`schema_version = ${hclValue(profileData.schema_version || '3.0')}`);
  lines.push(`project_name   = ${hclValue(profileData.project_name || 'unnamed')}`);
  if (profileData.description) lines.push(`description    = ${hclValue(profileData.description)}`);
  for (const g of profileData.groups || []) {
    lines.push('');
    lines.push(serializeGroupHCL(g, 0));
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Syntax highlighting ──────────────────────────────────────────────────────

function highlightHCL(src) {
  return src
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(#[^\n]*)/g, '<span class="hcl-comment">$1</span>')
    .replace(/\b(group|service|dimension|label|region|human_label|schema_version|project_name|description)\b/g, '<span class="hcl-keyword">$1</span>')
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, '<span class="hcl-string">"$1"</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="hcl-number">$1</span>');
}

// ─── Tar/gzip for browser archive export ─────────────────────────────────────

function buildTarHeader(name, size) {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);

  function writeField(str, offset, len) {
    const bytes = enc.encode(str.substring(0, len - 1));
    buf.set(bytes, offset);
  }
  function writeOctal(num, offset, len) {
    const s = num.toString(8).padStart(len - 1, '0');
    writeField(s, offset, len);
    buf[offset + len - 1] = 0;
  }

  writeField(name, 0, 100);
  writeOctal(0o644, 100, 8);
  writeOctal(0, 108, 8);
  writeOctal(0, 116, 8);
  writeOctal(size, 124, 12);
  writeOctal(now, 136, 12);
  buf.fill(0x20, 148, 156);
  buf[156] = 0x30;
  writeField('ustar', 257, 6);
  writeField('00', 263, 2);

  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i];
  writeOctal(checksum, 148, 8);
  return buf;
}

function padToBlock(data) {
  const rem = data.length % 512;
  if (rem === 0) return data;
  const padded = new Uint8Array(data.length + (512 - rem));
  padded.set(data);
  return padded;
}

async function buildTarGz(files) {
  const parts = [];
  const enc = new TextEncoder();
  for (const { name, content } of files) {
    const data = enc.encode(content);
    parts.push(buildTarHeader(name, data.length));
    parts.push(padToBlock(data));
  }
  parts.push(new Uint8Array(1024));

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const tar = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) { tar.set(part, offset); offset += part.length; }

  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(tar);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const size = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
  }

  return tar;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg, type = 'info') {
  const el = document.getElementById('status-toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2800);
}

// ─── UI Rendering ─────────────────────────────────────────────────────────────

function renderGroupsTree() {
  const container = document.getElementById('groups-tree');
  const allFlat = flatGroups(state.groups);

  if (state.groups.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📁</div><div>No groups yet. Add a group to start building your profile.</div></div>`;
    return;
  }

  function renderGroupNode(group, path) {
    const services = group.services || [];
    const children = group.groups || [];
    const count = services.length + (children.length > 0 ? children.reduce((s, g) => s + (g.services || []).length, 0) : 0);
    const isSelected = selectedGroupPath === path;

    const node = document.createElement('div');
    node.className = 'group-node';
    node.dataset.path = path;

    const header = document.createElement('div');
    header.className = `group-header${isSelected ? ' selected' : ''}`;
    header.innerHTML = `
      <span class="group-toggle${children.length > 0 ? '' : ''}">${children.length > 0 ? '▶' : '·'}</span>
      <span class="group-name">${group.label || group.group_name}</span>
      <span class="group-badge">${count} svc</span>
      <div class="group-actions">
        <button class="btn-icon" title="Add child group" data-action="add-child" data-path="${path}">+</button>
        <button class="btn-icon danger" title="Delete group" data-action="delete-group" data-path="${path}">✕</button>
      </div>`;

    const childrenEl = document.createElement('div');
    childrenEl.className = 'group-children';

    header.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      selectedGroupPath = (selectedGroupPath === path) ? null : path;
      childrenEl.classList.toggle('open');
      header.querySelector('.group-toggle').classList.toggle('open');
      renderGroupsTree();
    });

    // Add child group button
    header.querySelector('[data-action="add-child"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openAddGroupModal(path);
    });

    // Delete group button
    header.querySelector('[data-action="delete-group"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete group "${group.group_name}" and all its contents?`)) return;
      removeGroupByPath(state.groups, path);
      if (selectedGroupPath && selectedGroupPath.startsWith(path)) selectedGroupPath = null;
      saveState();
      renderGroupsTree();
      updateTargetGroupSelect();
      refreshHCLPreview();
    });

    // Render child groups
    for (const child of children) {
      const childPath = `${path}.${child.group_name}`;
      childrenEl.appendChild(renderGroupNode(child, childPath));
    }

    // Render services
    for (const svc of services) {
      const item = document.createElement('div');
      item.className = 'service-item';
      item.innerHTML = `
        <span class="service-dot"></span>
        <span class="service-label">${svc.human_label || svc.service_name}</span>
        <span class="service-meta">${svc.service_name} · ${svc.region || ''}</span>
        <button class="btn-icon danger" title="Remove service" data-action="delete-service">✕</button>`;
      item.querySelector('[data-action="delete-service"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const g = resolveGroupByPath(state.groups, path);
        if (!g) return;
        g.services = (g.services || []).filter(s => s !== svc);
        saveState();
        renderGroupsTree();
        refreshHCLPreview();
      });
      childrenEl.appendChild(item);
    }

    if (isSelected) childrenEl.classList.add('open');

    node.appendChild(header);
    node.appendChild(childrenEl);
    return node;
  }

  container.innerHTML = '';
  for (const g of state.groups) {
    container.appendChild(renderGroupNode(g, g.group_name));
  }
}

function updateTargetGroupSelect() {
  const sel = document.getElementById('target-group-select');
  const parentSel = document.getElementById('modal-parent-group');
  const allFlat = flatGroups(state.groups);

  const makeOptions = (selectEl) => {
    selectEl.innerHTML = '<option value="">— select group —</option>';
    for (const { path, label } of allFlat) {
      const opt = document.createElement('option');
      opt.value = path;
      opt.textContent = path.includes('.') ? `  └ ${label}` : label;
      selectEl.appendChild(opt);
    }
  };

  makeOptions(sel);
  if (parentSel) {
    parentSel.innerHTML = '<option value="">— top level —</option>';
    for (const { path, label } of allFlat) {
      const opt = document.createElement('option');
      opt.value = path;
      opt.textContent = path.includes('.') ? `  └ ${label}` : label;
      parentSel.appendChild(opt);
    }
  }

  if (selectedGroupPath) sel.value = selectedGroupPath;
}

function renderDimEditor(dims) {
  const container = document.getElementById('dim-editor');
  container.innerHTML = '';
  for (const [key, dim] of Object.entries(dims)) {
    const row = document.createElement('div');
    row.className = 'dim-row';
    row.innerHTML = `
      <span class="dim-key" title="${key}">${key}</span>
      <span class="dim-value"><input type="text" value="${dim.user_value ?? ''}" data-key="${key}"></span>
      <button class="btn-icon danger" title="Remove" data-remove="${key}">✕</button>`;
    row.querySelector(`input[data-key="${key}"]`).addEventListener('input', (e) => {
      if (capturedData) capturedData.dimensions[key] = { user_value: e.target.value, default_value: null };
    });
    row.querySelector(`[data-remove="${key}"]`).addEventListener('click', () => {
      delete capturedData.dimensions[key];
      renderDimEditor(capturedData.dimensions);
    });
    container.appendChild(row);
  }
  if (Object.keys(dims).length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:12px">No dimensions captured.</div>';
  }
}

function refreshHCLPreview() {
  const el = document.getElementById('hcl-preview-content');
  if (!el) return;
  const hcl = serializeHCL(state);
  el.innerHTML = highlightHCL(hcl);
}

// ─── Capture flow ─────────────────────────────────────────────────────────────

document.getElementById('btn-capture').addEventListener('click', async () => {
  const btn = document.getElementById('btn-capture');
  btn.disabled = true;
  btn.textContent = '⏳ Capturing…';
  try {
    const response = await chrome.runtime.sendMessage({ action: 'captureTab' });
    if (!response || !response.success) {
      showToast(response?.error || 'Capture failed.', 'error');
      return;
    }
    const data = response.data;

    // Build dimensions map
    const dims = {};
    for (const d of data.dimensions || []) {
      if (d.key && d.key.trim()) {
        dims[d.key.trim()] = { user_value: d.value, default_value: null };
      }
    }

    capturedData = {
      service_name: data.service_name || 'Unknown Service',
      human_label: data.service_name || 'Captured Service',
      region: data.region || 'us-east-1',
      dimensions: dims,
    };

    document.getElementById('cap-service-name').value = capturedData.service_name;
    document.getElementById('cap-human-label').value = capturedData.human_label;
    document.getElementById('cap-region').value = capturedData.region;
    document.getElementById('captured-count').textContent = `${Object.keys(dims).length} fields`;

    const preview = document.getElementById('capture-preview');
    preview.style.display = 'block';
    preview.textContent = `service = "${data.service_name}"\nregion  = "${data.region}"\nfields  = ${Object.keys(dims).length}`;

    document.getElementById('captured-service-panel').style.display = 'block';
    renderDimEditor(dims);
    updateTargetGroupSelect();

    showToast(`Captured ${Object.keys(dims).length} fields from "${data.service_name}"`, 'ok');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Capture Page';
  }
});

document.getElementById('btn-add-manual').addEventListener('click', () => {
  capturedData = {
    service_name: '',
    human_label: '',
    region: 'us-east-1',
    dimensions: { 'Example Dimension': { user_value: '', default_value: null } },
  };
  document.getElementById('cap-service-name').value = '';
  document.getElementById('cap-human-label').value = '';
  document.getElementById('cap-region').value = 'us-east-1';
  document.getElementById('captured-count').textContent = '1 fields';
  document.getElementById('capture-preview').style.display = 'none';
  document.getElementById('captured-service-panel').style.display = 'block';
  renderDimEditor(capturedData.dimensions);
  updateTargetGroupSelect();
});

document.getElementById('btn-discard-capture').addEventListener('click', () => {
  capturedData = null;
  document.getElementById('captured-service-panel').style.display = 'none';
  document.getElementById('capture-preview').style.display = 'none';
});

document.getElementById('btn-add-service').addEventListener('click', () => {
  if (!capturedData) return;

  const serviceName = document.getElementById('cap-service-name').value.trim();
  const humanLabel = document.getElementById('cap-human-label').value.trim();
  const region = document.getElementById('cap-region').value.trim();
  const targetPath = document.getElementById('target-group-select').value;

  if (!serviceName) { showToast('Service name is required.', 'error'); return; }
  if (!targetPath) { showToast('Please select a target group.', 'error'); return; }

  const group = resolveGroupByPath(state.groups, targetPath);
  if (!group) { showToast('Target group not found.', 'error'); return; }

  if (!group.services) group.services = [];
  group.services.push({
    service_name: serviceName,
    human_label: humanLabel || serviceName,
    region: region || 'us-east-1',
    dimensions: capturedData.dimensions,
  });

  capturedData = null;
  document.getElementById('captured-service-panel').style.display = 'none';
  document.getElementById('capture-preview').style.display = 'none';

  saveState();
  renderGroupsTree();
  refreshHCLPreview();
  showToast(`Added "${humanLabel || serviceName}" to ${targetPath}`, 'ok');

  // Switch to profile tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="profile"]').classList.add('active');
  document.getElementById('tab-profile').classList.add('active');
});

// ─── Add Group Modal ──────────────────────────────────────────────────────────

function openAddGroupModal(parentPath = null) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  document.getElementById('modal-group-name').value = '';
  document.getElementById('modal-group-label').value = '';
  updateTargetGroupSelect();
  if (parentPath) {
    document.getElementById('modal-parent-group').value = parentPath;
    title.textContent = `Add Child Group under "${parentPath}"`;
  } else {
    document.getElementById('modal-parent-group').value = '';
    title.textContent = 'Add Group';
  }
  overlay.style.display = 'flex';
  document.getElementById('modal-group-name').focus();
}

document.getElementById('btn-add-group').addEventListener('click', () => openAddGroupModal());

document.getElementById('modal-confirm').addEventListener('click', () => {
  const name = document.getElementById('modal-group-name').value.trim().replace(/\s+/g, '_');
  const label = document.getElementById('modal-group-label').value.trim() || null;
  const parentPath = document.getElementById('modal-parent-group').value;

  if (!name) { showToast('Group name is required.', 'error'); return; }

  const newGroup = { group_name: name, label, services: [], groups: [] };

  if (!parentPath) {
    state.groups.push(newGroup);
  } else {
    const parent = resolveGroupByPath(state.groups, parentPath);
    if (!parent) { showToast('Parent group not found.', 'error'); return; }
    if (!parent.groups) parent.groups = [];
    parent.groups.push(newGroup);
  }

  document.getElementById('modal-overlay').style.display = 'none';
  saveState();
  renderGroupsTree();
  updateTargetGroupSelect();
  refreshHCLPreview();
  showToast(`Group "${name}" added.`, 'ok');
});

document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-overlay').style.display = 'none';
});

// ─── Project meta sync ────────────────────────────────────────────────────────

document.getElementById('project-name').addEventListener('input', (e) => {
  state.project_name = e.target.value;
  saveState();
  refreshHCLPreview();
});

document.getElementById('project-desc').addEventListener('input', (e) => {
  state.description = e.target.value || null;
  saveState();
  refreshHCLPreview();
});

// ─── Export ───────────────────────────────────────────────────────────────────

document.getElementById('btn-export-hcl').addEventListener('click', () => {
  const hcl = serializeHCL(state);
  const filename = (state.project_name || 'profile').replace(/[^a-z0-9_-]/gi, '_') + '.hcl';
  const blob = new Blob([hcl], { type: 'text/plain' });
  downloadBlob(blob, filename);
  showToast(`Exported ${filename}`, 'ok');
});

document.getElementById('btn-export-archive').addEventListener('click', async () => {
  const hcl = serializeHCL(state);
  const filename = (state.project_name || 'profile').replace(/[^a-z0-9_-]/gi, '_') + '.hcl';
  const files = [{ name: filename, content: hcl }];

  try {
    const gz = await buildTarGz(files);
    const blob = new Blob([gz], { type: 'application/gzip' });
    const archiveName = (state.project_name || 'profiles').replace(/[^a-z0-9_-]/gi, '_') + '.tar.gz';
    downloadBlob(blob, archiveName);
    showToast(`Exported ${archiveName}`, 'ok');
  } catch (err) {
    showToast('Archive export failed: ' + err.message, 'error');
  }
});

document.getElementById('btn-clear-profile').addEventListener('click', () => {
  if (!confirm('Clear the entire profile? This cannot be undone.')) return;
  state = { schema_version: '3.0', project_name: '', description: null, groups: [] };
  document.getElementById('project-name').value = '';
  document.getElementById('project-desc').value = '';
  selectedGroupPath = null;
  capturedData = null;
  document.getElementById('captured-service-panel').style.display = 'none';
  saveState();
  renderGroupsTree();
  refreshHCLPreview();
  showToast('Profile cleared.', 'info');
});

document.getElementById('btn-copy-hcl').addEventListener('click', async () => {
  const content = document.getElementById('hcl-preview-content').textContent;
  await navigator.clipboard.writeText(content);
  showToast('HCL copied to clipboard!', 'ok');
});

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const targetId = `tab-${tab.dataset.tab}`;
    document.getElementById(targetId).classList.add('active');
    if (tab.dataset.tab === 'preview') refreshHCLPreview();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadState();
  document.getElementById('project-name').value = state.project_name || '';
  document.getElementById('project-desc').value = state.description || '';
  renderGroupsTree();
  updateTargetGroupSelect();
})();

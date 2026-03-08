/**
 * AWS Cost Builder Extension — Popup Logic (v2)
 *
 * 3-view flow:
 *   setup     → no active capture session
 *   capturing → session.isCapturing = true
 *   export    → session.isCapturing = false, session has data
 *
 * State lives entirely in chrome.storage.local ('captureSession').
 * The popup polls storage on open and listens for changes while open.
 */

'use strict';

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = 'info') {
  const el = document.getElementById('status-toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ─── View switcher ────────────────────────────────────────────────────────────

function showView(name) {
  for (const id of ['view-setup', 'view-capturing', 'view-export']) {
    document.getElementById(id).style.display = (id === `view-${name}`) ? 'block' : 'none';
  }
  const indicator = document.getElementById('capture-indicator');
  indicator.style.display = (name === 'capturing') ? 'flex' : 'none';
}

// ─── HCL serializer (browser-side) ───────────────────────────────────────────

function hclVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function serializeServiceHCL(svc, ind) {
  const p = ' '.repeat(ind);
  const pp = ' '.repeat(ind + 2);
  const label = svc.human_label || svc.service_name;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'service';
  const lines = [];
  lines.push(`${p}service ${hclVal(svc.service_name)} ${hclVal(slug)} {`);
  lines.push(`${pp}region      = ${hclVal(svc.region || 'us-east-1')}`);
  lines.push(`${pp}human_label = ${hclVal(label)}`);
  const dims = svc.dimensions || {};
  const keys = Object.keys(dims).sort();
  if (keys.length > 0) {
    lines.push('');
    const maxLen = Math.max(...keys.map(k => k.length));
    for (const key of keys) {
      const d = dims[key];
      const val = (d.user_value !== null && d.user_value !== undefined) ? d.user_value : d.default_value;
      lines.push(`${pp}dimension ${hclVal(key)}${' '.repeat(maxLen - key.length)} = ${hclVal(val)}`);
    }
  }
  lines.push(`${p}}`);
  return lines.join('\n');
}

function serializeGroupHCL(group, ind) {
  const p = ' '.repeat(ind);
  const pp = ' '.repeat(ind + 2);
  const lines = [];
  lines.push(`${p}group ${hclVal(group.group_name)} {`);
  if (group.label) lines.push(`${pp}label = ${hclVal(group.label)}`);
  const children = group.groups || [];
  const services = group.services || [];
  if (children.length > 0 || services.length > 0) lines.push('');
  for (const child of children) { lines.push(serializeGroupHCL(child, ind + 2)); lines.push(''); }
  for (const svc of services) { lines.push(serializeServiceHCL(svc, ind + 2)); lines.push(''); }
  if (lines[lines.length - 1] === '') lines.pop();
  lines.push(`${p}}`);
  return lines.join('\n');
}

function serializeHCL(profile) {
  const lines = [];
  lines.push(`schema_version = ${hclVal(profile.schema_version || '3.0')}`);
  lines.push(`project_name   = ${hclVal(profile.project_name || 'unnamed')}`);
  if (profile.description) lines.push(`description    = ${hclVal(profile.description)}`);
  for (const g of profile.groups || []) { lines.push(''); lines.push(serializeGroupHCL(g, 0)); }
  lines.push('');
  return lines.join('\n');
}

// ─── Profile builder ──────────────────────────────────────────────────────────

/**
 * Convert a capture session into a ProfileDocument-like object with groups.
 * If an estimateTree was captured, use its group structure and assign services
 * to groups by service_name matching. Otherwise put all services in one group.
 */
function buildProfile(session) {
  const { profile, capturedServices = [], estimateTree } = session;
  const services = capturedServices.map(s => ({
    service_name: s.service_name,
    human_label: s.service_name,
    region: s.region || 'us-east-1',
    dimensions: s.dimensions || {},
  }));

  let groups;

  if (estimateTree && estimateTree.groups && estimateTree.groups.length > 0) {
    // Map services into estimate tree groups by name matching
    const usedIds = new Set();
    groups = estimateTree.groups.map(tg => {
      const tgServices = [];
      for (const ts of tg.services || []) {
        const match = capturedServices.find(
          cs => !usedIds.has(cs.id) && cs.service_name.toLowerCase().includes(ts.service_name.toLowerCase().substring(0, 8))
        );
        if (match) {
          usedIds.add(match.id);
          tgServices.push({
            service_name: match.service_name,
            human_label: match.service_name,
            region: match.region || 'us-east-1',
            dimensions: match.dimensions || {},
          });
        }
      }
      // Also add any services explicitly assigned to this group
      for (const cs of capturedServices) {
        if (!usedIds.has(cs.id) && cs.groupPath === tg.group_name) {
          usedIds.add(cs.id);
          tgServices.push({
            service_name: cs.service_name,
            human_label: cs.service_name,
            region: cs.region || 'us-east-1',
            dimensions: cs.dimensions || {},
          });
        }
      }
      return {
        group_name: tg.group_name,
        label: tg.label,
        services: tgServices,
        groups: [],
      };
    });

    // Any unmatched services go into a default group
    const unmatched = capturedServices.filter(cs => !usedIds.has(cs.id));
    if (unmatched.length > 0) {
      groups.push({
        group_name: 'captured',
        label: 'Captured Services',
        services: unmatched.map(cs => ({
          service_name: cs.service_name,
          human_label: cs.service_name,
          region: cs.region || 'us-east-1',
          dimensions: cs.dimensions || {},
        })),
        groups: [],
      });
    }
  } else {
    // Single default group
    const slug = (profile.project_name || 'estimate').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    groups = [{
      group_name: slug,
      label: profile.project_name || 'Estimate',
      services,
      groups: [],
    }];
  }

  return {
    schema_version: '3.0',
    project_name: profile.project_name || 'unnamed',
    description: profile.description || null,
    groups,
  };
}

// ─── Tar / gzip ───────────────────────────────────────────────────────────────

function buildTarHeader(name, size) {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  function wf(str, off, len) { buf.set(enc.encode(str.substring(0, len - 1)), off); }
  function wo(num, off, len) {
    const s = num.toString(8).padStart(len - 1, '0');
    wf(s, off, len);
    buf[off + len - 1] = 0;
  }
  wf(name, 0, 100);
  wo(0o644, 100, 8); wo(0, 108, 8); wo(0, 116, 8);
  wo(size, 124, 12); wo(now, 136, 12);
  buf.fill(0x20, 148, 156); buf[156] = 0x30;
  wf('ustar', 257, 6); wf('00', 263, 2);
  let cs = 0; for (let i = 0; i < 512; i++) cs += buf[i];
  wo(cs, 148, 8);
  return buf;
}

function padBlock(data) {
  const rem = data.length % 512;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + (512 - rem));
  out.set(data); return out;
}

async function buildTarGz(files) {
  const enc = new TextEncoder();
  const parts = [];
  for (const { name, content } of files) {
    const data = enc.encode(content);
    parts.push(buildTarHeader(name, data.length));
    parts.push(padBlock(data));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const tar = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { tar.set(p, off); off += p.length; }

  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(tar); w.close();
    const chunks = [];
    const r = cs.readable.getReader();
    while (true) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
    }
    const sz = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(sz);
    let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  return tar;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function renderCapturedServicesList(containerId, services, removable) {
  const container = document.getElementById(containerId);
  if (!services || services.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div>No services captured yet.</div></div>`;
    return;
  }
  container.innerHTML = '';
  for (const svc of services) {
    const el = document.createElement('div');
    el.className = 'service-card';
    const dimCount = Object.keys(svc.dimensions || {}).length;
    el.innerHTML = `
      <div class="service-card-icon">⚙</div>
      <div class="service-card-body">
        <div class="service-card-name">${svc.service_name}</div>
        <div class="service-card-meta">${svc.region || 'us-east-1'} &middot; ${dimCount} dimension${dimCount !== 1 ? 's' : ''}</div>
      </div>
      ${removable ? `<button class="btn-icon danger service-remove-btn" title="Remove" data-id="${svc.id}">✕</button>` : ''}`;
    if (removable) {
      el.querySelector('.service-remove-btn').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: 'removeService', id: svc.id });
        const { session } = await chrome.runtime.sendMessage({ action: 'getSession' });
        if (session) populateCapturingView(session);
      });
    }
    container.appendChild(el);
  }
}

// ─── Progress render helpers ──────────────────────────────────────────────────

const CHIP_LABELS = {
  idle:        'Idle',
  detecting:   'Activity detected',
  stabilizing: 'Stabilizing…',
  captured:    '✓ Captured!',
};

function renderDetectorChip(captureStatus) {
  const cs = captureStatus || { state: 'idle', serviceName: null };
  const chip = document.getElementById('detector-chip');
  const label = document.getElementById('detector-label');
  const viewing = document.getElementById('currently-viewing');
  if (!chip || !label || !viewing) return;

  chip.className = `detector-chip ${cs.state}`;
  label.textContent = CHIP_LABELS[cs.state] || cs.state;

  if (cs.serviceName && cs.state !== 'idle') {
    viewing.textContent = `↳ ${cs.serviceName}`;
    viewing.style.display = 'inline';
  } else {
    viewing.style.display = 'none';
  }
}

function renderCaptureLog(captureLog) {
  const container = document.getElementById('capture-log');
  if (!container) return;
  const entries = captureLog || [];

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:10px">No events yet.</div>';
    return;
  }

  container.innerHTML = '';
  for (const entry of entries) {
    const d = new Date(entry.timestamp);
    const ts = d.toTimeString().slice(0, 8);

    let iconClass = 'detecting';
    let iconChar = '●';
    if (entry.event === 'captured')  { iconClass = 'captured';  iconChar = '✓'; }
    if (entry.event === 'duplicate') { iconClass = 'duplicate'; iconChar = '='; }

    const dimLabel = entry.event === 'captured'
      ? `<span class="log-dims">${entry.dim_count} dim</span>`
      : '';

    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML =
      `<span class="log-time">${ts}</span>` +
      `<span class="log-icon ${iconClass}">${iconChar}</span>` +
      `<span class="log-name">${entry.service_name || '—'}</span>` +
      dimLabel;
    container.appendChild(row);
  }

  // Auto-scroll to latest entry
  container.scrollTop = container.scrollHeight;
}

// ─── View populators ──────────────────────────────────────────────────────────

let _prevServiceCount = 0;

function populateCapturingView(session) {
  document.getElementById('cap-profile-name').textContent = session.profile.project_name || '—';
  const services = session.capturedServices || [];
  document.getElementById('cap-service-count').textContent = services.length;

  const prevCount = _prevServiceCount;
  _prevServiceCount = services.length;

  renderCapturedServicesList('captured-services-list', services, true);

  // Animate the newest card if a service was just added
  if (services.length > prevCount) {
    const list = document.getElementById('captured-services-list');
    const cards = list.querySelectorAll('.service-card');
    const newest = cards[cards.length - 1];
    if (newest) {
      newest.classList.add('service-card--new');
      setTimeout(() => newest.classList.remove('service-card--new'), 1500);
    }
  }

  renderDetectorChip(session.captureStatus);
  renderCaptureLog(session.captureLog);
}

function populateExportView(session) {
  const count = (session.capturedServices || []).length;
  document.getElementById('exp-profile-name').textContent = session.profile.project_name || 'Unnamed Profile';
  document.getElementById('exp-profile-meta').textContent =
    `${count} service${count !== 1 ? 's' : ''} captured` +
    (session.profile.description ? ` · ${session.profile.description}` : '');
  document.getElementById('exp-service-count').textContent = count;
  renderCapturedServicesList('export-services-list', session.capturedServices, false);

  const treeBadge = document.getElementById('exp-tree-badge');
  const groupInfo = document.getElementById('exp-group-info');
  const groupTree = document.getElementById('exp-group-tree');

  if (session.estimateTree && session.estimateTree.groups && session.estimateTree.groups.length > 0) {
    treeBadge.style.display = 'inline-block';
    groupInfo.style.display = 'none';
    groupTree.style.display = 'block';
    renderEstimateTree(groupTree, session.estimateTree.groups);
  } else {
    treeBadge.style.display = 'none';
    groupInfo.style.display = 'block';
    groupTree.style.display = 'none';
  }
}

function renderEstimateTree(container, groups) {
  container.innerHTML = '';
  function renderGroup(g, depth) {
    const node = document.createElement('div');
    node.className = 'group-node';
    node.style.paddingLeft = `${depth * 12}px`;
    const svcCount = (g.services || []).length;
    node.innerHTML = `
      <div class="group-header">
        <span class="group-name">📁 ${g.label || g.group_name}</span>
        <span class="group-badge">${svcCount} svc</span>
      </div>`;
    for (const child of g.groups || []) node.appendChild(renderGroup(child, depth + 1));
    for (const svc of g.services || []) {
      const item = document.createElement('div');
      item.className = 'service-item';
      item.style.paddingLeft = `${(depth + 1) * 12 + 8}px`;
      item.innerHTML = `<span class="service-dot"></span><span class="service-label">${svc.service_name}</span>`;
      node.appendChild(item);
    }
    return node;
  }
  for (const g of groups) container.appendChild(renderGroup(g, 0));
}

// ─── Main init & session routing ──────────────────────────────────────────────

async function init() {
  const { session } = await chrome.runtime.sendMessage({ action: 'getSession' });

  if (!session) {
    showView('setup');
    return;
  }

  if (session.isCapturing) {
    _prevServiceCount = (session.capturedServices || []).length; // no animation on first open
    populateCapturingView(session);
    showView('capturing');
    return;
  }

  // Session exists but not capturing → show export
  if ((session.capturedServices || []).length > 0) {
    populateExportView(session);
    showView('export');
    return;
  }

  // Session with no data — reset to setup
  await chrome.runtime.sendMessage({ action: 'clearSession' });
  showView('setup');
}

// Listen for storage changes while popup is open (live update during capture)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.captureSession) {
    const session = changes.captureSession.newValue;
    if (session && session.isCapturing) {
      populateCapturingView(session);
    }
  }
});

// ─── Activity log toggle ──────────────────────────────────────────────────────

let logVisible = false;
document.getElementById('btn-toggle-log').addEventListener('click', () => {
  logVisible = !logVisible;
  document.getElementById('capture-log').style.display = logVisible ? 'block' : 'none';
  document.getElementById('btn-toggle-log').textContent = logVisible ? '▾ Hide' : '▸ Show';
  if (logVisible) {
    // Scroll to latest entry on open
    const log = document.getElementById('capture-log');
    log.scrollTop = log.scrollHeight;
  }
});

// ─── Setup view handlers ──────────────────────────────────────────────────────

document.getElementById('btn-start-capture').addEventListener('click', async () => {
  const projectName = document.getElementById('setup-project-name').value.trim();
  if (!projectName) {
    showToast('Please enter a project name.', 'error');
    document.getElementById('setup-project-name').focus();
    return;
  }
  const description = document.getElementById('setup-description').value.trim() || null;

  const btn = document.getElementById('btn-start-capture');
  btn.disabled = true;
  btn.textContent = '⏳ Starting…';

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'startCapture',
      projectName,
      description,
    });
    if (!result.success) throw new Error(result.error || 'Failed to start capture');
    const { session } = await chrome.runtime.sendMessage({ action: 'getSession' });
    if (session) populateCapturingView(session);
    showView('capturing');
    showToast('Capture started. Navigate to calculator.aws and open your services.', 'ok');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '▶ Start Capture';
  }
});

// ─── Capturing view handlers ──────────────────────────────────────────────────

document.getElementById('btn-snapshot-tree').addEventListener('click', async () => {
  const btn = document.getElementById('btn-snapshot-tree');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning…';
  try {
    const result = await chrome.runtime.sendMessage({ action: 'captureEstimateTree' });
    if (result.success) {
      const count = (result.tree?.groups || []).length;
      showToast(`Snapshot complete — ${count} group${count !== 1 ? 's' : ''} found.`, 'ok');
    } else {
      showToast(result.error || 'Could not snapshot estimate groups.', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬡ Snapshot Estimate Groups';
  }
});

document.getElementById('btn-stop-capture').addEventListener('click', async () => {
  const btn = document.getElementById('btn-stop-capture');
  btn.disabled = true;
  btn.textContent = '⏳ Stopping…';
  try {
    await chrome.runtime.sendMessage({ action: 'stopCapture' });
    const { session } = await chrome.runtime.sendMessage({ action: 'getSession' });
    if (session && (session.capturedServices || []).length > 0) {
      populateExportView(session);
      showView('export');
      showToast('Capture stopped. Review and export your profile.', 'ok');
    } else {
      showToast('No services were captured. Try navigating to a service in the calculator.', 'error');
      btn.disabled = false;
      btn.textContent = '■ Stop Capture';
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '■ Stop Capture';
  }
});

// ─── Export view handlers ─────────────────────────────────────────────────────

document.getElementById('btn-export-archive').addEventListener('click', async () => {
  const btn = document.getElementById('btn-export-archive');
  btn.disabled = true;
  btn.textContent = '⏳ Building archive…';
  try {
    const { session } = await chrome.runtime.sendMessage({ action: 'getSession' });
    if (!session) throw new Error('No session found');

    const profile = buildProfile(session);
    const hcl = serializeHCL(profile);
    const filename = `${profile.project_name.replace(/[^a-z0-9_-]/gi, '_')}.hcl`;

    const tarGz = await buildTarGz([{ name: filename, content: hcl }]);
    const archiveName = `${profile.project_name.replace(/[^a-z0-9_-]/gi, '_')}.tar.gz`;
    downloadBlob(new Blob([tarGz], { type: 'application/gzip' }), archiveName);
    showToast(`Exported ${archiveName}`, 'ok');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↓ Export Archive (.tar.gz)';
  }
});

document.getElementById('btn-export-hcl').addEventListener('click', async () => {
  const btn = document.getElementById('btn-export-hcl');
  btn.disabled = true;
  try {
    const { session } = await chrome.runtime.sendMessage({ action: 'getSession' });
    if (!session) throw new Error('No session found');

    const profile = buildProfile(session);
    const hcl = serializeHCL(profile);
    const filename = `${profile.project_name.replace(/[^a-z0-9_-]/gi, '_')}.hcl`;
    downloadBlob(new Blob([hcl], { type: 'text/plain' }), filename);
    showToast(`Exported ${filename}`, 'ok');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↓ Export .hcl';
  }
});

document.getElementById('btn-start-over').addEventListener('click', async () => {
  if (!confirm('Clear the current capture session and start over?')) return;
  await chrome.runtime.sendMessage({ action: 'clearSession' });
  document.getElementById('setup-project-name').value = '';
  document.getElementById('setup-description').value = '';
  showView('setup');
  showToast('Session cleared.', 'info');
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[AWS Cost Builder] init error:', err);
  showToast('Extension error: ' + err.message, 'error');
});

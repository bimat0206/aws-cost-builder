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

"use strict";

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = "info") {
  const el = document.getElementById("status-toast");
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "";
  }, 3000);
}

// ─── View switcher ────────────────────────────────────────────────────────────

function showView(name) {
  for (const id of ["view-setup", "view-capturing", "view-export"]) {
    document.getElementById(id).style.display =
      id === `view-${name}` ? "block" : "none";
  }
  const indicator = document.getElementById("capture-indicator");
  indicator.style.display = name === "capturing" ? "flex" : "none";
}

// ─── HCL v7 serializer (browser-side) ───────────────────────────────────────

/** Escape and quote a value for HCL. */
function hclVal(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** Slugify a string for use as an HCL identifier. */
function slugifyName(value, fallback = "group") {
  const slug = String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || fallback;
}

/** Strip trailing AWS UI-hint suffixes from a field label. */
const LABEL_SUFFIX_RE = /\s+(?:Value|Enter\s+amount|Enter\s+the\s+percentage|Enter\s+percentage|Enter\s+number(?:\s+of\s+\w+)*|Field\s+value)$/i;
function cleanLabel(raw) {
  return String(raw || "").trim().replace(LABEL_SUFFIX_RE, "").trim();
}

/** Convert a field label to snake_case attr key, stripping section prefix. */
function fieldToSnakeKey(fieldLabel, sectionLabel = "") {
  let key = cleanLabel(fieldLabel);
  if (sectionLabel) {
    const esc = sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    key = key.replace(new RegExp(`^${esc}\\s*`, "i"), "").trim();
  }
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

/** If service has config_groups use them; otherwise wrap dimensions in a general group. */
function normalizeConfigGroups(service) {
  if (Array.isArray(service.config_groups) && service.config_groups.length > 0) {
    return service.config_groups;
  }
  const dimensions = service.dimensions || {};
  if (Object.keys(dimensions).length === 0) return [];
  return [{ group_name: "general", label: null, fields: dimensions }];
}

/** Emit flat key = value attributes, with _unit pairing. */
function serializeAttrs(fields, sectionLabel, ind) {
  const pad = " ".repeat(ind);
  const entries = Object.entries(fields || {});
  if (!entries.length) return [];

  // Build unit map: rawBaseKey → unit value
  const unitMap = new Map();
  const unitKeySet = new Set();
  for (const [rawKey, field] of entries) {
    if (/\s+Unit$/i.test(rawKey)) {
      const base = rawKey.replace(/\s+Unit$/i, "").trim();
      unitMap.set(base, field.user_value ?? field.default_value ?? null);
      unitKeySet.add(rawKey);
    }
  }

  // Compute alignment width
  const snakeKeys = entries
    .filter(([k]) => !unitKeySet.has(k))
    .map(([k]) => fieldToSnakeKey(k, sectionLabel));
  const unitSnakeKeys = snakeKeys.filter((_, i) => {
    const rawKey = entries.filter(([k]) => !unitKeySet.has(k))[i]?.[0];
    return rawKey && unitMap.has(rawKey);
  }).map(k => k + "_unit");
  const maxLen = Math.max(0, ...[...snakeKeys, ...unitSnakeKeys].map(k => k.length));

  const lines = [];
  for (const [rawKey, field] of entries) {
    if (unitKeySet.has(rawKey)) continue;
    const sk = fieldToSnakeKey(rawKey, sectionLabel);
    const val = field.user_value !== null && field.user_value !== undefined
      ? field.user_value : field.default_value;
    lines.push(`${pad}${sk}${" ".repeat(Math.max(0, maxLen - sk.length))} = ${hclVal(val)}`);
    if (unitMap.has(rawKey)) {
      const uk = sk + "_unit";
      lines.push(`${pad}${uk}${" ".repeat(Math.max(0, maxLen - uk.length))} = ${hclVal(unitMap.get(rawKey))}`);
    }
  }
  return lines;
}

/** Serialize a section block (recursive, flat attrs). */
function serializeSectionHCL(group, ind, parentLabel = "") {
  const p = " ".repeat(ind);
  const rawLabel = group.label || group.group_name;
  const sectionLabel = rawLabel.replace(/\s+feature$/i, "").trim();
  const lines = [`${p}section ${hclVal(sectionLabel)} {`];

  const attrs = serializeAttrs(group.fields || {}, sectionLabel, ind + 2);
  const children = group.groups || [];
  if (attrs.length) {
    lines.push(...attrs);
    if (children.length) lines.push("");
  }
  children.forEach((child, idx) => {
    lines.push(serializeSectionHCL(child, ind + 2, sectionLabel));
    if (idx !== children.length - 1) lines.push("");
  });

  lines.push(`${p}}`);
  return lines.join("\n");
}

/** Serialize a feature block (toggle-gated). */
function serializeFeatureHCL(group, ind) {
  const p = " ".repeat(ind);
  const rawLabel = group.label || group.group_name;
  const label = rawLabel.replace(/\s+feature$/i, "").trim();
  const lines = [`${p}feature ${hclVal(label)} {`];

  const ownAttrs = serializeAttrs(group.fields || {}, label, ind + 2);
  const children = group.groups || [];
  if (ownAttrs.length) {
    lines.push(...ownAttrs);
    if (children.length) lines.push("");
  }
  children.forEach((child, idx) => {
    lines.push(serializeSectionHCL(child, ind + 2, label));
    if (idx !== children.length - 1) lines.push("");
  });

  lines.push(`${p}}`);
  return lines.join("\n");
}

/** Serialize a service block (v7). */
function serializeServiceHCL(svc, ind) {
  const p  = " ".repeat(ind);
  const pp = " ".repeat(ind + 2);
  const label = svc.human_label || svc.service_name;
  const slug  = slugifyName(label, "service");
  const lines = [
    `${p}service ${hclVal(svc.service_name)} ${hclVal(slug)} {`,
    `${pp}region      = ${hclVal(svc.region || "us-east-1")}`,
    `${pp}human_label = ${hclVal(label)}`,
  ];

  const configGroups = normalizeConfigGroups(svc);
  const generalGroup  = configGroups.find(g => g.group_name === "general" && !g.label);
  const featureGroups = configGroups.filter(g => {
    if (g.group_name === "general" && !g.label) return false;
    return (g.label || g.group_name || "").toLowerCase().includes("feature");
  });
  const sectionGroups = configGroups.filter(g => {
    if (g.group_name === "general" && !g.label) return false;
    return !(g.label || g.group_name || "").toLowerCase().includes("feature");
  });

  if (generalGroup) {
    const attrs = serializeAttrs(generalGroup.fields || {}, "", ind + 2);
    if (attrs.length) { lines.push(""); lines.push(...attrs); }
  }
  if (sectionGroups.length) {
    lines.push("");
    sectionGroups.forEach((g, idx) => {
      lines.push(serializeSectionHCL(g, ind + 2));
      if (idx !== sectionGroups.length - 1) lines.push("");
    });
  }
  if (featureGroups.length) {
    lines.push("");
    featureGroups.forEach((g, idx) => {
      lines.push(serializeFeatureHCL(g, ind + 2));
      if (idx !== featureGroups.length - 1) lines.push("");
    });
  }

  lines.push(`${p}}`);
  return lines.join("\n");
}

/** Serialize a top-level group block. */
function serializeGroupHCL(group, ind) {
  const p  = " ".repeat(ind);
  const pp = " ".repeat(ind + 2);
  const lines = [`${p}group ${hclVal(group.group_name)} {`];
  if (group.label) lines.push(`${pp}label = ${hclVal(group.label)}`);

  const children = group.groups || [];
  const services = group.services || [];
  if (children.length || services.length) lines.push("");
  for (const child of children) { lines.push(serializeGroupHCL(child, ind + 2)); lines.push(""); }
  for (const svc of services)   { lines.push(serializeServiceHCL(svc, ind + 2)); lines.push(""); }
  if (lines[lines.length - 1] === "") lines.pop();
  lines.push(`${p}}`);
  return lines.join("\n");
}

/** Serialize a complete profile to HCL v7.0. */
function serializeHCL(profile) {
  const lines = [
    `schema_version = ${hclVal("7.0")}`,
    `project_name   = ${hclVal(profile.project_name || "unnamed")}`,
  ];
  if (profile.description) lines.push(`description    = ${hclVal(profile.description)}`);
  for (const g of profile.groups || []) {
    lines.push("");
    lines.push(serializeGroupHCL(g, 0));
  }
  lines.push("");
  return lines.join("\n");
}

// ─── Profile builder ──────────────────────────────────────────────────────────

/**
 * Convert a capture session into a ProfileDocument-like object with groups.
 * If an estimateTree was captured, use its group structure and assign services
 * to groups by service_name matching. Otherwise put all services in one group.
 */
function buildProfile(session) {
  const { profile, capturedServices = [], estimateTree } = session;

  function materializeService(service) {
    return {
      service_name: service.service_name,
      human_label: service.service_name,
      region: service.region || "us-east-1",
      config_groups: normalizeConfigGroups(service),
    };
  }

  function findMatchingCapturedService(treeService, usedIds) {
    return capturedServices.find(
      (cs) =>
        !usedIds.has(cs.id) &&
        cs.service_name
          .toLowerCase()
          .includes(treeService.service_name.toLowerCase().substring(0, 8)),
    );
  }

  function buildTreeGroup(treeGroup, usedIds) {
    const services = [];
    const groups = (treeGroup.groups || []).map((child) => buildTreeGroup(child, usedIds));

    for (const treeService of treeGroup.services || []) {
      const match = findMatchingCapturedService(treeService, usedIds);
      if (match) {
        usedIds.add(match.id);
        services.push(materializeService(match));
      }
    }

    for (const captured of capturedServices) {
      if (!usedIds.has(captured.id) && captured.groupPath === treeGroup.group_name) {
        usedIds.add(captured.id);
        services.push(materializeService(captured));
      }
    }

    return {
      group_name: treeGroup.group_name,
      label: treeGroup.label,
      services,
      groups,
    };
  }

  let groups;

  if (estimateTree && estimateTree.groups && estimateTree.groups.length > 0) {
    const usedIds = new Set();
    groups = estimateTree.groups.map((tg) => buildTreeGroup(tg, usedIds));

    const unmatched = capturedServices.filter((cs) => !usedIds.has(cs.id));
    if (unmatched.length > 0) {
      groups.push({
        group_name: "captured",
        label: "Captured Services",
        services: unmatched.map((cs) => materializeService(cs)),
        groups: [],
      });
    }
  } else {
    const slug = slugifyName(profile.project_name || "estimate", "estimate");
    groups = [
      {
        group_name: slug,
        label: profile.project_name || "Estimate",
        services: capturedServices.map((service) => materializeService(service)),
        groups: [],
      },
    ];
  }

  return {
    schema_version: "7.0",
    project_name: profile.project_name || "unnamed",
    description: profile.description || null,
    groups,
  };
}

// ─── Tar / gzip ───────────────────────────────────────────────────────────────

function buildTarHeader(name, size) {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  function wf(str, off, len) {
    buf.set(enc.encode(str.substring(0, len - 1)), off);
  }
  function wo(num, off, len) {
    const s = num.toString(8).padStart(len - 1, "0");
    wf(s, off, len);
    buf[off + len - 1] = 0;
  }
  wf(name, 0, 100);
  wo(0o644, 100, 8);
  wo(0, 108, 8);
  wo(0, 116, 8);
  wo(size, 124, 12);
  wo(now, 136, 12);
  buf.fill(0x20, 148, 156);
  buf[156] = 0x30;
  wf("ustar", 257, 6);
  wf("00", 263, 2);
  let cs = 0;
  for (let i = 0; i < 512; i++) cs += buf[i];
  wo(cs, 148, 8);
  return buf;
}

function padBlock(data) {
  const rem = data.length % 512;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + (512 - rem));
  out.set(data);
  return out;
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
  for (const p of parts) {
    tar.set(p, off);
    off += p.length;
  }

  if (typeof CompressionStream !== "undefined") {
    const cs = new CompressionStream("gzip");
    const w = cs.writable.getWriter();
    w.write(tar);
    w.close();
    const chunks = [];
    const r = cs.readable.getReader();
    while (true) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
    }
    const sz = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(sz);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
  return tar;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function countServiceFields(service) {
  function countGroups(groups) {
    return (groups || []).reduce((sum, group) => {
      const fieldCount = Object.keys(group.fields || {}).length;
      return sum + fieldCount + countGroups(group.groups || []);
    }, 0);
  }

  if (Array.isArray(service.config_groups) && service.config_groups.length > 0) {
    return countGroups(service.config_groups);
  }
  return Object.keys(service.dimensions || {}).length;
}

function renderCapturedServicesList(containerId, services, removable) {
  const container = document.getElementById(containerId);
  if (!services || services.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div>No services captured yet.</div></div>`;
    return;
  }
  container.innerHTML = "";
  for (const svc of services) {
    const el = document.createElement("div");
    el.className = "service-card";
    const dimCount = countServiceFields(svc);
    el.innerHTML = `
      <div class="service-card-icon">⚙</div>
      <div class="service-card-body">
        <div class="service-card-name">${svc.service_name}</div>
        <div class="service-card-meta">${svc.region || "us-east-1"} &middot; ${dimCount} dimension${dimCount !== 1 ? "s" : ""}</div>
      </div>
      ${removable ? `<button class="btn-icon danger service-remove-btn" title="Remove" data-id="${svc.id}">✕</button>` : ""}`;
    if (removable) {
      el.querySelector(".service-remove-btn").addEventListener(
        "click",
        async () => {
          await chrome.runtime.sendMessage({
            action: "removeService",
            id: svc.id,
          });
          const { session } = await chrome.runtime.sendMessage({
            action: "getSession",
          });
          if (session) populateCapturingView(session);
        },
      );
    }
    container.appendChild(el);
  }
}

// ─── Progress render helpers ──────────────────────────────────────────────────

const CHIP_LABELS = {
  idle: "Idle",
  detecting: "Activity detected",
  stabilizing: "Stabilizing…",
  captured: "✓ Captured!",
};

function renderDetectorChip(captureStatus) {
  const cs = captureStatus || { state: "idle", serviceName: null };
  const chip = document.getElementById("detector-chip");
  const label = document.getElementById("detector-label");
  const viewing = document.getElementById("currently-viewing");
  if (!chip || !label || !viewing) return;

  chip.className = `detector-chip ${cs.state}`;
  label.textContent = CHIP_LABELS[cs.state] || cs.state;

  if (cs.serviceName && cs.state !== "idle") {
    viewing.textContent = `↳ ${cs.serviceName}`;
    viewing.style.display = "inline";
  } else {
    viewing.style.display = "none";
  }
}

function renderCaptureLog(captureLog) {
  const container = document.getElementById("capture-log");
  if (!container) return;
  const entries = captureLog || [];

  if (entries.length === 0) {
    container.innerHTML =
      '<div class="empty-state" style="padding:10px">No events yet.</div>';
    return;
  }

  container.innerHTML = "";
  for (const entry of entries) {
    const d = new Date(entry.timestamp);
    const ts = d.toTimeString().slice(0, 8);

    let iconClass = "detecting";
    let iconChar = "●";
    if (entry.event === "captured") {
      iconClass = "captured";
      iconChar = "✓";
    }
    if (entry.event === "updated") {
      iconClass = "captured";
      iconChar = "↑";
    }
    if (entry.event === "duplicate") {
      iconClass = "duplicate";
      iconChar = "=";
    }

    const dimLabel =
      entry.event === "captured" || entry.event === "updated"
        ? `<span class="log-dims">${entry.dim_count} dim</span>`
        : "";

    const row = document.createElement("div");
    row.className = "log-entry";
    row.innerHTML =
      `<span class="log-time">${ts}</span>` +
      `<span class="log-icon ${iconClass}">${iconChar}</span>` +
      `<span class="log-name">${entry.service_name || "—"}</span>` +
      dimLabel;
    container.appendChild(row);
  }

  // Auto-scroll to latest entry
  container.scrollTop = container.scrollHeight;
}

// ─── View populators ──────────────────────────────────────────────────────────

let _prevServiceCount = 0;

function populateCapturingView(session) {
  document.getElementById("cap-profile-name").textContent =
    session.profile.project_name || "—";
  const services = session.capturedServices || [];
  document.getElementById("cap-service-count").textContent = services.length;

  const prevCount = _prevServiceCount;
  _prevServiceCount = services.length;

  renderCapturedServicesList("captured-services-list", services, true);

  // Animate the newest card if a service was just added
  if (services.length > prevCount) {
    const list = document.getElementById("captured-services-list");
    const cards = list.querySelectorAll(".service-card");
    const newest = cards[cards.length - 1];
    if (newest) {
      newest.classList.add("service-card--new");
      setTimeout(() => newest.classList.remove("service-card--new"), 1500);
    }
  }

  renderDetectorChip(session.captureStatus);
  renderCaptureLog(session.captureLog);
}

function populateExportView(session) {
  const count = (session.capturedServices || []).length;
  document.getElementById("exp-profile-name").textContent =
    session.profile.project_name || "Unnamed Profile";
  document.getElementById("exp-profile-meta").textContent =
    `${count} service${count !== 1 ? "s" : ""} captured` +
    (session.profile.description ? ` · ${session.profile.description}` : "");
  document.getElementById("exp-service-count").textContent = count;
  renderCapturedServicesList(
    "export-services-list",
    session.capturedServices,
    false,
  );

  const treeBadge = document.getElementById("exp-tree-badge");
  const groupInfo = document.getElementById("exp-group-info");
  const groupTree = document.getElementById("exp-group-tree");

  if (
    session.estimateTree &&
    session.estimateTree.groups &&
    session.estimateTree.groups.length > 0
  ) {
    treeBadge.style.display = "inline-block";
    groupInfo.style.display = "none";
    groupTree.style.display = "block";
    renderEstimateTree(groupTree, session.estimateTree.groups);
  } else {
    treeBadge.style.display = "none";
    groupInfo.style.display = "block";
    groupTree.style.display = "none";
  }
}

function renderEstimateTree(container, groups) {
  container.innerHTML = "";
  function renderGroup(g, depth) {
    const node = document.createElement("div");
    node.className = "group-node";
    node.style.paddingLeft = `${depth * 12}px`;
    const svcCount = (g.services || []).length;
    node.innerHTML = `
      <div class="group-header">
        <span class="group-name">📁 ${g.label || g.group_name}</span>
        <span class="group-badge">${svcCount} svc</span>
      </div>`;
    for (const child of g.groups || [])
      node.appendChild(renderGroup(child, depth + 1));
    for (const svc of g.services || []) {
      const item = document.createElement("div");
      item.className = "service-item";
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
  const { session } = await chrome.runtime.sendMessage({
    action: "getSession",
  });

  if (!session) {
    showView("setup");
    return;
  }

  if (session.isCapturing) {
    _prevServiceCount = (session.capturedServices || []).length; // no animation on first open
    populateCapturingView(session);
    showView("capturing");
    return;
  }

  // Session exists but not capturing → show export
  if ((session.capturedServices || []).length > 0) {
    populateExportView(session);
    showView("export");
    return;
  }

  // Session with no data — reset to setup
  await chrome.runtime.sendMessage({ action: "clearSession" });
  showView("setup");
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
document.getElementById("btn-toggle-log").addEventListener("click", () => {
  logVisible = !logVisible;
  document.getElementById("capture-log").style.display = logVisible
    ? "block"
    : "none";
  document.getElementById("btn-toggle-log").textContent = logVisible
    ? "▾ Hide"
    : "▸ Show";
  if (logVisible) {
    // Scroll to latest entry on open
    const log = document.getElementById("capture-log");
    log.scrollTop = log.scrollHeight;
  }
});

// ─── Setup view handlers ──────────────────────────────────────────────────────

document
  .getElementById("btn-start-capture")
  .addEventListener("click", async () => {
    const projectName = document
      .getElementById("setup-project-name")
      .value.trim();
    if (!projectName) {
      showToast("Please enter a project name.", "error");
      document.getElementById("setup-project-name").focus();
      return;
    }
    const description =
      document.getElementById("setup-description").value.trim() || null;

    const btn = document.getElementById("btn-start-capture");
    btn.disabled = true;
    btn.textContent = "⏳ Starting…";

    try {
      const result = await chrome.runtime.sendMessage({
        action: "startCapture",
        projectName,
        description,
      });
      if (!result.success)
        throw new Error(result.error || "Failed to start capture");
      const { session } = await chrome.runtime.sendMessage({
        action: "getSession",
      });
      if (session) populateCapturingView(session);
      showView("capturing");
      showToast(
        "Capture started. Navigate to calculator.aws and open your services.",
        "ok",
      );
    } catch (err) {
      showToast("Error: " + err.message, "error");
      btn.disabled = false;
      btn.textContent = "▶ Start Capture";
    }
  });

// ─── Capturing view handlers ──────────────────────────────────────────────────

document
  .getElementById("btn-snapshot-tree")
  .addEventListener("click", async () => {
    const btn = document.getElementById("btn-snapshot-tree");
    btn.disabled = true;
    btn.textContent = "⏳ Scanning…";
    try {
      const result = await chrome.runtime.sendMessage({
        action: "captureEstimateTree",
      });
      if (result.success) {
        const count = (result.tree?.groups || []).length;
        showToast(
          `Snapshot complete — ${count} group${count !== 1 ? "s" : ""} found.`,
          "ok",
        );
      } else {
        showToast(
          result.error || "Could not snapshot estimate groups.",
          "error",
        );
      }
    } catch (err) {
      showToast("Error: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "⬡ Snapshot Estimate Groups";
    }
  });

document
  .getElementById("btn-capture-now")
  .addEventListener("click", async () => {
    const btn = document.getElementById("btn-capture-now");
    btn.disabled = true;
    btn.textContent = "⏳ Capturing…";
    try {
      const result = await chrome.runtime.sendMessage({
        action: "addServiceFromTab",
      });
      if (result.success) {
        showToast(`Captured: ${result.service_name}`, "ok");
      } else {
        showToast(
          result.error ||
            "Nothing captured. Make sure a service config page is open in the calculator.",
          "error",
        );
      }
    } catch (err) {
      showToast("Error: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "⬡ Capture Now";
    }
  });

document
  .getElementById("btn-stop-capture")
  .addEventListener("click", async () => {
    const btn = document.getElementById("btn-stop-capture");
    btn.disabled = true;
    btn.textContent = "⏳ Stopping…";
    try {
      await chrome.runtime.sendMessage({ action: "stopCapture" });
      const { session } = await chrome.runtime.sendMessage({
        action: "getSession",
      });
      if (session && (session.capturedServices || []).length > 0) {
        populateExportView(session);
        showView("export");
        showToast("Capture stopped. Review and export your profile.", "ok");
      } else {
        showToast(
          "No services were captured. Try navigating to a service in the calculator.",
          "error",
        );
        btn.disabled = false;
        btn.textContent = "■ Stop Capture";
      }
    } catch (err) {
      showToast("Error: " + err.message, "error");
      btn.disabled = false;
      btn.textContent = "■ Stop Capture";
    }
  });

// ─── Export view handlers ─────────────────────────────────────────────────────

document
  .getElementById("btn-export-archive")
  .addEventListener("click", async () => {
    const btn = document.getElementById("btn-export-archive");
    btn.disabled = true;
    btn.textContent = "⏳ Building archive…";
    try {
      const { session } = await chrome.runtime.sendMessage({
        action: "getSession",
      });
      if (!session) throw new Error("No session found");

      const profile = buildProfile(session);
      const hcl = serializeHCL(profile);
      const filename = `${profile.project_name.replace(/[^a-z0-9_-]/gi, "_")}.hcl`;

      const tarGz = await buildTarGz([{ name: filename, content: hcl }]);
      const archiveName = `${profile.project_name.replace(/[^a-z0-9_-]/gi, "_")}.tar.gz`;
      downloadBlob(
        new Blob([tarGz], { type: "application/gzip" }),
        archiveName,
      );
      showToast(`Exported ${archiveName}`, "ok");
    } catch (err) {
      showToast("Export failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "↓ Export Archive (.tar.gz)";
    }
  });

document
  .getElementById("btn-export-hcl")
  .addEventListener("click", async () => {
    const btn = document.getElementById("btn-export-hcl");
    btn.disabled = true;
    try {
      const { session } = await chrome.runtime.sendMessage({
        action: "getSession",
      });
      if (!session) throw new Error("No session found");

      const profile = buildProfile(session);
      const hcl = serializeHCL(profile);
      const filename = `${profile.project_name.replace(/[^a-z0-9_-]/gi, "_")}.hcl`;
      downloadBlob(new Blob([hcl], { type: "text/plain" }), filename);
      showToast(`Exported ${filename}`, "ok");
    } catch (err) {
      showToast("Export failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "↓ Export .hcl";
    }
  });

document
  .getElementById("btn-start-over")
  .addEventListener("click", async () => {
    if (!confirm("Clear the current capture session and start over?")) return;
    await chrome.runtime.sendMessage({ action: "clearSession" });
    document.getElementById("setup-project-name").value = "";
    document.getElementById("setup-description").value = "";
    showView("setup");
    showToast("Session cleared.", "info");
  });

// ─── Pin / pop-out window ─────────────────────────────────────────────────────

(async () => {
  const btn = document.getElementById("btn-pin-window");
  // Detect if we're already running in a detached (non-popup) window
  const win = await chrome.windows.getCurrent();
  if (win && win.type !== "popup") {
    // Already detached — show as "pinned" and disable the button
    btn.classList.add("pinned");
    btn.title = "Window is pinned (already detached)";
    btn.textContent = "⊟";
    btn.addEventListener("click", () => window.close());
    return;
  }

  btn.addEventListener("click", () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup/popup.html"),
      type: "popup",
      width: 480,
      height: 640,
      focused: true,
    });
  });
})();

// ─── Boot ─────────────────────────────────────────────────────────────────────

init().catch((err) => {
  console.error("[AWS Cost Builder] init error:", err);
  showToast("Extension error: " + err.message, "error");
});

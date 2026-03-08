/**
 * AWS Cost Builder — Content Script
 * Injected into https://calculator.aws/* pages.
 *
 * Capabilities:
 * - Auto-capture: MutationObserver detects when a service config form loads,
 *   then sends the captured service to the background service worker.
 * - Estimate tree: Scans the left panel to read groups and service names.
 * - Single capture: Legacy on-demand capture for the current page.
 */

'use strict';

// ─── Field value readers ──────────────────────────────────────────────────────

function readFieldValue(el) {
  if (!el) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return el.checked ? 'true' : 'false';
    return el.value || '';
  }
  if (tag === 'select') {
    return el.value || el.options?.[el.selectedIndex]?.text || '';
  }
  if (tag === 'textarea') return el.value || '';
  if (el.getAttribute('role') === 'combobox' || el.contentEditable === 'true') {
    return el.textContent?.trim() || el.value || '';
  }
  return el.value || el.textContent?.trim() || '';
}

function findLabel(el) {
  if (!el) return '';
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.trim().split(/\s+/);
    const text = parts.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    if (text) return text;
  }

  if (el.id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelEl) return labelEl.textContent.trim();
  }

  const closestLabel = el.closest('label');
  if (closestLabel) {
    const clone = closestLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach(c => c.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  const container = el.closest('[class*="field"], [class*="input"], [class*="form-group"], [class*="control"]');
  if (container) {
    const heading = container.querySelector('label, legend, [class*="label"]');
    if (heading && heading !== el) return heading.textContent.trim();
  }

  return '';
}

// ─── Page scanners ────────────────────────────────────────────────────────────

function detectServiceName() {
  const candidates = [
    '[class*="serviceTitle"]',
    '[class*="service-title"]',
    '[class*="ServiceHeader"]',
    '[data-testid*="service-name"]',
    'h1',
    'h2',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (text && text.length > 2) return text;
    }
  }
  return document.title.replace(/\s*[|\-–]\s*AWS Pricing Calculator.*$/i, '').trim() || 'Unknown Service';
}

function detectRegion() {
  const regionSelectors = [
    'select[data-testid*="region"]',
    'select[aria-label*="region" i]',
    'select[name*="region" i]',
    '[class*="regionSelector"] select',
    '[aria-label="Region"]',
    '[placeholder*="region" i]',
  ];
  for (const sel of regionSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const val = readFieldValue(el);
      if (val) return val;
    }
  }
  const regionText = document.querySelector('[class*="region"] [class*="value"], [class*="regionLabel"], [class*="region-value"]');
  if (regionText) return regionText.textContent.trim();
  return 'us-east-1';
}

function scanFields() {
  const dimensions = [];
  const seen = new Set();

  const fieldSelectors = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]):not([type="reset"])',
    'select',
    'textarea',
    '[role="combobox"]',
    '[role="spinbutton"]',
    '[role="radio"][aria-checked]',
    '[role="switch"][aria-checked]',
  ];

  for (const sel of fieldSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) continue;
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;

      const label = findLabel(el);
      if (!label || label.length < 2 || seen.has(label)) continue;

      const value = readFieldValue(el);
      if (!value && el.tagName.toLowerCase() !== 'select') continue;

      seen.add(label);

      let fieldType = 'TEXT';
      const tag = el.tagName.toLowerCase();
      if (tag === 'select') fieldType = 'SELECT';
      else if ((el.getAttribute('role') || '') === 'combobox') fieldType = 'COMBOBOX';
      else if ((el.type || '') === 'number' || (el.getAttribute('role') || '') === 'spinbutton') fieldType = 'NUMBER';
      else if ((el.type || '') === 'radio') fieldType = 'RADIO';
      else if ((el.type || '') === 'checkbox' || (el.getAttribute('role') || '') === 'switch') fieldType = 'TOGGLE';

      dimensions.push({ key: label, value, fieldType });
    }
  }

  return dimensions;
}

function captureCurrentPage() {
  const service_name = detectServiceName();
  const region = detectRegion();
  const rawFields = scanFields();
  const dimensions = {};
  for (const f of rawFields) {
    if (f.key) dimensions[f.key] = { user_value: f.value, default_value: null };
  }
  return { service_name, region, dimensions };
}

// ─── Estimate tree scanner ────────────────────────────────────────────────────

/**
 * Scan the left sidebar / estimate panel for groups and services.
 * Returns { groups: [{ group_name, label, services: [{ service_name, region }] }] }
 *
 * The AWS Calculator sidebar is a tree of estimate items. We look for
 * elements that look like group headers and service items.
 */
function captureEstimateTree() {
  const groups = [];

  // Strategy 1: Look for a nav/tree panel with nested list structure
  const treeContainer = document.querySelector(
    '[class*="estimatePanel"], [class*="estimate-panel"], [class*="sidebar"], [class*="Sidebar"], nav[class*="estimate"], [role="tree"]'
  );

  if (treeContainer) {
    // Walk tree nodes
    const groupNodes = treeContainer.querySelectorAll('[role="treeitem"], [class*="group"], [class*="Group"]');
    const seenGroups = new Set();

    for (const node of groupNodes) {
      const labelEl = node.querySelector('[class*="label"], [class*="name"], [class*="title"]') || node;
      const labelText = labelEl.textContent.trim().replace(/\s+/g, ' ');
      if (!labelText || seenGroups.has(labelText)) continue;

      // Check if it looks like a group (has children) vs service
      const children = node.querySelectorAll('[role="treeitem"]');
      if (children.length > 0) {
        seenGroups.add(labelText);
        const services = [];
        for (const child of children) {
          const childLabel = child.querySelector('[class*="label"], [class*="name"]') || child;
          const childText = childLabel.textContent.trim().replace(/\s+/g, ' ');
          if (childText && childText !== labelText) {
            services.push({
              service_name: childText,
              region: 'us-east-1',
            });
          }
        }
        groups.push({
          group_name: labelText.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          label: labelText,
          services,
          groups: [],
        });
      }
    }
  }

  // Strategy 2: Look for estimate list items with service names
  if (groups.length === 0) {
    const listItems = document.querySelectorAll(
      '[class*="estimateItem"], [class*="estimate-item"], [class*="serviceItem"], [class*="service-item"]'
    );

    if (listItems.length > 0) {
      const defaultGroup = { group_name: 'estimate', label: 'Estimate', services: [], groups: [] };
      for (const item of listItems) {
        const nameEl = item.querySelector('[class*="name"], [class*="title"], strong') || item;
        const name = nameEl.textContent.trim().replace(/\s+/g, ' ');
        if (name) {
          defaultGroup.services.push({ service_name: name, region: 'us-east-1' });
        }
      }
      if (defaultGroup.services.length > 0) groups.push(defaultGroup);
    }
  }

  // Strategy 3: Fallback — build a flat group from the page title
  if (groups.length === 0) {
    groups.push({
      group_name: 'estimate',
      label: 'Estimate',
      services: [],
      groups: [],
    });
  }

  return { groups };
}

// ─── Auto-capture (MutationObserver) ─────────────────────────────────────────

let autoObserver = null;
let captureDebounceTimer = null;
let lastCapturedServiceName = null;

function triggerAutoCapture() {
  clearTimeout(captureDebounceTimer);
  captureDebounceTimer = setTimeout(() => {
    // Only capture if there are visible form fields (service config is open)
    const hasFields = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, [role="combobox"]'
    ).length > 0;

    if (!hasFields) return;

    const data = captureCurrentPage();

    // Skip if no meaningful dimensions were captured
    const dimCount = Object.keys(data.dimensions).length;
    if (dimCount === 0) return;

    // Skip if this is the same service+region we just captured
    const key = `${data.service_name}|${data.region}`;
    if (key === lastCapturedServiceName) return;
    lastCapturedServiceName = key;

    chrome.runtime.sendMessage({
      action: 'serviceAutoCaptured',
      data,
    }).catch(() => {});
  }, 1500);
}

function startAutoCapture() {
  if (autoObserver) return;

  lastCapturedServiceName = null;

  // Trigger an initial capture of the current view
  triggerAutoCapture();

  // Watch for DOM changes indicating a new service config has loaded
  const target = document.body;
  autoObserver = new MutationObserver((mutations) => {
    // Only react to meaningful DOM changes (node additions, not just attribute updates)
    const hasMeaningfulChange = mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0);
    if (hasMeaningfulChange) triggerAutoCapture();
  });

  autoObserver.observe(target, {
    childList: true,
    subtree: true,
  });
}

function stopAutoCapture() {
  if (autoObserver) {
    autoObserver.disconnect();
    autoObserver = null;
  }
  clearTimeout(captureDebounceTimer);
  lastCapturedServiceName = null;
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ success: true, ready: true });
    return true;
  }

  if (message.action === 'capture') {
    try {
      const data = captureCurrentPage();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  if (message.action === 'startAutoCapture') {
    startAutoCapture();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'stopAutoCapture') {
    stopAutoCapture();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'getEstimateTree') {
    try {
      const tree = captureEstimateTree();
      sendResponse({ success: true, tree });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});

// Debug helpers
window.__awsCostCapture = captureCurrentPage;
window.__awsCostEstimateTree = captureEstimateTree;

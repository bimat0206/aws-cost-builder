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

  // 1. aria-label directly on the element
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // 2. aria-labelledby pointing to another element
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.trim().split(/\s+/);
    const text = parts.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    if (text) return text;
  }

  // 3. Standard <label for="id">
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelEl) return labelEl.textContent.trim().replace(/\s*\*\s*$/, '');
  }

  // 4. Wrapped inside <label>
  const closestLabel = el.closest('label');
  if (closestLabel) {
    const clone = closestLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach(c => c.remove());
    const text = clone.textContent.trim().replace(/\s*\*\s*$/, '');
    if (text) return text;
  }

  // 5. CloudScape / awsui: climb up to a form-field container and read its label slot
  const awsuiField = el.closest(
    '[class*="awsui-form-field"], [class*="form-field__control"], [class*="formField"]'
  );
  if (awsuiField) {
    // awsui renders label as the first child div / a sibling before the control
    const labelEl = awsuiField.querySelector(
      '[class*="awsui-form-field-label"] label, ' +
      '[class*="form-field__label"] label, ' +
      '[class*="awsui-form-field-label"], ' +
      '[class*="form-field__label"]'
    );
    if (labelEl) {
      const text = labelEl.textContent.trim().replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ');
      if (text && text.length >= 2) return text;
    }
  }

  // 6. Generic upward traversal — look for label/legend text near the element
  let parent = el.parentElement;
  for (let depth = 0; depth < 6 && parent; depth++, parent = parent.parentElement) {
    // Direct label/legend children or siblings of the parent
    for (const candidate of parent.querySelectorAll('label, legend')) {
      if (candidate.contains(el)) continue; // skip if it wraps the element (covered by #4)
      const text = candidate.textContent.trim().replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length < 100) return text;
    }
    // Also check for [class*="label"] that looks like a label
    for (const candidate of parent.querySelectorAll('[class*="label"]:not(input):not(select):not(textarea):not(button)')) {
      if (candidate.contains(el)) continue;
      const text = candidate.textContent.trim().replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length < 100) return text;
    }
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

function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) return false;
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  return true;
}

function classifyField(el) {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const type = (el.type || '').toLowerCase();
  if (tag === 'select') return 'SELECT';
  if (role === 'combobox') return 'COMBOBOX';
  if (type === 'number' || role === 'spinbutton') return 'NUMBER';
  if (type === 'radio') return 'RADIO';
  if (type === 'checkbox' || role === 'switch') return 'TOGGLE';
  if (role === 'slider') return 'SLIDER';
  return 'TEXT';
}

function scanFields() {
  const dimensions = [];
  const seen = new Set();

  // ── Pass 1: standard field selectors (all frameworks) ──────────────────────
  const fieldSelectors = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]):not([type="reset"])',
    'select',
    'textarea',
    '[role="combobox"]',
    '[role="spinbutton"]',
    '[role="slider"]',
    '[role="radio"][aria-checked]',
    '[role="switch"][aria-checked]',
  ];

  for (const sel of fieldSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (!isVisible(el)) continue;

      const label = findLabel(el);
      if (!label || label.length < 2 || seen.has(label)) continue;

      const value = readFieldValue(el);
      const fieldType = classifyField(el);
      // Allow empty value only for select, number, spinbutton, slider (0 is valid)
      if (!value && !['SELECT', 'NUMBER', 'SLIDER'].includes(fieldType)) continue;

      seen.add(label);
      dimensions.push({ key: label, value, fieldType });
    }
  }

  // ── Pass 2: CloudScape (awsui) form-field containers ──────────────────────
  // awsui wraps each field in a container that has the label as a sibling of
  // the control, so standard label-lookup often misses it. We scan the
  // containers directly and extract label + control value.
  const awsuiContainers = document.querySelectorAll(
    '[class*="awsui-form-field"]:not([class*="awsui-form-field-label"]):not([class*="awsui-form-field-description"])'
  );
  for (const container of awsuiContainers) {
    if (!isVisible(container)) continue;

    // Find the label text
    const labelEl = container.querySelector(
      '[class*="awsui-form-field-label"] label, ' +
      '[class*="form-field__label"] label, ' +
      '[class*="awsui-form-field-label"], ' +
      '[class*="form-field__label"], ' +
      'label'
    );
    if (!labelEl) continue;
    const label = labelEl.textContent.trim().replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ');
    if (!label || label.length < 2 || seen.has(label)) continue;

    // Find the control inside this container
    const control = container.querySelector(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), ' +
      'select, textarea, [role="combobox"], [role="spinbutton"], [role="slider"]'
    );
    if (!control || !isVisible(control)) continue;

    const value = readFieldValue(control);
    const fieldType = classifyField(control);
    if (!value && !['SELECT', 'NUMBER', 'SLIDER'].includes(fieldType)) continue;

    seen.add(label);
    dimensions.push({ key: label, value, fieldType });
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
let captureScheduled = false;   // true while debounce timer is pending
let lastCapturedServiceName = null;

function sendProgress(status, serviceName = null) {
  chrome.runtime.sendMessage({
    action: 'captureProgress',
    status,
    serviceName,
  }).catch(() => {});
}

// Form-related tag names and ARIA roles that indicate a real UI change worth capturing
const FORM_TAGS = new Set(['input', 'select', 'textarea', 'form', 'fieldset']);
const FORM_ROLES = new Set(['combobox', 'spinbutton', 'radio', 'checkbox', 'switch', 'listbox', 'slider', 'option']);

function hasMeaningfulMutation(mutations) {
  for (const m of mutations) {
    for (const node of [...m.addedNodes, ...m.removedNodes]) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName?.toLowerCase();
      const role = node.getAttribute?.('role')?.toLowerCase();
      if (FORM_TAGS.has(tag) || FORM_ROLES.has(role)) return true;
      // Check descendants
      if (node.querySelector?.('input, select, textarea, [role="combobox"], [role="spinbutton"], [role="slider"]')) return true;
    }
  }
  return false;
}

function triggerAutoCapture() {
  // Leading debounce: only schedule if one isn't already pending.
  // This prevents the AWS SPA's constant re-renders from perpetually resetting
  // the timer — the capture fires 2s after the FIRST mutation in a burst.
  if (captureScheduled) return;
  captureScheduled = true;

  sendProgress('detecting', detectServiceName());

  captureDebounceTimer = setTimeout(() => {
    captureScheduled = false;

    // Only capture if there are visible form fields (service config is open)
    const hasFields = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), ' +
      'select, [role="combobox"], [role="spinbutton"]'
    ).length > 0;

    if (!hasFields) {
      sendProgress('idle');
      return;
    }

    // Phase 2 — fields found, running capture
    const currentName = detectServiceName();
    sendProgress('stabilizing', currentName);

    const data = captureCurrentPage();

    // Skip if no meaningful dimensions were captured
    const dimCount = Object.keys(data.dimensions).length;
    if (dimCount === 0) {
      sendProgress('idle');
      return;
    }

    // Skip if this is the same service+region we just captured
    const key = `${data.service_name}|${data.region}`;
    if (key === lastCapturedServiceName) {
      sendProgress('idle');
      return;
    }
    lastCapturedServiceName = key;

    chrome.runtime.sendMessage({
      action: 'serviceAutoCaptured',
      data,
    }).catch(() => {});

    // Phase 3 — sent; background will flip to 'captured', then back to idle
    sendProgress('idle');
  }, 2000);
}

function startAutoCapture() {
  if (autoObserver) return;

  lastCapturedServiceName = null;
  captureScheduled = false;

  // Trigger an initial capture of the current view
  triggerAutoCapture();

  // Watch for DOM changes that indicate a new service config has loaded.
  // We filter mutations to only react to form-element changes to avoid
  // being swamped by the SPA's constant reactive re-renders.
  const target = document.body;
  autoObserver = new MutationObserver((mutations) => {
    if (hasMeaningfulMutation(mutations)) triggerAutoCapture();
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
  captureScheduled = false;
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

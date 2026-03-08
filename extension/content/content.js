/**
 * AWS Cost Builder — Content Script
 * Injected into https://calculator.aws/* pages.
 *
 * Exposes capture functionality to the extension popup via chrome.runtime messaging.
 */

'use strict';

// ─── Field value readers ──────────────────────────────────────────────────────

/**
 * Read the current value from an input-like element.
 * @param {Element} el
 * @returns {string}
 */
function readFieldValue(el) {
  if (!el) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      return el.checked ? 'true' : 'false';
    }
    return el.value || '';
  }
  if (tag === 'select') {
    return el.value || el.options[el.selectedIndex]?.text || '';
  }
  if (tag === 'textarea') {
    return el.value || '';
  }
  // combobox / contenteditable
  if (el.getAttribute('role') === 'combobox' || el.contentEditable === 'true') {
    return el.textContent?.trim() || el.value || '';
  }
  // Generic: try value then text
  return el.value || el.textContent?.trim() || '';
}

/**
 * Find the visible label for a form element.
 * Searches: aria-label, aria-labelledby, <label for=>, closest label, parent text.
 * @param {Element} el
 * @returns {string}
 */
function findLabel(el) {
  if (!el) return '';

  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }

  // <label for="id">
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelEl) return labelEl.textContent.trim();
  }

  // Closest wrapping label
  const closestLabel = el.closest('label');
  if (closestLabel) {
    const clone = closestLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea').forEach(child => child.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // Parent container heading
  const container = el.closest('[class*="field"], [class*="input"], [class*="form-group"], [class*="control"]');
  if (container) {
    const heading = container.querySelector('label, legend, [class*="label"]');
    if (heading && heading !== el) return heading.textContent.trim();
  }

  return '';
}

// ─── Page state scraper ───────────────────────────────────────────────────────

/**
 * Determine the current service name from the page heading.
 * AWS Calculator typically shows the selected service in an h1/h2.
 * @returns {string}
 */
function detectServiceName() {
  // Try breadcrumb / service title area
  const selectors = [
    '[class*="serviceTitle"]',
    '[class*="service-title"]',
    '[data-testid*="service"]',
    'h1',
    'h2',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      return el.textContent.trim().replace(/\s+/g, ' ');
    }
  }
  return document.title.replace(' | AWS Pricing Calculator', '').trim();
}

/**
 * Read the currently selected region from the page.
 * @returns {string}
 */
function detectRegion() {
  // Look for region select/dropdown
  const regionSelectors = [
    'select[data-testid*="region"]',
    'select[aria-label*="region" i]',
    'select[name*="region" i]',
    '[class*="regionSelector"] select',
    '[aria-label="Region"]',
  ];
  for (const sel of regionSelectors) {
    const el = document.querySelector(sel);
    if (el) return readFieldValue(el);
  }

  // Text-based region indicator
  const regionText = document.querySelector('[class*="region"] [class*="value"], [class*="regionLabel"]');
  if (regionText) return regionText.textContent.trim();

  return 'us-east-1';
}

/**
 * Scan all visible form fields on the page and return dimension key-value pairs.
 * @returns {Array<{key: string, value: string, fieldType: string}>}
 */
function scanFields() {
  const dimensions = [];
  const seen = new Set();

  // Selectors that match input-like elements in the AWS Calculator
  const fieldSelectors = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"])',
    'select',
    'textarea',
    '[role="combobox"]',
    '[role="spinbutton"]',
    '[role="radio"][aria-checked]',
    '[role="switch"][aria-checked]',
  ];

  for (const sel of fieldSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      // Skip invisible
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;

      const label = findLabel(el);
      if (!label || seen.has(label)) continue;

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

/**
 * Capture the full current state of the open service configuration form.
 * @returns {{ service_name: string, region: string, dimensions: Array<{key: string, value: string}> }}
 */
function captureCurrentPage() {
  const service_name = detectServiceName();
  const region = detectRegion();
  const rawFields = scanFields();

  const dimensions = rawFields.map(f => ({
    key: f.key,
    value: f.value,
    fieldType: f.fieldType,
  }));

  return { service_name, region, dimensions };
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture') {
    try {
      const data = captureCurrentPage();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  if (message.action === 'ping') {
    sendResponse({ success: true, ready: true });
    return true;
  }
});

// Expose on window for debugging
window.__awsCostCapture = captureCurrentPage;

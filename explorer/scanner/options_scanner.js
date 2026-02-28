/**
 * Options scanner for SELECT and COMBOBOX dimensions.
 * 
 * Matches Python explorer/options_scanner.py logic:
 * - Interactive options capture for SELECT/COMBOBOX
 * - Dropdown opening and scrolling to exhaust options
 * - Truncation at 50 options
 * - Review prompt for operator confirmation
 * 
 * @module explorer/scanner/options_scanner
 */

import { DraftDimension } from '../models.js';
import { UNKNOWN, LOG_LEVELS } from '../constants.js';
import { logEvent as sharedLogEvent } from '../../core/index.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

/**
 * Format and print a log line.
 * @param {string} level
 * @param {string} module
 * @param {string} event
 * @param {string} message
 */
function log(level, module, event, message) {
  sharedLogEvent(level, module, event, message ? { message } : {});
}

/**
 * Log an info message.
 * @param {string} module
 * @param {string} event
 * @param {string} message
 */
function logInfo(module, event, message = '') {
  log(LOG_LEVELS.INFO, module, event, message);
}

/**
 * Log an error message.
 * @param {string} module
 * @param {string} event
 * @param {string} message
 */
function logError(module, event, message = '') {
  log(LOG_LEVELS.ERROR, module, event, message);
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * Sleep for specified milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



// ─── Options capture functions ────────────────────────────────────────────────

/**
 * Reusable wrapper for options capture logic that handles visibility checks
 * and common error handling.
 * 
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string} fieldType
 * @param {function(import('playwright').Locator, string[]): Promise<void>} captureFn
 * @returns {Promise<string[]>}
 */
async function withOptionsCapture(page, selector, fieldType, captureFn) {
  const options = [];

  try {
    const loc = page.locator(selector).first();
    const isVisible = await loc.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) {
      const msg = fieldType === 'RADIO' ? 'Container not currently visible' : 'Field not currently visible';
      logInfo('explorer/scanner/options_scanner', 'EVT-OPT-HIDDEN', msg);
      return [];
    }

    await captureFn(loc, options);
  } catch (error) {
    logError('explorer/scanner/options_scanner', 'EVT-OPT-FAIL', `${fieldType} capture failed: ${error.message}`);
    if (fieldType === 'COMBOBOX') {
      // Try to close dropdown on error
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  return options;
}

/**
 * Capture options for a SELECT element.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<string[]>}
 */
async function captureSelectOptions(page, selector) {
  return withOptionsCapture(page, selector, 'SELECT', async (loc, options) => {
    // Try native select options first
    const optionsLoc = loc.locator('option');
    const count = await optionsLoc.count();
    
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const text = await optionsLoc.nth(i).textContent();
        if (text && text.trim()) {
          options.push(text.trim());
        }
      }
    }
  });
}

/**
 * Capture options for a COMBOBOX element.
 * 
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<string[]>}
 */
async function captureComboboxOptions(page, selector) {
  return withOptionsCapture(page, selector, 'COMBOBOX', async (loc, options) => {
    // Click to open dropdown
    await loc.click({ timeout: 2000 });
    await sleep(500);

    // Find listbox popover (explicit role OR aria-controls target)
    let listbox = page.locator("[role='listbox']").last();
    let listboxVisible = await listbox.isVisible({ timeout: 2000 }).catch(() => false);

    if (!listboxVisible) {
      const ariaControls = await loc.getAttribute('aria-controls');
      if (ariaControls) {
        const target = page.locator(`#${ariaControls}`).first();
        if ((await target.count().catch(() => 0)) > 0) {
          const visible = await target.isVisible({ timeout: 1500 }).catch(() => false);
          if (visible) {
            listbox = target;
            listboxVisible = true;
          }
        }
      }
    }

    if (!listboxVisible) {
      const optionsLoc = loc.locator('option');
      const count = await optionsLoc.count();
      for (let i = 0; i < count; i++) {
        const text = await optionsLoc.nth(i).textContent();
        if (text && text.trim()) {
          options.push(text.trim());
        }
      }
      return;
    }

    // Scroll to exhaust options
    let lastCount = -1;
    for (let scrollAttempt = 0; scrollAttempt < 10; scrollAttempt++) {
      const opts = listbox.locator("[role='option']");
      const count = await opts.count();

      for (let i = 0; i < count; i++) {
        try {
          const text = await opts.nth(i).textContent();
          if (text && text.trim() && !options.includes(text.trim())) {
            options.push(text.trim());
          }
        } catch (error) {
          // Skip failed elements
        }
      }

      if (count === lastCount) {
        break;
      }
      lastCount = count;

      // Scroll down
      try {
        const lastOpt = opts.last();
        await lastOpt.scrollIntoViewIfNeeded({ timeout: 1000 });
        await sleep(200);
      } catch (error) {
        break;
      }
    }

    // Close dropdown
    await page.keyboard.press('Escape');
  });
}

/**
 * Capture options for RADIO button group.
 * 
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<string[]>}
 */
async function captureRadioOptions(page, selector) {
  return withOptionsCapture(page, selector, 'RADIO', async (container, options) => {
    // Find radio buttons within container
    const radios = container.locator('input[type="radio"]');
    const count = await radios.count();

    for (let i = 0; i < count; i++) {
      try {
        const radio = radios.nth(i);
        let label = null;

        // Try aria-label
        const ariaLabel = await radio.getAttribute('aria-label');
        if (ariaLabel) {
          label = ariaLabel.trim();
        }

        // Try associated label
        if (!label) {
          const id = await radio.getAttribute('id');
          if (id) {
            const labelEl = page.locator(`label[for="${id}"]`).first();
            const labelCount = await labelEl.count();
            if (labelCount > 0) {
              label = (await labelEl.textContent())?.trim() || null;
            }
          }
        }

        // Try wrapping label
        if (!label) {
          const parentLabel = radio.locator('xpath=ancestor::label[1]');
          const parentCount = await parentLabel.count();
          if (parentCount > 0) {
            let text = await parentLabel.textContent();
            // Remove radio's own text
            const radioText = await radio.textContent();
            if (radioText) {
              text = text.replace(radioText.trim(), '').trim();
            }
            if (text) {
              label = text;
            }
          }
        }

        // Use value as fallback
        if (!label) {
          const value = await radio.getAttribute('value');
          label = value || `Option ${i + 1}`;
        }

        if (label) {
          options.push(label);
        }
      } catch (error) {
        // Skip failed radios
      }
    }
  });
}

/**
 * Capture options for SELECT/COMBOBOX/RADIO fields interactively.
 * Matches Python's capture_options_for_dimensions.
 * 
 * @param {import('playwright').Page} page
 * @param {DraftDimension[]} dimensions
 * @returns {Promise<void>}
 */
export async function captureOptionsForDimensions(page, dimensions) {
  logInfo('explorer/scanner/options_scanner', 'EVT-OPT-START', 'Starting options capture...');

  for (const dim of dimensions) {
    if (!['SELECT', 'COMBOBOX', 'RADIO'].includes(dim.field_type)) {
      continue;
    }

    // Skip if already has options
    if (dim.options && dim.options.length > 0 && !dim.options.includes('TRUNCATED')) {
      continue;
    }

    const key = dim.key || dim.fallback_label || UNKNOWN;
    logInfo('explorer/scanner/options_scanner', 'EVT-OPT-CAPTURE', `Capturing options for: ${key}...`);

    const selector = dim.css_selector;
    if (!selector || selector === UNKNOWN) {
      logError('explorer/scanner/options_scanner', 'EVT-OPT-NOSEL', `Cannot capture options: missing CSS selector.`);
      logError('explorer/scanner/options_scanner', 'EVT-OPT-FAIL', `Cannot capture options for ${key}: missing CSS selector.`);
      continue;
    }

    let options = [];

    try {
      if (dim.field_type === 'SELECT') {
        options = await captureSelectOptions(page, selector);
      } else if (dim.field_type === 'COMBOBOX') {
        options = await captureComboboxOptions(page, selector);
      } else if (dim.field_type === 'RADIO') {
        options = await captureRadioOptions(page, selector);
      }
    } catch (error) {
      logError('explorer/scanner/options_scanner', 'EVT-OPT-FAIL', `Error capturing options: ${error.message}`);
      logError('explorer/scanner/options_scanner', 'EVT-OPT-FAIL', `Error capturing options for ${key}: ${error.message}`);
      continue;
    }

    if (options.length === 0) {
      logInfo('explorer/scanner/options_scanner', 'EVT-OPT-EMPTY', `No options found for: ${key}`);
      continue;
    }

    // Truncate if too many
    if (options.length > 50) {
      logInfo('explorer/scanner/options_scanner', 'EVT-OPT-TRUNC', `${key}: ${options.length} options → truncated to 50`);
      dim.options = options.slice(0, 50).concat(['TRUNCATED']);
    } else {
      logInfo('explorer/scanner/options_scanner', 'EVT-OPT-SUCCESS', `${key}: ${options.length} options → ${options.slice(0, 5).join(', ')}${options.length > 5 ? ' ...' : ''}`);
      dim.options = options;
    }
  }

  logInfo('explorer/scanner/options_scanner', 'EVT-OPT-END', 'Options capture complete');
}

/**
 * Scan options for a single field (non-interactive).
 * Matches Python's scanOptions.
 * 
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<string[]>}
 */
export async function scanOptions(page, selector) {
  logInfo('explorer/scanner/options_scanner', 'EVT-SCAN-01', `Scanning options: ${selector}`);

  try {
    // Detect field type
    const fieldType = await page.evaluate(`(sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role');
      const type = el.getAttribute('type');
      
      if (tag === 'select') return 'SELECT';
      if (tag === 'input' && type === 'radio') return 'RADIO';
      if (role === 'combobox') return 'COMBOBOX';
      if (role === 'listbox') return 'SELECT';
      if (el.querySelector('input[type="radio"]')) return 'RADIO';
      if (el.querySelector('select')) return 'SELECT';
      if (el.querySelector('[role="listbox"], [role="option"]')) return 'COMBOBOX';
      
      return null;
    }`, selector);

    let options = [];

    switch (fieldType) {
      case 'SELECT':
        options = await captureSelectOptions(page, selector);
        break;
      case 'COMBOBOX':
        options = await captureComboboxOptions(page, selector);
        break;
      case 'RADIO':
        options = await captureRadioOptions(page, selector);
        break;
      default:
        logError('explorer/scanner/options_scanner', 'EVT-SCAN-FAIL', `Could not detect field type for: ${selector}`);
        return [];
    }

    return options;
  } catch (error) {
    logError('explorer/scanner/options_scanner', 'EVT-SCAN-FAIL', `Options scan failed: ${error.message}`);
    return [];
  }
}

/**
 * Scan all options on page.
 * 
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ selector: string, label: string, type: string, options: string[] }>>}
 */
export async function scanAllOptions(page) {
  logInfo('explorer/scanner/options_scanner', 'EVT-SCAN-ALL', 'Scanning all options on page...');

  try {
    const fields = await page.evaluate(`(function() {
      const results = [];

      // Find all select elements
      document.querySelectorAll('select').forEach(el => {
        const label = el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.id ||
          'Unnamed Select';
        results.push({
          selector: generateSelector(el),
          label,
          type: 'SELECT',
        });
      });

      // Find all comboboxes
      document.querySelectorAll('[role="combobox"]').forEach(el => {
        const label = el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.id ||
          'Unnamed Combobox';
        results.push({
          selector: generateSelector(el),
          label,
          type: 'COMBOBOX',
        });
      });

      // Find all radio groups
      const radioGroups = new Map();
      document.querySelectorAll('input[type="radio"]').forEach(el => {
        const name = el.getAttribute('name');
        if (name) {
          if (!radioGroups.has(name)) {
            const container = el.closest('fieldset, .radio-group, [role="radiogroup"]') || el.parentElement;
            radioGroups.set(name, {
              selector: generateSelector(container),
              label: name,
              type: 'RADIO',
            });
          }
        }
      });

      radioGroups.forEach(group => results.push(group));

      return results;

      function generateSelector(el) {
        if (!el) return 'UNKNOWN';
        const parts = [];
        let current = el;
        while (current && current.nodeType === 1) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector += '#' + current.id;
            parts.unshift(selector);
            break;
          }
          if (current.className && typeof current.className === 'string') {
            const classes = current.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) {
              selector += '.' + classes.slice(0, 2).join('.');
            }
          }
          parts.unshift(selector);
          current = current.parentElement;
          if (current && ['body', 'main', 'section', 'form'].includes(current.tagName.toLowerCase())) {
            break;
          }
        }
        return parts.join(' > ') || 'UNKNOWN';
      }
    })()`);

    const allOptions = [];
    for (const field of fields) {
      const options = await scanOptions(page, field.selector);
      if (options.length > 0) {
        allOptions.push({
          selector: field.selector,
          label: field.label,
          type: field.type,
          options,
        });
      }
    }

    logInfo('explorer/scanner/options_scanner', 'EVT-SCAN-ALL-END', `Scanned options for ${allOptions.length} fields`);
    return allOptions;
  } catch (error) {
    logError('explorer/scanner/options_scanner', 'EVT-SCAN-ALL-FAIL', `Scan all options failed: ${error.message}`);
    return [];
  }
}

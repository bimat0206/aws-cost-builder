/**
 * Find-in-Page locator — resolves dimension labels to Playwright element handles.
 *
 * Uses a tiered fallback strategy matching Python's find_in_page_locator.py:
 * 1. CSS selector from catalog (primary)
 * 2. aria-label text search
 * 3. label[for] association
 * 4. role + name matching
 * 5. Visible text content match
 * 6. Find-in-Page keyboard shortcut (fallback)
 *
 * Handles F-L11-01 (success), F-L11-02 (element not found), F-L11-03 (multiple matches)
 *
 * @module automation/locator/find_in_page_locator
 */

import { getSelectionBoundingRect, queryControlsInBand, scrollToPosition } from './cdp_helper.js';
import { withRetry } from '../../core/retry/retry_wrapper.js';
import { buildScreenshotPath } from '../../core/emitter/screenshot_manager.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const MODULE = 'automation/locator/find_in_page_locator';

/**
 * Format and print a structured log line.
 * @param {string} level
 * @param {string} eventType
 * @param {Object} fields
 */
function logEvent(level, eventType, fields = {}) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const fieldStr = Object.entries({ event_type: eventType, ...fields })
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  process.stderr.write(`${ts} | ${level.padEnd(8)} | ${MODULE.padEnd(30)} | ${fieldStr}\n`);
}

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Error thrown when element cannot be located.
 */
export class LocatorNotFoundError extends Error {
  /**
   * @param {string} dimensionKey
   * @param {string} [strategy]
   */
  constructor(dimensionKey, strategy = 'find-in-page') {
    super(`Could not locate element for dimension: "${dimensionKey}" (strategy: ${strategy})`);
    this.name = 'LocatorNotFoundError';
    this.dimensionKey = dimensionKey;
    this.strategy = strategy;
  }
}

// ─── Field type detection ─────────────────────────────────────────────────────

/**
 * Map DOM element to field_type.
 * @param {string} tagName
 * @param {string} [type]
 * @param {string} [role]
 * @returns {string}
 */
export function detectFieldType(tagName, type = null, role = null) {
  const tag = tagName.toLowerCase();
  const inputType = type ? type.toLowerCase() : null;
  const ariaRole = role ? role.toLowerCase() : null;

  if (tag === 'input') {
    if (inputType === 'number') return 'NUMBER';
    if (inputType === 'text') return 'TEXT';
    if (inputType === 'checkbox') return 'TOGGLE';
    if (inputType === 'radio') return 'RADIO';
    return 'TEXT';
  }

  if (tag === 'select') return 'SELECT';
  if (tag === 'textarea') return 'TEXT';

  if (ariaRole === 'combobox') return 'COMBOBOX';
  if (ariaRole === 'spinbutton') return 'NUMBER';
  if (ariaRole === 'switch') return 'TOGGLE';
  if (ariaRole === 'radio') return 'RADIO';
  if (ariaRole === 'listbox') return 'SELECT';

  return 'TEXT';
}

/**
 * Get the field type from a Playwright element handle.
 * @param {import('playwright').ElementHandle} element
 * @returns {Promise<string>}
 */
export async function getFieldType(element) {
  return await element.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    const role = el.getAttribute('role');

    if (tag === 'input') {
      if (type === 'number') return 'NUMBER';
      if (type === 'text') return 'TEXT';
      if (type === 'checkbox') return 'TOGGLE';
      if (type === 'radio') return 'RADIO';
      return 'TEXT';
    }

    if (tag === 'select') return 'SELECT';
    if (tag === 'textarea') return 'TEXT';

    if (role === 'combobox') return 'COMBOBOX';
    if (role === 'spinbutton') return 'NUMBER';
    if (role === 'switch') return 'TOGGLE';
    if (role === 'radio') return 'RADIO';
    if (role === 'listbox') return 'SELECT';

    return 'TEXT';
  });
}

// ─── OS-aware keyboard shortcuts ──────────────────────────────────────────────

/**
 * Get the OS-appropriate Find-in-Page keyboard shortcut.
 * @returns {{ key: string, modifiers: string[] }}
 */
export function getFindInPageShortcut() {
  // Detect platform from environment
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: Cmd+F
    return { key: 'f', modifiers: ['Meta'] };
  } else {
    // Windows/Linux: Ctrl+F
    return { key: 'f', modifiers: ['Control'] };
  }
}

/**
 * Trigger Find-in-Page on the page.
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
export async function triggerFindInPage(page) {
  const shortcut = getFindInPageShortcut();
  const modifiers = shortcut.modifiers.map(m => m.toLowerCase());

  // Use Playwright's keyboard API to press the shortcut
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }
  await page.keyboard.press(shortcut.key);
  for (const modifier of [...modifiers].reverse()) {
    await page.keyboard.up(modifier);
  }

  await page.waitForTimeout(300);
}

/**
 * Close Find-in-Page bar.
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
export async function closeFindInPage(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// ─── Fallback strategy helpers ────────────────────────────────────────────────

/**
 * Try CSS selector strategy.
 * @param {import('playwright').Page} page
 * @param {string} cssSelector
 * @param {number} disambiguationIndex
 * @returns {Promise<{element: import('playwright').ElementHandle, strategy: string} | null>}
 */
async function tryCssStrategy(page, cssSelector, disambiguationIndex) {
  try {
    const candidates = page.locator(cssSelector);
    const count = await candidates.count();
    if (count === 0) return null;

    const selected = await candidates.nth(disambiguationIndex).elementHandle();
    if (!selected) return null;

    await selected.waitForElementState('visible', { timeout: 2000 });
    return { element: selected, strategy: 'css' };
  } catch {
    return null;
  }
}

/**
 * Try aria-label strategy.
 * @param {import('playwright').Page} page
 * @param {string} labelText
 * @param {number} disambiguationIndex
 * @returns {Promise<{element: import('playwright').ElementHandle, strategy: string} | null>}
 */
async function tryAriaLabelStrategy(page, labelText, disambiguationIndex) {
  try {
    const selector = `[aria-label*="${escapeCssString(labelText)}" i]`;
    const candidates = page.locator(selector);
    const count = await candidates.count();
    if (count === 0) return null;

    const selected = await candidates.nth(disambiguationIndex).elementHandle();
    if (!selected) return null;

    await selected.waitForElementState('visible', { timeout: 2000 });
    return { element: selected, strategy: 'aria-label' };
  } catch {
    return null;
  }
}

/**
 * Try label[for] strategy.
 * @param {import('playwright').Page} page
 * @param {string} labelText
 * @param {number} disambiguationIndex
 * @returns {Promise<{element: import('playwright').ElementHandle, strategy: string} | null>}
 */
async function tryLabelForStrategy(page, labelText, disambiguationIndex) {
  try {
    const candidates = page.getByLabel(labelText, { exact: false });
    const count = await candidates.count();
    if (count === 0) return null;

    const selected = await candidates.nth(disambiguationIndex).elementHandle();
    if (!selected) return null;

    await selected.waitForElementState('visible', { timeout: 2000 });
    return { element: selected, strategy: 'label-for' };
  } catch {
    return null;
  }
}

/**
 * Try role + name strategy.
 * @param {import('playwright').Page} page
 * @param {string} labelText
 * @param {number} disambiguationIndex
 * @returns {Promise<{element: import('playwright').ElementHandle, strategy: string} | null>}
 */
async function tryRoleStrategy(page, labelText, disambiguationIndex) {
  const roles = ['checkbox', 'switch', 'radio', 'spinbutton', 'combobox', 'textbox', 'button'];

  for (const role of roles) {
    try {
      const candidates = page.getByRole(role, { name: labelText, exact: false });
      const count = await candidates.count();
      if (count === 0) continue;

      const selected = await candidates.nth(disambiguationIndex).elementHandle();
      if (!selected) continue;

      await selected.waitForElementState('visible', { timeout: 2000 });
      return { element: selected, strategy: `role-${role}` };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Escape CSS string for safe use in selectors.
 * @param {string} value
 * @returns {string}
 */
function escapeCssString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ─── Main locator function ────────────────────────────────────────────────────

/**
 * @typedef {Object} LocatorResult
 * @property {import('playwright').ElementHandle} element
 * @property {string} fieldType - NUMBER|TEXT|SELECT|COMBOBOX|TOGGLE|RADIO
 * @property {string} strategy - 'find-in-page' | 'direct-query'
 * @property {number} matchTop - Vertical position of the match
 */

/**
 * Find the DOM element for a dimension using Find-in-Page + CDP proximity search.
 *
 * @param {import('playwright').Page} page
 * @param {string} dimensionKey - The dimension label to search for
 * @param {object} [opts]
 * @param {number} [opts.bandPx=150] - Vertical band size for proximity search
 * @param {number} [opts.maxRetries=2] - Number of retry attempts
 * @param {object} [opts.context] - Run context for artifact paths
 * @param {string} [opts.context.runId]
 * @param {string} [opts.context.screenshotsDir]
 * @param {string} [opts.context.groupName]
 * @param {string} [opts.context.serviceName]
 * @param {boolean} [opts.required=true]
 * @returns {Promise<LocatorResult & { status: 'success'|'failed'|'skipped' }>}
 */
export async function findElement(page, dimensionKey, opts = {}) {
  const { bandPx = 150, maxRetries = 2, context = {}, required = true } = opts;

  logEvent('INFO', 'EVT-FND-01', { label: dimensionKey, step: 'locating' });

  // Helper for capturing screenshots on failure
  const captureFail = async () => {
    if (context.runId && context.screenshotsDir && context.groupName && context.serviceName) {
      const screenshotPath = buildScreenshotPath(
        context.screenshotsDir,
        context.runId,
        context.groupName,
        context.serviceName,
        `locator_fail_${dimensionKey}`
      );
      try {
        await page.screenshot({ path: screenshotPath });
        logEvent('INFO', 'EVT-SCR-01', { path: screenshotPath });
        return screenshotPath;
      } catch (err) {
        logEvent('ERROR', 'EVT-SCR-02', { error: err.message });
      }
    }
    return null;
  };

  try {
    const result = await withRetry(
      async () => {
        // Step 1: Scroll to top for consistent starting point
        await scrollToPosition(page, 0);
        await page.waitForTimeout(200);

        // Step 2: Open Find-in-Page
        await triggerFindInPage(page);

        // Step 3: Type the dimension key
        await page.keyboard.type(dimensionKey, { delay: 50 });
        await page.waitForTimeout(400);

        // Step 4: Get bounding rect of the selection
        const rect = await getSelectionBoundingRect(page);
        if (!rect) {
          throw new LocatorNotFoundError(dimensionKey, 'find-in-page');
        }

        // Step 5: Close Find bar
        await closeFindInPage(page);

        // Step 6: Query controls in the vertical band
        const controls = await queryControlsInBand(page, rect.top, bandPx);

        if (controls.length === 0) {
          throw new LocatorNotFoundError(dimensionKey, 'find-in-page');
        }

        // Step 7: Get the nearest control
        const nearestControl = controls[0];

        // Build selector and find element
        let element;
        if (nearestControl.selector.includes('#')) {
          element = await page.$(nearestControl.selector);
        } else {
          // Fallback: find by position
          const allControls = await page.$$('input, select, textarea, [role="combobox"], [role="spinbutton"], [role="switch"], [role="radio"]');
          for (const ctrl of allControls) {
            const box = await ctrl.boundingBox();
            if (box && Math.abs(box.y - nearestControl.top) < 20) {
              element = ctrl;
              break;
            }
          }
        }

        if (!element) {
          throw new LocatorNotFoundError(dimensionKey, 'find-in-page');
        }

        // Step 8: Get field type
        const fieldType = await getFieldType(element);

        return {
          element,
          fieldType,
          strategy: 'find-in-page',
          matchTop: rect.top,
          status: 'success'
        };
      },
      {
        stepName: `find-element-${dimensionKey}`,
        maxRetries,
        delayMs: 1500,
      }
    );

    return result;
  } catch (error) {
    const screenshotPath = await captureFail();
    const status = required ? 'failed' : 'skipped';
    
    if (error instanceof LocatorNotFoundError) {
      logEvent('WARNING', 'EVT-FND-02', { label: dimensionKey, error: 'not_found', status });
    } else {
      logEvent('ERROR', 'EVT-FND-02', { label: dimensionKey, error: error.message, status });
    }

    return {
      element: null,
      fieldType: 'TEXT',
      strategy: 'find-in-page',
      matchTop: 0,
      status,
      screenshotPath
    };
  }
}

/**
 * Find element with fallback strategies.
 *
 * Tries Find-in-Page first, then falls back to direct DOM queries.
 * Matches Python's tiered approach:
 * 1. CSS selector (if provided in dimension)
 * 2. aria-label
 * 3. label[for]
 * 4. role + name
 * 5. Visible text
 * 6. Find-in-Page (last resort)
 *
 * @param {import('playwright').Page} page
 * @param {string} dimensionKey
 * @param {object} [opts]
 * @param {string} [opts.cssSelector] - Optional CSS selector from catalog
 * @returns {Promise<LocatorResult>}
 */
export async function findElementWithFallback(page, dimensionKey, opts = {}) {
  const { required = true, cssSelector = null } = opts;
  const disambiguationIndex = 0;

  logEvent('INFO', 'EVT-FND-01', { label: dimensionKey, step: 'locating_with_fallbacks' });

  // Tier 1: CSS selector (if provided)
  if (cssSelector) {
    try {
      const cssResult = await tryCssStrategy(page, cssSelector, disambiguationIndex);
      if (cssResult) {
        const fieldType = await getFieldType(cssResult.element);
        logEvent('INFO', 'EVT-FND-01', { label: dimensionKey, strategy: 'css' });
        return {
          element: cssResult.element,
          fieldType,
          strategy: 'css',
          matchTop: 0,
          status: 'success'
        };
      }
    } catch {
      // Continue to next tier
    }
  }

  // Tier 2: aria-label
  try {
    const ariaResult = await tryAriaLabelStrategy(page, dimensionKey, disambiguationIndex);
    if (ariaResult) {
      const fieldType = await getFieldType(ariaResult.element);
      logEvent('INFO', 'EVT-FND-01', { label: dimensionKey, strategy: 'aria-label' });
      return {
        element: ariaResult.element,
        fieldType,
        strategy: 'aria-label',
        matchTop: 0,
        status: 'success'
      };
    }
  } catch {
    // Continue to next tier
  }

  // Tier 3: label[for]
  try {
    const labelResult = await tryLabelForStrategy(page, dimensionKey, disambiguationIndex);
    if (labelResult) {
      const fieldType = await getFieldType(labelResult.element);
      logEvent('INFO', 'EVT-FND-01', { label: dimensionKey, strategy: 'label-for' });
      return {
        element: labelResult.element,
        fieldType,
        strategy: 'label-for',
        matchTop: 0,
        status: 'success'
      };
    }
  } catch {
    // Continue to next tier
  }

  // Tier 4: role + name
  try {
    const roleResult = await tryRoleStrategy(page, dimensionKey, disambiguationIndex);
    if (roleResult) {
      const fieldType = await getFieldType(roleResult.element);
      logEvent('INFO', 'EVT-FND-01', { label: dimensionKey, strategy: 'role' });
      return {
        element: roleResult.element,
        fieldType,
        strategy: 'role',
        matchTop: 0,
        status: 'success'
      };
    }
  } catch {
    // Continue to next tier
  }

  // Tier 5: Visible text (Find-in-Page)
  const findResult = await findElement(page, dimensionKey, opts);
  if (findResult.status === 'success') {
    logEvent('INFO', 'EVT-FND-01', { label: dimensionKey, strategy: 'find-in-page' });
    return findResult;
  }

  // All strategies failed
  logEvent('ERROR', 'EVT-FND-02', { label: dimensionKey, error: 'all_strategies_failed' });
  return {
    element: null,
    fieldType: 'TEXT',
    strategy: 'direct-query',
    matchTop: 0,
    status: required ? 'failed' : 'skipped'
  };
}

/**
 * Scroll element into view if needed.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} element
 * @returns {Promise<void>}
 */
export async function scrollElementIntoView(page, element) {
  await element.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}

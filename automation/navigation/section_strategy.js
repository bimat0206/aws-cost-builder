/**
 * Section expansion strategy — discovers and expands collapsible sections.
 *
 * Matches Python's section_strategy_hints.py logic:
 * - Maintains per-service section expansion hints
 * - Tracks which triggers expand which sections
 * - Supports multiple expansion strategies:
 *   * accordion_button
 *   * text_click
 *   * catalog_trigger
 * - Caches successful strategies for reuse
 *
 * @module automation/section_strategy
 */

import { withRetry } from '../../core/retry/retry_wrapper.js';
import { logEvent as sharedLogEvent } from '../../core/logger/logger.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const MODULE = 'automation/section_strategy';

/**
 * Format and print a structured log line.
 * @param {string} level
 * @param {string} eventType
 * @param {Object} fields
 */
function logEvent(level, eventType, fields = {}) {
  sharedLogEvent(level, MODULE, eventType, fields);
}

// ─── Strategy types ───────────────────────────────────────────────────────────

/**
 * @typedef {'accordion_button' | 'text_click' | 'catalog_trigger' | 'unknown'} ExpansionStrategy
 */

/**
 * @typedef {Object} SectionExpansionHint
 * @property {string} sectionLabel
 * @property {ExpansionStrategy} strategy
 * @property {string} [triggerSelector]
 * @property {boolean} expanded
 */

// ─── Strategy hint store ──────────────────────────────────────────────────────

/**
 * Maintains per-service section expansion hints.
 * Matches Python's SectionStrategyHintStore.
 */
export class SectionStrategyHintStore {
  /**
   * @param {string} serviceName
   */
  constructor(serviceName) {
    this.serviceName = serviceName;
    /** @type {Map<string, SectionExpansionHint>} */
    this.hints = new Map();
    /** @type {Set<string>} */
    this.expandedSections = new Set();
  }

  /**
   * Record a successful expansion strategy.
   * @param {string} sectionLabel
   * @param {ExpansionStrategy} strategy
   * @param {string} [triggerSelector]
   */
  recordSuccess(sectionLabel, strategy, triggerSelector) {
    this.hints.set(sectionLabel, {
      sectionLabel,
      strategy,
      triggerSelector: triggerSelector || null,
      expanded: true,
    });
    this.expandedSections.add(sectionLabel);
    logEvent('INFO', 'EVT-SEC-01', {
      section: sectionLabel,
      strategy,
      status: 'recorded',
    });
  }

  /**
   * Check if a section is already expanded.
   * @param {string} sectionLabel
   * @returns {boolean}
   */
  isExpanded(sectionLabel) {
    return this.expandedSections.has(sectionLabel);
  }

  /**
   * Get hint for a section.
   * @param {string} sectionLabel
   * @returns {SectionExpansionHint | null}
   */
  getHint(sectionLabel) {
    return this.hints.get(sectionLabel) || null;
  }

  /**
   * Mark section as expanded.
   * @param {string} sectionLabel
   */
  markExpanded(sectionLabel) {
    this.expandedSections.add(sectionLabel);
  }

  /**
   * Get all hints.
   * @returns {SectionExpansionHint[]}
   */
  getAllHints() {
    return Array.from(this.hints.values());
  }

  /**
   * Get expanded sections count.
   * @returns {number}
   */
  getExpandedCount() {
    return this.expandedSections.size;
  }
}

// ─── Section expansion ────────────────────────────────────────────────────────

/**
 * Check if a section trigger is already expanded.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} trigger
 * @returns {Promise<boolean>}
 */
async function isSectionExpanded(page, trigger) {
  try {
    const ariaExpanded = await trigger.getAttribute('aria-expanded');
    if (ariaExpanded === 'true') return true;
    if (ariaExpanded === 'false') return false;

    // Check if it's a <summary> element
    const tagName = await trigger.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'summary') {
      const details = trigger.locator('xpath=ancestor::details[1]').first();
      const openAttr = await details.getAttribute('open');
      return openAttr !== null;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Try to expand a section using accordion button strategy.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} trigger
 * @returns {Promise<boolean>}
 */
async function tryAccordionStrategy(page, trigger) {
  try {
    const wasExpanded = await isSectionExpanded(page, trigger);
    if (wasExpanded) return true;

    // Click the trigger
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click({ timeout: 2000, force: true });
    await page.waitForTimeout(500);

    // Verify expansion
    const isNowExpanded = await isSectionExpanded(page, trigger);
    return isNowExpanded;
  } catch {
    return false;
  }
}

/**
 * Try to expand a section by clicking text label.
 * @param {import('playwright').Page} page
 * @param {string} sectionLabel
 * @returns {Promise<boolean>}
 */
async function tryTextClickStrategy(page, sectionLabel) {
  try {
    const heading = page.getByText(sectionLabel, { exact: true }).first();
    const isVisible = await heading.isVisible().catch(() => false);
    if (!isVisible) return false;

    await heading.click({ timeout: 2000 });
    await page.waitForTimeout(500);

    return true;
  } catch {
    return false;
  }
}

/**
 * Expand all collapsible sections on the page.
 * Matches Python's expand_all_sections logic.
 *
 * @param {import('playwright').Page} page
 * @param {SectionStrategyHintStore} hintStore
 * @param {{ catalogTriggers?: Array<{label: string, trigger: string, required?: boolean}> }} [opts]
 * @returns {Promise<{ expanded: number, sections: string[] }>}
 */
export async function expandAllSections(page, hintStore, opts = {}) {
  const { catalogTriggers = [] } = opts;
  const expanded = [];
  const failed = [];

  logEvent('INFO', 'EVT-SEC-02', {
    step: 'starting',
    catalog_triggers: catalogTriggers.length,
  });

  // Phase 1: Apply catalog triggers first (if provided)
  for (const catalogTrigger of catalogTriggers) {
    const { label, trigger: strategy, required } = catalogTrigger;

    if (hintStore.isExpanded(label)) {
      continue;
    }

    let success = false;

    if (strategy === 'accordion_button') {
      const triggerLocator = page
        .locator(`button[aria-label="${label}"], [role="button"][aria-label="${label}"]`)
        .first();
      success = await tryAccordionStrategy(page, triggerLocator);
    } else if (strategy === 'text_click') {
      success = await tryTextClickStrategy(page, label);
    }

    if (success) {
      hintStore.recordSuccess(label, strategy);
      expanded.push(label);
    } else if (required) {
      logEvent('ERROR', 'EVT-SEC-03', {
        section: label,
        strategy,
        error: 'Required catalog trigger failed',
      });
      failed.push(label);
    }
  }

  // Phase 2: Discover and expand via aria-expanded triggers
  const triggers = page.locator(
    "button[aria-expanded], [role='button'][aria-expanded], summary"
  );
  const count = await triggers.count().catch(() => 0);

  for (let i = 0; i < Math.min(count, 50); i++) {
    const trigger = triggers.nth(i);
    const isVisible = await trigger.isVisible().catch(() => false);
    if (!isVisible) continue;

    // Get section label
    const sectionLabel = await trigger
      .textContent()
      .catch(() => '')
      .then((t) => (t || '').replace(/\s+/g, ' ').trim());

    if (!sectionLabel || hintStore.isExpanded(sectionLabel)) {
      continue;
    }

    // Try accordion strategy
    const success = await withRetry(
      async () => {
        const result = await tryAccordionStrategy(page, trigger);
        if (!result) {
          throw new Error(`Failed to expand ${sectionLabel}`);
        }
        return result;
      },
      { stepName: `expand-section-${sectionLabel}`, maxRetries: 2, required: false }
    );

    if (success) {
      hintStore.recordSuccess(sectionLabel, 'accordion_button');
      expanded.push(sectionLabel);
      logEvent('INFO', 'EVT-SEC-01', {
        section: sectionLabel,
        strategy: 'accordion_button',
        status: 'expanded',
      });
    } else {
      failed.push(sectionLabel);
      logEvent('WARN', 'EVT-SEC-03', {
        section: sectionLabel,
        error: 'Could not expand section',
      });
    }
  }

  logEvent('INFO', 'EVT-SEC-02', {
    step: 'complete',
    expanded: expanded.length,
    failed: failed.length,
  });

  return { expanded, sections: expanded };
}

/**
 * Expand a single section by label.
 *
 * @param {import('playwright').Page} page
 * @param {SectionStrategyHintStore} hintStore
 * @param {string} sectionLabel
 * @returns {Promise<boolean>}
 */
export async function expandSection(page, hintStore, sectionLabel) {
  // Check if already expanded
  if (hintStore.isExpanded(sectionLabel)) {
    return true;
  }

  // Check if we have a cached strategy
  const hint = hintStore.getHint(sectionLabel);
  if (hint) {
    try {
      if (hint.strategy === 'accordion_button' && hint.triggerSelector) {
        const trigger = page.locator(hint.triggerSelector).first();
        const success = await tryAccordionStrategy(page, trigger);
        if (success) {
          hintStore.markExpanded(sectionLabel);
          return true;
        }
      } else if (hint.strategy === 'text_click') {
        const success = await tryTextClickStrategy(page, sectionLabel);
        if (success) {
          hintStore.markExpanded(sectionLabel);
          return true;
        }
      }
    } catch {
      // Strategy failed, will try alternatives
    }
  }

  // Try to find the section trigger
  const triggers = page.locator(
    "button[aria-expanded], [role='button'][aria-expanded], summary"
  );
  const count = await triggers.count().catch(() => 0);

  for (let i = 0; i < Math.min(count, 50); i++) {
    const trigger = triggers.nth(i);
    const text = await trigger.textContent().catch(() => '');
    const normalizedText = (text || '').replace(/\s+/g, ' ').trim();

    if (normalizedText === sectionLabel || normalizedText.includes(sectionLabel)) {
      const success = await tryAccordionStrategy(page, trigger);
      if (success) {
        hintStore.recordSuccess(sectionLabel, 'accordion_button');
        return true;
      }
    }
  }

  // Fallback: text click
  const success = await tryTextClickStrategy(page, sectionLabel);
  if (success) {
    hintStore.recordSuccess(sectionLabel, 'text_click');
    return true;
  }

  logEvent('ERROR', 'EVT-SEC-03', {
    section: sectionLabel,
    error: 'Could not find or expand section',
  });

  return false;
}

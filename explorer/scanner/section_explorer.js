/**
 * Section discovery and expansion.
 * 
 * Matches Python explorer/section_explorer.py logic:
 * - Panel header discovery (Cloudscape awsui_container/awsui_header)
 * - Static heading discovery (h2, h3, h4, [role='heading'])
 * - Expandable section discovery (accordion buttons with aria-expanded)
 * - Noise filtering
 * - Scroll-based discovery
 * 
 * @module explorer/scanner/section_explorer
 */

import { 
  SECTION_SELECTORS,
  HEADING_SELECTORS,
  EXPANDABLE_TRIGGERS,
  NOISE_LABEL_RE,
  NOISE_EXACT,
  PAGE_TITLE_RE,
} from '../constants.js';
import { normalizeText, isSectionNoise, sleep } from '../utils.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const LOG_LEVELS = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
};

/**
 * Format and print a log line.
 * @param {string} level
 * @param {string} module
 * @param {string} event
 * @param {string} message
 */
function log(level, module, event, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const levelPadded = level.padEnd(8);
  const modulePadded = module.padEnd(24);
  console.error(`${timestamp} | ${levelPadded} | ${modulePadded} | ${event} ${message}`);
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

// ─── Section discovery strategies ─────────────────────────────────────────────

/**
 * Extract panel heading text.
 * Matches Python's _extract_panel_heading.
 * 
 * @param {import('playwright').Locator} node
 * @returns {Promise<string>}
 */
async function extractPanelHeading(node) {
  try {
    const heading = node.locator("h1, h2, h3, h4, [role='heading'], [class*='awsui_heading-text']").first();
    const count = await heading.count();
    if (count > 0) {
      const isVisible = await heading.first().isVisible();
      if (isVisible) {
        const text = await heading.first().innerText();
        return normalizeText(text);
      }
    }
  } catch (error) {
    // Fallback to node text
  }

  try {
    const text = await node.innerText();
    return normalizeText(text);
  } catch (error) {
    return '';
  }
}

/**
 * Discover panel headers (Cloudscape-like).
 * Matches Python's _discover_panel_headers.
 * 
 * @param {import('playwright').Page} page
 * @param {Set<string>} seen - Set of lowercase section names already seen
 * @returns {Promise<Array<[string, string, boolean]>>} Array of [heading, strategy, hasInfo]
 */
async function discoverPanelHeaders(page, seen) {
  const results = [];
  
  try {
    const headerRoots = page.locator(
      "div[class*='awsui_container_'] > div[class*='awsui_header_'], " +
      "section[class*='awsui_container_'] > div[class*='awsui_header_'], " +
      ".awsui-container > .awsui_header, " +
      ".card-header"
    );

    const count = Math.min(await headerRoots.count(), 200);

    for (let i = 0; i < count; i++) {
      try {
        const node = headerRoots.nth(i);
        const isVisible = await node.isVisible();
        if (!isVisible) continue;

        const title = await extractPanelHeading(node);
        if (isSectionNoise(title)) continue;

        const low = title.toLowerCase();
        if (seen.has(low)) continue;

        // Check for Info link
        let hasInfo = false;
        try {
          const infoLink = node.locator(
            "a:has-text('Info'), [role='link']:has-text('Info'), [class*='info']:has-text('Info')"
          );
          const infoCount = await infoLink.count();
          if (infoCount > 0) {
            hasInfo = await infoLink.first().isVisible();
          }
        } catch (error) {
          // No info link
        }

        seen.add(low);
        const strategy = hasInfo ? 'panel_header_with_info' : 'panel_header';
        results.push([title, strategy, true]);
      } catch (error) {
        // Skip failed nodes
      }
    }
  } catch (error) {
    logError('explorer/scanner/section_explorer', 'EVT-PANEL-FAIL', `Panel discovery failed: ${error.message}`);
  }

  return results;
}

/**
 * Discover static section headings.
 * Matches Python's _discover_static_headings.
 * 
 * @param {import('playwright').Page} page
 * @param {Set<string>} seen
 * @returns {Promise<Array<[string, string, boolean]>>}
 */
async function discoverStaticHeadings(page, seen) {
  const results = [];

  try {
    const headings = page.locator(
      "h2, h3, h4, [role='heading'], " +
      "[class*='awsui_header_'] [class*='awsui_heading-text'], " +
      ".card-header h1, .card-header h2, .card-header h3, .card-header h4"
    );

    const count = Math.min(await headings.count(), 300);

    for (let i = 0; i < count; i++) {
      try {
        const node = headings.nth(i);
        const isVisible = await node.isVisible();
        if (!isVisible) continue;

        const text = await node.innerText();
        const txt = normalizeText(text);
        if (isSectionNoise(txt)) continue;

        // Check if in chrome/navigation area
        const isChrome = await node.evaluate((el) =>
          Boolean(
            el.closest(
              'header, footer, nav, [role="banner"], [role="navigation"], [class*="top-navigation"], [class*="bottom-panel"]',
            ),
          ),
        ).catch(() => false);
        if (isChrome) continue;

        const low = txt.toLowerCase();
        if (seen.has(low)) continue;

        seen.add(low);
        results.push([txt, 'heading_static', true]);
      } catch (error) {
        // Skip failed nodes
      }
    }
  } catch (error) {
    logError('explorer/scanner/section_explorer', 'EVT-HEADING-FAIL', `Heading discovery failed: ${error.message}`);
  }

  return results;
}

/**
 * Discover and expand accordion sections.
 * Matches Python's _discover_expandable_sections.
 * 
 * @param {import('playwright').Page} page
 * @param {Set<string>} seen
 * @returns {Promise<Array<[string, string, boolean]>>}
 */
async function discoverExpandableSections(page, seen) {
  const results = [];

  try {
    const triggers = page.locator(
      "button[aria-expanded][aria-controls], " +
      "[role='button'][aria-expanded][aria-controls], " +
      "summary"
    );

    const count = Math.min(await triggers.count(), 200);

    for (let i = 0; i < count; i++) {
      try {
        const trigger = triggers.nth(i);
        const isVisible = await trigger.isVisible();
        if (!isVisible) continue;

        const textContent = await trigger.innerText();
        const ariaLabel = await trigger.getAttribute('aria-label');
        const heading = normalizeText(textContent) || normalizeText(ariaLabel || '');
        
        if (isSectionNoise(heading)) continue;

        const low = heading.toLowerCase();
        if (seen.has(low)) continue;
        seen.add(low);

        // Try to expand
        let success = true;
        const strategy = 'accordion_button';
        
        const expanded = await trigger.getAttribute('aria-expanded');
        if (expanded === 'false') {
          try {
            await trigger.click({ timeout: 1500 });
            await sleep(350);
            const expandedAfter = await trigger.getAttribute('aria-expanded');
            success = expandedAfter === 'true';
          } catch (error) {
            success = false;
            logError('explorer/scanner/section_explorer', 'EVT-EXPAND-FAIL', `Failed to expand: ${error.message}`);
          }
        }

        results.push([heading, strategy, success]);
      } catch (error) {
        // Skip failed triggers
      }
    }
  } catch (error) {
    logError('explorer/scanner/section_explorer', 'EVT-ACCORDION-FAIL', `Accordion discovery failed: ${error.message}`);
  }

  return results;
}

// ─── Main discovery function ──────────────────────────────────────────────────

/**
 * Discover and expand sections, recording results.
 * Matches Python's discover_and_expand_sections.
 * 
 * Returns array of tuples: [heading, strategy_used, success]
 * 
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<[string, string, boolean]>>}
 */
export async function discoverAndExpandSections(page) {
  logInfo('explorer/scanner/section_explorer', 'EVT-DISCOVER-01', 'Starting section discovery...');

  const results = [];
  const seen = new Set();

  // Track and restore scroll context
  let scrollState = { top: 0, max: 0 };
  try {
    const raw = await page.evaluate(() => {
      function pickScrollRoot() {
        const doc = document.scrollingElement || document.documentElement;
        const nodes = Array.from(document.querySelectorAll('body, main, section, div, article'));
        let best = doc;
        let bestRange = (doc.scrollHeight || 0) - (doc.clientHeight || 0);
        for (const el of nodes) {
          const cs = window.getComputedStyle(el);
          if (!/(auto|scroll)/.test(cs.overflowY || '')) continue;
          const range = (el.scrollHeight || 0) - (el.clientHeight || 0);
          if (range > bestRange + 24 && (el.clientHeight || 0) > 240) {
            best = el;
            bestRange = range;
          }
        }
        return best;
      }
      const root = pickScrollRoot();
      window.__awsCostScrollRoot = root;
      return {
        top: root ? (root.scrollTop || 0) : 0,
        max: root ? Math.max(0, (root.scrollHeight || 0) - (root.clientHeight || 0)) : 0,
      };
    });
    if (raw && typeof raw === 'object') {
      scrollState = raw;
    }
  } catch {
    // Keep default scrollState
  }

  try {
    // Start from top and sweep down
    await page.evaluate(() => {
      const root =
        window.__awsCostScrollRoot ||
        document.scrollingElement ||
        document.documentElement;
      if (root) root.scrollTop = 0;
    }).catch(() => {});
    await sleep(200);

    // Scroll loop (max 48 iterations)
    for (let iteration = 0; iteration < 48; iteration++) {
      // Discover at current scroll position
      const panelHeaders = await discoverPanelHeaders(page, seen);
      const staticHeadings = await discoverStaticHeadings(page, seen);
      const expandableSections = await discoverExpandableSections(page, seen);

      results.push(...panelHeaders, ...staticHeadings, ...expandableSections);

      // Scroll down — guard against null/undefined if page is in a transitional state
      let stepInfo = { moved: false, at_bottom: true };
      try {
        const raw = await page.evaluate(() => {
          const root =
            window.__awsCostScrollRoot ||
            document.scrollingElement ||
            document.documentElement;
          if (!root) return { moved: false, at_bottom: true };
          const max = Math.max(0, (root.scrollHeight || 0) - (root.clientHeight || 0));
          const before = root.scrollTop || 0;

          if (before >= max - 2) {
            return { moved: false, at_bottom: true };
          }

          const step = Math.max(280, Math.floor((root.clientHeight || 800) * 0.82));
          root.scrollTop = Math.min(max, before + step);
          const after = root.scrollTop || 0;

          return { moved: after > before + 1, at_bottom: after >= max - 2 };
        });
        if (raw && typeof raw === 'object') {
          stepInfo = raw;
        }
      } catch {
        // Page may be navigating; treat as bottom reached
      }

      await sleep(180);

      if (!stepInfo.moved || stepInfo.at_bottom) {
        // Final capture at end-of-page
        const finalPanels = await discoverPanelHeaders(page, seen);
        const finalHeadings = await discoverStaticHeadings(page, seen);
        const finalExpandable = await discoverExpandableSections(page, seen);
        results.push(...finalPanels, ...finalHeadings, ...finalExpandable);
        break;
      }
    }
  } finally {
    // Restore scroll position
    try {
      const savedTop = Number((scrollState && scrollState.top) || 0);
      await page.evaluate((top) => {
        const root =
          window.__awsCostScrollRoot ||
          document.scrollingElement ||
          document.documentElement;
        if (root) root.scrollTop = Math.max(0, top);
      }, savedTop);
      await sleep(120);
    } catch {
      // Ignore scroll restore errors
    }
  }

  logInfo('explorer/scanner/section_explorer', 'EVT-DISCOVER-02', `Discovered ${results.length} sections`);
  return results;
}

/**
 * Get section count on page.
 * 
 * @param {import('playwright').Page} page
 * @returns {Promise<number>}
 */
export async function getSectionCount(page) {
  try {
    const count = await page.evaluate(() => {
      const sections = document.querySelectorAll(
        'section, .section, [data-section], fieldset, .accordion-item',
      );
      return sections.length;
    });
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

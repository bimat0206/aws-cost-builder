/**
 * Group/service/region navigation orchestrator.
 *
 * Matches Python's automation/navigator.py logic:
 * - Uses text-based locators (getByRole, getByText, getByLabel)
 * - Implements recovery paths for SPA navigation issues
 * - Proper retry logic with screenshots on failure
 *
 * @module automation/navigation/navigator
 */

import { ensureGroup } from './group_manager.js';
import { expandAllSections, SectionStrategyHintStore } from './section_strategy.js';
import { withRetry } from '../../core/retry/retry_wrapper.js';
import { buildScreenshotPath } from '../../core/emitter/screenshot_manager.js';
import { logEvent as sharedLogEvent } from '../../core/index.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const MODULE = 'automation/navigation/navigator';

/**
 * Format and print a structured log line.
 * @param {string} level
 * @param {string} eventType
 * @param {Object} fields
 */
function logEvent(level, eventType, fields = {}) {
  sharedLogEvent(level, MODULE, eventType, fields);
}

// ─── Service search ───────────────────────────────────────────────────────────

/**
 * Build service search terms from catalog entry.
 * Matches Python's build_service_search_terms.
 * @param {object} catalogEntry
 * @returns {string[]}
 */
export function buildServiceSearchTerms(catalogEntry) {
  const terms = new Set();

  // Add explicit search terms from catalog
  if (catalogEntry?.search_term) {
    terms.add(catalogEntry.search_term);
  }
  if (catalogEntry?.service_name) {
    terms.add(catalogEntry.service_name);
  }
  if (catalogEntry?.calculator_page_title) {
    terms.add(catalogEntry.calculator_page_title);
  }

  // Add search keywords
  if (Array.isArray(catalogEntry?.search_keywords)) {
    for (const keyword of catalogEntry.search_keywords) {
      terms.add(keyword);
    }
  }

  // Add database-related fallbacks if service looks like a database
  const allText = Array.from(terms).join(' ').toLowerCase();
  const dbKeywords = ['rds', 'aurora', 'database', 'mysql', 'postgresql', 'oracle', 'dynamodb'];
  if (dbKeywords.some(kw => allText.includes(kw))) {
    terms.add('RDS');
    terms.add('Database');
  }

  return Array.from(terms);
}

/**
 * Click the "Add service" button to open the search panel.
 * Matches Python's click_add_service().
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
async function clickAddService(page) {
  logEvent('INFO', 'EVT-SVC-01', { step: 'clicking_add_service' });

  try {
    // Use text-based search like Python's find_button()
    const button = page.getByRole('button', { name: /Add service/i }).first();
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    logEvent('INFO', 'EVT-SVC-01', { step: 'panel_opened' });
  } catch (error) {
    logEvent('ERROR', 'EVT-SVC-01', { error: error.message });
    throw new Error(`Could not click 'Add service' button: ${error.message}`);
  }
}

/**
 * Find the service search input.
 * Matches Python's _find_search_input().
 * @param {import('playwright').Page} page
 * @param {string[]} [placeholders]
 * @param {string[]} [searchboxNames]
 * @returns {Promise<import('playwright').Locator>}
 */
async function findSearchInput(page, placeholders = [], searchboxNames = []) {
  const defaultPlaceholders = [
    'Search for a service',
    'Search services',
    'Find resources',
    'Search',
  ];

  const defaultSearchboxNames = [
    'Find Service',
    'Find resources',
  ];

  const allPlaceholders = [...placeholders, ...defaultPlaceholders];
  const allSearchboxNames = [...searchboxNames, ...defaultSearchboxNames];

  // Try placeholder-based search
  for (const placeholder of allPlaceholders) {
    try {
      const input = page.getByPlaceholder(placeholder).first();
      await input.waitFor({ state: 'visible', timeout: 1000 });
      return input;
    } catch {
      continue;
    }
  }

  // Try searchbox role-based search
  for (const name of allSearchboxNames) {
    try {
      const input = page.getByRole('searchbox', { name }).first();
      await input.waitFor({ state: 'visible', timeout: 1000 });
      return input;
    } catch {
      continue;
    }
  }

  throw new Error('Service search input not found on Add service panel');
}

/**
 * Click the best matching service result.
 * Matches Python's _click_best_matching_result().
 * @param {import('playwright').Page} page
 * @param {string[]} expectedTitles
 * @param {string} activeTerm
 * @returns {Promise<boolean>}
 */
async function clickBestMatchingResult(page, expectedTitles, activeTerm) {
  // Try to find service cards using text search
  const cards = page.getByRole('listitem').filter({ hasText: /Configure/i });

  try {
    const count = await cards.count();
    if (count === 0) return false;
  } catch {
    return false;
  }

  // Priority 1: Match expected titles
  for (const title of expectedTitles) {
    try {
      const card = cards.filter({ hasText: title }).first();
      await card.waitFor({ state: 'visible', timeout: 1500 });
      await card.click();
      logEvent('INFO', 'EVT-SVC-03', { service: title, step: 'selected_by_title' });
      return true;
    } catch {
      continue;
    }
  }

  // Priority 2: Match active search term
  try {
    const card = cards.filter({ hasText: activeTerm }).first();
    await card.waitFor({ state: 'visible', timeout: 1500 });
    await card.click();
    logEvent('INFO', 'EVT-SVC-03', { service: activeTerm, step: 'selected_by_term' });
    return true;
  } catch {
    // Continue to fallback
  }

  // Priority 3: First result fallback
  try {
    const firstCard = cards.first();
    await firstCard.waitFor({ state: 'visible', timeout: 1500 });
    await firstCard.click();
    logEvent('INFO', 'EVT-SVC-03', { step: 'selected_first_fallback' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Search for a service and select the best match.
 * Matches Python's search_and_select_service().
 * @param {import('playwright').Page} page
 * @param {string[]} searchTerms
 * @param {string[]} expectedTitles
 * @returns {Promise<void>}
 */
async function searchAndSelectService(page, searchTerms, expectedTitles) {
  const terms = searchTerms.filter(t => t && t.trim());

  if (terms.length === 0) {
    throw new Error('No search terms available for service lookup');
  }

  // Find search input
  const searchInput = await findSearchInput(page);

  // Try each search term
  for (const term of terms) {
    searchInput.fill(term);
    await page.waitForTimeout(900); // Allow filtered results to render

    if (await clickBestMatchingResult(page, expectedTitles, term)) {
      return;
    }
  }

  throw new Error(`No search results for keywords: ${terms.join(', ')}`);
}

/**
 * Click the "Configure" button to open the service form.
 * Matches Python's click_configure().
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
export async function clickConfigure(page) {
  logEvent('INFO', 'EVT-SVC-03', { step: 'clicking_configure' });
  try {
    const configureButton = page.getByRole('button', { name: /Configure/i }).first();
    await configureButton.waitFor({ state: 'visible', timeout: 5000 });
    await configureButton.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    logEvent('INFO', 'EVT-SVC-03', { step: 'configure_clicked' });
    
    // Gap 9: EC2 specific workload quick-start modal evasion
    await handleOptionalWorkloadsModal(page);
  } catch (error) {
    logEvent('ERROR', 'EVT-SVC-03', { error: 'Could not click Configure button' });
    throw new Error(`Could not click Configure button: ${error.message}`);
  }
}

/**
 * Handle optional Quick Start Workloads modal (e.g., EC2).
 * Matches Python's skip_workloads() logic.
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
async function handleOptionalWorkloadsModal(page) {
  try {
    // If a modal pops up asking to "Choose a workload", find the Skip button
    const skipButton = page.getByRole('button', { name: /Skip/i }).first();
    // Short timeout because it usually doesn't appear for most services
    await skipButton.waitFor({ state: 'visible', timeout: 2000 });
    await skipButton.click();
    await page.waitForTimeout(500); // Allow modal to fade
    logEvent('INFO', 'EVT-SVC-03', { step: 'workload_skipped' });
  } catch {
    // Modal did not appear, safe to ignore
  }
}

/**
 * Click the "Save and add service" button after filling dimensions.
 * Matches Python's click_save().
 * @param {import('playwright').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
export async function clickSave(page, label = 'Save and add service') {
  logEvent('INFO', 'EVT-SVC-04', { step: 'clicking_save' });
  try {
    const saveButton = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    await saveButton.waitFor({ state: 'visible', timeout: 5000 });
    await saveButton.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    logEvent('INFO', 'EVT-SVC-04', { step: 'save_clicked' });
  } catch (error) {
    logEvent('ERROR', 'EVT-SVC-04', { error: `Could not click '${label}' button` });
    throw new Error(`Could not click '${label}' button: ${error.message}`);
  }
}

// ─── Region selection ─────────────────────────────────────────────────────────

/**
 * Select calculator region before searching for services.
 * Matches Python's select_region().
 * @param {import('playwright').Page} page
 * @param {string} regionCode
 * @param {object} [catalogEntry]
 * @returns {Promise<void>}
 */
async function selectRegion(page, regionCode, catalogEntry = null) {
  // Skip if global
  if (!regionCode || regionCode.toLowerCase() === 'global') {
    logEvent('INFO', 'EVT-REG-01', { region: 'global', status: 'skipping' });
    return;
  }

  logEvent('INFO', 'EVT-REG-01', { region: regionCode, status: 'selecting' });

  try {
    const locLabel = catalogEntry?.ui_mapping?.location_type_label || 'Choose a location type';
    const regLabel = catalogEntry?.ui_mapping?.region_picker_label || 'Choose a Region';

    // Step 1: Ensure location type is set to "Region"
    const locationType = page.getByLabel(new RegExp(locLabel, 'i')).first();
    await locationType.waitFor({ state: 'visible', timeout: 8000 });

    const locationTypeText = await locationType.textContent();
    if (!locationTypeText?.toLowerCase().includes('region')) {
      await locationType.click();
      const regionOption = page.getByRole('option', { name: /Region/i }).first();
      await regionOption.waitFor({ state: 'visible', timeout: 5000 });
      await regionOption.click();
    }

    // Step 2: Select region by code (not display name)
    const regionPicker = page.getByLabel(new RegExp(regLabel, 'i')).first();
    await regionPicker.waitFor({ state: 'visible', timeout: 8000 });
    await regionPicker.click();

    // Find region option by code pattern (e.g., "us-east-1")
    const regionCodePattern = new RegExp(`\\b${regionCode}\\b`, 'i');
    const regionOption = page.getByRole('option', { name: regionCodePattern }).first();
    await regionOption.waitFor({ state: 'visible', timeout: 5000 });
    await regionOption.click();

    await page.waitForTimeout(300);
    logEvent('INFO', 'EVT-REG-01', { region: regionCode, status: 'selected' });
  } catch (error) {
    logEvent('ERROR', 'EVT-REG-02', { region: regionCode, error: error.message });
    throw new Error(`Could not select region '${regionCode}': ${error.message}`);
  }
}

// ─── Main navigation function ────────────────────────────────────────────────

/**
 * Navigate to a service within a group and region.
 *
 * Orchestrates:
 * 1. Group creation/selection (via ensureGroup)
 * 2. Click "Add service" button
 * 3. Select region (skip if "global") - BEFORE search
 * 4. Search for service by search terms
 * 5. Select service from results
 *
 * All steps are wrapped in retry logic for resilience.
 * Matches Python's navigate_to_service().
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {string} opts.groupName - Name of the group
 * @param {string} opts.serviceName - Display name of the service
 * @param {string[]} opts.searchTerms - Search terms to find the service
 * @param {string} opts.region - Region code or "global"
 * @param {object} [opts.context] - Run context for artifact paths
 * @param {string} [opts.context.runId]
 * @param {string} [opts.context.screenshotsDir]
 * @returns {Promise<void>}
 * @throws {Error} If navigation fails after retries
 */
export async function navigateToService(page, opts) {
  const { groupName, serviceName, searchTerms, region, context = {} } = opts;

  logEvent('INFO', 'EVT-NAV-01', {
    service: serviceName,
    group: groupName,
    region,
    status: 'starting'
  });

  // Helper for capturing screenshots on failure
  const captureFail = async (step) => {
    if (context.runId && context.screenshotsDir && context.groupName && context.serviceName) {
      const screenshotPath = buildScreenshotPath(
        context.screenshotsDir,
        context.runId,
        groupName,
        serviceName,
        step
      );
      try {
        await page.screenshot({ path: screenshotPath });
        logEvent('INFO', 'EVT-SCR-01', { path: screenshotPath });
      } catch (err) {
        logEvent('ERROR', 'EVT-SCR-02', { error: err.message });
      }
    }
  };

  try {
    // Step 1: Ensure group exists/is selected
    await withRetry(
      async () => {
        await ensureGroup(page, groupName);
      },
      {
        stepName: 'group-creation',
        maxRetries: 2,
        delayMs: 1500,
      }
    );

    // Step 2: Click "Add service" button
    await withRetry(
      async () => {
        try {
          await clickAddService(page);
        } catch (err) {
          await captureFail('open-service-panel');
          throw err;
        }
      },
      {
        stepName: 'open-service-panel',
        maxRetries: 2,
        delayMs: 1500,
      }
    );

    // Step 3: Select region (if not global) - MUST BE BEFORE SEARCH
    if (region !== 'global') {
      await withRetry(
        async () => {
          try {
            await selectRegion(page, region, opts.catalogEntry);
          } catch (err) {
            await captureFail('region-selection');
            throw err;
          }
        },
        {
          stepName: 'region-selection',
          maxRetries: 2,
          delayMs: 1500,
        }
      );
    }

    // Step 4: Search for service and select best match
    await withRetry(
      async () => {
        try {
          await searchAndSelectService(page, searchTerms, [serviceName]);
        } catch (err) {
          await captureFail('service-search');
          throw err;
        }
      },
      {
        stepName: 'service-search',
        maxRetries: 2,
        delayMs: 1500,
      }
    );

    // Step 5: Click Configure to open service dimension form
    await withRetry(
      async () => {
        try {
          await clickConfigure(page);
        } catch (err) {
          await captureFail('configure-click');
          throw err;
        }
      },
      {
        stepName: 'configure-click',
        maxRetries: 2,
        delayMs: 1500,
      }
    );

    // Step 6: Expand optional sections (EBS, Monitoring, Data Transfer)
    try {
      if (opts.catalogEntry) {
        // Expand optional sections if catalog entry provided
        const hintStore = new SectionStrategyHintStore(serviceName);
        await expandAllSections(page, hintStore, { catalogTriggers: opts.catalogEntry.section_triggers || [] });
      } else {
        // Safe fallback if catalog not available: attempt generic discovery
        const hintStore = new SectionStrategyHintStore(serviceName);
        await expandAllSections(page, hintStore);
      }
    } catch (err) {
      // Non-fatal, just log and continue
      logEvent('WARN', 'EVT-SEC-04', { error: err.message, step: 'expand-sections' });
    }

    logEvent('INFO', 'EVT-NAV-02', { service: serviceName, group: groupName, status: 'complete' });
  } catch (error) {
    logEvent('ERROR', 'EVT-NAV-02', { service: serviceName, group: groupName, error: error.message });
    throw error;
  }
}

/**
 * Get the current service name from the page.
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
export async function getCurrentService(page) {
  try {
    // Try to find service title using text search
    const selectors = [
      page.getByRole('heading', { level: 1 }).first(),
      page.getByRole('heading', { level: 2 }).first(),
      page.getByText(/Amazon|CloudFront|Lambda|S3|EC2|RDS/i).first(),
    ];

    for (const selector of selectors) {
      try {
        await selector.waitFor({ state: 'visible', timeout: 2000 });
        const text = await selector.textContent();
        if (text && text.trim()) {
          return text.trim();
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    logEvent('ERROR', 'EVT-NAV-03', { error: error.message });
    return null;
  }
}

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

import { getAutomationRuntimeConfig } from '../../config/runtime/index.js';
import { ensureGroup } from './group_manager.js';
import { expandAllSections, SectionStrategyHintStore } from './section_strategy.js';
import { withRetry } from '../../core/retry/retry_wrapper.js';
import { buildScreenshotPath } from '../../core/emitter/screenshot_manager.js';
import { createModuleLogger } from '../../core/logger/index.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const MODULE = 'automation/navigation/navigator';
const automationConfig = getAutomationRuntimeConfig();
const navigatorConfig = automationConfig.navigator;
const logger = createModuleLogger(MODULE);

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
  if (navigatorConfig.databaseKeywords.some((keyword) => allText.includes(keyword))) {
    for (const term of navigatorConfig.databaseFallbackTerms) {
      terms.add(term);
    }
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
  logger.info('add_service_click_started', { event_id: 'EVT-SVC-01', step: 'clicking_add_service' });

  try {
    // CONFIRMED from live discovery: aria-label is exactly "Add service"
    // The primary button is variant-primary (top-right). The secondary is in the estimate table.
    // Use the primary variant first.
    let button = page.locator(navigatorConfig.addService.primarySelector).first();
    try {
      await button.waitFor({ state: 'visible', timeout: navigatorConfig.addService.primaryVisibleTimeoutMs });
    } catch {
      // fallback to text-based
      button = page.getByRole('button', { name: navigatorConfig.addService.fallbackButtonLabel, exact: true }).first();
      await button.waitFor({ state: 'visible', timeout: navigatorConfig.addService.fallbackVisibleTimeoutMs });
    }
    await button.click();
    // Wait for search panel to appear (aria-label='Find Service' input)
    await page.waitForSelector(navigatorConfig.addService.panelVisibleSelector, {
      state: 'visible',
      timeout: navigatorConfig.addService.panelVisibleTimeoutMs,
    });
    logger.info('add_service_panel_opened', { event_id: 'EVT-SVC-01', step: 'panel_opened' });
  } catch (error) {
    logger.error('add_service_click_failed', { event_id: 'EVT-SVC-01', error });
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
async function findSearchInput(page) {
  // CONFIRMED from live discovery: aria-label is "Find Service", placeholder is "Search for a service"
  // Try aria-label first (most reliable)
  for (const selector of navigatorConfig.searchInput.selectors) {
    try {
      const input = page.locator(selector).first();
      await input.waitFor({ state: 'visible', timeout: navigatorConfig.searchInput.visibleTimeoutMs });
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
  // CONFIRMED from live discovery: Configure buttons have aria-label="Configure <ServiceName> "
  // (trailing space is common in Cloudscape button labels)
  // Strategy: find Configure buttons for the expected titles first
  for (const title of expectedTitles) {
    try {
      // Match by aria-label with the exact or partial service name
      const btn = page.locator(`button[aria-label*="${navigatorConfig.configure.ariaLabelPrefix} ${title}"]`).first();
      await btn.waitFor({ state: 'visible', timeout: navigatorConfig.configure.resultVisibleTimeoutMs });
      await btn.click();
      logger.info('service_result_selected', {
        event_id: 'EVT-SVC-03',
        service: title,
        active_term: activeTerm,
        expected_titles: expectedTitles,
        selection_strategy: 'aria_label',
      });
      return true;
    } catch {
      // Fall through to role-based
    }

    try {
      // Role-based with accessible name pattern
      const btn = page.getByRole('button', {
        name: new RegExp(`${navigatorConfig.configure.ariaLabelPrefix} ${title}`, 'i'),
      }).first();
      await btn.waitFor({ state: 'visible', timeout: navigatorConfig.configure.resultVisibleTimeoutMs });
      await btn.click();
      logger.info('service_result_selected', {
        event_id: 'EVT-SVC-03',
        service: title,
        active_term: activeTerm,
        expected_titles: expectedTitles,
        selection_strategy: 'role_name',
      });
      return true;
    } catch {
      continue;
    }
  }

  // Priority 2: Match by active search term
  try {
    const btn = page.locator(`button[aria-label*="${navigatorConfig.configure.ariaLabelPrefix}"]`).filter({ hasText: activeTerm }).first();
    await btn.waitFor({ state: 'visible', timeout: navigatorConfig.configure.resultVisibleTimeoutMs });
    await btn.click();
    logger.info('service_result_selected', {
      event_id: 'EVT-SVC-03',
      service: activeTerm,
      active_term: activeTerm,
      expected_titles: expectedTitles,
      selection_strategy: 'term_match',
    });
    return true;
  } catch {}

  // Priority 3: First Configure button on page
  try {
    const btn = page.locator(`button[aria-label*="${navigatorConfig.configure.ariaLabelPrefix}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: navigatorConfig.configure.resultVisibleTimeoutMs });
    await btn.click();
    logger.info('service_result_selected', {
      event_id: 'EVT-SVC-03',
      active_term: activeTerm,
      expected_titles: expectedTitles,
      selection_strategy: 'first_configure_button',
    });
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
  for (const [index, term] of terms.entries()) {
    logger.info('service_search_attempted', {
      event_id: 'EVT-SVC-02',
      active_term: term,
      term_index: index,
      term_count: terms.length,
      expected_titles: expectedTitles,
    });
    await searchInput.fill(term);
    await page.waitForTimeout(navigatorConfig.searchInput.searchSettleMs);

    if (await clickBestMatchingResult(page, expectedTitles, term)) {
      // After clicking the Configure button, handle any immediate modal (e.g., EC2 workloads)
      await page.waitForTimeout(navigatorConfig.configure.afterClickWaitMs);
      await handleOptionalWorkloadsModal(page);
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
export async function clickConfigure(page, serviceName = null) {
  logger.info('configure_click_started', {
    event_id: 'EVT-SVC-03',
    service: serviceName,
  });
  try {
    // CONFIRMED from live discovery: aria-label is "Configure <ServiceName>" or "Configure <ServiceName> " (trailing space)
    // Try the most specific selector first if we know the service name
    if (serviceName) {
      try {
        const specificBtn = page.locator(`button[aria-label*="${navigatorConfig.configure.ariaLabelPrefix} ${serviceName}"]`).first();
        await specificBtn.waitFor({ state: 'visible', timeout: navigatorConfig.configure.specificVisibleTimeoutMs });
        await specificBtn.click();
        await page.waitForTimeout(navigatorConfig.configure.afterClickWaitMs);
        logger.info('configure_click_completed', {
          event_id: 'EVT-SVC-03',
          service: serviceName,
          selection_strategy: 'specific_aria_label',
        });
        await handleOptionalWorkloadsModal(page);
        return;
      } catch {
        // fall through
      }
    }

    // Generic fallback: any visible Configure button
    const configureButton = page.getByRole('button', { name: new RegExp(navigatorConfig.configure.genericButtonPattern, 'i') })
      .filter({ hasNot: page.locator(`[aria-label*="${navigatorConfig.configure.addServiceAriaFragment}"]`) })
      .first();
    await configureButton.waitFor({ state: 'visible', timeout: navigatorConfig.configure.genericVisibleTimeoutMs });
    await configureButton.click();
    await page.waitForTimeout(navigatorConfig.configure.afterClickWaitMs);
    logger.info('configure_click_completed', {
      event_id: 'EVT-SVC-03',
      service: serviceName,
      selection_strategy: 'generic_button',
    });
    
    // Gap 9: EC2 specific workload quick-start modal evasion
    await handleOptionalWorkloadsModal(page);
  } catch (error) {
    logger.error('configure_click_failed', {
      event_id: 'EVT-SVC-03',
      service: serviceName,
      error,
    });
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
    const skipButton = page.getByRole('button', { name: new RegExp(navigatorConfig.workloadModal.skipButtonPattern, 'i') }).first();
    // Short timeout because it usually doesn't appear for most services
    await skipButton.waitFor({ state: 'visible', timeout: navigatorConfig.workloadModal.visibleTimeoutMs });
    await skipButton.click();
    await page.waitForTimeout(navigatorConfig.workloadModal.afterSkipWaitMs);
    logger.info('workload_modal_skipped', {
      event_id: 'EVT-SVC-03',
      step: 'workload_skipped',
    });
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
export async function clickSave(page, label = navigatorConfig.save.defaultLabel) {
  logger.info('save_click_started', {
    event_id: 'EVT-SVC-04',
    label,
  });
  try {
    const saveButton = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    await saveButton.waitFor({ state: 'visible', timeout: navigatorConfig.save.visibleTimeoutMs });
    await saveButton.click();
    await page.waitForLoadState(navigatorConfig.save.loadState, { timeout: navigatorConfig.save.loadStateTimeoutMs });
    logger.info('save_click_completed', {
      event_id: 'EVT-SVC-04',
      label,
    });
  } catch (error) {
    logger.error('save_click_failed', {
      event_id: 'EVT-SVC-04',
      label,
      error,
    });
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
  if (!regionCode || regionCode.toLowerCase() === navigatorConfig.region.globalValue) {
    logger.info('region_selection_skipped', {
      event_id: 'EVT-REG-01',
      region: navigatorConfig.region.globalValue,
      status: 'skipping',
    });
    return;
  }

  logger.info('region_selection_started', {
    event_id: 'EVT-REG-01',
    region: regionCode,
    status: 'selecting',
  });

  try {
    const locLabel = catalogEntry?.ui_mapping?.location_type_label || navigatorConfig.region.defaultLocationTypeLabel;
    const regLabel = catalogEntry?.ui_mapping?.region_picker_label || navigatorConfig.region.defaultRegionPickerLabel;

    // Step 1: Ensure location type is set to "Region"
    // CONFIRMED from live discovery: dropdowns use aria-labelledby pointing to a label element
    // We can locate the button whose preceding label text matches the desired label
    const locDropdown = page.locator(`button[aria-labelledby]`).filter({
      has: page.locator(`xpath=./ancestor::*[contains(@class, "awsui_form-field")]//*[contains(text(), "${locLabel}")]`)
    }).first();
    
    // Fallback to getByLabel if above fails
    const locationDropdown = await (async () => {
      try {
        await locDropdown.waitFor({ state: 'visible', timeout: navigatorConfig.region.labelVisibleTimeoutMs });
        return locDropdown;
      } catch {
        return page.getByLabel(new RegExp(locLabel, 'i')).first();
      }
    })();
    
    await locationDropdown.waitFor({ state: 'visible', timeout: navigatorConfig.region.dropdownVisibleTimeoutMs });

    const locationTypeText = await locationDropdown.textContent();
    if (!locationTypeText?.toLowerCase().includes('region')) {
      await locationDropdown.click();
      const regionOption = page.getByRole('option', {
        name: new RegExp(`^${navigatorConfig.region.regionOptionLabel}$`, 'i'),
      }).first();
      await regionOption.waitFor({ state: 'visible', timeout: navigatorConfig.region.optionVisibleTimeoutMs });
      await regionOption.click();
      await page.waitForTimeout(navigatorConfig.region.afterSelectWaitMs);
    }

    // Step 2: Select region by code (not display name)
    const regionDropdown = await (async () => {
      try {
        const d = page.locator(`button[aria-labelledby]`).filter({
          has: page.locator(`xpath=./ancestor::*[contains(@class, "awsui_form-field")]//*[contains(text(), "${regLabel}")]`)
        }).first();
        await d.waitFor({ state: 'visible', timeout: navigatorConfig.region.labelVisibleTimeoutMs });
        return d;
      } catch {
        return page.getByLabel(new RegExp(regLabel, 'i')).first();
      }
    })();
    await regionDropdown.waitFor({ state: 'visible', timeout: navigatorConfig.region.dropdownVisibleTimeoutMs });
    await regionDropdown.click();

    // Find region option by code pattern (e.g., "us-east-1")
    const regionCodePattern = new RegExp(`\\b${regionCode}\\b`, 'i');
    const regionOption = page.getByRole('option', { name: regionCodePattern }).first();
    await regionOption.waitFor({ state: 'visible', timeout: navigatorConfig.region.optionVisibleTimeoutMs });
    await regionOption.click();
    await page.waitForTimeout(navigatorConfig.region.afterSelectWaitMs);
    logger.info('region_selection_completed', {
      event_id: 'EVT-REG-01',
      region: regionCode,
      location_label: locLabel,
      region_label: regLabel,
      status: 'selected',
    });
  } catch (error) {
    logger.error('region_selection_failed', {
      event_id: 'EVT-REG-02',
      region: regionCode,
      error,
    });
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

  logger.info('service_navigation_started', {
    event_id: 'EVT-NAV-01',
    service: serviceName,
    group: groupName,
    region,
    search_terms: searchTerms,
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
        logger.info('failure_screenshot_captured', {
          event_id: 'EVT-SCR-01',
          path: screenshotPath,
          step,
          service: serviceName,
          group: groupName,
        });
      } catch (err) {
        logger.error('failure_screenshot_failed', {
          event_id: 'EVT-SCR-02',
          path: screenshotPath,
          step,
          service: serviceName,
          group: groupName,
          error: err,
        });
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
        maxRetries: navigatorConfig.retry.maxRetries,
        delayMs: navigatorConfig.retry.delayMs,
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
        maxRetries: navigatorConfig.retry.maxRetries,
        delayMs: navigatorConfig.retry.delayMs,
      }
    );

    // Step 3: Select region (if not global) - MUST BE BEFORE SEARCH
    if (region !== navigatorConfig.region.globalValue) {
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
          maxRetries: navigatorConfig.retry.maxRetries,
          delayMs: navigatorConfig.retry.delayMs,
        }
      );
    }

    // Step 4: Search for service, click Configure, and handle optional modals
    // NOTE: clickBestMatchingResult directly clicks the Configure button in the search panel,
    // which opens the service form. There is NO separate Step 5 needed.
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
        maxRetries: navigatorConfig.retry.maxRetries,
        delayMs: navigatorConfig.retry.delayMs,
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
      logger.warn('optional_section_expansion_failed', {
        event_id: 'EVT-SEC-04',
        service: serviceName,
        group: groupName,
        step: 'expand-sections',
        error: err,
      });
    }

    logger.info('service_navigation_completed', {
      event_id: 'EVT-NAV-02',
      service: serviceName,
      group: groupName,
      region,
      status: 'complete',
    });
  } catch (error) {
    logger.error('service_navigation_failed', {
      event_id: 'EVT-NAV-02',
      service: serviceName,
      group: groupName,
      region,
      error,
    });
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
      page.getByText(new RegExp(navigatorConfig.currentService.textPattern, 'i')).first(),
    ];

    for (const selector of selectors) {
      try {
        await selector.waitFor({ state: 'visible', timeout: navigatorConfig.currentService.headingVisibleTimeoutMs });
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
    logger.error('current_service_lookup_failed', {
      event_id: 'EVT-NAV-03',
      error,
    });
    return null;
  }
}

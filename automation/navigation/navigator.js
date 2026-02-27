/**
 * Group/service/region navigation orchestrator.
 *
 * Orchestrates navigation to a service within a group and region in the AWS Calculator.
 * Emits events: EVT-NAV-01/02 (navigation), EVT-SVC-01/02/03 (service), EVT-REG-01/02 (region).
 * Wraps steps in retry_wrapper for resilience.
 *
 * @module automation/navigation/navigator
 */

import { ensureGroup } from './group_manager.js';
import { withRetry } from '../../core/retry/retry_wrapper.js';
import { buildScreenshotPath } from '../../core/emitter/screenshot_manager.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

const MODULE = 'automation/navigation/navigator';

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
  if (catalogEntry.search_term) {
    terms.add(catalogEntry.search_term);
  }
  if (catalogEntry.service_name) {
    terms.add(catalogEntry.service_name);
  }
  if (catalogEntry.calculator_page_title) {
    terms.add(catalogEntry.calculator_page_title);
  }
  
  // Add search keywords
  if (Array.isArray(catalogEntry.search_keywords)) {
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
 * Open the "Add service" panel.
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
async function openAddServicePanel(page) {
  logEvent('INFO', 'EVT-SVC-01', { step: 'opening_panel' });

  // Try multiple selectors for "Add service" button
  const selectors = [
    '[data-testid="add-service-button"]',
    'button:has-text("Add service")',
    'button:has-text("Add a service")',
    '[role="button"]:has-text("Add service")',
  ];

  for (const selector of selectors) {
    try {
      const addServiceButton = await page.$(selector);
      if (addServiceButton) {
        await addServiceButton.click();
        await page.waitForTimeout(500);
        logEvent('INFO', 'EVT-SVC-01', { step: 'panel_opened', selector });
        return;
      }
    } catch {
      continue;
    }
  }

  throw new Error('Could not find "Add service" button');
}

/**
 * Search for a service by search term with retry.
 * @param {import('playwright').Page} page
 * @param {string} searchTerm
 * @returns {Promise<void>}
 */
async function searchService(page, searchTerm) {
  logEvent('INFO', 'EVT-SVC-02', { term: searchTerm, step: 'searching' });

  // Find search input with multiple fallback selectors
  const selectors = [
    '[data-testid="service-search-input"]',
    'input[placeholder*="search services" i]',
    'input[placeholder*="search for a service" i]',
    'input[type="search"]',
    'input[aria-label*="search" i]',
  ];

  let searchInput = null;
  for (const selector of selectors) {
    try {
      searchInput = await page.$(selector);
      if (searchInput) {
        await searchInput.waitForElementState('visible', { timeout: 2000 });
        break;
      }
    } catch {
      continue;
    }
  }

  if (!searchInput) {
    throw new Error('Could not find service search input');
  }

  // Clear and type search term
  await searchInput.click();
  await searchInput.fill('');
  await searchInput.fill(searchTerm);
  await page.waitForTimeout(800);

  logEvent('INFO', 'EVT-SVC-02', { term: searchTerm, step: 'completed' });
}

/**
 * Select a service from search results with priority matching.
 * @param {import('playwright').Page} page
 * @param {string} serviceName
 * @param {string[]} expectedTitles
 * @returns {Promise<void>}
 */
async function selectService(page, serviceName, expectedTitles = []) {
  logEvent('INFO', 'EVT-SVC-03', { service: serviceName, step: 'selecting' });

  // Service card selectors
  const cardSelectors = [
    '[data-testid="service-card"]',
    '[data-testid="service-result"]',
    '.service-card',
    'li[class*="awsui_card"]',
  ];

  // Priority 1: Match expected titles
  for (const title of expectedTitles) {
    for (const selector of cardSelectors) {
      try {
        const cards = await page.$$(selector);
        for (const card of cards) {
          const text = await card.evaluate((el) => (el.textContent || '').toLowerCase());
          if (text.includes(title.toLowerCase())) {
            await card.click();
            await page.waitForTimeout(1000);
            logEvent('INFO', 'EVT-SVC-03', { service: serviceName, step: 'selected_by_title', title });
            return;
          }
        }
      } catch {
        continue;
      }
    }
  }

  // Priority 2: Match search term
  for (const selector of cardSelectors) {
    try {
      const cards = await page.$$(selector);
      for (const card of cards) {
        const text = await card.evaluate((el) => (el.textContent || '').toLowerCase());
        if (text.includes(serviceName.toLowerCase())) {
          await card.click();
          await page.waitForTimeout(1000);
          logEvent('INFO', 'EVT-SVC-03', { service: serviceName, step: 'selected_by_term' });
          return;
        }
      }
    } catch {
      continue;
    }
  }

  // Priority 3: First result fallback
  try {
    const firstCard = await page.$(cardSelectors[0]);
    if (firstCard) {
      await firstCard.click();
      await page.waitForTimeout(1000);
      logEvent('INFO', 'EVT-SVC-03', { service: serviceName, step: 'selected_first_fallback' });
      return;
    }
  } catch {
    // Ignore
  }

  throw new Error(`Service not found in search results: ${serviceName}`);
}

/**
 * Search and select service with multiple search terms.
 * Matches Python's search_and_select_service.
 * @param {import('playwright').Page} page
 * @param {string[]} searchTerms
 * @param {string[]} expectedTitles
 * @returns {Promise<void>}
 */
export async function searchAndSelectService(page, searchTerms, expectedTitles) {
  const terms = searchTerms.filter(t => t && t.trim());
  
  if (terms.length === 0) {
    throw new Error('No search terms available for service lookup');
  }

  // Open panel
  await openAddServicePanel(page);

  // Try each search term
  for (const term of terms) {
    try {
      await searchService(page, term);
      await selectService(page, term, expectedTitles);
      logEvent('INFO', 'EVT-SVC-03', { service: term, step: 'success' });
      return;
    } catch (error) {
      logEvent('WARN', 'EVT-SVC-02', { term, error: error.message });
      // Continue to next term
    }
  }

  throw new Error(`No search results for keywords: ${terms.join(', ')}`);
}

// ─── Region selection ─────────────────────────────────────────────────────────

/**
 * Select a region for the service.
 * Matches Python's select_region logic - matches by region code not display name.
 * @param {import('playwright').Page} page
 * @param {string} region - Region code (e.g., "us-east-1")
 * @returns {Promise<void>}
 */
async function selectRegion(page, region) {
  // Skip if global (no region selection needed)
  if (!region || region === 'global' || region.toLowerCase() === 'global') {
    logEvent('INFO', 'EVT-REG-01', { region: 'global', status: 'skipping' });
    return;
  }

  logEvent('INFO', 'EVT-REG-01', { region, status: 'selecting' });

  try {
    // Step 1: Ensure location type is set to "Region"
    const locationTypeSelector = '[data-testid="location-type-selector"], [aria-label*="location type" i], [aria-label*="Choose a location type" i]';
    const locationType = await page.$(locationTypeSelector);
    
    if (locationType) {
      const locationTypeText = await locationType.evaluate((el) => (el.textContent || '').trim().toLowerCase());
      if (!locationTypeText.includes('region')) {
        logEvent('INFO', 'EVT-REG-01', { step: 'setting_location_type_to_region' });
        await locationType.click();
        await page.waitForTimeout(300);
        
        // Select "Region" option
        const regionOption = await page.$('[role="option"]:has-text("Region"), [data-testid="region-option"]');
        if (regionOption) {
          await regionOption.click();
          await page.waitForTimeout(300);
        }
      }
    }

    // Step 2: Select region by code (not display name)
    // AWS displays regions as "us-east-1 (US East (N. Virginia))"
    // We match by the region code pattern
    const regionSelector = '[data-testid="region-selector"], [aria-label*="region" i], [aria-label*="Choose a Region" i]';
    const regionControl = await page.$(regionSelector);
    
    if (!regionControl) {
      throw new Error('Could not find region selector');
    }

    const tagName = await regionControl.evaluate((el) => el.tagName.toLowerCase());
    
    if (tagName === 'select') {
      // Native select - match by value or text containing region code
      await regionControl.selectOption(region);
    } else {
      // Custom dropdown - click to open
      await regionControl.click();
      await page.waitForTimeout(400);

      // Find region option by code pattern (e.g., "us-east-1")
      // AWS format: "us-east-1 (US East (N. Virginia))" or just "US East (N. Virginia)"
      const regionCodePattern = region.toLowerCase();
      const options = await page.$$('[role="option"]');
      
      let selected = false;
      for (const option of options) {
        const text = await option.evaluate((el) => (el.textContent || '').toLowerCase());
        const value = await option.evaluate((el) => el.getAttribute('data-value') || '').toLowerCase();
        
        // Match by region code in text or value
        if (text.includes(regionCodePattern) || value === regionCodePattern) {
          await option.click();
          selected = true;
          break;
        }
      }
      
      if (!selected) {
        // Fallback: try exact text match
        const fallbackOption = await page.$(`[role="option"]:has-text("${region}")`);
        if (fallbackOption) {
          await fallbackOption.click();
          selected = true;
        }
      }
      
      if (!selected) {
        throw new Error(`Region option not found: ${region}`);
      }
    }

    await page.waitForTimeout(300);
    logEvent('INFO', 'EVT-REG-01', { region, status: 'selected' });
  } catch (error) {
    logEvent('ERROR', 'EVT-REG-02', { region, error: error.message });
    throw error;
  }
}

/**
 * Check if region selection is required (i.e., not a global service).
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isRegionSelectionRequired(page) {
  try {
    const regionSelector = await page.$(
      '[data-testid="region-selector"], [data-testid="region-dropdown"], select[name="region"]'
    );
    return regionSelector !== null;
  } catch {
    return false;
  }
}

// ─── Main navigation function ────────────────────────────────────────────────

/**
 * Navigate to a service within a group and region.
 *
 * Orchestrates:
 * 1. Group creation/selection (via ensureGroup)
 * 2. Open Add Service panel
 * 3. Search for service by search term
 * 4. Select service from results
 * 5. Select region (skip if "global")
 *
 * All steps are wrapped in retry logic for resilience.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {string} opts.groupName - Name of the group
 * @param {string} opts.serviceName - Display name of the service
 * @param {string} opts.searchTerm - Search term to find the service
 * @param {string} opts.region - Region code or "global"
 * @param {object} [opts.context] - Run context for artifact paths
 * @param {string} [opts.context.runId]
 * @param {string} [opts.context.screenshotsDir]
 * @returns {Promise<void>}
 * @throws {Error} If navigation fails after retries
 */
export async function navigateToService(page, opts) {
  const { groupName, serviceName, searchTerm, region, context = {} } = opts;

  logEvent('INFO', 'EVT-NAV-01', { 
    service: serviceName, 
    group: groupName, 
    region, 
    status: 'starting' 
  });

  // Helper for capturing screenshots on failure
  const captureFail = async (step) => {
    if (context.runId && context.screenshotsDir) {
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

    // Step 2: Open Add Service panel
    await withRetry(
      async () => {
        try {
          await openAddServicePanel(page);
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
            await selectRegion(page, region);
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

    // Step 4: Search for service
    await withRetry(
      async () => {
        try {
          await searchService(page, searchTerm);
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

    // Step 5: Select service from results
    await withRetry(
      async () => {
        try {
          await selectService(page, serviceName);
        } catch (err) {
          await captureFail('service-selection');
          throw err;
        }
      },
      {
        stepName: 'service-selection',
        maxRetries: 2,
        delayMs: 1500,
      }
    );

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
    const serviceElement = await page.$(
      '[data-testid="current-service-name"], .service-header h1, [data-testid="service-title"]'
    );
    if (serviceElement) {
      return await serviceElement.textContent();
    }
    return null;
  } catch (error) {
    logEvent('ERROR', 'EVT-SVC-04', { error: error.message });
    return null;
  }
}

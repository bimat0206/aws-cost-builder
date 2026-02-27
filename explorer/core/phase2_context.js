/**
 * Phase 2: extract calculator context and region information.
 *
 * Uses region_map.json for region configuration instead of extracting from page.
 *
 * @module explorer/core/phase2_context
 */

import { UNKNOWN } from '../constants.js';
import { normalizeText } from '../utils.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load region map from config.
 * @returns {Record<string, string>}
 */
function loadRegionMap() {
  try {
    const regionMapPath = join(__dirname, '../../config/data/region_map.json');
    const regionMapContent = readFileSync(regionMapPath, 'utf-8');
    return JSON.parse(regionMapContent);
  } catch {
    return {};
  }
}

/**
 * Get default region from region map.
 * @returns {string|null}
 */
function getDefaultRegion() {
  const regionMap = loadRegionMap();
  // Return first region key or null
  const keys = Object.keys(regionMap);
  return keys.length > 0 ? keys[0] : null;
}

/**
 * Extract page title.
 * @param {import('playwright').Page} page
 * @param {string} fallback
 * @returns {Promise<string>}
 */
async function extractPageTitle(page, fallback) {
  const raw = await page.title().catch(() => fallback || UNKNOWN);
  const normalized = raw.split('|')[0].trim();
  return normalized || fallback || UNKNOWN;
}

/**
 * Extract breadcrumb.
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
async function extractBreadcrumb(page) {
  const parts = await page
    .evaluate(() => {
      const crumbs = document.querySelectorAll(
        "nav[aria-label*='breadcrumb' i] a, nav[aria-label*='breadcrumb' i] span, [data-testid*='breadcrumb'] a, [data-testid*='breadcrumb'] span",
      );
      return Array.from(crumbs)
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    })
    .catch(() => []);

  return parts.join(' > ');
}

/**
 * Execute phase 2.
 *
 * Uses region_map.json for region configuration.
 *
 * @param {import('playwright').Page} page
 * @param {string} cardTitle
 * @returns {Promise<{ calculator_page_title: string, breadcrumb: string, supported_regions: string[], selected_region_default: string|null }>}
 */
export async function phase2RegionAndContext(page, cardTitle) {
  const title = await extractPageTitle(page, cardTitle);
  const breadcrumb = await extractBreadcrumb(page);

  // Use region_map.json for region configuration
  const regionMap = loadRegionMap();
  const supportedRegions = Object.keys(regionMap);
  const selectedRegion = getDefaultRegion();

  return {
    calculator_page_title: title,
    breadcrumb,
    supported_regions: supportedRegions,
    selected_region_default: selectedRegion,
  };
}

/**
 * Phase 3: section discovery and expansion.
 *
 * @module explorer/core/phase3_sections
 */

import { discoverAndExpandSections } from '../scanner/section_explorer.js';
import { isSectionNoise, normalizeText, sleep } from '../utils.js';
import { UNKNOWN } from '../constants.js';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function buildLineMatcher(label) {
  const trimmed = (label || '').trim();
  if (!trimmed) return null;
  const escaped = escapeRegExp(trimmed);
  return new RegExp(`^${escaped}$`, 'i');
}

async function clickExpandableNode(page, locator) {
  try {
    if ((await locator.count().catch(() => 0)) === 0) {
      return false;
    }
    const candidate = locator.first();
    if (!(await candidate.isVisible().catch(() => false))) {
      return false;
    }
    await candidate.click({ timeout: 2000, force: true });
    await sleep(300);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract section label from trigger element - matches Python's section_label_from_locator.
 * @param {import('playwright').Locator} locator
 * @returns {Promise<string>}
 */
async function sectionLabelFromLocator(locator) {
  try {
    let label = normalizeText(await locator.textContent().catch(() => ''));
    if (!label) {
      label = normalizeText(await locator.getAttribute('aria-label').catch(() => ''));
    }
    if (label.length > 160) {
      label = label.slice(0, 160).trim();
    }
    return label || UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

/**
 * Get section state (expanded/collapsed) - matches Python's section_state.
 * @param {import('playwright').Locator} locator
 * @returns {Promise<string>}
 */
async function sectionState(locator) {
  try {
    const aria = normalizeText(await locator.getAttribute('aria-expanded').catch(() => '')).toLowerCase();
    if (aria === 'true') return 'expanded';
    if (aria === 'false') return 'collapsed';

    // Check if it's a <summary> element
    const tag = await locator.evaluate((el) => (el.tagName || '').toLowerCase()).catch(() => '');
    if (tag === 'summary') {
      const details = locator.locator('xpath=ancestor::details[1]').first();
      const openAttr = await details.getAttribute('open').catch(() => null);
      return openAttr !== null ? 'expanded' : 'collapsed';
    }
  } catch {
    // Ignore
  }
  return UNKNOWN;
}

/**
 * Try to expand a section - matches Python's try_expand_section.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} trigger
 * @param {string} label
 * @returns {Promise<string>}
 */
async function tryExpandSection(page, trigger, label) {
  try {
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
  } catch {
    // Ignore scroll errors
  }

  // Try clicking the trigger directly
  for (let i = 0; i < 2; i++) {
    const stateBefore = await sectionState(trigger);
    if (stateBefore === 'expanded') {
      return 'accordion_button';
    }

    try {
      await trigger.click({ timeout: 3000 }).catch(() => {});
      await sleep(600);
      if (await sectionState(trigger) === 'expanded') {
        return 'accordion_button';
      }
    } catch {
      // Continue to next attempt
    }
  }

  // Fallback: try clicking by text label
  if (label && label !== UNKNOWN) {
    try {
      const heading = page.getByText(label, { exact: true }).first();
      if (await heading.isVisible().catch(() => false)) {
        await heading.click({ timeout: 2500 }).catch(() => {});
        await sleep(500);
        if (await sectionState(trigger) === 'expanded') {
          return 'text_click';
        }
      }
    } catch {
      // Ignore
    }
  }

  return 'unknown';
}

/**
 * Discover sections using direct DOM triggers - matches Python's phase3_discover_sections.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{label: string, trigger: string}>>}
 */
async function discoverSectionsFromTriggers(page) {
  console.log('  [phase 3] Discovering sections via aria-expanded triggers...');

  const triggers = page.locator("button[aria-expanded], [role='button'][aria-expanded], summary");
  const sections = [];
  const seenLabels = new Set();

  const count = Math.min(await triggers.count(), 200);
  for (let idx = 0; idx < count; idx++) {
    try {
      const trigger = triggers.nth(idx);
      if (!(await trigger.isVisible().catch(() => false))) {
        continue;
      }

      const label = await sectionLabelFromLocator(trigger);
      if (!label || label === UNKNOWN || seenLabels.has(label)) {
        continue;
      }
      seenLabels.add(label);

      const state = await sectionState(trigger);
      let method = 'unknown';

      if (state === 'collapsed') {
        method = await tryExpandSection(page, trigger, label);
      } else if (state === 'expanded') {
        method = 'accordion_button';
      }

      sections.push({ label, trigger: method });
    } catch {
      // Skip failed triggers
    }
  }

  return sections;
}

async function expandCatalogTrigger(page, label) {
  const matcher = buildLineMatcher(label);
  if (!matcher) return false;

  const candidates = [
    page.getByRole('button', { name: matcher }).first(),
    page.locator('summary', { hasText: label }).first(),
    page.getByText(label, { exact: true }).first(),
  ];

  for (const candidate of candidates) {
    if (await clickExpandableNode(page, candidate)) {
      return true;
    }
  }

  return false;
}

async function applyCatalogTriggers(page, catalogTriggers, matchedTriggers) {
  if (!Array.isArray(catalogTriggers)) return;

  for (const entry of catalogTriggers || []) {
    const label = (entry?.label || '').trim();
    if (!label) continue;
    const normalized = normalizeText(label);
    if (matchedTriggers.has(normalized)) continue;

    const success = await expandCatalogTrigger(page, label);
    if (success) {
      matchedTriggers.add(normalized);
      process.stdout.write(`  [phase 3] Applied catalog trigger '${label}'.\n`);
    } else if (entry?.required) {
      process.stdout.write(`  [phase 3] Required catalog trigger '${label}' not found.\n`);
    }
  }
}

/**
 * Execute phase 3.
 *
 * @param {import('playwright').Page} page
 * @param {Array<{ label?: string, trigger?: string, required?: boolean }>} catalogTriggers
 * @returns {Promise<Array<{ label: string, trigger: string, catalogTriggerUsed?: boolean }>>}
 */
export async function phase3DiscoverSections(page, catalogTriggers = []) {
  console.log('  [phase 3] Discovering collapsible sections...');

  const normalizedTriggerMap = new Map();
  const requiredTriggers = new Set();
  for (const entry of catalogTriggers || []) {
    const label = normalizeText(entry?.label || '');
    if (!label) continue;
    normalizedTriggerMap.set(label, entry);
    if (entry?.required) {
      requiredTriggers.add(label);
    }
  }

  const matchedTriggers = new Set();
  await applyCatalogTriggers(page, catalogTriggers, matchedTriggers);

  // Use Python-style trigger-based discovery
  let rawSections = await discoverSectionsFromTriggers(page);

  // Fallback to section_explorer if no sections found
  if (rawSections.length === 0) {
    console.log('  [phase 3] No sections found via triggers; falling back to section_explorer...');
    const discoveredSections = await discoverAndExpandSections(page);
    rawSections = [];
    for (const [label, trigger, ok] of discoveredSections) {
      if (!ok) continue;
      if (isSectionNoise(label)) continue;
      const normalized = normalizeText(label);
      if (matchedTriggers.has(normalized)) continue;
      rawSections.push({ label, trigger });
      matchedTriggers.add(normalized);
    }
  }

  // Deduplicate and apply catalog triggers
  const deduped = [];
  const seen = new Set();

  for (const section of rawSections) {
    const { label, trigger } = section;
    if (!label) continue;

    const normalized = normalizeText(label);
    if (seen.has(normalized)) continue;
    if (isSectionNoise(label)) continue;

    const catalogEntry = normalizedTriggerMap.get(normalized);
    if (catalogEntry) {
      deduped.push({
        label,
        trigger: catalogEntry.trigger || trigger,
        catalogTriggerUsed: true,
      });
      seen.add(normalized);
      matchedTriggers.add(normalized);
      continue;
    }

    seen.add(normalized);
    deduped.push({ label, trigger });
  }

  for (const label of requiredTriggers) {
    if (!matchedTriggers.has(label)) {
      process.stdout.write(`  [phase 3] Required catalog trigger '${label}' not found; falling back to waterfall\n`);
    }
  }

  console.log(`  [phase 3] Found ${deduped.length} sections`);
  return deduped;
}

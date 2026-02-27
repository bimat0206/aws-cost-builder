/**
 * Phase 4: enumerate conditional states and scan dimensions.
 *
 * Matches Python explorer/core/phase4_dimensions.py logic:
 * - State graph exploration via BFS
 * - Toggle exhaustion (Pattern 1: CHECKBOX-TOGGLE GATE)
 * - Radio card exploration (Pattern 2: RADIO-CARD GATE)
 * - Select/combobox sampling (SELECT_GATE)
 * - State fingerprinting from DOM tokens
 * - Gate control discovery and tracking
 *
 * @module explorer/core/phase4_dimensions
 */

import { UNKNOWN } from '../constants.js';
import { cleanLabel, deriveCssSelector, normalizeText } from '../utils.js';
import {
  scanVisibleElements,
  findInventoryForSection,
  resolveDimensionFromDom,
  deriveDomFieldType,
} from '../scanner/dom_scanner.js';
import { scanOptions } from '../scanner/options_scanner.js';
import { scoreField } from '../confidence/confidence_scorer.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restoreToBase(page, configureUrl) {
  if (configureUrl) {
    await page.goto(configureUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await sleep(400);
}

function stateId(index) {
  return `S${index}`;
}

function sanitizeStateAction(action) {
  return String(action || 'click').slice(0, 80);
}

/**
 * Collect fingerprint tokens from live DOM - matches Python's _fingerprint_tokens.
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function collectFingerprintTokens(page) {
  try {
    const tokens = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const tokens = [];

      // Section headings
      const headingNodes = document.querySelectorAll(
        'h1, h2, h3, h4, [role="heading"], button[aria-expanded], [role="button"][aria-expanded], legend'
      );

      for (const node of headingNodes) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const text = norm(node.textContent || node.getAttribute('aria-label') || '');
        if (text) {
          tokens.push(`section:${text}`);
        }
      }

      // Field labels
      const controls = document.querySelectorAll(
        "input, select, textarea, [role='combobox'], [role='switch'], [role='checkbox'], [role='radio'], [role='spinbutton'], [role='textbox']"
      );

      for (const el of controls) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const aria = norm(el.getAttribute('aria-label') || '');
        if (aria) {
          tokens.push(`field:${aria}`);
          continue;
        }

        // Try aria-labelledby
        const labelledBy = norm(el.getAttribute('aria-labelledby') || '');
        if (!labelledBy) continue;

        const ids = labelledBy.split(' ').filter(Boolean);
        const joined = ids.map((id) => {
          const node = document.getElementById(id);
          return node ? norm(node.textContent || '') : '';
        }).filter(Boolean).join(' ');

        if (joined) {
          tokens.push(`field:${joined}`);
        }
      }

      return Array.from(new Set(tokens)).sort();
    });

    return tokens || [];
  } catch {
    return [];
  }
}

/**
 * Compute state fingerprint from DOM tokens - matches Python's compute_state_fingerprint.
 * @param {import('playwright').Page} page
 * @returns {Promise<{digest: string, tokens: string[]}>}
 */
async function computeStateFingerprint(page) {
  const tokens = await collectFingerprintTokens(page);
  const payload = tokens.join('\n');

  // Simple hash (similar to Python's SHA1)
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  const digest = Math.abs(hash).toString(16);
  return { digest, tokens };
}

function computeFingerprintFromDimensions(dimensions) {
  const parts = [];
  for (const dim of dimensions) {
    const section = normalizeText(dim.section || 'unknown');
    const selector = dim.css_selector || UNKNOWN;
    const fieldType = dim.field_type || UNKNOWN;
    const key = normalizeText(dim.key || dim.fallback_label || UNKNOWN);
    parts.push(`${section}|${key}|${fieldType}|${selector}`);
  }
  parts.sort();
  return parts.join('||');
}

function chooseSectionList(sections, inventories) {
  if (Array.isArray(sections) && sections.length > 0) {
    return sections.map((s) => s.label);
  }

  return inventories
    .map((inv) => inv.section_name)
    .filter(Boolean)
    .map((label) => String(label));
}

function buildScoreInput(dim, domElement) {
  return {
    label: dim.fallback_label && dim.fallback_label !== UNKNOWN ? dim.fallback_label : 'Unnamed Field',
    selector: dim.css_selector,
    detectedType: dim.field_type,
    section: dim.section,
    metadata: {
      ariaLabel: domElement?.attributes?.['aria-label'] || null,
      id: domElement?.attributes?.id || null,
      role: domElement?.attributes?.role || null,
      inputType: domElement?.attributes?.type || null,
      tagName: domElement?.tag_name || null,
      class: domElement?.attributes?.class || null,
      boundingBox: dim.field_box || null,
    },
  };
}

function addDimensionIdentity(dim) {
  const candidateKey = cleanLabel(dim.fallback_label || '') || UNKNOWN;
  const key = candidateKey !== UNKNOWN ? candidateKey : UNKNOWN;
  return {
    ...dim,
    key,
    aws_aria_label: dim.aws_aria_label || key,
    label_visible: dim.fallback_label || key,
  };
}

/**
 * Deduplicate dimensions - matches Python's dedupe_dimensions.
 * @param {Array} dimensions
 * @returns {Array}
 */
function dedupeDimensions(dimensions) {
  const bySelector = new Map();
  const unknownBucket = [];

  for (const dim of dimensions) {
    const selector = normalizeText(dim.css_selector || '') || UNKNOWN;
    if (selector === UNKNOWN) {
      unknownBucket.push(dim);
      continue;
    }

    if (!bySelector.has(selector)) {
      bySelector.set(selector, { ...dim });
    } else {
      // Merge
      const existing = bySelector.get(selector);
      for (const key of ['options', 'unit', 'default_value', 'notes', 'unit_sibling', 'semantic_role', 'pattern_type']) {
        if (!existing[key] && dim[key]) {
          existing[key] = dim[key];
        }
      }
      if (!existing.field_type || existing.field_type === UNKNOWN) {
        existing.field_type = dim.field_type;
      }
      existing.required = existing.required || dim.required;
    }
  }

  // Handle unknown selector dimensions
  const seenKey = new Map();
  const dedupedUnknown = [];
  for (const dim of unknownBucket) {
    const key = normalizeText(dim.key || '') || UNKNOWN;
    if (!seenKey.has(key)) {
      seenKey.set(key, 0);
      dedupedUnknown.push({ ...dim, disambiguation_index: 0 });
    } else {
      const idx = seenKey.get(key);
      seenKey.set(key, idx + 1);
      dedupedUnknown.push({ ...dim, disambiguation_index: idx + 1 });
    }
  }

  const result = Array.from(bySelector.values()).map((d) => ({ ...d, disambiguation_index: 0 }));
  return [...result, ...dedupedUnknown];
}

/**
 * Merge unit selectors into their value fields - matches Python's _merge_unit_selectors.
 * Detects "Unit X" fields and merges them with matching value fields.
 * @param {Array} dimensions
 * @returns {Array}
 */
function mergeUnitSelectors(dimensions) {
  const result = dimensions.map((d) => ({ ...d }));
  const toDrop = new Set();

  const unitPrefixRe = /^Unit\s+/i;
  const unitTailRe = /^(.+?)\s+(per\s+(second|minute|hour|day|month|year)s?|seconds?|minutes?|hours?|days?|months?|years?|bytes?|kb|mb|gb|tb|kib|mib|gib|thousands?|millions?|billions?|exact number)$/i;

  for (let i = 0; i < result.length; i++) {
    const dim = result[i];
    const key = dim.key || '';

    // Check if this is a "Unit X" field
    if (!unitPrefixRe.test(key)) continue;
    if (!['SELECT', 'RADIO', 'RADIO_GROUP', 'COMBOBOX'].includes(dim.field_type)) continue;

    const basePhraseRaw = key.replace(unitPrefixRe, '').trim();
    const basePhrase = basePhraseRaw.toLowerCase();
    if (!basePhrase) continue;

    // Get unit value
    let unitValue = dim.default_value;
    if (!unitValue && dim.options && dim.options.length > 0) {
      unitValue = dim.options[0];
    }

    // Try to infer from key
    if (!unitValue) {
      const match = basePhraseRaw.match(unitTailRe);
      if (match) {
        unitValue = match[2];
      }
    }

    if (!unitValue) continue;

    // Find matching value field
    let bestIdx = null;
    let bestLen = 0;
    const dimSection = normalizeText(dim.section || '').toLowerCase();

    for (let j = 0; j < result.length; j++) {
      if (j === i || toDrop.has(j)) continue;

      const other = result[j];
      const otherKey = (other.key || '').toLowerCase();
      const otherSection = normalizeText(other.section || '').toLowerCase();

      // Section must match or be empty
      if (dimSection && otherSection && dimSection !== otherSection) continue;

      // Check if other key starts with base phrase
      if (basePhrase.startsWith(otherKey) && otherKey.length > bestLen) {
        bestIdx = j;
        bestLen = otherKey.length;
      }
    }

    // Merge unit into value field
    if (bestIdx !== null) {
      if (!result[bestIdx].unit) {
        result[bestIdx].unit = unitValue;
      }
      result[bestIdx].unit_sibling = {
        default_value: unitValue,
        options: dim.options || [],
        aws_aria_label: dim.aws_aria_label,
      };
      toDrop.add(i);
      console.log(`  [phase 4] Merged unit field '${key}' into '${result[bestIdx].key}'`);
    }
  }

  return result.filter((_, idx) => !toDrop.has(idx));
}

/**
 * Detect repeatable row sections (Pattern 6) - matches Python's _mark_repeatable_rows.
 * Finds sections with "Add ..." buttons and marks fields as REPEATABLE_ROW.
 * @param {import('playwright').Page} page
 * @param {Array} dimensions
 * @returns {Array}
 */
async function markRepeatableRows(page, dimensions) {
  try {
    const addButtons = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const out = [];

      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const text = norm(btn.textContent || btn.getAttribute('aria-label') || '');
        if (!/^Add\s+/i.test(text)) continue;

        // Find section heading for this button
        let section = '';
        let node = btn.parentElement;
        let depth = 0;
        while (node && depth < 20) {
          const heading = node.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > [role="heading"]');
          if (heading) {
            section = norm(heading.textContent);
            if (section) break;
          }
          node = node.parentElement;
          depth += 1;
        }

        out.push({ label: text, section: section || '' });
      }

      return out;
    });

    if (!addButtons || addButtons.length === 0) {
      return dimensions;
    }

    // Map section to add button label
    const sectionToAdd = new Map();
    for (const btn of addButtons) {
      if (btn.section) {
        sectionToAdd.set(btn.section.toLowerCase(), btn.label);
      }
    }

    if (sectionToAdd.size === 0) {
      return dimensions;
    }

    // Mark dimensions in repeatable sections
    const output = dimensions.map((dim) => {
      const dimCopy = { ...dim };
      const section = normalizeText(dimCopy.section || '').toLowerCase();

      if (sectionToAdd.has(section)) {
        dimCopy.pattern_type = 'P6_REPEATABLE_ROW';
        dimCopy.add_button_label = sectionToAdd.get(section);
        dimCopy.row_fields = []; // Will be populated by promoter
      }

      return dimCopy;
    });

    console.log(`  [phase 4] Detected ${sectionToAdd.size} repeatable row sections`);
    return output;
  } catch {
    return dimensions;
  }
}

/**
 * Apply confidence scoring to dimensions - matches Python's _apply_confidence_and_status.
 * @param {Array} dimensions
 * @returns {Array}
 */
function applyConfidenceAndStatus(dimensions) {
  const labelCounts = new Map();

  // Count label occurrences for conflict detection
  for (const dim of dimensions) {
    const ariaLabel = normalizeText(dim.aws_aria_label || '').toLowerCase();
    if (ariaLabel && ariaLabel !== UNKNOWN.toLowerCase()) {
      labelCounts.set(ariaLabel, (labelCounts.get(ariaLabel) || 0) + 1);
    }
  }

  const output = dimensions.map((dim) => {
    const dimCopy = { ...dim };

    const labelSource = dimCopy.label_source || 'none';
    const section = normalizeText(dimCopy.section || '');
    const fieldType = normalizeText(dimCopy.field_type || UNKNOWN);

    // Compute label confidence
    let labelConf;
    if (labelSource === 'aria_label' || labelSource === 'aria_labelledby') {
      labelConf = 1.0;
    } else if (labelSource === 'label_for' || labelSource === 'label_wrap') {
      labelConf = 0.8;
    } else if (labelSource === 'heuristic') {
      labelConf = 0.6;
    } else if (dimCopy.fallback_label && dimCopy.fallback_label !== UNKNOWN) {
      labelConf = 0.3;
    } else {
      labelConf = 0.0;
    }

    // Compute section confidence
    const sectionConf = section && section !== UNKNOWN ? 0.8 : 0.0;

    // Compute field type confidence
    const ft = fieldType.toUpperCase();
    let fieldConf;
    if (['NUMBER', 'SELECT', 'TOGGLE', 'RADIO', 'RADIO_GROUP', 'INSTANCE_SEARCH'].includes(ft)) {
      fieldConf = 1.0;
    } else if (ft === 'COMBOBOX') {
      fieldConf = 0.7;
    } else if (ft === 'TEXT') {
      fieldConf = 0.5;
    } else {
      fieldConf = 0.3;
    }

    // Compute overall confidence
    const overall = Math.min(labelConf, sectionConf) * 0.6 + fieldConf * 0.4;

    // Determine status
    let status = 'OK';
    let reviewNote = null;

    if (overall >= 0.75) {
      status = 'OK';
    } else if (overall >= 0.5) {
      status = 'REVIEW_REQUIRED';
      reviewNote = 'Low confidence score.';
    } else {
      status = 'CONFLICT';
      reviewNote = 'Very low confidence score.';
    }

    // Check for duplicate labels
    const lowLabel = normalizeText(dimCopy.aws_aria_label || '').toLowerCase();
    if (lowLabel && labelCounts.get(lowLabel) > 1) {
      status = 'CONFLICT';
      reviewNote = 'Duplicate aws_aria_label across dimensions.';
    }

    // Check for unknown section
    if (section === UNKNOWN || !section) {
      if (status === 'OK') {
        status = 'REVIEW_REQUIRED';
        reviewNote = 'Section heading unresolved.';
      }
    }

    dimCopy.confidence = {
      label: Math.round(labelConf * 1000) / 1000,
      section: Math.round(sectionConf * 1000) / 1000,
      overall: Math.round(overall * 1000) / 1000,
    };
    dimCopy.status = status;
    if (reviewNote) {
      dimCopy.review_note = reviewNote;
    }

    return dimCopy;
  });

  return output;
}

/**
 * Discover potential gate controls that can reveal hidden fields - matches Python's discover_gate_controls.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ key: string, aws_aria_label: string, gate_type: string, default_state: string|boolean|null, availability: string, sections_gated: string[], css_selector: string, options: string[] }>>}
 */
export async function discoverGateControls(page) {
  const controls = await page
    .evaluate(() => {
      const readAttrs = (el) => {
        const attrs = {};
        for (const attr of el.attributes) {
          attrs[attr.name] = attr.value;
        }
        return attrs;
      };

      const labelFor = (el) => {
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel;

        const labelledBy = (el.getAttribute('aria-labelledby') || '').trim();
        if (labelledBy) {
          const parts = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '')
            .filter(Boolean)
            .join(' ')
            .trim();
          if (parts) return parts;
        }

        const closestLabel = el.closest('label');
        if (closestLabel?.textContent) return closestLabel.textContent;

        const id = el.getAttribute('id');
        if (id) {
          let linked = null;
          try {
            const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
              ? CSS.escape(id)
              : id.replace(/"/g, '\\"');
            linked = document.querySelector(`label[for="${esc}"]`);
          } catch {
            linked = document.querySelector(`label[for="${id}"]`);
          }
          if (linked?.textContent) return linked.textContent;
        }

        return (el.textContent || '').trim();
      };

      const output = [];
      const pushControl = (el, gateType, options = []) => {
        const attrs = readAttrs(el);
        const tag = el.tagName.toLowerCase();
        const rawLabel = labelFor(el);
        const label = (rawLabel || '').replace(/\s+/g, ' ').trim();
        let defaultState = null;

        if (gateType === 'TOGGLE') {
          if (tag === 'input') {
            defaultState = /** @type {HTMLInputElement} */ (el).checked;
          } else {
            const ariaChecked = el.getAttribute('aria-checked');
            defaultState = ariaChecked === 'true';
          }
        } else if (gateType === 'RADIO') {
          defaultState = attrs.value || null;
        } else {
          defaultState =
            (/** @type {HTMLInputElement|HTMLSelectElement} */ (el)).value ||
            attrs['aria-valuetext'] ||
            null;
        }

        output.push({
          tag,
          attrs,
          label,
          gate_type: gateType,
          default_state: defaultState,
          options,
        });
      };

      const toggles = document.querySelectorAll(
        "input[type='checkbox']:not([disabled]), [role='switch']:not([aria-disabled='true']), [role='checkbox']:not([aria-disabled='true'])",
      );
      toggles.forEach((el) => pushControl(el, 'TOGGLE'));

      const radioGroups = new Map();
      const radios = document.querySelectorAll("input[type='radio']:not([disabled])");
      radios.forEach((el) => {
        const name = el.getAttribute('name') || `radio_${radioGroups.size + 1}`;
        const label = labelFor(el);
        if (!radioGroups.has(name)) {
          radioGroups.set(name, { el, labels: [], defaultLabel: null });
        }
        const entry = radioGroups.get(name);
        if (label) entry.labels.push(label.replace(/\s+/g, ' ').trim());
        if (/** @type {HTMLInputElement} */ (el).checked && label) {
          entry.defaultLabel = label.replace(/\s+/g, ' ').trim();
        }
      });
      radioGroups.forEach(({ el, labels, defaultLabel }) => {
        const unique = Array.from(new Set(labels.filter(Boolean)));
        pushControl(el, 'RADIO', unique);
        if (defaultLabel) {
          output[output.length - 1].default_state = defaultLabel;
        }
      });

      const selects = document.querySelectorAll('select:not([disabled])');
      selects.forEach((el) => {
        const options = Array.from(el.querySelectorAll('option'))
          .map((opt) => (opt.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        pushControl(el, 'SELECT', Array.from(new Set(options)));
      });

      const combos = document.querySelectorAll("[role='combobox']:not([aria-disabled='true'])");
      combos.forEach((el) => pushControl(el, 'COMBOBOX', []));

      return output;
    })
    .catch(() => []);

  const deduped = [];
  const seenSelectors = new Set();

  for (const control of controls) {
    const cssSelector = deriveCssSelector(control.tag, control.attrs || {});
    if (!cssSelector || cssSelector === UNKNOWN || seenSelectors.has(cssSelector)) {
      continue;
    }
    seenSelectors.add(cssSelector);

    const rawKey = cleanLabel(control.label || '') || `${control.gate_type.toLowerCase()}_${deduped.length + 1}`;
    deduped.push({
      key: rawKey,
      aws_aria_label: rawKey,
      gate_type: control.gate_type,
      default_state: control.default_state ?? null,
      availability: 'visible',
      sections_gated: [],
      css_selector: cssSelector,
      options: Array.isArray(control.options) ? control.options : [],
    });
  }

  return deduped;
}

async function scanCurrentState(page, sections, currentStateId) {
  const inventories = await scanVisibleElements(page);
  const sectionNames = chooseSectionList(sections, inventories);
  const dims = [];

  if (sectionNames.length === 0) {
    for (const inv of inventories) {
      for (const element of inv.elements || []) {
        const dimBase = await resolveDimensionFromDom(page, element, inv.section_name || 'UNKNOWN');
        const dim = addDimensionIdentity({
          ...dimBase,
          discovered_in_state: currentStateId,
        });
        dims.push(dim);
      }
    }
  } else {
    for (const sectionName of sectionNames) {
      const inventory = findInventoryForSection(inventories, sectionName);
      if (!inventory) continue;
      for (const element of inventory.elements || []) {
        const dimBase = await resolveDimensionFromDom(page, element, sectionName);
        const dim = addDimensionIdentity({
          ...dimBase,
          discovered_in_state: currentStateId,
        });
        dims.push(dim);
      }
    }
  }

  // Apply post-processing: dedupe, merge units, mark repeatable rows, confidence
  let deduped = dedupeDimensions(dims);
  deduped = mergeUnitSelectors(deduped);
  deduped = await markRepeatableRows(page, deduped);
  deduped = applyConfidenceAndStatus(deduped);

  return {
    dimensions: deduped,
    fingerprint: computeFingerprintFromDimensions(deduped),
  };
}

async function ensureControlOptions(page, control, maxOptions) {
  if (!['SELECT', 'COMBOBOX', 'RADIO'].includes(control.gate_type)) {
    return control.options || [];
  }

  let options = Array.isArray(control.options) ? [...control.options] : [];
  if (options.length === 0 && control.css_selector && control.css_selector !== UNKNOWN) {
    options = await scanOptions(page, control.css_selector).catch(() => []);
  }

  const normalized = [];
  for (const option of options) {
    const text = String(option || '').trim();
    if (!text) continue;
    if (!normalized.some((item) => normalizeText(item) === normalizeText(text))) {
      normalized.push(text);
    }
  }

  return normalized.slice(0, maxOptions);
}

function buildActions(gateControls, optionMap) {
  const actions = [];

  for (const control of gateControls) {
    if (control.gate_type === 'TOGGLE') {
      actions.push({
        control,
        action: 'click',
        value: null,
      });
      continue;
    }

    if (control.gate_type === 'RADIO' || control.gate_type === 'SELECT' || control.gate_type === 'COMBOBOX') {
      const options = optionMap.get(control.css_selector) || [];
      for (const option of options) {
        if (normalizeText(option) === normalizeText(String(control.default_state || ''))) {
          continue;
        }
        actions.push({
          control,
          action: 'select',
          value: option,
        });
      }
    }
  }

  return actions;
}

async function applyAction(page, actionItem) {
  const { control, action, value } = actionItem;
  const selector = control.css_selector;
  if (!selector || selector === UNKNOWN) {
    return false;
  }

  const target = page.locator(selector).first();
  const count = await target.count().catch(() => 0);
  if (count === 0) {
    return false;
  }

  if (action === 'click') {
    await target.click({ timeout: 2000, force: true }).catch(() => {});
    await sleep(300);
    return true;
  }

  const selectedText = String(value || '').trim();
  if (!selectedText) {
    return false;
  }

  const tagName = await target
    .evaluate((el) => el.tagName.toLowerCase())
    .catch(() => null);

  if (tagName === 'select') {
    const selected = await target
      .selectOption({ label: selectedText })
      .catch(() => target.selectOption({ value: selectedText }).catch(() => []));
    await sleep(300);
    return Array.isArray(selected) ? selected.length > 0 : true;
  }

  // Combobox / radio fallback path.
  await target.click({ timeout: 2000, force: true }).catch(() => {});
  await sleep(200);

  const radioOption = page.locator("input[type='radio'], [role='radio']").filter({ hasText: selectedText }).first();
  if ((await radioOption.count().catch(() => 0)) > 0) {
    await radioOption.click({ timeout: 1500, force: true }).catch(() => {});
    await sleep(200);
    return true;
  }

  const listboxOption = page.locator("[role='option'], option").filter({ hasText: selectedText }).first();
  if ((await listboxOption.count().catch(() => 0)) > 0) {
    await listboxOption.click({ timeout: 1500, force: true }).catch(() => {});
    await sleep(250);
    return true;
  }

  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

async function restoreToggleIfNeeded(page, control) {
  if (control.gate_type !== 'TOGGLE') return;
  const selector = control.css_selector;
  if (!selector || selector === UNKNOWN) return;
  const target = page.locator(selector).first();
  if ((await target.count().catch(() => 0)) === 0) return;

  await target.click({ timeout: 1500, force: true }).catch(() => {});
  await sleep(250);
}

/**
 * Execute phase 4 - BFS exploration matching Python's phase4_bfs_explore.
 * Implements state graph exploration per design guideline Section 3.
 *
 * @param {import('playwright').Page} page
 * @param {Array<{label: string, trigger: string}>} sections
 * @param {Array<object>} baseGateControls
 * @param {{ maxStates?: number, restoreToggles?: boolean, maxOptionsPerSelect?: number, configureUrl?: string|null }} [opts]
 * @returns {Promise<{ dimensions: object[], stateTracker: { states: object[], gate_controls_status: object[], visited_fingerprints: Record<string, string>, activated_toggles: string[], budget_hit: boolean, current_state: string } }>}
 */
export async function phase4BfsExplore(page, sections, baseGateControls, opts = {}) {
  const {
    maxStates = 30,
    restoreToggles = true,
    maxOptionsPerSelect = 5,
    configureUrl = null,
  } = opts;

  console.log('  [phase 4] BFS exploration of UI states...');

  const tracker = {
    states: [],
    gate_controls_status: [],
    visited_fingerprints: {},
    activated_toggles: [],
    budget_hit: false,
    current_state: 'S0',
  };

  const globalDims = [];

  // S0 (Initial state)
  console.log('  [phase 4] Scanning initial state S0...');
  const baseScan = await scanCurrentState(page, sections, 'S0');
  tracker.states.push({
    state_id: 'S0',
    entered_via: { gate_control: null, action: null, from_state: null },
    fingerprint: baseScan.fingerprint,
    sequence: [],
  });
  tracker.current_state = 'S0';
  tracker.visited_fingerprints[baseScan.fingerprint] = 'S0';
  baseScan.dimensions.forEach((dim) => {
    dim.discovered_in_state = 'S0';
  });
  globalDims.push(...baseScan.dimensions);

  const optionMap = new Map();
  for (const control of baseGateControls) {
    const options = await ensureControlOptions(page, control, maxOptionsPerSelect);
    optionMap.set(control.css_selector, options);
  }

  const actions = buildActions(baseGateControls, optionMap);
  const queue = [{ sequence: [], stateId: 'S0' }];
  const visitedSequenceKeys = new Set();
  let budgetExceeded = false;

  async function applySequence(sequence = []) {
    await restoreToBase(page, configureUrl);
    for (const actionItem of sequence) {
      const applied = await applyAction(page, actionItem);
      if (!applied) {
        return false;
      }
    }
    return true;
  }

  function buildSequenceKey(sequence) {
    return sequence
      .map((actionItem) => `${actionItem.control.css_selector}|${actionItem.action}|${String(actionItem.value || '')}`)
      .join('||');
  }

  function recordState(scan, actionItem, fromState, sequence) {
    const newId = stateId(tracker.states.length);
    tracker.visited_fingerprints[scan.fingerprint] = newId;
    tracker.current_state = newId;
    const gateLabel = actionItem.control.aws_aria_label || actionItem.control.key;
    const actionDescriptor =
      actionItem.action === 'select'
        ? `select:${sanitizeStateAction(actionItem.value)}`
        : sanitizeStateAction(actionItem.action);
    tracker.states.push({
      state_id: newId,
      entered_via: {
        gate_control: gateLabel,
        action: actionDescriptor,
        from_state: fromState,
      },
      fingerprint: scan.fingerprint,
      sequence: sequence.slice(),
    });
    scan.dimensions.forEach((dim) => {
      dim.discovered_in_state = newId;
    });
    globalDims.push(...scan.dimensions);
    if (actionItem.control.gate_type === 'TOGGLE') {
      tracker.activated_toggles.push(gateLabel || actionItem.control.key);
    }
    queue.push({ sequence, stateId: newId });
    if (tracker.states.length >= maxStates) {
      budgetExceeded = true;
    }
  }

  // BFS exploration with pre-identified gate controls
  console.log('  [phase 4a] Exploring pre-identified gate controls...');
  while (queue.length > 0 && tracker.states.length < maxStates && !budgetExceeded) {
    const entry = queue.shift();
    for (const actionItem of actions) {
      if (tracker.states.length >= maxStates) {
        budgetExceeded = true;
        break;
      }
      if (!actionItem.control || !actionItem.control.css_selector) {
        continue;
      }
      const candidateSequence = [...entry.sequence, actionItem];
      const seqKey = buildSequenceKey(candidateSequence);
      if (visitedSequenceKeys.has(seqKey)) {
        continue;
      }
      visitedSequenceKeys.add(seqKey);
      const applied = await applySequence(candidateSequence);
      if (!applied) {
        continue;
      }
      const scan = await scanCurrentState(page, sections, 'S0');
      const knownState = tracker.visited_fingerprints[scan.fingerprint];
      if (!knownState) {
        recordState(scan, actionItem, entry.stateId, candidateSequence.slice());
      }
      if (restoreToggles && actionItem.control.gate_type === 'TOGGLE') {
        await restoreToggleIfNeeded(page, actionItem.control);
      }
      if (budgetExceeded) {
        break;
      }
    }
  }

  // PRIORITY 1: Toggle exhaustion phase (Pattern 1: CHECKBOX-TOGGLE GATE)
  console.log('  [phase 4b] Exhausting unchecked toggles...');
  const toggleSelector = (
    "[role='switch'][aria-checked='false'], " +
    "[role='checkbox'][aria-checked='false'], " +
    "input[type='checkbox']:not(:checked)"
  );

  for (let toggleIdx = 0; toggleIdx < 100 && !budgetExceeded; toggleIdx++) {
    if (tracker.states.length >= maxStates) {
      budgetExceeded = true;
      break;
    }

    try {
      const candidates = page.locator(toggleSelector);
      const count = await candidates.count();
      if (count === 0) {
        console.log(`  [phase 4b] No more unchecked toggles found after ${toggleIdx} toggles clicked`);
        break;
      }

      // Find first visible unchecked toggle
      let toggle = null;
      let toggleLabel = null;
      for (let i = 0; i < Math.min(count, 30); i++) {
        const candidate = candidates.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          toggle = candidate;
          toggleLabel = await candidate.getAttribute('aria-label').catch(() => null);
          if (!toggleLabel) {
            toggleLabel = await candidate.evaluate((el) => {
              const ids = (el.getAttribute('aria-labelledby') || '').split(' ').filter(Boolean);
              if (ids.length) {
                return ids.map((id) => {
                  const n = document.getElementById(id);
                  return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : '';
                }).join(' ');
              }
              return '';
            }).catch(() => '');
          }
          if (!toggleLabel) {
            toggleLabel = `toggle_${toggleIdx}`;
          }
          break;
        }
      }

      if (!toggle) {
        console.log('  [phase 4b] No visible unchecked toggles found');
        break;
      }

      const fromState = tracker.current_state;
      console.log(`  [explore] Clicking toggle '${toggleLabel}' ...`);

      // Click toggle ON
      await toggle.scrollIntoViewIfNeeded().catch(() => {});
      await toggle.click({ timeout: 1500, force: true }).catch(() => {});
      await sleep(350);

      // Scan new fields revealed
      const { digest } = await computeStateFingerprint(page);
      const knownState = tracker.visited_fingerprints[digest];

      if (!knownState) {
        const newScan = await scanCurrentState(page, sections, stateId(tracker.states.length));
        const newId = stateId(tracker.states.length);

        tracker.visited_fingerprints[digest] = newId;
        tracker.current_state = newId;
        tracker.states.push({
          state_id: newId,
          entered_via: {
            gate_control: toggleLabel,
            action: 'click',
            from_state: fromState,
          },
          fingerprint: digest,
          sequence: [],
        });

        newScan.dimensions.forEach((dim) => {
          dim.discovered_in_state = newId;
        });
        globalDims.push(...newScan.dimensions);
        tracker.activated_toggles.push(toggleLabel);

        console.log(`  [explore] ✓ '${toggleLabel}' ON → +${newScan.dimensions.length} fields (state ${newId})`);

        // Restore toggle OFF if requested
        if (restoreToggles) {
          try {
            await toggle.click({ timeout: 1500, force: true }).catch(() => {});
            await sleep(250);
            console.log(`  [explore] ✓ '${toggleLabel}' restored → OFF`);
          } catch {
            console.log(`  [explore] ⚠ '${toggleLabel}' could not be restored`);
          }
        }
      } else {
        console.log(`  [explore] ⚠ '${toggleLabel}' did not reveal new state (fingerprint unchanged)`);
        // Still restore if needed
        if (restoreToggles) {
          await toggle.click({ timeout: 1500, force: true }).catch(() => {});
          await sleep(250);
        }
      }
    } catch (exc) {
      console.log(`  [explore] ✗ Toggle exploration error: ${exc.message}`);
      continue;
    }
  }

  // PRIORITY 2: Radio card exploration (Pattern 2: RADIO-CARD GATE)
  console.log('  [phase 4c] Exploring radio card options...');
  try {
    const radioGroups = new Map();
    const radios = page.locator("input[type='radio']:not([disabled])");
    const radioCount = await radios.count();

    // Group radios by name
    for (let i = 0; i < radioCount; i++) {
      const radio = radios.nth(i);
      const name = await radio.getAttribute('name').catch(() => `radio_group_${i}`);
      const label = await radio.evaluate((el) => {
        // Get label text
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel;

        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const ids = labelledBy.split(' ').filter(Boolean);
          return ids.map((id) => {
            const node = document.getElementById(id);
            return node ? (node.textContent || '').trim() : '';
          }).join(' ');
        }

        const parentLabel = el.closest('label');
        if (parentLabel) return (parentLabel.textContent || '').trim();

        return '';
      }).catch(() => '');

      if (!radioGroups.has(name)) {
        radioGroups.set(name, { radios: [], defaultLabel: null });
      }

      const checked = await radio.isChecked().catch(() => false);
      const radioLabel = label || `option_${i}`;
      radioGroups.get(name).radios.push({ element: radio, label: radioLabel });
      if (checked) {
        radioGroups.get(name).defaultLabel = radioLabel;
      }
    }

    // Explore each radio card option (skip default)
    for (const [groupName, group] of radioGroups.entries()) {
      if (tracker.states.length >= maxStates) {
        budgetExceeded = true;
        break;
      }

      for (const radio of group.radios) {
        if (radio.label === group.defaultLabel) continue; // Skip default

        try {
          const fromState = tracker.current_state;
          console.log(`  [phase 4c] Selecting radio '${groupName}' → '${radio.label}'...`);

          await radio.element.scrollIntoViewIfNeeded().catch(() => {});
          await radio.element.click({ timeout: 1500, force: true }).catch(() => {});
          await sleep(500);

          const { digest } = await computeStateFingerprint(page);
          const knownState = tracker.visited_fingerprints[digest];

          if (!knownState) {
            const newScan = await scanCurrentState(page, sections, stateId(tracker.states.length));
            const newId = stateId(tracker.states.length);

            tracker.visited_fingerprints[digest] = newId;
            tracker.current_state = newId;
            tracker.states.push({
              state_id: newId,
              entered_via: {
                gate_control: groupName,
                action: `select:${radio.label}`,
                from_state: fromState,
              },
              fingerprint: digest,
              sequence: [],
            });

            newScan.dimensions.forEach((dim) => {
              dim.discovered_in_state = newId;
            });
            globalDims.push(...newScan.dimensions);

            console.log(`  [phase 4c] Radio '${radio.label}' → +${newScan.dimensions.length} fields (state ${newId})`);
            // DO NOT restore radio cards - they mutate entire form
          } else {
            console.log(`  [phase 4c] Radio '${radio.label}' did not reveal new state`);
          }
        } catch (exc) {
          console.log(`  [phase 4c] Radio exploration error for '${radio.label}': ${exc.message}`);
          continue;
        }

        if (tracker.states.length >= maxStates) {
          budgetExceeded = true;
          break;
        }
      }
    }
  } catch (exc) {
    console.log(`  [phase 4c] Radio card exploration error: ${exc.message}`);
  }

  // PRIORITY 3: Select/combobox sampling (SELECT_GATE)
  console.log('  [phase 4d] Sampling select/combobox options...');
  try {
    const selects = page.locator("select:visible, [role='combobox']:visible");
    const selectCount = await selects.count();

    for (let i = 0; i < selectCount && !budgetExceeded; i++) {
      if (tracker.states.length >= maxStates) {
        budgetExceeded = true;
        break;
      }

      const select = selects.nth(i);
      const label = await select.getAttribute('aria-label').catch(() => `select_${i}`) || `select_${i}`;

      // Get options
      let options = [];
      const tagName = await select.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'unknown');

      if (tagName === 'select') {
        options = await select.locator('option').allTextContents().catch(() => []);
      } else {
        // Combobox - click to open and get options
        await select.click({ timeout: 2000, force: true }).catch(() => {});
        await sleep(300);
        const listbox = page.locator("[role='listbox']:visible, [role='menu']:visible").last();
        options = await listbox.locator("[role='option']").allTextContents().catch(() => []);
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(200);
      }

      options = options.filter((o) => o && o.trim());
      if (options.length === 0) continue;

      const defaultValue = options[0];
      const capped = options.slice(0, maxOptionsPerSelect);

      console.log(`  [phase 4d] Sampling ${capped.length} options for '${label}'...`);

      for (const option of capped) {
        if (tracker.states.length >= maxStates) {
          budgetExceeded = true;
          break;
        }

        if (option === defaultValue) continue;

        try {
          const fromState = tracker.current_state;

          // Select option
          if (tagName === 'select') {
            await select.selectOption({ label: option }).catch(() => {});
          } else {
            await select.click({ timeout: 2000, force: true }).catch(() => {});
            await sleep(250);
            const listboxOption = page.locator("[role='option']").filter({ hasText: option }).first();
            await listboxOption.click({ timeout: 1500, force: true }).catch(() => {});
          }
          await sleep(350);

          const { digest } = await computeStateFingerprint(page);
          const knownState = tracker.visited_fingerprints[digest];

          if (!knownState) {
            const newScan = await scanCurrentState(page, sections, stateId(tracker.states.length));
            const newId = stateId(tracker.states.length);

            tracker.visited_fingerprints[digest] = newId;
            tracker.current_state = newId;
            tracker.states.push({
              state_id: newId,
              entered_via: {
                gate_control: label,
                action: `select:${option}`,
                from_state: fromState,
              },
              fingerprint: digest,
              sequence: [],
            });

            newScan.dimensions.forEach((dim) => {
              dim.discovered_in_state = newId;
            });
            globalDims.push(...newScan.dimensions);

            console.log(`  [phase 4d] Option '${option}' → +${newScan.dimensions.length} fields (state ${newId})`);
          }
        } catch (exc) {
          console.log(`  [phase 4d] Select sampling error for '${option}': ${exc.message}`);
          await page.keyboard.press('Escape').catch(() => {});
          continue;
        }
      }
    }
  } catch (exc) {
    console.log(`  [phase 4d] Select/combobox sampling error: ${exc.message}`);
  }

  tracker.budget_hit = budgetExceeded || tracker.states.length >= maxStates;
  tracker.gate_controls_status = baseGateControls.map((control) => {
    const label = control.aws_aria_label || control.key;
    const statesRevealed = tracker.states
      .filter((state) => state.entered_via?.gate_control === label)
      .map((state) => state.state_id);
    return {
      ...control,
      options: optionMap.get(control.css_selector) || [],
      triggered: statesRevealed.length > 0,
      states_revealed: statesRevealed,
    };
  });

  console.log(`  [phase 4] BFS Complete: Explored ${tracker.states.length} states, found ${globalDims.length} total dimensions`);

  return {
    dimensions: dedupeDimensions(globalDims),
    stateTracker: tracker,
    replaySequence: async (sequence = []) => applySequence(sequence),
  };
}

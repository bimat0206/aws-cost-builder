/**
 * Explorer utility functions.
 * Matches Python explorer/core/utils.py
 * 
 * @module explorer/utils
 */

import { UNKNOWN, NOISE_LABEL_RE, NOISE_EXACT, PAGE_TITLE_RE } from './constants.js';

/**
 * Normalize text - matches Python's normalize_text.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Slugify service ID - matches Python's slugify_service_id.
 * @param {string} serviceName
 * @returns {string}
 */
export function slugifyServiceId(serviceName) {
  if (!serviceName) return 'unknown_service';
  return serviceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50);
}

/**
 * Check if section label is noise - matches Python's _is_section_noise.
 * @param {string} label
 * @returns {boolean}
 */
export function isSectionNoise(label) {
  const text = normalizeText(label);
  if (!text) return true;
  
  if (NOISE_EXACT.has(text)) return true;
  if (PAGE_TITLE_RE.test(text)) return true;
  if (NOISE_LABEL_RE.test(text)) return true;
  if (text.length < 3 || text.length > 120) return true;
  
  return false;
}

/**
 * Clean label text - matches Python's _clean_label_text.
 * @param {string} raw
 * @returns {string}
 */
export function cleanLabel(raw) {
  let text = normalizeText(raw);
  if (!text) return UNKNOWN;

  // Remove "Info:" patterns
  text = text.replace(/([a-z])info:\s*/gi, '$1 ');
  text = text.replace(/\binfo:\s*/gi, '');
  
  // Normalize spacing around colons
  text = text.replace(/\s*:\s*/g, ': ');
  text = normalizeText(text);

  // Handle unit patterns
  const unitPattern = /\s+(per\s+(?:second|minute|hour|day|month|year)s?|seconds?|minutes?|hours?|days?|months?|years?|bytes?|kb|mb|gb|tb|kib|mib|gib)$/i;
  const unitMatch = unitPattern.exec(text);
  if (unitMatch && text.toLowerCase().startsWith('unit ')) {
    text = normalizeText(text.substring(0, unitMatch.index));
  }

  // Handle "units" patterns
  if (/\bunits?\b/i.test(text)) {
    const optionPattern = /\s+(none|thousands?|millions?|billions?|exact number)$/i;
    const optionMatch = optionPattern.exec(text);
    if (optionMatch) {
      text = normalizeText(text.substring(0, optionMatch.index));
    }
  }

  // Remove trailing " none"
  if (text.toLowerCase().endsWith(' none')) {
    text = normalizeText(text.substring(0, text.length - 5));
  }

  return text || UNKNOWN;
}

/**
 * Escape CSS selector attribute value.
 * @param {string} value
 * @returns {string}
 */
export function escapeCssAttr(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Check if ID is volatile (auto-generated).
 * @param {string} id
 * @returns {boolean}
 */
export function isVolatileId(id) {
  if (!id) return false;
  return /^formField\d+-\d+-\d+$/i.test(id);
}

/**
 * Derive CSS selector from element attributes - matches Python's _derive_css_selector.
 * @param {string} tag
 * @param {object} attrs
 * @returns {string}
 */
export function deriveCssSelector(tag, attrs) {
  // 1. ID attribute (if not volatile)
  const elementId = attrs?.id || '';
  if (elementId && !isVolatileId(elementId)) {
    const safe = escapeCssAttr(elementId);
    return `${tag}[id='${safe}']`;
  }

  // 2. aria-label attribute
  if (attrs?.['aria-label']) {
    const val = escapeCssAttr(attrs['aria-label']);
    return `${tag}[aria-label='${val}']`;
  }

  // 3. data-* attributes (testid, id, automation-id)
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key.startsWith('data-testid') || 
        key.startsWith('data-id') || 
        key.startsWith('data-automation-id')) {
      const val = escapeCssAttr(value);
      return `${tag}[${key}='${val}']`;
    }
  }

  // 4. name attribute
  if (attrs?.name) {
    const val = escapeCssAttr(attrs.name);
    return `${tag}[name='${val}']`;
  }

  // 5. aria-labelledby
  if (attrs?.['aria-labelledby']) {
    const val = escapeCssAttr(attrs['aria-labelledby']);
    return `${tag}[aria-labelledby='${val}']`;
  }

  // 6. aria-controls
  if (attrs?.['aria-controls']) {
    const val = escapeCssAttr(attrs['aria-controls']);
    return `${tag}[aria-controls='${val}']`;
  }

  // 7. role + accessible name
  if (attrs?.role && attrs?.['aria-label']) {
    const role = attrs.role;
    const val = escapeCssAttr(attrs['aria-label']);
    return `${tag}[role='${role}'][aria-label='${val}']`;
  }

  // 8. None stable found
  return UNKNOWN;
}

/**
 * Get section key for matching.
 * @param {string|null} text
 * @returns {string}
 */
export function sectionKey(text) {
  const raw = normalizeText(text || '');
  if (!raw) return '';
  return raw.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Calculate token overlap between two section names.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function tokenOverlap(a, b) {
  const aTokens = new Set(sectionKey(a).split(' ').filter(t => t));
  const bTokens = new Set(sectionKey(b).split(' ').filter(t => t));
  
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap;
}

/**
 * Merge option lists, avoiding duplicates.
 * @param {string[]} dst
 * @param {string[]} src
 * @returns {string[]}
 */
export function mergeOptionLists(dst, src) {
  const normalized = new Set(dst.filter(v => normalizeText(v)).map(v => normalizeText(v)));
  
  for (const item of src) {
    const clean = normalizeText(item);
    if (clean && !normalized.has(clean)) {
      normalized.add(clean);
    }
  }
  
  return Array.from(normalized);
}

/**
 * Get key for merge operation.
 * @param {string|null} key
 * @param {string|null} fallbackLabel
 * @returns {string}
 */
export function keyForMerge(key, fallbackLabel) {
  const k = normalizeText(key || '');
  if (k && k !== UNKNOWN) return k.toLowerCase();
  return normalizeText(fallbackLabel || UNKNOWN).toLowerCase();
}

/**
 * Options for display (truncated preview).
 * @param {import('./models.js').DraftDimension} dim
 * @returns {string}
 */
export function optionsForDisplay(dim) {
  const values = [];
  for (const item of dim.options || []) {
    const clean = normalizeText(item);
    if (clean && !values.includes(clean)) {
      values.push(clean);
    }
  }

  // Check unit sibling options
  const unitSibling = dim.unit_sibling;
  if (unitSibling && typeof unitSibling === 'object' && Array.isArray(unitSibling.options)) {
    for (const item of unitSibling.options) {
      const clean = normalizeText(String(item));
      if (clean && !values.includes(clean)) {
        values.push(clean);
      }
    }
  }

  return values.length > 0 ? values.join(', ') : '-';
}

/**
 * Format confidence level for display.
 * @param {string} confidence
 * @returns {string}
 */
export function formatConfidence(confidence) {
  const colors = {
    'HIGH': 'green',
    'MEDIUM': 'yellow',
    'LOW': 'red',
    'DOM_ONLY': 'cyan',
    'BFS_ONLY': 'magenta',
    'MERGED': 'blue',
  };
  return colors[confidence] || 'gray';
}

/**
 * Sleep for specified milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

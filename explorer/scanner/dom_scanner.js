/**
 * DOM inventory scanner.
 * 
 * Matches Python explorer/dom_scanner.py logic:
 * - Scans visible interactive elements
 * - Groups by section (DomInventory)
 * - Resolves labels via priority chain
 * - Generates CSS selectors
 * - Skips noise/service cards
 * 
 * @module explorer/scanner/dom_scanner
 */

import { DomInventory, DomElement } from '../models.js';
import { 
  UNKNOWN, 
  INTERACTIVE_SELECTORS, 
  SERVICE_CARD_SELECTOR,
  LOG_LEVELS,
} from '../constants.js';
import { cleanLabel, deriveCssSelector, normalizeText } from '../utils.js';
import { logEvent as sharedLogEvent } from '../../core/index.js';

// ─── Logging helpers ──────────────────────────────────────────────────────────

/**
 * Format and print a log line.
 * @param {string} level
 * @param {string} module
 * @param {string} event
 * @param {string} message
 */
function log(level, module, event, message) {
  sharedLogEvent(level, module, event, message ? { message } : {});
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

// ─── Label resolution ─────────────────────────────────────────────────────────

/**
 * Infer field bounding box - matches Python's infer_field_box.
 * @param {import('playwright').ElementHandle} el
 * @returns {Promise<object|null>}
 */
async function inferFieldBox(el) {
  try {
    const box = await el.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      };
    });
    return box;
  } catch {
    return null;
  }
}

/**
 * Infer unit from nearby text - matches Python's infer_unit.
 * @param {import('playwright').ElementHandle} el
 * @returns {Promise<string|null>}
 */
async function inferUnit(el) {
  try {
    const nearby = await el.evaluate((element) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      let node = element.parentElement;
      let depth = 0;
      while (node && depth < 5) {
        const text = norm(node.textContent);
        if (text) return text;
        node = node.parentElement;
        depth += 1;
      }
      return '';
    });

    // Look for unit patterns
    const unitPattern = /\b(GB|TB|MB|GiB|MiB|KiB|vCPU|hours\/month|requests\/month|requests|ms|%|GB-month|GB-hours|IOPS|per\s+(second|minute|hour|day|month|year)|seconds?|minutes?|hours?|days?|months?|years?|bytes?|kb|mb|gb|tb|kib|mib|gib|thousands?|millions?|billions?|exact number)\b/i;
    const match = nearby.match(unitPattern);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Infer unit sibling (VALUE+UNIT pair detection) - matches Python's _merge_unit_selectors logic.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} el
 * @param {string} label
 * @returns {Promise<object|null>}
 */
async function inferUnitSibling(page, el, label) {
  try {
    // Look for immediately following sibling SELECT
    const tagName = await el.evaluate((element) => element.tagName.toLowerCase());
    if (tagName !== 'input') return null;

    const inputType = await el.getAttribute('type');
    if (inputType !== 'number') return null;

    // Find sibling select in browser
    const siblingInfo = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;

      // Look for next sibling that is a select
      let sibling = el.nextElementSibling;
      let depth = 0;
      while (!sibling && depth < 5) {
        const parent = el.parentElement;
        if (!parent) break;
        sibling = parent.nextElementSibling;
        el = parent;
        depth += 1;
      }

      if (!sibling) return null;
      if (sibling.tagName.toLowerCase() !== 'select') return null;

      const options = Array.from(sibling.querySelectorAll('option'))
        .map((opt) => (opt.textContent || '').trim())
        .filter(Boolean);

      const unitOptions = options.filter((opt) => {
        const text = opt.toLowerCase();
        return /gb|tb|mb|kb|per month|million|thousand|hours|%|requests|ms|seconds?|minutes?|hours?|days?|months?|years?|bytes?|gib|mib|kib|exact number/i.test(text);
      });

      if (unitOptions.length === 0) return null;

      return {
        aws_aria_label: sibling.getAttribute('aria-label'),
        default_value: sibling.value || (options[0] || null),
        options: unitOptions,
      };
    }, await el.evaluate((element) => {
      // Generate a unique selector for this element
      if (element.id) return `#${CSS.escape(element.id)}`;
      if (element.className) {
        const classes = element.className.split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length > 0) return `${element.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
      }
      return element.tagName.toLowerCase();
    }));

    return siblingInfo;
  } catch {
    return null;
  }
}

/**
 * Get pattern type from field type - matches Python's _PATTERN_BY_TYPE.
 * @param {string} fieldType
 * @param {string} role
 * @param {string} tag
 * @param {boolean} insideTable
 * @returns {string}
 */
function getPatternType(fieldType, role, tag, insideTable) {
  // Check for instance table first
  if (role === 'radio' && insideTable) {
    return 'P6_INSTANCE_TABLE';
  }

  const patternByType = {
    NUMBER: 'P1_NUMBER',
    SELECT: 'P2_SELECT',
    COMBOBOX: 'P3_COMBOBOX',
    INSTANCE_SEARCH: 'P3_COMBOBOX',
    TOGGLE: 'P4_TOGGLE',
    RADIO: 'P5_RADIO_GROUP',
    RADIO_GROUP: 'P5_RADIO_GROUP',
  };

  return patternByType[fieldType] || 'UNKNOWN_PATTERN';
}

/**
 * Infer semantic role - matches Python's _infer_semantic_role.
 * @param {string} key
 * @param {string} fieldType
 * @returns {string|null}
 */
function inferSemanticRole(key, fieldType) {
  const low = (key || '').toLowerCase();

  // Migration mode gate
  if (/how will data be moved|migration|data transfer method/i.test(low)) {
    return 'migration_mode_gate';
  }

  // Pricing mode gate
  if ((fieldType === 'SELECT' || fieldType === 'RADIO' || fieldType === 'RADIO_GROUP') &&
      /pricing|payment|tier|plan|license|edition|model|mode|option/i.test(low)) {
    return 'pricing_mode_gate';
  }

  // Region gated
  if (/region|availability zone|location/i.test(low)) {
    return 'region_gated';
  }

  return null;
}

/**
 * Capture options for a SELECT/RADIO element during scan.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} el
 * @param {string} fieldType
 * @returns {Promise<string[]>}
 */
async function captureOptionsDuringScan(page, el, fieldType) {
  try {
    const tagName = await el.evaluate((element) => element.tagName.toLowerCase());
    
    if (tagName === 'select') {
      // Native select - get all options
      const options = await el.evaluate((element) => {
        return Array.from(element.querySelectorAll('option'))
          .map((opt) => (opt.textContent || '').trim())
          .filter((text) => text && text.length > 0);
      });
      return options;
    }
    
    if (fieldType === 'RADIO' || fieldType === 'RADIO_GROUP') {
      // Find all radios in the same group
      const name = await el.getAttribute('name');
      if (!name) return [];
      
      const radios = page.locator(`input[type='radio'][name='${name}']`);
      const count = await radios.count();
      const options = [];
      
      for (let i = 0; i < count; i++) {
        const radio = radios.nth(i);
        const label = await radio.evaluate((element) => {
          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel;
          
          const labelledBy = element.getAttribute('aria-labelledby');
          if (labelledBy) {
            const ids = labelledBy.split(' ').filter(Boolean);
            return ids.map((id) => {
              const node = document.getElementById(id);
              return node ? (node.textContent || '').trim() : '';
            }).join(' ');
          }
          
          const parentLabel = element.closest('label');
          if (parentLabel) return (parentLabel.textContent || '').trim();
          
          return '';
        }).catch(() => '');
        
        if (label) {
          options.push(label);
        }
      }
      
      return options;
    }
    
    if (fieldType === 'COMBOBOX') {
      // Click to open and get options
      await el.click({ timeout: 2000, force: true }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      const listbox = page.locator("[role='listbox']:visible, [role='menu']:visible").last();
      const optionCount = await listbox.locator("[role='option']").count().catch(() => 0);
      
      const options = [];
      for (let i = 0; i < Math.min(optionCount, 50); i++) {
        const text = await listbox.locator("[role='option']").nth(i).textContent().catch(() => '');
        if (text && text.trim()) {
          options.push(text.trim());
        }
      }
      
      await page.keyboard.press('Escape').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      
      return options;
    }
    
    return [];
  } catch {
    return [];
  }
}

/**
 * Resolve label using priority chain - matches Python's infer_label.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} el
 * @param {object} attrs
 * @returns {Promise<[string, string]>} [label_text, label_source]
 */
async function resolveLabel(page, el, attrs) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  
  // 1. aria-labelledby
  const ariaLabelledby = attrs['aria-labelledby'];
  if (ariaLabelledby) {
    try {
      const ids = ariaLabelledby.split(' ').filter(Boolean);
      const texts = await page.evaluate((idList) => {
        return idList.map((id) => {
          const node = document.getElementById(id);
          return node ? norm(node.textContent) : '';
        }).filter(Boolean);
      }, ids);
      
      if (texts.length > 0) {
        const label = texts.join(' ');
        return [label || UNKNOWN, 'aria_labelledby'];
      }
    } catch (error) {
      // Skip if evaluation fails
    }
  }

  // 2. aria-label
  const ariaLabel = attrs['aria-label'];
  if (ariaLabel) {
    const label = norm(ariaLabel);
    if (label) {
      return [label, 'aria_label'];
    }
  }

  // 3. label[for=id]
  const elId = attrs['id'];
  if (elId) {
    try {
      const labelEl = page.locator(`label[for="${elId}"]`).first();
      const count = await labelEl.count();
      if (count > 0) {
        const text = await labelEl.textContent();
        if (text) {
          const label = norm(text);
          if (label) {
            return [label, 'label_for'];
          }
        }
      }
    } catch (error) {
      // Skip if not found
    }
  }

  // 4. Ancestor label
  try {
    const wrapping = el.locator('xpath=ancestor::label[1]').first();
    const count = await wrapping.count();
    if (count > 0) {
      const isVisible = await wrapping.isVisible().catch(() => false);
      if (isVisible) {
        const text = await wrapping.textContent();
        if (text) {
          let label = norm(text);
          // Remove element's own text
          const elText = await el.textContent().catch(() => '');
          if (elText) {
            label = label.replace(norm(elText), '').trim();
          }
          if (label) {
            return [label, 'label_wrap'];
          }
        }
      }
    }
  } catch (error) {
    // Skip
  }

  // 5. Fallback: search parent elements for label-like nodes
  try {
    const fallback = await el.evaluate((element) => {
      const normFn = (s) => (s || '').replace(/\s+/g, ' ').trim();
      let parent = element.parentElement;
      let depth = 0;
      
      // Look for label, legend, or class containing 'label'
      while (parent && depth < 6) {
        const candidate = parent.querySelector(":scope > label, :scope > legend, :scope > [class*='label'], :scope > [data-testid*='label']");
        if (candidate) {
          const text = normFn(candidate.textContent);
          if (text) return text;
        }
        parent = parent.parentElement;
        depth += 1;
      }
      
      // Look for headings
      parent = element.parentElement;
      depth = 0;
      while (parent && depth < 8) {
        const candidate = parent.querySelector(":scope > h2, :scope > h3, :scope > h4, :scope > h5");
        if (candidate) {
          const text = normFn(candidate.textContent);
          if (text) return text;
        }
        parent = parent.parentElement;
        depth += 1;
      }
      
      return '';
    });
    
    if (fallback) {
      return [fallback, 'heuristic'];
    }
  } catch (error) {
    // Skip
  }

  // 6. None found
  return [UNKNOWN, 'none'];
}

// ─── Main scanner function ────────────────────────────────────────────────────

/**
 * Scan visible elements and group by section.
 * Matches Python's scan_visible_elements.
 * 
 * @param {import('playwright').Page} page
 * @returns {Promise<DomInventory[]>}
 */
export async function scanVisibleElements(page) {
  logInfo('explorer/scanner/dom_scanner', 'EVT-SCAN-01', 'Starting DOM scan...');

  const sectionsMap = new Map();
  sectionsMap.set(null, []);

  try {
    // Evaluate in browser for efficiency (avoids hundreds of RPC calls)
    const script = `() => {
      const CARD_SELECTOR = "li[class*='awsui_card'], [data-testid*='service-card'], [data-testid*='service-result']";
      const selectors = ${JSON.stringify(INTERACTIVE_SELECTORS)};

      function getAttributes(el) {
        const attrs = {};
        for (let attr of el.attributes) {
          attrs[attr.name] = attr.value;
        }
        return attrs;
      }

      function getSectionName(el) {
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const noise = new Set([
          'language', 'language: english', 'region', 'unknown section', 'show details',
          'show calculations', 'x86', 'arm64', 'none', 'kb', 'mb', 'gb', 'tb', 'bytes',
          'per second', 'per minute', 'per hour', 'per day', 'per month', 'per year',
          'hours', 'hour', 'seconds', 'exact number', 'thousands', 'millions', 'billions'
        ]);

        // Priority 3: Use spatial Y-coordinate anchoring for section assignment
        // Collect all section headings with their Y coordinates
        const elRect = el.getBoundingClientRect();
        const elY = elRect.top + window.scrollY;

        // Find all potential section headings - search deeper with more selectors
        const headingNodes = document.querySelectorAll(
          'h1, h2, h3, h4, h5, [role="heading"], button[aria-expanded], [role="button"][aria-expanded], legend, ' +
          '[class*="awsui_header_"] *, .card-header *, [class*="awsui_container_"] > [class*="awsui_header"] *, ' +
          '[data-testid*="header"] *, [class*="heading"] *, [class*="title"] *'
        );

        // Find the nearest heading ABOVE this element (within reasonable distance)
        let bestHeading = null;
        let bestHeadingY = -Infinity;
        let bestHeadingDist = Infinity;

        for (const heading of headingNodes) {
          const rect = heading.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;

          const headingY = rect.top + window.scrollY;
          const headingText = norm(heading.textContent || heading.getAttribute('aria-label') || '');

          // Skip noise headings
          if (!headingText || noise.has(headingText)) continue;
          
          // Skip very short headings
          if (headingText.length < 3) continue;

          // Heading must be above or at same level as element
          if (headingY <= elY + 50) {
            const dist = elY - headingY;
            // Prefer closer headings
            if (dist < bestHeadingDist || (dist === bestHeadingDist && headingY > bestHeadingY)) {
              bestHeading = headingText;
              bestHeadingY = headingY;
              bestHeadingDist = dist;
            }
          }
        }

        // If found a heading above, use it
        if (bestHeading) {
          // Return original case (not normalized) for display
          return bestHeading.replace(/\\s+/g, ' ').trim();
        }

        // Fallback: traditional parent traversal - search deeper (up to 25 levels like Python)
        let curr = el.parentElement;
        let depth = 0;
        while (curr && curr.tagName !== 'BODY' && depth < 25) {
          // Check for panel header (Cloudscape containers)
          const panelHeader = curr.querySelector(
            ':scope > [class*="awsui_header_"], :scope > .card-header, :scope > [class*="awsui_container_"] > [class*="awsui_header"]'
          );
          if (panelHeader) {
            const heading = panelHeader.querySelector(
              'h1, h2, h3, h4, [role="heading"], [class*="awsui_heading-text"]'
            );
            if (heading) {
              const text = norm(heading.textContent);
              if (text && !noise.has(text)) return text.replace(/\\s+/g, ' ').trim();
            }
          }

          // Check for static headings
          const headingOld = curr.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > legend');
          if (headingOld) {
            const text = norm(headingOld.textContent);
            if (text && !noise.has(text)) return text.replace(/\\s+/g, ' ').trim();
          }

          // Check for expandable trigger
          const trigger = curr.querySelector(':scope > button[aria-expanded], :scope > [role="button"][aria-expanded]');
          if (trigger) {
            const text = norm(trigger.textContent) || norm(trigger.getAttribute('aria-label'));
            if (text && !noise.has(text)) return text.replace(/\\s+/g, ' ').trim();
          }

          // Check aria-label of container
          if (curr.getAttribute('aria-label')) {
            const text = norm(curr.getAttribute('aria-label'));
            if (text && !noise.has(text)) return text.replace(/\\s+/g, ' ').trim();
          }

          curr = curr.parentElement;
          depth += 1;
        }

        return null;
      }

      const elements = document.querySelectorAll(selectors.join(', '));
      const results = [];

      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        
        // Skip invisible/disabled elements
        if (rect.width === 0 || rect.height === 0 || el.disabled) return;
        
        // Skip Add Service result-card controls
        if (el.closest(CARD_SELECTOR)) return;

        const attrs = getAttributes(el);
        const section = getSectionName(el);

        // Collect roles
        const roles = [];
        if (attrs['role']) roles.push(attrs['role']);
        if (el.tagName.toLowerCase() === 'input' && attrs['type']) {
          roles.push(attrs['type']);
        }

        results.push({
          tag_name: el.tagName.toLowerCase(),
          roles: roles,
          attributes: attrs,
          text_content: el.textContent || "",
          bbox: [rect.x, rect.y, rect.width, rect.height],
          is_visible: true,
          section_name: section
        });
      });

      return results;
    }`;

    // page.evaluate only calls a function ref or executes an expression string.
    // Passing a string that starts with '() =>' is a function *expression* — wrap in parens and invoke.
    const rawElements = await page.evaluate(`(${script})()`).catch((err) => { throw err; });
    if (!Array.isArray(rawElements)) {
      throw new Error(`evaluate returned non-array: ${JSON.stringify(rawElements)}`);
    }

    // Process each element
    for (const raw of rawElements) {
      const sectionName = raw.section_name;
      
      // Skip "aws services" section (service selection, not form fields)
      if (typeof sectionName === 'string' && sectionName.toLowerCase().includes('aws services')) {
        continue;
      }

      if (!sectionsMap.has(sectionName)) {
        sectionsMap.set(sectionName, []);
      }

      // Create DomElement
      const element = new DomElement({
        tag_name: raw.tag_name,
        roles: raw.roles,
        attributes: raw.attributes,
        text_content: raw.text_content,
        bbox: raw.bbox,
        is_visible: raw.is_visible,
      });

      sectionsMap.get(sectionName).push(element);
    }

  } catch (error) {
    logError('explorer/scanner/dom_scanner', 'EVT-SCAN-FAIL', `Scan failed: ${error.message}`);
  }

  // Convert map to DomInventory array
  const inventories = [];
  for (const [sectionName, elements] of sectionsMap.entries()) {
    if (elements.length > 0) {
      inventories.push(new DomInventory(sectionName, elements));
    }
  }

  const totalElements = inventories.reduce((sum, inv) => sum + inv.elementCount, 0);
  logInfo('explorer/scanner/dom_scanner', 'EVT-SCAN-02', `Found ${totalElements} elements in ${inventories.length} sections`);

  return inventories;
}

/**
 * Find inventory matching a section name.
 * Matches Python's _find_inventory_for_section.
 * 
 * @param {DomInventory[]} inventories
 * @param {string} sectionName
 * @returns {DomInventory|null}
 */
export function findInventoryForSection(inventories, sectionName) {
  const target = sectionKey(sectionName);
  if (!target) return null;

  // Direct match
  for (const inv of inventories) {
    if (sectionKey(inv.section_name) === target) {
      return inv;
    }
  }

  // Best match by token overlap
  let best = null;
  let bestScore = 0;

  for (const inv of inventories) {
    const candidateName = normalizeText(inv.section_name || '');
    if (!candidateName) continue;

    const candKey = sectionKey(candidateName);
    if (!candKey) continue;

    let score;
    if (target.includes(candKey) || candKey.includes(target)) {
      score = 100 + candKey.length;
    } else {
      score = tokenOverlap(sectionName, candidateName);
    }

    if (score > bestScore) {
      bestScore = score;
      best = inv;
    }
  }

  return bestScore > 0 ? best : null;
}

// ─── Helper functions (imported from utils to avoid circular deps) ───────────

/**
 * Get section key for matching.
 * @param {string|null} text
 * @returns {string}
 */
function sectionKey(text) {
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
function tokenOverlap(a, b) {
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
 * Get total element count across inventories.
 * @param {DomInventory[]} inventories
 * @returns {number}
 */
export function totalElements(inventories) {
  return inventories.reduce((sum, inv) => sum + inv.elementCount, 0);
}

/**
 * Get element attributes via browser evaluation.
 * @param {import('playwright').ElementHandle} el
 * @returns {Promise<object>}
 */
async function getElementAttributes(el) {
  try {
    const attrs = await el.evaluate(`(element) => {
      const attrDict = {};
      for (const attr of element.attributes) {
        attrDict[attr.name] = attr.value;
      }
      return attrDict;
    }`);
    return typeof attrs === 'object' && attrs !== null ? attrs : {};
  } catch (error) {
    logError('explorer/scanner/dom_scanner', 'EVT-ATTR-FAIL', `Failed to get attributes: ${error.message}`);
    return {};
  }
}

/**
 * Check if element is inside a table - for instance table detection.
 * @param {import('playwright').ElementHandle} el
 * @returns {Promise<boolean>}
 */
async function isInsideTable(el) {
  try {
    const insideTable = await el.evaluate((element) => {
      let node = element.parentElement;
      let depth = 0;
      while (node && depth < 10) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'table' || node.getAttribute('role') === 'table' || node.getAttribute('role') === 'grid') {
          // Check if table looks like instance table
          const text = (node.textContent || '').toLowerCase();
          if (text.includes('vcpu') || text.includes('memory') || text.includes('hourly cost') || text.includes('on-demand')) {
            return true;
          }
        }
        node = node.parentElement;
        depth += 1;
      }
      return false;
    });
    return insideTable;
  } catch {
    return false;
  }
}

/**
 * Resolve dimension from DOM element with complete metadata.
 * Matches Python's resolve_dimension_from_dom with Priority 2 enhancements.
 *
 * @param {import('playwright').Page} page
 * @param {DomElement} domElem
 * @param {string|null} sectionName
 * @returns {Promise<object>}
 */
export async function resolveDimensionFromDom(page, domElem, sectionName) {
  // Find element via bounding box
  const [x, y] = domElem.bbox;
  let el = null;

  try {
    const handle = await page.evaluateHandle(`document.elementFromPoint(${x + 2}, ${y + 2})`);
    el = handle.asElement();
  } catch (error) {
    // Fallback failed
  }

  let label = domElem.attributes['aria-label'] || UNKNOWN;
  let labelSource = domElem.attributes['aria-label'] ? 'aria_label' : 'none';

  if (el) {
    const attrs = await getElementAttributes(el);
    const [resolvedLabel, source] = await resolveLabel(page, el, attrs);
    label = resolvedLabel;
    labelSource = source.replace(/^dom_/, ''); // Convert dom_aria_label -> aria_label, etc.
  }

  const cssSelector = deriveCssSelector(domElem.tag_name, domElem.attributes);
  const fieldType = deriveDomFieldType(domElem);

  // Extract aws_aria_label from attributes
  const awsAriaLabel = domElem.attributes['aria-label'] || label;

  // Priority 2: Add field_box (bounding box)
  let fieldBox = domElem.bbox;
  if (el) {
    const box = await inferFieldBox(el);
    if (box) {
      fieldBox = [box.x, box.y, box.width, box.height];
    }
  }

  // Priority 2: Add unit inference
  let unit = null;
  if (el) {
    unit = await inferUnit(el);
  }

  // Priority 2: Add unit_sibling detection (VALUE+UNIT pair)
  let unitSibling = null;
  if (el && fieldType === 'NUMBER') {
    unitSibling = await inferUnitSibling(page, el, label);
  }

  // Priority 2: Add pattern_type classification
  const insideTable = el ? await isInsideTable(el) : false;
  const patternType = getPatternType(fieldType, domElem.attributes['role'], domElem.tag_name, insideTable);

  // Priority 2: Add semantic_role inference
  const semanticRole = inferSemanticRole(label, fieldType);

  // Priority 4: Capture options during scan for SELECT/RADIO/COMBOBOX
  let options = [];
  if (el && ['SELECT', 'RADIO', 'RADIO_GROUP', 'COMBOBOX'].includes(fieldType)) {
    options = await captureOptionsDuringScan(page, el, fieldType);
  }

  return {
    key: label,
    field_type: fieldType,
    css_selector: cssSelector,
    fallback_label: label,
    aws_aria_label: awsAriaLabel,
    label_source: labelSource,
    options: options,
    unit: unit,
    unit_sibling: unitSibling,
    required: true,
    default_value: null,
    section: sectionName,
    notes: `label_source=${labelSource}`,
    field_box: fieldBox,
    pattern_type: patternType,
    role: domElem.attributes['role'] || null,
    tag: domElem.tag_name,
    semantic_role: semanticRole,
  };
}

/**
 * Derive field type from DOM element.
 * Matches Python's _derive_dom_field_type.
 *
 * @param {DomElement} domElem
 * @returns {string}
 */
export function deriveDomFieldType(domElem) {
  const tag = domElem.tag_name.toLowerCase();
  const type = domElem.attributes['type']?.toLowerCase();
  const role = domElem.attributes['role']?.toLowerCase();

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
}

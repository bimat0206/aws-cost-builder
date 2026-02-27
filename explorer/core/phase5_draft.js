/**
 * Phase 5: build draft catalog payload.
 *
 * @module explorer/core/phase5_draft
 */

import { UNKNOWN } from '../constants.js';
import { normalizeText, slugifyServiceId } from '../utils.js';

/**
 * Geo keywords for detecting geographic section patterns - matches Python's GEO_KEYWORDS.
 */
const GEO_KEYWORDS = [
  'United States',
  'US ',
  'Canada',
  'Asia Pacific',
  'Europe',
  'Africa',
  'Middle East',
  'South America',
  'Australia',
  'India',
  'Japan',
  'Global',
];

function nowIso() {
  return new Date().toISOString();
}

function buildSearchKeywords(serviceQuery, cardTitle, pageTitle) {
  const keywords = [];
  for (const candidate of [serviceQuery, cardTitle, pageTitle]) {
    const text = normalizeText(candidate || '');
    if (text && !keywords.includes(text)) {
      keywords.push(text);
    }
  }

  // Add tokens from service query
  for (const token of serviceQuery.split(/[^A-Za-z0-9]+/)) {
    const t = token.trim();
    if (t.length >= 3 && !keywords.includes(t)) {
      keywords.push(t);
    }
  }

  return keywords.slice(0, 10);
}

/**
 * Extract geo-template sections - matches Python's _extract_geo_sections.
 * @param {Array} dimensions
 * @returns {[Array, object|null]}
 */
function extractGeoSections(dimensions) {
  // Group by section
  const bySection = new Map();
  for (const dim of dimensions) {
    const sec = dim.section;
    if (sec && sec !== UNKNOWN) {
      if (!bySection.has(sec)) {
        bySection.set(sec, []);
      }
      bySection.get(sec).push(dim);
    }
  }

  if (bySection.size < 2) {
    return [dimensions, null];
  }

  // Signature: tuple of (key, field_type) for each dimension in the section
  function getSignature(dims) {
    return dims.map((d) => `${d.key || ''}|${d.field_type || ''}`).join('||');
  }

  const signatures = new Map();
  for (const [sec, dims] of bySection.entries()) {
    // Check if section looks geographic
    const isGeo = GEO_KEYWORDS.some((g) => sec.toLowerCase().includes(g.toLowerCase())) ||
      sec.includes('('); // e.g., "(N. Virginia)"

    if (isGeo) {
      const sig = getSignature(dims);
      if (!signatures.has(sig)) {
        signatures.set(sig, []);
      }
      signatures.get(sig).push(sec);
    }
  }

  // Find the largest group of identical geo sections
  let bestSig = null;
  let bestSecs = [];
  for (const [sig, secs] of signatures.entries()) {
    if (secs.length > bestSecs.length) {
      bestSecs = secs;
      bestSig = sig;
    }
  }

  if (bestSecs.length >= 2) {
    // We found a geo template!
    const geoSections = {
      template_dimensions: [],
      regions: [],
    };

    // Take the dimensions from the first matching section as the template
    const firstSec = bestSecs[0];
    const templateDims = bySection.get(firstSec).map((d) => ({ ...d }));
    for (const td of templateDims) {
      delete td.section;
      delete td.discovered_in_state;
    }
    geoSections.template_dimensions = templateDims;

    for (const sec of bestSecs) {
      // Create a simple safe key
      const safeKey = sec.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').slice(0, 15);
      geoSections.regions.push({
        key: safeKey || 'region',
        label: sec,
        aws_section_heading: sec,
      });
    }

    // Remove these dimensions from the main list
    const remainingDimensions = dimensions.filter((d) => !bestSecs.includes(d.section));
    return [remainingDimensions, geoSections];
  }

  return [dimensions, null];
}

function sectionKeyFromLabel(label, used) {
  let key = normalizeText(label || 'unknown').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!key) key = 'unknown_section';

  let out = key.slice(0, 60);
  let idx = 2;
  while (used.has(out)) {
    out = `${key}_${idx}`.slice(0, 60);
    idx += 1;
  }
  used.add(out);
  return out;
}

function stateSortValue(id) {
  if (typeof id !== 'string' || !id.startsWith('S')) return Number.MAX_SAFE_INTEGER;
  const parsed = Number.parseInt(id.slice(1), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/**
 * Build sections from dimensions - matches Python's _build_sections.
 * @param {Array} dimensions
 * @param {Array} explorationStates
 * @returns {Array}
 */
function buildSections(dimensions, explorationStates) {
  // Group by section field, preserve insertion order
  const sectionBuckets = new Map();
  for (const dim of dimensions) {
    let sectionLabel = dim.section;
    // Handle UNKNOWN and empty sections
    if (!sectionLabel || sectionLabel === UNKNOWN) {
      sectionLabel = 'UNKNOWN';
    }

    if (!sectionBuckets.has(sectionLabel)) {
      sectionBuckets.set(sectionLabel, []);
    }
    sectionBuckets.get(sectionLabel).push(dim);
  }

  // Build output sections
  const sectionsOutput = [];
  const usedKeys = new Set();

  for (const [sectionLabel, dims] of sectionBuckets.entries()) {
    // Derive state_id and entered_via per section
    const stateIds = dims
      .map((dim) => dim.discovered_in_state)
      .filter(Boolean);

    // Use the lowest-numbered state ID
    let stateId = 'S0';
    if (stateIds.length > 0) {
      stateIds.sort((a, b) => stateSortValue(a) - stateSortValue(b));
      stateId = stateIds[0];
    }

    // Look up entered_via from exploration_states
    let enteredVia = { gate_control: null, action: null, from_state: null };
    const stateEntry = (explorationStates || []).find((state) => state.state_id === stateId);
    if (stateEntry) {
      enteredVia = stateEntry.entered_via || enteredVia;
    }

    // Derive a stable key from the section label
    let sectionKey;
    if (sectionLabel === 'UNKNOWN') {
      sectionKey = 'unknown_section';
    } else {
      sectionKey = sectionKeyFromLabel(sectionLabel, new Set());
    }

    // Handle duplicates by appending _2, _3, etc.
    if (usedKeys.has(sectionKey)) {
      let counter = 2;
      while (usedKeys.has(`${sectionKey}_${counter}`)) {
        counter += 1;
      }
      sectionKey = `${sectionKey}_${counter}`;
    }
    usedKeys.add(sectionKey);

    // Set schema properties and strip internal tracking keys
    const cleanedDims = dims.map((dim) => {
      const dimCopy = { ...dim };
      
      // Preserve the raw visible text via fallback_label
      dimCopy.label_visible = dimCopy.fallback_label || dimCopy.key;
      dimCopy.aws_aria_label = dimCopy.aws_aria_label || dimCopy.key;
      
      // Remove internal tracking fields
      delete dimCopy.section;
      delete dimCopy.discovered_in_state;
      
      // Ensure confidence and status are present
      if (!dimCopy.confidence) {
        dimCopy.confidence = {
          label: dimCopy.label_source === 'aria_label' || dimCopy.label_source === 'aria_labelledby' ? 1.0 : 0.5,
          section: dimCopy.section && dimCopy.section !== UNKNOWN ? 0.8 : 0.0,
          overall: 0.6,
        };
      }
      if (!dimCopy.status) {
        dimCopy.status = dimCopy.confidence.overall >= 0.75 ? 'OK' : 'REVIEW_REQUIRED';
      }
      
      // Preserve new metadata fields
      const result = {
        key: dimCopy.key,
        label_visible: dimCopy.label_visible,
        aws_aria_label: dimCopy.aws_aria_label,
        field_type: dimCopy.field_type,
        default_value: dimCopy.default_value,
        unit_sibling: dimCopy.unit_sibling,
        options: dimCopy.options,
        required: dimCopy.required,
        confidence: dimCopy.confidence,
        status: dimCopy.status,
      };
      
      // Add optional fields if present
      if (dimCopy.unit) result.unit = dimCopy.unit;
      if (dimCopy.pattern_type) result.pattern_type = dimCopy.pattern_type;
      if (dimCopy.semantic_role) result.semantic_role = dimCopy.semantic_role;
      if (dimCopy.row_fields) result.row_fields = dimCopy.row_fields;
      if (dimCopy.add_button_label) result.add_button_label = dimCopy.add_button_label;
      if (dimCopy.review_note) result.review_note = dimCopy.review_note;
      
      return result;
    });

    // Output shape per section object
    const sectionObj = {
      key: sectionKey,
      label: sectionLabel,
      state_id: stateId,
      entered_via: enteredVia,
      dimensions: cleanedDims,
    };

    sectionsOutput.push(sectionObj);
  }

  return sectionsOutput;
}

/**
 * Execute phase 5 - matches Python's phase5_generate_draft.
 *
 * @param {string} serviceQuery
 * @param {{card_title?: string, configure_button?: string}} cardData
 * @param {{calculator_page_title?: string, supported_regions?: string[], selected_region_default?: string|null}} context
 * @param {Array<{label: string, trigger: string}>} discoveredSections
 * @param {object[]} dimensions
 * @param {{ activatedToggles?: string[], gateControls?: object[], explorationStates?: object[], explorationBudgetHit?: boolean, serviceCode?: string, uiServiceLabel?: string }} [opts]
 * @returns {object}
 */
export function phase5GenerateDraft(
  serviceQuery,
  cardData,
  context,
  discoveredSections,
  dimensions,
  opts = {},
) {
  const {
    activatedToggles = [],
    gateControls = [],
    explorationStates = [],
    explorationBudgetHit = false,
    serviceCode = '',
    uiServiceLabel = '',
  } = opts;

  // Add generated_at timestamp
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const pageTitle = context?.calculator_page_title || cardData?.card_title || serviceQuery;
  const cardTitle = cardData?.card_title || pageTitle || serviceQuery;
  const serviceId = slugifyServiceId(cardTitle || serviceQuery);

  const uiMapping = {
    search_keywords: buildSearchKeywords(serviceQuery, cardTitle, pageTitle),
    card_title: cardTitle,
    configure_button: cardData?.configure_button || 'Configure',
  };

  // Filter gate_controls to match draft schema
  const cleanGates = (gateControls || []).map((gc) => ({
    key: gc.key,
    aws_aria_label: gc.aws_aria_label,
    gate_type: gc.gate_type,
    default_state: gc.default_state ?? null,
    availability: gc.availability || 'visible',
    sections_gated: gc.sections_gated || [],
  }));

  // Extract geo-template dimensions before building standard sections
  const [remainingDimensions, geoSections] = extractGeoSections(dimensions || []);

  // Build sections
  const sections = buildSections(remainingDimensions, explorationStates);

  const draft = {
    service_id: serviceId,
    service_code: serviceCode || UNKNOWN,
    ui_service_label: uiServiceLabel || cardTitle,
    schema_version: '2.0',
    generated_at: generatedAt,
    source: 'explorer_hybrid_v1',
    region_used: normalizeText(context?.selected_region_default || '') || UNKNOWN,
    ui_mapping: uiMapping,
    gate_controls: cleanGates,
    sections,
  };

  // Add geo_sections if found
  if (geoSections) {
    draft.geo_sections = geoSections;
  }

  // Add exploration metadata
  const explorationMeta = {};
  if (activatedToggles.length > 0) {
    explorationMeta.activated_toggles = activatedToggles;
  }
  if (explorationStates.length > 0) {
    explorationMeta.exploration_states = explorationStates;
  }
  if (explorationBudgetHit) {
    explorationMeta.exploration_budget_hit = true;
  }

  if (Object.keys(explorationMeta).length > 0) {
    draft.exploration_meta = explorationMeta;
  }

  return draft;
}

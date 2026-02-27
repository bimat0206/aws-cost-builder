/**
 * Draft promoter (Mode D).
 *
 * Loads staged drafts from config/data/services/generated/, runs quality gates,
 * guides interactive cleanup, then writes validated catalog to
 * config/data/services/<service_id>.json.
 *
 * @module explorer/draft/draft_promoter
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import * as readline from 'node:readline';
import { slugifyServiceId, cleanLabel, normalizeText } from '../utils.js';

/**
 * @param {string} question
 * @param {string} [defaultAnswer]
 * @returns {Promise<string>}
 */
async function prompt(question, defaultAnswer = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const suffix = defaultAnswer ? ` [${defaultAnswer}]` : '';
    rl.question(`${question}${suffix} `, (answer) => {
      rl.close();
      const value = answer.trim();
      resolve(value || defaultAnswer);
    });
  });
}

/**
 * @param {string} question
 * @param {boolean} defaultValue
 * @returns {Promise<boolean>}
 */
async function confirm(question, defaultValue = false) {
  const raw = await prompt(`${question} ${defaultValue ? '[Y/n]' : '[y/N]'}`);
  if (!raw) return defaultValue;
  const value = raw.toLowerCase();
  return value === 'y' || value === 'yes';
}

/**
 * @param {object} draft
 * @returns {any[]}
 */
function flattenDimensions(draft) {
  if (Array.isArray(draft?.dimensions)) {
    return draft.dimensions.map((dim) => ({ ...dim }));
  }

  if (!Array.isArray(draft?.sections)) {
    return [];
  }

  const out = [];
  for (const section of draft.sections) {
    for (const dim of section.dimensions || []) {
      out.push({
        ...dim,
        section: section.label || dim.section || 'UNKNOWN',
      });
    }
  }

  return out;
}

/**
 * @param {any[]} dimensions
 * @param {{ sectionAware: boolean, stage: string }} params
 */
function evaluateDimensionCaptureQuality(dimensions, params) {
  const { sectionAware, stage } = params;
  const total = dimensions.length;
  const failures = [];
  const warnings = [];

  if (total === 0) {
    failures.push('No dimensions were captured.');
    return {
      stage,
      metrics: { total_dimensions: 0 },
      failures,
      warnings,
      passed: false,
    };
  }

  const unknownCount = dimensions.filter((dim) => String(dim.field_type || '').toUpperCase() === 'UNKNOWN').length;
  const sectionlessCount = sectionAware
    ? dimensions.filter((dim) => !normalizeText(dim.section || '')).length
    : 0;
  const requiredSelectWithoutOptions = dimensions.filter((dim) => {
    const type = String(dim.field_type || '').toUpperCase();
    return ['SELECT', 'COMBOBOX', 'RADIO'].includes(type) && (dim.required ?? true) && !(dim.options || []).length;
  }).length;

  const seen = new Map();
  let duplicateCount = 0;
  for (const dim of dimensions) {
    const signature = `${normalizeText(dim.key || dim.fallback_label || '')}|${sectionAware ? normalizeText(dim.section || '') : ''}`;
    if (seen.has(signature)) duplicateCount += 1;
    seen.set(signature, true);
  }

  const unknownRatio = unknownCount / total;
  const duplicateRatio = duplicateCount / total;
  const sectionlessRatio = sectionAware ? sectionlessCount / total : 0;

  if (unknownRatio > 0.35) {
    failures.push(`UNKNOWN field_type ratio too high (${unknownCount}/${total}).`);
  } else if (unknownRatio > 0.2) {
    warnings.push(`UNKNOWN field_type ratio elevated (${unknownCount}/${total}).`);
  }

  if (duplicateRatio > 0.25) {
    failures.push(`Duplicate dimension ratio too high (${duplicateCount}/${total}).`);
  } else if (duplicateRatio > 0.12) {
    warnings.push(`Duplicate dimension ratio elevated (${duplicateCount}/${total}).`);
  }

  if (sectionAware) {
    if (sectionlessRatio > 0.4) {
      failures.push(`Sectionless dimension ratio too high (${sectionlessCount}/${total}).`);
    } else if (sectionlessRatio > 0.2) {
      warnings.push(`Sectionless dimension ratio elevated (${sectionlessCount}/${total}).`);
    }
  }

  if (requiredSelectWithoutOptions > 0) {
    failures.push(`${requiredSelectWithoutOptions} required SELECT-like dimensions have no options.`);
  }

  return {
    stage,
    metrics: {
      total_dimensions: total,
      unknown_count: unknownCount,
      duplicate_count: duplicateCount,
      sectionless_count: sectionlessCount,
      required_select_without_options: requiredSelectWithoutOptions,
      unknown_ratio: Number(unknownRatio.toFixed(4)),
      duplicate_ratio: Number(duplicateRatio.toFixed(4)),
      sectionless_ratio: Number(sectionlessRatio.toFixed(4)),
    },
    failures,
    warnings,
    passed: failures.length === 0,
  };
}

/**
 * @param {ReturnType<typeof evaluateDimensionCaptureQuality>} quality
 */
function printQualityReport(quality) {
  console.log(`\n[Quality Gate: ${quality.stage}]`);
  console.log(`- total_dimensions: ${quality.metrics.total_dimensions}`);
  console.log(`- unknown_count: ${quality.metrics.unknown_count ?? 0}`);
  console.log(`- duplicate_count: ${quality.metrics.duplicate_count ?? 0}`);
  console.log(`- required_select_without_options: ${quality.metrics.required_select_without_options ?? 0}`);

  if (quality.warnings.length > 0) {
    console.log('- warnings:');
    for (const warning of quality.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (quality.failures.length > 0) {
    console.log('- failures:');
    for (const failure of quality.failures) {
      console.log(`  - ${failure}`);
    }
  }
}

/**
 * @param {any[]} dimensions
 * @returns {Promise<any[]>}
 */
async function interactiveReviewDimensions(dimensions) {
  const reviewed = [];

  for (const dim of dimensions) {
    const reviewNeeded =
      dim.status === 'REVIEW_REQUIRED' ||
      dim.status === 'CONFLICT' ||
      dim.confidence_scores?.review_required ||
      String(dim.field_type || '').toUpperCase() === 'UNKNOWN' ||
      normalizeText(dim.key || dim.fallback_label || '') === 'unknown';

    if (!reviewNeeded) {
      reviewed.push(dim);
      continue;
    }

    console.log('\nDimension requires review:');
    console.log(`- section: ${dim.section || 'UNKNOWN'}`);
    console.log(`- key: ${dim.key || dim.fallback_label || 'UNKNOWN'}`);
    console.log(`- field_type: ${dim.field_type || 'UNKNOWN'}`);
    console.log(`- selector: ${dim.css_selector || 'UNKNOWN'}`);

    console.log('Actions: 1) Keep  2) Edit label  3) Edit type  4) Skip');
    const action = await prompt('Select action [1-4]', '1');

    if (action === '4') {
      continue;
    }

    const next = { ...dim };

    if (action === '2') {
      const updated = await prompt('New label', next.key || next.fallback_label || '');
      const cleaned = cleanLabel(updated || '') || 'UNKNOWN';
      next.key = cleaned;
      next.fallback_label = cleaned;
      next.label_visible = cleaned;
      next.aws_aria_label = cleaned;
    }

    if (action === '3') {
      console.log('Supported types: NUMBER, TEXT, SELECT, COMBOBOX, TOGGLE, RADIO');
      const updatedType = await prompt('New field type', next.field_type || 'TEXT');
      next.field_type = String(updatedType || 'TEXT').toUpperCase();
    }

    if (next.status === 'CONFLICT') {
      next.status = 'REVIEW_REQUIRED';
    }

    reviewed.push(next);
  }

  return reviewed;
}

/**
 * @param {string} serviceId
 * @param {object} draft
 * @param {any[]} dimensions
 * @returns {object}
 */
function buildPromotedCatalog(serviceId, draft, dimensions) {
  return {
    service_name: draft.service_name || serviceId,
    search_term: draft.search_term || draft.service_name || serviceId,
    calculator_page_title: draft.calculator_page_title || draft.service_name || serviceId,
    supported_regions: Array.isArray(draft.supported_regions) ? draft.supported_regions : [],
    dimensions: dimensions.map((dim) => ({
      key: dim.key || dim.fallback_label || 'UNKNOWN',
      field_type: String(dim.field_type || 'TEXT').toUpperCase(),
      default_value: dim.default_value ?? null,
      required: dim.required ?? true,
      options: Array.isArray(dim.options) && dim.options.length > 0 ? dim.options : null,
      unit: dim.unit ?? null,
      unit_sibling: dim.unit_sibling ?? null,
    })),
  };
}

/**
 * Promote a draft by service id.
 *
 * @param {string} rawServiceId
 * @param {string} rootDir
 * @returns {Promise<string|null>} Promoted catalog path or null when cancelled
 */
export async function promoteDraft(rawServiceId, rootDir) {
  const serviceId = slugifyServiceId(rawServiceId);
  const draftPath = join(rootDir, 'config', 'data', 'services', 'generated', `${serviceId}_draft.json`);

  const content = await readFile(draftPath, 'utf-8');
  const draft = JSON.parse(content);

  console.log(`\n=== Promote Draft: ${serviceId} ===`);
  const rawDimensions = flattenDimensions(draft);
  console.log(`- Loaded dimensions: ${rawDimensions.length}`);

  const rawQuality = evaluateDimensionCaptureQuality(rawDimensions, {
    stage: 'raw_capture',
    sectionAware: true,
  });
  printQualityReport(rawQuality);

  if (!rawQuality.passed) {
    const proceed = await confirm('Raw capture quality gates failed. Continue to interactive cleanup?', true);
    if (!proceed) {
      console.log('Promotion cancelled.');
      return null;
    }
  }

  const reviewedDimensions = await interactiveReviewDimensions(rawDimensions);
  if (reviewedDimensions.length === 0) {
    console.log('No dimensions remain after review. Promotion cancelled.');
    return null;
  }

  const strictQuality = evaluateDimensionCaptureQuality(reviewedDimensions, {
    stage: 'catalog_ready',
    sectionAware: false,
  });
  printQualityReport(strictQuality);

  if (!strictQuality.passed) {
    const override = await confirm('Catalog-ready quality gates failed. Override and write anyway?', false);
    if (!override) {
      console.log('Promotion cancelled.');
      return null;
    }
  }

  const productionPath = join(rootDir, 'config', 'data', 'services', `${serviceId}.json`);
  await mkdir(dirname(productionPath), { recursive: true });

  const output = buildPromotedCatalog(serviceId, draft, reviewedDimensions);
  await writeFile(productionPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\nPromoted draft to ${productionPath}`);
  return productionPath;
}

/**
 * Interactive wrapper for Mode D promoter.
 *
 * @param {string} rootDir
 * @returns {Promise<string|null>}
 */
export async function runDraftPromoter(rootDir) {
  console.log('\n=== Draft Promoter (Mode D) ===\n');
  const serviceId = await prompt('Enter draft service ID to promote (without _draft.json)');
  if (!serviceId) {
    console.log('Service ID is required.');
    return null;
  }

  return promoteDraft(serviceId, rootDir);
}

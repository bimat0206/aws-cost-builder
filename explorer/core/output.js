/**
 * Explorer output helpers for report, review notes, and screenshots.
 *
 * @module explorer/core/output
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeText } from '../utils.js';

function safeSlug(value) {
  const slug = normalizeText(value || 'unknown').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug || 'unknown';
}

/**
 * Print exploration summary for CLI output in table format.
 *
 * @param {object[]} sections
 * @param {object[]} dimensions
 * @param {object} stateTracker
 */
export function printExplorationSummary(sections, dimensions, stateTracker) {
  console.log('\n  ═══════════════════════════════════════════════════════════');
  console.log('  [explore] EXPLORATION COMPLETE');
  console.log('  ═══════════════════════════════════════════════════════════');
  
  console.log(`\n  [explore] States discovered: ${stateTracker.states?.length || 0}`);
  console.log(`  [explore] Total fields captured: ${dimensions?.length || 0}`);
  console.log(`  [explore] Toggles activated: ${stateTracker.activated_toggles?.length || 0}`);
  console.log(`  [explore] Budget hit: ${stateTracker.budget_hit ? '⚠ YES (some states skipped)' : '✓ NO'}`);
  
  console.log('\n  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ EXPLORATION SUMMARY: SECTIONS → FIELDS → TYPE → OPTIONS → SELECTOR                                                │');
  console.log('  └────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘\n');
  
  // Group dimensions by section
  const sectionMap = new Map();
  for (const dim of (dimensions || [])) {
    const section = dim.section || 'UNKNOWN';
    if (!sectionMap.has(section)) {
      sectionMap.set(section, []);
    }
    sectionMap.get(section).push(dim);
  }
  
  // Print each section
  for (const [sectionName, sectionDims] of sectionMap.entries()) {
    console.log(`  📁 ${sectionName}`);
    console.log('  ┌─────┬──────────────────────────────────────────────────────────┬──────────────┬─────────────┬───────────────────────────────────────────────────┐');
    console.log('  │ #   │ Field                                                    │ Type         │ Options     │ Selector                                          │');
    console.log('  ├─────┼──────────────────────────────────────────────────────────┼──────────────┼─────────────┼───────────────────────────────────────────────────┤');
    
    sectionDims.forEach((dim, idx) => {
      const num = String(idx + 1).padStart(3);
      const fieldType = dim.field_type || 'UNKNOWN';
      const selector = dim.css_selector || 'UNKNOWN';
      const optionsCount = dim.options?.length || 0;
      const optionsPreview = optionsCount > 0 
        ? `${optionsCount}: ${dim.options.slice(0, 2).join(', ')}${optionsCount > 2 ? '...' : ''}`
        : '-';
      const unitInfo = dim.unit ? ` (${dim.unit})` : '';
      const unitSiblingInfo = dim.unit_sibling ? ` [UNIT]` : '';
      const repeatableInfo = dim.pattern_type === 'P6_REPEATABLE_ROW' ? ` [REPEATABLE]` : '';
      const typeStr = `${fieldType}${unitInfo}${unitSiblingInfo}${repeatableInfo}`.padEnd(12);
      
      // Truncate long values
      const fieldText = (dim.key || dim.fallback_label || 'UNKNOWN');
      const truncatedField = fieldText.length > 56 ? fieldText.slice(0, 53) + '...' : fieldText;
      const truncatedSelector = selector.length > 57 ? selector.slice(0, 54) + '...' : selector;
      const truncatedOptions = optionsPreview.length > 11 ? optionsPreview.slice(0, 8) + '...' : optionsPreview;
      
      console.log(`  │ ${num} │ ${truncatedField.padEnd(56)} │ ${typeStr} │ ${truncatedOptions.padEnd(11)} │ ${truncatedSelector.padEnd(57)} │`);
    });
    
    console.log('  └─────┴──────────────────────────────────────────────────────────┴──────────────┴─────────────┴───────────────────────────────────────────────────┘\n');
  }
  
  console.log('  Legend: [UNIT] = has unit_sibling, [REPEATABLE] = repeatable row section\n');
}

/**
 * Summarize dimensions for CLI output.
 *
 * @param {object[]} dimensions
 * @returns {{ total: number, confident: number, unknown: number }}
 */
export function summarizeDimensions(dimensions) {
  const total = (dimensions || []).length;
  const confident = (dimensions || []).filter((dim) => (dim.confidence_scores?.overall_confidence || 0) >= 0.8).length;
  const unknown = (dimensions || []).filter((dim) => String(dim.field_type || '').toUpperCase() === 'UNKNOWN').length;
  return { total, confident, unknown };
}

/**
 * Capture one screenshot per discovered state.
 *
 * @param {import('playwright').Page} page
 * @param {string} screenshotsDir
 * @param {object[]} states
 * @returns {Promise<Record<string, string>>}
 */
export async function takeStateScreenshots(page, screenshotsDir, states, replaySequence = null) {
  await mkdir(screenshotsDir, { recursive: true });

  const mapping = {};
  for (const state of states || []) {
    if (replaySequence) {
      await replaySequence(state.sequence || []);
    }
    const stateId = state.state_id || 'S0';
    const gate = state.entered_via?.gate_control || 'base';
    const filename = `${stateId}_${safeSlug(gate)}.png`;
    const targetPath = join(screenshotsDir, filename);

    await page
      .screenshot({ path: targetPath, fullPage: true })
      .then(() => {
        mapping[stateId] = `screenshots/${filename}`;
      })
      .catch(() => {});
  }

  return mapping;
}

function mapStateFields(dimensionsByState, stateId) {
  return (dimensionsByState.get(stateId) || []).map((dim) => ({
    aws_aria_label: dim.aws_aria_label || dim.key || dim.fallback_label || 'UNKNOWN',
    label_visible: dim.label_visible || dim.fallback_label || dim.key || 'UNKNOWN',
    field_type: dim.field_type,
    section_heading: dim.section || 'UNKNOWN',
    css_selector: dim.css_selector,
    default_value: dim.default_value,
    options: dim.options || [],
    status: dim.status || (dim.confidence_scores?.review_required ? 'REVIEW_REQUIRED' : 'OK'),
    confidence: dim.confidence_scores?.overall_confidence ?? null,
    review_note: dim.review_note || null,
  }));
}

/**
 * Write exploration_report.json in state-aware shape.
 *
 * @param {string} outputPath
 * @param {{ service_id: string, calculator_page_title?: string, region_used?: string }} draft
 * @param {{ states?: object[], gate_controls_status?: object[], budget_hit?: boolean }} stateTracker
 * @param {object[]} dimensions
 * @param {Record<string, string>} screenshotMap
 * @returns {Promise<string>}
 */
export async function writeExplorationReport(
  outputPath,
  draft,
  stateTracker,
  dimensions,
  screenshotMap,
) {
  const states = stateTracker?.states || [];

  const dimensionsByState = new Map();
  for (const dim of dimensions || []) {
    const stateId = dim.discovered_in_state || 'S0';
    if (!dimensionsByState.has(stateId)) {
      dimensionsByState.set(stateId, []);
    }
    dimensionsByState.get(stateId).push(dim);
  }

  const report = {
    service_id: draft.service_id,
    explored_at: new Date().toISOString(),
    region_used: draft.region_used || 'UNKNOWN',
    calculator_page_title: draft.calculator_page_title || draft.service_name || 'UNKNOWN',
    total_states: states.length,
    budget_hit: Boolean(stateTracker?.budget_hit),
    gate_controls: stateTracker?.gate_controls_status || [],
    states: states.map((state) => {
      const stateId = state.state_id || 'S0';
      return {
        state_id: stateId,
        entered_via: state.entered_via || { gate_control: null, action: null, from_state: null },
        fingerprint: state.fingerprint || null,
        screenshot_path: screenshotMap[stateId] || null,
        fields: mapStateFields(dimensionsByState, stateId),
      };
    }),
  };

  await mkdir(dirname(outputPath), { recursive: true }).catch(() => {});
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  return outputPath;
}

/**
 * Write REVIEW_NOTES.md for REVIEW_REQUIRED and CONFLICT items.
 *
 * @param {string} outputPath
 * @param {string} serviceId
 * @param {object[]} dimensions
 * @param {boolean} budgetHit
 * @returns {Promise<string>}
 */
export async function writeReviewNotes(outputPath, serviceId, dimensions, budgetHit) {
  const conflictItems = (dimensions || []).filter((dim) => dim.status === 'CONFLICT');
  const reviewItems = (dimensions || []).filter(
    (dim) => dim.status === 'REVIEW_REQUIRED' || dim.confidence_scores?.review_required,
  );

  const lines = [];
  lines.push(`# Review Notes - ${serviceId}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Fields Requiring Review');
  lines.push('');

  lines.push('### CONFLICT Items');
  lines.push('');
  if (conflictItems.length === 0) {
    lines.push('- None');
  } else {
    for (const item of conflictItems) {
      lines.push(
        `- [ ] ${item.section || 'UNKNOWN'} :: ${item.aws_aria_label || item.key || item.fallback_label || 'UNKNOWN'} (${item.field_type || 'UNKNOWN'})`,
      );
      if (item.review_note) {
        lines.push(`  note: ${item.review_note}`);
      }
    }
  }

  lines.push('');
  lines.push('### REVIEW_REQUIRED Items');
  lines.push('');
  if (reviewItems.length === 0) {
    lines.push('- None');
  } else {
    for (const item of reviewItems) {
      lines.push(
        `- [ ] ${item.section || 'UNKNOWN'} :: ${item.aws_aria_label || item.key || item.fallback_label || 'UNKNOWN'} (${item.field_type || 'UNKNOWN'})`,
      );
      if (item.review_note) {
        lines.push(`  note: ${item.review_note}`);
      }
    }
  }

  if (budgetHit) {
    lines.push('');
    lines.push('- [ ] Budget was hit (`budget_hit: true`). Some states may have been skipped.');
  }

  await mkdir(dirname(outputPath), { recursive: true }).catch(() => {});
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf-8');
  return outputPath;
}

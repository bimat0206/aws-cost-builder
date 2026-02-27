/**
 * Draft artifact writer.
 *
 * Writes explorer draft output only to:
 * - config/data/services/generated/<service_id>_draft.json
 * - artifacts/<service_id>/exploration_report.json
 * - artifacts/<service_id>/REVIEW_NOTES.md
 * - artifacts/<service_id>/screenshots/*.png
 *
 * NEVER writes to config/data/services/<service_id>.json.
 *
 * @module explorer/draft/draft_writer
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { slugifyServiceId } from '../utils.js';
import { takeStateScreenshots } from '../core/output.js';

/**
 * Resolve explorer output paths.
 *
 * @param {string} rawServiceId
 * @param {string} baseDir
 * @returns {{
 *   serviceId: string,
 *   draftPath: string,
 *   reportPath: string,
 *   reviewNotesPath: string,
 *   screenshotsDir: string,
 *   forbiddenValidatedCatalogPath: string,
 * }}
 */
export function resolveExplorerOutputPaths(rawServiceId, baseDir) {
  const serviceId = slugifyServiceId(rawServiceId);
  const servicesRoot = resolve(baseDir, 'config', 'data', 'services');
  const generatedRoot = resolve(servicesRoot, 'generated');
  const artifactsRoot = resolve(baseDir, 'artifacts');

  return {
    serviceId,
    draftPath: join(generatedRoot, `${serviceId}_draft.json`),
    reportPath: join(artifactsRoot, serviceId, 'exploration_report.json'),
    reviewNotesPath: join(artifactsRoot, serviceId, 'REVIEW_NOTES.md'),
    screenshotsDir: join(artifactsRoot, serviceId, 'screenshots'),
    forbiddenValidatedCatalogPath: join(servicesRoot, `${serviceId}.json`),
  };
}

/**
 * @param {any[]} sections
 * @returns {any[]}
 */
function flattenSectionDimensions(sections) {
  const out = [];
  for (const section of sections || []) {
    for (const dim of section.dimensions || []) {
      out.push({
        ...dim,
        section: section.label || dim.section || 'UNKNOWN',
        discovered_in_state: section.state_id || dim.discovered_in_state || 'S0',
      });
    }
  }
  return out;
}

/**
 * Normalize draft payload while preserving richer phased fields when available.
 *
 * @param {string} serviceId
 * @param {object} draft
 * @returns {object}
 */
function normalizeDraftPayload(serviceId, draft) {
  const dimensions = Array.isArray(draft?.dimensions)
    ? draft.dimensions
    : flattenSectionDimensions(draft?.sections || []);

  return {
    service_id: serviceId,
    service_name: draft?.service_name || draft?.calculator_page_title || serviceId,
    search_term: draft?.search_term || draft?.service_name || serviceId,
    calculator_page_title: draft?.calculator_page_title || draft?.service_name || serviceId,
    supported_regions: Array.isArray(draft?.supported_regions) ? draft.supported_regions : [],
    schema_version: draft?.schema_version || '2.0',
    generated_at: draft?.generated_at || new Date().toISOString(),
    source: draft?.source || 'explorer_dom_v2',
    region_used: draft?.region_used || 'UNKNOWN',
    status: draft?.status || 'draft',
    ui_mapping: draft?.ui_mapping || {},
    section_expansion_triggers: Array.isArray(draft?.section_expansion_triggers)
      ? draft.section_expansion_triggers
      : [],
    gate_controls: Array.isArray(draft?.gate_controls) ? draft.gate_controls : [],
    sections: Array.isArray(draft?.sections) ? draft.sections : [],
    dimensions,
    exploration_meta: draft?.exploration_meta || undefined,
  };
}

/**
 * Write draft catalog JSON.
 *
 * @param {string} serviceId
 * @param {object} draft
 * @param {string} baseDir
 * @returns {Promise<string>}
 */
export async function writeDraftCatalog(serviceId, draft, baseDir) {
  const paths = resolveExplorerOutputPaths(serviceId, baseDir);
  await mkdir(dirname(paths.draftPath), { recursive: true });

  const payload = normalizeDraftPayload(paths.serviceId, draft || {});
  await writeFile(paths.draftPath, JSON.stringify(payload, null, 2), 'utf-8');
  return paths.draftPath;
}

/**
 * Build a state-aware exploration report.
 *
 * @param {string} serviceId
 * @param {object} report
 * @returns {object}
 */
function normalizeReportPayload(serviceId, report) {
  if (report?.states && report?.service_id) {
    return {
      ...report,
      service_id: report.service_id || serviceId,
      explored_at: report.explored_at || new Date().toISOString(),
    };
  }

  return {
    service_id: serviceId,
    explored_at: new Date().toISOString(),
    region_used: report?.region_used || 'UNKNOWN',
    calculator_page_title: report?.calculator_page_title || serviceId,
    total_states: Array.isArray(report?.states) ? report.states.length : 0,
    budget_hit: Boolean(report?.budget_hit),
    gate_controls: report?.gate_controls || [],
    states: Array.isArray(report?.states) ? report.states : [],
    summary: {
      total_fields: report?.fields?.length || report?.dimensions?.length || 0,
      conflicts_count: report?.conflicts?.length || 0,
    },
    fields: report?.fields || report?.dimensions || [],
    conflicts: report?.conflicts || [],
  };
}

/**
 * Write exploration report.
 *
 * @param {string} serviceId
 * @param {object} report
 * @param {string} baseDir
 * @returns {Promise<string>}
 */
export async function writeExplorationReport(serviceId, report, baseDir) {
  const paths = resolveExplorerOutputPaths(serviceId, baseDir);
  await mkdir(dirname(paths.reportPath), { recursive: true });

  const payload = normalizeReportPayload(paths.serviceId, report || {});
  await writeFile(paths.reportPath, JSON.stringify(payload, null, 2), 'utf-8');
  return paths.reportPath;
}

/**
 * @param {object} report
 * @returns {any[]}
 */
function getReportDimensions(report) {
  if (Array.isArray(report?.dimensions)) return report.dimensions;
  if (Array.isArray(report?.fields)) return report.fields;
  if (Array.isArray(report?.states)) {
    return report.states.flatMap((state) => state.fields || []);
  }
  return [];
}

/**
 * Write REVIEW_NOTES.md.
 *
 * @param {string} serviceId
 * @param {object} report
 * @param {string} baseDir
 * @returns {Promise<string>}
 */
export async function writeReviewNotes(serviceId, report, baseDir) {
  const paths = resolveExplorerOutputPaths(serviceId, baseDir);
  await mkdir(dirname(paths.reviewNotesPath), { recursive: true });

  const dimensions = getReportDimensions(report);
  const conflicts = dimensions.filter((dim) => dim.status === 'CONFLICT');
  const reviewRequired = dimensions.filter(
    (dim) => dim.status === 'REVIEW_REQUIRED' || dim.confidence_scores?.review_required,
  );

  const lines = [];
  lines.push(`# Review Notes for ${paths.serviceId}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Total Fields: ${dimensions.length}`);
  lines.push(`CONFLICT: ${conflicts.length}`);
  lines.push(`REVIEW_REQUIRED: ${reviewRequired.length}`);
  lines.push('');
  lines.push('## CONFLICT Items');
  lines.push('');
  if (conflicts.length === 0) {
    lines.push('- None');
  } else {
    for (const item of conflicts) {
      lines.push(`- [ ] ${(item.section || item.section_heading || 'UNKNOWN')} :: ${(item.aws_aria_label || item.key || item.label_visible || 'UNKNOWN')} (${item.field_type || 'UNKNOWN'})`);
      if (item.review_note) {
        lines.push(`  note: ${item.review_note}`);
      }
    }
  }

  lines.push('');
  lines.push('## REVIEW_REQUIRED Items');
  lines.push('');
  if (reviewRequired.length === 0) {
    lines.push('- None');
  } else {
    for (const item of reviewRequired) {
      lines.push(`- [ ] ${(item.section || item.section_heading || 'UNKNOWN')} :: ${(item.aws_aria_label || item.key || item.label_visible || 'UNKNOWN')} (${item.field_type || 'UNKNOWN'})`);
      if (item.review_note) {
        lines.push(`  note: ${item.review_note}`);
      }
    }
  }

  if (report?.budget_hit) {
    lines.push('');
    lines.push('- [ ] Budget was hit (`budget_hit: true`). Some states may have been skipped.');
  }

  await writeFile(paths.reviewNotesPath, `${lines.join('\n')}\n`, 'utf-8');
  return paths.reviewNotesPath;
}

/**
 * Check whether a draft exists.
 *
 * @param {string} serviceId
 * @param {string} baseDir
 * @returns {Promise<boolean>}
 */
export async function draftExists(serviceId, baseDir) {
  const paths = resolveExplorerOutputPaths(serviceId, baseDir);
  try {
    await readFile(paths.draftPath, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a draft JSON payload.
 *
 * @param {string} serviceId
 * @param {string} baseDir
 * @returns {Promise<object|null>}
 */
export async function loadDraft(serviceId, baseDir) {
  const paths = resolveExplorerOutputPaths(serviceId, baseDir);
  try {
    return JSON.parse(await readFile(paths.draftPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Convenience writer for all draft artifacts.
 *
 * @param {object} draft
 * @param {{ states?: object[], gate_controls_status?: object[], budget_hit?: boolean }} stateTracker
 * @param {string} baseDir
 * @param {{ page?: import('playwright').Page }} [runtime]
 * @returns {Promise<{ catalogPath: string, reportPath: string, notesPath: string, screenshotsDir: string }>} 
 */
export async function writeAllDraftArtifacts(draft, stateTracker, baseDir, runtime = {}) {
  const serviceId = draft?.service_id || draft?.service_name || 'unknown_service';
  const paths = resolveExplorerOutputPaths(serviceId, baseDir);

  await mkdir(dirname(paths.draftPath), { recursive: true });
  await mkdir(dirname(paths.reportPath), { recursive: true });
  await mkdir(dirname(paths.reviewNotesPath), { recursive: true });
  await mkdir(paths.screenshotsDir, { recursive: true });

  const normalizedDraft = normalizeDraftPayload(paths.serviceId, draft || {});
  const dimensions = normalizedDraft.dimensions || [];

  let screenshotMap = {};
  const replaySequence = typeof runtime.replaySequence === 'function' ? runtime.replaySequence : null;
  if (runtime.page && Array.isArray(stateTracker?.states) && stateTracker.states.length > 0) {
    screenshotMap = await takeStateScreenshots(
      runtime.page,
      paths.screenshotsDir,
      stateTracker.states,
      replaySequence,
    );
  }

  const dimensionsByState = new Map();
  for (const dim of dimensions) {
    const stateId = dim.discovered_in_state || 'S0';
    if (!dimensionsByState.has(stateId)) {
      dimensionsByState.set(stateId, []);
    }
    dimensionsByState.get(stateId).push(dim);
  }

  const states = (stateTracker?.states || []).map((state) => {
    const stateId = state.state_id || 'S0';
    return {
      state_id: stateId,
      entered_via: state.entered_via || { gate_control: null, action: null, from_state: null },
      fingerprint: state.fingerprint || null,
      screenshot_path: screenshotMap[stateId] || null,
      fields: (dimensionsByState.get(stateId) || []).map((dim) => ({
        ...dim,
        section_heading: dim.section || 'UNKNOWN',
      })),
    };
  });

  const report = {
    service_id: paths.serviceId,
    explored_at: new Date().toISOString(),
    region_used: normalizedDraft.region_used || 'UNKNOWN',
    calculator_page_title: normalizedDraft.calculator_page_title,
    total_states: states.length,
    budget_hit: Boolean(stateTracker?.budget_hit),
    gate_controls: stateTracker?.gate_controls_status || [],
    states,
    dimensions,
    fields: dimensions,
    conflicts: dimensions.filter((dim) => dim.status === 'CONFLICT'),
  };

  const catalogPath = await writeDraftCatalog(paths.serviceId, normalizedDraft, baseDir);
  const reportPath = await writeExplorationReport(paths.serviceId, report, baseDir);
  const notesPath = await writeReviewNotes(paths.serviceId, report, baseDir);

  return {
    catalogPath,
    reportPath,
    notesPath,
    screenshotsDir: paths.screenshotsDir,
  };
}

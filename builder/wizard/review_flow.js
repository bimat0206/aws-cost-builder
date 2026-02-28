/**
 * Section/service/final review screens.
 *
 * Presents review tables after each section, after each service, and for the
 * final profile. Offers SelectPrompt with Continue/Redo/Edit options.
 *
 * @module builder/wizard/review_flow
 */

import { selectPrompt } from '../prompts/select_prompt.js';
import { DiamondHeader, Breadcrumb } from '../layout/components.js';
import {
  COL_ORANGE, COL_YELLOW, COL_GREEN, COL_MUTED, COL_DIM, COL_BASE,
  COL_BG_ROW,
} from '../layout/colors.js';
import { fg, bold, dim, visibleLength, padEnd, bg } from '../layout/components.js';
import { groupDimensionsIntoSections } from './section_flow.js';

// ─── Section-membership helper ────────────────────────────────────────────────

/**
 * Build a map of dimension key → section name from a service catalog.
 *
 * Uses the same three-tier grouping as `groupDimensionsIntoSections`.
 *
 * @param {object} serviceCatalog
 * @returns {Map<string, string>}
 */
function buildSectionMap(serviceCatalog) {
  const sections = groupDimensionsIntoSections(serviceCatalog);
  const map = new Map();
  for (const sec of sections) {
    for (const dim of sec.dimensions) {
      map.set(dim.key, sec.name);
    }
  }
  return map;
}

// ─── Table rendering helpers ──────────────────────────────────────────────────

/**
 * Render a review table row.
 * @param {string[]} cells - Cell contents
 * @param {number[]} widths - Column widths
 * @returns {string}
 */
function renderTableRow(cells, widths) {
  const padded = cells.map((cell, i) => padEnd(cell, widths[i]));
  return padded.join(' │ ');
}

/**
 * Render a table separator line.
 * @param {number[]} widths - Column widths
 * @returns {string}
 */
function renderTableSeparator(widths) {
  const segments = widths.map(w => '─'.repeat(w));
  return segments.join('┼');
}

/**
 * Render a review table.
 * @param {string[]} headers - Header labels
 * @param {string[][]} rows - Data rows
 * @param {number} maxWidth - Maximum table width
 * @returns {string}
 */
function renderReviewTable(headers, rows, maxWidth = 80) {
  if (headers.length === 0) {
    return '';
  }

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxCellWidth = Math.max(
      visibleLength(h),
      ...rows.map(row => visibleLength(row[i] || ''))
    );
    return Math.min(maxCellWidth + 2, Math.floor(maxWidth / headers.length));
  });

  // Build table
  const lines = [];

  // Header row
  lines.push(bold(fg(renderTableRow(headers, widths), COL_MUTED)));
  lines.push(fg(renderTableSeparator(widths), COL_DIM));

  // Data rows
  if (rows.length === 0) {
    lines.push(dim('No values captured yet.'));
  } else {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rendered = renderTableRow(row, widths);
      lines.push(idx % 2 === 1 ? bg(rendered, COL_BG_ROW) : rendered);
    }
  }

  return lines.join('\n');
}

/**
 * Format a value for display in review table.
 * @param {any} value
 * @param {string|null} unit
 * @returns {string}
 */
function formatValueForReview(value, unit = null) {
  if (value === null || value === undefined) {
    return dim('─');
  }
  const str = String(value);
  if (unit) {
    return `${fg(str, COL_GREEN)} ${fg(unit, COL_YELLOW)}`;
  }
  return fg(str, COL_GREEN);
}

// ─── Section review ───────────────────────────────────────────────────────────

/**
 * Show the post-section review table and prompt for Continue/Redo/Edit.
 *
 * When a service has multiple sections (indicated by distinct section labels
 * in `serviceCatalog`), the table adds a Section column and groups rows.
 * For single-section services the table keeps the simpler three-column layout.
 *
 * @param {object} opts
 * @param {string} opts.serviceName - Current service name
 * @param {string} opts.sectionName - Current section name (or 'All Sections')
 * @param {object} opts.sectionValues - Collected values for this section
 * @param {object} opts.serviceCatalog - Service catalog entry (for unit info)
 * @returns {Promise<'continue'|'redo'|'edit'>}
 */
export async function runSectionReview(opts) {
  const { serviceName, sectionName, sectionValues, serviceCatalog } = opts;

  const dimensions = serviceCatalog?.dimensions || [];
  const dimMap = new Map(dimensions.map(d => [d.key, d]));
  const sectionMap = buildSectionMap(serviceCatalog);

  // Determine whether we're reviewing multiple sections at once
  const uniqueSections = new Set(
    Object.keys(sectionValues).map(k => sectionMap.get(k) ?? 'General'),
  );
  const isMultiSection = uniqueSections.size > 1;

  const headers = isMultiSection
    ? ['Section', 'Field', 'Value', 'Unit']
    : ['Field', 'Value', 'Unit'];

  const rows = [];

  if (isMultiSection) {
    // Group rows by section to match the sparse display pattern
    const sections = groupDimensionsIntoSections(serviceCatalog);
    let firstInGroup = true;
    for (const sec of sections) {
      firstInGroup = true;
      for (const dimDef of sec.dimensions) {  // Fix #6: Rename to avoid shadowing dim() function
        if (!Object.prototype.hasOwnProperty.call(sectionValues, dimDef.key)) continue;
        const value = sectionValues[dimDef.key];
        const secLabel = firstInGroup
          ? bold(fg(sec.name, COL_YELLOW))
          : fg('', COL_DIM);
        rows.push([
          secLabel,
          fg(dimDef.display_name ?? dimDef.key, COL_MUTED),
          formatValueForReview(value, null),
          dimDef.unit ? fg(dimDef.unit, COL_YELLOW) : dim('─'),
        ]);
        firstInGroup = false;
      }
    }
  } else {
    for (const [key, value] of Object.entries(sectionValues)) {
      const dimension = dimMap.get(key);
      rows.push([
        fg(dimension?.display_name ?? key, COL_MUTED),
        formatValueForReview(value, null),
        dimension?.unit ? fg(dimension.unit, COL_YELLOW) : dim('─'),
      ]);
    }
  }

  // Render table
  const table = renderReviewTable(headers, rows);

  // Print review header
  const displayName = isMultiSection ? `All Sections · ${rows.length} fields answered` : `${sectionName} · ${rows.length} fields answered`;
  const header = DiamondHeader('Section Review', displayName);
  process.stdout.write(`\n${header}\n\n`);
  process.stdout.write(table);
  process.stdout.write('\n\n');

  // Prompt for action
  const action = await selectPrompt({
    label: 'What would you like to do?',
    options: [
      'Continue to next section',
      'Redo this section',
      'Edit a specific field',
    ],
    defaultValue: 'Continue to next section',
  });

  // Map to action codes
  const actionMap = {
    'Continue to next section': 'continue',
    'Redo this section': 'redo',
    'Edit a specific field': 'edit',
  };

  return actionMap[action] || 'continue';
}

// ─── Service review ───────────────────────────────────────────────────────────

/**
 * Show the post-service review table.
 *
 * Rows are grouped by their catalog section. Within each group the section
 * name appears only on the first row (sparse display), styled in COL_YELLOW
 * bold to match the mock design §5.7.
 *
 * @param {object} opts
 * @param {string} opts.groupName - Current group name
 * @param {string} opts.serviceName - Current service name
 * @param {object} opts.serviceValues - All collected values for this service
 * @param {object} opts.serviceCatalog - Service catalog entry
 * @returns {Promise<'continue'|'redo'|'edit'>}
 */
export async function runServiceReview(opts) {
  const { groupName, serviceName, serviceValues, serviceCatalog } = opts;

  const headers = ['Section', 'Field', 'Value', 'Source'];
  const rows = [];

  const sections = groupDimensionsIntoSections(serviceCatalog);
  const dimMap = new Map((serviceCatalog?.dimensions ?? []).map(d => [d.key, d]));

  for (const sec of sections) {
    let firstInGroup = true;
    for (const dim of sec.dimensions) {
      if (!Object.prototype.hasOwnProperty.call(serviceValues, dim.key)) continue;
      const value = serviceValues[dim.key];
      const source = (value === null || value === undefined)
        ? dim('skipped')
        : fg('user', COL_GREEN);

      // Section label — shown only on first row of each group (sparse)
      const secLabel = firstInGroup
        ? bold(fg(sec.name, COL_YELLOW))
        : fg('', COL_DIM);

      rows.push([
        secLabel,
        fg(dim.display_name ?? dim.key, COL_MUTED),
        formatValueForReview(value, dim.unit ?? null),
        source,
      ]);
      firstInGroup = false;
    }
  }

  // Render table
  const table = renderReviewTable(headers, rows);

  // Print review header
  const breadcrumb = Breadcrumb([`Group: ${groupName}`, `Service: ${serviceName}`]);
  const header = DiamondHeader('Service Review', `${serviceName} · ${rows.length} dimensions resolved`);
  process.stdout.write(`\n${header}\n${breadcrumb}\n\n`);
  process.stdout.write(table);
  process.stdout.write('\n\n');

  // Prompt for action
  const action = await selectPrompt({
    label: 'What would you like to do?',
    options: [
      'Save this service and continue',
      'Edit a specific field',
      'Start this service over',
    ],
    defaultValue: 'Save this service and continue',
  });

  // Map to action codes
  const actionMap = {
    'Save this service and continue': 'continue',
    'Edit a specific field': 'edit',
    'Start this service over': 'redo',
  };

  return actionMap[action] || 'continue';
}

// ─── Final review ─────────────────────────────────────────────────────────────

/**
 * Show the final profile review table.
 *
 * @param {object} opts
 * @param {object} opts.profileState - Complete profile state
 * @returns {Promise<'confirm'|'edit'>}
 */
export async function runFinalReview(opts) {
  const { profileState } = opts;

  // Build table data
  const headers = ['Group', 'Service', 'Dimension', 'Value', 'Unit'];
  const rows = [];

  const groups = profileState.groups || [];
  for (const group of groups) {
    const services = group.services || [];
    for (const service of services) {
      const dimensions = service.dimensions || {};
      for (const [dimKey, dimObj] of Object.entries(dimensions)) {
        const value = dimObj?.user_value ?? dimObj?.default_value ?? null;
        rows.push([
          fg(group.group_name, COL_MUTED),
          fg(service.service_name, COL_MUTED),
          fg(dimKey, COL_MUTED),
          formatValueForReview(value, null),
          dimObj?.unit ? fg(dimObj.unit, COL_YELLOW) : dim('─'),
        ]);
      }
    }
  }

  // Render table
  const table = renderReviewTable(headers, rows, 100);

  // Print review header
  const header = DiamondHeader('Final Profile Review', `${rows.length} fields`);
  const projectName = profileState.project_name || 'Untitled';
  const description = profileState.description ? `"${profileState.description}"` : '';

  process.stdout.write(`\n${header}\n\n`);
  process.stdout.write(bold(fg(`Project: ${projectName}`, COL_ORANGE)) + '\n');
  if (description) {
    process.stdout.write(dim(description) + '\n');
  }
  process.stdout.write('\n');
  process.stdout.write(table);
  process.stdout.write('\n\n');

  // Summary stats
  const totalDimensions = rows.length;
  const filledDimensions = rows.filter(r => {
    const plain = String(r[3]).replace(/\x1b\[[0-9;]*m/g, '');
    return plain.trim() !== '─';
  }).length;
  process.stdout.write(dim(`Total dimensions: ${filledDimensions}/${totalDimensions} filled\n\n`));

  // Prompt for action
  const action = await selectPrompt({
    label: 'Ready to save profile?',
    options: [
      'Save profile',
      'Edit a field',
      'Start over',
    ],
    defaultValue: 'Save profile',
  });

  // Map to action codes
  const actionMap = {
    'Save profile': 'confirm',
    'Edit a field': 'edit',
    'Start over': 'restart',  // Fix #7: Map to distinct 'restart' action
  };

  return actionMap[action] || 'confirm';
}

// ─── Compact summary helper (kept for backward compatibility) ─────────────────

/**
 * Render a compact review summary for display during wizard.
 * @param {object} values - Key-value pairs
 * @param {number} maxWidth - Maximum width
 * @returns {string}
 */
export function renderReviewSummary(values, maxWidth = 60) {
  const lines = [];
  let currentLine = '';

  for (const [key, value] of Object.entries(values)) {
    const entry = `${fg(key, COL_MUTED)}: ${bold(fg(String(value), COL_GREEN))}`;
    if (currentLine.length + entry.length > maxWidth) {
      lines.push(currentLine);
      currentLine = entry;
    } else {
      currentLine += (currentLine ? ', ' : '') + entry;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join('\n');
}

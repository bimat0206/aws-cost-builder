/**
 * Per-section field iteration flow.
 *
 * Orchestrates field prompts for a service section with:
 * - service prompt-policy filtering
 * - dynamic progress denominator (excludes policy-filtered dimensions)
 * - prompt dispatch by field_type
 * - optional split-screen layout integration
 *
 * ## Section grouping
 *
 * Dimensions are grouped into named sections in this priority order:
 *   1. `serviceCatalog.sections` — explicit array of `{ name, keys[] }` objects
 *   2. `dimension.section` — per-dimension section label (flat catalog variant)
 *   3. Single "General" fallback for catalogs with no section metadata
 *
 * @module builder/wizard/section_flow
 */

import { fieldPrompt } from '../prompts/field_prompt.js';
import { selectPrompt } from '../prompts/select_prompt.js';
import { compoundInputPrompt } from '../prompts/compound_input.js';
import { togglePrompt, renderPhase2Bar } from '../prompts/toggle_prompt.js';
import '../policies/ec2_policy.js';
import { getPromptPolicy } from '../policies/service_prompt_policies.js';
import { DiamondHeader, Breadcrumb, ProgBar, EventMessage, dim } from '../layout/components.js';
import { serializeToYaml, highlightYaml } from '../preview/yaml_preview.js';

// ─── Section grouping ─────────────────────────────────────────────────────────

/**
 * Build an array of sections from a service catalog.
 *
 * Returns an ordered array of `{ name: string, dimensions: object[] }`.
 *
 * Priority:
 *   1. `catalog.sections` — explicit `[{ name, keys }]` shape
 *   2. `dimension.section` label on each dimension object
 *   3. Single "General" section containing all dimensions
 *
 * @param {object} serviceCatalog
 * @returns {{ name: string, dimensions: object[] }[]}
 */
export function groupDimensionsIntoSections(serviceCatalog) {
  const all = serviceCatalog.dimensions ?? [];

  // 1. Explicit sections manifest
  if (Array.isArray(serviceCatalog.sections) && serviceCatalog.sections.length > 0) {
    const dimByKey = new Map(all.map((d) => [d.key, d]));
    return serviceCatalog.sections.map((sec) => ({
      name: sec.name ?? 'General',
      dimensions: (sec.keys ?? []).flatMap((k) => (dimByKey.has(k) ? [dimByKey.get(k)] : [])),
    })).filter((s) => s.dimensions.length > 0);
  }

  // 2. Per-dimension `section` field
  const hasSectionLabels = all.some((d) => d.section);
  if (hasSectionLabels) {
    const order = [];
    const map = new Map();
    for (const dim of all) {
      const sectionName = dim.section ?? 'General';
      if (!map.has(sectionName)) {
        map.set(sectionName, []);
        order.push(sectionName);
      }
      map.get(sectionName).push(dim);
    }
    return order.map((name) => ({ name, dimensions: map.get(name) }));
  }

  // 3. Single fallback section
  return [{ name: 'General', dimensions: all }];
}

// ─── Prompt type helpers ──────────────────────────────────────────────────────

/**
 * @param {string} fieldType
 * @returns {'field'|'select'|'compound'|'toggle'}
 */
function getPromptType(fieldType) {
  if (fieldType === 'NUMBER' || fieldType === 'TEXT') return 'field';
  if (fieldType === 'SELECT' || fieldType === 'RADIO' || fieldType === 'COMBOBOX') return 'select';
  if (fieldType === 'TOGGLE') return 'toggle';
  return 'field';
}

/**
 * @param {object} values
 * @param {string} key
 * @returns {unknown}
 */
function getResolvedValue(values, key) {
  const raw = values[key];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.user_value !== undefined && raw.user_value !== null) return raw.user_value;
    if (raw.resolved_value !== undefined && raw.resolved_value !== null) return raw.resolved_value;
    if (raw.default_value !== undefined) return raw.default_value;
  }
  return raw;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizePromptValue(value) {
  if (value === '') return null;
  return value;
}

// ─── Layout panel update ──────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.groupName
 * @param {string} opts.serviceName
 * @param {string} opts.region
 * @param {string} opts.sectionName
 * @param {string} opts.activeKey
 * @param {string} [opts.activeLabel]
 * @param {number} opts.currentIndex
 * @param {number} opts.totalFields
 * @param {number} [opts.sectionIndex]
 * @param {number} [opts.sectionTotal]
 * @param {object} opts.collectedValues
 * @param {object} [opts.layoutEngine]
 * @returns {void}
 */
function updateLayoutPanels(opts) {
  const {
    groupName,
    serviceName,
    region,
    sectionName,
    activeKey,
    activeLabel = activeKey,
    currentIndex,
    totalFields,
    sectionIndex = 1,
    sectionTotal = 1,
    collectedValues,
    layoutEngine,
  } = opts;

  if (!layoutEngine) return;

  const promptLines = [
    Breadcrumb([`Group: ${groupName}`, `Service: ${serviceName}`]),
    ProgBar(currentIndex, totalFields, { sectionCurrent: sectionIndex, sectionTotal }),
    DiamondHeader(sectionName, `Section ${sectionIndex} of ${sectionTotal} · ${Math.max(0, totalFields)} fields`),
  ];
  layoutEngine.updatePrompt(promptLines.join('\n'));

  const previewState = {
    schema_version: '2.0',
    project_name: '?',
    groups: [
      {
        group_name: groupName,
        services: [
          {
            service_name: serviceName,
            region: region ?? '?',
            dimensions: collectedValues,
          },
        ],
      },
    ],
  };
  const yamlText = serializeToYaml(previewState);
  const highlighted = highlightYaml(yamlText, activeKey);
  layoutEngine.updatePreview({
    lines: highlighted,
    footer: `${serviceName} · ${region ?? '?'}`,
  });
}

// ─── Prompt runner ────────────────────────────────────────────────────────────

/**
 * @param {object|null} layoutEngine
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
async function runPrompt(layoutEngine, fn) {
  if (!layoutEngine) return fn();
  return layoutEngine.promptWithPause(fn);
}

// ─── countPromptableDimensions (exported for tests) ──────────────────────────

/**
 * Count promptable dimensions for current state (policy-filtered excluded).
 *
 * @param {string} serviceName
 * @param {object[]} dimensions
 * @param {object} [currentValues={}]
 * @param {Set<string>} [handledKeys]
 * @returns {number}
 */
export function countPromptableDimensions(serviceName, dimensions, currentValues = {}, handledKeys = new Set()) {
  const policy = getPromptPolicy(serviceName);
  return dimensions.filter((dim) => {
    if (handledKeys.has(dim.key)) return false;
    return policy.shouldPrompt(dim.key, currentValues);
  }).length;
}

// ─── Per-dimension prompt dispatch ───────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object} opts.dimension
 * @param {object} opts.serviceCatalog
 * @param {object} opts.collectedValues
 * @param {object|null} opts.layoutEngine
 * @returns {Promise<object>}
 */
async function promptForDimension(opts) {
  const { dimension, serviceCatalog, collectedValues, layoutEngine } = opts;
  const fieldLabel = dimension.display_name ?? dimension.key;
  const fieldNote = dimension.note ?? dimension.description ?? null;
  const onHelp = layoutEngine
    ? (helpBlock) => {
      layoutEngine.printAbove(EventMessage('info', `Help: ${fieldLabel}`));
      layoutEngine.printAbove(helpBlock);
    }
    : null;
  const promptType = dimension._compound ? 'compound' : getPromptType(dimension.field_type);

  if (promptType === 'compound') {
    const sibling = serviceCatalog.dimensions.find((d) => d.key === dimension.unit_sibling);
    const acceptedUnits = sibling?.options ?? ['GB', 'TB'];
    const defaultUnit = sibling?.default_value ?? acceptedUnits[0];
    const result = await runPrompt(layoutEngine, () => compoundInputPrompt({
      label: fieldLabel,
      acceptedUnits,
      defaultUnit,
    }));
    return {
      [dimension.key]: normalizePromptValue(result.value),
      [dimension.unit_sibling]: normalizePromptValue(result.unit),
    };
  }

  if (promptType === 'field') {
    const value = await runPrompt(layoutEngine, () => fieldPrompt({
      label: fieldLabel,
      fieldType: dimension.field_type,
      defaultValue: dimension.default_value,
      unit: dimension.unit,
      required: dimension.required,
      note: fieldNote,
      onHelp,
    }));
    return { [dimension.key]: normalizePromptValue(value) };
  }

  if (promptType === 'select') {
    const options = dimension.options ?? [];
    if (options.length === 0) {
      const fallback = await runPrompt(layoutEngine, () => fieldPrompt({
        label: fieldLabel,
        fieldType: 'TEXT',
        defaultValue: dimension.default_value,
        unit: dimension.unit,
        required: dimension.required,
        note: fieldNote,
        onHelp,
      }));
      return { [dimension.key]: normalizePromptValue(fallback) };
    }
    const value = await runPrompt(layoutEngine, () => selectPrompt({
      label: fieldLabel,
      options,
      defaultValue: dimension.default_value == null ? null : String(dimension.default_value),
      descriptions: dimension.option_descriptions ?? {},
    }));
    return { [dimension.key]: normalizePromptValue(value) };
  }

  // TOGGLE
  const toggle = await runPrompt(layoutEngine, () => selectPrompt({
    label: fieldLabel,
    options: ['Yes', 'No'],
    defaultValue: dimension.default_value ? 'Yes' : 'No',
    descriptions: {
      Yes: 'Enabled',
      No: 'Disabled',
    },
  }));
  return { [dimension.key]: toggle === 'Yes' };
}

// ─── runSectionFlow ───────────────────────────────────────────────────────────

/**
 * Run the field iteration flow for a single named section.
 *
 * Accepts an explicit `dimensions` array so the caller controls which fields
 * belong to this section (from `groupDimensionsIntoSections`).
 *
 * @param {object} opts
 * @param {string} opts.groupName
 * @param {string} opts.serviceName
 * @param {object} opts.serviceCatalog
 * @param {string} opts.region
 * @param {object} [opts.layoutEngine]
 * @param {string} [opts.sectionName]        - Display label for this section
 * @param {object[]} [opts.sectionDimensions] - Dimensions to iterate (defaults to all catalog dims)
 * @param {number} [opts.sectionIndex]        - 1-based position among all sections
 * @param {number} [opts.sectionTotal]        - Total number of sections
 * @param {object} [opts.priorValues]         - Values collected in earlier sections (for policy)
 * @returns {Promise<object>}                 - Key → value map for this section
 */
export async function runSectionFlow(opts) {
  const {
    groupName,
    serviceName,
    serviceCatalog,
    region,
    layoutEngine = null,
    sectionName = 'General',
    sectionDimensions,
    sectionIndex = 1,
    sectionTotal = 1,
    priorValues = {},
  } = opts;

  const dimensions = sectionDimensions ?? (serviceCatalog.dimensions ?? []);
  const policy = getPromptPolicy(serviceName);
  const collectedValues = { ...priorValues };  // include prior for policy evaluation
  const sectionKeys = new Set(dimensions.map((d) => d.key));
  const handledKeys = new Set();
  let completedCount = 0;

  while (true) {
    let nextDim = null;
    for (const dim of dimensions) {
      if (handledKeys.has(dim.key)) continue;
      if (!policy.shouldPrompt(dim.key, collectedValues)) continue;
      nextDim = dim;
      break;
    }

    if (!nextDim) break;

    const sectionPromptable = dimensions.filter(
      (d) => !handledKeys.has(d.key) && policy.shouldPrompt(d.key, collectedValues),
    );
    const totalFields = sectionPromptable.length;
    const currentIndex = Math.min(totalFields, completedCount + 1);

    updateLayoutPanels({
      groupName,
      serviceName,
      region,
      sectionName,
      activeKey: nextDim.key,
      activeLabel: nextDim.display_name ?? nextDim.key,
      currentIndex,
      totalFields: Math.max(totalFields, currentIndex),
      sectionIndex,
      sectionTotal,
      collectedValues,
      layoutEngine,
    });

    const promptType = getPromptType(nextDim.field_type);
    const isCompound =
      nextDim.unit_sibling !== null &&
      nextDim.unit_sibling !== undefined &&
      promptType === 'field';

    const result = await promptForDimension({
      dimension: isCompound ? { ...nextDim, field_type: 'NUMBER', _compound: true } : nextDim,
      serviceCatalog,
      collectedValues,
      layoutEngine,
    });

    for (const [key, value] of Object.entries(result)) {
      collectedValues[key] = value;
      if (sectionKeys.has(key)) handledKeys.add(key);
      completedCount += 1;
    }

    if (isCompound) {
      handledKeys.add(nextDim.unit_sibling);
    } else {
      handledKeys.add(nextDim.key);
      if (result[nextDim.key] === undefined) {
        collectedValues[nextDim.key] = getResolvedValue(collectedValues, nextDim.key) ?? null;
      }
    }
  }

  // Return only this section's keys (not prior values)
  const sectionResult = {};
  for (const key of sectionKeys) {
    if (Object.prototype.hasOwnProperty.call(collectedValues, key)) {
      sectionResult[key] = collectedValues[key];
    }
  }

  if (layoutEngine) {
    layoutEngine.printAbove(EventMessage(
      'success',
      `Section '${sectionName}' completed — ${Object.keys(sectionResult).length} field(s) set`,
    ));
  }

  return sectionResult;
}

// ─── runAllSections ───────────────────────────────────────────────────────────

/**
 * Run all sections of a service catalog in order.
 *
 * Groups dimensions using `groupDimensionsIntoSections`, then calls
 * `runSectionFlow` once per section, accumulating values across all sections
 * so policy decisions in later sections can see prior answers.
 *
 * Returns a flat map of all key → value pairs from every section.
 *
 * @param {object} opts
 * @param {string} opts.groupName
 * @param {string} opts.serviceName
 * @param {object} opts.serviceCatalog
 * @param {string} opts.region
 * @param {object} [opts.layoutEngine]
 * @returns {Promise<object>} Flat key → value map for the whole service.
 */
export async function runAllSections(opts) {
  const {
    groupName,
    serviceName,
    serviceCatalog,
    region,
    layoutEngine = null,
  } = opts;

  const sections = groupDimensionsIntoSections(serviceCatalog);
  const allValues = {};

  // ── Two-phase toggle flow (e.g. S3 storage-class selector) ────────────────
  // Triggered when the catalog declares `"toggle_sections": true`.
  // Phase 1: run the toggle checklist to let the user choose which sections
  //          to configure. Required sections are always pre-enabled.
  // Phase 2: iterate only the enabled sections, rendering the Phase 2 bar
  //          before each section's field prompts.
  if (serviceCatalog.toggle_sections) {
    const sectionNames = sections.map((s) => s.name);
    const requiredSections = sections
      .filter((s) => s.dimensions.some((d) => d.required))
      .map((s) => s.name);

    // Phase 1 — let toggle_prompt handle the checklist
    const enabledNames = await (layoutEngine
      ? layoutEngine.promptWithPause(() => togglePrompt({
          sections: sectionNames,
          defaultEnabled: requiredSections,
        }))
      : togglePrompt({
          sections: sectionNames,
          defaultEnabled: requiredSections,
        }));

    if (layoutEngine) {
      layoutEngine.printAbove(EventMessage(
        'info',
        `Phase 2 — ${enabledNames.length} section(s) enabled: ${enabledNames.join(', ')}`,
      ));
    }

    // Phase 2 — iterate enabled sections with the Phase 2 bar
    const enabledSections = sections.filter((s) => enabledNames.includes(s.name));

    for (let i = 0; i < enabledSections.length; i++) {
      const section = enabledSections[i];

      // Render Phase 2 bar before entering each section
      const phase2Bar = renderPhase2Bar(enabledNames, i + 1, enabledSections.length);
      if (layoutEngine) {
        layoutEngine.printAbove(phase2Bar);
      } else {
        process.stdout.write(phase2Bar + '\n');
      }

      const sectionValues = await runSectionFlow({
        groupName,
        serviceName,
        serviceCatalog,
        region,
        layoutEngine,
        sectionName: section.name,
        sectionDimensions: section.dimensions,
        sectionIndex: i + 1,
        sectionTotal: enabledSections.length,
        priorValues: { ...allValues },
      });

      Object.assign(allValues, sectionValues);
    }

    return allValues;
  }

  // ── Standard flat iteration (no toggle) ───────────────────────────────────
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const sectionValues = await runSectionFlow({
      groupName,
      serviceName,
      serviceCatalog,
      region,
      layoutEngine,
      sectionName: section.name,
      sectionDimensions: section.dimensions,
      sectionIndex: i + 1,
      sectionTotal: sections.length,
      priorValues: { ...allValues },   // pass accumulated values for policy evaluation
    });

    Object.assign(allValues, sectionValues);
  }

  return allValues;
}

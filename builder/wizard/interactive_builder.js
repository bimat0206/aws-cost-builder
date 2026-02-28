/**
 * Mode A top-level wizard flow.
 *
 * @module builder/wizard/interactive_builder
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAllCatalogs } from '../../config/loader/index.js';
import { validateSchema, validateCrossFields } from '../../core/profile/validator.js';
import { LayoutEngine } from '../layout/layout_engine.js';
import { fieldPrompt } from '../prompts/field_prompt.js';
import { selectPrompt } from '../prompts/select_prompt.js';
import { runAllSections } from './section_flow.js';
import { runSectionReview, runServiceReview, runFinalReview } from './review_flow.js';
import { dim, DiamondHeader, Breadcrumb, ProgBar, EventMessage } from '../layout/components.js';
import { serializeToYaml, highlightYaml } from '../preview/yaml_preview.js';

/**
 * @returns {object}
 */
function createInitialProfileState() {
  return {
    schema_version: '2.0',
    project_name: null,
    description: null,
    groups: [],
  };
}

/**
 * @param {object} profileState
 * @param {string} groupName
 * @returns {object}
 */
function addGroup(profileState, groupName) {
  return {
    ...profileState,
    groups: [...profileState.groups, { group_name: groupName, services: [] }],
  };
}

/**
 * @param {object} profileState
 * @param {string} groupName
 * @param {string} serviceName
 * @param {string} region
 * @param {string} humanLabel
 * @returns {object}
 */
function addService(profileState, groupName, serviceName, region, humanLabel) {
  const groups = profileState.groups.map((group) => {
    if (group.group_name !== groupName) return group;
    return {
      ...group,
      services: [
        ...group.services,
        {
          service_name: serviceName,
          human_label: humanLabel,
          region,
          dimensions: {},
        },
      ],
    };
  });
  return { ...profileState, groups };
}

/**
 * @param {object} profileState
 * @param {string} groupName
 * @param {string} serviceName
 * @returns {object}
 */
function removeService(profileState, groupName, serviceName) {
  const groups = profileState.groups.map((group) => {
    if (group.group_name !== groupName) return group;
    return {
      ...group,
      services: group.services.filter((s) => s.service_name !== serviceName),
    };
  });
  return { ...profileState, groups };
}

/**
 * @param {unknown} value
 * @returns {string|number|boolean|null}
 */
function normalizeDimensionValue(value) {
  if (value === undefined || value === '') return null;
  return /** @type {string|number|boolean|null} */ (value);
}

/**
 * @param {object} profileState
 * @param {string} groupName
 * @param {string} serviceName
 * @param {object} dimensionValues
 * @param {object} serviceCatalog
 * @returns {object}
 */
function updateServiceDimensions(profileState, groupName, serviceName, dimensionValues, serviceCatalog) {
  const catalogByKey = new Map((serviceCatalog.dimensions ?? []).map((d) => [d.key, d]));
  const groups = profileState.groups.map((group) => {
    if (group.group_name !== groupName) return group;
    return {
      ...group,
      services: group.services.map((service) => {
        if (service.service_name !== serviceName) return service;

        const dimensions = {};
        for (const [key, rawValue] of Object.entries(dimensionValues)) {
          const dim = catalogByKey.get(key);
          const value = normalizeDimensionValue(rawValue);
          dimensions[key] = {
            user_value: value,
            default_value: dim?.default_value ?? null,
            unit: dim?.unit ?? null,
            prompt_message: null,
            required: dim?.required ?? true,
          };
        }
        return { ...service, dimensions };
      }),
    };
  });
  return { ...profileState, groups };
}

/**
 * @param {object[]} catalogs
 * @param {string[]} existingServices
 * @returns {object[]}
 */
function buildAvailableServiceCatalogs(catalogs, existingServices) {
  return catalogs.filter((catalog) => !existingServices.includes(catalog.service_name));
}

/**
 * @param {object[]} catalogs
 * @param {string[]} existingServices
 * @param {{selectPromptFn?: Function}} [deps]
 * @returns {Promise<object>}
 */
async function promptServiceSelection(catalogs, existingServices, deps = {}) {
  const { selectPromptFn = selectPrompt } = deps;
  const available = buildAvailableServiceCatalogs(catalogs, existingServices);
  if (available.length === 0) {
    throw new Error('All services from catalog are already added to this group');
  }

  const options = available.map((c) => c.service_name);
  const selected = await selectPromptFn({
    label: 'Select a service to add',
    options,
    defaultValue: options[0],
  });

  const catalog = available.find((c) => c.service_name === selected);
  if (!catalog) {
    throw new Error(`Service "${selected}" is not available in catalog selection`);
  }
  return catalog;
}

/**
 * @param {object} serviceCatalog
 * @param {object} regionMap
 * @returns {{value: string, label: string}[]}
 */
function buildRegionSelectionOptions(serviceCatalog, regionMap) {
  // `supported_regions` was scrubbed from catalogs (see ae1d52b4).
  // Fall back to the full global region map so region selection always works.
  const supported = serviceCatalog.supported_regions ?? [];
  const regionCodes = supported.length > 0
    ? supported
    : Object.keys(regionMap);

  const options = [];

  // Always list 'global' first if present
  if (regionCodes.includes('global') && Object.prototype.hasOwnProperty.call(regionMap, 'global')) {
    options.push({ value: 'global', label: `global (${regionMap['global']})` });
  }

  for (const regionCode of regionCodes) {
    if (regionCode === 'global') continue;
    if (!Object.prototype.hasOwnProperty.call(regionMap, regionCode)) continue;
    options.push({
      value: regionCode,
      label: `${regionCode} (${regionMap[regionCode]})`,
    });
  }

  return options;
}

/**
 * @param {object} serviceCatalog
 * @param {object} regionMap
 * @param {{selectPromptFn?: Function}} [deps]
 * @returns {Promise<string>}
 */
async function promptRegionSelection(serviceCatalog, regionMap, deps = {}) {
  const { selectPromptFn = selectPrompt } = deps;
  const options = buildRegionSelectionOptions(serviceCatalog, regionMap);

  if (options.length === 0) {
    throw new Error(
      `No valid regions available for service "${serviceCatalog.service_name}" in region map`,
    );
  }
  if (options.length === 1) {
    return options[0].value;
  }

  const labels = options.map((o) => o.label);
  const selectedLabel = await selectPromptFn({
    label: `Select region for ${serviceCatalog.service_name}`,
    options: labels,
    defaultValue: labels[0],
  });

  const selected = options.find((o) => o.label === selectedLabel);
  if (!selected) {
    throw new Error(`Region selection "${selectedLabel}" is invalid for ${serviceCatalog.service_name}`);
  }
  return selected.value;
}

/**
 * @param {object} profileState
 * @returns {string}
 */
function serializeProfile(profileState) {
  return JSON.stringify(profileState, null, 2);
}

/**
 * @param {object} profileState
 * @param {object[]} catalogs
 * @param {object} regionMap
 */
function validateProfile(profileState, catalogs, regionMap) {
  validateSchema(profileState);
  validateCrossFields(profileState, catalogs, regionMap);
}

/**
 * @param {string} projectName
 * @returns {string}
 */
function generateProfileFilename(projectName) {
  return projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') + '.json';
}

/**
 * @param {object} profileState
 * @returns {Promise<string>}
 */
async function writeProfile(profileState) {
  const profilesDir = join(process.cwd(), 'profiles');
  await mkdir(profilesDir, { recursive: true });
  const filePath = join(profilesDir, generateProfileFilename(profileState.project_name));
  await writeFile(filePath, serializeProfile(profileState), 'utf-8');
  return filePath;
}

class WizardCancelledError extends Error {
  constructor() {
    super('Wizard cancelled');
    this.name = 'WizardCancelledError';
  }
}

/**
 * @param {LayoutEngine|null} layoutEngine
 * @param {() => Promise<any>} promptFn
 * @returns {Promise<any>}
 */
async function runPrompt(layoutEngine, promptFn) {
  if (!layoutEngine) return promptFn();
  return layoutEngine.promptWithPause(promptFn);
}

/**
 * Update split-screen panels for a wizard step.
 *
 * @param {LayoutEngine|null} layoutEngine
 * @param {object} opts
 * @param {object} opts.profileState
 * @param {string[]} opts.promptLines
 * @param {string|null} [opts.activeKey]
 * @param {string} [opts.footer]
 */
function updateWizardPanels(layoutEngine, opts) {
  if (!layoutEngine) return;
  const {
    profileState,
    promptLines,
    activeKey = null,
    footer = '',
  } = opts;

  layoutEngine.updatePrompt(promptLines.join('\n'));
  const yamlText = serializeToYaml(profileState);
  layoutEngine.updatePreview({
    lines: highlightYaml(yamlText, activeKey),
    footer,
  });
}

/**
 * @param {object} [opts]
 * @param {LayoutEngine|null} [opts.layoutEngine]
 * @param {object[]|null} [opts.catalogs]
 * @param {object|null} [opts.regionMap]
 * @returns {Promise<object|null>}
 */
export async function runInteractiveBuilder(opts = {}) {
  const {
    layoutEngine: injectedLayout = null,
    catalogs: injectedCatalogs = null,
    regionMap: injectedRegionMap = null,
  } = opts;

  const layoutEngine = injectedLayout ?? new LayoutEngine();
  const ownsLayout = !injectedLayout;
  let profileState = createInitialProfileState(); // Changed from const to let for immutable updates
  let cancelled = false;

  const sigintHandler = () => {
    cancelled = true;
  };
  process.on('SIGINT', sigintHandler);

  try {
    if (ownsLayout) layoutEngine.start();

    const catalogs = injectedCatalogs ?? await loadAllCatalogs();
    const regionMap = injectedRegionMap
      ?? (await import('../../config/data/region_map.json', { with: { type: 'json' } })).default;

    updateWizardPanels(layoutEngine, {
      profileState,
      activeKey: 'project_name',
      promptLines: [
        DiamondHeader('Project Setup', 'Section 1 of 1 · 2 fields'),
        ProgBar(1, 2, { sectionCurrent: 1, sectionTotal: 1 }),
      ],
      footer: 'Builder · Metadata',
    });
    const projectName = await runPrompt(layoutEngine, () => fieldPrompt({
      label: 'Project Name',
      fieldType: 'TEXT',
      defaultValue: null,
      unit: null,
      required: true,
      note: 'A descriptive name for your cost estimate project',
    }));
    if (cancelled) throw new WizardCancelledError();
    profileState = { ...profileState, project_name: projectName };

    updateWizardPanels(layoutEngine, {
      profileState,
      activeKey: 'description',
      promptLines: [
        DiamondHeader('Project Setup', 'Section 1 of 1 · 2 fields'),
        ProgBar(2, 2, { sectionCurrent: 1, sectionTotal: 1 }),
      ],
      footer: 'Builder · Metadata',
    });
    const description = await runPrompt(layoutEngine, () => fieldPrompt({
      label: 'Description (optional)',
      fieldType: 'TEXT',
      defaultValue: null,
      unit: null,
      required: false,
      note: 'Brief description of what this estimate covers',
    }));
    if (cancelled) throw new WizardCancelledError();
    profileState = { ...profileState, description: description || null };

    let addMoreGroups = true;
    while (addMoreGroups) {
      const existingGroups = profileState.groups.map((g) => g.group_name);
      const groupOptions = existingGroups.length > 0
        ? [...existingGroups, 'Create new group']
        : ['Create new group'];

      updateWizardPanels(layoutEngine, {
        profileState,
        promptLines: [
          DiamondHeader('Group + Service Picker', 'Select an existing group or create a new one'),
          ProgBar(1, 3, { sectionCurrent: 1, sectionTotal: 1 }),
        ],
        footer: 'Builder · Group Selection',
      });
      const groupChoice = await runPrompt(layoutEngine, () => selectPrompt({
        label: 'Select group',
        options: groupOptions,
        defaultValue: groupOptions[0],
      }));
      if (cancelled) throw new WizardCancelledError();

      let groupName = groupChoice;
      if (groupChoice === 'Create new group') {
        updateWizardPanels(layoutEngine, {
          profileState,
          promptLines: [
            DiamondHeader('Group Setup', 'Enter a logical group name'),
            ProgBar(2, 3, { sectionCurrent: 1, sectionTotal: 1 }),
          ],
          footer: 'Builder · Group Setup',
        });
        groupName = await runPrompt(layoutEngine, () => fieldPrompt({
          label: 'New Group Name',
          fieldType: 'TEXT',
          defaultValue: null,
          unit: null,
          required: true,
          note: 'Enter a name for this group of services',
        }));
        if (cancelled) throw new WizardCancelledError();
      }

      if (!profileState.groups.find((g) => g.group_name === groupName)) {
        profileState = addGroup(profileState, groupName);
      }

      let addMoreServices = true;
      while (addMoreServices) {
        const currentGroup = profileState.groups.find((g) => g.group_name === groupName);
        const existingServices = currentGroup.services.map((s) => s.service_name);

        updateWizardPanels(layoutEngine, {
          profileState,
          promptLines: [
            Breadcrumb([`Group: ${groupName}`, 'Service: (select)']),
            DiamondHeader('Group + Service Picker', 'Choose a service from the catalog'),
            ProgBar(3, 3, { sectionCurrent: 1, sectionTotal: 1 }),
          ],
          footer: `${groupName} · Service Selection`,
        });
        const serviceCatalog = await runPrompt(layoutEngine, () =>
          promptServiceSelection(catalogs, existingServices));
        if (cancelled) throw new WizardCancelledError();

        updateWizardPanels(layoutEngine, {
          profileState,
          promptLines: [
            Breadcrumb([`Group: ${groupName}`, `Service: ${serviceCatalog.service_name}`]),
            DiamondHeader('Region Selection', 'Choose a supported region'),
            ProgBar(1, 1, { sectionCurrent: 1, sectionTotal: 1 }),
          ],
          footer: `${serviceCatalog.service_name} · Region`,
        });
        const region = await runPrompt(layoutEngine, () =>
          promptRegionSelection(serviceCatalog, regionMap));
        if (cancelled) throw new WizardCancelledError();

        profileState = addService(
          profileState,
          groupName,
          serviceCatalog.service_name,
          region,
          serviceCatalog.service_name,
        );

        let allSectionValues = null;
        while (true) {
          allSectionValues = await runAllSections({
            groupName,
            serviceName: serviceCatalog.service_name,
            serviceCatalog,
            region,
            layoutEngine,
          });
          if (cancelled) throw new WizardCancelledError();

          const sectionAction = await runPrompt(layoutEngine, () => runSectionReview({
            serviceName: serviceCatalog.service_name,
            sectionName: 'All Sections',
            sectionValues: allSectionValues,
            serviceCatalog,
          }));
          if (cancelled) throw new WizardCancelledError();

          if (sectionAction === 'redo' || sectionAction === 'edit') {
            if (layoutEngine) {
              layoutEngine.printAbove(EventMessage('warning', `Redoing all sections for '${serviceCatalog.service_name}'`));
            }
            continue;
          }
          break;
        }

        profileState = updateServiceDimensions(
          profileState,
          groupName,
          serviceCatalog.service_name,
          allSectionValues,
          serviceCatalog,
        );

        const serviceReviewAction = await runPrompt(layoutEngine, () => runServiceReview({
          groupName,
          serviceName: serviceCatalog.service_name,
          serviceValues: allSectionValues,
          serviceCatalog,
        }));
        if (cancelled) throw new WizardCancelledError();
        if (serviceReviewAction === 'redo') {
          profileState = removeService(profileState, groupName, serviceCatalog.service_name);
          if (layoutEngine) {
            layoutEngine.printAbove(EventMessage('warning', `${serviceCatalog.service_name} restarted — all values cleared`));
          }
          continue;
        }
        if (layoutEngine) {
          layoutEngine.printAbove(EventMessage(
            'success',
            `${serviceCatalog.service_name} (${region}) saved — ${Object.keys(allSectionValues).length} dimensions`,
          ));
        }

        updateWizardPanels(layoutEngine, {
          profileState,
          promptLines: [
            Breadcrumb([`Group: ${groupName}`, `Service: ${serviceCatalog.service_name}`]),
            DiamondHeader('Continue', 'Add another service to this group?'),
            ProgBar(1, 1, { sectionCurrent: 1, sectionTotal: 1 }),
          ],
          footer: `${serviceCatalog.service_name} · Continue`,
        });
        const moreServiceChoice = await runPrompt(layoutEngine, () => selectPrompt({
          label: `Add another service to "${groupName}"?`,
          options: ['Yes', 'No'],
          defaultValue: 'No',
        }));
        addMoreServices = moreServiceChoice === 'Yes';
      }

      updateWizardPanels(layoutEngine, {
        profileState,
        promptLines: [
          DiamondHeader('Continue', 'Add another group?'),
          ProgBar(1, 1, { sectionCurrent: 1, sectionTotal: 1 }),
        ],
        footer: 'Builder · Continue',
      });
      const moreGroupChoice = await runPrompt(layoutEngine, () => selectPrompt({
        label: 'Add another group?',
        options: ['Yes', 'No'],
        defaultValue: 'No',
      }));
      addMoreGroups = moreGroupChoice === 'Yes';
    }

    updateWizardPanels(layoutEngine, {
      profileState,
      promptLines: [
        DiamondHeader('Final Profile Review', 'Validate and save profile'),
        ProgBar(1, 1, { sectionCurrent: 1, sectionTotal: 1 }),
      ],
      footer: 'Builder · Final Review',
    });
    const finalAction = await runPrompt(layoutEngine, () => runFinalReview({ profileState }));
    if (cancelled) throw new WizardCancelledError();
    if (finalAction === 'restart') {
      // Full restart: clear state and re-run from top — pending implementation.
      // For now, fall through to save so the user doesn't lose their work.
      if (layoutEngine) {
        layoutEngine.printAbove(EventMessage('warning', '"Start over" is not yet implemented — saving current profile.'));
      }
    }
    if (finalAction === 'edit') {
      // Field-level edit — pending implementation.
      if (layoutEngine) {
        layoutEngine.printAbove(EventMessage('warning', '"Edit a field" is not yet implemented — saving current profile.'));
      }
    }

    validateProfile(profileState, catalogs, regionMap);
    const filePath = await writeProfile(profileState);
    if (layoutEngine) {
      layoutEngine.printAbove(EventMessage('success', `Profile written: ${filePath}`));
    }
    process.stdout.write(`\n✓ Profile saved successfully\n${dim(`Path: ${filePath}`)}\n\n`);
    return profileState;
  } catch (error) {
    if (error instanceof WizardCancelledError || cancelled) {
      process.stdout.write('\nWizard cancelled. No changes saved.\n');
      return null;
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    if (ownsLayout) {
      layoutEngine.stop();
    }
  }
}

export {
  WizardCancelledError,
  createInitialProfileState,
  addGroup,
  addService,
  updateServiceDimensions,
  buildAvailableServiceCatalogs,
  buildRegionSelectionOptions,
  promptServiceSelection,
  promptRegionSelection,
  validateProfile,
  generateProfileFilename,
  serializeProfile,
};

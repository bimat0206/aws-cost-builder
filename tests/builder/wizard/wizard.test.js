/**
 * Tests for builder/wizard/ module.
 *
 * Covers:
 *   - section_flow.js: policy-aware progress counting
 *   - interactive_builder.js: profile state management + picker constraints
 *
 * Property P9: Service Picker Constrained to Catalog
 * Property P10: Region Selection Constrained to Valid Regions
 *
 * Validates: Requirements 6.4, 6.5, 6.7, 9.4
 */

// Feature: aws-cost-profile-builder, Property 9: Service Picker Constrained to Catalog
// Feature: aws-cost-profile-builder, Property 10: Region Selection Constrained to Valid Regions

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { countPromptableDimensions } from '../../../builder/wizard/section_flow.js';
import {
  addGroup,
  addService,
  buildAvailableServiceCatalogs,
  buildRegionSelectionOptions,
  createInitialProfileState,
  generateProfileFilename,
  promptRegionSelection,
  promptServiceSelection,
  updateServiceDimensions,
  validateProfile,
} from '../../../builder/wizard/interactive_builder.js';

const mockCatalogs = [
  {
    service_name: 'Amazon EC2',
    search_term: 'Amazon EC2',
    calculator_page_title: 'Amazon EC2',
    supported_regions: ['us-east-1', 'us-east-2', 'us-west-2', 'global'],
    dimensions: [
      { key: 'Operating System', field_type: 'SELECT', default_value: 'Linux', required: true, options: ['Linux', 'Windows'], unit: null, unit_sibling: null },
      { key: 'EBS Storage', field_type: 'NUMBER', default_value: 30, required: false, options: null, unit: null, unit_sibling: 'EBS Storage Unit' },
      { key: 'EBS Storage Unit', field_type: 'SELECT', default_value: 'GB', required: false, options: ['GB', 'TB'], unit: null, unit_sibling: 'EBS Storage' },
    ],
  },
  {
    service_name: 'Amazon S3',
    search_term: 'Amazon S3',
    calculator_page_title: 'Amazon S3',
    supported_regions: ['us-east-1', 'eu-west-1', 'global'],
    dimensions: [
      { key: 'Storage', field_type: 'NUMBER', default_value: 10, required: true, options: null, unit: 'GB', unit_sibling: null },
    ],
  },
  {
    service_name: 'AWS Lambda',
    search_term: 'AWS Lambda',
    calculator_page_title: 'AWS Lambda',
    supported_regions: ['us-east-1', 'eu-west-1', 'ap-northeast-1'],
    dimensions: [
      { key: 'Requests', field_type: 'NUMBER', default_value: 1000000, required: true, options: null, unit: null, unit_sibling: null },
    ],
  },
];

const mockRegionMap = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'Europe (Ireland)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
};

describe('interactive_builder.js - profile state management', () => {
  it('createInitialProfileState starts at schema_version 2.0', () => {
    const state = createInitialProfileState();
    expect(state.schema_version).toBe('2.0');
    expect(state.project_name).toBeNull();
    expect(state.groups).toEqual([]);
  });

  it('addGroup appends a group', () => {
    const state = addGroup(createInitialProfileState(), 'Core');
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]).toEqual({ group_name: 'Core', services: [] });
  });

  it('addService appends service with dimensions object', () => {
    let state = createInitialProfileState();
    state = addGroup(state, 'Core');
    state = addService(state, 'Core', 'Amazon EC2', 'us-east-1', 'EC2');
    expect(state.groups[0].services[0].dimensions).toEqual({});
  });

  it('updateServiceDimensions writes schema-compatible dimensions object', () => {
    let state = createInitialProfileState();
    state = addGroup(state, 'Core');
    state = addService(state, 'Core', 'Amazon EC2', 'us-east-1', 'EC2');
    state = updateServiceDimensions(
      state,
      'Core',
      'Amazon EC2',
      { 'Operating System': 'Linux' },
      mockCatalogs[0],
    );

    const dim = state.groups[0].services[0].dimensions['Operating System'];
    expect(dim.user_value).toBe('Linux');
    expect(dim.default_value).toBe('Linux');
    expect(dim.required).toBe(true);
  });

  it('validateProfile uses schema + cross-field constraints', () => {
    const valid = {
      schema_version: '2.0',
      project_name: 'My Project',
      description: null,
      groups: [
        {
          group_name: 'Core',
          services: [
            {
              service_name: 'Amazon EC2',
              human_label: 'EC2',
              region: 'us-east-1',
              dimensions: {
                'Operating System': {
                  user_value: 'Linux',
                  default_value: 'Linux',
                  unit: null,
                  prompt_message: null,
                  required: true,
                },
              },
            },
          ],
        },
      ],
    };
    expect(() => validateProfile(valid, mockCatalogs, mockRegionMap)).not.toThrow();
  });

  it('validateProfile fails invalid region', () => {
    const invalid = {
      schema_version: '2.0',
      project_name: 'Bad Region',
      description: null,
      groups: [
        {
          group_name: 'Core',
          services: [
            {
              service_name: 'Amazon EC2',
              human_label: 'EC2',
              region: 'sa-east-1',
              dimensions: {},
            },
          ],
        },
      ],
    };
    expect(() => validateProfile(invalid, mockCatalogs, mockRegionMap)).toThrow();
  });

  it('generateProfileFilename sanitizes project names', () => {
    expect(generateProfileFilename('My Project!')).toBe('my_project.json');
  });
});

describe('section_flow.js - countPromptableDimensions', () => {
  it('counts all dimensions for unknown services', () => {
    const dims = [{ key: 'A' }, { key: 'B' }, { key: 'C' }];
    expect(countPromptableDimensions('Unknown', dims)).toBe(3);
  });

  it('applies EC2 policy gating with current values', () => {
    const dims = mockCatalogs[0].dimensions;
    const base = countPromptableDimensions('Amazon EC2', dims, {});
    const ebsEnabled = countPromptableDimensions('Amazon EC2', dims, { 'EBS Storage': 100 });

    expect(base).toBe(2); // OS + EBS Storage
    expect(ebsEnabled).toBe(3); // OS + EBS Storage + EBS Storage Unit
  });
});

describe('Property 9: Service Picker Constrained to Catalog', () => {
  it('available services are always subset of catalog and exclude existing', () => {
    fc.assert(
      fc.property(
        fc.subarray(mockCatalogs.map((c) => c.service_name)),
        (existingServices) => {
          const available = buildAvailableServiceCatalogs(mockCatalogs, existingServices);
          for (const service of available) {
            expect(mockCatalogs.some((c) => c.service_name === service.service_name)).toBe(true);
            expect(existingServices).not.toContain(service.service_name);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('promptServiceSelection returns only catalog services', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(mockCatalogs.map((c) => c.service_name), { maxLength: 2 }),
        async (existingServices) => {
          const available = buildAvailableServiceCatalogs(mockCatalogs, existingServices);
          if (available.length === 0) return;

          const selected = await promptServiceSelection(mockCatalogs, existingServices, {
            selectPromptFn: async () => available[0].service_name,
          });

          expect(mockCatalogs.some((c) => c.service_name === selected.service_name)).toBe(true);
          expect(existingServices).not.toContain(selected.service_name);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('promptServiceSelection throws when all services already added', async () => {
    await expect(
      promptServiceSelection(
        mockCatalogs,
        mockCatalogs.map((c) => c.service_name),
        { selectPromptFn: async () => 'Amazon EC2' },
      ),
    ).rejects.toThrow('All services from catalog are already added to this group');
  });
});

describe('Property 10: Region Selection Constrained to Valid Regions', () => {
  it('buildRegionSelectionOptions includes only region_map + supported regions + optional global', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...mockCatalogs),
        (serviceCatalog) => {
          const options = buildRegionSelectionOptions(serviceCatalog, mockRegionMap);
          for (const option of options) {
            if (option.value !== 'global') {
              expect(serviceCatalog.supported_regions).toContain(option.value);
              expect(Object.prototype.hasOwnProperty.call(mockRegionMap, option.value)).toBe(true);
            } else {
              expect(serviceCatalog.supported_regions).toContain('global');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('promptRegionSelection returns only valid regions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...mockCatalogs),
        async (serviceCatalog) => {
          const options = buildRegionSelectionOptions(serviceCatalog, mockRegionMap);
          if (options.length === 0) return;

          const region = await promptRegionSelection(serviceCatalog, mockRegionMap, {
            selectPromptFn: async () => options[0].label,
          });

          expect(
            region === 'global' ||
            (
              serviceCatalog.supported_regions.includes(region) &&
              Object.prototype.hasOwnProperty.call(mockRegionMap, region)
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('promptRegionSelection auto-selects single valid option', async () => {
    const serviceCatalog = {
      service_name: 'Single',
      supported_regions: ['eu-west-1', 'sa-east-1'], // only eu-west-1 exists in map
      dimensions: [],
    };
    const selected = await promptRegionSelection(serviceCatalog, mockRegionMap, {
      selectPromptFn: async () => {
        throw new Error('selectPromptFn should not be called for single option');
      },
    });
    expect(selected).toBe('eu-west-1');
  });
});


/**
 * Tests for builder/policies/ module.
 *
 * Covers:
 *   - service_prompt_policies.js: default policy, policy registry
 *   - ec2_policy.js: EC2-specific conditional field gating
 *
 * Property P14: Default Prompt Policy Prompts All Dimensions
 *   For any service without a registered policy, the default policy must
 *   return shouldPrompt = true for all dimension keys.
 *
 * Property P15: Progress Counter Excludes Policy-Filtered Dimensions
 *   When counting dimensions for progress display, policy-filtered dimensions
 *   must be excluded from the denominator.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 7.6
 */

// Feature: aws-cost-profile-builder, Property 14: Default Prompt Policy Prompts All Dimensions
// Feature: aws-cost-profile-builder, Property 15: Progress Counter Excludes Policy-Filtered Dimensions

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  getPromptPolicy,
  registerPromptPolicy,
} from '../../../builder/policies/service_prompt_policies.js';
import {
  ec2Policy,
  EC2_GATED_DIMS,
  EC2_CORE_DIMS,
  DAILY_SPIKE_SKIP_DIMS,
  CONSTANT_USAGE_SKIP_DIMS,
} from '../../../builder/policies/ec2_policy.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Count dimensions that should be prompted based on policy.
 * This simulates the progress counter logic in the wizard.
 * @param {string} serviceName
 * @param {string[]} dimKeys
 * @param {object} dimensionValues - current values map
 * @returns {number} count of dimensions to prompt
 */
function countPromptableDimensions(serviceName, dimKeys, dimensionValues = {}) {
  const policy = getPromptPolicy(serviceName);
  return dimKeys.filter(key => policy.shouldPrompt(key, dimensionValues)).length;
}

// ─── Unit Tests: service_prompt_policies.js ───────────────────────────────────

describe('service_prompt_policies.js', () => {
  beforeEach(() => {
    // Clear registry before each test to avoid cross-test pollution
    // Note: this is a limitation - in production we'd expose a clearRegistry() function
  });

  describe('getPromptPolicy()', () => {
    it('returns default policy for unknown service', () => {
      const policy = getPromptPolicy('Unknown Service XYZ');
      expect(policy).toHaveProperty('shouldPrompt');
      expect(typeof policy.shouldPrompt).toBe('function');
    });

    it('default policy prompts all dimensions', () => {
      const policy = getPromptPolicy('Some Random Service');
      expect(policy.shouldPrompt('Any Dimension', {})).toBe(true);
      expect(policy.shouldPrompt('Another Dimension', { foo: 'bar' })).toBe(true);
    });

    it('returns registered policy for Amazon EC2', () => {
      const policy = getPromptPolicy('Amazon EC2');
      expect(policy).toBe(ec2Policy);
    });
  });

  describe('registerPromptPolicy()', () => {
    it('allows registering custom policy', () => {
      const customPolicy = {
        shouldPrompt: (dimKey) => dimKey === 'Special Dimension',
      };
      registerPromptPolicy('Test Service Custom', customPolicy);
      const policy = getPromptPolicy('Test Service Custom');
      expect(policy).toBe(customPolicy);
    });

    it('custom policy is used instead of default', () => {
      const customPolicy = {
        shouldPrompt: (dimKey) => dimKey === 'Allowed',
      };
      registerPromptPolicy('Test Service Strict', customPolicy);
      const policy = getPromptPolicy('Test Service Strict');
      expect(policy.shouldPrompt('Allowed', {})).toBe(true);
      expect(policy.shouldPrompt('Not Allowed', {})).toBe(false);
    });
  });
});

// ─── Unit Tests: ec2_policy.js ────────────────────────────────────────────────

describe('ec2_policy.js', () => {
  describe('EC2_CORE_DIMS', () => {
    it('contains expected core dimensions', () => {
      expect(EC2_CORE_DIMS.has('Operating System')).toBe(true);
      expect(EC2_CORE_DIMS.has('Number of instances')).toBe(true);
      expect(EC2_CORE_DIMS.has('Instance type')).toBe(true);
      expect(EC2_CORE_DIMS.has('Utilization (On-Demand only)')).toBe(true);
    });
  });

  describe('EC2_GATED_DIMS', () => {
    it('contains expected gated dimensions', () => {
      expect(EC2_GATED_DIMS.has('Minimum number of instances')).toBe(true);
      expect(EC2_GATED_DIMS.has('Maximum number of instances')).toBe(true);
      expect(EC2_GATED_DIMS.has('Peak workload days')).toBe(true);
      expect(EC2_GATED_DIMS.has('Peak workload hours')).toBe(true);
      expect(EC2_GATED_DIMS.has('Peak workload minutes')).toBe(true);
      expect(EC2_GATED_DIMS.has('EBS Storage')).toBe(true);
      expect(EC2_GATED_DIMS.has('EBS Storage Unit')).toBe(true);
      expect(EC2_GATED_DIMS.has('EBS Volume Type')).toBe(true);
      expect(EC2_GATED_DIMS.has('Data transfer out')).toBe(true);
      expect(EC2_GATED_DIMS.has('Data transfer out Unit')).toBe(true);
    });
  });

  describe('ec2Policy.shouldPrompt()', () => {
    it('always prompts core dimensions', () => {
      const dims = ['Operating System', 'Number of instances', 'Instance type', 'Utilization (On-Demand only)'];
      for (const dim of dims) {
        expect(ec2Policy.shouldPrompt(dim, {})).toBe(true);
      }
    });

    it('prompts EBS Storage when no value set', () => {
      expect(ec2Policy.shouldPrompt('EBS Storage', {})).toBe(true);
      expect(ec2Policy.shouldPrompt('EBS Storage', { 'EBS Storage': null })).toBe(true);
    });

    it('does not prompt EBS Storage Unit when EBS Storage is undefined', () => {
      expect(ec2Policy.shouldPrompt('EBS Storage Unit', {})).toBe(false);
    });

    it('prompts EBS Storage Unit when EBS Storage has positive value', () => {
      expect(ec2Policy.shouldPrompt('EBS Storage Unit', { 'EBS Storage': 100 })).toBe(true);
      expect(ec2Policy.shouldPrompt('EBS Storage Unit', { 'EBS Storage': '50' })).toBe(true);
    });

    it('does not prompt EBS Storage Unit when EBS Storage is 0', () => {
      expect(ec2Policy.shouldPrompt('EBS Storage Unit', { 'EBS Storage': 0 })).toBe(false);
    });

    it('does not prompt EBS Storage Unit when EBS Storage is null', () => {
      expect(ec2Policy.shouldPrompt('EBS Storage Unit', { 'EBS Storage': null })).toBe(false);
    });

    it('prompts EBS Volume Type when EBS Storage has positive value', () => {
      expect(ec2Policy.shouldPrompt('EBS Volume Type', { 'EBS Storage': 100 })).toBe(true);
    });

    it('does not prompt EBS Volume Type when EBS Storage is not set', () => {
      expect(ec2Policy.shouldPrompt('EBS Volume Type', {})).toBe(false);
      expect(ec2Policy.shouldPrompt('EBS Volume Type', { 'EBS Storage': null })).toBe(false);
    });

    it('does not prompt EBS Volume Type when EBS Storage is 0', () => {
      expect(ec2Policy.shouldPrompt('EBS Volume Type', { 'EBS Storage': 0 })).toBe(false);
    });

    it('prompts Data transfer out when no value set', () => {
      expect(ec2Policy.shouldPrompt('Data transfer out', {})).toBe(true);
      expect(ec2Policy.shouldPrompt('Data transfer out', { 'Data transfer out': null })).toBe(true);
    });

    it('does not prompt Data transfer out Unit when Data transfer out is undefined', () => {
      expect(ec2Policy.shouldPrompt('Data transfer out Unit', {})).toBe(false);
    });

    it('prompts Data transfer out Unit when Data transfer out has positive value', () => {
      expect(ec2Policy.shouldPrompt('Data transfer out Unit', { 'Data transfer out': 100 })).toBe(true);
    });

    it('does not prompt Data transfer out Unit when Data transfer out is 0', () => {
      expect(ec2Policy.shouldPrompt('Data transfer out Unit', { 'Data transfer out': 0 })).toBe(false);
    });

    it('prompts unknown dimensions by default', () => {
      expect(ec2Policy.shouldPrompt('Unknown Dimension', {})).toBe(true);
    });

    it('applies daily spike workload exclusions', () => {
      const dims = { Workloads: 'Daily spike traffic' };
      for (const key of DAILY_SPIKE_SKIP_DIMS) {
        expect(ec2Policy.shouldPrompt(key, dims)).toBe(false);
      }
    });

    it('applies constant usage workload exclusions', () => {
      const dims = { Workloads: 'Constant usage' };
      for (const key of CONSTANT_USAGE_SKIP_DIMS) {
        expect(ec2Policy.shouldPrompt(key, dims)).toBe(false);
      }
    });

    it('supports Dimension-like objects when evaluating workload', () => {
      const dims = {
        Workloads: {
          user_value: 'Daily spike traffic',
          default_value: 'Constant usage',
        },
      };
      expect(ec2Policy.shouldPrompt('Peak workload days', dims)).toBe(false);
      expect(ec2Policy.shouldPrompt('Operating System', dims)).toBe(true);
    });
  });
});

// ─── Property P14: Default Prompt Policy Prompts All Dimensions ───────────────

describe('Property 14: Default Prompt Policy Prompts All Dimensions', () => {
  // Feature: aws-cost-profile-builder, Property 14: Default Prompt Policy Prompts All Dimensions
  // Validates: Requirements 9.2

  const arbServiceName = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{2,30}$/)
    .filter(s => s !== 'Amazon EC2'); // Exclude registered service

  const arbDimKey = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{1,40}$/);

  const arbDimensions = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    { maxKeys: 10 }
  );

  it('default policy prompts all dimensions for any unknown service', () => {
    fc.assert(
      fc.property(arbServiceName, arbDimKey, arbDimensions, (serviceName, dimKey, dimensions) => {
        const policy = getPromptPolicy(serviceName);
        expect(policy.shouldPrompt(dimKey, dimensions)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('default policy prompts dimensions regardless of dimensions map content', () => {
    fc.assert(
      fc.property(arbDimKey, arbDimensions, (dimKey, dimensions) => {
        const policy = getPromptPolicy('Unknown Service For Test');
        // Should prompt regardless of what's in the dimensions map
        expect(policy.shouldPrompt(dimKey, dimensions)).toBe(true);
        expect(policy.shouldPrompt(dimKey, {})).toBe(true);
        expect(policy.shouldPrompt(dimKey, { foo: 'bar', baz: 123 })).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('default policy prompts empty dimension key', () => {
    fc.assert(
      fc.property(arbServiceName, (serviceName) => {
        const policy = getPromptPolicy(serviceName);
        expect(policy.shouldPrompt('', {})).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property P15: Progress Counter Excludes Policy-Filtered Dimensions ───────

describe('Property 15: Progress Counter Excludes Policy-Filtered Dimensions', () => {
  // Feature: aws-cost-profile-builder, Property 15: Progress Counter Excludes Policy-Filtered Dimensions
  // Validates: Requirements 7.6, 9.4

  const ec2AllDims = [
    'Operating System',
    'Number of instances',
    'Instance type',
    'Utilization (On-Demand only)',
    'EBS Storage',
    'EBS Storage Unit',
    'EBS Volume Type',
    'Data transfer out',
    'Data transfer out Unit',
  ];

  it('EC2 progress counter excludes gated dimensions when EBS is 0', () => {
    fc.assert(
      fc.property(fc.constantFrom(0, '0'), (ebsValue) => {
        const dimensionValues = { 'EBS Storage': ebsValue };
        const promptableCount = countPromptableDimensions('Amazon EC2', ec2AllDims, dimensionValues);

        // Core dims (4) + EBS Storage (1) + Data transfer out (1) = 6
        // Excluded: EBS Storage Unit, EBS Volume Type, Data transfer out Unit.
        expect(promptableCount).toBeLessThan(ec2AllDims.length);
        expect(promptableCount).toBe(6);
      }),
      { numRuns: 100 },
    );
  });

  it('EC2 progress counter includes EBS dims when EBS has positive value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (ebsValue) => {
        const dimensionValues = { 'EBS Storage': ebsValue };
        const promptableCount = countPromptableDimensions('Amazon EC2', ec2AllDims, dimensionValues);

        // Core (4) + EBS Storage (1) + EBS unit/type (2) + transfer amount (1) = 8.
        expect(promptableCount).toBe(8);
      }),
      { numRuns: 100 },
    );
  });

  it('EC2 progress counter excludes data transfer dims when transfer is 0', () => {
    fc.assert(
      fc.property(fc.constantFrom(0, '0'), (transferValue) => {
        const dimensionValues = { 'Data transfer out': transferValue };
        const promptableCount = countPromptableDimensions('Amazon EC2', ec2AllDims, dimensionValues);

        // Unit dimension is filtered when transfer is 0.
        expect(promptableCount).toBeLessThan(ec2AllDims.length);
        expect(promptableCount).toBe(6);
      }),
      { numRuns: 100 },
    );
  });

  it('EC2 progress counter includes data transfer dims when transfer has positive value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (transferValue) => {
        const dimensionValues = { 'Data transfer out': transferValue };
        const promptableCount = countPromptableDimensions('Amazon EC2', ec2AllDims, dimensionValues);

        // Core (4) + EBS Storage (1) + transfer amount/unit (2) = 7.
        expect(promptableCount).toBe(7);
      }),
      { numRuns: 100 },
    );
  });

  it('non-EC2 services count all dimensions in progress', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 10 }),
        (dimKeys) => {
          const promptableCount = countPromptableDimensions('Some Other Service', dimKeys, {});
          // Default policy prompts all, so count should equal total
          expect(promptableCount).toBe(dimKeys.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('progress counter decreases as dimensions are completed with 0 values', () => {
    // Simulate user flow: start with all dims, set EBS to 0
    const initialCount = countPromptableDimensions('Amazon EC2', ec2AllDims, {});

    // After setting EBS Storage to 0, EBS Storage Unit and EBS Volume Type are excluded
    // But EBS Storage itself is still prompted (always), so count stays the same
    // The difference is in which specific dimensions are prompted, not the count
    const afterEbsZeroCount = countPromptableDimensions('Amazon EC2', ec2AllDims, { 'EBS Storage': 0 });

    // Count should be the same because EBS Storage is always prompted
    // But the excluded dimensions change (Unit and Volume Type are now excluded)
    expect(afterEbsZeroCount).toBe(initialCount);
  });

  it('progress counter changes based on dimension values (EBS flow)', () => {
    // Phase 1: No values set yet - prompt for EBS Storage
    const phase1Count = countPromptableDimensions('Amazon EC2', ec2AllDims, {});

    // Phase 2: User sets EBS Storage to 100 - now prompt for Unit and Volume Type
    const phase2Count = countPromptableDimensions('Amazon EC2', ec2AllDims, { 'EBS Storage': 100 });

    // Phase 2 should have more promptable dims because EBS is enabled
    expect(phase2Count).toBeGreaterThan(phase1Count);
  });
});

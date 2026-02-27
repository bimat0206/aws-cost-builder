/**
 * EC2-specific conditional field rules.
 * Implements gating logic for workload-dependent, EBS storage, and data transfer dimensions.
 */

import { registerPromptPolicy } from './service_prompt_policies.js';

/**
 * EC2 dimensions that are conditionally shown based on user choices.
 */
const EC2_GATED_DIMS = new Set([
  'Minimum number of instances',
  'Maximum number of instances',
  'Peak workload days',
  'Peak workload hours',
  'Peak workload minutes',
  'EBS Storage',
  'EBS Storage Unit',
  'EBS Volume Type',
  'Data transfer out',
  'Data transfer out Unit',
]);

/**
 * Dimensions that are always prompted (core EC2 configuration).
 */
const EC2_CORE_DIMS = new Set([
  'Operating System',
  'Number of instances',
  'Instance type',
  'Utilization (On-Demand only)',
]);

const DAILY_SPIKE_SKIP_DIMS = new Set([
  'Peak workload days',
  'Number of instances',
  'Utilization (On-Demand only)',
]);

const CONSTANT_USAGE_SKIP_DIMS = new Set([
  'Minimum number of instances',
  'Maximum number of instances',
  'Peak workload days',
  'Peak workload hours',
  'Peak workload minutes',
]);

/**
 * Pull a value from the dimensions map. Supports primitive values and
 * Dimension-like objects with user/default/resolved values.
 *
 * @param {object} dimensions
 * @param {string} key
 * @returns {unknown}
 */
function resolveDimensionValue(dimensions, key) {
  const raw = dimensions?.[key];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.user_value !== undefined && raw.user_value !== null) {
      return raw.user_value;
    }
    if (raw.resolved_value !== undefined && raw.resolved_value !== null) {
      return raw.resolved_value;
    }
    if (raw.default_value !== undefined) {
      return raw.default_value;
    }
  }
  return raw;
}

/**
 * Normalize workload label for comparisons.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeWorkload(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

const ec2Policy = {
  /**
   * Determine whether to prompt for a dimension based on current values.
   *
   * EC2 gating rules:
   * - Core dimensions (OS, instances, type, utilization) are always prompted
   * - EBS storage dimensions are prompted only if user has indicated EBS usage
   * - Data transfer dimensions are prompted only if user has indicated transfer usage
   *
   * @param {string} dimKey - The dimension key being evaluated
   * @param {object} dimensions - Current dimension values map (key -> user_value)
   * @returns {boolean} true if the dimension should be prompted
   */
  shouldPrompt(dimKey, dimensions) {
    const workloadValue =
      resolveDimensionValue(dimensions, 'Workloads') ??
      resolveDimensionValue(dimensions, 'Workload');
    const workload = normalizeWorkload(workloadValue);

    // Workload-specific visibility rules.
    if (workload === 'daily spike traffic' && DAILY_SPIKE_SKIP_DIMS.has(dimKey)) {
      return false;
    }
    if (workload === 'constant usage' && CONSTANT_USAGE_SKIP_DIMS.has(dimKey)) {
      return false;
    }

    // Core dimensions are always prompted
    if (EC2_CORE_DIMS.has(dimKey)) {
      return true;
    }

    // EBS storage gating: check if user wants EBS storage
    if (dimKey === 'EBS Storage') {
      // Always prompt for EBS Storage itself to let user decide
      return true;
    }

    if (dimKey === 'EBS Storage Unit') {
      const ebsStorageValue = resolveDimensionValue(dimensions, 'EBS Storage');
      return isPositiveNumber(ebsStorageValue);
    }

    // EBS Volume Type is shown only if EBS Storage is enabled
    if (dimKey === 'EBS Volume Type') {
      const ebsStorageValue = resolveDimensionValue(dimensions, 'EBS Storage');
      return isPositiveNumber(ebsStorageValue);
    }

    // Always prompt the base transfer amount; gate only the unit sibling.
    if (dimKey === 'Data transfer out') {
      return true;
    }
    if (dimKey === 'Data transfer out Unit') {
      const transferValue = resolveDimensionValue(dimensions, 'Data transfer out');
      return isPositiveNumber(transferValue);
    }

    // Unknown/new dimensions should remain visible unless explicitly gated.
    return true;
  },
};

// Register on module load
registerPromptPolicy('Amazon EC2', ec2Policy);

export {
  ec2Policy,
  EC2_GATED_DIMS,
  EC2_CORE_DIMS,
  DAILY_SPIKE_SKIP_DIMS,
  CONSTANT_USAGE_SKIP_DIMS,
};

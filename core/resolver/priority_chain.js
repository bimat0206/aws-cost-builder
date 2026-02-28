/**
 * Priority chain resolver — user_value → default_value → prompt → unresolved.
 * @module core/resolver/priority_chain
 *
 * Resolution algorithm:
 *   1. If user_value is set (not null), use it → resolved
 *   2. Else if default_value is set (not null), use it → resolved
 *   3. Else if prompt_message is set, mark for runtime prompt → skipped (to be prompted later)
 *   4. Else → unresolved
 *
 * For unresolved dimensions:
 *   - If required=true → fail-fast before browser launch
 *   - If required=false → skip and continue
 */

import { ProfileDocument, Group, Service, Dimension } from '../models/profile.js';
import { buildOverrideKey } from './override_parser.js';

// ─── Error Classes ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} UnresolvedDimension
 * @property {string} groupName
 * @property {string} serviceName
 * @property {string} dimensionKey
 * @property {boolean} required
 * @property {string} reason - Explanation of why resolution failed
 */

/**
 * Resolution error thrown when required dimensions remain unresolved.
 */
export class ResolutionError extends Error {
    /**
     * @param {UnresolvedDimension[]} unresolved
     */
    constructor(unresolved) {
        const count = unresolved.length;
        const message = `Resolution failed: ${count} required dimension(s) unresolved after priority chain`;
        super(message);
        this.name = 'ResolutionError';
        this.unresolved = unresolved;
    }

    /**
     * Get a formatted report of unresolved dimensions.
     * @returns {string}
     */
    getReport() {
        const lines = this.unresolved.map(u =>
            `  - ${u.groupName}.${u.serviceName}.${u.dimensionKey}: ${u.reason}`
        );
        return `Unresolved dimensions:\n${lines.join('\n')}`;
    }
}

// ─── Resolution Functions ─────────────────────────────────────────────────────

/**
 * Apply --set overrides to targeted dimensions in the profile.
 *
 * Overrides are applied by matching groupName, serviceName, and dimensionKey.
 * When a match is found, the dimension's user_value is set to the override value.
 *
 * @param {ProfileDocument} profile
 * @param {Map<string, import('./override_parser.js').ParsedOverride>} overrides
 * @returns {ProfileDocument}
 * @throws {Error} if an override targets a non-existent dimension
 */
export function applyOverrides(profile, overrides) {
    if (!overrides || overrides.size === 0) {
        return profile;
    }

    const groups = profile.getGroups();
    const unmatchedOverrides = new Set(overrides.keys());

    for (const group of groups) {
        for (const service of group.getServices()) {
            for (const dimension of service.getDimensions()) {
                const key = buildOverrideKey(group.group_name, service.service_name, dimension.key);
                const override = overrides.get(key);

                if (override) {
                    // Apply the override by setting user_value
                    dimension.user_value = override.value;
                    dimension.resolution_source = null;
                    dimension.resolution_status = null;
                    unmatchedOverrides.delete(key);
                }
            }
        }
    }

    // Report any unmatched overrides
    if (unmatchedOverrides.size > 0) {
        const unmatched = Array.from(unmatchedOverrides).map(k => {
            const [g, s, d] = k.split('|');
            return `${g}.${s}.${d}`;
        });
        throw new Error(`Override target(s) not found in profile: ${unmatched.join(', ')}`);
    }

    return profile;
}

/**
 * Resolve a single dimension value using the priority chain.
 *
 * Priority chain:
 *   1. user_value (if not null)
 *   2. default_value (if not null)
 *   3. prompt_message (if set) → mark as skipped for runtime prompt
 *   4. unresolved
 *
 * @param {Dimension} dimension
 * @param {string} groupName
 * @param {string} serviceName
 * @returns {{ resolved: boolean, unresolved: UnresolvedDimension | null }}
 */
function resolveDimension(dimension, groupName, serviceName) {
    // Priority 1: user_value
    if (dimension.user_value !== null && dimension.user_value !== undefined) {
        dimension.resolved_value = dimension.user_value;
        dimension.resolution_source = 'user_value';
        dimension.resolution_status = 'resolved';
        return { resolved: true, unresolved: null };
    }

    // Priority 2: default_value
    if (dimension.default_value !== null && dimension.default_value !== undefined) {
        dimension.resolved_value = dimension.default_value;
        dimension.resolution_source = 'default_value';
        dimension.resolution_status = 'resolved';
        return { resolved: true, unresolved: null };
    }

    // Priority 3: prompt_message (runtime prompt)
    if (dimension.prompt_message !== null && dimension.prompt_message !== undefined && dimension.prompt_message !== '') {
        // Mark as skipped - will be prompted at runtime
        dimension.resolved_value = null;
        dimension.resolution_source = 'prompt';
        dimension.resolution_status = 'skipped';
        return { resolved: false, unresolved: null };
    }

    // Priority 4: unresolved (required) or skipped (optional) — Req 5.3
    if (!dimension.required) {
        // Optional with no resolution path → skip, do not block execution
        dimension.resolved_value = null;
        dimension.resolution_source = null;
        dimension.resolution_status = 'skipped';
        return { resolved: false, unresolved: null };
    }

    dimension.resolved_value = null;
    dimension.resolution_source = null;
    dimension.resolution_status = 'unresolved';

    return {
        resolved: false,
        unresolved: {
            groupName,
            serviceName,
            dimensionKey: dimension.key,
            required: true,
            reason: 'Required dimension has no user_value, default_value, or prompt_message',
        },
    };
}

/**
 * Resolve all dimension values using the priority chain.
 *
 * @param {ProfileDocument} profile
 * @param {Object} [opts]
 * @param {boolean} [opts.includeOptionalInReport] - If true, include optional dimensions in unresolved report
 * @returns {{ profile: ProfileDocument, unresolved: UnresolvedDimension[] }}
 */
export function resolveDimensions(profile, opts = {}) {
    const { includeOptionalInReport = true } = opts;
    const unresolved = [];

    const groups = profile.getGroups();

    for (const group of groups) {
        for (const service of group.getServices()) {
            for (const dimension of service.getDimensions()) {
                const result = resolveDimension(dimension, group.group_name, service.service_name);

                if (result.unresolved) {
                    // Only track unresolved if it's required OR if we're including optional in report
                    if (result.unresolved.required || includeOptionalInReport) {
                        unresolved.push(result.unresolved);
                    }
                }
            }
        }
    }

    return { profile, unresolved };
}

/**
 * Assert no unresolved required dimensions exist; throw ResolutionError if any.
 *
 * This is the fail-fast gate before browser launch.
 *
 * @param {UnresolvedDimension[]} unresolved
 * @throws {ResolutionError}
 */
export function assertNoUnresolved(unresolved) {
    const required = unresolved.filter(u => u.required);

    if (required.length > 0) {
        throw new ResolutionError(required);
    }
}

/**
 * Get a summary of resolution status for a profile.
 *
 * @param {ProfileDocument} profile
 * @returns {{ total: number, resolved: number, skipped: number, unresolved: number }}
 */
export function getResolutionSummary(profile) {
    let total = 0;
    let resolved = 0;
    let skipped = 0;
    let unresolved = 0;

    for (const group of profile.getGroups()) {
        for (const service of group.getServices()) {
            for (const dimension of service.getDimensions()) {
                total++;
                if (dimension.resolution_status === 'resolved') {
                    resolved++;
                } else if (dimension.resolution_status === 'skipped') {
                    skipped++;
                } else if (dimension.resolution_status === 'unresolved') {
                    unresolved++;
                }
            }
        }
    }

    return { total, resolved, skipped, unresolved };
}

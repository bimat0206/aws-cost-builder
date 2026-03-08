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
 *
 * Supports nested groups recursively.
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
 * Recursively apply overrides across all groups (including nested child groups).
 * @param {Group[]} groups
 * @param {Map<string, import('./override_parser.js').ParsedOverride>} overrides
 * @param {Set<string>} unmatchedOverrides
 */
function applyOverridesToGroups(groups, overrides, unmatchedOverrides) {
    for (const group of groups) {
        for (const service of group.getServices()) {
            for (const dimension of service.getDimensions()) {
                const key = buildOverrideKey(group.group_name, service.service_name, dimension.key);
                const override = overrides.get(key);
                if (override) {
                    dimension.user_value = override.value;
                    dimension.resolution_source = null;
                    dimension.resolution_status = null;
                    unmatchedOverrides.delete(key);
                }
            }
        }
        if (group.getGroups && group.getGroups().length > 0) {
            applyOverridesToGroups(group.getGroups(), overrides, unmatchedOverrides);
        }
    }
}

/**
 * Apply --set overrides to targeted dimensions in the profile.
 * Supports nested groups recursively.
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

    const unmatchedOverrides = new Set(overrides.keys());
    applyOverridesToGroups(profile.getGroups(), overrides, unmatchedOverrides);

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
 * @param {Dimension} dimension
 * @param {string} groupName
 * @param {string} serviceName
 * @returns {{ resolved: boolean, unresolved: UnresolvedDimension | null }}
 */
function resolveDimension(dimension, groupName, serviceName) {
    if (dimension.user_value !== null && dimension.user_value !== undefined) {
        dimension.resolved_value = dimension.user_value;
        dimension.resolution_source = 'user_value';
        dimension.resolution_status = 'resolved';
        return { resolved: true, unresolved: null };
    }

    if (dimension.default_value !== null && dimension.default_value !== undefined) {
        dimension.resolved_value = dimension.default_value;
        dimension.resolution_source = 'default_value';
        dimension.resolution_status = 'resolved';
        return { resolved: true, unresolved: null };
    }

    if (dimension.prompt_message !== null && dimension.prompt_message !== undefined && dimension.prompt_message !== '') {
        dimension.resolved_value = null;
        dimension.resolution_source = 'prompt';
        dimension.resolution_status = 'skipped';
        return { resolved: false, unresolved: null };
    }

    if (!dimension.required) {
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
 * Recursively resolve dimensions in all groups (including nested child groups).
 * @param {Group[]} groups
 * @param {UnresolvedDimension[]} unresolved
 * @param {boolean} includeOptionalInReport
 */
function resolveDimensionsInGroups(groups, unresolved, includeOptionalInReport) {
    for (const group of groups) {
        for (const service of group.getServices()) {
            for (const dimension of service.getDimensions()) {
                const result = resolveDimension(dimension, group.group_name, service.service_name);
                if (result.unresolved) {
                    if (result.unresolved.required || includeOptionalInReport) {
                        unresolved.push(result.unresolved);
                    }
                }
            }
        }
        if (group.getGroups && group.getGroups().length > 0) {
            resolveDimensionsInGroups(group.getGroups(), unresolved, includeOptionalInReport);
        }
    }
}

/**
 * Resolve all dimension values using the priority chain.
 * Traverses nested groups recursively.
 *
 * @param {ProfileDocument} profile
 * @param {Object} [opts]
 * @param {boolean} [opts.includeOptionalInReport]
 * @returns {{ profile: ProfileDocument, unresolved: UnresolvedDimension[] }}
 */
export function resolveDimensions(profile, opts = {}) {
    const { includeOptionalInReport = true } = opts;
    const unresolved = [];
    resolveDimensionsInGroups(profile.getGroups(), unresolved, includeOptionalInReport);
    return { profile, unresolved };
}

/**
 * Assert no unresolved required dimensions exist; throw ResolutionError if any.
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
 * Get a summary of resolution status for a profile (traverses nested groups).
 *
 * @param {ProfileDocument} profile
 * @returns {{ total: number, resolved: number, skipped: number, unresolved: number }}
 */
export function getResolutionSummary(profile) {
    let total = 0;
    let resolved = 0;
    let skipped = 0;
    let unresolved = 0;

    function countInGroups(groups) {
        for (const group of groups) {
            for (const service of group.getServices()) {
                for (const dimension of service.getDimensions()) {
                    total++;
                    if (dimension.resolution_status === 'resolved') resolved++;
                    else if (dimension.resolution_status === 'skipped') skipped++;
                    else if (dimension.resolution_status === 'unresolved') unresolved++;
                }
            }
            if (group.getGroups && group.getGroups().length > 0) {
                countInGroups(group.getGroups());
            }
        }
    }

    countInGroups(profile.getGroups());
    return { total, resolved, skipped, unresolved };
}

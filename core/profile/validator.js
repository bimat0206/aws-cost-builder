/**
 * Profile validator — schema and cross-field validation.
 * @module core/profile/validator
 */

import Ajv from 'ajv';
import profileSchema from '../../config/schemas/json-schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false });
const _validateProfile = ajv.compile(profileSchema);

// ─── Error Classes ────────────────────────────────────────────────────────────

/**
 * Aggregated profile validation error — carries all violations in one throw.
 */
export class ProfileValidationError extends Error {
    /** @param {string[]} errors */
    constructor(errors) {
        super(`Profile validation failed with ${errors.length} error(s):\n${errors.join('\n')}`);
        this.name = 'ProfileValidationError';
        this._errors = errors;
    }
    get errors() { return this._errors; }
}

/** Service name not found in the loaded catalog. */
export class CrossValidationServiceCatalogError extends ProfileValidationError {
    constructor(errors) { super(errors); this.name = 'CrossValidationServiceCatalogError'; }
}

/** Region code not in region_map.json and not "global". */
export class CrossValidationRegionMapError extends ProfileValidationError {
    constructor(errors) { super(errors); this.name = 'CrossValidationRegionMapError'; }
}

/** Dimension key not defined for the given service in the catalog. */
export class CrossValidationDimensionKeyError extends ProfileValidationError {
    constructor(errors) { super(errors); this.name = 'CrossValidationDimensionKeyError'; }
}

/** required=true dimension has no resolution path (no user_value, default_value, or prompt_message). */
export class CrossValidationRequirementError extends ProfileValidationError {
    constructor(errors) { super(errors); this.name = 'CrossValidationRequirementError'; }
}

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Validate a profile plain object against the JSON schema (Draft-07).
 * Aggregates ALL violations before throwing.
 * @param {unknown} profileData
 * @throws {ProfileValidationError}
 */
export function validateSchema(profileData) {
    const valid = _validateProfile(profileData);
    if (valid) return;

    const errors = (_validateProfile.errors || []).map(err => {
        const path = err.instancePath || '/';
        return `  [schema] ${path}: ${err.message}`;
    });

    throw new ProfileValidationError(errors);
}

/**
 * Recursively collect all services from a group tree.
 * @param {object[]} groups
 * @param {string} parentPath
 * @returns {Array<{loc: string, service: object}>}
 */
function collectServicesFromGroups(groups, parentPath = '') {
    const result = [];
    for (const group of (groups || [])) {
        const groupPath = parentPath ? `${parentPath}.${group.group_name}` : group.group_name;
        for (const service of (group.services || [])) {
            result.push({ loc: `groups[${groupPath}].services[${service.service_name}]`, service });
        }
        if (group.groups && group.groups.length > 0) {
            result.push(...collectServicesFromGroups(group.groups, groupPath));
        }
    }
    return result;
}

function collectServiceDimensionEntries(service, baseLoc) {
    const entries = [];

    for (const dimKey of Object.keys(service.dimensions || {})) {
        entries.push({ key: dimKey, loc: `${baseLoc}.dimensions["${dimKey}"]` });
    }

    if (service.sections && Array.isArray(service.sections)) {
        service.sections.forEach((sec, idx) => {
            for (const dimKey of Object.keys(sec.dimensions || {})) {
                entries.push({ key: dimKey, loc: `${baseLoc}.sections[${idx}].dimensions["${dimKey}"]` });
            }
        });
    }

    function walkConfigGroups(groups, path = []) {
        for (const [idx, group] of (groups || []).entries()) {
            const nextPath = [...path, group.group_name || group.label || String(idx)];
            const groupLoc = `${baseLoc}.config_groups[${nextPath.join('.')}]`;
            for (const dimKey of Object.keys(group.fields || {})) {
                entries.push({ key: dimKey, loc: `${groupLoc}.fields["${dimKey}"]` });
            }
            walkConfigGroups(group.groups || [], nextPath);
        }
    }

    walkConfigGroups(service.config_groups || []);
    return entries;
}

/**
 * Cross-field validation: service names, regions, and dimension keys must all
 * exist in the catalog / region map. All violations are aggregated before throwing.
 * Traverses nested groups recursively.
 * @param {object} profileData - Already schema-valid plain profile object
 * @param {Array<{service_name: string, supported_regions: string[], dimensions: Array<{key: string}>}>} catalog
 * @param {object} regionMap - { [regionCode]: displayName }
 * @throws {CrossValidationServiceCatalogError | CrossValidationRegionMapError | CrossValidationDimensionKeyError}
 */
export function validateCrossFields(profileData, catalog, regionMap) {
    const errors = [];

    const catalogByName = new Map(catalog.map(e => [e.service_name, e]));
    const validRegions = new Set(Object.keys(regionMap));

    const allServices = collectServicesFromGroups(profileData.groups || []);

    for (const { loc, service } of allServices) {
        // F-L4-01: service_name must exist in catalog
        const catalogEntry = catalogByName.get(service.service_name);
        if (!catalogEntry) {
            errors.push(`  [cross-field] ${loc}: service_name "${service.service_name}" not found in catalog`);
            continue;
        }

        // F-L4-02: region must be in region_map or "global"
        if (service.region !== 'global' && !validRegions.has(service.region)) {
            errors.push(`  [cross-field] ${loc}: region "${service.region}" not in region_map and is not "global"`);
        }

        // F-L4-03: each dimension key must be defined for this service
        const catalogKeys = new Set(catalogEntry.dimensions.map(d => d.key));
        for (const { key: dimKey, loc: dimLoc } of collectServiceDimensionEntries(service, loc)) {
            if (!catalogKeys.has(dimKey)) {
                errors.push(`  [cross-field] ${dimLoc}: key not defined for service "${service.service_name}"`);
            }
        }
    }

    if (errors.length === 0) return;

    if (errors.some(e => e.includes('not found in catalog'))) {
        throw new CrossValidationServiceCatalogError(errors);
    }
    if (errors.some(e => e.includes('not in region_map'))) {
        throw new CrossValidationRegionMapError(errors);
    }
    throw new CrossValidationDimensionKeyError(errors);
}

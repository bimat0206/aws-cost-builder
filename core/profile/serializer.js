/**
 * Profile serializer — serialize/deserialize ProfileDocument objects.
 * @module core/profile/serializer
 *
 * Guarantees:
 *  - UTF-8 encoding (Node.js default for JSON.stringify)
 *  - 2-space indentation
 *  - Stable key order: top-level keys always appear in canonical order,
 *    dimension keys are sorted alphabetically for diff-friendliness.
 *
 * Also provides serializeToHCL() for the HCL DSL format.
 */

import { ProfileDocument } from '../models/profile.js';

// Canonical key order for each object type
const PROFILE_KEY_ORDER = ['schema_version', 'project_name', 'description', 'groups'];
const GROUP_KEY_ORDER   = ['group_name', 'label', 'services', 'groups'];
const SERVICE_KEY_ORDER = ['service_name', 'human_label', 'region', 'config_groups'];
const CONFIG_GROUP_KEY_ORDER = ['group_name', 'label', 'fields', 'groups'];
const DIM_KEY_ORDER     = ['user_value', 'default_value', 'unit', 'prompt_message',
                           'required', 'resolved_value', 'resolution_source', 'resolution_status'];

/**
 * Re-order an object's keys according to a canonical list.
 * Keys not in the list are appended in their original order.
 * @param {object} obj
 * @param {string[]} order
 * @returns {object}
 */
function reorder(obj, order) {
    const result = {};
    for (const key of order) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            result[key] = obj[key];
        }
    }
    for (const key of Object.keys(obj)) {
        if (!Object.prototype.hasOwnProperty.call(result, key)) {
            result[key] = obj[key];
        }
    }
    return result;
}

function stableConfigGroup(group) {
    const sortedFieldKeys = Object.keys(group.fields || {}).sort();
    const fields = {};
    for (const key of sortedFieldKeys) {
        fields[key] = reorder(group.fields[key], DIM_KEY_ORDER);
    }

    const out = reorder({
        ...group,
        fields,
        groups: (group.groups || []).map(child => stableConfigGroup(child)),
    }, CONFIG_GROUP_KEY_ORDER);

    if (!out.label && out.label !== null) delete out.label;
    if (!out.groups || out.groups.length === 0) delete out.groups;
    return out;
}

/**
 * Produce a stable plain-object representation of a group (recursively).
 * @param {object} g
 * @returns {object}
 */
function stableGroup(g) {
    const services = (g.services || []).map(s => {
        const configGroups = (s.config_groups || []).map(group => stableConfigGroup(group));
        return reorder({ ...s, config_groups: configGroups }, SERVICE_KEY_ORDER);
    });

    const obj = { ...g, services };

    if (g.groups && g.groups.length > 0) {
        obj.groups = g.groups.map(child => stableGroup(child));
    }

    return reorder(obj, GROUP_KEY_ORDER);
}

/**
 * Produce a stable plain-object representation of a ProfileDocument.
 * @param {ProfileDocument} profile
 * @returns {object}
 */
function toStableObject(profile) {
    const plain = profile.toObject();
    const groups = plain.groups.map(g => stableGroup(g));
    return reorder({ ...plain, groups }, PROFILE_KEY_ORDER);
}

/**
 * Serialize a ProfileDocument to a JSON string.
 * Uses UTF-8 encoding, 2-space indentation, and stable key ordering.
 * @param {ProfileDocument} profile
 * @returns {string}
 */
export function serializeProfile(profile) {
    return JSON.stringify(toStableObject(profile), null, 2);
}

/**
 * Serialize a ProfileDocument to an HCL DSL string.
 * @param {ProfileDocument} profile
 * @returns {string}
 */
export async function serializeToHCL(profile) {
    const { serializeHCL } = await import('../../hcl/index.js');
    return serializeHCL(profile.toObject());
}

/**
 * Deserialize a JSON string into a ProfileDocument.
 * @param {string} json
 * @returns {ProfileDocument}
 * @throws {SyntaxError} if the JSON is malformed
 */
export function deserializeProfile(json) {
    const plain = JSON.parse(json);
    return ProfileDocument.fromObject(plain);
}

/**
 * Profile serializer — serialize/deserialize ProfileDocument objects.
 * @module core/profile/serializer
 *
 * Guarantees:
 *  - UTF-8 encoding (Node.js default for JSON.stringify)
 *  - 2-space indentation
 *  - Stable key order: top-level keys always appear in canonical order,
 *    dimension keys are sorted alphabetically for diff-friendliness.
 */

import { ProfileDocument } from '../models/profile.js';

// Canonical key order for each object type
const PROFILE_KEY_ORDER = ['schema_version', 'project_name', 'description', 'groups'];
const GROUP_KEY_ORDER   = ['group_name', 'services'];
const SERVICE_KEY_ORDER = ['service_name', 'human_label', 'region', 'dimensions'];
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

/**
 * Produce a stable plain-object representation of a ProfileDocument.
 * @param {ProfileDocument} profile
 * @returns {object}
 */
function toStableObject(profile) {
    const plain = profile.toObject();

    const groups = plain.groups.map(g => {
        const services = g.services.map(s => {
            // Sort dimension keys alphabetically for stable ordering
            const sortedDimKeys = Object.keys(s.dimensions).sort();
            const dimensions = {};
            for (const k of sortedDimKeys) {
                dimensions[k] = reorder(s.dimensions[k], DIM_KEY_ORDER);
            }
            return reorder({ ...s, dimensions }, SERVICE_KEY_ORDER);
        });
        return reorder({ ...g, services }, GROUP_KEY_ORDER);
    });

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
 * Deserialize a JSON string into a ProfileDocument.
 * @param {string} json
 * @returns {ProfileDocument}
 * @throws {SyntaxError} if the JSON is malformed
 */
export function deserializeProfile(json) {
    const plain = JSON.parse(json);
    return ProfileDocument.fromObject(plain);
}

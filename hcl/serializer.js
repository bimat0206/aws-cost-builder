/**
 * HCL Serializer — converts a plain ProfileDocument object to HCL DSL string.
 * @module hcl/serializer
 *
 * Produces output in this format:
 *
 *   schema_version = "4.0"
 *   project_name   = "My Project"
 *   description    = "Optional description"
 *
 *   group "web_tier" {
 *     label = "Web Tier"
 *
 *     group "compute" {
 *       label = "Compute Layer"
 *
 *       service "ec2" "frontend_servers" {
 *         region      = "us-east-1"
 *         human_label = "Frontend Servers"
 *
 *         dimension "Operating System"    = "Linux"
 *         dimension "Number of instances" = 3
 *       }
 *     }
 *
 *     service "s3" "static_assets" {
 *       region      = "us-east-1"
 *       human_label = "Static Assets Bucket"
 *
 *       dimension "S3 Standard storage"      = 500
 *       dimension "S3 Standard storage Unit" = "GB"
 *     }
 *   }
 */

/**
 * Serialize a value to HCL literal.
 * - strings  → "quoted"
 * - numbers  → unquoted
 * - booleans → true / false
 * - null     → null
 * @param {*} value
 * @returns {string}
 */
function hclValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    const str = String(value);
    const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return `"${escaped}"`;
}

/**
 * Indent a block of text by `n` spaces.
 * @param {string} text
 * @param {number} n
 * @returns {string}
 */
function indent(text, n) {
    const pad = ' '.repeat(n);
    return text.split('\n').map(line => (line.trim() === '' ? '' : pad + line)).join('\n');
}

/**
 * Render a block of dimension key/values with column-aligned `=`.
 * @param {string[]} keys
 * @param {object} dims
 * @param {string} pad - indentation prefix
 * @returns {string[]} lines (no trailing newline)
 */
function renderDimensionLines(keys, dims, pad) {
    if (keys.length === 0) return [];
    const maxKeyLen = Math.max(...keys.map(k => k.length));
    return keys.map(key => {
        const dim = dims[key];
        const rawVal = (dim && dim.user_value !== null && dim.user_value !== undefined)
            ? dim.user_value
            : (dim ? dim.default_value : null);
        const padding = ' '.repeat(maxKeyLen - key.length);
        return `${pad}dimension ${hclValue(key)}${padding} = ${hclValue(rawVal)}`;
    });
}

function serializeService(service, indentLevel) {
    const pad = ' '.repeat(indentLevel);
    const innerPad = ' '.repeat(indentLevel + 2);
    const sectionPad = ' '.repeat(indentLevel + 4);
    const lines = [];

    const label = service.human_label || service.service_name;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    lines.push(`${pad}service ${hclValue(service.service_name)} ${hclValue(slug)} {`);
    lines.push(`${innerPad}region      = ${hclValue(service.region)}`);
    lines.push(`${innerPad}human_label = ${hclValue(label)}`);

    const dims = service.dimensions || {};
    const sections = service.sections || [];

    if (sections.length > 0) {
        // Build set of all keys that belong to a section
        const sectionedKeys = new Set(sections.flatMap(s => s.keys || []));

        // Render unsectioned dimensions first (sorted)
        const unsectionedKeys = Object.keys(dims)
            .filter(k => !sectionedKeys.has(k))
            .sort();

        if (unsectionedKeys.length > 0) {
            lines.push('');
            lines.push(...renderDimensionLines(unsectionedKeys, dims, innerPad));
        }

        // Render each section block
        for (const section of sections) {
            const sectionKeys = (section.keys || []).filter(k => k in dims);
            if (sectionKeys.length === 0) continue;
            lines.push('');
            lines.push(`${innerPad}section ${hclValue(section.name)} {`);
            lines.push(...renderDimensionLines(sectionKeys, dims, sectionPad));
            lines.push(`${innerPad}}`);
        }
    } else {
        // No sections — flat dimension list (v3 style, sorted)
        const dimKeys = Object.keys(dims).sort();
        if (dimKeys.length > 0) {
            lines.push('');
            lines.push(...renderDimensionLines(dimKeys, dims, innerPad));
        }
    }

    lines.push(`${pad}}`);
    return lines.join('\n');
}

/**
 * Serialize a group (and its nested children) to HCL lines.
 * @param {object} group
 * @param {number} indentLevel
 * @returns {string}
 */
function serializeGroup(group, indentLevel) {
    const pad = ' '.repeat(indentLevel);
    const innerPad = ' '.repeat(indentLevel + 2);
    const lines = [];

    lines.push(`${pad}group ${hclValue(group.group_name)} {`);

    if (group.label) {
        lines.push(`${innerPad}label = ${hclValue(group.label)}`);
    }

    const childGroups = group.groups || [];
    const services = group.services || [];

    if (childGroups.length > 0 || services.length > 0) {
        lines.push('');
    }

    for (const childGroup of childGroups) {
        lines.push(serializeGroup(childGroup, indentLevel + 2));
        lines.push('');
    }

    for (const service of services) {
        lines.push(serializeService(service, indentLevel + 2));
        lines.push('');
    }

    // Remove trailing blank line inside block
    if (lines[lines.length - 1] === '') lines.pop();

    lines.push(`${pad}}`);
    return lines.join('\n');
}

/**
 * Serialize a plain ProfileDocument object to an HCL string.
 * @param {object} profileData - Plain object (from ProfileDocument.toObject())
 * @returns {string}
 */
export function serializeHCL(profileData) {
    const lines = [];

    lines.push(`schema_version = ${hclValue(profileData.schema_version || '4.0')}`);
    lines.push(`project_name   = ${hclValue(profileData.project_name)}`);

    if (profileData.description !== null && profileData.description !== undefined) {
        lines.push(`description    = ${hclValue(profileData.description)}`);
    }

    const groups = profileData.groups || [];
    for (const group of groups) {
        lines.push('');
        lines.push(serializeGroup(group, 0));
    }

    lines.push('');
    return lines.join('\n');
}

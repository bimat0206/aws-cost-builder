/**
 * HCL Serializer — converts a plain ProfileDocument object to HCL v7.0 DSL string.
 *
 * v7.0 grammar changes from v6:
 *  - Named config groups with label ending in " feature" → `feature "Name" { ... }` block
 *  - Named config groups with any other label → `section "Name" { ... }` block
 *  - Fields inside feature/section → flat attributes: `snake_key = value`
 *  - Unit companion field ("Foo Unit") → `snake_key_unit = "..."` on next line
 *  - General group (no label) → top-level attributes under service
 *
 * @module hcl/serializer
 */

// ─── Label / key helpers ─────────────────────────────────────────────────────

/** UI-noise suffixes stripped from raw AWS calculator field labels. */
const LABEL_SUFFIX_RE = /\s+(?:Value|Enter\s+amount|Enter\s+the\s+percentage|Enter\s+percentage|Enter\s+number(?:\s+of\s+\w+)*|Field\s+value)$/i;

/** Clean a raw AWS UI label. */
export function cleanFieldLabel(raw) {
    return String(raw ?? '').trim().replace(LABEL_SUFFIX_RE, '').trim();
}

/** Convert a human label to snake_case attribute key. */
function toSnakeKey(label) {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'field';
}

/**
 * Convert a field label to a snake_case attribute key, optionally stripping
 * the containing section/feature name as a prefix.
 */
function fieldToSnakeKey(fieldLabel, sectionLabel = '') {
    let key = cleanFieldLabel(fieldLabel);

    // Strip section name prefix (e.g. "S3 Standard storage" → "storage" inside "S3 Standard")
    if (sectionLabel) {
        const escapedSection = sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        key = key.replace(new RegExp(`^${escapedSection}\\s*`, 'i'), '').trim();
    }

    return toSnakeKey(key) || toSnakeKey(cleanFieldLabel(fieldLabel));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hclValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    const str = String(value);
    const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return `"${escaped}"`;
}

function slugifyName(value, fallback = 'group') {
    const slug = String(value ?? '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return slug || fallback;
}

function normalizeConfigGroups(service) {
    if (Array.isArray(service.config_groups) && service.config_groups.length > 0) {
        return service.config_groups;
    }
    const dimensions = service.dimensions || {};
    if (Object.keys(dimensions).length > 0) {
        return [{ group_name: 'general', label: null, fields: dimensions }];
    }
    return [];
}

function resolveValue(field) {
    return field.user_value !== null && field.user_value !== undefined
        ? field.user_value
        : field.default_value;
}

// ─── Flat attribute emission ──────────────────────────────────────────────────

/**
 * Emit all fields in a map as flat `snake_key = value` attributes.
 * Fields ending with " Unit" are paired with their base field as `_unit`.
 *
 * @param {object} fields  - map of raw label → field object
 * @param {string} sectionLabel - used to strip prefix from labels
 * @param {number} indentLevel
 * @returns {string[]} lines
 */
function serializeAttrs(fields, sectionLabel, indentLevel) {
    const pad = ' '.repeat(indentLevel);
    const entries = Object.entries(fields || {});
    if (entries.length === 0) return [];

    const lines = [];
    const quotedKeys = entries.map(([k]) => hclValue(cleanFieldLabel(k)));
    const maxLen = quotedKeys.length > 0 ? Math.max(...quotedKeys.map(k => k.length)) : 0;

    for (let i = 0; i < entries.length; i++) {
        const [, field] = entries[i];
        const qk = quotedKeys[i];
        const val = resolveValue(field);
        const padding = ' '.repeat(Math.max(0, maxLen - qk.length));
        lines.push(`${pad}${qk}${padding} = ${hclValue(val)}`);
    }

    return lines;
}

// ─── Section block ────────────────────────────────────────────────────────────

function serializeSection(group, indentLevel, parentLabel = '') {
    const pad = ' '.repeat(indentLevel);
    const label = group.label || group.group_name;
    // Strip " feature" from section name if it leaked through
    const sectionLabel = label.replace(/\s+feature$/i, '').trim();
    const lines = [`${pad}section ${hclValue(sectionLabel)} {`];

    const attrLines = serializeAttrs(group.fields || {}, sectionLabel, indentLevel + 2);
    const childGroups = group.groups || [];

    if (attrLines.length > 0) {
        lines.push(...attrLines);
        if (childGroups.length > 0) lines.push('');
    }

    childGroups.forEach((child, idx) => {
        const childLines = serializeSection(child, indentLevel + 2, sectionLabel);
        lines.push(childLines);
        if (idx !== childGroups.length - 1) lines.push('');
    });

    lines.push(`${pad}}`);
    return lines.join('\n');
}

// ─── Feature block ────────────────────────────────────────────────────────────

function serializeFeature(group, indentLevel) {
    const pad = ' '.repeat(indentLevel);
    // Strip " feature" suffix from the displayed label
    const rawLabel = group.label || group.group_name;
    const label = rawLabel.replace(/\s+feature$/i, '').trim();

    const lines = [`${pad}feature ${hclValue(label)} {`];

    const childGroups = group.groups || [];
    const ownFields = group.fields || {};

    // If the feature has its own fields (no inner section), emit them directly
    const ownAttrs = serializeAttrs(ownFields, label, indentLevel + 2);
    if (ownAttrs.length > 0) {
        lines.push(...ownAttrs);
        if (childGroups.length > 0) lines.push('');
    }

    // Inner groups become section blocks
    childGroups.forEach((child, idx) => {
        lines.push(serializeSection(child, indentLevel + 2, label));
        if (idx !== childGroups.length - 1) lines.push('');
    });

    lines.push(`${pad}}`);
    return lines.join('\n');
}

// ─── Service block ────────────────────────────────────────────────────────────

function serializeService(service, indentLevel) {
    const pad = ' '.repeat(indentLevel);
    const innerPad = ' '.repeat(indentLevel + 2);
    const label = service.human_label || service.service_name;
    const slug = slugifyName(label, 'service');

    const lines = [
        `${pad}service ${hclValue(service.service_name)} ${hclValue(slug)} {`,
        `${innerPad}region      = ${hclValue(service.region)}`,
        `${innerPad}human_label = ${hclValue(label)}`,
    ];

    const configGroups = normalizeConfigGroups(service);

    // Separate groups by type
    const generalGroup  = configGroups.find(g => g.group_name === 'general' && !g.label);
    const featureGroups = configGroups.filter(g => {
        if (g.group_name === 'general' && !g.label) return false;
        const lbl = (g.label || g.group_name || '').toLowerCase();
        return lbl.includes('feature');
    });
    const sectionGroups = configGroups.filter(g => {
        if (g.group_name === 'general' && !g.label) return false;
        const lbl = (g.label || g.group_name || '').toLowerCase();
        return !lbl.includes('feature');
    });

    // Top-level (ungrouped) fields
    if (generalGroup) {
        const attrs = serializeAttrs(generalGroup.fields || {}, '', indentLevel + 2);
        if (attrs.length > 0) {
            lines.push('');
            lines.push(...attrs);
        }
    }

    // Named non-feature sections
    if (sectionGroups.length > 0) {
        lines.push('');
        sectionGroups.forEach((group, idx) => {
            lines.push(serializeSection(group, indentLevel + 2));
            if (idx !== sectionGroups.length - 1) lines.push('');
        });
    }

    // Feature blocks (toggle-gated)
    if (featureGroups.length > 0) {
        lines.push('');
        featureGroups.forEach((group, idx) => {
            lines.push(serializeFeature(group, indentLevel + 2));
            if (idx !== featureGroups.length - 1) lines.push('');
        });
    }

    lines.push(`${pad}}`);
    return lines.join('\n');
}

// ─── Group block ──────────────────────────────────────────────────────────────

function serializeGroup(group, indentLevel) {
    const pad = ' '.repeat(indentLevel);
    const innerPad = ' '.repeat(indentLevel + 2);
    const lines = [`${pad}group ${hclValue(group.group_name)} {`];
    if (group.label) lines.push(`${innerPad}label = ${hclValue(group.label)}`);

    const childGroups = group.groups || [];
    const services = group.services || [];
    if (childGroups.length > 0 || services.length > 0) lines.push('');

    childGroups.forEach(child => {
        lines.push(serializeGroup(child, indentLevel + 2));
        lines.push('');
    });
    services.forEach(svc => {
        lines.push(serializeService(svc, indentLevel + 2));
        lines.push('');
    });

    if (lines[lines.length - 1] === '') lines.pop();
    lines.push(`${pad}}`);
    return lines.join('\n');
}

// ─── Root ─────────────────────────────────────────────────────────────────────

/**
 * Serialize a plain ProfileDocument object to HCL v7.0.
 * @param {object} profileData
 * @returns {string}
 */
export function serializeHCL(profileData) {
    const lines = [
        `schema_version = ${hclValue('7.0')}`,
        `project_name   = ${hclValue(profileData.project_name)}`,
    ];

    if (profileData.description != null) {
        lines.push(`description    = ${hclValue(profileData.description)}`);
    }

    for (const group of profileData.groups || []) {
        lines.push('');
        lines.push(serializeGroup(group, 0));
    }

    lines.push('');
    return lines.join('\n');
}

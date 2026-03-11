/**
 * Core profile data model types and classes.
 * @module core/models/profile
 */

function slugifyName(value, fallback = 'group') {
    const slug = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return slug || fallback;
}

/**
 * @typedef {'resolved'|'skipped'|'unresolved'} ResolutionStatus
 */

/**
 * @typedef {'user_value'|'default_value'|'prompt'|'skipped'} ResolutionSource
 */

/**
 * Dimension model - represents a single configurable field for a service.
 */
export class Dimension {
    /**
     * @param {Object} params
     * @param {string} params.key - The dimension key/label
     * @param {string|number|boolean|null} [params.user_value=null]
     * @param {string|number|boolean|null} [params.default_value=null]
     * @param {string|null} [params.unit=null]
     * @param {string|null} [params.prompt_message=null]
     * @param {boolean} [params.required=true]
     * @param {string|null} [params.resolved_value=null]
     * @param {ResolutionSource|null} [params.resolution_source=null]
     * @param {ResolutionStatus|null} [params.resolution_status=null]
     */
    constructor({
        key,
        user_value = null,
        default_value = null,
        unit = null,
        prompt_message = null,
        required = true,
        resolved_value = null,
        resolution_source = null,
        resolution_status = null
    }) {
        this.key = key;
        this.user_value = user_value;
        this.default_value = default_value;
        this.unit = unit;
        this.prompt_message = prompt_message;
        this.required = required;
        this.resolved_value = resolved_value;
        this.resolution_source = resolution_source;
        this.resolution_status = resolution_status;
    }

    /**
     * Creates a Dimension from a plain object.
     * @param {Object} obj - Plain object with dimension properties
     * @returns {Dimension}
     */
    static fromObject(obj) {
        return new Dimension({
            key: obj.key,
            user_value: obj.user_value ?? null,
            default_value: obj.default_value ?? null,
            unit: obj.unit ?? null,
            prompt_message: obj.prompt_message ?? null,
            required: obj.required ?? true,
            resolved_value: obj.resolved_value ?? null,
            resolution_source: obj.resolution_source ?? null,
            resolution_status: obj.resolution_status ?? null
        });
    }

    /**
     * Converts the dimension to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            user_value: this.user_value,
            default_value: this.default_value,
            unit: this.unit,
            prompt_message: this.prompt_message,
            required: this.required,
            resolved_value: this.resolved_value,
            resolution_source: this.resolution_source,
            resolution_status: this.resolution_status
        };
    }

    /**
     * Checks if the dimension has a resolved value.
     * @returns {boolean}
     */
    isResolved() {
        return this.resolution_status === 'resolved' && this.resolved_value !== null;
    }

    /**
     * Checks if the dimension is required.
     * @returns {boolean}
     */
    isRequired() {
        return this.required;
    }
}

/**
 * ServiceConfigGroup model - recursive grouping for service configuration.
 */
export class ServiceConfigGroup {
    /**
     * @param {Object} params
     * @param {string} params.group_name
     * @param {string|null} [params.label=null]
     * @param {Object.<string, Dimension>} [params.fields={}]
     * @param {ServiceConfigGroup[]} [params.groups=[]]
     */
    constructor({ group_name, label = null, fields = {}, groups = [] }) {
        this.group_name = group_name;
        this.label = label;
        this.fields = fields;
        this.groups = groups;
    }

    /**
     * Creates a ServiceConfigGroup from a plain object.
     * @param {Object} obj
     * @returns {ServiceConfigGroup}
     */
    static fromObject(obj) {
        const fields = {};
        for (const [k, v] of Object.entries(obj.fields || {})) {
            fields[k] = Dimension.fromObject({ key: k, ...v });
        }
        const groups = (obj.groups || []).map(group => ServiceConfigGroup.fromObject(group));
        return new ServiceConfigGroup({
            group_name: obj.group_name || slugifyName(obj.label, 'group'),
            label: obj.label ?? null,
            fields,
            groups,
        });
    }

    /**
     * Convert the config group to a plain object.
     * @returns {Object}
     */
    toObject() {
        const out = {
            group_name: this.group_name,
            fields: {},
        };
        if (this.label !== null) out.label = this.label;
        for (const [k, v] of Object.entries(this.fields)) {
            out.fields[k] = v.toObject();
        }
        if (this.groups && this.groups.length > 0) {
            out.groups = this.groups.map(group => group.toObject());
        }
        return out;
    }

    /**
     * Get all fields recursively from this group and child groups.
     * @returns {Dimension[]}
     */
    getAllFieldsRecursive() {
        const fields = Object.values(this.fields);
        for (const child of this.groups || []) {
            fields.push(...child.getAllFieldsRecursive());
        }
        return fields;
    }
}

function normalizeDimensionMap(dimensions = {}) {
    const out = Object.create(null);
    for (const [key, dimObj] of Object.entries(dimensions)) {
        if (!Object.hasOwn(dimensions, key)) continue;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        out[key] = dimObj instanceof Dimension
            ? dimObj
            : Dimension.fromObject({ key, ...dimObj });
    }
    return Object.assign({}, out);
}

function buildFieldIndex(configGroups = []) {
    const dimensions = {};
    for (const group of configGroups) {
        for (const field of group.getAllFieldsRecursive()) {
            dimensions[field.key] = field;
        }
    }
    return dimensions;
}

function legacyConfigGroupsFromService(dimensions = {}, sections = []) {
    const groups = [];
    const normalizedDimensions = normalizeDimensionMap(dimensions);
    if (Object.keys(normalizedDimensions).length > 0) {
        groups.push(new ServiceConfigGroup({
            group_name: 'general',
            label: 'General',
            fields: normalizedDimensions,
        }));
    }

    for (const section of sections || []) {
        if (!section) continue;
        const label = section.section_name || section.label || section.group_name || 'Section';
        groups.push(new ServiceConfigGroup({
            group_name: section.group_name || slugifyName(label, 'section'),
            label,
            fields: normalizeDimensionMap(section.dimensions || section.fields || {}),
            groups: (section.groups || []).map(group => ServiceConfigGroup.fromObject(group)),
        }));
    }

    return groups;
}

/**
 * Service model - represents an AWS service within a group.
 */
export class Service {
    /**
     * @param {Object} params
     * @param {string} params.service_name
     * @param {string} params.human_label
     * @param {string} params.region
     * @param {Object.<string, Dimension>} [params.dimensions={}]
     * @param {Array<object|ServiceConfigGroup>} [params.config_groups=[]]
     * @param {Array<object>} [params.sections=[]]  Legacy input only
     * @param {Array<object>} [params.gates=[]]
     */
    constructor({ service_name, human_label, region, dimensions = {}, config_groups = [], sections = [], gates = [] }) {
        this.service_name = service_name;
        this.human_label = human_label;
        this.region = region;
        this.gates = gates;

        const normalizedGroups = Array.isArray(config_groups) && config_groups.length > 0
            ? config_groups.map(group => (
                group instanceof ServiceConfigGroup ? group : ServiceConfigGroup.fromObject(group)
            ))
            : legacyConfigGroupsFromService(dimensions, sections);

        this.config_groups = normalizedGroups;
        // Derived compatibility view used by existing resolver/runner code.
        this.dimensions = buildFieldIndex(this.config_groups);
    }

    static fromObject(obj) {
        return new Service({
            service_name: obj.service_name,
            human_label: obj.human_label,
            region: obj.region,
            dimensions: normalizeDimensionMap(obj.dimensions || {}),
            config_groups: (obj.config_groups || []).map(group => ServiceConfigGroup.fromObject(group)),
            sections: obj.sections || [],
            gates: obj.gates || [],
        });
    }

    /**
     * Converts the service to a plain object.
     * @returns {Object}
     */
    toObject() {
        const obj = {
            service_name: this.service_name,
            human_label: this.human_label,
            region: this.region,
            gates: this.gates,
            config_groups: this.config_groups.map(group => group.toObject()),
        };
        return obj;
    }

    /**
     * Gets all dimension values as an array.
     * @returns {Dimension[]}
     */
    getDimensions() {
        return this.config_groups.flatMap(group => group.getAllFieldsRecursive());
    }

    /**
     * Gets a dimension by key.
     * @param {string} key - The dimension key
     * @returns {Dimension|undefined}
     */
    getDimension(key) {
        return this.dimensions[key];
    }

    /**
     * Gets top-level config groups for this service.
     * @returns {ServiceConfigGroup[]}
     */
    getConfigGroups() {
        return this.config_groups;
    }
}

/**
 * Group model - represents a named group of services, with optional nested child groups.
 */
export class Group {
    /**
     * @param {Object} params
     * @param {string} params.group_name
     * @param {Service[]} [params.services=[]]
     * @param {Group[]} [params.groups=[]]  Child groups (nested group support)
     * @param {string|null} [params.label=null]  Optional display label
     */
    constructor({ group_name, services = [], groups = [], label = null }) {
        this.group_name = group_name;
        this.services = services;
        this.groups = groups;
        this.label = label;
    }

    /**
     * Creates a Group from a plain object (recursively handles nested groups).
     * @param {Object} obj - Plain object with group properties
     * @returns {Group}
     */
    static fromObject(obj) {
        const services = (obj.services || []).map(s => Service.fromObject(s));
        const groups = (obj.groups || []).map(g => Group.fromObject(g));
        return new Group({
            group_name: obj.group_name,
            services,
            groups,
            label: obj.label ?? null
        });
    }

    /**
     * Converts the group to a plain object (recursively).
     * @returns {Object}
     */
    toObject() {
        const obj = {
            group_name: this.group_name,
            services: this.services.map(s => s.toObject()),
        };
        if (this.label !== null) obj.label = this.label;
        if (this.groups && this.groups.length > 0) {
            obj.groups = this.groups.map(g => g.toObject());
        }
        return obj;
    }

    /**
     * Adds a service to the group.
     * @param {Service} service
     */
    addService(service) {
        this.services.push(service);
    }

    /**
     * Gets all services directly in this group.
     * @returns {Service[]}
     */
    getServices() {
        return this.services;
    }

    /**
     * Gets all child groups.
     * @returns {Group[]}
     */
    getGroups() {
        return this.groups;
    }

    /**
     * Adds a child group.
     * @param {Group} group
     */
    addGroup(group) {
        this.groups.push(group);
    }

    /**
     * Get all services in this group and all descendant groups (recursive).
     * @returns {Service[]}
     */
    getAllServicesRecursive() {
        const result = [...this.services];
        for (const child of this.groups) {
            result.push(...child.getAllServicesRecursive());
        }
        return result;
    }
}

/**
 * ProfileDocument model - represents a complete cost profile.
 */
export class ProfileDocument {
    /**
     * @param {Object} params
     * @param {string} [params.schema_version='4.0']
     * @param {string} params.project_name
     * @param {string|null} [params.description=null]
     * @param {Group[]} [params.groups=[]]
     */
    constructor({ schema_version = '4.0', project_name, description = null, groups = [] }) {
        this.schema_version = schema_version;
        this.project_name = project_name;
        this.description = description;
        this.groups = groups;
    }

    /**
     * Creates a ProfileDocument from a plain object.
     * @param {Object} obj - Plain object with profile properties
     * @returns {ProfileDocument}
     */
    static fromObject(obj) {
        const groups = (obj.groups || []).map(g => Group.fromObject(g));
        return new ProfileDocument({
            schema_version: obj.schema_version,
            project_name: obj.project_name,
            description: obj.description ?? null,
            groups
        });
    }

    /**
     * Converts the profile to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            schema_version: this.schema_version,
            project_name: this.project_name,
            description: this.description,
            groups: this.groups.map(g => g.toObject())
        };
    }

    /**
     * Adds a group to the profile.
     * @param {Group} group
     */
    addGroup(group) {
        this.groups.push(group);
    }

    /**
     * Gets top-level groups in the profile.
     * @returns {Group[]}
     */
    getGroups() {
        return this.groups;
    }

    /**
     * Gets all services across all groups (recursively through nested groups).
     * @returns {Service[]}
     */
    getAllServices() {
        return this.groups.flatMap(g => g.getAllServicesRecursive());
    }

    /**
     * Validates that schema_version is a supported profile schema version.
     * @returns {boolean}
     */
    hasValidSchemaVersion() {
        return this.schema_version === '5.0'
            || this.schema_version === '4.0'
            || this.schema_version === '3.0'
            || this.schema_version === '2.0';
    }
}

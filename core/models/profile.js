/**
 * Core profile data model types and classes.
 * @module core/models/profile
 */

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
 * Service model - represents an AWS service within a group.
 */
export class Service {
    /**
     * @param {Object} params
     * @param {string} params.service_name
     * @param {string} params.human_label
     * @param {string} params.region
     * @param {Object.<string, Dimension>} [params.dimensions={}]
     */
    constructor({ service_name, human_label, region, dimensions = {} }) {
        this.service_name = service_name;
        this.human_label = human_label;
        this.region = region;
        this.dimensions = dimensions;
    }

    /**
     * Creates a Service from a plain object.
     * @param {Object} obj - Plain object with service properties
     * @returns {Service}
     */
    static fromObject(obj) {
        const dimensions = Object.create(null);
        if (obj.dimensions) {
            for (const [key, dimObj] of Object.entries(obj.dimensions)) {
                if (!Object.hasOwn(obj.dimensions, key)) continue;
                // Guard against prototype-poisoning keys
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
                dimensions[key] = Dimension.fromObject({ key, ...dimObj });
            }
        }
        return new Service({
            service_name: obj.service_name,
            human_label: obj.human_label,
            region: obj.region,
            dimensions: Object.assign({}, dimensions)
        });
    }

    /**
     * Converts the service to a plain object.
     * @returns {Object}
     */
    toObject() {
        const dimensionsObj = {};
        for (const [key, dim] of Object.entries(this.dimensions)) {
            dimensionsObj[key] = dim.toObject();
        }
        return {
            service_name: this.service_name,
            human_label: this.human_label,
            region: this.region,
            dimensions: dimensionsObj
        };
    }

    /**
     * Gets all dimension values as an array.
     * @returns {Dimension[]}
     */
    getDimensions() {
        return Object.values(this.dimensions);
    }

    /**
     * Gets a dimension by key.
     * @param {string} key - The dimension key
     * @returns {Dimension|undefined}
     */
    getDimension(key) {
        return this.dimensions[key];
    }
}

/**
 * Group model - represents a named group of services.
 */
export class Group {
    /**
     * @param {Object} params
     * @param {string} params.group_name
     * @param {Service[]} [params.services=[]]
     */
    constructor({ group_name, services = [] }) {
        this.group_name = group_name;
        this.services = services;
    }

    /**
     * Creates a Group from a plain object.
     * @param {Object} obj - Plain object with group properties
     * @returns {Group}
     */
    static fromObject(obj) {
        const services = (obj.services || []).map(s => Service.fromObject(s));
        return new Group({
            group_name: obj.group_name,
            services
        });
    }

    /**
     * Converts the group to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            group_name: this.group_name,
            services: this.services.map(s => s.toObject())
        };
    }

    /**
     * Adds a service to the group.
     * @param {Service} service
     */
    addService(service) {
        this.services.push(service);
    }

    /**
     * Gets all services in the group.
     * @returns {Service[]}
     */
    getServices() {
        return this.services;
    }
}

/**
 * ProfileDocument model - represents a complete cost profile.
 */
export class ProfileDocument {
    /**
     * @param {Object} params
     * @param {string} [params.schema_version='2.0']
     * @param {string} params.project_name
     * @param {string|null} [params.description=null]
     * @param {Group[]} [params.groups=[]]
     */
    constructor({ schema_version = '2.0', project_name, description = null, groups = [] }) {
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
     * Gets all groups in the profile.
     * @returns {Group[]}
     */
    getGroups() {
        return this.groups;
    }

    /**
     * Gets all services across all groups.
     * @returns {Service[]}
     */
    getAllServices() {
        return this.groups.flatMap(g => g.services);
    }

    /**
     * Validates that schema_version is '2.0'.
     * @returns {boolean}
     */
    hasValidSchemaVersion() {
        return this.schema_version === '2.0';
    }
}

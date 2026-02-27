/**
 * Service catalog data model types and classes.
 * @module core/models/catalog
 */

/**
 * @typedef {'NUMBER'|'TEXT'|'SELECT'|'COMBOBOX'|'TOGGLE'|'RADIO'} FieldType
 */

/**
 * CatalogDimension model - represents a single dimension field in a service catalog.
 */
export class CatalogDimension {
    /**
     * @param {Object} params
     * @param {string} params.key - The dimension key/label
     * @param {FieldType} params.field_type
     * @param {string|number|boolean|null} [params.default_value=null]
     * @param {boolean} [params.required=true]
     * @param {string[]|null} [params.options=null]
     * @param {string|null} [params.unit=null]
     * @param {string|null} [params.unit_sibling=null]
     */
    constructor({
        key,
        field_type,
        default_value = null,
        required = true,
        options = null,
        unit = null,
        unit_sibling = null
    }) {
        this.key = key;
        this.field_type = field_type;
        this.default_value = default_value;
        this.required = required;
        this.options = options;
        this.unit = unit;
        this.unit_sibling = unit_sibling;
    }

    /**
     * Creates a CatalogDimension from a plain object.
     * @param {Object} obj - Plain object with dimension properties
     * @returns {CatalogDimension}
     */
    static fromObject(obj) {
        return new CatalogDimension({
            key: obj.key,
            field_type: obj.field_type,
            default_value: obj.default_value ?? null,
            required: obj.required ?? true,
            options: obj.options ?? null,
            unit: obj.unit ?? null,
            unit_sibling: obj.unit_sibling ?? null
        });
    }

    /**
     * Converts the dimension to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            key: this.key,
            field_type: this.field_type,
            default_value: this.default_value,
            required: this.required,
            options: this.options,
            unit: this.unit,
            unit_sibling: this.unit_sibling
        };
    }

    /**
     * Checks if the dimension is required.
     * @returns {boolean}
     */
    isRequired() {
        return this.required;
    }

    /**
     * Checks if the dimension has options (for SELECT/COMBOBOX/RADIO types).
     * @returns {boolean}
     */
    hasOptions() {
        return Array.isArray(this.options) && this.options.length > 0;
    }

    /**
     * Checks if the dimension has a unit sibling (compound value-unit pair).
     * @returns {boolean}
     */
    hasUnitSibling() {
        return this.unit_sibling !== null && this.unit_sibling !== undefined;
    }

    /**
     * Checks if the dimension is a choice type (SELECT/COMBOBOX/RADIO).
     * @returns {boolean}
     */
    isChoiceType() {
        return ['SELECT', 'COMBOBOX', 'RADIO'].includes(this.field_type);
    }

    /**
     * Checks if the dimension is a numeric type (NUMBER).
     * @returns {boolean}
     */
    isNumericType() {
        return this.field_type === 'NUMBER';
    }

    /**
     * Checks if the dimension is a text type (TEXT).
     * @returns {boolean}
     */
    isTextType() {
        return this.field_type === 'TEXT';
    }

    /**
     * Checks if the dimension is a toggle type (TOGGLE).
     * @returns {boolean}
     */
    isToggleType() {
        return this.field_type === 'TOGGLE';
    }
}

/**
 * ServiceCatalogEntry model - represents a complete service catalog entry.
 */
export class ServiceCatalogEntry {
    /**
     * @param {Object} params
     * @param {string} params.service_name
     * @param {string} params.search_term
     * @param {string} params.calculator_page_title
     * @param {string[]} [params.supported_regions=[]]
     * @param {CatalogDimension[]} [params.dimensions=[]]
     */
    constructor({
        service_name,
        search_term,
        calculator_page_title,
        supported_regions = [],
        dimensions = []
    }) {
        this.service_name = service_name;
        this.search_term = search_term;
        this.calculator_page_title = calculator_page_title;
        this.supported_regions = supported_regions;
        this.dimensions = dimensions;
    }

    /**
     * Creates a ServiceCatalogEntry from a plain object.
     * @param {Object} obj - Plain object with catalog entry properties
     * @returns {ServiceCatalogEntry}
     */
    static fromObject(obj) {
        const dimensions = (obj.dimensions || []).map(d => CatalogDimension.fromObject(d));
        return new ServiceCatalogEntry({
            service_name: obj.service_name,
            search_term: obj.search_term,
            calculator_page_title: obj.calculator_page_title,
            supported_regions: obj.supported_regions || [],
            dimensions
        });
    }

    /**
     * Converts the catalog entry to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            service_name: this.service_name,
            search_term: this.search_term,
            calculator_page_title: this.calculator_page_title,
            supported_regions: this.supported_regions,
            dimensions: this.dimensions.map(d => d.toObject())
        };
    }

    /**
     * Gets a dimension by key.
     * @param {string} key - The dimension key
     * @returns {CatalogDimension|undefined}
     */
    getDimension(key) {
        return this.dimensions.find(d => d.key === key);
    }

    /**
     * Gets all dimensions in the catalog entry.
     * @returns {CatalogDimension[]}
     */
    getDimensions() {
        return this.dimensions;
    }

    /**
     * Gets all required dimensions.
     * @returns {CatalogDimension[]}
     */
    getRequiredDimensions() {
        return this.dimensions.filter(d => d.required);
    }

    /**
     * Gets all optional dimensions.
     * @returns {CatalogDimension[]}
     */
    getOptionalDimensions() {
        return this.dimensions.filter(d => !d.required);
    }

    /**
     * Checks if a region is supported by this service.
     * @param {string} region - The region code to check
     * @returns {boolean}
     */
    supportsRegion(region) {
        return this.supported_regions.includes(region);
    }

    /**
     * Gets all dimensions that have a unit sibling (compound pairs).
     * @returns {CatalogDimension[]}
     */
    getCompoundDimensions() {
        return this.dimensions.filter(d => d.hasUnitSibling());
    }
}

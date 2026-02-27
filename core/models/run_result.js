/**
 * Run result data model types and classes.
 * @module core/models/run_result
 *
 * Status determination algorithm:
 *   - Service level:
 *     - if any dimension failed → "failed"
 *     - if any dimension skipped → "partial_success"
 *     - else → "success"
 *   - Group level:
 *     - if any service failed → "failed"
 *     - if any service partial_success → "partial_success"
 *     - else → "success"
 *   - Run level:
 *     - if any group failed → "failed"
 *     - if any group partial_success → "partial_success"
 *     - else → "success"
 */

/**
 * DimensionResult model - represents the result of filling a single dimension.
 */
export class DimensionResult {
    /**
     * @param {Object} params
     * @param {string} params.key - The dimension key
     * @param {'filled'|'skipped'|'failed'} [params.status='filled']
     * @param {string|null} [params.error_detail=null]
     * @param {string|null} [params.screenshot_path=null]
     */
    constructor({ key, status = 'filled', error_detail = null, screenshot_path = null }) {
        this.key = key;
        this.status = status;
        this.error_detail = error_detail;
        this.screenshot_path = screenshot_path;
    }

    /**
     * Creates a DimensionResult from a plain object.
     * @param {Object} obj - Plain object with result properties
     * @returns {DimensionResult}
     */
    static fromObject(obj) {
        return new DimensionResult({
            key: obj.key,
            status: obj.status ?? 'filled',
            error_detail: obj.error_detail ?? null,
            screenshot_path: obj.screenshot_path ?? null
        });
    }

    /**
     * Converts the result to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            key: this.key,
            status: this.status,
            error_detail: this.error_detail,
            screenshot_path: this.screenshot_path
        };
    }

    /**
     * Checks if the dimension was successfully filled.
     * @returns {boolean}
     */
    isFilled() {
        return this.status === 'filled';
    }

    /**
     * Checks if the dimension was skipped.
     * @returns {boolean}
     */
    isSkipped() {
        return this.status === 'skipped';
    }

    /**
     * Checks if the dimension failed.
     * @returns {boolean}
     */
    isFailed() {
        return this.status === 'failed';
    }
}

/**
 * ServiceMetrics model - represents metrics for a service result.
 */
export class ServiceMetrics {
    /**
     * @param {Object} params
     * @param {number} [params.filled=0]
     * @param {number} [params.skipped=0]
     * @param {number} [params.failed=0]
     */
    constructor({ filled = 0, skipped = 0, failed = 0 }) {
        this.filled = filled;
        this.skipped = skipped;
        this.failed = failed;
    }

    /**
     * Creates ServiceMetrics from a plain object.
     * @param {Object} obj - Plain object with metrics properties
     * @returns {ServiceMetrics}
     */
    static fromObject(obj) {
        return new ServiceMetrics({
            filled: obj.filled ?? 0,
            skipped: obj.skipped ?? 0,
            failed: obj.failed ?? 0
        });
    }

    /**
     * Converts the metrics to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            filled: this.filled,
            skipped: this.skipped,
            failed: this.failed
        };
    }

    /**
     * Gets the total number of dimensions processed.
     * @returns {number}
     */
    getTotal() {
        return this.filled + this.skipped + this.failed;
    }

    /**
     * Creates metrics from an array of DimensionResults.
     * @param {DimensionResult[]} dimensions
     * @returns {ServiceMetrics}
     */
    static fromDimensions(dimensions) {
        let filled = 0;
        let skipped = 0;
        let failed = 0;

        for (const dim of dimensions) {
            if (dim.isFilled()) filled++;
            else if (dim.isSkipped()) skipped++;
            else if (dim.isFailed()) failed++;
        }

        return new ServiceMetrics({ filled, skipped, failed });
    }
}

/**
 * ServiceResult model - represents the result of automating a single service.
 */
export class ServiceResult {
    /**
     * @param {Object} params
     * @param {string} params.service_name
     * @param {string} params.human_label
     * @param {'success'|'partial_success'|'failed'} [params.status='success']
     * @param {ServiceMetrics} [params.metrics]
     * @param {DimensionResult[]} [params.dimensions=[]]
     * @param {string|null} [params.failed_step=null]
     */
    constructor({
        service_name,
        human_label,
        status = 'success',
        metrics,
        dimensions = [],
        failed_step = null
    }) {
        this.service_name = service_name;
        this.human_label = human_label;
        this.dimensions = dimensions;
        this.metrics = metrics || ServiceMetrics.fromDimensions(dimensions);
        this.failed_step = failed_step;
        this.status = status || this.determineStatus();
    }

    /**
     * Creates a ServiceResult from a plain object.
     * @param {Object} obj - Plain object with result properties
     * @returns {ServiceResult}
     */
    static fromObject(obj) {
        const dimensions = (obj.dimensions || []).map(d => DimensionResult.fromObject(d));
        const metrics = obj.metrics ? ServiceMetrics.fromObject(obj.metrics) : ServiceMetrics.fromDimensions(dimensions);
        return new ServiceResult({
            service_name: obj.service_name,
            human_label: obj.human_label,
            status: obj.status ?? 'success',
            metrics,
            dimensions,
            failed_step: obj.failed_step ?? null
        });
    }

    /**
     * Converts the result to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            service_name: this.service_name,
            human_label: this.human_label,
            status: this.status,
            metrics: this.metrics.toObject(),
            dimensions: this.dimensions.map(d => d.toObject()),
            failed_step: this.failed_step
        };
    }

    /**
     * Determines the service status based on dimension results.
     * @returns {'success'|'partial_success'|'failed'}
     */
    determineStatus() {
        if (this.dimensions.some(d => d.isFailed())) {
            return 'failed';
        }
        if (this.dimensions.some(d => d.isSkipped())) {
            return 'partial_success';
        }
        return 'success';
    }

    /**
     * Adds a dimension result.
     * @param {DimensionResult} dimension
     */
    addDimension(dimension) {
        this.dimensions.push(dimension);
        this.metrics = ServiceMetrics.fromDimensions(this.dimensions);
        this.status = this.determineStatus();
    }
}

/**
 * GroupResult model - represents the result of automating a group of services.
 */
export class GroupResult {
    /**
     * @param {Object} params
     * @param {string} params.group_name
     * @param {'success'|'partial_success'|'failed'} [params.status='success']
     * @param {ServiceResult[]} [params.services=[]]
     */
    constructor({ group_name, status = 'success', services = [] }) {
        this.group_name = group_name;
        this.status = status;
        this.services = services;
    }

    /**
     * Creates a GroupResult from a plain object.
     * @param {Object} obj - Plain object with result properties
     * @returns {GroupResult}
     */
    static fromObject(obj) {
        const services = (obj.services || []).map(s => ServiceResult.fromObject(s));
        return new GroupResult({
            group_name: obj.group_name,
            status: obj.status ?? 'success',
            services
        });
    }

    /**
     * Converts the result to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            group_name: this.group_name,
            status: this.status,
            services: this.services.map(s => s.toObject())
        };
    }

    /**
     * Determines the group status based on service results.
     * @returns {'success'|'partial_success'|'failed'}
     */
    determineStatus() {
        if (this.services.some(s => s.status === 'failed')) {
            return 'failed';
        }
        if (this.services.some(s => s.status === 'partial_success')) {
            return 'partial_success';
        }
        return 'success';
    }

    /**
     * Adds a service result.
     * @param {ServiceResult} service
     */
    addService(service) {
        this.services.push(service);
        this.status = this.determineStatus();
    }
}

/**
 * RunResult model - represents the complete result of an automation run.
 */
export class RunResult {
    /**
     * @param {Object} params
     * @param {string} [params.schema_version='2.0']
     * @param {string} params.run_id
     * @param {string} params.profile_name
     * @param {'success'|'partial_success'|'failed'} [params.status='success']
     * @param {string} params.timestamp_start
     * @param {string} params.timestamp_end
     * @param {string} [params.calculator_url='https://calculator.aws/#/estimate']
     * @param {GroupResult[]} [params.groups=[]]
     */
    constructor({
        schema_version = '2.0',
        run_id,
        profile_name,
        status = 'success',
        timestamp_start,
        timestamp_end,
        calculator_url = 'https://calculator.aws/#/estimate',
        groups = []
    }) {
        this.schema_version = schema_version;
        this.run_id = run_id;
        this.profile_name = profile_name;
        this.status = status;
        this.timestamp_start = timestamp_start;
        this.timestamp_end = timestamp_end;
        this.calculator_url = calculator_url;
        this.groups = groups;
    }

    /**
     * Creates a RunResult from a plain object.
     * @param {Object} obj - Plain object with result properties
     * @returns {RunResult}
     */
    static fromObject(obj) {
        const groups = (obj.groups || []).map(g => GroupResult.fromObject(g));
        return new RunResult({
            schema_version: obj.schema_version ?? '2.0',
            run_id: obj.run_id,
            profile_name: obj.profile_name,
            status: obj.status ?? 'success',
            timestamp_start: obj.timestamp_start,
            timestamp_end: obj.timestamp_end,
            calculator_url: obj.calculator_url ?? 'https://calculator.aws/#/estimate',
            groups
        });
    }

    /**
     * Converts the result to a plain object.
     * @returns {Object}
     */
    toObject() {
        return {
            schema_version: this.schema_version,
            run_id: this.run_id,
            profile_name: this.profile_name,
            status: this.status,
            timestamp_start: this.timestamp_start,
            timestamp_end: this.timestamp_end,
            calculator_url: this.calculator_url,
            groups: this.groups.map(g => g.toObject())
        };
    }

    /**
     * Determines the overall run status based on group results.
     * @returns {'success'|'partial_success'|'failed'}
     */
    determineStatus() {
        if (this.groups.some(g => g.status === 'failed')) {
            return 'failed';
        }
        if (this.groups.some(g => g.status === 'partial_success')) {
            return 'partial_success';
        }
        return 'success';
    }

    /**
     * Adds a group result.
     * @param {GroupResult} group
     */
    addGroup(group) {
        this.groups.push(group);
        this.status = this.determineStatus();
    }

    /**
     * Gets the total number of services processed across all groups.
     * @returns {number}
     */
    getTotalServices() {
        return this.groups.reduce((sum, g) => sum + g.services.length, 0);
    }

    /**
     * Gets the total number of dimensions processed across all services.
     * @returns {number}
     */
    getTotalDimensions() {
        return this.groups.reduce((sum, g) => {
            return sum + g.services.reduce((sSum, s) => sSum + s.metrics.getTotal(), 0);
        }, 0);
    }
}

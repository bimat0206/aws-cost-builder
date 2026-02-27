/**
 * Override parser — parse `--set "<group>.<service>.<dimension>=<value>"` expressions.
 * @module core/resolver/override_parser
 *
 * Syntax:
 *   --set "Production.Amazon EC2.Operating System=Linux"
 *   --set "Production.Amazon EC2.Instance type=t3.micro"
 *
 * Format: <groupName>.<serviceName>.<dimensionKey>=<value>
 *
 * Validation:
 *   - Must contain exactly one '=' character
 *   - Must have exactly three '.' segments before the '='
 *   - All segments must be non-empty
 */

// ─── Error Classes ────────────────────────────────────────────────────────────

/**
 * Base error for override parsing failures.
 */
export class OverrideParseError extends Error {
    /**
     * @param {string} message
     * @param {string} rawValue - The raw override string that failed
     */
    constructor(message, rawValue) {
        super(message);
        this.name = 'OverrideParseError';
        this.rawValue = rawValue;
    }
}

/**
 * Invalid syntax error — missing '=', wrong number of segments, etc.
 */
export class OverrideSyntaxError extends OverrideParseError {
    /**
     * @param {string} rawValue
     */
    constructor(rawValue) {
        super(`Invalid override syntax: "${rawValue}". Expected format: <group>.<service>.<dimension>=<value>`, rawValue);
        this.name = 'OverrideSyntaxError';
    }
}

/**
 * Empty segment error — one of the path segments is empty.
 */
export class OverrideEmptySegmentError extends OverrideParseError {
    /**
     * @param {string} rawValue
     * @param {number} segmentIndex - 0-based index of the empty segment
     */
    constructor(rawValue, segmentIndex) {
        const segmentNames = ['group', 'service', 'dimension'];
        super(`Empty ${segmentNames[segmentIndex] || 'segment'} in override: "${rawValue}"`, rawValue);
        this.name = 'OverrideEmptySegmentError';
        this.segmentIndex = segmentIndex;
    }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parsed override result.
 * @typedef {Object} ParsedOverride
 * @property {string} groupName
 * @property {string} serviceName
 * @property {string} dimensionKey
 * @property {string} value
 */

/**
 * Parse a single --set override expression.
 * @param {string} raw - Raw override string: "<group>.<service>.<dimension>=<value>"
 * @returns {ParsedOverride}
 * @throws {OverrideSyntaxError} if syntax is invalid
 * @throws {OverrideEmptySegmentError} if any segment is empty
 */
function parseSingleOverride(raw) {
    // Must contain exactly one '='
    const eqIndex = raw.indexOf('=');
    if (eqIndex === -1) {
        throw new OverrideSyntaxError(raw);
    }

    // Check for multiple '=' characters (only first is valid separator)
    if (raw.indexOf('=', eqIndex + 1) !== -1) {
        // Multiple '=' found — only first is valid, rest are part of value
        // This is actually allowed — value can contain '='
    }

    const pathPart = raw.substring(0, eqIndex);
    const value = raw.substring(eqIndex + 1);

    // Split path into segments
    const segments = pathPart.split('.');

    // Must have exactly 3 segments
    if (segments.length !== 3) {
        throw new OverrideSyntaxError(raw);
    }

    const [groupName, serviceName, dimensionKey] = segments;

    // Validate non-empty segments
    if (groupName === '') {
        throw new OverrideEmptySegmentError(raw, 0);
    }
    if (serviceName === '') {
        throw new OverrideEmptySegmentError(raw, 1);
    }
    if (dimensionKey === '') {
        throw new OverrideEmptySegmentError(raw, 2);
    }

    return {
        groupName,
        serviceName,
        dimensionKey,
        value,
    };
}

/**
 * Parse multiple --set override expressions into a structured map.
 *
 * Map key format: "<groupName>|<serviceName>|<dimensionKey>"
 * This allows efficient lookup during override application.
 *
 * @param {string[]} values - Array of raw override strings
 * @returns {Map<string, ParsedOverride>}
 * @throws {OverrideParseError} if any override has invalid syntax
 */
export function parseOverrides(values) {
    const overrideMap = new Map();

    for (const raw of values) {
        if (!raw || typeof raw !== 'string') {
            throw new OverrideSyntaxError(raw || '');
        }

        const parsed = parseSingleOverride(raw);
        const key = `${parsed.groupName}|${parsed.serviceName}|${parsed.dimensionKey}`;
        overrideMap.set(key, parsed);
    }

    return overrideMap;
}

/**
 * Build a map key from group, service, and dimension names.
 * @param {string} groupName
 * @param {string} serviceName
 * @param {string} dimensionKey
 * @returns {string}
 */
export function buildOverrideKey(groupName, serviceName, dimensionKey) {
    return `${groupName}|${serviceName}|${dimensionKey}`;
}

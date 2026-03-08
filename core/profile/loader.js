/**
 * Profile loader — orchestrates file I/O, JSON parse / HCL parse, schema validation,
 * cross-field validation, and deserialization.
 *
 * Failure layers (FAIL FAST — all throw before browser launch):
 *   F-L1  Profile File I/O
 *   F-L2  JSON/HCL Parsing
 *   F-L3  Schema Validation (JSON profiles only; HCL is pre-validated by parser)
 *   F-L4  Cross-Field Validation
 *
 * Supported file extensions:
 *   .json  — existing JSON profile format (schema v2.0 / v3.0)
 *   .hcl   — new HCL DSL format (schema v3.0)
 *
 * @module core/profile/loader
 */

import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { validateSchema, validateCrossFields, ProfileValidationError } from './validator.js';
import { deserializeProfile } from './serializer.js';

// ─── Base Error Classes ───────────────────────────────────────────────────────

/** Base class for all pre-automation load errors (F-L1, F-L2). */
export class ProfileLoadError extends Error {
    constructor(message, layer) {
        super(message);
        this.name = 'ProfileLoadError';
        this.layer = layer;
    }
}

// ─── F-L1 Error Classes ───────────────────────────────────────────────────────

export class ProfileFileNotFoundError extends ProfileLoadError {
    constructor(path) {
        super(`Profile not found: "${resolve(path)}"`, 'F-L1');
        this.name = 'ProfileFileNotFoundError';
        this.path = resolve(path);
    }
}

export class ProfilePermissionError extends ProfileLoadError {
    constructor(path) {
        super(`Permission denied reading profile: "${resolve(path)}"`, 'F-L1');
        this.name = 'ProfilePermissionError';
        this.path = resolve(path);
    }
}

export class ProfileEncodingError extends ProfileLoadError {
    constructor(path) {
        super(`Profile file is not valid UTF-8: "${resolve(path)}"`, 'F-L1');
        this.name = 'ProfileEncodingError';
        this.path = resolve(path);
    }
}

// ─── F-L2 Error Classes ───────────────────────────────────────────────────────

export class ProfileJSONParseError extends ProfileLoadError {
    constructor(path, cause) {
        super(`Failed to parse profile JSON in "${resolve(path)}": ${cause ? cause.message : ''}`, 'F-L2');
        this.name = 'ProfileJSONParseError';
        this.path = resolve(path);
        this.cause = cause;
    }
}

export class ProfileHCLParseError extends ProfileLoadError {
    constructor(path, cause) {
        super(`Failed to parse profile HCL in "${resolve(path)}": ${cause ? cause.message : ''}`, 'F-L2');
        this.name = 'ProfileHCLParseError';
        this.path = resolve(path);
        this.cause = cause;
    }
}

// ─── F-L3 Error Class ─────────────────────────────────────────────────────────

export class ProfileSchemaValidationError extends ProfileValidationError {
    constructor(path, errors) {
        super(errors);
        this.name = 'ProfileSchemaValidationError';
        this.layer = 'F-L3';
        this.path = path;
    }
}

// ─── F-L4 Error Class ─────────────────────────────────────────────────────────

export class ProfileCrossValidationError extends ProfileValidationError {
    /**
     * @param {string} path
     * @param {string[]} errors
     * @param {'service'|'region'|'dimension'} violationType
     */
    constructor(path, errors, violationType) {
        super(errors);
        this.name = 'ProfileCrossValidationError';
        this.layer = 'F-L4';
        this.path = path;
        this.violationType = violationType;
    }
}

// Re-export cross-field subclasses from validator for convenience
export {
    ProfileValidationError,
    CrossValidationServiceCatalogError,
    CrossValidationRegionMapError,
    CrossValidationDimensionKeyError,
    CrossValidationRequirementError,
} from './validator.js';

// ─── Main loader ─────────────────────────────────────────────────────────────

/**
 * Load, validate, and deserialize a profile file (.json or .hcl).
 *
 * @param {string} profilePath - Absolute or relative path to the profile file
 * @param {Array} [catalog] - Optional pre-loaded catalog (for testing)
 * @param {object} [regionMap] - Optional pre-loaded region map (for testing)
 * @returns {Promise<import('../models/profile.js').ProfileDocument>}
 */
export async function loadProfile(profilePath, catalog, regionMap) {
    // ── F-L0: Security ────────────────────────────────────────────────────────
    const resolvedPath = resolve(profilePath);
    const safeBase = resolve(process.cwd());
    if (!resolvedPath.startsWith(safeBase + sep) && resolvedPath !== safeBase) {
        throw new ProfilePermissionError(profilePath);
    }

    // ── F-L1: File I/O ────────────────────────────────────────────────────────
    let raw;
    try {
        raw = await readFile(resolvedPath, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') throw new ProfileFileNotFoundError(profilePath);
        if (err.code === 'EACCES' || err.code === 'EPERM') throw new ProfilePermissionError(profilePath);
        throw new ProfileEncodingError(profilePath);
    }

    // ── F-L2: Parse (JSON or HCL) ────────────────────────────────────────────
    const ext = extname(resolvedPath).toLowerCase();
    let profileData;

    if (ext === '.hcl') {
        try {
            const { parseHCL } = await import('../../hcl/index.js');
            profileData = parseHCL(raw);
        } catch (err) {
            throw new ProfileHCLParseError(profilePath, err);
        }
    } else {
        try {
            profileData = JSON.parse(raw);
        } catch (err) {
            throw new ProfileJSONParseError(profilePath, err);
        }

        // ── F-L3: Schema Validation (JSON only) ───────────────────────────────
        try {
            validateSchema(profileData);
        } catch (err) {
            throw new ProfileSchemaValidationError(profilePath, err.errors || [err.message]);
        }
    }

    // ── F-L4: Cross-Field Validation ──────────────────────────────────────────
    if (!catalog) {
        const { loadAllCatalogs } = await import('../../config/loader/index.js');
        catalog = await loadAllCatalogs();
    }
    if (!regionMap) {
        const { readFile: rf } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = fileURLToPath(new URL('.', import.meta.url));
        const raw = await rf(join(__dirname, '../../config/data/region_map.json'), 'utf-8');
        regionMap = JSON.parse(raw);
    }

    try {
        validateCrossFields(profileData, catalog, regionMap);
    } catch (err) {
        let violationType = 'dimension';
        const ctor = err.constructor.name;
        if (ctor === 'CrossValidationServiceCatalogError') violationType = 'service';
        else if (ctor === 'CrossValidationRegionMapError') violationType = 'region';
        throw new ProfileCrossValidationError(profilePath, err.errors || [err.message], violationType);
    }

    // ── Deserialize ───────────────────────────────────────────────────────────
    return deserializeProfile(JSON.stringify(profileData));
}

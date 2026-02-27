// schema_validator.js
// Validates catalog entries against the ServiceCatalogEntry schema using AJV.

import Ajv from 'ajv';
import catalogSchema from '../schemas/catalog-schema.json' with { type: 'json' };
import profileSchema from '../schemas/json-schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false });

// Compile validators
const _validateCatalogEntry = ajv.compile(catalogSchema);
const _validateProfileDocument = ajv.compile(profileSchema);

/**
 * Validates a catalog entry object against the ServiceCatalogEntry schema.
 * @param {object} entry - The catalog entry to validate
 * @param {string} sourceFile - The source filename for error reporting
 * @throws {Error} Throws a descriptive error if validation fails
 */
export function validateCatalogEntry(entry, sourceFile) {
    const valid = _validateCatalogEntry(entry);
    
    if (!valid) {
        const errors = _validateCatalogEntry.errors || [];
        const errorMessages = errors.map(err => {
            const path = err.instancePath || '/';
            const message = err.message || 'Unknown validation error';
            return `  - ${path}: ${message}`;
        }).join('\n');
        
        throw new Error(
            `Catalog validation failed for "${sourceFile}":\n${errorMessages}`
        );
    }
}

/**
 * Validates a profile object against the ProfileDocument schema.
 * @param {object} profile - The profile to validate
 * @param {string} sourceFile - The source filename for error reporting
 * @throws {Error} Throws a descriptive error if validation fails
 */
export function validateProfile(profile, sourceFile) {
    const valid = _validateProfileDocument(profile);
    
    if (!valid) {
        const errors = _validateProfileDocument.errors || [];
        const errorMessages = errors.map(err => {
            const path = err.instancePath || '/';
            const message = err.message || 'Unknown validation error';
            return `  - ${path}: ${message}`;
        }).join('\n');
        
        throw new Error(
            `Profile validation failed for "${sourceFile}":\n${errorMessages}`
        );
    }
}

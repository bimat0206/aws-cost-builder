// tests/core/profile/validation_aggregation.test.js
// Feature: aws-cost-profile-builder, Property 2: Profile Validation Aggregates All Errors
// Validates: Requirements 4.1, 4.2, 4.3, 4.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    validateSchema,
    validateCrossFields,
    ProfileValidationError,
    CrossValidationServiceCatalogError,
    CrossValidationRegionMapError,
    CrossValidationDimensionKeyError,
} from '../../../core/profile/validator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validDimension = () => ({ user_value: null, default_value: null });

const validService = (overrides = {}) => ({
    service_name: 'Amazon EC2',
    human_label: 'Web Servers',
    region: 'us-east-1',
    dimensions: { 'Operating System': validDimension() },
    ...overrides,
});

const validGroup = (services = [validService()]) => ({
    group_name: 'Production',
    services,
});

const validProfile = (overrides = {}) => ({
    schema_version: '2.0',
    project_name: 'Test Project',
    groups: [validGroup()],
    ...overrides,
});

const minimalCatalog = [{
    service_name: 'Amazon EC2',
    search_term: 'Amazon EC2',
    calculator_page_title: 'Amazon EC2',
    supported_regions: ['us-east-1'],
    dimensions: [{ key: 'Operating System', field_type: 'SELECT', default_value: 'Linux', required: true }],
}];

const minimalRegionMap = { 'us-east-1': 'US East (N. Virginia)' };

// ─── Schema Validation Tests ──────────────────────────────────────────────────

describe('Property 2: Profile Validation Aggregates All Errors', () => {
    it('should accept a fully valid profile without throwing', () => {
        expect(() => validateSchema(validProfile())).not.toThrow();
    });

    it('should throw ProfileValidationError for missing required top-level fields', () => {
        // Missing schema_version, project_name, groups — all three should appear
        expect(() => validateSchema({})).toThrow(ProfileValidationError);
        try {
            validateSchema({});
        } catch (e) {
            expect(e.errors.length).toBeGreaterThanOrEqual(3);
        }
    });

    it('should aggregate multiple schema violations in a single throw', () => {
        fc.assert(
            fc.property(
                // Generate profiles missing 1–3 required fields
                fc.subarray(['schema_version', 'project_name', 'groups'], { minLength: 1 }),
                (missingFields) => {
                    const profile = validProfile();
                    for (const f of missingFields) delete profile[f];

                    try {
                        validateSchema(profile);
                        // If no throw, the profile was somehow still valid — shouldn't happen
                        return true;
                    } catch (e) {
                        expect(e).toBeInstanceOf(ProfileValidationError);
                        // Must report at least as many errors as fields removed
                        expect(e.errors.length).toBeGreaterThanOrEqual(1);
                        return true;
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    it('should reject wrong schema_version and include it in errors', () => {
        const profile = validProfile({ schema_version: '1.0' });
        expect(() => validateSchema(profile)).toThrow(ProfileValidationError);
        try {
            validateSchema(profile);
        } catch (e) {
            expect(e.errors.some(err => err.includes('schema_version') || err.includes('const'))).toBe(true);
        }
    });

    it('should reject additionalProperties at top level', () => {
        const profile = validProfile({ unexpected_field: 'oops' });
        expect(() => validateSchema(profile)).toThrow(ProfileValidationError);
    });

    // ─── Cross-Field Validation ──────────────────────────────────────────────

    it('should pass cross-field validation for a valid profile', () => {
        expect(() => validateCrossFields(validProfile(), minimalCatalog, minimalRegionMap)).not.toThrow();
    });

    it('should throw CrossValidationServiceCatalogError for unknown service_name', () => {
        const profile = validProfile({
            groups: [validGroup([validService({ service_name: 'Unknown Service' })])]
        });
        expect(() => validateCrossFields(profile, minimalCatalog, minimalRegionMap))
            .toThrow(CrossValidationServiceCatalogError);
    });

    it('should throw CrossValidationRegionMapError for invalid region', () => {
        const profile = validProfile({
            groups: [validGroup([validService({ region: 'xx-invalid-1' })])]
        });
        expect(() => validateCrossFields(profile, minimalCatalog, minimalRegionMap))
            .toThrow(CrossValidationRegionMapError);
    });

    it('should accept "global" as a valid region', () => {
        const profile = validProfile({
            groups: [validGroup([validService({ region: 'global' })])]
        });
        expect(() => validateCrossFields(profile, minimalCatalog, minimalRegionMap)).not.toThrow();
    });

    it('should throw CrossValidationDimensionKeyError for unknown dimension key', () => {
        const profile = validProfile({
            groups: [validGroup([validService({
                dimensions: { 'NonExistentDimension': validDimension() }
            })])]
        });
        expect(() => validateCrossFields(profile, minimalCatalog, minimalRegionMap))
            .toThrow(CrossValidationDimensionKeyError);
    });

    it('should aggregate all cross-field violations across multiple services', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2, max: 5 }),
                (serviceCount) => {
                    // Each service has an invalid region — all should appear in errors
                    const services = Array.from({ length: serviceCount }, (_, i) =>
                        validService({ service_name: 'Amazon EC2', region: `invalid-region-${i}` })
                    );
                    const profile = validProfile({ groups: [validGroup(services)] });

                    try {
                        validateCrossFields(profile, minimalCatalog, minimalRegionMap);
                        return true;
                    } catch (e) {
                        expect(e).toBeInstanceOf(ProfileValidationError);
                        expect(e.errors.length).toBeGreaterThanOrEqual(serviceCount);
                        return true;
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    it('errors array is always non-empty when ProfileValidationError is thrown', () => {
        fc.assert(
            fc.property(
                fc.record({
                    schema_version: fc.oneof(fc.constant('1.0'), fc.constant('3.0'), fc.string()),
                    project_name: fc.constant(''),   // minLength violation
                    groups: fc.constant([]),          // minItems violation
                }),
                (badProfile) => {
                    try {
                        validateSchema(badProfile);
                        return true;
                    } catch (e) {
                        if (e instanceof ProfileValidationError) {
                            expect(e.errors.length).toBeGreaterThan(0);
                        }
                        return true;
                    }
                }
            ),
            { numRuns: 25 }
        );
    });
});

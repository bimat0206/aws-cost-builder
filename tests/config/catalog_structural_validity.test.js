// tests/config/catalog_structural_validity.test.js
// Property test for catalog entry structural validity.
// Feature: aws-cost-profile-builder, Property 3: Catalog Entry Structural Validity
// Validates: Requirements 3.3, 3.5, 3.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateCatalogEntry as validateEntry } from '../../config/loader/schema_validator.js';

describe('Catalog Entry Structural Validity', () => {
    // Feature: aws-cost-profile-builder, Property 3: Catalog Entry Structural Validity
    // Validates: Requirements 3.3, 3.5, 3.6
    
    it('should validate all catalog entries in the services directory', async () => {
        const { loadAllCatalogs } = await import('../../config/loader/index.js');
        
        // Clear cache to ensure fresh load
        const { clearCatalogCache } = await import('../../config/loader/index.js');
        clearCatalogCache();
        
        const catalogs = await loadAllCatalogs();
        
        expect(catalogs.length).toBeGreaterThan(0);
        
        for (const catalog of catalogs) {
            // Validate required top-level fields
            expect(catalog).toHaveProperty('service_name');
            expect(catalog).toHaveProperty('search_term');
            expect(catalog).toHaveProperty('calculator_page_title');
            expect(catalog).toHaveProperty('supported_regions');
            expect(catalog).toHaveProperty('dimensions');
            
            expect(typeof catalog.service_name).toBe('string');
            expect(catalog.service_name.length).toBeGreaterThan(0);
            expect(typeof catalog.search_term).toBe('string');
            expect(catalog.search_term.length).toBeGreaterThan(0);
            expect(typeof catalog.calculator_page_title).toBe('string');
            expect(catalog.calculator_page_title.length).toBeGreaterThan(0);
            expect(Array.isArray(catalog.supported_regions)).toBe(true);
            expect(catalog.supported_regions.length).toBeGreaterThan(0);
            expect(Array.isArray(catalog.dimensions)).toBe(true);
            expect(catalog.dimensions.length).toBeGreaterThan(0);
            
            // Validate each dimension
            for (const dim of catalog.dimensions) {
                expect(dim).toHaveProperty('key');
                expect(dim).toHaveProperty('field_type');
                expect(dim).toHaveProperty('default_value');
                expect(dim).toHaveProperty('required');
                
                expect(typeof dim.key).toBe('string');
                expect(dim.key.length).toBeGreaterThan(0);
                expect(typeof dim.field_type).toBe('string');
                expect(['NUMBER', 'TEXT', 'SELECT', 'COMBOBOX', 'TOGGLE', 'RADIO']).toContain(dim.field_type);
                expect(typeof dim.required).toBe('boolean');
                
                // Validate field_type-specific constraints
                // Note: options can be null for some SELECT/COMBOBOX/RADIO fields
                if (dim.options !== null) {
                    expect(Array.isArray(dim.options)).toBe(true);
                    expect(dim.options.length).toBeGreaterThan(0);
                }
                
                // Validate unit_sibling pairing
                if (dim.unit_sibling !== null) {
                    expect(typeof dim.unit_sibling).toBe('string');
                    // The sibling should exist in the same catalog
                    const siblingExists = catalog.dimensions.some(d => d.key === dim.unit_sibling);
                    expect(siblingExists).toBe(true);
                }
            }
        }
    });
    
    it('should reject catalog entries with missing required fields', () => {
        fc.assert(
            fc.property(
                fc.record({
                    search_term: fc.string(),
                    calculator_page_title: fc.string(),
                    supported_regions: fc.array(fc.string()).filter(arr => arr.length > 0),
                    dimensions: fc.array(
                        fc.record({
                            key: fc.string(),
                            field_type: fc.constantFrom('NUMBER', 'TEXT', 'SELECT', 'COMBOBOX', 'TOGGLE', 'RADIO'),
                            default_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                            required: fc.boolean()
                        })
                    ).filter(arr => arr.length > 0)
                }),
                (incompleteCatalog) => {
                    // Missing service_name should fail validation
                    expect(() => {
                        validateEntry(incompleteCatalog, 'test_incomplete.json');
                    }).toThrow();
                }
            ),
            { numRuns: 25 }
        );
    });
    
    it('should reject catalog entries with invalid field_type values', () => {
        fc.assert(
            fc.property(
                fc.record({
                    service_name: fc.string(),
                    search_term: fc.string(),
                    calculator_page_title: fc.string(),
                    supported_regions: fc.array(fc.string()).filter(arr => arr.length > 0),
                    dimensions: fc.array(
                        fc.record({
                            key: fc.string(),
                            field_type: fc.string().filter(s => !['NUMBER', 'TEXT', 'SELECT', 'COMBOBOX', 'TOGGLE', 'RADIO'].includes(s)),
                            default_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                            required: fc.boolean()
                        })
                    ).filter(arr => arr.length > 0)
                }),
                (invalidCatalog) => {
                    // Invalid field_type should fail validation
                    expect(() => {
                        validateEntry(invalidCatalog, 'test_invalid_field_type.json');
                    }).toThrow();
                }
            ),
            { numRuns: 25 }
        );
    });
    
    it('should accept valid catalog entries with all optional fields', () => {
        fc.assert(
            fc.property(
                fc.record({
                    service_name: fc.string().filter(s => s.length > 0),
                    search_term: fc.string().filter(s => s.length > 0),
                    calculator_page_title: fc.string().filter(s => s.length > 0),
                    supported_regions: fc.array(fc.string()).filter(arr => arr.length > 0),
                    dimensions: fc.array(
                        fc.record({
                            key: fc.string().filter(s => s.length > 0),
                            field_type: fc.constantFrom('NUMBER', 'TEXT', 'SELECT', 'COMBOBOX', 'TOGGLE', 'RADIO'),
                            default_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                            required: fc.boolean(),
                            options: fc.oneof(fc.array(fc.string()), fc.constant(null)),
                            unit: fc.oneof(fc.string(), fc.constant(null)),
                            unit_sibling: fc.oneof(fc.string(), fc.constant(null))
                        })
                    ).filter(arr => arr.length > 0)
                }),
                (validCatalog) => {
                    // Valid catalog should not throw
                    expect(() => {
                        validateEntry(validCatalog, 'test_valid.json');
                    }).not.toThrow();
                }
            ),
            { numRuns: 25 }
        );
    });
});

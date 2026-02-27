// tests/core/models/catalog.test.js
// Property tests for core catalog models.
// Feature: aws-cost-profile-builder, Property 2: Catalog Model Correctness
// Validates: Requirements 1.6, 3.5, 3.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CatalogDimension, ServiceCatalogEntry } from '../../../core/models/catalog.js';

describe('Catalog Models', () => {
    describe('CatalogDimension', () => {
        it('should create a dimension with default values', () => {
            const dim = new CatalogDimension({
                key: 'Test Dimension',
                field_type: 'NUMBER'
            });
            
            expect(dim.key).toBe('Test Dimension');
            expect(dim.field_type).toBe('NUMBER');
            expect(dim.default_value).toBe(null);
            expect(dim.required).toBe(true);
            expect(dim.options).toBe(null);
            expect(dim.unit).toBe(null);
            expect(dim.unit_sibling).toBe(null);
        });

        it('should identify field types correctly', () => {
            const number = new CatalogDimension({ key: 'N', field_type: 'NUMBER' });
            const text = new CatalogDimension({ key: 'T', field_type: 'TEXT' });
            const select = new CatalogDimension({ key: 'S', field_type: 'SELECT' });
            const toggle = new CatalogDimension({ key: 'G', field_type: 'TOGGLE' });
            
            expect(number.isNumericType()).toBe(true);
            expect(text.isTextType()).toBe(true);
            expect(select.isChoiceType()).toBe(true);
            expect(toggle.isToggleType()).toBe(true);
        });

        it('should identify compound dimensions with unit siblings', () => {
            const compound = new CatalogDimension({
                key: 'Amount',
                field_type: 'NUMBER',
                unit: 'GB',
                unit_sibling: 'Unit'
            });
            const single = new CatalogDimension({
                key: 'Count',
                field_type: 'NUMBER'
            });
            
            expect(compound.hasUnitSibling()).toBe(true);
            expect(single.hasUnitSibling()).toBe(false);
        });

        it('should convert dimension to object and back (round-trip)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        key: fc.string().filter(s => s.length > 0),
                        field_type: fc.constantFrom('NUMBER', 'TEXT', 'SELECT', 'COMBOBOX', 'TOGGLE', 'RADIO'),
                        default_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                        required: fc.boolean(),
                        options: fc.oneof(fc.array(fc.string()), fc.constant(null)),
                        unit: fc.oneof(fc.string(), fc.constant(null)),
                        unit_sibling: fc.oneof(fc.string(), fc.constant(null))
                    }),
                    (obj) => {
                        const dim = CatalogDimension.fromObject(obj);
                        const back = dim.toObject();
                        
                        expect(back.key).toBe(obj.key);
                        expect(back.field_type).toBe(obj.field_type);
                        expect(back.required).toBe(obj.required);
                    }
                ),
                { numRuns: 25 }
            );
        });
    });

    describe('ServiceCatalogEntry', () => {
        it('should create a catalog entry with dimensions', () => {
            const entry = new ServiceCatalogEntry({
                service_name: 'Amazon EC2',
                search_term: 'EC2',
                calculator_page_title: 'Amazon EC2',
                supported_regions: ['us-east-1', 'us-west-2'],
                dimensions: [
                    new CatalogDimension({ key: 'Instance type', field_type: 'COMBOBOX' })
                ]
            });
            
            expect(entry.service_name).toBe('Amazon EC2');
            expect(entry.supported_regions.length).toBe(2);
            expect(entry.getDimensions().length).toBe(1);
        });

        it('should filter required and optional dimensions', () => {
            const entry = new ServiceCatalogEntry({
                service_name: 'Test',
                search_term: 'Test',
                calculator_page_title: 'Test',
                dimensions: [
                    new CatalogDimension({ key: 'Required', field_type: 'NUMBER', required: true }),
                    new CatalogDimension({ key: 'Optional', field_type: 'NUMBER', required: false })
                ]
            });
            
            expect(entry.getRequiredDimensions().length).toBe(1);
            expect(entry.getOptionalDimensions().length).toBe(1);
        });

        it('should check region support', () => {
            const entry = new ServiceCatalogEntry({
                service_name: 'Test',
                search_term: 'Test',
                calculator_page_title: 'Test',
                supported_regions: ['us-east-1', 'eu-west-1']
            });
            
            expect(entry.supportsRegion('us-east-1')).toBe(true);
            expect(entry.supportsRegion('ap-northeast-1')).toBe(false);
        });

        it('should convert catalog entry to object and back (round-trip)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        service_name: fc.string().filter(s => s.length > 0),
                        search_term: fc.string().filter(s => s.length > 0),
                        calculator_page_title: fc.string().filter(s => s.length > 0),
                        supported_regions: fc.array(fc.string())
                    }),
                    (obj) => {
                        const entry = new ServiceCatalogEntry(obj);
                        const back = ServiceCatalogEntry.fromObject(entry.toObject());
                        
                        expect(back.service_name).toBe(obj.service_name);
                        expect(back.search_term).toBe(obj.search_term);
                        expect(back.calculator_page_title).toBe(obj.calculator_page_title);
                    }
                ),
                { numRuns: 25 }
            );
        });
    });
});

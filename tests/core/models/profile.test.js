// tests/core/models/profile.test.js
// Property tests for core profile models.
// Feature: aws-cost-profile-builder, Property 1: Profile Model Correctness
// Validates: Requirements 1.6, 4.5, 14.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Dimension, Service, Group, ProfileDocument } from '../../../core/models/profile.js';

describe('Profile Models', () => {
    describe('Dimension', () => {
        it('should create a dimension with default values', () => {
            const dim = new Dimension({ key: 'Test Dimension' });
            
            expect(dim.key).toBe('Test Dimension');
            expect(dim.user_value).toBe(null);
            expect(dim.default_value).toBe(null);
            expect(dim.unit).toBe(null);
            expect(dim.prompt_message).toBe(null);
            expect(dim.required).toBe(true);
            expect(dim.resolved_value).toBe(null);
            expect(dim.resolution_source).toBe(null);
            expect(dim.resolution_status).toBe(null);
        });

        it('should create a dimension from object', () => {
            const obj = {
                key: 'Test',
                user_value: 100,
                default_value: 50,
                unit: 'GB',
                required: false,
                resolved_value: 100,
                resolution_source: 'user_value',
                resolution_status: 'resolved'
            };
            
            const dim = Dimension.fromObject(obj);
            
            expect(dim.user_value).toBe(100);
            expect(dim.default_value).toBe(50);
            expect(dim.unit).toBe('GB');
            expect(dim.required).toBe(false);
            expect(dim.resolved_value).toBe(100);
            expect(dim.resolution_source).toBe('user_value');
            expect(dim.resolution_status).toBe('resolved');
        });

        it('should convert dimension to object and back (round-trip)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        key: fc.string().filter(s => s.length > 0),
                        user_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                        default_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                        unit: fc.oneof(fc.string(), fc.constant(null)),
                        prompt_message: fc.oneof(fc.string(), fc.constant(null)),
                        required: fc.boolean(),
                        resolved_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                        resolution_source: fc.oneof(
                            fc.constant('user_value'),
                            fc.constant('default_value'),
                            fc.constant('prompt'),
                            fc.constant('skipped'),
                            fc.constant(null)
                        ),
                        resolution_status: fc.oneof(
                            fc.constant('resolved'),
                            fc.constant('skipped'),
                            fc.constant('unresolved'),
                            fc.constant(null)
                        )
                    }),
                    (obj) => {
                        const dim = Dimension.fromObject(obj);
                        const back = dim.toObject();
                        
                        expect(back.user_value).toBe(obj.user_value);
                        expect(back.default_value).toBe(obj.default_value);
                        expect(back.unit).toBe(obj.unit);
                        expect(back.required).toBe(obj.required);
                    }
                ),
                { numRuns: 25 }
            );
        });

        it('should correctly identify resolved dimensions', () => {
            const resolved = new Dimension({ 
                key: 'Test', 
                resolved_value: 100, 
                resolution_status: 'resolved' 
            });
            const unresolved = new Dimension({ 
                key: 'Test', 
                resolution_status: 'unresolved' 
            });
            
            expect(resolved.isResolved()).toBe(true);
            expect(unresolved.isResolved()).toBe(false);
        });
    });

    describe('Service', () => {
        it('should create a service with dimensions', () => {
            const service = new Service({
                service_name: 'Amazon EC2',
                human_label: 'Amazon EC2',
                region: 'us-east-1',
                dimensions: {
                    'Instance type': new Dimension({ key: 'Instance type', default_value: 't3.micro' })
                }
            });
            
            expect(service.service_name).toBe('Amazon EC2');
            expect(service.region).toBe('us-east-1');
            expect(service.getDimensions().length).toBe(1);
        });

        it('should convert service to object and back (round-trip)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        service_name: fc.string().filter(s => s.length > 0),
                        human_label: fc.string().filter(s => s.length > 0),
                        region: fc.oneof(fc.string(), fc.constant('global'))
                    }),
                    (obj) => {
                        const service = new Service(obj);
                        const back = Service.fromObject(service.toObject());
                        
                        expect(back.service_name).toBe(obj.service_name);
                        expect(back.human_label).toBe(obj.human_label);
                        expect(back.region).toBe(obj.region);
                    }
                ),
                { numRuns: 25 }
            );
        });
    });

    describe('Group', () => {
        it('should create a group with services', () => {
            const group = new Group({ group_name: 'Production' });
            const service = new Service({
                service_name: 'Amazon EC2',
                human_label: 'Amazon EC2',
                region: 'us-east-1'
            });
            
            group.addService(service);
            
            expect(group.group_name).toBe('Production');
            expect(group.getServices().length).toBe(1);
        });

        it('should convert group to object and back (round-trip)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        group_name: fc.string().filter(s => s.length > 0)
                    }),
                    (obj) => {
                        const group = new Group(obj);
                        const back = Group.fromObject(group.toObject());
                        
                        expect(back.group_name).toBe(obj.group_name);
                    }
                ),
                { numRuns: 25 }
            );
        });
    });

    describe('ProfileDocument', () => {
        it('should create a profile with default schema version 2.0', () => {
            const profile = new ProfileDocument({
                project_name: 'Test Project'
            });
            
            expect(profile.schema_version).toBe('2.0');
            expect(profile.project_name).toBe('Test Project');
            expect(profile.hasValidSchemaVersion()).toBe(true);
        });

        it('should create a profile from object with groups', () => {
            const obj = {
                schema_version: '2.0',
                project_name: 'Test Project',
                description: 'A test project',
                groups: [
                    {
                        group_name: 'Production',
                        services: [
                            {
                                service_name: 'Amazon EC2',
                                human_label: 'Amazon EC2',
                                region: 'us-east-1',
                                dimensions: {}
                            }
                        ]
                    }
                ]
            };
            
            const profile = ProfileDocument.fromObject(obj);
            
            expect(profile.groups.length).toBe(1);
            expect(profile.groups[0].group_name).toBe('Production');
            expect(profile.groups[0].getServices().length).toBe(1);
        });

        it('should convert profile to object and back (round-trip)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        schema_version: fc.constant('2.0'),
                        project_name: fc.string().filter(s => s.length > 0),
                        description: fc.oneof(fc.string(), fc.constant(null))
                    }),
                    (obj) => {
                        const profile = new ProfileDocument(obj);
                        const back = ProfileDocument.fromObject(profile.toObject());
                        
                        expect(back.schema_version).toBe(obj.schema_version);
                        expect(back.project_name).toBe(obj.project_name);
                        expect(back.description).toBe(obj.description);
                    }
                ),
                { numRuns: 25 }
            );
        });

        it('should get all services across groups', () => {
            const profile = new ProfileDocument({
                project_name: 'Test',
                groups: [
                    new Group({ 
                        group_name: 'Group1',
                        services: [
                            new Service({ service_name: 'EC2', human_label: 'EC2', region: 'us-east-1' }),
                            new Service({ service_name: 'S3', human_label: 'S3', region: 'us-east-1' })
                        ]
                    }),
                    new Group({ 
                        group_name: 'Group2',
                        services: [
                            new Service({ service_name: 'Lambda', human_label: 'Lambda', region: 'us-east-1' })
                        ]
                    })
                ]
            });
            
            const allServices = profile.getAllServices();
            
            expect(allServices.length).toBe(3);
            expect(allServices.map(s => s.service_name)).toEqual(['EC2', 'S3', 'Lambda']);
        });
    });
});

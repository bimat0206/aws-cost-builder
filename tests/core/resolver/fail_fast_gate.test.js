// tests/core/resolver/fail_fast_gate.test.js
// Feature: aws-cost-profile-builder, Property 6: Fail-Fast Gate Before Browser Launch
// Validates: Requirements 5.5, 10.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    resolveDimensions,
    assertNoUnresolved,
    ResolutionError,
} from '../../../core/resolver/priority_chain.js';
import { ProfileDocument, Group, Service, Dimension } from '../../../core/models/profile.js';

// ─── Property 6: Fail-Fast Gate Before Browser Launch ────────────────────────

describe('Property 6: Fail-Fast Gate Before Browser Launch', () => {
    it('assertNoUnresolved throws when required dimensions are unresolved', () => {
        const profile = new ProfileDocument({
            schema_version: '2.0',
            project_name: 'Test',
            groups: [
                new Group({
                    group_name: 'Production',
                    services: [
                        new Service({
                            service_name: 'EC2',
                            human_label: 'Web',
                            region: 'us-east-1',
                            dimensions: {
                                'Instance': new Dimension({
                                    key: 'Instance',
                                    user_value: null,
                                    default_value: null,
                                    required: true,
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        // Should throw ResolutionError
        expect(() => assertNoUnresolved(unresolved)).toThrow(ResolutionError);
    });

    it('assertNoUnresolved does not throw when all required are resolved', () => {
        const profile = new ProfileDocument({
            schema_version: '2.0',
            project_name: 'Test',
            groups: [
                new Group({
                    group_name: 'Production',
                    services: [
                        new Service({
                            service_name: 'EC2',
                            human_label: 'Web',
                            region: 'us-east-1',
                            dimensions: {
                                'Instance': new Dimension({
                                    key: 'Instance',
                                    user_value: 't3.micro',
                                    required: true,
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        // Should not throw
        expect(() => assertNoUnresolved(unresolved)).not.toThrow();
    });

    it('fail-fast gate allows optional unresolved dimensions', () => {
        const profile = new ProfileDocument({
            schema_version: '2.0',
            project_name: 'Test',
            groups: [
                new Group({
                    group_name: 'Production',
                    services: [
                        new Service({
                            service_name: 'EC2',
                            human_label: 'Web',
                            region: 'us-east-1',
                            dimensions: {
                                'Required': new Dimension({
                                    key: 'Required',
                                    user_value: 'value',
                                    required: true,
                                }),
                                'Optional': new Dimension({
                                    key: 'Optional',
                                    user_value: null,
                                    default_value: null,
                                    required: false,
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        // Optional unresolved dims are silently skipped — not in the list (Req 5.3)
        expect(unresolved.length).toBe(0);
        
        // Gate should pass because only optional is unresolved
        expect(() => assertNoUnresolved(unresolved)).not.toThrow();
    });

    it('ResolutionError contains actionable information', () => {
        const profile = new ProfileDocument({
            schema_version: '2.0',
            project_name: 'Test',
            groups: [
                new Group({
                    group_name: 'Production',
                    services: [
                        new Service({
                            service_name: 'EC2',
                            human_label: 'Web',
                            region: 'us-east-1',
                            dimensions: {
                                'Instance': new Dimension({
                                    key: 'Instance',
                                    required: true,
                                }),
                                'OS': new Dimension({
                                    key: 'OS',
                                    required: true,
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        try {
            assertNoUnresolved(unresolved);
        } catch (err) {
            expect(err).toBeInstanceOf(ResolutionError);
            expect(err.message).toContain('2 required dimension(s)');
            expect(err.unresolved.length).toBe(2);
            
            // Should have getReport method
            const report = err.getReport();
            expect(report).toContain('Unresolved dimensions:');
            expect(report).toContain('Production.EC2.Instance');
            expect(report).toContain('Production.EC2.OS');
        }
    });

    it('property: fail-fast gate blocks exactly when required unresolved exist', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        key: fc.string({ minLength: 1, maxLength: 10 }),
                        user_value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
                        default_value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
                        required: fc.boolean(),
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                (dimConfigs) => {
                    const dimensions = {};
                    for (const cfg of dimConfigs) {
                        dimensions[cfg.key] = new Dimension({
                            key: cfg.key,
                            user_value: cfg.user_value,
                            default_value: cfg.default_value,
                            required: cfg.required,
                        });
                    }

                    const profile = new ProfileDocument({
                        schema_version: '2.0',
                        project_name: 'Test',
                        groups: [
                            new Group({
                                group_name: 'Production',
                                services: [
                                    new Service({
                                        service_name: 'EC2',
                                        human_label: 'Web',
                                        region: 'us-east-1',
                                        dimensions,
                                    }),
                                ],
                            }),
                        ],
                    });

                    const { unresolved } = resolveDimensions(profile);
                    
                    const hasRequiredUnresolved = dimConfigs.some(
                        c => c.required && (c.user_value === null && c.default_value === null)
                    );
                    
                    if (hasRequiredUnresolved) {
                        expect(() => assertNoUnresolved(unresolved)).toThrow(ResolutionError);
                    } else {
                        expect(() => assertNoUnresolved(unresolved)).not.toThrow();
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    it('gate works with multiple groups and services', () => {
        const profile = new ProfileDocument({
            schema_version: '2.0',
            project_name: 'Test',
            groups: [
                new Group({
                    group_name: 'Production',
                    services: [
                        new Service({
                            service_name: 'EC2',
                            human_label: 'Web',
                            region: 'us-east-1',
                            dimensions: {
                                'Instance': new Dimension({ key: 'Instance', user_value: 't3.micro', required: true }),
                            },
                        }),
                    ],
                }),
                new Group({
                    group_name: 'Staging',
                    services: [
                        new Service({
                            service_name: 'S3',
                            human_label: 'Storage',
                            region: 'us-east-1',
                            dimensions: {
                                'Storage': new Dimension({ key: 'Storage', required: true }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        // S3.Storage should be unresolved
        expect(unresolved.length).toBe(1);
        expect(unresolved[0].groupName).toBe('Staging');
        expect(unresolved[0].serviceName).toBe('S3');
        expect(unresolved[0].dimensionKey).toBe('Storage');
        
        // Gate should fail
        expect(() => assertNoUnresolved(unresolved)).toThrow(ResolutionError);
    });

    it('gate passes when all required dimensions resolved across groups', () => {
        const profile = new ProfileDocument({
            schema_version: '2.0',
            project_name: 'Test',
            groups: [
                new Group({
                    group_name: 'Production',
                    services: [
                        new Service({
                            service_name: 'EC2',
                            human_label: 'Web',
                            region: 'us-east-1',
                            dimensions: {
                                'Instance': new Dimension({ key: 'Instance', user_value: 't3.micro', required: true }),
                            },
                        }),
                    ],
                }),
                new Group({
                    group_name: 'Staging',
                    services: [
                        new Service({
                            service_name: 'S3',
                            human_label: 'Storage',
                            region: 'us-east-1',
                            dimensions: {
                                'Storage': new Dimension({ key: 'Storage', default_value: 100, required: true }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        // All required should be resolved
        const requiredUnresolved = unresolved.filter(u => u.required);
        expect(requiredUnresolved.length).toBe(0);
        
        // Gate should pass
        expect(() => assertNoUnresolved(unresolved)).not.toThrow();
    });
});

// tests/core/resolver/optional_skip.test.js
// Feature: aws-cost-profile-builder, Property 5: Optional Unresolved Dimensions Are Skipped
// Validates: Requirements 5.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveDimensions, assertNoUnresolved, ResolutionError } from '../../../core/resolver/priority_chain.js';
import { ProfileDocument, Group, Service, Dimension } from '../../../core/models/profile.js';

// ─── Property 5: Optional Unresolved Dimensions Are Skipped ──────────────────

describe('Property 5: Optional Unresolved Dimensions Are Skipped', () => {
    it('optional unresolved dimensions do not throw in assertNoUnresolved', () => {
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
                                'Optional': new Dimension({
                                    key: 'Optional',
                                    user_value: null,
                                    default_value: null,
                                    prompt_message: null,
                                    required: false,
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        // Optional unresolved dims are silently skipped — not in the unresolved list (Req 5.3)
        expect(unresolved.length).toBe(0);
        
        // assertNoUnresolved should NOT throw when there are no required unresolved dims
        expect(() => assertNoUnresolved(unresolved)).not.toThrow();

        // The dimension itself should be marked 'skipped', not 'unresolved'
        const dim = profile.groups[0].services[0].dimensions['Optional'];
        expect(dim.resolution_status).toBe('skipped');
    });

    it('required unresolved dimensions throw in assertNoUnresolved', () => {
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
                                    user_value: null,
                                    default_value: null,
                                    prompt_message: null,
                                    required: true,
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        expect(unresolved.length).toBe(1);
        expect(unresolved[0].required).toBe(true);
        
        // assertNoUnresolved SHOULD throw for required dimensions
        expect(() => assertNoUnresolved(unresolved)).toThrow(ResolutionError);
    });

    it('mixed required and optional: only required throws', () => {
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
                                    user_value: null,
                                    default_value: null,
                                    required: true,
                                }),
                                'Optional1': new Dimension({
                                    key: 'Optional1',
                                    user_value: null,
                                    default_value: null,
                                    required: false,
                                }),
                                'Optional2': new Dimension({
                                    key: 'Optional2',
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
        
        // Only required unresolved dims appear in the list (Req 5.3)
        expect(unresolved.length).toBe(1);
        expect(unresolved[0].required).toBe(true);
        expect(unresolved[0].dimensionKey).toBe('Required');
        
        // assertNoUnresolved should throw because there's a required one
        try {
            assertNoUnresolved(unresolved);
        } catch (err) {
            expect(err).toBeInstanceOf(ResolutionError);
            expect(err.unresolved.length).toBe(1);
            expect(err.unresolved[0].dimensionKey).toBe('Required');
        }
    });

    it('property: optional dimensions never block resolution', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        key: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
                        required: fc.boolean(),
                    }),
                    { minLength: 1, maxLength: 5 }
                ),
                (dimConfigs) => {
                    // Ensure unique keys
                    const uniqueKeys = [...new Set(dimConfigs.map(c => c.key))];
                    const uniqueConfigs = uniqueKeys.map(k => dimConfigs.find(c => c.key === k));
                    
                    const dimensions = {};
                    for (const cfg of uniqueConfigs) {
                        dimensions[cfg.key] = new Dimension({
                            key: cfg.key,
                            user_value: null,
                            default_value: null,
                            prompt_message: null,
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
                    
                    // Only required dims appear in unresolved list (Req 5.3)
                    const requiredConfigs = uniqueConfigs.filter(c => c.required);
                    expect(unresolved.length).toBe(requiredConfigs.length);
                    expect(unresolved.every(u => u.required)).toBe(true);
                    
                    // assertNoUnresolved should only throw if there are required dimensions
                    const hasRequired = requiredConfigs.length > 0;
                    if (hasRequired) {
                        expect(() => assertNoUnresolved(unresolved)).toThrow(ResolutionError);
                    } else {
                        expect(() => assertNoUnresolved(unresolved)).not.toThrow();
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    it('ResolutionError contains only required dimensions', () => {
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
                                'Req1': new Dimension({ key: 'Req1', required: true }),
                                'Req2': new Dimension({ key: 'Req2', required: true }),
                                'Opt1': new Dimension({ key: 'Opt1', required: false }),
                                'Opt2': new Dimension({ key: 'Opt2', required: false }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { unresolved } = resolveDimensions(profile);
        
        // Only required dims in the unresolved list (Req 5.3)
        expect(unresolved.length).toBe(2);
        expect(unresolved.every(u => u.required)).toBe(true);
        
        try {
            assertNoUnresolved(unresolved);
        } catch (err) {
            expect(err.unresolved.length).toBe(2);
            expect(err.unresolved.every(u => u.required)).toBe(true);
            expect(err.unresolved.map(u => u.dimensionKey).sort())
                .toEqual(['Req1', 'Req2']);
        }
    });

    it('ResolutionError.getReport returns formatted output', () => {
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
                                'Instance': new Dimension({ key: 'Instance', required: true }),
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
            const report = err.getReport();
            expect(report).toContain('Unresolved dimensions:');
            expect(report).toContain('Production.EC2.Instance');
        }
    });
});

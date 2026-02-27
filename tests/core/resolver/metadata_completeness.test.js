// tests/core/resolver/metadata_completeness.test.js
// Feature: aws-cost-profile-builder, Property 7: Resolved Profile Carries Resolution Metadata
// Validates: Requirements 5.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveDimensions } from '../../../core/resolver/priority_chain.js';
import { ProfileDocument, Group, Service, Dimension } from '../../../core/models/profile.js';

// ─── Property 7: Resolved Profile Carries Resolution Metadata ────────────────

describe('Property 7: Resolved Profile Carries Resolution Metadata', () => {
    it('resolved dimensions have complete metadata', () => {
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
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { profile: resolved } = resolveDimensions(profile);
        const dim = resolved.groups[0].services[0].dimensions['Instance'];

        // All metadata fields should be set
        expect(dim.resolved_value).toBe('t3.micro');
        expect(dim.resolution_source).toBe('user_value');
        expect(dim.resolution_status).toBe('resolved');
    });

    it('metadata is complete for all resolution sources', () => {
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
                                'UserValue': new Dimension({ key: 'UserValue', user_value: 'a' }),
                                'DefaultValue': new Dimension({ key: 'DefaultValue', default_value: 'b' }),
                                'Prompt': new Dimension({ key: 'Prompt', prompt_message: 'Enter' }),
                                'Unresolved': new Dimension({ key: 'Unresolved' }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { profile: resolved } = resolveDimensions(profile);
        const dims = resolved.groups[0].services[0].dimensions;

        // user_value
        expect(dims['UserValue'].resolved_value).toBe('a');
        expect(dims['UserValue'].resolution_source).toBe('user_value');
        expect(dims['UserValue'].resolution_status).toBe('resolved');

        // default_value
        expect(dims['DefaultValue'].resolved_value).toBe('b');
        expect(dims['DefaultValue'].resolution_source).toBe('default_value');
        expect(dims['DefaultValue'].resolution_status).toBe('resolved');

        // prompt
        expect(dims['Prompt'].resolved_value).toBe(null);
        expect(dims['Prompt'].resolution_source).toBe('prompt');
        expect(dims['Prompt'].resolution_status).toBe('skipped');

        // unresolved
        expect(dims['Unresolved'].resolved_value).toBe(null);
        expect(dims['Unresolved'].resolution_source).toBe(null);
        expect(dims['Unresolved'].resolution_status).toBe('unresolved');
    });

    it('property: all dimensions have complete metadata after resolution', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        key: fc.string({ minLength: 1, maxLength: 10 }),
                        user_value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
                        default_value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
                        prompt_message: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
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
                            prompt_message: cfg.prompt_message,
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

                    const { profile: resolved } = resolveDimensions(profile);
                    const dims = resolved.groups[0].services[0].dimensions;

                    for (const cfg of dimConfigs) {
                        const dim = dims[cfg.key];

                        // All dimensions must have all three metadata fields
                        expect('resolved_value' in dim).toBe(true);
                        expect('resolution_source' in dim).toBe(true);
                        expect('resolution_status' in dim).toBe(true);

                        // resolution_status must be one of the valid values
                        expect(['resolved', 'skipped', 'unresolved'])
                            .toContain(dim.resolution_status);

                        // resolution_source must be valid for the status
                        if (dim.resolution_status === 'resolved') {
                            expect(['user_value', 'default_value'])
                                .toContain(dim.resolution_source);
                            expect(dim.resolved_value).not.toBe(null);
                        } else if (dim.resolution_status === 'skipped') {
                            expect(dim.resolution_source).toBe('prompt');
                            expect(dim.resolved_value).toBe(null);
                        } else if (dim.resolution_status === 'unresolved') {
                            expect(dim.resolution_source).toBe(null);
                            expect(dim.resolved_value).toBe(null);
                        }
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    it('metadata survives round-trip through toObject/fromObject', () => {
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
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { profile: resolved } = resolveDimensions(profile);
        
        // Convert to plain object and back
        const plain = resolved.toObject();
        const restored = ProfileDocument.fromObject(plain);
        
        const dim = restored.groups[0].services[0].dimensions['Instance'];
        
        // Metadata should be preserved
        expect(dim.resolved_value).toBe('t3.micro');
        expect(dim.resolution_source).toBe('user_value');
        expect(dim.resolution_status).toBe('resolved');
    });

    it('metadata is set even for dimensions with undefined values', () => {
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
                                'Empty': new Dimension({
                                    key: 'Empty',
                                    user_value: undefined,
                                    default_value: undefined,
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const { profile: resolved } = resolveDimensions(profile);
        const dim = resolved.groups[0].services[0].dimensions['Empty'];

        // undefined is treated as not set, so should fall through to unresolved
        expect(dim.resolution_status).toBe('unresolved');
        expect(dim.resolution_source).toBe(null);
        expect(dim.resolved_value).toBe(null);
    });
});

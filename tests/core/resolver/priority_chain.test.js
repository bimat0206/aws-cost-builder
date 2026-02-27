// tests/core/resolver/priority_chain.test.js
// Feature: aws-cost-profile-builder, Property 4: Value Resolution Priority Chain
// Validates: Requirements 5.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    resolveDimensions,
    assertNoUnresolved,
    ResolutionError,
    getResolutionSummary,
} from '../../../core/resolver/priority_chain.js';
import { ProfileDocument, Group, Service, Dimension } from '../../../core/models/profile.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeProfile = (dimensions) => {
    return new ProfileDocument({
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
};

// ─── Property 4: Value Resolution Priority Chain ─────────────────────────────

describe('Property 4: Value Resolution Priority Chain', () => {
    it('user_value takes highest priority when set', () => {
        const profile = makeProfile({
            'Instance': new Dimension({
                key: 'Instance',
                user_value: 't3.micro',
                default_value: 't2.micro',
            }),
        });

        const { profile: resolved } = resolveDimensions(profile);
        const dim = resolved.groups[0].services[0].dimensions['Instance'];

        expect(dim.resolved_value).toBe('t3.micro');
        expect(dim.resolution_source).toBe('user_value');
        expect(dim.resolution_status).toBe('resolved');
    });

    it('default_value is used when user_value is null', () => {
        const profile = makeProfile({
            'Instance': new Dimension({
                key: 'Instance',
                user_value: null,
                default_value: 't2.micro',
            }),
        });

        const { profile: resolved } = resolveDimensions(profile);
        const dim = resolved.groups[0].services[0].dimensions['Instance'];

        expect(dim.resolved_value).toBe('t2.micro');
        expect(dim.resolution_source).toBe('default_value');
        expect(dim.resolution_status).toBe('resolved');
    });

    it('prompt_message marks dimension as skipped for runtime prompt', () => {
        const profile = makeProfile({
            'Instance': new Dimension({
                key: 'Instance',
                user_value: null,
                default_value: null,
                prompt_message: 'Select instance type',
            }),
        });

        const { profile: resolved, unresolved } = resolveDimensions(profile);
        const dim = resolved.groups[0].services[0].dimensions['Instance'];

        expect(dim.resolved_value).toBe(null);
        expect(dim.resolution_source).toBe('prompt');
        expect(dim.resolution_status).toBe('skipped');
        expect(unresolved.length).toBe(0);
    });

    it('dimension is unresolved when no resolution path exists', () => {
        const profile = makeProfile({
            'Instance': new Dimension({
                key: 'Instance',
                user_value: null,
                default_value: null,
                prompt_message: null,
                required: true,
            }),
        });

        const { profile: resolved, unresolved } = resolveDimensions(profile);
        const dim = resolved.groups[0].services[0].dimensions['Instance'];

        expect(dim.resolved_value).toBe(null);
        expect(dim.resolution_source).toBe(null);
        expect(dim.resolution_status).toBe('unresolved');
        expect(unresolved.length).toBe(1);
        expect(unresolved[0].dimensionKey).toBe('Instance');
    });

    it('priority chain works correctly across multiple dimensions', () => {
        const profile = makeProfile({
            'UserValue': new Dimension({
                key: 'UserValue',
                user_value: 'from-user',
                default_value: 'default',
            }),
            'DefaultValue': new Dimension({
                key: 'DefaultValue',
                user_value: null,
                default_value: 'from-default',
            }),
            'PromptValue': new Dimension({
                key: 'PromptValue',
                user_value: null,
                default_value: null,
                prompt_message: 'Enter value',
            }),
            'Unresolved': new Dimension({
                key: 'Unresolved',
                user_value: null,
                default_value: null,
                prompt_message: null,
            }),
        });

        const { profile: resolved, unresolved } = resolveDimensions(profile);
        const dims = resolved.groups[0].services[0].dimensions;

        expect(dims['UserValue'].resolution_source).toBe('user_value');
        expect(dims['DefaultValue'].resolution_source).toBe('default_value');
        expect(dims['PromptValue'].resolution_source).toBe('prompt');
        expect(dims['Unresolved'].resolution_source).toBe(null);

        expect(dims['UserValue'].resolution_status).toBe('resolved');
        expect(dims['DefaultValue'].resolution_status).toBe('resolved');
        expect(dims['PromptValue'].resolution_status).toBe('skipped');
        expect(dims['Unresolved'].resolution_status).toBe('unresolved');

        expect(unresolved.length).toBe(1);
    });

    it('property: priority chain ordering is consistent across random profiles', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        key: fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
                        user_value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
                        default_value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
                        prompt_message: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
                    }),
                    { minLength: 1, maxLength: 5 }
                ),
                (dimConfigs) => {
                    // Ensure unique keys to avoid object key collision
                    const uniqueKeys = [...new Set(dimConfigs.map(c => c.key))];
                    const uniqueConfigs = uniqueKeys.map(k => dimConfigs.find(c => c.key === k));
                    
                    const dimensions = {};
                    for (const cfg of uniqueConfigs) {
                        dimensions[cfg.key] = new Dimension({
                            key: cfg.key,
                            user_value: cfg.user_value,
                            default_value: cfg.default_value,
                            prompt_message: cfg.prompt_message,
                        });
                    }

                    const profile = makeProfile(dimensions);
                    const { profile: resolved } = resolveDimensions(profile);
                    const services = resolved.groups[0].services;
                    const dims = services[0].dimensions;

                    for (const cfg of uniqueConfigs) {
                        const dim = dims[cfg.key];

                        if (cfg.user_value !== null) {
                            // user_value should win
                            expect(dim.resolution_source).toBe('user_value');
                            expect(dim.resolved_value).toBe(cfg.user_value);
                        } else if (cfg.default_value !== null) {
                            // default_value should win
                            expect(dim.resolution_source).toBe('default_value');
                            expect(dim.resolved_value).toBe(cfg.default_value);
                        } else if (cfg.prompt_message) {
                            // should be skipped for prompt
                            expect(dim.resolution_source).toBe('prompt');
                            expect(dim.resolution_status).toBe('skipped');
                        } else {
                            // should be unresolved
                            expect(dim.resolution_source).toBe(null);
                            expect(dim.resolution_status).toBe('unresolved');
                        }
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    it('getResolutionSummary returns accurate counts', () => {
        const profile = makeProfile({
            'Resolved1': new Dimension({ key: 'Resolved1', user_value: 'a' }),
            'Resolved2': new Dimension({ key: 'Resolved2', default_value: 'b' }),
            'Skipped': new Dimension({ key: 'Skipped', prompt_message: 'prompt' }),
            'Unresolved': new Dimension({ key: 'Unresolved' }),
        });

        resolveDimensions(profile);
        const summary = getResolutionSummary(profile);

        expect(summary.total).toBe(4);
        expect(summary.resolved).toBe(2);
        expect(summary.skipped).toBe(1);
        expect(summary.unresolved).toBe(1);
    });
});

// tests/core/resolver/override_precedence.test.js
// Feature: aws-cost-profile-builder, Property 1: Override Precedence in Resolution
// Validates: Requirements 2.6, 5.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseOverrides, OverrideSyntaxError, OverrideEmptySegmentError } from '../../../core/resolver/override_parser.js';
import { applyOverrides } from '../../../core/resolver/priority_chain.js';
import { ProfileDocument, Group, Service, Dimension } from '../../../core/models/profile.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9 _-]+$/.test(s));

const arbDimensionKey = arbNonEmptyString;

const arbDimension = (key) => fc.record({
    user_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    default_value: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
}).map(d => new Dimension({ key, ...d }));

const arbService = fc.record({
    service_name: arbNonEmptyString,
    human_label: arbNonEmptyString,
    region: fc.constant('us-east-1'),
}).chain(({ service_name, human_label, region }) =>
    fc.array(arbDimensionKey, { minLength: 1, maxLength: 3 }).chain(keys => {
        const uniqueKeys = [...new Set(keys)];
        return fc.tuple(...uniqueKeys.map(k => arbDimension(k))).map(dims => {
            const dimensions = {};
            for (const d of dims) dimensions[d.key] = d;
            return new Service({ service_name, human_label, region, dimensions });
        });
    })
);

const arbGroup = fc.record({
    group_name: arbNonEmptyString,
}).chain(({ group_name }) =>
    fc.array(arbService, { minLength: 1, maxLength: 3 }).map(services =>
        new Group({ group_name, services })
    )
);

const arbProfile = fc.record({
    project_name: arbNonEmptyString,
}).chain(({ project_name }) =>
    fc.array(arbGroup, { minLength: 1, maxLength: 3 }).map(groups =>
        new ProfileDocument({ schema_version: '2.0', project_name, groups })
    )
);

// ─── Property 1: Override Precedence in Resolution ───────────────────────────

describe('Property 1: Override Precedence in Resolution', () => {
    it('overrides are applied to matching dimensions', () => {
        fc.assert(
            fc.property(
                arbProfile,
                fc.array(fc.tuple(arbNonEmptyString, arbNonEmptyString, arbDimensionKey, fc.string())),
                (profile, overrideTuples) => {
                    // Build overrides map
                    const overrides = parseOverrides(
                        overrideTuples.map(([g, s, d, v]) => `${g}.${s}.${d}=${v}`)
                    );

                    // Apply overrides (may throw if targets don't exist - that's expected)
                    try {
                        const result = applyOverrides(profile, overrides);
                        // If successful, verify overrides were applied
                        for (const [g, s, d, v] of overrideTuples) {
                            const group = result.groups.find(grp => grp.group_name === g);
                            if (!group) continue;
                            const service = group.services.find(srv => srv.service_name === s);
                            if (!service) continue;
                            const dimension = service.dimensions[d];
                            if (!dimension) continue;
                            // Override should set user_value
                            expect(dimension.user_value).toBe(v);
                        }
                    } catch (e) {
                        // Expected when override targets don't exist
                        expect(e.message).toContain('not found in profile');
                    }
                }
            ),
            { numRuns: 25 }
        );
    });

    it('override user_value takes precedence over default_value in resolution', () => {
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
                                    default_value: 't2.micro',
                                }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const overrides = parseOverrides(['Production.EC2.Instance=t4.micro']);
        const result = applyOverrides(profile, overrides);

        const dim = result.groups[0].services[0].dimensions['Instance'];
        expect(dim.user_value).toBe('t4.micro');
        expect(dim.default_value).toBe('t2.micro');
        // user_value should take precedence
        expect(dim.user_value).not.toBe(dim.default_value);
    });

    it('parseOverrides validates syntax and throws for invalid format', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant(''),
                    fc.constant('no-equals-sign'),
                    fc.constant('only=one-segment'),
                    fc.constant('two.segments=but-no-third'),
                ),
                (invalid) => {
                    expect(() => parseOverrides([invalid])).toThrow(OverrideSyntaxError);
                }
            ),
            { numRuns: 25 }
        );
    });

    it('parseOverrides throws OverrideEmptySegmentError for empty segments', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant('.service.dimension=value'),
                    fc.constant('group..dimension=value'),
                    fc.constant('group.service.=value'),
                ),
                (invalid) => {
                    expect(() => parseOverrides([invalid])).toThrow(OverrideEmptySegmentError);
                }
            ),
            { numRuns: 25 }
        );
    });

    it('parseOverrides accepts valid format and returns structured map', () => {
        const result = parseOverrides([
            'Production.EC2.Instance=t3.micro',
            'Production.EC2.OS=Linux',
        ]);

        expect(result.size).toBe(2);
        expect(result.has('Production|EC2|Instance')).toBe(true);
        expect(result.has('Production|EC2|OS')).toBe(true);

        const override = result.get('Production|EC2|Instance');
        expect(override.groupName).toBe('Production');
        expect(override.serviceName).toBe('EC2');
        expect(override.dimensionKey).toBe('Instance');
        expect(override.value).toBe('t3.micro');
    });

    it('override values can contain equals signs', () => {
        const result = parseOverrides(['Group.Service.Key=value=with=equals']);
        const override = result.get('Group|Service|Key');
        expect(override.value).toBe('value=with=equals');
    });

    it('applyOverrides throws error for unmatched overrides', () => {
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
                                'Instance': new Dimension({ key: 'Instance' }),
                            },
                        }),
                    ],
                }),
            ],
        });

        const overrides = parseOverrides(['Production.EC2.NonExistent=value']);
        expect(() => applyOverrides(profile, overrides))
            .toThrow(/Override target\(s\) not found/);
    });
});

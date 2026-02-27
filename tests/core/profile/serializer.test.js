// tests/core/profile/serializer.test.js
// Feature: aws-cost-profile-builder, Property 21: Profile Round-Trip Integrity
// Feature: aws-cost-profile-builder, Property 22: Serialization Format Stability
// Validates: Requirements 14.1, 14.2, 14.3, 14.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serializeProfile, deserializeProfile } from '../../../core/profile/serializer.js';
import { ProfileDocument, Group, Service, Dimension } from '../../../core/models/profile.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbDimValue = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null)
);

const arbDimension = (key) => fc.record({
    user_value: arbDimValue,
    default_value: arbDimValue,
    unit: fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.constant(null)),
    prompt_message: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
    required: fc.boolean(),
    resolved_value: fc.constant(null),
    resolution_source: fc.constant(null),
    resolution_status: fc.constant(null),
}).map(d => new Dimension({ key, ...d }));

const arbDimensionMap = fc.array(
    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z ]+$/.test(s)),
    { minLength: 1, maxLength: 5 }
).chain(keys => {
    const uniqueKeys = [...new Set(keys)];
    return fc.tuple(...uniqueKeys.map(k => arbDimension(k))).map(dims => {
        const map = {};
        for (const d of dims) map[d.key] = d;
        return map;
    });
});

const arbService = fc.record({
    service_name: fc.constantFrom('Amazon EC2', 'Amazon S3', 'AWS Lambda'),
    human_label: fc.string({ minLength: 1, maxLength: 30 }),
    region: fc.constantFrom('us-east-1', 'eu-west-1', 'global'),
}).chain(({ service_name, human_label, region }) =>
    arbDimensionMap.map(dimensions =>
        new Service({ service_name, human_label, region, dimensions })
    )
);

const arbGroup = fc.record({
    group_name: fc.string({ minLength: 1, maxLength: 20 }),
}).chain(({ group_name }) =>
    fc.array(arbService, { minLength: 1, maxLength: 3 }).map(services =>
        new Group({ group_name, services })
    )
);

const arbProfile = fc.record({
    project_name: fc.string({ minLength: 1, maxLength: 30 }),
    description: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
}).chain(({ project_name, description }) =>
    fc.array(arbGroup, { minLength: 1, maxLength: 3 }).map(groups =>
        new ProfileDocument({ schema_version: '2.0', project_name, description, groups })
    )
);

// ─── Property 21: Round-Trip Integrity ───────────────────────────────────────

describe('Property 21: Profile Round-Trip Integrity', () => {
    it('serialize then deserialize produces a deeply equal ProfileDocument', () => {
        fc.assert(
            fc.property(arbProfile, (profile) => {
                const json = serializeProfile(profile);
                const restored = deserializeProfile(json);

                // Top-level fields
                expect(restored.schema_version).toBe(profile.schema_version);
                expect(restored.project_name).toBe(profile.project_name);
                expect(restored.description).toBe(profile.description);
                expect(restored.groups.length).toBe(profile.groups.length);

                // Groups
                for (let gi = 0; gi < profile.groups.length; gi++) {
                    const og = profile.groups[gi];
                    const rg = restored.groups[gi];
                    expect(rg.group_name).toBe(og.group_name);
                    expect(rg.services.length).toBe(og.services.length);

                    // Services
                    for (let si = 0; si < og.services.length; si++) {
                        const os = og.services[si];
                        const rs = rg.services[si];
                        expect(rs.service_name).toBe(os.service_name);
                        expect(rs.human_label).toBe(os.human_label);
                        expect(rs.region).toBe(os.region);

                        // Dimensions
                        const origKeys = Object.keys(os.dimensions).sort();
                        const restKeys = Object.keys(rs.dimensions).sort();
                        expect(restKeys).toEqual(origKeys);

                        for (const key of origKeys) {
                            const od = os.dimensions[key];
                            const rd = rs.dimensions[key];
                            expect(rd.user_value).toEqual(od.user_value);
                            expect(rd.default_value).toEqual(od.default_value);
                            expect(rd.unit).toBe(od.unit);
                            expect(rd.required).toBe(od.required);
                        }
                    }
                }
            }),
            { numRuns: 25 }
        );
    });

    it('deserializeProfile throws SyntaxError on malformed JSON', () => {
        expect(() => deserializeProfile('{ not valid json')).toThrow(SyntaxError);
    });
});

// ─── Property 22: Serialization Format Stability ─────────────────────────────

describe('Property 22: Serialization Format Stability', () => {
    it('serialized output uses 2-space indentation', () => {
        fc.assert(
            fc.property(arbProfile, (profile) => {
                const json = serializeProfile(profile);
                // Every indented line must use multiples of 2 spaces
                const lines = json.split('\n');
                for (const line of lines) {
                    const leading = line.match(/^( *)/)[1].length;
                    expect(leading % 2).toBe(0);
                }
            }),
            { numRuns: 25 }
        );
    });

    it('serialized output always starts with schema_version as first key', () => {
        fc.assert(
            fc.property(arbProfile, (profile) => {
                const json = serializeProfile(profile);
                const parsed = JSON.parse(json);
                const keys = Object.keys(parsed);
                expect(keys[0]).toBe('schema_version');
            }),
            { numRuns: 25 }
        );
    });

    it('serializing the same profile twice produces identical output (stable key order)', () => {
        fc.assert(
            fc.property(arbProfile, (profile) => {
                const json1 = serializeProfile(profile);
                const json2 = serializeProfile(profile);
                expect(json1).toBe(json2);
            }),
            { numRuns: 25 }
        );
    });

    it('schema_version is always "2.0" in serialized output', () => {
        fc.assert(
            fc.property(arbProfile, (profile) => {
                const json = serializeProfile(profile);
                const parsed = JSON.parse(json);
                expect(parsed.schema_version).toBe('2.0');
            }),
            { numRuns: 25 }
        );
    });
});

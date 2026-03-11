import { describe, it, expect } from 'vitest';
import { parseHCL } from '../../hcl/parser.js';
import { serializeHCL, cleanFieldLabel } from '../../hcl/serializer.js';

describe('HCL v7 Parser/Serializer', () => {

    describe('cleanFieldLabel', () => {
        it('strips "Value"', () => {
            expect(cleanFieldLabel('S3 Standard storage Value')).toBe('S3 Standard storage');
        });
        it('strips "Enter amount"', () => {
            expect(cleanFieldLabel('Code execution Enter amount')).toBe('Code execution');
        });
        it('strips "Enter the percentage"', () => {
            expect(cleanFieldLabel('Standard writes Enter the percentage')).toBe('Standard writes');
        });
        it('does not strip unrelated suffixes', () => {
            expect(cleanFieldLabel('Description - optional')).toBe('Description - optional');
        });
    });

    describe('serializeHCL v7', () => {

        it('emits schema_version 7.0', () => {
            const hcl = serializeHCL({ project_name: 'x', groups: [] });
            expect(hcl).toContain('schema_version = "7.0"');
        });

        it('emits flat attrs for ungrouped top-level fields', () => {
            const hcl = serializeHCL({ project_name: 't', groups: [{ group_name: 'g', label: 'G', services: [{
                service_name: 'S3', human_label: 'S3', region: 'us-east-1',
                config_groups: [{ group_name: 'general', label: null, fields: {
                    'S3 General Purpose Buckets Value': { user_value: 2 },
                }}]
            }] }] });
            expect(hcl).toContain('s3_general_purpose_buckets = 2');
            expect(hcl).not.toContain('field "');
            expect(hcl).not.toContain('section');
        });

        it('emits feature block for toggle-gated groups', () => {
            const hcl = serializeHCL({ project_name: 't', groups: [{ group_name: 'g', label: 'G', services: [{
                service_name: 'S3', human_label: 'S3', region: 'us-east-1',
                config_groups: [{ group_name: 's3_standard_feature', label: 'S3 Standard feature',
                    fields: {},
                    groups: [{ group_name: 's3_standard', label: 'S3 Standard', fields: {
                        'S3 Standard storage': { user_value: 500 },
                        'S3 Standard storage Unit': { user_value: 'GB per month' },
                    }}]
                }]
            }] }] });
            expect(hcl).toContain('feature "S3 Standard"');
            expect(hcl).toContain('section "S3 Standard"');
            expect(hcl).toContain('storage      = 500');
            expect(hcl).toContain('storage_unit = "GB per month"');
            expect(hcl).not.toContain('field "');
        });

        it('emits section block for non-feature groups', () => {
            const hcl = serializeHCL({ project_name: 't', groups: [{ group_name: 'g', label: 'G', services: [{
                service_name: 'EC2', human_label: 'EC2', region: 'us-east-1',
                config_groups: [{ group_name: 'storage', label: 'Storage', fields: {
                    'Volume size': { user_value: 100 },
                    'Volume size Unit': { user_value: 'GB' },
                }}]
            }] }] });
            expect(hcl).toContain('section "Storage"');
            expect(hcl).toContain('volume_size      = 100');
            expect(hcl).toContain('volume_size_unit = "GB"');
            expect(hcl).not.toContain('feature');
        });
    });

    describe('parseHCL v7', () => {

        it('parses flat attrs under service as general config group', () => {
            const hcl = `
schema_version = "7.0"
project_name = "t"
group "g" {
  service "S3" "s3" {
    region = "us-east-1"
    human_label = "S3"
    description = "my bucket"
    buckets = 2
  }
}`;
            const obj = parseHCL(hcl);
            const g = obj.groups[0].services[0].config_groups.find(cg => cg.group_name === 'general');
            expect(g).toBeDefined();
            expect(g.fields['description'].user_value).toBe('my bucket');
            expect(g.fields['buckets'].user_value).toBe(2);
        });

        it('parses section block with _unit pairing', () => {
            const hcl = `
schema_version = "7.0"
project_name = "t"
group "g" {
  service "S3" "s3" {
    region = "us-east-1"
    human_label = "S3"
    section "S3 Standard" {
      storage      = 500
      storage_unit = "GB per month"
    }
  }
}`;
            const obj = parseHCL(hcl);
            const sec = obj.groups[0].services[0].config_groups.find(g => g.label === 'S3 Standard');
            expect(sec).toBeDefined();
            expect(sec.fields['storage'].user_value).toBe(500);
            expect(sec.fields['storage'].unit).toBe('GB per month');
        });

        it('parses feature block with nested section', () => {
            const hcl = `
schema_version = "7.0"
project_name = "t"
group "g" {
  service "S3" "s3" {
    region = "us-east-1"
    human_label = "S3"
    feature "S3 Standard" {
      section "S3 Standard" {
        storage      = 500
        storage_unit = "GB per month"
      }
    }
  }
}`;
            const obj = parseHCL(hcl);
            const svc = obj.groups[0].services[0];
            const feat = svc.config_groups.find(g => g.label && g.label.includes('S3 Standard'));
            expect(feat).toBeDefined();
            const inner = feat.groups?.[0];
            expect(inner).toBeDefined();
            expect(inner.fields['storage'].user_value).toBe(500);
            expect(inner.fields['storage'].unit).toBe('GB per month');
        });

        it('roundtrip — serialize then parse', () => {
            const original = {
                project_name: 'roundtrip',
                groups: [{ group_name: 'prod', label: 'Production', services: [{
                    service_name: 'Amazon S3', human_label: 'Amazon S3', region: 'us-east-1',
                    config_groups: [
                        { group_name: 'general', label: null, fields: {
                            'Description': { user_value: 'assets' }
                        }},
                        { group_name: 's3_standard_feature', label: 'S3 Standard feature',
                            fields: {},
                            groups: [{ group_name: 's3_standard', label: 'S3 Standard', fields: {
                                'S3 Standard storage': { user_value: 500 },
                                'S3 Standard storage Unit': { user_value: 'GB per month' },
                            }}]
                        },
                    ]
                }] }]
            };
            const hcl = serializeHCL(original);
            const parsed = parseHCL(hcl);
            expect(parsed.schema_version).toBe('7.0');
            const feat = parsed.groups[0].services[0].config_groups
                .find(g => g.label && g.label.includes('S3 Standard'));
            expect(feat).toBeDefined();
        });
    });
});

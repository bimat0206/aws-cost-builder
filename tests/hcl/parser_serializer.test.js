import { describe, it, expect } from 'vitest';
import { parseHCL } from '../../hcl/parser.js';
import { serializeHCL } from '../../hcl/serializer.js';

describe('HCL Parser/Serializer', () => {
    it('round-trips simple profile with sections', () => {
        const profile = {
            schema_version: '3.0',
            project_name: 'Roundtrip',
            groups: [
                {
                    group_name: 'grp',
                    label: 'grp',
                    services: [
                        {
                            service_name: 'ec2',
                            human_label: 'EC2',
                            region: 'us-east-1',
                            dimensions: {
                                'Foo': { user_value: 'bar', default_value: null }
                            },
                            sections: [
                                {
                                    section_name: 'SecA',
                                    dimensions: {
                                        'SecDim': { user_value: 42, default_value: null }
                                    }
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        const hcl = serializeHCL(profile);
        const parsed = parseHCL(hcl);
        expect(parsed).toEqual(profile);
    });

    it('parses section blocks in HCL text', () => {
        const hcl = `schema_version = "3.0"
project_name = "Test"

group "g" {
  service "s3" "bucket" {
    region = "us-east-1"
    human_label = "B"

    section "A" {
      dimension "X" = 1
      dimension "Y" = "yes"
    }

    dimension "Z" = true
  }
}
`;
        const obj = parseHCL(hcl);
        expect(obj.groups[0].services[0].sections).toHaveLength(1);
        expect(obj.groups[0].services[0].sections[0].section_name).toBe('A');
        expect(obj.groups[0].services[0].sections[0].dimensions.X.user_value).toBe(1);
        expect(obj.groups[0].services[0].dimensions.Z.user_value).toBe(true);
    });
});

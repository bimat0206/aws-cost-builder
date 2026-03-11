import { serializeHCL } from './hcl/serializer.js';

// Simulate what the extension would capture for S3 — a flat profile with config groups and sections
const profile = {
    project_name: 'test_v6',
    description: null,
    groups: [
        {
            group_name: 'production',
            label: 'Production',
            services: [
                {
                    service_name: 'Amazon S3',
                    human_label: 'Amazon S3',
                    region: 'us-east-1',
                    gates: [],
                    // Top-level ungrouped fields (no label on config group)
                    config_groups: [
                        {
                            group_name: 'general',
                            label: null,
                            fields: {
                                'S3 General Purpose Buckets Value': { user_value: 2, default_value: 0, field_type: 'NUMBER', unit: null },
                                'Description - optional': { user_value: 'my bucket', default_value: null, field_type: 'TEXT', unit: null },
                            }
                        },
                        {
                            group_name: 'standard_storage',
                            label: 'Standard Storage',
                            fields: {
                                'S3 Standard storage Value': { user_value: 100, default_value: 0, field_type: 'NUMBER', unit: null },
                                'S3 Standard storage Unit': { user_value: 'GB', default_value: 'GB', field_type: 'SELECT', unit: null },
                            },
                            groups: [
                                {
                                    group_name: 'requests',
                                    label: 'Requests',
                                    fields: {
                                        'PUT/ COPY request size Value': { user_value: 10, default_value: 0, field_type: 'NUMBER', unit: null },
                                        'GET request size Value': { user_value: 5, default_value: 0, field_type: 'NUMBER', unit: null },
                                    }
                                }
                            ]
                        },
                        {
                            group_name: 'glacier',
                            label: 'S3 Glacier',
                            fields: {
                                'S3 Glacier Deep Archive storage Value': { user_value: 50, default_value: 0, field_type: 'NUMBER', unit: null },
                                'S3 Glacier Deep Archive Average Object Size Value': { user_value: 16, default_value: 16, field_type: 'NUMBER', unit: null },
                            }
                        }
                    ]
                }
            ]
        }
    ]
};

const hcl = serializeHCL(profile);
console.log(hcl);

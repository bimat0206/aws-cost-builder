/**
 * v6 schema verification — no dependencies needed, runs directly with node.
 */
import { serializeHCL, cleanFieldLabel } from './hcl/serializer.js';
import { parseHCL } from './hcl/parser.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅  ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ❌  ${name}`);
        console.log(`       ${err.message}`);
        failed++;
    }
}

function expect(actual) {
    return {
        toBe: (expected) => {
            if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        },
        toContain: (str) => {
            if (!String(actual).includes(str)) throw new Error(`Expected output to contain ${JSON.stringify(str)}`);
        },
        notToContain: (str) => {
            if (String(actual).includes(str)) throw new Error(`Expected output NOT to contain ${JSON.stringify(str)}`);
        },
        toBeDefined: () => {
            if (actual === undefined || actual === null) throw new Error(`Expected value to be defined`);
        },
        toHaveLength: (len) => {
            if (actual.length !== len) throw new Error(`Expected length ${len}, got ${actual.length}`);
        }
    };
}

// ── cleanFieldLabel ────────────────────────────────────────────────────────────────

console.log('\n📝  cleanFieldLabel');
test('strips "Value"', () => expect(cleanFieldLabel('S3 Standard storage Value')).toBe('S3 Standard storage'));
test('strips "Enter amount"', () => expect(cleanFieldLabel('Code execution per session Enter amount')).toBe('Code execution per session'));
test('strips "Enter the percentage"', () => expect(cleanFieldLabel('Standard writes Enter the percentage')).toBe('Standard writes'));
test('strips "Enter number of indexes"', () => expect(cleanFieldLabel('Number of indexes Enter number of indexes')).toBe('Number of indexes'));
test('does not strip unrelated suffixes', () => expect(cleanFieldLabel('Description - optional')).toBe('Description - optional'));

// ── serializeHCL ───────────────────────────────────────────────────────────────

console.log('\n📦  serializeHCL v6');
test('emits schema_version 6.0', () => {
    const hcl = serializeHCL({ project_name: 'x', groups: [] });
    expect(hcl).toContain('schema_version = "6.0"');
});

test('emits top-level fields directly under service (no section wrapper)', () => {
    const hcl = serializeHCL({
        project_name: 'test', groups: [{
            group_name: 'g', label: 'G', services: [{
                service_name: 'S3', human_label: 'S3', region: 'us-east-1', gates: [],
                config_groups: [{ group_name: 'general', label: null, fields: { 'Foo Value': { user_value: 1, field_type: 'NUMBER' } } }]
            }]
        }]
    });
    expect(hcl).toContain('field "Foo" {');
    expect(hcl).notToContain('section');
});

test('emits named sections for labeled config groups', () => {
    const hcl = serializeHCL({
        project_name: 'test', groups: [{
            group_name: 'g', label: 'G', services: [{
                service_name: 'S3', human_label: 'S3', region: 'us-east-1', gates: [],
                config_groups: [{ group_name: 'storage', label: 'Storage', fields: { 'Size Value': { user_value: 100, field_type: 'NUMBER', unit: 'GB' } } }]
            }]
        }]
    });
    expect(hcl).toContain('section "Storage" {');
    expect(hcl).toContain('field "Size" {');
    expect(hcl).toContain('unit  = "GB"');
});

test('emits nested sections correctly', () => {
    const hcl = serializeHCL({
        project_name: 'test', groups: [{
            group_name: 'g', label: 'G', services: [{
                service_name: 'EC2', human_label: 'EC2', region: 'us-east-1', gates: [],
                config_groups: [{
                    group_name: 'compute', label: 'Compute', fields: {},
                    groups: [{ group_name: 'instance', label: 'Instance', fields: { 'vCPUs Value': { user_value: 4, field_type: 'NUMBER' } } }]
                }]
            }]
        }]
    });
    expect(hcl).toContain('section "Compute" {');
    expect(hcl).toContain('section "Instance" {');
    expect(hcl).toContain('field "vCPUs" {');
});

// ── parseHCL ────────────────────────────────────────────────────────────────────

console.log('\n🔍  parseHCL v6');
test('parses field blocks with type, value and unit', () => {
    const hcl = `
schema_version = "6.0"
project_name = "v6"
group "g" {
  service "EC2" "ec2" {
    region = "us-east-1"
    human_label = "EC2"
    field "Instances" {
      type  = "NUMBER"
      value = 2
      unit  = "count"
    }
  }
}`;
    const obj = parseHCL(hcl);
    expect(obj.schema_version).toBe('6.0');
    const general = obj.groups[0].services[0].config_groups.find(g => g.group_name === 'general');
    expect(general.fields['Instances'].user_value).toBe(2);
    expect(general.fields['Instances'].unit).toBe('count');
});

test('parses nested section blocks', () => {
    const hcl = `
schema_version = "6.0"
project_name = "v6"
group "g" {
  service "S3" "s3" {
    region = "us-east-1"
    human_label = "S3"
    section "Storage" {
      section "Standard" {
        field "Size" {
          value = 100
        }
      }
    }
  }
}`;
    const obj = parseHCL(hcl);
    const svc = obj.groups[0].services[0];
    const storage = svc.config_groups.find(g => g.label === 'Storage');
    expect(storage).toBeDefined();
    expect(storage.groups[0].label).toBe('Standard');
    expect(storage.groups[0].fields['Size'].user_value).toBe(100);
});

test('parses gate blocks', () => {
    const hcl = `
schema_version = "6.0"
project_name = "v6"
group "g" {
  service "DynamoDB" "dynamodb" {
    region = "us-east-1"
    human_label = "DynamoDB"
    gate "On-demand capacity" {
      type    = "TOGGLE"
      enabled = true
    }
  }
}`;
    const obj = parseHCL(hcl);
    const svc = obj.groups[0].services[0];
    expect(svc.gates).toHaveLength(1);
    expect(svc.gates[0].key).toBe('On-demand capacity');
    expect(svc.gates[0].enabled).toBe(true);
});

test('round-trips — serialize then parse produces equivalent structure', () => {
    const original = {
        project_name: 'roundtrip',
        groups: [{
            group_name: 'g', label: 'G', services: [{
                service_name: 'S3', human_label: 'S3', region: 'us-east-1', gates: [],
                config_groups: [
                    { group_name: 'general', label: null, fields: { 'Buckets': { user_value: 3, field_type: 'NUMBER' } } },
                    { group_name: 'storage', label: 'Storage', fields: { 'Size': { user_value: 100, field_type: 'NUMBER', unit: 'GB' } } }
                ]
            }]
        }]
    };
    const hcl = serializeHCL(original);
    const parsed = parseHCL(hcl);
    expect(parsed.schema_version).toBe('6.0');
    expect(parsed.groups[0].services[0].config_groups).toHaveLength(2);
    const storage = parsed.groups[0].services[0].config_groups.find(g => g.label === 'Storage');
    expect(storage.fields['Size'].user_value).toBe(100);
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

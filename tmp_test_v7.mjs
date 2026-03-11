/**
 * v7 schema validation — tests feature blocks, flat attrs, unit pairing, and roundtrip.
 */
import { serializeHCL, cleanFieldLabel } from './hcl/serializer.js';
import { parseHCL } from './hcl/parser.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✅  ${name}`); passed++; }
    catch (err) { console.log(`  ❌  ${name}\n       ${err.message}`); failed++; }
}

function eq(a, b) {
    if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function has(str, sub)    { if (!str.includes(sub)) throw new Error(`Expected to contain ${JSON.stringify(sub)}\nHCL:\n${str}`); }
function notHas(str, sub) { if (str.includes(sub)) throw new Error(`Expected NOT to contain ${JSON.stringify(sub)}`); }
function def(v)   { if (v == null) throw new Error('Expected defined value'); }

// ── cleanFieldLabel ────────────────────────────────────────────────────────────────
console.log('\n📝  cleanFieldLabel');
test('strips "Value"',                  () => eq(cleanFieldLabel('S3 Standard storage Value'), 'S3 Standard storage'));
test('strips "Enter amount"',           () => eq(cleanFieldLabel('Code execution Enter amount'), 'Code execution'));
test('strips "Enter the percentage"',   () => eq(cleanFieldLabel('Standard writes Enter the percentage'), 'Standard writes'));
test('strips "Enter number of indexes"',() => eq(cleanFieldLabel('Indexes Enter number of indexes'), 'Indexes'));
test('keeps unrelated labels',          () => eq(cleanFieldLabel('Description - optional'), 'Description - optional'));

// ── serializeHCL v7 ────────────────────────────────────────────────────────────
console.log('\n📦  serializeHCL v7');

test('emits schema_version 7.0', () => {
    has(serializeHCL({ project_name: 'x', groups: [] }), 'schema_version = "7.0"');
});

test('emits flat attrs for top-level (general) fields', () => {
    const hcl = serializeHCL({ project_name: 't', groups: [{ group_name: 'g', label: 'G', services: [{
        service_name: 'S3', human_label: 'S3', region: 'us-east-1',
        config_groups: [{ group_name: 'general', label: null, fields: {
            'S3 General Purpose Buckets Value': { user_value: 2, field_type: 'NUMBER' },
        }}]
    }] }] });
    has(hcl, 's3_general_purpose_buckets = 2');
    notHas(hcl, 'field "');
    notHas(hcl, 'section');
});

test('pairs unit companion into _unit attr', () => {
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
    has(hcl, 'feature "S3 Standard"');
    has(hcl, 'section "S3 Standard"');
    has(hcl, 'storage      = 500');
    has(hcl, 'storage_unit = "GB per month"');
    notHas(hcl, 'field "');
});

test('strips section prefix from field snake keys', () => {
    const hcl = serializeHCL({ project_name: 't', groups: [{ group_name: 'g', label: 'G', services: [{
        service_name: 'S3', human_label: 'S3', region: 'us-east-1',
        config_groups: [{ group_name: 's3_standard_feature', label: 'S3 Standard feature',
            fields: {},
            groups: [{ group_name: 's3_standard', label: 'S3 Standard', fields: {
                'S3 Standard storage': { user_value: 500 },
                'PUT, COPY, POST, LIST requests to S3 INT': { user_value: 1000 },
            }}]
        }]
    }] }] });
    // "S3 Standard storage" with prefix "S3 Standard" stripped → "storage"
    has(hcl, 'storage');
    // "PUT, COPY, POST, LIST requests to S3 INT" → snake → "put_copy_post_list_requests_to_s3_int"
    has(hcl, 'put_copy_post_list_requests_to_s3_int = 1000');
});

test('non-feature named groups emit as section blocks', () => {
    const hcl = serializeHCL({ project_name: 't', groups: [{ group_name: 'g', label: 'G', services: [{
        service_name: 'EC2', human_label: 'EC2', region: 'us-east-1',
        config_groups: [{ group_name: 'storage', label: 'Storage', fields: {
            'Volume size': { user_value: 100 },
            'Volume size Unit': { user_value: 'GB' },
        }}]
    }] }] });
    has(hcl, 'section "Storage"');
    has(hcl, 'volume_size      = 100');
    has(hcl, 'volume_size_unit = "GB"');
    notHas(hcl, 'feature');
});

// ── parseHCL v7 ───────────────────────────────────────────────────────────────
console.log('\n🔍  parseHCL v7');

test('parses flat attrs in service top-level', () => {
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
    def(g);
    eq(g.fields['description'].user_value, 'my bucket');
    eq(g.fields['buckets'].user_value, 2);
});

test('parses section block with flat attrs and _unit pairs', () => {
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
      requests_put = 10000
    }
  }
}`;
    const obj = parseHCL(hcl);
    const sec = obj.groups[0].services[0].config_groups.find(g => g.label === 'S3 Standard');
    def(sec);
    eq(sec.fields['storage'].user_value, 500);
    eq(sec.fields['storage'].unit, 'GB per month');
    eq(sec.fields['requests_put'].user_value, 10000);
});

test('parses feature block containing a nested section', () => {
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
    // Feature group is stored with label "S3 Standard feature"
    const feat = svc.config_groups.find(g => g.label && g.label.includes('S3 Standard'));
    def(feat);
    const inner = feat.groups?.[0];
    def(inner);
    eq(inner.fields['storage'].user_value, 500);
    eq(inner.fields['storage'].unit, 'GB per month');
});

test('parses nested section inside feature', () => {
    const hcl = `
schema_version = "7.0"
project_name = "t"
group "g" {
  service "S3" "s3" {
    region = "us-east-1"
    human_label = "S3"
    feature "S3 Intelligent-Tiering" {
      section "S3 Intelligent-Tiering" {
        storage = 200
        tiers {
          frequent_access_pct = 100
        }
        section "Requests" {
          put_requests = 5000
        }
      }
    }
  }
}`;
    const obj = parseHCL(hcl);
    const svc = obj.groups[0].services[0];
    const feat = svc.config_groups.find(g => (g.label || '').includes('Intelligent'));
    def(feat);
    const inner = feat.groups?.[0];
    def(inner);
    eq(inner.fields['storage'].user_value, 200);
    // Nested section "Requests" inside section "S3 INT"
    const reqSection = inner.groups?.[0];
    def(reqSection);
    eq(reqSection.fields['put_requests'].user_value, 5000);
});

test('roundtrip — serialize then parse produces equivalent structure', () => {
    const original = {
        project_name: 'roundtrip',
        groups: [{ group_name: 'prod', label: 'Production', services: [{
            service_name: 'Amazon S3', human_label: 'Amazon S3', region: 'us-east-1',
            config_groups: [
                { group_name: 'general', label: null, fields: {
                    'Description': { user_value: 'assets', default_value: null }
                }},
                { group_name: 's3_standard_feature', label: 'S3 Standard feature', fields: {},
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
    eq(parsed.schema_version, '7.0');
    const svc = parsed.groups[0].services[0];
    const feat = svc.config_groups.find(g => (g.label || '').includes('S3 Standard'));
    def(feat);
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

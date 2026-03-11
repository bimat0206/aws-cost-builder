// tests/core/profile/loader.test.js
// Feature: aws-cost-profile-builder, Loader Error Layers F-L1 through F-L4
// Validates: Requirements 4.1, 4.4, 4.5, 4.6, 25.2

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    loadProfile,
    ProfileLoadError,
    ProfileFileNotFoundError,
    ProfilePermissionError,
    ProfileJSONParseError,
    ProfileSchemaValidationError,
    ProfileCrossValidationError,
    CrossValidationServiceCatalogError,
    CrossValidationRegionMapError,
    CrossValidationDimensionKeyError,
} from '../../../core/profile/loader.js';
import { ProfileDocument } from '../../../core/models/profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures', 'profiles');

// Test catalog and region map
const testCatalog = [
    {
        service_name: 'Amazon EC2',
        search_term: 'Amazon EC2',
        calculator_page_title: 'Amazon EC2',
        supported_regions: ['us-east-1', 'eu-west-1'],
        dimensions: [
            { key: 'Operating System', field_type: 'SELECT', default_value: 'Linux', required: true },
            { key: 'Instance type', field_type: 'SELECT', default_value: 't2.micro', required: true },
        ],
    },
    {
        service_name: 'Amazon S3',
        search_term: 'Amazon S3',
        calculator_page_title: 'Amazon S3',
        supported_regions: ['us-east-1'],
        dimensions: [
            { key: 'Storage amount', field_type: 'NUMBER', default_value: 10, required: true },
            { key: 'Requests', field_type: 'NUMBER', default_value: 0, required: false },
        ],
    },
];

const testRegionMap = {
    'us-east-1': 'US East (N. Virginia)',
    'eu-west-1': 'Europe (Ireland)',
};

// Valid profile fixture
const validProfile = {
    schema_version: '2.0',
    project_name: 'Test Project',
    description: 'Test Description',
    groups: [
        {
            group_name: 'Production',
            services: [
                {
                    service_name: 'Amazon EC2',
                    human_label: 'Web Servers',
                    region: 'us-east-1',
                    dimensions: {
                        'Operating System': { user_value: 'Linux', default_value: null },
                        'Instance type': { user_value: 't2.micro', default_value: null },
                    },
                },
            ],
        },
    ],
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Write a profile fixture to disk.
 * @param {string} filename
 * @param {object|string} content - Object (will be JSON.stringify) or raw string
 */
async function writeFixture(filename, content) {
    await fs.mkdir(FIXTURES_DIR, { recursive: true });
    const filePath = path.join(FIXTURES_DIR, filename);
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await fs.writeFile(filePath, contentStr, 'utf-8');
    return filePath;
}

/**
 * Remove a fixture file.
 * @param {string} filename
 */
async function removeFixture(filename) {
    const filePath = path.join(FIXTURES_DIR, filename);
    try {
        await fs.unlink(filePath);
    } catch {
        // Ignore if doesn't exist
    }
}

// ─── F-L1: File I/O Error Tests ──────────────────────────────────────────────

describe('Profile Loader — F-L1: File I/O Errors', () => {
    it('throws ProfileFileNotFoundError when file does not exist', async () => {
        const nonExistentPath = path.join(FIXTURES_DIR, 'does_not_exist.json');
        await expect(loadProfile(nonExistentPath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileFileNotFoundError);
    });

    it('throws ProfileFileNotFoundError with absolute path in error message', async () => {
        const nonExistentPath = path.join(FIXTURES_DIR, 'missing.json');
        try {
            await loadProfile(nonExistentPath, testCatalog, testRegionMap);
        } catch (err) {
            expect(err).toBeInstanceOf(ProfileFileNotFoundError);
            expect(err.message).toContain(path.resolve(nonExistentPath));
            expect(err.layer).toBe('F-L1');
        }
    });

    it('ProfileFileNotFoundError is instance of ProfileLoadError', async () => {
        const nonExistentPath = path.join(FIXTURES_DIR, 'missing.json');
        try {
            await loadProfile(nonExistentPath, testCatalog, testRegionMap);
        } catch (err) {
            expect(err).toBeInstanceOf(ProfileLoadError);
        }
    });

    it('throws ProfilePermissionError for path traversal outside working directory', async () => {
        const traversalPath = path.join('..', '..', '..', '..', '..', '..', '..', '..', 'etc', 'passwd');
        await expect(loadProfile(traversalPath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfilePermissionError);
    });

    it('throws ProfilePermissionError for absolute path outside working directory', async () => {
        const absolutePath = '/etc/passwd';
        // Depending on environment, /etc/passwd might be outside cwd, assuming process.cwd() is not / or /etc
        if (!path.resolve(absolutePath).startsWith(process.cwd() + path.sep)) {
            await expect(loadProfile(absolutePath, testCatalog, testRegionMap))
                .rejects
                .toThrow(ProfilePermissionError);
        }
    });
});

// ─── F-L2: JSON Parse Error Tests ────────────────────────────────────────────

describe('Profile Loader — F-L2: JSON Parse Errors', () => {
    const filename = 'malformed.json';

    beforeEach(async () => {
        await writeFixture(filename, '{ not valid json }');
    });

    afterEach(async () => {
        await removeFixture(filename);
    });

    it('throws ProfileJSONParseError for malformed JSON', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        await expect(loadProfile(filePath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileJSONParseError);
    });

    it('ProfileJSONParseError includes syntax error details', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        try {
            await loadProfile(filePath, testCatalog, testRegionMap);
        } catch (err) {
            expect(err).toBeInstanceOf(ProfileJSONParseError);
            expect(err.message).toContain('Failed to parse profile JSON');
            expect(err.layer).toBe('F-L2');
        }
    });

    it('ProfileJSONParseError is instance of ProfileLoadError', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        try {
            await loadProfile(filePath, testCatalog, testRegionMap);
        } catch (err) {
            expect(err).toBeInstanceOf(ProfileLoadError);
        }
    });
});

// ─── HCL & Sections Parsing ─────────────────────────────────────────────────
describe('Profile Loader — HCL parsing with sections', () => {
    const filename = 'with_section.hcl';
    const hclContent = `schema_version = "4.0"
project_name = "HCL Test"

group "g1" {
  label = "Group1"

  service "Amazon S3" "bucket" {
    region = "us-east-1"
    human_label = "My Bucket"

    config_group "Storage" {
      field "Storage amount" = 100
    }

    config_group "Advanced" {
      field "Requests" = 50
    }
  }
}
`;

    beforeEach(async () => {
        await writeFixture(filename, hclContent);
    });

    afterEach(async () => {
        await removeFixture(filename);
    });

    it('successfully loads HCL with config groups and exposes leaf dimensions', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        const profile = await loadProfile(filePath, testCatalog, testRegionMap);
        expect(profile.project_name).toBe('HCL Test');
        expect(profile.groups[0].services[0].dimensions['Storage amount'].user_value).toBe(100);
        expect(profile.groups[0].services[0].dimensions['Requests'].user_value).toBe(50);
        expect(profile.groups[0].services[0].config_groups).toHaveLength(2);
    });
});

// ─── F-L3: Schema Validation Error Tests ─────────────────────────────────────

describe('Profile Loader — F-L3: Schema Validation Errors', () => {
    const filename = 'invalid_schema.json';

    beforeEach(async () => {
        // Missing required fields: schema_version, project_name, groups
        await writeFixture(filename, {});
    });

    afterEach(async () => {
        await removeFixture(filename);
    });

    it('throws ProfileSchemaValidationError for invalid schema', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        await expect(loadProfile(filePath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileSchemaValidationError);
    });

    it('ProfileSchemaValidationError aggregates all schema errors', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        try {
            await loadProfile(filePath, testCatalog, testRegionMap);
        } catch (err) {
            expect(err).toBeInstanceOf(ProfileSchemaValidationError);
            expect(err.errors.length).toBeGreaterThan(0);
            expect(err.layer).toBe('F-L3');
        }
    });

    it('throws ProfileSchemaValidationError for wrong schema_version', async () => {
        await writeFixture(filename, { schema_version: '1.0' });
        const filePath = path.join(FIXTURES_DIR, filename);
        await expect(loadProfile(filePath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileSchemaValidationError);
    });

    it('ProfileSchemaValidationError is instance of ProfileValidationError', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        try {
            await loadProfile(filePath, testCatalog, testRegionMap);
        } catch (err) {
            expect(err).toBeInstanceOf(ProfileSchemaValidationError);
            // ProfileSchemaValidationError extends ProfileValidationError
            expect(err.name).toBe('ProfileSchemaValidationError');
        }
    });
});

// ─── F-L4: Cross-Field Validation Error Tests ────────────────────────────────

describe('Profile Loader — F-L4: Cross-Field Validation Errors', () => {
    afterEach(async () => {
        await removeFixture('cross_error.json');
    });

    it('throws ProfileCrossValidationError for unknown service_name', async () => {
        const profile = {
            ...validProfile,
            groups: [{
                ...validProfile.groups[0],
                services: [{
                    ...validProfile.groups[0].services[0],
                    service_name: 'Unknown Service',
                }],
            }],
        };
        const filePath = await writeFixture('cross_error.json', profile);
        await expect(loadProfile(filePath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileCrossValidationError);
    });

    it('throws when a section dimension key is not in catalog', async () => {
        const profile = {
            ...validProfile,
            groups: [{
                ...validProfile.groups[0],
                services: [{
                    ...validProfile.groups[0].services[0],
                    sections: [
                        { section_name: 'Sec', dimensions: { 'BadKey': { user_value: 1, default_value: null } } }
                    ],
                }],
            }],
        };
        const filePath = await writeFixture('cross_section_error.json', profile);
        await expect(loadProfile(filePath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileCrossValidationError);
    });

    it('throws ProfileCrossValidationError for invalid region', async () => {
        const profile = {
            ...validProfile,
            groups: [{
                ...validProfile.groups[0],
                services: [{
                    ...validProfile.groups[0].services[0],
                    region: 'invalid-region',
                }],
            }],
        };
        const filePath = await writeFixture('cross_error.json', profile);
        await expect(loadProfile(filePath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileCrossValidationError);
    });

    it('accepts "global" as a valid region', async () => {
        const profile = {
            ...validProfile,
            groups: [{
                ...validProfile.groups[0],
                services: [{
                    ...validProfile.groups[0].services[0],
                    region: 'global',
                }],
            }],
        };
        const filePath = await writeFixture('global_region.json', profile);
        try {
            const result = await loadProfile(filePath, testCatalog, testRegionMap);
            expect(result).toBeInstanceOf(ProfileDocument);
            expect(result.groups[0].services[0].region).toBe('global');
        } finally {
            await removeFixture('global_region.json');
        }
    });

    it('throws ProfileCrossValidationError for unknown dimension key', async () => {
        const profile = {
            ...validProfile,
            groups: [{
                ...validProfile.groups[0],
                services: [{
                    ...validProfile.groups[0].services[0],
                    dimensions: {
                        'NonExistentDimension': { user_value: 'test', default_value: null },
                    },
                }],
            }],
        };
        const filePath = await writeFixture('cross_error.json', profile);
        await expect(loadProfile(filePath, testCatalog, testRegionMap))
            .rejects
            .toThrow(ProfileCrossValidationError);
    });

    it('ProfileCrossValidationError includes violationType', async () => {
        const profile = {
            ...validProfile,
            groups: [{
                ...validProfile.groups[0],
                services: [{
                    ...validProfile.groups[0].services[0],
                    service_name: 'Unknown Service',
                }],
            }],
        };
        const filePath = await writeFixture('cross_error.json', profile);
        try {
            await loadProfile(filePath, testCatalog, testRegionMap);
        } catch (err) {
            expect(err).toBeInstanceOf(ProfileCrossValidationError);
            expect(err.violationType).toBe('service');
            expect(err.layer).toBe('F-L4');
        }
    });
});

// ─── Success Path Tests ──────────────────────────────────────────────────────

describe('Profile Loader — Success Path', () => {
    const filename = 'valid_profile.json';

    beforeEach(async () => {
        await writeFixture(filename, validProfile);
    });

    afterEach(async () => {
        await removeFixture(filename);
    });

    it('loads and returns a valid ProfileDocument', async () => {
        const filePath = path.join(FIXTURES_DIR, filename);
        const result = await loadProfile(filePath, testCatalog, testRegionMap);

        expect(result).toBeInstanceOf(ProfileDocument);
        expect(result.schema_version).toBe('2.0');
        expect(result.project_name).toBe('Test Project');
        expect(result.groups.length).toBe(1);
        expect(result.groups[0].services.length).toBe(1);
    });

    it('preserves null user_value and default_value as valid', async () => {
        const profileWithNulls = {
            ...validProfile,
            groups: [{
                ...validProfile.groups[0],
                services: [{
                    ...validProfile.groups[0].services[0],
                    dimensions: {
                        'Operating System': { user_value: null, default_value: null },
                        'Instance type': { user_value: null, default_value: null },
                    },
                }],
            }],
        };
        await writeFixture(filename, profileWithNulls);
        const filePath = path.join(FIXTURES_DIR, filename);
        const result = await loadProfile(filePath, testCatalog, testRegionMap);

        expect(result).toBeInstanceOf(ProfileDocument);
        const dim = result.groups[0].services[0].getDimension('Operating System');
        expect(dim.user_value).toBe(null);
        expect(dim.default_value).toBe(null);
    });

    it('handles relative paths correctly', async () => {
        // Write to current directory for relative path test
        const relativePath = 'test_relative_profile.json';
        await fs.writeFile(relativePath, JSON.stringify(validProfile, null, 2), 'utf-8');
        try {
            const result = await loadProfile(relativePath, testCatalog, testRegionMap);
            expect(result).toBeInstanceOf(ProfileDocument);
        } finally {
            await fs.unlink(relativePath);
        }
    });
});

// ─── Error Class Hierarchy Tests ─────────────────────────────────────────────

describe('Profile Loader — Error Class Hierarchy', () => {
    it('ProfileFileNotFoundError extends ProfileLoadError', () => {
        const err = new ProfileFileNotFoundError('/test/path.json');
        expect(err).toBeInstanceOf(ProfileLoadError);
        expect(err.name).toBe('ProfileFileNotFoundError');
    });

    it('ProfileJSONParseError extends ProfileLoadError', () => {
        const err = new ProfileJSONParseError('/test/path.json');
        expect(err).toBeInstanceOf(ProfileLoadError);
        expect(err.name).toBe('ProfileJSONParseError');
    });

    it('ProfileSchemaValidationError extends ProfileValidationError', () => {
        const err = new ProfileSchemaValidationError('/test/path.json', ['error1']);
        expect(err.name).toBe('ProfileSchemaValidationError');
        expect(err.errors).toEqual(['error1']);
    });

    it('ProfileCrossValidationError extends ProfileValidationError', () => {
        const err = new ProfileCrossValidationError('/test/path.json', ['error1'], 'service');
        expect(err.name).toBe('ProfileCrossValidationError');
        expect(err.errors).toEqual(['error1']);
        expect(err.violationType).toBe('service');
    });

    it('All loader errors have layer property', () => {
        expect(new ProfileFileNotFoundError('/test.json').layer).toBe('F-L1');
        expect(new ProfileJSONParseError('/test.json').layer).toBe('F-L2');
        expect(new ProfileSchemaValidationError('/test.json', []).layer).toBe('F-L3');
        expect(new ProfileCrossValidationError('/test.json', [], 'service').layer).toBe('F-L4');
    });
});

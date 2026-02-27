// Feature: aws-cost-profile-builder, Property 20: Explorer Write Isolation
// Validates: Requirements 13.5

import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  resolveExplorerOutputPaths,
  writeDraftCatalog,
  writeExplorationReport,
  writeReviewNotes,
} from '../../explorer/draft/draft_writer.js';

/**
 * Returns true when file exists.
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe('Property 20: Explorer Write Isolation', () => {
  // Feature: aws-cost-profile-builder, Property 20: Explorer Write Isolation
  it('resolved explorer paths always target generated/ or artifacts/ (never direct services/)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (rawServiceId, suffix) => {
          fc.pre(/[a-z0-9]/i.test(rawServiceId));
          const safeSuffix = suffix.replace(/[^a-zA-Z0-9_-]/g, 'x') || 'x';
          const baseDir = `/tmp/aws-cost-p20-${safeSuffix}`;
          const paths = resolveExplorerOutputPaths(rawServiceId, baseDir);

          const servicesRoot = resolve(baseDir, 'config', 'data', 'services');
          const generatedRoot = resolve(servicesRoot, 'generated');
          const artifactsRoot = resolve(baseDir, 'artifacts');

          expect(paths.draftPath.startsWith(generatedRoot + sep)).toBe(true);
          expect(paths.reportPath.startsWith(artifactsRoot + sep)).toBe(true);
          expect(paths.reviewNotesPath.startsWith(artifactsRoot + sep)).toBe(true);
          expect(paths.screenshotsDir.startsWith(artifactsRoot + sep)).toBe(true);

          // Core isolation assertion: draft file is never direct validated catalog path.
          expect(paths.draftPath).not.toBe(paths.forbiddenValidatedCatalogPath);
          expect(paths.forbiddenValidatedCatalogPath.startsWith(servicesRoot + sep)).toBe(true);
          expect(paths.forbiddenValidatedCatalogPath.includes(`${sep}generated${sep}`)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('writer functions create files only under generated/ and artifacts/', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'aws-cost-p20-'));
    try {
      const serviceId = 'Amazon OpenSearch';
      const draft = {
        service_name: 'Amazon OpenSearch',
        search_term: 'Amazon OpenSearch Service',
        calculator_page_title: 'Amazon OpenSearch Service',
        supported_regions: ['us-east-1'],
        dimensions: [
          {
            key: 'Data nodes',
            field_type: 'NUMBER',
            default_value: 1,
            required: true,
            options: null,
            unit: null,
            unit_sibling: null,
          },
        ],
      };
      const report = {
        fields: [],
        conflicts: [],
      };

      const draftPath = await writeDraftCatalog(serviceId, draft, baseDir);
      const reportPath = await writeExplorationReport(serviceId, report, baseDir);
      const notesPath = await writeReviewNotes(serviceId, report, baseDir);
      const paths = resolveExplorerOutputPaths(serviceId, baseDir);

      expect(await exists(draftPath)).toBe(true);
      expect(await exists(reportPath)).toBe(true);
      expect(await exists(notesPath)).toBe(true);

      // Must not write direct validated catalog during explore write phase.
      expect(await exists(paths.forbiddenValidatedCatalogPath)).toBe(false);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

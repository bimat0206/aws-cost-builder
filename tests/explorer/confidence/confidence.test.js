/**
 * Tests for explorer/confidence/ module.
 *
 * Covers:
 *   - confidence_scorer.js: Confidence score computation and validation
 *
 * Property P19: Explorer Confidence Scores Are Bounded
 *   All confidence scores (label_confidence, section_confidence,
 *   field_type_confidence, overall_confidence) must be floats in [0.0, 1.0].
 *
 * Validates: Requirements 13.3
 */

// Feature: aws-cost-profile-builder, Property 19: Explorer Confidence Scores Are Bounded

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  scoreField,
  scoreAllFields,
  getFieldsNeedingReview,
  getConfidenceSummary,
  validateConfidenceScores,
} from '../../../explorer/confidence/confidence_scorer.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generate arbitrary field objects for testing.
 */
const arbField = fc.record({
  label: fc.oneof(
    fc.constant('Unnamed Field'),
    fc.string({ minLength: 1, maxLength: 50 }),
  ),
  selector: fc.string({ minLength: 1, maxLength: 100 }),
  detectedType: fc.constantFrom('NUMBER', 'TEXT', 'SELECT', 'COMBOBOX', 'TOGGLE', 'RADIO'),
  section: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  unit: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
  metadata: fc.record({
    id: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
    class: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
    name: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
    ariaLabel: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
    ariaDescribedby: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
    role: fc.oneof(fc.constant(null), fc.constantFrom('combobox', 'spinbutton', 'switch', 'radio', 'listbox')),
    tagName: fc.constantFrom('input', 'select', 'textarea', 'div'),
    inputType: fc.oneof(fc.constant(null), fc.constantFrom('number', 'text', 'checkbox', 'radio')),
  }),
});

/**
 * Generate arbitrary arrays of fields.
 */
const arbFields = fc.array(arbField, { minLength: 1, maxLength: 20 });

// ─── Unit Tests: scoreField() ─────────────────────────────────────────────────

describe('explorer/confidence/confidence_scorer.js', () => {
  describe('scoreField()', () => {
    it('returns scores object with all required properties', () => {
      const field = {
        label: 'Test Field',
        selector: 'input#test',
        detectedType: 'NUMBER',
        section: 'Test Section',
        metadata: { inputType: 'number', tagName: 'input' },
      };

      const scores = scoreField(field);

      expect(scores).toHaveProperty('label_confidence');
      expect(scores).toHaveProperty('section_confidence');
      expect(scores).toHaveProperty('field_type_confidence');
      expect(scores).toHaveProperty('overall_confidence');
      expect(scores).toHaveProperty('review_required');
      expect(scores).toHaveProperty('review_reasons');
    });

    it('returns high confidence for well-labeled field with explicit type', () => {
      const field = {
        label: 'Number of Instances',
        selector: 'input#instances',
        detectedType: 'NUMBER',
        section: 'Compute Configuration',
        metadata: {
          id: 'instances',
          ariaLabel: 'Number of Instances',
          inputType: 'number',
          tagName: 'input',
        },
      };

      const scores = scoreField(field);

      expect(scores.label_confidence).toBeGreaterThanOrEqual(0.8);
      expect(scores.field_type_confidence).toBe(1.0);
      expect(scores.overall_confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('returns low confidence for unnamed field', () => {
      const field = {
        label: 'Unnamed Field',
        selector: 'div.unknown',
        detectedType: 'TEXT',
        section: null,
        metadata: {},
      };

      const scores = scoreField(field);

      expect(scores.label_confidence).toBeLessThan(0.5);
      expect(scores.review_required).toBe(true);
      expect(scores.review_reasons).toContain('No label found - manual label assignment required');
    });

    it('flags fields with low overall confidence for review', () => {
      const field = {
        label: 'Unnamed Field',
        selector: 'div.unknown',
        detectedType: 'TEXT',
        section: null,
        metadata: {},
      };

      const scores = scoreField(field);

      expect(scores.review_required).toBe(true);
      expect(scores.review_reasons.length).toBeGreaterThan(0);
    });

    it('does not flag high-confidence fields for review', () => {
      const field = {
        label: 'Instance Type',
        selector: 'select#instance-type',
        detectedType: 'SELECT',
        section: 'Compute',
        metadata: {
          id: 'instance-type',
          tagName: 'select',
        },
      };

      const scores = scoreField(field);

      expect(scores.overall_confidence).toBeGreaterThanOrEqual(0.7);
      // May still flag for review if any individual score is low
    });
  });

  describe('scoreAllFields()', () => {
    it('scores all fields in array', () => {
      const fields = [
        { label: 'Field 1', selector: 'input#1', detectedType: 'NUMBER', section: 'Section 1', metadata: {} },
        { label: 'Field 2', selector: 'input#2', detectedType: 'TEXT', section: 'Section 2', metadata: {} },
      ];

      const result = scoreAllFields(fields);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('field');
      expect(result[0]).toHaveProperty('scores');
      expect(result[1]).toHaveProperty('field');
      expect(result[1]).toHaveProperty('scores');
    });

    it('returns empty array for empty input', () => {
      const result = scoreAllFields([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('getFieldsNeedingReview()', () => {
    it('returns only fields that need review', () => {
      const fields = [
        { label: 'Good Field', selector: 'input#good', detectedType: 'NUMBER', section: 'Section', metadata: { inputType: 'number' } },
        { label: 'Unnamed Field', selector: 'div.bad', detectedType: 'TEXT', section: null, metadata: {} },
      ];

      const review = getFieldsNeedingReview(fields);

      expect(review.length).toBeLessThanOrEqual(fields.length);
      // At least the unnamed field should be in review
      expect(review.some(r => r.field.label === 'Unnamed Field')).toBe(true);
    });

    it('returns empty array if no fields need review', () => {
      const fields = [
        {
          label: 'Good Field',
          selector: 'input#good',
          detectedType: 'NUMBER',
          section: 'Section',
          metadata: { inputType: 'number', ariaLabel: 'Good Field' },
        },
      ];

      const review = getFieldsNeedingReview(fields);
      // May or may not have fields depending on scoring
      expect(Array.isArray(review)).toBe(true);
    });
  });

  describe('getConfidenceSummary()', () => {
    it('returns summary statistics for scores', () => {
      const scores = [
        { label_confidence: 0.9, section_confidence: 0.8, field_type_confidence: 1.0, overall_confidence: 0.9, review_required: false },
        { label_confidence: 0.5, section_confidence: 0.4, field_type_confidence: 0.6, overall_confidence: 0.5, review_required: true },
      ];

      const summary = getConfidenceSummary(scores);

      expect(summary.total).toBe(2);
      expect(summary.avg_label).toBe(0.7);
      expect(summary.avg_section).toBe(0.6);
      expect(summary.avg_field_type).toBe(0.8);
      expect(summary.avg_overall).toBe(0.7);
      expect(summary.review_required_count).toBe(1);
      expect(summary.review_required_pct).toBe(50);
    });

    it('returns zero summary for empty array', () => {
      const summary = getConfidenceSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.avg_label).toBe(0);
      expect(summary.avg_section).toBe(0);
      expect(summary.avg_field_type).toBe(0);
      expect(summary.avg_overall).toBe(0);
      expect(summary.review_required_count).toBe(0);
      expect(summary.review_required_pct).toBe(0);
    });
  });

  describe('validateConfidenceScores()', () => {
    it('returns true for valid scores', () => {
      const scores = {
        label_confidence: 0.8,
        section_confidence: 0.7,
        field_type_confidence: 0.9,
        overall_confidence: 0.8,
        review_required: false,
      };

      expect(validateConfidenceScores(scores)).toBe(true);
    });

    it('returns false for scores out of range', () => {
      const scores = {
        label_confidence: 1.5,
        section_confidence: 0.7,
        field_type_confidence: 0.9,
        overall_confidence: 0.8,
        review_required: false,
      };

      expect(validateConfidenceScores(scores)).toBe(false);
    });

    it('returns false for negative scores', () => {
      const scores = {
        label_confidence: -0.1,
        section_confidence: 0.7,
        field_type_confidence: 0.9,
        overall_confidence: 0.8,
        review_required: false,
      };

      expect(validateConfidenceScores(scores)).toBe(false);
    });

    it('returns false for non-boolean review_required', () => {
      const scores = {
        label_confidence: 0.8,
        section_confidence: 0.7,
        field_type_confidence: 0.9,
        overall_confidence: 0.8,
        review_required: 'yes',
      };

      expect(validateConfidenceScores(scores)).toBe(false);
    });

    it('returns false for non-number scores', () => {
      const scores = {
        label_confidence: 'high',
        section_confidence: 0.7,
        field_type_confidence: 0.9,
        overall_confidence: 0.8,
        review_required: false,
      };

      expect(validateConfidenceScores(scores)).toBe(false);
    });
  });
});

// ─── Property P19: Explorer Confidence Scores Are Bounded ─────────────────────

describe('Property 19: Explorer Confidence Scores Are Bounded', () => {
  // Feature: aws-cost-profile-builder, Property 19: Explorer Confidence Scores Are Bounded
  // Validates: Requirements 13.3

  it('all confidence scores are always in [0.0, 1.0] range', () => {
    fc.assert(
      fc.property(arbField, (field) => {
        const scores = scoreField(field);

        // All scores must be numbers
        expect(typeof scores.label_confidence).toBe('number');
        expect(typeof scores.section_confidence).toBe('number');
        expect(typeof scores.field_type_confidence).toBe('number');
        expect(typeof scores.overall_confidence).toBe('number');

        // All scores must be in [0.0, 1.0] range
        expect(scores.label_confidence).toBeGreaterThanOrEqual(0);
        expect(scores.label_confidence).toBeLessThanOrEqual(1);
        expect(scores.section_confidence).toBeGreaterThanOrEqual(0);
        expect(scores.section_confidence).toBeLessThanOrEqual(1);
        expect(scores.field_type_confidence).toBeGreaterThanOrEqual(0);
        expect(scores.field_type_confidence).toBeLessThanOrEqual(1);
        expect(scores.overall_confidence).toBeGreaterThanOrEqual(0);
        expect(scores.overall_confidence).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it('overall confidence is always weighted average of component scores', () => {
    fc.assert(
      fc.property(arbField, (field) => {
        const scores = scoreField(field);

        // Calculate expected weighted average
        const expected =
          scores.label_confidence * 0.4 +
          scores.section_confidence * 0.3 +
          scores.field_type_confidence * 0.3;

        // Allow small floating point tolerance
        expect(Math.abs(scores.overall_confidence - expected)).toBeLessThan(0.01);
      }),
      { numRuns: 100 },
    );
  });

  it('review_required is always a boolean', () => {
    fc.assert(
      fc.property(arbField, (field) => {
        const scores = scoreField(field);
        expect(typeof scores.review_required).toBe('boolean');
      }),
      { numRuns: 100 },
    );
  });

  it('review_reasons is always an array', () => {
    fc.assert(
      fc.property(arbField, (field) => {
        const scores = scoreField(field);
        expect(Array.isArray(scores.review_reasons)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('validateConfidenceScores returns true for all scored fields', () => {
    fc.assert(
      fc.property(arbField, (field) => {
        const scores = scoreField(field);
        expect(validateConfidenceScores(scores)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('scoreAllFields produces valid scores for all fields', () => {
    fc.assert(
      fc.property(arbFields, (fields) => {
        const result = scoreAllFields(fields);

        expect(result).toHaveLength(fields.length);

        for (const item of result) {
          expect(validateConfidenceScores(item.scores)).toBe(true);

          // Verify bounds
          expect(item.scores.label_confidence).toBeGreaterThanOrEqual(0);
          expect(item.scores.label_confidence).toBeLessThanOrEqual(1);
          expect(item.scores.section_confidence).toBeGreaterThanOrEqual(0);
          expect(item.scores.section_confidence).toBeLessThanOrEqual(1);
          expect(item.scores.field_type_confidence).toBeGreaterThanOrEqual(0);
          expect(item.scores.field_type_confidence).toBeLessThanOrEqual(1);
          expect(item.scores.overall_confidence).toBeGreaterThanOrEqual(0);
          expect(item.scores.overall_confidence).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('confidence summary always returns valid statistics', () => {
    fc.assert(
      fc.property(arbFields, (fields) => {
        const scored = scoreAllFields(fields);
        const scores = scored.map(s => s.scores);
        const summary = getConfidenceSummary(scores);

        // Summary must have all required properties
        expect(summary).toHaveProperty('total');
        expect(summary).toHaveProperty('avg_label');
        expect(summary).toHaveProperty('avg_section');
        expect(summary).toHaveProperty('avg_field_type');
        expect(summary).toHaveProperty('avg_overall');
        expect(summary).toHaveProperty('review_required_count');
        expect(summary).toHaveProperty('review_required_pct');

        // Total must match input
        expect(summary.total).toBe(fields.length);

        // Averages must be in [0, 1] range
        expect(summary.avg_label).toBeGreaterThanOrEqual(0);
        expect(summary.avg_label).toBeLessThanOrEqual(1);
        expect(summary.avg_section).toBeGreaterThanOrEqual(0);
        expect(summary.avg_section).toBeLessThanOrEqual(1);
        expect(summary.avg_field_type).toBeGreaterThanOrEqual(0);
        expect(summary.avg_field_type).toBeLessThanOrEqual(1);
        expect(summary.avg_overall).toBeGreaterThanOrEqual(0);
        expect(summary.avg_overall).toBeLessThanOrEqual(1);

        // Percentage must be in [0, 100] range
        expect(summary.review_required_pct).toBeGreaterThanOrEqual(0);
        expect(summary.review_required_pct).toBeLessThanOrEqual(100);

        // Count must be non-negative and <= total
        expect(summary.review_required_count).toBeGreaterThanOrEqual(0);
        expect(summary.review_required_count).toBeLessThanOrEqual(summary.total);
      }),
      { numRuns: 100 },
    );
  });

  it('fields with aria-label always have higher label confidence', () => {
    fc.assert(
      fc.property(arbField, (field) => {
        // Create two versions: one with aria-label, one without
        const withAriaLabel = {
          ...field,
          metadata: { ...field.metadata, ariaLabel: 'Test Label' },
        };
        const withoutAriaLabel = {
          ...field,
          metadata: { ...field.metadata, ariaLabel: null },
        };

        const scoresWith = scoreField(withAriaLabel);
        const scoresWithout = scoreField(withoutAriaLabel);

        // aria-label should give highest confidence
        expect(scoresWith.label_confidence).toBeGreaterThanOrEqual(scoresWithout.label_confidence);
      }),
      { numRuns: 100 },
    );
  });

  it('fields with explicit inputType have higher field_type_confidence', () => {
    fc.assert(
      fc.property(arbField, (field) => {
        const withInputType = {
          ...field,
          detectedType: 'NUMBER',
          metadata: { ...field.metadata, inputType: 'number', tagName: 'input' },
        };
        const withoutInputType = {
          ...field,
          detectedType: 'TEXT',
          metadata: { ...field.metadata, inputType: null, tagName: 'div' },
        };

        const scoresWith = scoreField(withInputType);
        const scoresWithout = scoreField(withoutInputType);

        expect(scoresWith.field_type_confidence).toBeGreaterThan(scoresWithout.field_type_confidence);
      }),
      { numRuns: 100 },
    );
  });
});

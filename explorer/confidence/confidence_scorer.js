/**
 * Confidence scorer for discovered fields.
 *
 * Computes confidence scores for each discovered field based on:
 * - Label confidence: How certain we are about the field's label
 * - Section confidence: How certain we are about the field's section assignment
 * - Field type confidence: How certain we are about the detected field type
 * - Overall confidence: Weighted average of all scores
 *
 * Fields with low confidence are flagged for REVIEW_REQUIRED.
 *
 * @module explorer/confidence/confidence_scorer
 */

// ─── Confidence scoring constants ─────────────────────────────────────────────

/**
 * Weights for overall confidence calculation.
 */
const WEIGHTS = {
  LABEL: 0.4,
  SECTION: 0.3,
  FIELD_TYPE: 0.3,
};

/**
 * Minimum confidence threshold for flagging review.
 */
const REVIEW_THRESHOLD = 0.6;

/**
 * Label source confidence scores.
 */
const LABEL_SOURCE_SCORES = {
  ARIA_LABEL: 1.0,      // Explicit aria-label is most reliable
  ASSOCIATED_LABEL: 0.95, // Label with for attribute
  WRAPPING_LABEL: 0.85,   // Input wrapped in label
  PLACEHOLDER: 0.7,       // Placeholder text (less reliable)
  PRECEDING_TEXT: 0.6,    // Text node before input
  PARENT_TEXT: 0.5,       // Text from parent element
  FALLBACK: 0.3,          // Generated from attributes
  NONE: 0.1,              // No label found
};

/**
 * Section source confidence scores.
 */
const SECTION_SOURCE_SCORES = {
  EXPLICIT_TITLE: 1.0,    // Section has explicit title element
  DATA_ATTRIBUTE: 0.9,    // Section from data-section attribute
  FIELDSET_LEGEND: 0.85,  // Section from fieldset legend
  CONTAINER_CLASS: 0.7,   // Section inferred from container class
  NEAREST_HEADING: 0.6,   // Section from nearest heading
  NONE: 0.3,              // No section context
};

/**
 * Field type detection confidence scores.
 */
const FIELD_TYPE_SCORES = {
  EXPLICIT_TYPE: 1.0,     // input[type=number], input[type=text], etc.
  SEMANTIC_TAG: 0.95,     // select, textarea
  ARIA_ROLE: 0.85,        // role=combobox, role=spinbutton, etc.
  CONTEXT_INFERRED: 0.7,  // Inferred from surrounding context
  FALLBACK: 0.5,          // Default fallback type
};

// ─── Confidence scoring functions ─────────────────────────────────────────────

/**
 * @typedef {Object} ConfidenceScore
 * @property {number} label_confidence - [0.0, 1.0]
 * @property {number} section_confidence - [0.0, 1.0]
 * @property {number} field_type_confidence - [0.0, 1.0]
 * @property {number} overall_confidence - [0.0, 1.0]
 * @property {boolean} review_required
 * @property {string[]} review_reasons - List of reasons why review is needed
 */

/**
 * Compute label confidence based on how the label was extracted.
 *
 * @param {object} field - The scanned field object
 * @param {object} field.metadata - Field metadata
 * @returns {number} Label confidence score [0.0, 1.0]
 */
function computeLabelConfidence(field) {
  const metadata = field.metadata || {};
  const label = field.label;

  // No label at all
  if (!label || label === 'Unnamed Field') {
    return LABEL_SOURCE_SCORES.NONE;
  }

  // Check label source priority
  if (metadata.ariaLabel) {
    return LABEL_SOURCE_SCORES.ARIA_LABEL;
  }

  // Check if there's an ID (suggests associated label might exist)
  if (metadata.id) {
    return LABEL_SOURCE_SCORES.ASSOCIATED_LABEL;
  }

  // Check if placeholder was used
  if (metadata.boundingBox && label.length < 50) {
    // Short labels are more likely to be actual labels
    if (metadata.inputType || metadata.role) {
      return LABEL_SOURCE_SCORES.WRAPPING_LABEL;
    }
  }

  // Generic label - moderate confidence
  return LABEL_SOURCE_SCORES.PRECEDING_TEXT;
}

/**
 * Compute section confidence based on section context.
 *
 * @param {object} field - The scanned field object
 * @returns {number} Section confidence score [0.0, 1.0]
 */
function computeSectionConfidence(field) {
  const section = field.section;
  const metadata = field.metadata || {};

  // No section context
  if (!section) {
    return SECTION_SOURCE_SCORES.NONE;
  }

  // Check if selector suggests explicit section container
  const selector = field.selector || '';
  if (selector.includes('section') || selector.includes('fieldset')) {
    return SECTION_SOURCE_SCORES.EXPLICIT_TITLE;
  }

  // Check for data attributes
  if (metadata.class && metadata.class.includes('section')) {
    return SECTION_SOURCE_SCORES.DATA_ATTRIBUTE;
  }

  // Generic section assignment
  return SECTION_SOURCE_SCORES.NEAREST_HEADING;
}

/**
 * Compute field type confidence based on detection method.
 *
 * @param {object} field - The scanned field object
 * @param {string} field.detectedType - The detected field type
 * @param {object} field.metadata - Field metadata
 * @returns {number} Field type confidence score [0.0, 1.0]
 */
function computeFieldTypeConfidence(field) {
  const metadata = field.metadata || {};
  const detectedType = field.detectedType;

  // Explicit type attribute
  if (metadata.inputType && ['number', 'text', 'checkbox', 'radio'].includes(metadata.inputType)) {
    return FIELD_TYPE_SCORES.EXPLICIT_TYPE;
  }

  // Semantic HTML tags
  if (metadata.tagName === 'select' || metadata.tagName === 'textarea') {
    return FIELD_TYPE_SCORES.SEMANTIC_TAG;
  }

  // ARIA role
  if (metadata.role && ['combobox', 'spinbutton', 'switch', 'listbox'].includes(metadata.role)) {
    return FIELD_TYPE_SCORES.ARIA_ROLE;
  }

  // Inferred from context
  if (detectedType && detectedType !== 'TEXT') {
    return FIELD_TYPE_SCORES.CONTEXT_INFERRED;
  }

  // Fallback
  return FIELD_TYPE_SCORES.FALLBACK;
}

/**
 * Determine review reasons based on low-confidence areas.
 *
 * @param {object} scores - Confidence scores object
 * @param {object} field - The scanned field object
 * @returns {string[]} List of review reasons
 */
function determineReviewReasons(scores, field) {
  const reasons = [];

  if (scores.label_confidence < REVIEW_THRESHOLD) {
    reasons.push('Low label confidence - label may be incorrect or missing');
  }

  if (scores.section_confidence < REVIEW_THRESHOLD) {
    reasons.push('Low section confidence - section assignment may be incorrect');
  }

  if (scores.field_type_confidence < REVIEW_THRESHOLD) {
    reasons.push('Low field type confidence - detected type may be incorrect');
  }

  if (field.label === 'Unnamed Field') {
    reasons.push('No label found - manual label assignment required');
  }

  if (!field.section) {
    reasons.push('No section context - manual section assignment required');
  }

  if (field.detectedType === 'TEXT' && !field.metadata?.inputType) {
    reasons.push('Generic TEXT type - consider verifying if more specific type applies');
  }

  return reasons;
}

/**
 * Compute confidence scores for a discovered field.
 *
 * @param {object} field - The scanned field object with label, selector, detectedType, section, metadata
 * @returns {ConfidenceScore} Confidence scores with review flag
 */
export function scoreField(field) {
  const labelConfidence = computeLabelConfidence(field);
  const sectionConfidence = computeSectionConfidence(field);
  const fieldTypeConfidence = computeFieldTypeConfidence(field);

  // Calculate weighted overall confidence
  const overallConfidence =
    (labelConfidence * WEIGHTS.LABEL) +
    (sectionConfidence * WEIGHTS.SECTION) +
    (fieldTypeConfidence * WEIGHTS.FIELD_TYPE);

  // Determine if review is required
  const reviewRequired =
    overallConfidence < REVIEW_THRESHOLD ||
    labelConfidence < 0.5 ||
    sectionConfidence < 0.5 ||
    fieldTypeConfidence < 0.5;

  // Determine review reasons
  const scores = {
    label_confidence: labelConfidence,
    section_confidence: sectionConfidence,
    field_type_confidence: fieldTypeConfidence,
    overall_confidence: overallConfidence,
  };
  const reviewReasons = reviewRequired ? determineReviewReasons(scores, field) : [];

  return {
    label_confidence: roundScore(labelConfidence),
    section_confidence: roundScore(sectionConfidence),
    field_type_confidence: roundScore(fieldTypeConfidence),
    overall_confidence: roundScore(overallConfidence),
    review_required: reviewRequired,
    review_reasons: reviewReasons,
  };
}

/**
 * Round score to 2 decimal places.
 * @param {number} score
 * @returns {number}
 */
function roundScore(score) {
  return Math.round(score * 100) / 100;
}

/**
 * Score all fields in an array.
 *
 * @param {object[]} fields - Array of scanned field objects
 * @returns {Array<{ field: object, scores: ConfidenceScore }>}
 */
export function scoreAllFields(fields) {
  return fields.map(field => ({
    field,
    scores: scoreField(field),
  }));
}

/**
 * Get fields that require review.
 *
 * @param {object[]} fields - Array of scanned field objects
 * @returns {Array<{ field: object, scores: ConfidenceScore }>}
 */
export function getFieldsNeedingReview(fields) {
  const scored = scoreAllFields(fields);
  return scored.filter(item => item.scores.review_required);
}

/**
 * Get summary statistics for confidence scores.
 *
 * @param {ConfidenceScore[]} scores - Array of confidence score objects
 * @returns {object} Summary statistics
 */
export function getConfidenceSummary(scores) {
  if (scores.length === 0) {
    return {
      total: 0,
      avg_label: 0,
      avg_section: 0,
      avg_field_type: 0,
      avg_overall: 0,
      review_required_count: 0,
      review_required_pct: 0,
    };
  }

  const total = scores.length;
  const reviewRequiredCount = scores.filter(s => s.review_required).length;

  const avgLabel = scores.reduce((sum, s) => sum + s.label_confidence, 0) / total;
  const avgSection = scores.reduce((sum, s) => sum + s.section_confidence, 0) / total;
  const avgFieldType = scores.reduce((sum, s) => sum + s.field_type_confidence, 0) / total;
  const avgOverall = scores.reduce((sum, s) => sum + s.overall_confidence, 0) / total;

  return {
    total,
    avg_label: roundScore(avgLabel),
    avg_section: roundScore(avgSection),
    avg_field_type: roundScore(avgFieldType),
    avg_overall: roundScore(avgOverall),
    review_required_count: reviewRequiredCount,
    review_required_pct: roundScore((reviewRequiredCount / total) * 100),
  };
}

/**
 * Validate that confidence scores are within valid bounds.
 *
 * @param {ConfidenceScore} scores
 * @returns {boolean} True if all scores are valid
 */
export function validateConfidenceScores(scores) {
  const { label_confidence, section_confidence, field_type_confidence, overall_confidence } = scores;

  // Check all scores are numbers
  if (typeof label_confidence !== 'number' ||
      typeof section_confidence !== 'number' ||
      typeof field_type_confidence !== 'number' ||
      typeof overall_confidence !== 'number') {
    return false;
  }

  // Check all scores are in [0.0, 1.0] range
  if (label_confidence < 0 || label_confidence > 1 ||
      section_confidence < 0 || section_confidence > 1 ||
      field_type_confidence < 0 || field_type_confidence > 1 ||
      overall_confidence < 0 || overall_confidence > 1) {
    return false;
  }

  // Check review_required is boolean
  if (typeof scores.review_required !== 'boolean') {
    return false;
  }

  return true;
}

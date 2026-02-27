/**
 * Screenshot manager — slug normalization and deterministic filename building.
 *
 * Naming convention (from design doc):
 *   <run_id>_<group_slug>_<service_slug>_<step_name>_<epoch_ms>.png
 *
 * Slug rules:
 *   - Lowercase
 *   - Spaces replaced with underscore
 *   - Non-ASCII / unicode stripped (kept: a-z, 0-9, hyphen, underscore)
 *   - Truncated to max 30 characters
 *
 * @module core/emitter/screenshot_manager
 */

import path from 'path';

// ─── Slug normalization ───────────────────────────────────────────────────────

/**
 * Normalize a string to a URL/filename-safe slug.
 *
 * Steps:
 *   1. Convert to lowercase
 *   2. Replace spaces with underscores
 *   3. Remove any character that is not a-z, 0-9, hyphen, or underscore
 *   4. Collapse consecutive underscores/hyphens into a single underscore
 *   5. Strip leading/trailing underscores and hyphens
 *   6. Truncate to maxLength characters (default 30)
 *
 * @param {string} str       - Input string to slugify.
 * @param {number} [maxLen=30] - Maximum character length of the result.
 * @returns {string}
 */
export function slugify(str, maxLen = 30) {
  if (!str || typeof str !== 'string') return 'unknown';

  const result = str
    .toLowerCase()
    .replace(/\s+/g, '_')                   // spaces → underscore
    .replace(/[^a-z0-9_-]/g, '')            // strip unicode and special chars
    .replace(/[_-]{2,}/g, '_')              // collapse consecutive separators
    .replace(/^[_-]+|[_-]+$/g, '')          // strip leading/trailing separators
    .substring(0, maxLen)                    // hard-truncate
    .replace(/[_-]+$/, '');                 // clean up any trailing sep from truncation

  return result.length > 0 ? result : 'unknown';
}

// ─── Filename builder ─────────────────────────────────────────────────────────

/**
 * Build a deterministic screenshot filename following the project convention:
 *   <run_id>_<group_slug>_<service_slug>_<step_name>_<epoch_ms>.png
 *
 * Each of group, service, and step is individually slugified to max 30 chars.
 * The run_id is used as-is (it already follows the run_YYYYMMDD_HHMMSS format).
 *
 * @param {string} runId       - Run identifier, e.g. "run_20240315_143022".
 * @param {string} groupName   - Group name (will be slugified).
 * @param {string} serviceName - Service name (will be slugified).
 * @param {string} stepName    - Step name, e.g. "region_select" (will be slugified).
 * @param {number} [epochMs]   - Epoch milliseconds; defaults to Date.now().
 * @returns {string}           - Filename only (no directory path).
 */
export function buildScreenshotFilename(runId, groupName, serviceName, stepName, epochMs) {
  const ts = typeof epochMs === 'number' ? epochMs : Date.now();

  const groupSlug   = slugify(groupName);
  const serviceSlug = slugify(serviceName);
  const stepSlug    = slugify(stepName);

  return `${runId}_${groupSlug}_${serviceSlug}_${stepSlug}_${ts}.png`;
}

/**
 * Build the full absolute path for a screenshot file.
 *
 * @param {string} screenshotsDir - Absolute directory path for screenshots.
 * @param {string} runId          - Run identifier.
 * @param {string} groupName      - Group name (will be slugified).
 * @param {string} serviceName    - Service name (will be slugified).
 * @param {string} stepName       - Step/failure label (will be slugified).
 * @param {number} [epochMs]      - Epoch milliseconds; defaults to Date.now().
 * @returns {string}              - Full absolute path including filename.
 */
export function buildScreenshotPath(screenshotsDir, runId, groupName, serviceName, stepName, epochMs) {
  const filename = buildScreenshotFilename(runId, groupName, serviceName, stepName, epochMs);
  return path.join(screenshotsDir, filename);
}

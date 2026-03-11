/**
 * Shared draft utility helpers.
 * @module drafts/utils
 */

export const UNKNOWN = 'UNKNOWN';

/**
 * Normalize text.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Slugify service ID.
 * @param {string} serviceName
 * @returns {string}
 */
export function slugifyServiceId(serviceName) {
  if (!serviceName) return 'unknown_service';
  return String(serviceName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50);
}

/**
 * Clean label text.
 * @param {string} raw
 * @returns {string}
 */
export function cleanLabel(raw) {
  let text = normalizeText(raw);
  if (!text) return UNKNOWN;

  text = text.replace(/([a-z])info:\s*/gi, '$1 ');
  text = text.replace(/\binfo:\s*/gi, '');
  text = text.replace(/\s*:\s*/g, ': ');
  text = normalizeText(text);

  const unitPattern = /\s+(per\s+(?:second|minute|hour|day|month|year)s?|seconds?|minutes?|hours?|days?|months?|years?|bytes?|kb|mb|gb|tb|kib|mib|gib)$/i;
  const unitMatch = unitPattern.exec(text);
  if (unitMatch && text.toLowerCase().startsWith('unit ')) {
    text = normalizeText(text.substring(0, unitMatch.index));
  }

  if (/\bunits?\b/i.test(text)) {
    const optionPattern = /\s+(none|thousands?|millions?|billions?|exact number)$/i;
    const optionMatch = optionPattern.exec(text);
    if (optionMatch) {
      text = normalizeText(text.substring(0, optionMatch.index));
    }
  }

  if (text.toLowerCase().endsWith(' none')) {
    text = normalizeText(text.substring(0, text.length - 5));
  }

  return text || UNKNOWN;
}

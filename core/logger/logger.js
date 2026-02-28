/**
 * Shared structured logger.
 * @module core/logger/logger
 */

/**
 * Format and print a structured log line.
 * @param {string} level
 * @param {string} moduleName
 * @param {string} eventType
 * @param {Object} [fields={}]
 */
export function logEvent(level, moduleName, eventType, fields = {}) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Extract event_id if present to keep it at the front of the output
  const eventId = fields.eventId || fields.event_id;
  const restFields = { ...fields };
  delete restFields.eventId;
  delete restFields.event_id;

  const allFields = eventId
    ? { event_id: eventId, event_type: eventType, ...restFields }
    : { event_type: eventType, ...restFields };

  const fieldStr = Object.entries(allFields)
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        return `${k}=${JSON.stringify(v)}`;
      }
      return `${k}=${v}`;
    })
    .join(' ');

  // The moduleName length can vary, let's pick 30 as an average padding to match existing styles
  process.stderr.write(`${ts} | ${level.padEnd(8)} | ${moduleName.padEnd(30)} | ${fieldStr}\n`);
}

/**
 * Shared structured logger.
 * @module core/logger/logger
 */

const LEVEL_ALIASES = {
  WARN: 'WARNING',
};

function normalizeLevel(level) {
  const normalized = String(level ?? 'INFO').toUpperCase();
  return LEVEL_ALIASES[normalized] ?? normalized;
}

function normalizeEventId(fields) {
  if (fields.event_id) return fields.event_id;
  if (fields.eventId) return fields.eventId;
  return null;
}

function mergeErrorFields(prefix, error) {
  if (!(error instanceof Error)) {
    return { [prefix]: error };
  }

  const merged = {
    [`${prefix}_name`]: error.name,
    [`${prefix}_message`]: error.message,
  };

  if ('code' in error && error.code != null) {
    merged[`${prefix}_code`] = error.code;
  }
  if ('retriable' in error && error.retriable != null) {
    merged[`${prefix}_retriable`] = error.retriable;
  }
  if (error.cause instanceof Error) {
    merged[`${prefix}_cause_name`] = error.cause.name;
    merged[`${prefix}_cause_message`] = error.cause.message;
  }

  return merged;
}

function normalizeFields(eventType, fields = {}) {
  const eventId = normalizeEventId(fields);
  const normalized = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || key === 'eventId' || key === 'event_id') {
      continue;
    }

    if (value instanceof Error) {
      Object.assign(normalized, mergeErrorFields(key, value));
      continue;
    }

    normalized[key] = value;
  }

  return eventId
    ? { event_id: eventId, event_type: eventType, ...normalized }
    : { event_type: eventType, ...normalized };
}

function serializeValue(value) {
  if (typeof value === 'string') {
    return /[\s="]/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format and print a structured log line.
 * @param {string} level
 * @param {string} moduleName
 * @param {string} eventType
 * @param {Object} [fields={}]
 */
export function logEvent(level, moduleName, eventType, fields = {}) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const normalizedLevel = normalizeLevel(level);
  const allFields = normalizeFields(eventType, fields);
  const fieldStr = Object.entries(allFields)
    .map(([key, value]) => `${key}=${serializeValue(value)}`)
    .join(' ');

  // The moduleName length can vary, let's pick 30 as an average padding to match existing styles
  process.stderr.write(`${ts} | ${normalizedLevel.padEnd(8)} | ${moduleName.padEnd(30)} | ${fieldStr}\n`);
}

export function createModuleLogger(moduleName, baseFields = {}) {
  const emit = (level, eventType, fields = {}) => {
    logEvent(level, moduleName, eventType, { ...baseFields, ...fields });
  };

  return {
    event: emit,
    info: (eventType, fields = {}) => emit('INFO', eventType, fields),
    warn: (eventType, fields = {}) => emit('WARNING', eventType, fields),
    error: (eventType, fields = {}) => emit('ERROR', eventType, fields),
    critical: (eventType, fields = {}) => emit('CRITICAL', eventType, fields),
    child: (fields = {}) => createModuleLogger(moduleName, { ...baseFields, ...fields }),
  };
}

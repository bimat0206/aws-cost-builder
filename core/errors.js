/**
 * Error categorization for automation module.
 *
 * Matches Python's error categorization logic.
 * Provides typed error classes for better error handling and reporting.
 *
 * @module core/errors
 */

// ─── Base automation error ────────────────────────────────────────────────────

/**
 * Base class for all automation errors.
 */
export class AutomationError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'AUTOMATION_ERROR') {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
  
  /**
   * Get error details as object.
   * @returns {object}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
    };
  }
}

// ─── Locator errors ───────────────────────────────────────────────────────────

/**
 * Error when element cannot be located.
 */
export class LocatorError extends AutomationError {
  /**
   * @param {string} dimensionKey
   * @param {string} [strategy]
   */
  constructor(dimensionKey, strategy = 'unknown') {
    super(`Could not locate element for dimension: "${dimensionKey}" (strategy: ${strategy})`, 'E-LOC-001');
    this.name = 'LocatorError';
    this.dimensionKey = dimensionKey;
    this.strategy = strategy;
  }
}

/**
 * Error when multiple elements match (disambiguation failed).
 */
export class LocatorAmbiguousError extends AutomationError {
  /**
   * @param {string} dimensionKey
   * @param {number} matchCount
   */
  constructor(dimensionKey, matchCount) {
    super(`Found ${matchCount} matches for dimension: "${dimensionKey}"`, 'E-LOC-002');
    this.name = 'LocatorAmbiguousError';
    this.dimensionKey = dimensionKey;
    this.matchCount = matchCount;
  }
}

// ─── Field interaction errors ─────────────────────────────────────────────────

/**
 * Error when field cannot be filled/interacted with.
 */
export class FieldInteractionError extends AutomationError {
  /**
   * @param {string} dimensionKey
   * @param {string} [reason]
   */
  constructor(dimensionKey, reason = 'unknown') {
    super(`Failed to interact with field "${dimensionKey}": ${reason}`, 'E-FLD-001');
    this.name = 'FieldInteractionError';
    this.dimensionKey = dimensionKey;
    this.reason = reason;
  }
}

/**
 * Error when field value verification fails.
 */
export class FieldVerificationError extends AutomationError {
  /**
   * @param {string} dimensionKey
   * @param {string} expectedValue
   * @param {string} actualValue
   */
  constructor(dimensionKey, expectedValue, actualValue) {
    super(
      `Value verification failed for "${dimensionKey}": expected "${expectedValue}", got "${actualValue}"`,
      'E-FLD-002'
    );
    this.name = 'FieldVerificationError';
    this.dimensionKey = dimensionKey;
    this.expectedValue = expectedValue;
    this.actualValue = actualValue;
  }
}

// ─── Navigation errors ────────────────────────────────────────────────────────

/**
 * Error when navigation fails.
 */
export class NavigationError extends AutomationError {
  /**
   * @param {string} message
   * @param {string} [targetUrl]
   */
  constructor(message, targetUrl = null) {
    super(message, 'E-NAV-001');
    this.name = 'NavigationError';
    this.targetUrl = targetUrl;
  }
}

/**
 * Error when service cannot be found/selected.
 */
export class ServiceNotFoundError extends AutomationError {
  /**
   * @param {string} serviceName
   * @param {string[]} [searchTerms]
   */
  constructor(serviceName, searchTerms = []) {
    super(`Service not found: "${serviceName}" (searched: ${searchTerms.join(', ')})`, 'E-NAV-002');
    this.name = 'ServiceNotFoundError';
    this.serviceName = serviceName;
    this.searchTerms = searchTerms;
  }
}

/**
 * Error when region selection fails.
 */
export class RegionSelectionError extends AutomationError {
  /**
   * @param {string} regionCode
   */
  constructor(regionCode) {
    super(`Could not select region: "${regionCode}"`, 'E-NAV-003');
    this.name = 'RegionSelectionError';
    this.regionCode = regionCode;
  }
}

// ─── Browser errors ───────────────────────────────────────────────────────────

/**
 * Error when browser operation fails.
 */
export class BrowserError extends AutomationError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 'E-BRW-001');
    this.name = 'BrowserError';
  }
}

/**
 * Error when browser timeout occurs.
 */
export class BrowserTimeoutError extends AutomationError {
  /**
   * @param {string} action
   * @param {number} timeoutMs
   */
  constructor(action, timeoutMs) {
    super(`Timeout after ${timeoutMs}ms while: ${action}`, 'E-BRW-002');
    this.name = 'BrowserTimeoutError';
    this.action = action;
    this.timeoutMs = timeoutMs;
  }
}

// ─── Catalog errors ───────────────────────────────────────────────────────────

/**
 * Error when catalog selector is stale.
 */
export class StaleSelectorError extends AutomationError {
  /**
   * @param {string} dimensionKey
   * @param {string} staleSelector
   */
  constructor(dimensionKey, staleSelector) {
    super(`Stale selector for "${dimensionKey}": ${staleSelector}`, 'E-CAT-001');
    this.name = 'StaleSelectorError';
    this.dimensionKey = dimensionKey;
    this.staleSelector = staleSelector;
  }
}

/**
 * Error when catalog healing fails.
 */
export class CatalogHealError extends AutomationError {
  /**
   * @param {string} dimensionKey
   */
  constructor(dimensionKey) {
    super(`Failed to heal catalog selector for "${dimensionKey}"`, 'E-CAT-002');
    this.name = 'CatalogHealError';
    this.dimensionKey = dimensionKey;
  }
}

// ─── Error categorization helper ──────────────────────────────────────────────

/**
 * Categorize an error for better handling.
 * @param {Error} error
 * @returns {{ category: string, isRetriable: boolean, shouldScreenshot: boolean }}
 */
export function categorizeError(error) {
  // Locator errors - usually not retriable
  if (error instanceof LocatorError) {
    return {
      category: 'locator',
      isRetriable: false,
      shouldScreenshot: true,
    };
  }
  
  if (error instanceof LocatorAmbiguousError) {
    return {
      category: 'locator',
      isRetriable: false,
      shouldScreenshot: true,
    };
  }
  
  // Field interaction errors - may be retriable
  if (error instanceof FieldInteractionError) {
    return {
      category: 'field_interaction',
      isRetriable: true,
      shouldScreenshot: true,
    };
  }
  
  if (error instanceof FieldVerificationError) {
    return {
      category: 'field_verification',
      isRetriable: true,
      shouldScreenshot: true,
    };
  }
  
  // Navigation errors - usually not retriable
  if (error instanceof NavigationError) {
    return {
      category: 'navigation',
      isRetriable: false,
      shouldScreenshot: true,
    };
  }
  
  if (error instanceof ServiceNotFoundError) {
    return {
      category: 'navigation',
      isRetriable: false,
      shouldScreenshot: true,
    };
  }
  
  if (error instanceof RegionSelectionError) {
    return {
      category: 'navigation',
      isRetriable: false,
      shouldScreenshot: true,
    };
  }
  
  // Browser errors - may be retriable
  if (error instanceof BrowserError) {
    return {
      category: 'browser',
      isRetriable: error instanceof BrowserTimeoutError,
      shouldScreenshot: false,
    };
  }
  
  // Catalog errors - not retriable
  if (error instanceof StaleSelectorError || error instanceof CatalogHealError) {
    return {
      category: 'catalog',
      isRetriable: false,
      shouldScreenshot: false,
    };
  }
  
  // Generic errors - assume retriable
  return {
    category: 'unknown',
    isRetriable: true,
    shouldScreenshot: true,
  };
}

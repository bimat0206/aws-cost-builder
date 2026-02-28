/**
 * Explorer constants.
 * Matches Python explorer/core/constants.py
 * 
 * @module explorer/constants
 */

/** URL for adding a service in AWS Calculator */
export const ADD_SERVICE_URL = 'https://calculator.aws/#/addService';

/** Unknown value sentinel */
export const UNKNOWN = 'UNKNOWN';

/** Service card selector for AWS Calculator UI.
 *
 * Covers multiple versions of the AWS Calculator SPA:
 * - Cloudscape cards (awsui_card, cards__item)
 * - Legacy classes (service-list-item, ServiceItem)
 * - aria/data-testid patterns
 */
export const SERVICE_CARD_SELECTOR = [
  "li[class*='awsui_card']",
  "li[class*='cards__item']",
  "li[class*='awsui_cards__item']",
  "li[class*='service-list-item']",
  "li[class*='ServiceItem']",
  "[data-testid*='service-result']",
  "[data-testid*='service-card']",
  // Broader fallback: any card inside the service search results list
  "ul[class*='awsui_cards'] li",
  "ul[class*='cards__list'] li",
].join(', ');

/** UI mapping template for AWS Calculator elements */
export const UI_MAPPING_TEMPLATE = {
  add_service_button_label: 'Add service',
  configure_button: 'Configure',
  save_button_label: 'Save and add service',
  summary_button_label: 'Save and view summary',
  location_type_label: 'Choose a location type',
  region_picker_label: 'Choose a Region',
  region_option_label: 'Region',
  search_input_placeholders: [
    'Search for a service',
    'Search services',
    'Find resources',
    'Search',
  ],
  searchbox_names: ['Find Service', 'Find resources'],
  service_result_selector: SERVICE_CARD_SELECTOR,
};

/** Unit pattern regex for detecting units in labels */
export const UNIT_PATTERN = /\b(GB|TB|MB|GiB|MiB|KiB|vCPU|hours\/month|requests\/month|requests|ms|%|GB-month|GB-hours|IOPS)\b/i;

/** Default viewport dimensions for browser */
export const DEFAULT_VIEWPORT_WIDTH = 1080;
export const DEFAULT_VIEWPORT_HEIGHT = 1920;

/** Noise patterns for section filtering - matches Python's _NOISE_LABEL_RE */
export const NOISE_LABEL_RE = /^(x86|arm64|mb|gb|tb|hours?|per month|buffered|provisioned|yes|no|\d+(?:\.\d+)?)$/i;

/** Noise exact matches for section filtering */
export const NOISE_EXACT = new Set([
  'language',
  'language: english',
  'region',
  'unknown section',
  'show details',
  'show calculations',
  'configure service',
]);

/** Page title pattern for filtering */
export const PAGE_TITLE_RE = /^create estimate:\s*configure\b/i;

/** Section selectors for Cloudscape UI */
export const SECTION_SELECTORS = [
  "div[class*='awsui_container_'] > div[class*='awsui_header_']",
  "section[class*='awsui_container_'] > div[class*='awsui_header_']",
  '.awsui-container > .awsui_header',
  '.card-header',
];

/** Heading selectors for section discovery */
export const HEADING_SELECTORS = [
  'h2', 'h3', 'h4',
  "[role='heading']",
  "[class*='awsui_header_'] [class*='awsui_heading-text']",
  '.card-header h1',
  '.card-header h2',
  '.card-header h3',
  '.card-header h4',
];

/** Expandable section trigger selectors */
export const EXPANDABLE_TRIGGERS = [
  "button[aria-expanded][aria-controls]",
  "[role='button'][aria-expanded][aria-controls]",
  'summary',
];

/** Interactive element selectors for DOM scanning */
export const INTERACTIVE_SELECTORS = [
  "input:not([type='hidden'])",
  'select',
  'textarea',
  "[role='combobox']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='spinbutton']",
];

/** Confidence levels */
export const CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  DOM_ONLY: 'DOM_ONLY',
  BFS_ONLY: 'BFS_ONLY',
  MERGED: 'MERGED',
};

/** Label sources */
export const LABEL_SOURCE = {
  ARIA_LABELLEDBY: 'dom_aria_labelledby',
  ARIA_LABEL: 'dom_aria_label',
  LABEL_FOR: 'dom_label_for',
  ANCESTOR: 'dom_ancestor',
  UNKNOWN: 'unknown',
};

/** Type sources */
export const TYPE_SOURCE = {
  DOM_ROLE: 'dom_role',
  DOM_TAG: 'dom_tag',
  INFERRED: 'inferred',
};

/** Draft status values */
export const DRAFT_STATUS = {
  DRAFT: 'draft',
  REVIEWED: 'reviewed',
  PROMOTED: 'promoted',
};

/** Log levels for structured logging */
export const LOG_LEVELS = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
};

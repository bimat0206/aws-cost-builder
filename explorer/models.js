/**
 * Explorer data models.
 * 
 * Matches Python explorer models (DraftDimension, ScanMeta, ServiceDraft, DomInventory).
 * Used for Mode C/D explorer workflow.
 * 
 * @module explorer/models
 */

/**
 * Scan metadata - tracks confidence and source information for discovered dimensions.
 * Matches Python's ScanMeta class.
 */
export class ScanMeta {
  /**
   * @param {object} params
   * @param {string} params.confidence - 'HIGH' | 'MEDIUM' | 'LOW' | 'DOM_ONLY' | 'BFS_ONLY' | 'MERGED'
   * @param {string} params.label_source - 'dom_aria_labelledby' | 'dom_aria_label' | 'dom_label_for' | 'dom_ancestor' | 'unknown'
   * @param {string} params.type_source - 'dom_role' | 'dom_tag' | 'inferred'
   * @param {boolean} params.review_flag - Whether this dimension needs manual review
   */
  constructor({
    confidence = 'MEDIUM',
    label_source = 'unknown',
    type_source = 'inferred',
    review_flag = false,
  }) {
    this.confidence = confidence;
    this.label_source = label_source;
    this.type_source = type_source;
    this.review_flag = review_flag;
  }

  /**
   * Create ScanMeta from plain object.
   * @param {object} obj
   * @returns {ScanMeta}
   */
  static fromObject(obj) {
    return new ScanMeta({
      confidence: obj?.confidence || 'MEDIUM',
      label_source: obj?.label_source || 'unknown',
      type_source: obj?.type_source || 'inferred',
      review_flag: obj?.review_flag || false,
    });
  }

  /**
   * Convert to plain object.
   * @returns {object}
   */
  toObject() {
    return {
      confidence: this.confidence,
      label_source: this.label_source,
      type_source: this.type_source,
      review_flag: this.review_flag,
    };
  }
}

/**
 * Draft dimension - represents a discovered dimension field.
 * Matches Python's DraftDimension class.
 */
export class DraftDimension {
  /**
   * @param {object} params
   * @param {string} params.key - Dimension key/label
   * @param {string} params.field_type - NUMBER|TEXT|SELECT|COMBOBOX|TOGGLE|RADIO
   * @param {string} params.css_selector - CSS selector for automation
   * @param {string} params.fallback_label - Fallback label if key not available
   * @param {string} [params.aws_aria_label] - AWS aria-label attribute
   * @param {string} [params.label_source] - Source of label (aria_label, aria_labelledby, label_for, label_wrap, heuristic, none)
   * @param {string[]} [params.options=[]] - Options for SELECT/COMBOBOX/RADIO
   * @param {string|null} [params.unit=null] - Unit if applicable
   * @param {boolean} [params.required=true] - Whether field is required
   * @param {string|number|boolean|null} [params.default_value=null] - Default value
   * @param {string|null} [params.section=null] - Section name
   * @param {string} [params.notes=''] - Additional notes
   * @param {string} [params.pattern_type] - Pattern type (P1_NUMBER, P2_SELECT, etc.)
   * @param {string} [params.role] - ARIA role
   * @param {string} [params.tag] - HTML tag name
   * @param {object} [params.field_box] - Bounding box {x, y, width, height}
   * @param {string} [params.discovered_in_state] - State ID where discovered
   * @param {ScanMeta} [params._scan_meta] - Scan metadata
   */
  constructor({
    key,
    field_type,
    css_selector,
    fallback_label,
    aws_aria_label,
    label_source,
    options = [],
    unit = null,
    required = true,
    default_value = null,
    section = null,
    notes = '',
    pattern_type,
    role,
    tag,
    field_box,
    discovered_in_state,
    _scan_meta,
  }) {
    this.key = key;
    this.field_type = field_type;
    this.css_selector = css_selector;
    this.fallback_label = fallback_label;
    this.aws_aria_label = aws_aria_label;
    this.label_source = label_source;
    this.options = options;
    this.unit = unit;
    this.required = required;
    this.default_value = default_value;
    this.section = section;
    this.notes = notes;
    this.pattern_type = pattern_type;
    this.role = role;
    this.tag = tag;
    this.field_box = field_box;
    this.discovered_in_state = discovered_in_state;
    this._scan_meta = _scan_meta || new ScanMeta({});
    
    // Add confidence and status fields (Python compatibility)
    this.confidence = this._computeConfidence();
    this.status = this._computeStatus();
  }

  /**
   * Compute confidence scores - matches Python's _apply_confidence_and_status.
   * @returns {object}
   */
  _computeConfidence() {
    const labelSource = this.label_source || 'none';
    
    let labelConf;
    if (labelSource === 'aria_label' || labelSource === 'aria_labelledby') {
      labelConf = 1.0;
    } else if (labelSource === 'label_for' || labelSource === 'label_wrap') {
      labelConf = 0.8;
    } else if (labelSource === 'heuristic') {
      labelConf = 0.6;
    } else if (this.fallback_label) {
      labelConf = 0.3;
    } else {
      labelConf = 0.0;
    }

    const sectionConf = this.section && this.section !== 'UNKNOWN' ? 0.8 : 0.0;
    const fieldConf = this._fieldTypeConfidence();
    
    const overall = Math.min(labelConf, sectionConf) * 0.6 + fieldConf * 0.4;

    return {
      label: Math.round(labelConf * 1000) / 1000,
      section: Math.round(sectionConf * 1000) / 1000,
      overall: Math.round(overall * 1000) / 1000,
    };
  }

  /**
   * Get field type confidence.
   * @returns {number}
   */
  _fieldTypeConfidence() {
    const ft = (this.field_type || '').toUpperCase();
    if (['NUMBER', 'SELECT', 'TOGGLE', 'RADIO', 'INSTANCE_SEARCH'].includes(ft)) {
      return 1.0;
    }
    if (ft === 'COMBOBOX') return 0.7;
    if (ft === 'TEXT') return 0.5;
    return 0.3;
  }

  /**
   * Compute status - matches Python's _apply_confidence_and_status.
   * @returns {string}
   */
  _computeStatus() {
    const overall = this.confidence?.overall || 0;
    if (overall >= 0.75) return 'OK';
    if (overall >= 0.5) return 'REVIEW_REQUIRED';
    return 'CONFLICT';
  }

  /**
   * Create DraftDimension from plain object.
   * @param {object} obj
   * @returns {DraftDimension}
   */
  static fromObject(obj) {
    return new DraftDimension({
      key: obj.key || 'UNKNOWN',
      field_type: obj.field_type || 'TEXT',
      css_selector: obj.css_selector || 'UNKNOWN',
      fallback_label: obj.fallback_label || obj.key || 'UNKNOWN',
      aws_aria_label: obj.aws_aria_label,
      label_source: obj.label_source,
      options: obj.options || [],
      unit: obj.unit || null,
      required: obj.required ?? true,
      default_value: obj.default_value ?? null,
      section: obj.section || null,
      notes: obj.notes || '',
      pattern_type: obj.pattern_type,
      role: obj.role,
      tag: obj.tag,
      field_box: obj.field_box,
      discovered_in_state: obj.discovered_in_state,
      _scan_meta: obj._scan_meta ? ScanMeta.fromObject(obj._scan_meta) : undefined,
    });
  }

  /**
   * Convert to plain object for JSON serialization.
   * @returns {object}
   */
  toObject() {
    return {
      key: this.key,
      field_type: this.field_type,
      css_selector: this.css_selector,
      fallback_label: this.fallback_label,
      aws_aria_label: this.aws_aria_label,
      label_source: this.label_source,
      options: this.options,
      unit: this.unit,
      required: this.required,
      default_value: this.default_value,
      section: this.section,
      notes: this.notes,
      pattern_type: this.pattern_type,
      role: this.role,
      tag: this.tag,
      field_box: this.field_box,
      discovered_in_state: this.discovered_in_state,
      confidence: this.confidence,
      status: this.status,
      _scan_meta: this._scan_meta.toObject(),
    };
  }

  /**
   * Check if dimension has options (for SELECT/COMBOBOX/RADIO).
   * @returns {boolean}
   */
  hasOptions() {
    return Array.isArray(this.options) && this.options.length > 0;
  }

  /**
   * Check if dimension needs review.
   * @returns {boolean}
   */
  needsReview() {
    return this._scan_meta.review_flag ||
      this.key === 'UNKNOWN' ||
      this.field_type === 'UNKNOWN' ||
      this.css_selector === 'UNKNOWN';
  }
}

/**
 * DOM element from scanner.
 * Matches Python's DomElement dataclass.
 */
export class DomElement {
  /**
   * @param {object} params
   * @param {string} params.tag_name - HTML tag name
   * @param {string[]} params.roles - ARIA roles and input types
   * @param {object} params.attributes - All HTML attributes
   * @param {string} params.text_content - Text content
   * @param {number[]} params.bbox - Bounding box [x, y, width, height]
   * @param {boolean} params.is_visible - Whether element is visible
   */
  constructor({
    tag_name,
    roles,
    attributes,
    text_content,
    bbox,
    is_visible,
  }) {
    this.tag_name = tag_name;
    this.roles = roles;
    this.attributes = attributes;
    this.text_content = text_content;
    this.bbox = bbox;
    this.is_visible = is_visible;
  }

  /**
   * Create DomElement from plain object.
   * @param {object} obj
   * @returns {DomElement}
   */
  static fromObject(obj) {
    return new DomElement({
      tag_name: obj.tag_name || 'unknown',
      roles: obj.roles || [],
      attributes: obj.attributes || {},
      text_content: obj.text_content || '',
      bbox: obj.bbox || [0, 0, 0, 0],
      is_visible: obj.is_visible ?? true,
    });
  }

  /**
   * Convert to plain object.
   * @returns {object}
   */
  toObject() {
    return {
      tag_name: this.tag_name,
      roles: this.roles,
      attributes: this.attributes,
      text_content: this.text_content,
      bbox: this.bbox,
      is_visible: this.is_visible,
    };
  }
}

/**
 * DOM inventory - groups elements by section.
 * Matches Python's DomInventory class.
 */
export class DomInventory {
  /**
   * @param {string|null} section_name - Section name or null for main form
   * @param {DomElement[]} elements - Elements in this section
   */
  constructor(section_name = null, elements = []) {
    this.section_name = section_name;
    this.elements = elements;
  }

  /**
   * Create DomInventory from plain object.
   * @param {object} obj
   * @returns {DomInventory}
   */
  static fromObject(obj) {
    const elements = (obj.elements || []).map(e => DomElement.fromObject(e));
    return new DomInventory(obj.section_name || null, elements);
  }

  /**
   * Convert to plain object.
   * @returns {object}
   */
  toObject() {
    return {
      section_name: this.section_name,
      elements: this.elements.map(e => e.toObject()),
    };
  }

  /**
   * Get element count.
   * @returns {number}
   */
  get elementCount() {
    return this.elements.length;
  }
}

/**
 * Service draft - complete draft catalog entry.
 * Matches Python's ServiceDraft class.
 */
export class ServiceDraft {
  /**
   * @param {object} params
   * @param {string} params.service_id - Service ID (e.g., 'amazon_ec2')
   * @param {string} params.service_name - Human-readable service name
   * @param {string} params.search_term - Search term for AWS calculator
   * @param {string} params.calculator_page_title - Page title
   * @param {string[]} [params.supported_regions=[]] - Supported regions
   * @param {DraftDimension[]} [params.dimensions=[]] - Discovered dimensions
   * @param {string} [params.status='draft'] - Status: draft | reviewed | promoted
   * @param {string} [params.notes=''] - Review notes
   */
  constructor({
    service_id,
    service_name,
    search_term,
    calculator_page_title,
    supported_regions = [],
    dimensions = [],
    status = 'draft',
    notes = '',
  }) {
    this.service_id = service_id;
    this.service_name = service_name;
    this.search_term = search_term;
    this.calculator_page_title = calculator_page_title;
    this.supported_regions = supported_regions;
    this.dimensions = dimensions;
    this.status = status;
    this.notes = notes;
  }

  /**
   * Create ServiceDraft from plain object.
   * @param {object} obj
   * @returns {ServiceDraft}
   */
  static fromObject(obj) {
    const dimensions = (obj.dimensions || []).map(d => DraftDimension.fromObject(d));
    return new ServiceDraft({
      service_id: obj.service_id || 'unknown_service',
      service_name: obj.service_name || 'Unknown Service',
      search_term: obj.search_term || obj.service_name || 'Unknown',
      calculator_page_title: obj.calculator_page_title || '',
      supported_regions: obj.supported_regions || [],
      dimensions,
      status: obj.status || 'draft',
      notes: obj.notes || '',
    });
  }

  /**
   * Convert to plain object for JSON serialization.
   * @returns {object}
   */
  toObject() {
    return {
      service_id: this.service_id,
      service_name: this.service_name,
      search_term: this.search_term,
      calculator_page_title: this.calculator_page_title,
      supported_regions: this.supported_regions,
      dimensions: this.dimensions.map(d => d.toObject()),
      status: this.status,
      notes: this.notes,
    };
  }

  /**
   * Get dimensions that need review.
   * @returns {DraftDimension[]}
   */
  getDimensionsNeedingReview() {
    return this.dimensions.filter(d => d.needsReview());
  }

  /**
   * Get review count.
   * @returns {number}
   */
  getReviewCount() {
    return this.getDimensionsNeedingReview().length;
  }

  /**
   * Check if draft is ready for promotion.
   * @returns {boolean}
   */
  isReadyForPromotion() {
    return this.getReviewCount() === 0 && this.dimensions.length > 0;
  }
}

/**
 * Gate control status - tracks state of gate controls during BFS exploration.
 * Matches Python's GateControlStatus.
 */
export class GateControlStatus {
  /**
   * @param {object} params
   * @param {string} params.selector - CSS selector
   * @param {string} params.control_type - checkbox | radio | select
   * @param {string|boolean} params.current_value - Current value
   * @param {string[]} [params.available_values=[]] - Available values to try
   */
  constructor({
    selector,
    control_type,
    current_value,
    available_values = [],
  }) {
    this.selector = selector;
    this.control_type = control_type;
    this.current_value = current_value;
    this.available_values = available_values;
  }

  /**
   * Create from plain object.
   * @param {object} obj
   * @returns {GateControlStatus}
   */
  static fromObject(obj) {
    return new GateControlStatus({
      selector: obj.selector || 'UNKNOWN',
      control_type: obj.control_type || 'unknown',
      current_value: obj.current_value,
      available_values: obj.available_values || [],
    });
  }

  /**
   * Convert to plain object.
   * @returns {object}
   */
  toObject() {
    return {
      selector: this.selector,
      control_type: this.control_type,
      current_value: this.current_value,
      available_values: this.available_values,
    };
  }
}

/**
 * State tracker for BFS exploration.
 * Tracks visited states and gate control statuses.
 */
export class StateTracker {
  constructor() {
    /** @type {Set<string>} */
    this.visitedStates = new Set();
    /** @type {Map<string, GateControlStatus>} */
    this.gateControls = new Map();
    /** @type {Array<object>} */
    this.states = [];
  }

  /**
   * Mark state as visited.
   * @param {string} stateKey
   * @returns {boolean} - True if newly visited
   */
  markVisited(stateKey) {
    if (this.visitedStates.has(stateKey)) {
      return false;
    }
    this.visitedStates.add(stateKey);
    return true;
  }

  /**
   * Check if state was visited.
   * @param {string} stateKey
   * @returns {boolean}
   */
  isVisited(stateKey) {
    return this.visitedStates.has(stateKey);
  }

  /**
   * Add gate control.
   * @param {string} selector
   * @param {GateControlStatus} status
   */
  addGateControl(selector, status) {
    this.gateControls.set(selector, status);
  }

  /**
   * Get gate control.
   * @param {string} selector
   * @returns {GateControlStatus|undefined}
   */
  getGateControl(selector) {
    return this.gateControls.get(selector);
  }

  /**
   * Add state record.
   * @param {object} state
   */
  addState(state) {
    this.states.push(state);
  }

  /**
   * Get all gate controls as plain object.
   * @returns {object}
   */
  getGateControlsStatus() {
    const result = {};
    for (const [selector, status] of this.gateControls.entries()) {
      result[selector] = status.toObject();
    }
    return result;
  }

  /**
   * Get states count.
   * @returns {number}
   */
  getStatesCount() {
    return this.states.length;
  }

  /**
   * Get visited states count.
   * @returns {number}
   */
  getVisitedCount() {
    return this.visitedStates.size;
  }

  /**
   * Convert to plain object.
   * @returns {object}
   */
  toObject() {
    return {
      visited_states: Array.from(this.visitedStates),
      gate_controls: this.getGateControlsStatus(),
      states: this.states,
      visited_count: this.getVisitedCount(),
      states_count: this.getStatesCount(),
    };
  }
}

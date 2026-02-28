You are implementing a stateful UI explorer for the AWS Pricing Calculator.
Your job is to refine and improve the explorer module for a given service and generate
a human-reviewable draft at:
  config/services/generated/<service_id>_draft.json

═══════════════════════════════════════════════════════════
SECTION 1 — CORE PRINCIPLE: STATE-GRAPH EXPLORATION
═══════════════════════════════════════════════════════════

The AWS Pricing Calculator is NOT a static form.
It is a state machine where user actions (clicking radio cards,
enabling checkboxes, selecting options) can completely replace
or show/hide entire sections of dimensions.

A single DOM scan only reveals the DEFAULT state.
You MUST enumerate states by triggering every gate control.

Model exploration as a state graph:

  S0 (default page load)
   ├─[enable toggle X]──► S1  (new fields visible)
   ├─[enable toggle Y]──► S2
   ├─[select radio card B]► S3 (entire form replaced)
   └─[expand accordion Z]► S4 (more fields visible)

Each state is a node. Each user action is an edge.
Each node stores the fields visible in that state.

═══════════════════════════════════════════════════════════
SECTION 2 — PHASE 1: DISCOVER ALL GATE CONTROLS
═══════════════════════════════════════════════════════════

Before scanning any fields, first identify all "gate controls"
— controls that change WHICH fields exist on the page.

GATE CONTROL TYPES to detect:
  a) CHECKBOX_TOGGLE
     - role=checkbox at or near the top of the form
     - each toggle maps to one or more sections appearing/disappearing
     - check for disabled attribute → mark as region_gated

  b) RADIO_CARD
     - role=radio rendered as a large card with descriptive text
     - typically at the very top, before any form sections
     - selecting a different card may replace the ENTIRE form body
     - common pattern: pricing mode, tier mode, deployment mode

  c) TOP_LEVEL_SELECT_OR_COMBOBOX
     - a SELECT or COMBOBOX whose value changes which sub-sections render
     - example: "Deployment Option" (Single-AZ / Multi-AZ)
     - example: "Pricing Model" (OnDemand / Reserved / Spot)
     - these are "soft gates" — they affect cost logic, may not hide fields

For each gate control found, record:
  {
    "key":              snake_case identifier
    "aws_aria_label":   verbatim aria-label from DOM
    "gate_type":        CHECKBOX_TOGGLE | RADIO_CARD | SELECT_GATE
    "default_state":    checked/unchecked OR which radio/option is default
    "availability":     always | region_gated
    "expected_effect":  "reveals section X" | "replaces form with mode Y"
  }

═══════════════════════════════════════════════════════════
SECTION 3 — PHASE 2: ENUMERATE STATES WITHIN BUDGET
═══════════════════════════════════════════════════════════

Use a budgeted BFS over the state graph:

  BUDGET = {
    max_states:               30   (configurable)
    max_options_per_select:    5   (sample, not exhaustive)
    max_time_seconds:        300
  }

ALGORITHM:
  queue = [S0]
  visited_fingerprints = {}

  while queue not empty AND states < max_states:
    pop state S
    expand all accordion sections (Pattern 3)
    scan all visible fields → observations for S
    fingerprint S = sorted(section_headings + aria_labels)
    if fingerprint already in visited → skip

    for each gate_control in S:
      if gate_control.gate_type == CHECKBOX_TOGGLE:
        if not yet triggered:
          click toggle → wait → push new state to queue
          click toggle again (restore) OR leave on (your choice, be consistent)

      if gate_control.gate_type == RADIO_CARD:
        for each card option not yet explored:
          click card → wait → push new state to queue
          (do NOT restore — note which card is now active)

      if gate_control.gate_type == SELECT_GATE:
        for option in sample(options, max_options_per_select):
          select option → wait → check if fingerprint changed
          if changed: push new state to queue

WAITING strategy:
  - Do NOT use fixed sleeps
  - Wait for DOM to stabilize using actionability checks
    (element visible + enabled + not animating)
  - After each gate action, wait for at least one expected
    section heading to appear/disappear before proceeding

STATE FINGERPRINT:
  fingerprint = sorted list of (section_heading_text, aria_label)
  for all currently visible input-like elements
  If fingerprint unchanged after gate action → not a real new state

═══════════════════════════════════════════════════════════
SECTION 4 — PHASE 3: SCAN FIELDS IN EACH STATE
═══════════════════════════════════════════════════════════

For each stable state, collect every visible input-like element:

ELEMENTS TO CAPTURE:
  - role: spinbutton, combobox, textbox, checkbox, radio, switch
  - native: input[type=number/text/search], select, textarea
  - Cloudscape custom: [role=option], [aria-haspopup=listbox]

For each element record:
  {
    aws_aria_label:   verbatim aria-label (canonical unique ID)
    role:             DOM role attribute
    tag:              input / select / div etc.
    bounding_box:     {x, y, width, height} in viewport px
    value:            current value or aria-valuetext (pre-filled defaults!)
    section_heading:  text of nearest ancestor heading
    pattern_type:     see Section 5
  }

SECTION HEADING DETECTION (priority order):
  1. Nearest ancestor element with role=heading or tag h2/h3/h4
  2. Nearest preceding sibling that is a heading
  3. Text of the nearest Cloudscape container header
  4. If none found → assign section = "UNKNOWN", flag REVIEW_REQUIRED

CRITICAL: Use full aria-label as canonical field ID.
  - Short visible label text is NOT unique across sections.
  - "Data transfer out to internet Value" is unique.
  - "Data transfer" alone is not.
  - Always store BOTH:
      label_visible:  short human text (from nearby text node)
      aws_aria_label: full verbatim aria-label

═══════════════════════════════════════════════════════════
SECTION 5 — PHASE 4: CLASSIFY EACH FIELD INTO A PATTERN
═══════════════════════════════════════════════════════════

After scanning, classify each element using these 6 patterns:

PATTERN 1 — NUMBER
  Signs: role=spinbutton OR input[type=number]
  May have a UNIT_SIBLING (see below)
  field_type: NUMBER

PATTERN 2 — SELECT
  Signs: native <select> tag, OR role=combobox with aria-haspopup=listbox
         where options are pre-defined (not free text)
  Capture: all visible option texts by opening the dropdown
  field_type: SELECT

PATTERN 3 — COMBOBOX (searchable)
  Signs: role=combobox + free text input (user types to filter)
  Examples: EC2 instance search, RDS instance search
  field_type: COMBOBOX

PATTERN 4 — TOGGLE
  Signs: role=checkbox OR role=switch
  field_type: TOGGLE
  Sub-type: GATE_TOGGLE if it is a gate control (Section 2)

PATTERN 5 — RADIO_GROUP
  Signs: multiple role=radio inputs sharing a group name or container
  field_type: RADIO_GROUP
  options: list of {aria_label, value} for each radio

PATTERN 6 — INSTANCE_TABLE
  Signs: a table with radio inputs per row, column headers like
         "vCPUs", "Memory", "On-Demand Hourly Cost"
  field_type: INSTANCE_TABLE
  Note: also capture filter dropdowns above the table as sub-fields

UNIT SIBLING DETECTION:
  After any NUMBER field, look at the immediately adjacent DOM sibling.
  If that sibling is a SELECT with options like:
    GB / TB / MB / KB / per month / million / thousand / hours / %
  → bind them as a VALUE+UNIT pair:
  {
    field_type:  NUMBER
    unit_sibling: {
      aws_aria_label: (if any, else derive from context)
      default_value:  current displayed option
      options:        list of all option texts
    }
  }
  Never treat unit SELECT as a standalone dimension.

REPEATABLE ROW DETECTION:
  If a section contains a button whose label matches "Add [something]"
  → all fields above it (until the previous section boundary) form
    a repeatable row template.
  field_type: REPEATABLE_ROW
  {
    add_button_label: "Add inbound data transfer"
    row_fields: [ ... list of fields in one row ... ]
  }

═══════════════════════════════════════════════════════════
SECTION 6 — PHASE 5: OCR + VISION PASS (OPTIONAL)
═══════════════════════════════════════════════════════════

Run this pass only when DOM labels are ambiguous or missing.

Step A — Screenshot
  Take a full-page screenshot after expanding all sections.
  For very long pages, take per-section screenshots.

Step B — OCR (e.g. PaddleOCR)
  Extract: {text, bounding_box, confidence} per text block.

Step C — Label matching
  For each field bounding_box, find the nearest OCR text block
  that is: above OR to the left, within a distance threshold,
  and NOT a description/help text (help text is usually below/indented).
  Store as label_ocr.

Step D — Section heading matching
  Find OCR blocks that: are larger/bolder, horizontally span
  a group of fields, and appear above that group.
  Store as section_ocr.

Step E — Confidence scoring
  label_confidence:   edit_distance(label_visible, label_ocr) < threshold
  section_confidence: DOM section heading == OCR section heading

Step F — Vision resolver (only for low confidence)
  If label_confidence < 0.7 OR section_confidence < 0.7:
    Crop screenshot around the field ± context
    Query Florence-2 (or similar VLM):
      "What is the user-visible label for the highlighted input?
       What section header groups this input?"
    Use response as a third signal (florence_label, florence_section)

═══════════════════════════════════════════════════════════
SECTION 7 — EXPLORATION REPORT SCHEMA
═══════════════════════════════════════════════════════════

Write artifacts/<service_id>/exploration_report.json:

{
  "service_id":     string,
  "explored_at":    ISO timestamp,
  "region_used":    string,
  "total_states":   integer,
  "budget_hit":     boolean,

  "gate_controls": [
    {
      "key":             string,
      "aws_aria_label":  string,
      "gate_type":       CHECKBOX_TOGGLE | RADIO_CARD | SELECT_GATE,
      "default_state":   string,
      "availability":    always | region_gated,
      "triggered":       boolean,
      "states_revealed": ["S1", "S2", ...]
    }
  ],

  "states": [
    {
      "state_id":        "S0" | "S1" | ...,
      "entered_via": {
        "gate_control":  string (aws_aria_label) | null,
        "action":        "click" | "select:<value>" | null,
        "from_state":    "S0" | null
      },
      "fingerprint":     string (hash of sorted aria_labels),
      "screenshot_path": string | null,
      "fields": [
        {
          "aws_aria_label":   string,
          "label_visible":    string,
          "label_ocr":        string | null,
          "role":             string,
          "tag":              string,
          "field_type":       NUMBER | SELECT | COMBOBOX | TOGGLE |
                              RADIO_GROUP | INSTANCE_TABLE |
                              REPEATABLE_ROW | TEXT,
          "pattern_type":     P1_NUMBER | P2_SELECT | P3_COMBOBOX |
                              P4_TOGGLE | P5_RADIO_GROUP |
                              P6_INSTANCE_TABLE | P5_REPEATABLE_ROW,
          "section_heading":  string | "UNKNOWN",
          "section_ocr":      string | null,
          "bounding_box":     { x, y, width, height },
          "default_value":    any | null,
          "unit_sibling": null | {
            "aws_aria_label":  string | null,
            "default_value":   string,
            "options":         [string]
          },
          "options":          [string] | null,
          "row_fields":       [...] | null,
          "add_button_label": string | null,
          "semantic_role":    null | migration_mode_gate |
                              region_gated | pricing_mode_gate,
          "confidence": {
            "label":    float 0-1,
            "section":  float 0-1,
            "overall":  float 0-1
          },
          "status": OK | REVIEW_REQUIRED | CONFLICT
        }
      ]
    }
  ]
}

═══════════════════════════════════════════════════════════
SECTION 8 — DRAFT CONFIG SCHEMA
═══════════════════════════════════════════════════════════

Write config/services/generated/<service_id>_draft.json:

{
  "service_id":        string,
  "service_code":      string,
  "ui_service_label":  string,
  "schema_version":    "2.0",
  "generated_at":      ISO timestamp,
  "source":            "explorer_hybrid_v1",
  "region_used":       string,

  "ui_mapping": {
    "search_keywords":  [string],
    "card_title":       string,
    "configure_button": "Configure"
  },

  "gate_controls": [
    {
      "key":            string,
      "aws_aria_label": string,
      "gate_type":      CHECKBOX_TOGGLE | RADIO_CARD | SELECT_GATE,
      "default_state":  string,
      "availability":   always | region_gated,
      "sections_gated": [string]
    }
  ],

  "sections": [
    {
      "key":            string,
      "label":          string,
      "state_id":       string,
      "entered_via": {
        "gate_control": string | null,
        "action":       string | null
      },
      "dimensions": [
        {
          "key":             string,
          "label_visible":   string,
          "aws_aria_label":  string,
          "field_type":      NUMBER | SELECT | COMBOBOX | TOGGLE |
                             RADIO_GROUP | INSTANCE_TABLE |
                             REPEATABLE_ROW | TEXT,
          "default_value":   any | null,
          "unit_sibling":    null | {
            "default_value": string,
            "options":       [string]
          },
          "options":         [string] | null,
          "row_fields":      [...] | null,
          "semantic_role":   null | string,
          "required":        boolean,
          "confidence": {
            "label":   float,
            "section": float,
            "overall": float
          },
          "status":  OK | REVIEW_REQUIRED | CONFLICT,
          "review_note": string | null
        }
      ]
    }
  ]
}

═══════════════════════════════════════════════════════════
SECTION 9 — CONFIDENCE SCORING RULES
═══════════════════════════════════════════════════════════

Compute per field. All scores are 0.0–1.0.

label_confidence:
  1.0  aws_aria_label is non-empty AND unique across all states
  0.8  label_visible closely matches label_ocr
       (edit distance ratio > 0.85)
  0.6  label_visible present but no OCR confirmation
  0.3  aria_label empty or missing, derived from placeholder text
  0.0  no label found at all

section_confidence:
  1.0  DOM section heading AND OCR section heading agree exactly
  0.8  DOM heading present, no OCR (DOM-only)
  0.6  OCR heading present, no DOM heading
  0.4  DOM and OCR disagree → record both, flag REVIEW_REQUIRED
  0.0  section heading = UNKNOWN

field_type_confidence:
  1.0  DOM role maps unambiguously to a known field_type
       (spinbutton → NUMBER, native select → SELECT, etc.)
  0.7  role=combobox, determined SELECT vs COMBOBOX by
       whether free-text input is possible
  0.5  generic role=textbox, guessed from context
  0.3  no role, guessed from tag and neighbors

overall_confidence:
  = min(label_confidence, section_confidence) * 0.6
    + field_type_confidence * 0.4

STATUS assignment:
  overall >= 0.75                     → OK
  0.5 <= overall < 0.75               → REVIEW_REQUIRED
  overall < 0.5                       → CONFLICT
  Two fields share same aws_aria_label → CONFLICT (both)
  section_heading == UNKNOWN          → REVIEW_REQUIRED minimum

═══════════════════════════════════════════════════════════
SECTION 10 — OUTPUT ARTIFACTS
═══════════════════════════════════════════════════════════

Produce exactly these files:

  artifacts/<service_id>/
    exploration_report.json       ← raw per-field findings, all states
    screenshots/
      S0_default.png              ← one screenshot per state
      S1_<gate_label>.png
      ...
    REVIEW_NOTES.md               ← all REVIEW_REQUIRED + CONFLICT items
                                     with reason + suggested fix

  config/services/generated/
    <service_id>_draft.json       ← structured draft for human review

NEVER write directly to config/services/<service_id>.json.
The generated/ subfolder is the staging area.
Only a human promoting the draft should write to the final path.

═══════════════════════════════════════════════════════════
SECTION 11 — HUMAN REVIEW CHECKLIST
═══════════════════════════════════════════════════════════

Append to REVIEW_NOTES.md. A human must verify ALL of these
before promoting draft to config/services/<service_id>.json.

GATE CONTROLS
  [ ] Count of gate_controls in draft matches visible toggles/cards on page
  [ ] Each gate_type is correctly classified
       (CHECKBOX_TOGGLE vs RADIO_CARD vs SELECT_GATE)
  [ ] Region-gated controls marked availability: region_gated
  [ ] Default state of each gate matches page default on first load

STATE COVERAGE
  [ ] Every toggle was enabled and its section scanned
  [ ] Every radio card was selected and its form scanned
  [ ] Key SELECT_GATE options were explored (at minimum: default + 2 others)
  [ ] If budget was hit (budget_hit: true): note which states were skipped
       and mark those sections as REVIEW_REQUIRED

SECTION STRUCTURE
  [ ] Section order matches top-to-bottom visual order on page
  [ ] Sections within a toggle (e.g. Management has 4 sub-sections) are
       all captured as separate sections with the same trigger_toggle
  [ ] No section heading is UNKNOWN unless marked REVIEW_REQUIRED
  [ ] Optional sections marked "- optional" in heading are noted

FIELD COMPLETENESS (per section)
  [ ] Field count matches what is visible on screen in that state
  [ ] Every VALUE+UNIT pair is captured as a paired dimension
       (not as two separate dimensions)
  [ ] Repeatable row sections have field_type REPEATABLE_ROW
       with row_fields defined, not enumerated rows
  [ ] Instance search fields are COMBOBOX or INSTANCE_TABLE,
       not NUMBER or TEXT

LABEL ACCURACY
  [ ] Every aws_aria_label was copied verbatim from the DOM
  [ ] No two dimensions share the same aws_aria_label
  [ ] label_visible matches the short text a user sees —
       NOT the description/help text below the field
  [ ] Pre-filled default_value captures aria-valuetext, not assumed 0

FIELD TYPES
  [ ] Every RADIO_GROUP has options list with all radio labels
  [ ] Every SELECT has options list (opened dropdown was inspected)
  [ ] COMBOBOX is used only for free-text-search inputs, not plain selects
  [ ] Migration-mode dropdowns ("How will data be moved into X?")
       are SELECT with semantic_role: migration_mode_gate
  [ ] Percentage fields show % as unit_sibling

CONFLICT RESOLUTION
  [ ] All CONFLICT items resolved or escalated with documented reason
  [ ] All REVIEW_REQUIRED items accepted, corrected, or escalated

SMOKE TEST (required before promotion)
  [ ] Run automation runner with sample values against live calculator
  [ ] Verify each field accepts the value without error
  [ ] Verify unit siblings change correctly when altered
  [ ] Verify gate controls trigger expected sections
  [ ] Verify total monthly cost changes to non-zero after filling
       at least the primary required fields

═══════════════════════════════════════════════════════════
SECTION 12 — ERROR HANDLING + FALLBACKS
═══════════════════════════════════════════════════════════

If any step fails, apply these fallbacks in order:

Gate action fails (element not clickable):
  1. Re-check disabled attribute → if disabled, mark region_gated
  2. Scroll element into view, retry once
  3. If still fails: mark gate as "unresolved", log warning,
     continue with remaining gates
  4. Do NOT crash the entire exploration run

DOM stabilization timeout:
  1. If page does not stabilize after threshold: take a screenshot,
     log the current DOM fingerprint, and continue
  2. Mark fields scanned in an unstable state as REVIEW_REQUIRED

OCR fails or returns no blocks:
  1. Fall back to DOM labels only
  2. Set label_ocr = null, section_ocr = null
  3. Reduce label_confidence by 0.2 (DOM-only penalty)
  4. Continue without OCR; do not abort

Vision resolver (Florence-2) unavailable:
  1. Skip vision pass entirely
  2. Fields that would have been resolved remain REVIEW_REQUIRED
  3. Log: "Vision resolver unavailable; manual review required for
     N low-confidence fields"

Section heading not found:
  1. Try parent container text
  2. Try preceding heading sibling
  3. If still not found: section_heading = "UNKNOWN"
  4. Automatically set status = REVIEW_REQUIRED

═══════════════════════════════════════════════════════════
SECTION 13 — CONFIGURATION FLAGS
═══════════════════════════════════════════════════════════

The script must accept these configuration inputs:

  service_id:               string     (required)
  search_keywords:          [string]   (required, for Add Service search)
  region_label:             string     (default: "US East (N. Virginia)")
  enable_ocr:               boolean    (default: true)
  enable_vision_resolver:   boolean    (default: false, needs GPU/API)
  confidence_threshold_ok:  float      (default: 0.75)
  confidence_threshold_conflict: float (default: 0.50)
  max_states:               int        (default: 30)
  max_options_per_select:   int        (default: 5)
  max_time_seconds:         int        (default: 300)
  restore_toggles:          boolean    (default: true)
  output_dir:               path       (default: artifacts/<service_id>/)
  draft_output_path:        path       (default: config/services/generated/
                                         <service_id>_draft.json)

═══════════════════════════════════════════════════════════
SECTION 14 — KNOWN SERVICE-SPECIFIC NOTES
      (update as more services are onboarded)
═══════════════════════════════════════════════════════════

S3:
  - 13 feature toggles; Management toggle reveals 4 sub-sections
  - S3 Express One Zone is region-gated (disabled outside us-east-1)
  - "Data returned/scanned by S3 Select" appears in 5+ sections;
    disambiguate ONLY via full aws_aria_label (includes storage class name)
  - Data Transfer uses REPEATABLE_ROW (Add inbound/outbound buttons)
  - All Glacier sections include Average Object Size with default=16 MB

EC2:
  - No checkbox toggles; optional sections are collapsed accordions
  - Instance selection uses INSTANCE_TABLE (radio rows + filter dropdowns)
  - Payment options section contains nested RADIO_GROUP (savings plan type,
    term, payment method) — treat as separate sub-dimensions
  - On-Demand "Usage" field has a paired unit SELECT ("Utilization percent
    per month") — capture as VALUE+UNIT pair
  - Spot "Assume percentage discount" is a NUMBER with default=75

Lambda:
  - Top-level RADIO_CARD (Free Tier / Without Free Tier) is a pricing mode
    gate — explore both cards as separate states
  - "Amount of memory allocated" appears in 3 sections (Service settings,
    Provisioned Concurrency, Lambda@Edge) — always disambiguate by
    full aria-label + section heading
  - "Amount of ephemeral storage allocated" has default=512 MB

RDS (all engines):
  - Instance selection uses COMBOBOX (type to search) + preview card
  - "Deployment Option" SELECT is a soft gate (affects pricing but may
    not hide fields)
  - "Pricing Model" SELECT (OnDemand/Reserved) may reveal/hide fields;
    treat as SELECT_GATE and explore OnDemand + Reserved states
  - "Would you be creating an RDS Proxy?"
  - "Would you be creating an RDS Proxy?" is a SELECT (Yes/No)
    that may reveal additional proxy configuration fields
  - Performance Insights retention is a SELECT with free/paid tiers
  - Extended Support has conditional fields based on version choice
  - Backup Storage and Snapshot Export sections may be empty
    (no input fields visible) — record as sections with 0 dimensions

CloudFront:
  - Top-level RADIO_CARD (Flat Rate / Pay as you go) completely
    replaces the form — explore both as separate root states
  - Pay-as-you-go: each geographic region is a collapsed accordion
    (United States, Canada, Asia Pacific, Australia, Europe,
    India, Japan, Middle East, South Africa, South America)
    Expand each one; they share the same field structure
    (Data transfer out to internet, Data transfer out to origin,
    Number of requests HTTPS) — capture as a templated geo section
  - Flat Rate: each plan (Free/Pro/Business/Premium) is just
    one NUMBER field for quantity — simple structure
  - "Discounted Pricing" section is informational only (no inputs)

═══════════════════════════════════════════════════════════
SECTION 15 — SERVICE-TYPE HEURISTICS
      (generalizes to services not yet inspected)
═══════════════════════════════════════════════════════════

When onboarding a new service with no prior notes, apply
these heuristics to guess likely patterns before exploring:

SERVERLESS / USAGE-BASED (Lambda, API Gateway, SQS, SNS, SES):
  Likely: top-level pricing mode RADIO_CARD (free tier / no free tier)
  Likely: simple flat sections, mostly NUMBER + unit pairs
  Unlikely: instance search tables or complex toggles

COMPUTE / INSTANCE-BASED (EC2, ECS, EKS, Lightsail):
  Likely: INSTANCE_TABLE or COMBOBOX instance search
  Likely: payment options RADIO_GROUP (On-Demand/Savings/Spot/Reserved)
  Likely: optional accordion sections for storage, networking, monitoring
  Unlikely: top-level checkbox toggles

DATABASE (RDS, Aurora, ElastiCache, Redshift, DynamoDB):
  Likely: COMBOBOX instance search + preview card
  Likely: Deployment Option SELECT (Single/Multi-AZ, cluster mode)
  Likely: Pricing Model SELECT (OnDemand / Reserved)
  Likely: Storage section as separate accordion
  Likely: Backup and snapshot sections (may have 0 dimensions)

STORAGE (S3, EFS, FSx, Backup):
  Likely: checkbox toggles per storage class / feature set
  Likely: VALUE+UNIT pairs for all size dimensions
  Likely: REPEATABLE_ROW for data transfer
  Likely: migration mode SELECT per storage class section

NETWORKING / CDN (CloudFront, Route53, VPC, Direct Connect):
  Likely: top-level pricing model RADIO_CARD
  Likely: geographic sub-sections as collapsed accordions
  Likely: per-region field templates (same fields per geo)
  Unlikely: instance tables

AI / ML (Bedrock, SageMaker, Rekognition):
  Likely: model or tier SELECT at top
  Likely: simple NUMBER fields for tokens/requests/hours
  Likely: minimal sections, mostly flat structure

Use these heuristics to set max_states and exploration
priorities before running the script, not to skip exploration.

═══════════════════════════════════════════════════════════
SECTION 16 — INPUTS TO PROVIDE WHEN RUNNING THIS PROMPT
═══════════════════════════════════════════════════════════

Fill these in before running the prompt in your LLM/tool:

  service_id:             <snake_case e.g. "rds_mysql">
  service_code:           <AWS internal e.g. "AmazonRDS">
  ui_service_label:       <exact card title e.g. "Amazon RDS for MySQL">
  search_keywords:        <e.g. ["RDS", "MySQL", "relational database"]>
  region_label:           <e.g. "US East (N. Virginia)">
  service_type_hint:      <one of: SERVERLESS | COMPUTE | DATABASE |
                           STORAGE | NETWORKING | AI_ML | OTHER>
  enable_ocr:             true | false
  enable_vision_resolver: true | false
  max_states:             <integer, default 30>
  notes:                  <any known quirks, e.g. "has multi-AZ toggle">

═══════════════════════════════════════════════════════════
SECTION 17 — COMPLETE WORKED EXAMPLE (CloudFront)
      showing state graph, gate controls, and sections
═══════════════════════════════════════════════════════════

service_id:       cloudfront
search_keywords:  ["CloudFront", "CDN", "content delivery"]
service_type:     NETWORKING

GATE CONTROLS:
  {key: pricing_mode, gate_type: RADIO_CARD,
   options: ["Flat Rate", "Pay as you go"],
   default: "Flat Rate"}

STATE GRAPH:
  S0 (Flat Rate selected)
    └─[select Pay as you go]──► S1

  S1 (Pay as you go)
    ├─[expand United States accordion]──► S1a
    ├─[expand Canada accordion]─────────► S1b
    ├─[expand Asia Pacific accordion]───► S1c
    ├─[expand Australia accordion]──────► S1d
    ├─[expand Europe accordion]─────────► S1e
    ├─[expand India accordion]──────────► S1f
    ├─[expand Japan accordion]──────────► S1g
    ├─[expand Middle East accordion]────► S1h
    ├─[expand South Africa accordion]───► S1i
    └─[expand South America accordion]──► S1j

SECTIONS (S0 — Flat Rate):
  key: cloudfront_flat_rate_plans
  label: CloudFront Flat-Rate Plans
  entered_via: {gate_control: pricing_mode, action: select:Flat Rate}
  dimensions:
    - key: free_plan_qty
      aws_aria_label: "Free Plan Enter quantity"
      field_type: NUMBER, default: null

    - key: pro_plan_qty
      aws_aria_label: "Pro Plan Enter quantity"
      field_type: NUMBER, default: null

    - key: business_plan_qty
      aws_aria_label: "Business Plan Enter quantity"
      field_type: NUMBER, default: null

    - key: premium_plan_qty
      aws_aria_label: "Premium Plan Enter quantity"
      field_type: NUMBER, default: null

SECTIONS (S1a — Pay as you go, United States):
  key: cloudfront_payg_united_states
  label: United States
  entered_via: {gate_control: pricing_mode, action: select:Pay as you go}
  template: true   ← same structure repeats per geo section
  dimensions:
    - key: data_transfer_out_internet
      aws_aria_label: "Data transfer out to internet Value"
      field_type: NUMBER
      unit_sibling: {default: "GB per month",
                     options: ["GB per month", "TB per month"]}

    - key: data_transfer_out_origin
      aws_aria_label: "Data transfer out to origin Value"
      field_type: NUMBER
      unit_sibling: {default: "GB per month",
                     options: ["GB per month", "TB per month"]}

    - key: number_of_requests_https
      aws_aria_label: "Number of requests (HTTPS) Value"
      field_type: NUMBER
      unit_sibling: {default: "per month",
                     options: ["per month"]}

NOTE: sections S1b–S1j share the same dimension template as S1a.
      In the draft config, model them as geo_sections: [list of regions]
      each with the same row_fields, rather than duplicating 10 times.

═══════════════════════════════════════════════════════════
SECTION 18 — GEO TEMPLATE PATTERN
      (for services with repeated per-region sections)
═══════════════════════════════════════════════════════════

When the same field structure repeats per geographic section:

Instead of:
  sections: [
    {key: cloudfront_payg_us, dimensions: [...]},
    {key: cloudfront_payg_ca, dimensions: [...]},
    ... x10
  ]

Use:
  "geo_sections": {
    "template_dimensions": [
      {key: "data_transfer_out_internet", ...},
      {key: "data_transfer_out_origin",   ...},
      {key: "number_of_requests_https",   ...}
    ],
    "regions": [
      {"key": "us",    "label": "United States",
       "aws_section_heading": "United States"},
      {"key": "ca",    "label": "Canada",
       "aws_section_heading": "Canada"},
      {"key": "apac",  "label": "Asia Pacific",
       "aws_section_heading": "Asia Pacific"},
      {"key": "au",    "label": "Australia",
       "aws_section_heading": "Australia"},
      {"key": "eu",    "label": "Europe",
       "aws_section_heading": "Europe"},
      {"key": "in",    "label": "India",
       "aws_section_heading": "India"},
      {"key": "jp",    "label": "Japan",
       "aws_section_heading": "Japan"},
      {"key": "me",    "label": "Middle East",
       "aws_section_heading": "Middle East"},
      {"key": "za",    "label": "South Africa",
       "aws_section_heading": "South Africa"},
      {"key": "sa",    "label": "South America",
       "aws_section_heading": "South America"}
    ]
  }

The automation runner expands template_dimensions per region
at fill time, rather than duplicating config 10 times.
The explorer should detect this pattern automatically:
  if (N sections share identical field structure AND
      their headings are all geographic names):
    collapse into geo_sections template

═══════════════════════════════════════════════════════════
SECTION 19 — SELECTOR STABILITY RULES
═══════════════════════════════════════════════════════════

These rules apply to every locator generated during exploration.
Violating them produces brittle configs that break on reload.

RULE 1 — NEVER USE SESSION-SPECIFIC IDs
  Bad:  #\31 094-1771751172478-4366
        (contains timestamp, breaks on every page load)
  Good: getByRole('spinbutton', {name: 'S3 Standard storage Value'})

RULE 2 — NEVER USE POSITIONAL INDEXES AS PRIMARY LOCATOR
  Bad:  nth-child(3) > input
  Good: aria-label exact match

RULE 3 — NEVER USE INTERNAL CLOUDSCAPE CLASS NAMES
  Bad:  .awsui-input-container > .awsui-input
        (internal, changes with Cloudscape version upgrades)
  Good: [role=spinbutton][aria-label="..."]

RULE 4 — PREFER ARIA-LABEL EXACT MATCH
  Stable: input[aria-label="S3 Standard storage Value"]
  Reason: AWS controls aria-labels intentionally; they change
          less often than DOM structure or CSS classes

RULE 5 — SCOPE TO SECTION WHEN ARIA-LABEL IS AMBIGUOUS
  If two fields share the same aria-label (which should not happen
  after following Rule 4, but may occur with unit selects):
  Scope: section_container >> input[aria-label="..."]
  where section_container is identified by its heading text

RULE 6 — RECORD CSS SELECTOR AS LAST RESORT ONLY
  Only include css_selector in the draft config if:
    - aria-label is absent
    - role+name matching fails
    - the CSS is short, semantic, and unlikely to change
  Always add a review_note: "CSS selector, verify stability"

═══════════════════════════════════════════════════════════
SECTION 20 — PROMOTION WORKFLOW
      (from generated draft to production config)
═══════════════════════════════════════════════════════════

The lifecycle of a service config is:

  [explore]           [review]           [promote]         [validate]
  explorer runs  ──►  human reviews  ──►  copy to final ──► smoke test
                      REVIEW_NOTES.md     config path       confirms OK

Folder structure:
  config/
    services/
      generated/              ← explorer writes here only
        <id>_draft.json       ← staging, never auto-consumed
      <id>.json               ← production, human-promoted only

Promotion command (example):
  python promote_service.py \
    --draft config/services/generated/s3_draft.json \
    --target config/services/s3.json \
    --require-status OK        ← rejects if any dim is REVIEW_REQUIRED
    --smoke-test               ← runs fill test before writing

If smoke test fails:
  - do NOT write to config/services/<id>.json
  - write failure report to artifacts/<id>/smoke_test_failure.json
  - human must fix draft and re-promote

═══════════════════════════════════════════════════════════
END OF PROMPT
═══════════════════════════════════════════════════════════

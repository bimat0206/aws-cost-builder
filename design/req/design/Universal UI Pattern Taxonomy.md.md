PATTERN 1: CHECKBOX-TOGGLE GATE
  Trigger:  role=checkbox at page top
  Effect:   Adds/removes an entire section from the DOM
  Examples: S3 (all storage classes, Data Transfer, Access Grants)
  Rule:     Must click toggle, wait, fingerprint, scan new DOM

PATTERN 2: RADIO-CARD GATE (mode selector)
  Trigger:  role=radio rendered as large card with description text
  Effect:   Replaces entire form body with a different field set
  Examples: Lambda (Free Tier / Without Free Tier)
            CloudFront (Flat Rate / Pay as you go)
            EC2 Payment options (Savings Plans / On-Demand / Spot)
  Rule:     Each card is a named state; explore all cards separately

PATTERN 3: COLLAPSED ACCORDION (optional section)
  Trigger:  ▶ heading (collapsed), ▼ heading (expanded)
  Effect:   Reveals/hides a bounded group of fields
  Examples: EC2 (EBS, Monitoring, Data Transfer, Additional costs)
            CloudFront Pay-as-go (regional geo sections)
            RDS (Storage, Backup, Snapshot Export)
  Rule:     Click to expand, wait, scan; note sections marked "optional"

PATTERN 4: INSTANCE SEARCH + PREVIEW CARD
  Trigger:  role=combobox (search input) + info card showing selected specs
  Effect:   User types instance name, gets filtered list, selection
            shows vCPU/Memory/cost detail
  Examples: EC2 (instance table with radio rows + filter dropdowns)
            RDS PostgreSQL (combobox + selected instance card)
  Rule:     Capture as COMBOBOX or INSTANCE_TABLE field_type;
            record search input aria-label + preview card selectors separately

PATTERN 5: VALUE + UNIT SIBLING PAIR
  Trigger:  NUMBER input immediately followed by a SELECT with unit options
  Effect:   The two controls are semantically one dimension
  Examples: S3 storage fields, Lambda memory, RDS storage, CloudFront transfer
  Rule:     Always bind as one dimension with unit_sibling sub-object;
            never treat unit SELECT as an independent dimension

PATTERN 6: REPEATABLE ROW (Add button)
  Trigger:  One or more field rows + an "Add [X]" button below them
  Effect:   Clicking Add inserts another identical row of fields
  Examples: S3 Data Transfer inbound/outbound
            EC2 Additional costs (potentially)
  Rule:     Capture as REPEATABLE_ROW with row_fields template;
            do not enumerate rows, model the template

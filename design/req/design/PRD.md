## 1. DOCUMENT METADATA
### 1.1 Document Control
- Document Title: Product Requirements Document (PRD) — AWS Pricing Calculator Automator
- Version: 1.0
- Status: Draft
- Author: `<Author Placeholder>`
- Date: 2026-02-20
- Reviewers: `<Reviewer Placeholder 1>`, `<Reviewer Placeholder 2>`

### 1.2 Document Intent
This PRD defines the product requirements for a local desktop automation application that creates reusable AWS pricing input profiles and automates estimate entry in AWS Pricing Calculator. The document is the source of truth for product behavior, scope boundaries, success criteria, and release acceptance for v1.

## 2. EXECUTIVE SUMMARY
AWS Pricing Calculator Automator is a local Python CLI tool that helps cloud engineers and solution teams build AWS cost estimates faster and with fewer mistakes. It replaces repetitive manual entry in AWS Pricing Calculator with a two-step process: first generate a structured profile, then run browser automation to fill the calculator. The product is designed for teams that produce recurring estimates and need repeatability, auditability, and version control of estimate inputs. It matters because manual estimate creation currently takes about 13 minutes for a moderate 8-service configuration, is prone to typo-level errors, and cannot be reproduced consistently across team members.

## 3. PROBLEM STATEMENT
Teams that prepare AWS estimates currently use a manual, browser-based workflow: open the calculator, add service groups, find services one by one, set regions, and fill each pricing dimension by hand. For a common estimate size of 8 services with roughly 4 dimensions per service, this process takes around 13 minutes per estimate under normal conditions. The work is repetitive and fragile because users must repeatedly re-enter the same values and can easily make mistakes in numeric fields, region selection, or dimension options.

The manual process also fails a core engineering requirement: repeatability. Teams cannot treat estimate inputs as versioned artifacts, cannot reliably review input changes in pull requests, and cannot reuse a known-good estimate definition without repeating all clicks and text entry. This creates inconsistency in client-facing estimates, slows proposal turnaround, and increases internal review effort.

Existing tools do not close this gap. AWS Pricing Calculator has no official public API or import endpoint for full estimate definitions. AWS CLI and infrastructure-as-code workflows such as Terraform are designed for resource management, not for fully reproducing calculator UI data entry workflows. Cost and billing APIs can report historical spend but do not automate calculator form population for prospective estimates. The product therefore targets a specific unmet need: deterministic, local automation of AWS calculator inputs with reusable profile files.

## 4. GOALS AND NON-GOALS
### 4.1 Product Goals
1. Deliver a local CLI workflow that reduces time to create a standard 8-service estimate from approximately 13 minutes manual effort to a materially lower repeatable execution time.
2. Provide a builder mode that outputs human-readable JSON profiles which can be stored, reviewed, and reused in Git.
3. Ensure runner mode can process a validated profile and automate service and dimension entry into AWS Pricing Calculator with minimal manual intervention.
4. Enforce deterministic value resolution using a strict priority chain (`user_value -> default_value -> prompt_message -> abort`) before browser launch.
5. Capture execution evidence after each run through `run_result.json`, including per-service status and failure details.
6. Preserve resilience during runtime by failing forward on non-fatal automation errors, while still producing complete artifacts.
7. Support macOS, Windows, and Linux in one codebase with OS-aware keyboard shortcut handling.
8. Keep operational security simple: no credential storage, no cloud dependency for execution, and local-only profile/artifact handling.

### 4.2 Non-Goals
1. This product will not integrate with AWS Billing, Cost Explorer, or any pricing API for unit-rate discovery.
2. This product will not generate cost optimization recommendations.
3. This product will not produce Excel or PDF reports in v1.
4. This product will not provide historical trend analytics.
5. This product will not support multi-page wizard service flows in AWS Calculator; unsupported flows are logged and skipped with warning behavior.

## 5. TARGET USERS AND USE CASES
### 5.1 Primary Personas
| Persona Name | Role | Primary Use Case |
|---|---|---|
| Priya Sharma | Cloud Solutions Architect | Build repeatable pre-sales estimates for client proposals with service-group organization and reviewable input files. |
| Daniel Reed | DevOps Engineer | Re-run baseline infrastructure cost profiles during architecture iteration and quickly adjust a small set of values using CLI overrides. |
| Sofia Martinez | Pre-Sales Engineer | Produce rapid what-if estimates during customer calls by prompting unresolved fields at run time while preserving a reusable profile template. |

### 5.2 End-to-End Use Case Scenarios
1. A solutions architect creates a baseline profile for an e-commerce platform, commits it to Git, and runs automation to generate a browser-filled estimate in one repeatable sequence.
2. A DevOps engineer runs the same profile across two design revisions, using `--set` for instance count changes, and compares run artifacts to validate exactly what changed.
3. A pre-sales engineer keeps selected dimensions unresolved with `prompt_message` and enters values live during stakeholder meetings without editing the profile file.
4. A team lead executes `--dry-run` in CI-style local checks to validate profile health and detect unresolved required dimensions before anyone opens a browser.
5. An operator runs a profile where one service dimension fails to locate due to UI drift; the tool captures a screenshot, marks partial success, and completes remaining services instead of aborting the entire estimate.

## 6. FUNCTIONAL REQUIREMENTS
### 6.1 FR-PROFILE Requirements
- **FR-PROFILE-01** — Schema Version Enforcement  
  The application shall accept only profile documents with `schema_version: "2.0"` in v1. Profiles with missing or mismatched schema version shall fail validation before any runtime resolution or browser actions begin.

- **FR-PROFILE-02** — Structural Validation Against JSON Schema  
  The application shall validate all profile files using `jsonschema` against `config/json-schema.json` before execution. Validation shall include required objects, allowed value types, and prohibited additional properties where defined.

- **FR-PROFILE-03** — Cross-Field Domain Validation  
  The loader shall verify that each `service_name` exists in `service_catalog.json`, each `region` maps through `region_map.json` (or `global` logic), and each dimension key is valid for that service. Validation failures shall be aggregated and returned in one report.

- **FR-PROFILE-04** — Git-Friendly Human-Readable Format  
  Profile files shall remain JSON-based, UTF-8 encoded, and formatted in a structure suitable for source control diff review. The product shall not require binary artifacts or hidden metadata for runtime execution.

- **FR-PROFILE-05** — Group-Oriented Service Organization  
  A profile shall support one or more named groups, each with one or more services, preserving group order and service order for deterministic runner behavior.

- **FR-PROFILE-06** — Dimension Metadata Support  
  A dimension object shall support `user_value`, `default_value`, optional `unit`, optional `prompt_message`, and optional `required` (default true). These fields shall be the full input domain for resolver decisions.

- **FR-PROFILE-07** — Runtime Override Compatibility  
  The profile model shall allow runtime mutation through `--set` without requiring file edits. Override application shall happen after profile load and before value resolution.

### 6.2 FR-BUILDER Requirements
- **FR-BUILDER-01** — Interactive Wizard Entry Point  
  Running `python main.py --build` shall start an interactive terminal wizard that collects project metadata, groups, services, regions, and dimension values.

- **FR-BUILDER-02** — Service Selection From Catalog  
  Builder mode shall present only services defined in `service_catalog.json`. Users shall not need to manually type unsupported service identifiers.

- **FR-BUILDER-03** — Region Input Constrained by Catalog and Region Map  
  Builder mode shall only allow region values that are supported by the selected service and present in `region_map.json`, with `global` handled as a special pseudo-region.

- **FR-BUILDER-04** — Dimension Value Capture Options  
  For each dimension, builder mode shall allow users to set explicit value, keep catalog default, or mark for runtime prompt via `prompt_message`.

- **FR-BUILDER-05** — Profile Output to Local Disk  
  Builder mode shall write a valid JSON profile to the local `profiles/` directory (or requested output path) and confirm the file path on completion.

- **FR-BUILDER-06** — Validation Before Save Completion  
  Builder mode shall validate generated profile content before final save success is reported. If validation fails, the wizard shall provide corrective prompts or fail with explicit errors.

### 6.3 FR-RESOLVER Requirements
- **FR-RESOLVER-01** — Strict Resolution Priority Chain  
  For every dimension, resolver behavior shall follow this order exactly: `user_value`, then `default_value`, then runtime prompt from `prompt_message`, then unresolved handling.

- **FR-RESOLVER-02** — Required Field Blocking  
  If a required dimension remains unresolved after chain evaluation, it shall be marked unresolved and included in a batched preflight error report.

- **FR-RESOLVER-03** — Optional Field Skip Behavior  
  If a non-required dimension remains unresolved, resolver shall mark it as skipped and allow execution to continue.

- **FR-RESOLVER-04** — Batch Unresolved Reporting  
  Resolver shall accumulate unresolved required dimensions across all groups and services and report them together before browser startup.

- **FR-RESOLVER-05** — Fail-Fast Gate Before Browser  
  The runner shall not launch Playwright if any unresolved required dimensions exist after resolution.

- **FR-RESOLVER-06** — Override Application Ordering  
  Runtime `--set` overrides shall be applied before priority-chain resolution so overrides can satisfy otherwise unresolved dimensions.

### 6.4 FR-BROWSER Requirements
- **FR-BROWSER-01** — Browser Launch and Calculator Navigation  
  Runner mode shall launch Playwright Chromium (headed by default) and navigate to `https://calculator.aws/#/estimate`.

- **FR-BROWSER-02** — Group Creation in Calculator  
  For each profile group, runner mode shall create or target a matching calculator group name before adding services.

- **FR-BROWSER-03** — Service Search and Add Workflow  
  Runner mode shall use catalog `search_term` to find services in calculator and add the correct service card based on expected display title.

- **FR-BROWSER-04** — Region Selection Mapping  
  Runner mode shall map profile region codes through `region_map.json` and select the exact calculator display string where region selection applies.

- **FR-BROWSER-05** — Global Region Skip Logic  
  If region is `global`, runner mode shall skip region interaction and continue to dimension filling without error.

- **FR-BROWSER-06** — Retry Behavior for Step Failures  
  Runner mode shall retry failed navigation and interaction steps up to 2 times with 1.5 second delay per retry cycle before marking failure.

- **FR-BROWSER-07** — Fail-Forward Runtime Continuation  
  Non-fatal failures during service or dimension handling shall be captured and logged while the runner continues processing remaining work.

### 6.5 FR-LOCATOR Requirements
- **FR-LOCATOR-01** — Label-Based Find-in-Page Anchor  
  Dimension location shall use native Find-in-Page with the plain-English dimension key as search term instead of brittle class-name selectors.

- **FR-LOCATOR-02** — CDP Bounding Rectangle Retrieval  
  After Find-in-Page match, locator shall read selected text bounding rectangle via CDP evaluation and use it as anchor for nearby control discovery.

- **FR-LOCATOR-03** — Vertical-Band Interactive Search  
  Locator shall search interactive DOM controls within a vertical band around the matched label and rank candidates by proximity and control priority.

- **FR-LOCATOR-04** — Field Type Detection  
  Locator shall return both element handle and detected field type (`NUMBER`, `TEXT`, `SELECT`, `COMBOBOX`, `TOGGLE`, `RADIO`) for interactor use.

- **FR-LOCATOR-05** — Retry and Fallback Handling  
  If no matching control is found, locator shall retry according to policy and then return skip/fail outcome with warning evidence rather than crashing the run.

### 6.6 FR-ARTIFACT Requirements
- **FR-ARTIFACT-01** — Run Artifact Emission After Every Run  
  Runner and dry-run executions shall emit a structured `outputs/run_result.json` artifact containing metadata, status, and per-group/service results.

- **FR-ARTIFACT-02** — Status Enumeration and Counters  
  Artifact shall include overall run status (`success`, `partial_success`, `failed`) and service-level counters (`dimensions_filled`, `dimensions_skipped`, `dimensions_failed`).

- **FR-ARTIFACT-03** — Failure Context Recording  
  On service-level failures, artifact shall capture failed step, failed dimension where applicable, and screenshot path when available.

- **FR-ARTIFACT-04** — Screenshot Capture on Failed Step  
  The application shall capture PNG screenshots to `outputs/screenshots/` whenever a step transitions to failed state after retry exhaustion.

- **FR-ARTIFACT-05** — Calculator URL Persistence  
  Artifact shall record the final calculator URL for traceability and review after run completion.

### 6.7 FR-CLI Requirements
- **FR-CLI-01** — Builder Mode Flag  
  `--build` shall launch Mode A wizard and shall not require profile path input.

- **FR-CLI-02** — Runner Mode Flags  
  `--run --profile <path>` shall launch Mode B automation using the specified profile.

- **FR-CLI-03** — Dry-Run Mode Flag  
  `--dry-run --profile <path>` shall execute load, validation, and resolution without opening a browser, and shall still produce run diagnostics.

- **FR-CLI-04** — Headless Runtime Option  
  `--headless` shall run Playwright without visible window in runner mode.

- **FR-CLI-05** — Runtime Dimension Override Flag  
  `--set "<group>.<service>.<dimension>=<value>"` shall allow single-dimension override and may be provided multiple times.

- **FR-CLI-06** — Override Validation  
  Each `--set` expression shall be validated for syntax and profile target existence before run execution proceeds.

- **FR-CLI-07** — Exit Code Semantics  
  CLI shall return non-zero exit codes for preflight failures and fatal runtime errors, and zero for fully successful execution.

## 7. NON-FUNCTIONAL REQUIREMENTS
### 7.1 Performance
The product shall improve practical estimate throughput relative to the current manual baseline of ~13 minutes for an 8-service, 4-dimension-per-service estimate. Target behavior for v1 is completion of equivalent runs in under 6 minutes on a standard developer workstation and stable broadband connection, excluding user think-time during prompt responses. Dry-run validation for the same profile shall complete in under 10 seconds in typical local conditions.

### 7.2 Reliability
The system shall provide deterministic preflight behavior with fail-fast handling for unresolved required values. During browser automation it shall apply a bounded retry policy (2 retries per step, 1.5 second delay) and fail-forward continuation for non-fatal errors to maximize completed work. Every run shall produce structured status output and artifact evidence so partial failures remain diagnosable and auditable.

### 7.3 Portability
The application shall run on macOS, Windows, and Linux with one codebase and no platform-specific forks. Keyboard shortcuts for Find-in-Page shall use OS-aware key mappings (`Cmd+F` on macOS, `Ctrl+F` elsewhere). File path handling, JSON encoding, and CLI behavior shall remain consistent across platforms.

### 7.4 Maintainability
Selector resilience shall prioritize label-driven location over fragile CSS selectors. Service support shall be maintained through `service_catalog.json` updates rather than deep code changes where possible. The project structure shall keep responsibilities isolated by module (`loader`, `resolver`, `locator`, `interactor`, `artifact`) so updates can be tested and shipped independently.

### 7.5 Security
The application shall not request, store, or transmit AWS credentials. Execution shall remain local except browser access to `https://calculator.aws/#/estimate`. The product shall avoid uploading profile content to third-party services and shall store artifacts only on local disk unless users intentionally move them.

### 7.6 Usability
Terminal output shall use clear, color-coded status semantics via `rich`, including success, warning, and failure markers with actionable context (group, service, dimension, step). Builder prompts shall be explicit and unambiguous, especially for unresolved-value behavior. Error messages shall explain exactly what needs correction, not only that a failure occurred.

## 8. DATA MODEL
### 8.1 JSON Cost Profile Schema (Annotated)
```json
{
  "schema_version": "2.0",                 
  "project_name": "string (required, non-empty)",
  "description": "string (optional)",
  "groups": [
    {
      "group_name": "string (required, non-empty)",
      "services": [
        {
          "service_name": "string (required; must exist in service_catalog.json)",
          "human_label": "string (required; display label in output)",
          "region": "string (required; region code or Global/global)",
          "dimensions": {
            "<Dimension Key>": {
              "user_value": "string|number|boolean|null (optional)",
              "default_value": "string|number|boolean|null (optional)",
              "unit": "string (optional)",
              "prompt_message": "string (optional; used when user/default are null)",
              "required": "boolean (optional; defaults to true)"
            }
          }
        }
      ]
    }
  ]
}
```

Field rules:
- `schema_version` is required and must equal `2.0`.
- `groups` must contain at least one group.
- `services` must contain at least one service per group.
- `dimensions` object keys must match catalog dimension keys for each service.
- If a dimension is required and both `user_value` and `default_value` are null, resolver requires either prompt input or preflight failure.

### 8.2 `run_result.json` Schema (Annotated)
```json
{
  "schema_version": "2.0",
  "run_id": "run_YYYYMMDD_HHMMSS",
  "profile_name": "string",
  "status": "success|partial_success|failed",
  "started_at": "ISO8601 timestamp",
  "completed_at": "ISO8601 timestamp",
  "calculator_url": "string URL",
  "groups": [
    {
      "group_name": "string",
      "services": [
        {
          "service_name": "string",
          "human_label": "string",
          "status": "success|partial_success|failed",
          "failed_step": "string (optional)",
          "failed_dimension": "string (optional)",
          "screenshot": "path string (optional)",
          "dimensions_filled": "integer >= 0",
          "dimensions_skipped": "integer >= 0",
          "dimensions_failed": "integer >= 0"
        }
      ]
    }
  ]
}
```

Artifact rules:
- `run_id`, `started_at`, and `completed_at` are required for traceability.
- `status` reflects overall run state, not only the last service processed.
- Per-service counters must reconcile with total dimension attempts for that service.
- Screenshot path is required when a failed step includes captured evidence.

### 8.3 `service_catalog.json` Structure
```json
[
  {
    "service_name": "Amazon EC2",
    "search_term": "EC2",
    "calculator_page_title": "Amazon EC2",
    "supported_regions": ["us-east-1", "us-west-2", "eu-west-1"],
    "dimensions": [
      {
        "key": "Operating System",
        "field_type": "SELECT",
        "options": ["Linux", "Windows", "RHEL", "SUSE"],
        "default_value": "Linux",
        "required": true
      },
      {
        "key": "Instance Type",
        "field_type": "COMBOBOX",
        "default_value": "t3.micro",
        "required": true
      },
      {
        "key": "Number of Instances",
        "field_type": "NUMBER",
        "unit": null,
        "default_value": 1,
        "required": true
      }
    ]
  }
]
```

Catalog rules:
- `field_type` must be one of `NUMBER`, `TEXT`, `SELECT`, `COMBOBOX`, `TOGGLE`, `RADIO`.
- `options` is required for deterministic select/radio handling when choices are finite.
- `supported_regions` constrains valid region assignment in builder and runner modes.

## 9. SYSTEM ARCHITECTURE OVERVIEW
The application is split into mode orchestration, preflight core services, builder modules, and browser automation modules. `main.py` routes user commands to Mode A (`builder/interactive_builder.py`) or Mode B (`core/profile_loader.py`, `core/value_resolver.py`, then `automation/*`). Configuration under `config/` provides schema rules, service metadata, and region labels consumed by both modes.

In Mode A, `interactive_builder.py` and `service_picker.py` drive terminal interactions, then produce a JSON profile artifact in `profiles/`. In Mode B, `profile_loader.py` validates profile structure and semantic integrity, `value_resolver.py` produces resolved dimensions with fail-fast gating, and the automation pipeline (`browser_session.py`, `navigator.py`, `find_in_page_locator.py`, `field_interactor.py`) executes browser operations. `artifact_emitter.py` writes final outcomes and evidence under `outputs/`.

### 9.1 Mode A Flow Diagram
```plaintext
User CLI (--build)
  -> main.py
    -> load config (schema, catalog, region map)
    -> interactive_builder.py
      -> service_picker.py (select supported services)
      -> collect groups/services/regions/dimensions
    -> validate draft profile
    -> write profiles/<name>.json
    -> terminal summary
```

### 9.2 Mode B Flow Diagram
```plaintext
User CLI (--run --profile <path> [--set ...])
  -> main.py
    -> profile_loader.py (JSON + schema + cross-field validation)
    -> value_resolver.py (override + priority chain)
      -> unresolved required? yes -> fail fast and exit
      -> unresolved required? no  -> continue
    -> browser_session.py (launch Chromium)
    -> navigator.py (create groups, add services, set region)
    -> find_in_page_locator.py (label -> element + type)
    -> field_interactor.py (fill value by type)
    -> artifact_emitter.py (run_result.json + screenshots)
    -> terminal completion status
```

## 10. FIND-IN-PAGE FIELD LOCATION STRATEGY
The core locator design uses the browser’s native Find-in-Page capability because AWS Calculator is a React SPA with dynamic, often unstable class names and no stable automation identifiers guaranteed across releases. CSS selector and XPath-only strategies become expensive to maintain and fragile when UI structure changes. By anchoring on human-readable dimension labels already defined in `service_catalog.json`, the product reuses the most stable semantic signal available in the UI: visible text that users themselves rely on.

Implementation sequence:
1. Reset viewport position to top of current service area to make label search deterministic.
2. Open native Find-in-Page (`Cmd+F` on macOS, `Ctrl+F` on Windows/Linux).
3. Type the dimension key exactly as defined in profile/catalog.
4. Advance to first match and retrieve selection geometry through CDP (`Runtime.evaluate` against `window.getSelection()` range bounds).
5. Close Find-in-Page bar with `Escape` so keyboard and click focus return to page content.
6. Search interactive elements in a vertical band around the matched text (`±150px` from match top).
7. Evaluate candidate controls in priority order (`input[number]`, `input[text]`, `select`, `role=combobox`, `role=spinbutton`, `role=switch`, `role=radio`, `role=listbox`).
8. Return nearest valid element handle and detected field type to `field_interactor.py`.

Fallback and skip behavior:
- If text match or nearby interactive control is not found, the locator retries twice with configured delay.
- If still unresolved after retries, the dimension is marked skipped or failed based on requirement semantics, a screenshot is captured, and the runner continues (fail-forward).
- The locator never terminates the entire run by itself unless failure is due to fatal browser state.

## 11. ERROR HANDLING SPECIFICATION
| Layer | Error Class | Trigger Condition | Response | Artifact Impact |
|---|---|---|---|---|
| Profile Load | `ProfileLoadError` | Profile file missing, unreadable, or invalid JSON | Fail fast, print actionable message, exit non-zero | `run_result.json` may include `failed` preflight summary if emitted; no browser URL |
| Value Resolution | `ResolutionError` | Required dimension unresolved after chain | Aggregate unresolved list, fail fast before browser launch | Artifact status set to failed/preflight failure; no service runtime entries |
| Browser Launch | `BrowserLaunchError` | Chromium cannot start or page cannot open calculator | Fail run immediately, print launch diagnostics | Artifact status `failed`, no completed service entries |
| Navigation | `NavigationError` | Group creation or page navigation step fails after retries | Mark current service/group failure, capture screenshot, continue | Service marked `failed` or `partial_success`; screenshot path recorded |
| Service Search | `ServiceSearchError` | Service search term returns no valid match | Mark service failed, screenshot, continue with next service | Service `failed`, counters updated accordingly |
| Find-in-Page | `LocatorError` | Label not found or no nearby control found after retries | Mark dimension skipped/failed based on required, screenshot, continue | Dimension failure contributes to service counters; step metadata recorded |
| Field Interaction | `FieldInteractionError` | Fill/select/toggle/radio action fails after retries | Mark dimension failed, screenshot, continue | Service may become `partial_success` or `failed`; dimension counters increment |
| Artifact Write | `ArtifactWriteError` | `run_result.json` or screenshot path write failure | Print explicit filesystem error; return non-zero if final artifact missing | Missing or partial artifacts; terminal output remains primary evidence |

## 12. ACCEPTANCE CRITERIA
### 12.1 Builder Acceptance Criteria
| ID | Scenario | Given / When / Then | Pass Condition |
|---|---|---|---|
| AC-BLD-01 | Create valid profile | Given a user runs `--build`, when they complete prompts with valid data, then the app writes a profile JSON file. | File exists in `profiles/`, validates against schema v2.0, includes entered groups/services/dimensions. |
| AC-BLD-02 | Service list constrained to catalog | Given builder mode is active, when user selects services, then only catalog-defined services are available. | No unsupported service can be selected or saved. |
| AC-BLD-03 | Prompt-at-run-time dimension | Given user leaves dimension value unresolved and enters `prompt_message`, when profile is saved, then dimension is stored for runtime prompt. | Saved JSON includes null user value and non-empty `prompt_message`. |
| AC-BLD-04 | Region validation | Given a service with constrained regions, when user selects region, then invalid region choices are rejected. | Profile save blocked until a valid region is selected. |

### 12.2 Runner Acceptance Criteria
| ID | Scenario | Given / When / Then | Pass Condition |
|---|---|---|---|
| AC-RUN-01 | Preflight success and run | Given a valid profile with resolvable required dimensions, when user runs `--run`, then browser automation processes all groups and services. | `run_result.json` emitted with service outcomes and final calculator URL. |
| AC-RUN-02 | Preflight fail-fast | Given unresolved required dimensions remain after resolution, when user runs `--run`, then browser does not launch. | CLI exits non-zero and reports all unresolved dimensions together. |
| AC-RUN-03 | Runtime override | Given profile value exists, when user runs with `--set` override, then override value is used for fill behavior. | Artifact and logs reflect override-applied value at target dimension. |
| AC-RUN-04 | Fail-forward continuation | Given one dimension fails during automation, when retries are exhausted, then runner continues with remaining dimensions/services. | Overall run completes with `partial_success` and failure evidence captured. |

### 12.3 Locator Acceptance Criteria
| ID | Scenario | Given / When / Then | Pass Condition |
|---|---|---|---|
| AC-LOC-01 | Label found and control resolved | Given a visible dimension label and nearby input, when locator executes Find-in-Page strategy, then it returns element handle and type. | Interactor receives non-null `LocatedField` and fills value successfully. |
| AC-LOC-02 | No match retry path | Given label is absent or changed, when locator runs, then it retries twice and exits with controlled miss behavior. | Dimension marked skipped/failed without crashing run; warning logged. |
| AC-LOC-03 | OS shortcut handling | Given macOS or Windows/Linux, when locator opens Find-in-Page, then correct key chord is used. | Find bar opens and closes reliably on each supported OS. |
| AC-LOC-04 | Vertical band disambiguation | Given multiple controls near a label, when locator ranks candidates, then nearest valid control is chosen. | Correct control is selected in test fixture with deterministic ordering. |

### 12.4 Artifact Acceptance Criteria
| ID | Scenario | Given / When / Then | Pass Condition |
|---|---|---|---|
| AC-ART-01 | Success artifact completeness | Given a full-success run, when artifact is written, then all required metadata and counters are present. | `run_result.json` validates and has `status=success` with zero failed counters. |
| AC-ART-02 | Partial failure evidence | Given a runtime failure at dimension step, when artifact is written, then failed step and screenshot path are included. | Service entry contains failure metadata and screenshot file exists on disk. |
| AC-ART-03 | Timestamp and run identity | Given any run type, when completion occurs, then `run_id`, `started_at`, and `completed_at` are recorded. | Values are present and parseable for audit trail. |
| AC-ART-04 | Dry-run output behavior | Given `--dry-run`, when preflight passes, then diagnostic artifact data is still produced without browser URL dependency. | Artifact exists and indicates non-browser execution context clearly. |

## 13. DEPENDENCIES AND CONSTRAINTS
### 13.1 External Dependencies
- Playwright and bundled Chromium must be installable and executable on target OS.
- AWS Pricing Calculator website must be reachable and operational at runtime.
- AWS Calculator UI labels and interaction patterns must remain sufficiently stable for label-driven location strategy.

### 13.2 Internal Dependencies
- `service_catalog.json` accuracy is required for service availability, field types, defaults, and search behavior.
- `region_map.json` must stay aligned with calculator display strings.
- `json-schema.json` must remain synchronized with profile loader expectations and model parsing.

### 13.3 Product Constraints
- No AWS credentials are required or used by this product.
- The application runs fully local on user machines; no hosted backend is part of v1.
- Any AWS UI change can break automation behavior without prior notice; catalog and locator tuning are expected maintenance activities.

## 14. RISKS AND MITIGATIONS
| Risk ID | Description | Likelihood | Impact | Mitigation Strategy |
|---|---|---|---|---|
| R-01 | AWS calculator UI changes label text or control hierarchy, causing locator misses. | H | H | Use label-based strategy with retry and screenshot evidence; maintain rapid catalog update process and regression test fixtures. |
| R-02 | Service catalog becomes stale as AWS adds/renames dimensions. | M | H | Establish catalog update checklist per release; require smoke run against supported services before tagging. |
| R-03 | Cross-platform key handling inconsistencies reduce Find-in-Page reliability. | M | M | Implement OS-aware shortcut abstraction, fallback key paths, and platform-specific tests in CI matrix. |
| R-04 | Headless mode behavior differs from headed mode, causing false negatives in locator/interactor. | M | M | Keep headed mode default, treat headless as optional, and run periodic parity tests between modes. |
| R-05 | Users create malformed or semantically invalid profiles manually. | H | M | Enforce strict schema + cross-field validation and fail-fast unresolved report before browser launch. |
| R-06 | Artifact write failures due to local permissions or disk path issues. | L | M | Pre-create output directories, emit explicit filesystem errors, and document path prerequisites. |
| R-07 | Performance regression makes automation only marginally better than manual workflow. | M | M | Track benchmark runs for 8-service profile and optimize navigation waits and locator efficiency each release. |

## 15. OPEN QUESTIONS
1. Should profile schema v2.0 enforce stronger type constraints per dimension field_type (for example numeric-only values for `NUMBER`) at save time, or keep permissive typing and rely on runtime interaction validation? Tradeoff: stricter validation prevents bad runs but increases catalog/model complexity.
2. Should `--dry-run` always emit `run_result.json`, or should dry-run output remain terminal-only unless an explicit `--emit-artifact` flag is provided? Tradeoff: default artifact improves auditability but may add file noise for developers.
3. How should the runner behave when multiple calculator search results match a service term but differ by naming variant? Tradeoff: strict title matching reduces accidental selection but may fail more often when AWS changes labels.
4. Should unsupported multi-page wizard services be blocked during builder profile creation, or allowed with explicit warning and runtime skip semantics? Tradeoff: builder-time blocking reduces confusion but limits user flexibility for future compatibility.
5. Should per-dimension failure screenshots be optional via CLI flag to reduce disk usage, or mandatory for all failures for diagnostics consistency? Tradeoff: mandatory evidence improves debugging but can increase storage overhead.
6. Should override syntax support quoting or escaping for group/service/dimension names containing dots, or should naming conventions disallow dots to keep parser simple? Tradeoff: richer parser increases usability for edge names but adds parsing complexity and test surface.

## 16. FUTURE ROADMAP (Post-V1)
| Roadmap ID | Opportunity Statement |
|---|---|
| RM-01 | Add multi-environment profile support so one profile can define dev/stage/prod value variants with explicit environment selection at run time. |
| RM-02 | Introduce profile inheritance and templating to reduce duplication across related projects while preserving explicit override visibility. |
| RM-03 | Expand artifact capture to store and optionally reopen estimate URL snapshots per run for easier review handoff across team members. |
| RM-04 | Add profile and artifact diff mode that compares two runs and highlights changed dimensions, changed statuses, and changed service counts. |
| RM-05 | Provide CI/CD-friendly headless integration mode with stable exit semantics and machine-readable summary output for automated gates. |
| RM-06 | Add a profile recorder mode that watches user interactions in calculator and generates a draft profile from observed inputs (watch-and-capture). |
| RM-07 | Add catalog health diagnostics that test all configured dimension labels against fixture pages and report probable drift before runtime execution. |
| RM-08 | Add optional plugin hooks for organization-specific validation rules (naming policy, allowed regions, mandatory tags/dimensions). |

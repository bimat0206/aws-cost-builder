## 1. DOCUMENT METADATA

Title: Failure & Observability Specification
Version: 1.0
Status: Draft
Author: [Placeholder: Senior Reliability Engineer]
Date: [Placeholder: Date]
Reviewers: [Placeholder: Platform Architecture Team]
Related Documents: 
- Product Requirements Document (PRD)
- Software Design Document (SDD)

## 2. PURPOSE AND SCOPE

### 2.1 Purpose

The AWS Pricing Calculator Automator is constrained by its execution environment: it is a local Command Line Interface (CLI) application distributed exclusively to operator workstations. Absent a centralized backend, distributed service architecture, or continuous remote telemetry, classical monitoring paradigms such as distributed tracing or metrics aggregation are entirely inapplicable. Given these profound architectural constraints, the local execution footprint remains the sole environment over which we have diagnostic control. 

This document serves as the definitive specification for how the application encounters, processes, mitigates, and reports failure. It dictates an architecture wherein observability is entirely self-contained within the host process, utilizing standard file synchronization, local terminal rendering, deterministic JSON artifacts, and persistent graphical evidence (screenshots) as the complete debugging and reporting suite. A segregated and robust specification ensures that local execution guarantees reliable failure insights down to the browser's DOM element rendering cycle, preserving developer velocity and operational transparency without requiring cloud connectivity for monitoring. 

### 2.2 Scope

This specification strictly governs the structured handling of execution failure events, logging standardizations, visual evidence captures, and the artifact retention lifecycles produced directly by the local `aws-pricing-calculator-automator` process. It provides exhaustive requirements over thirteen explicit failure layers, from local file ingestion (L1) through post-run disk writes (L13). 

The following domains are explicitly out of scope for this document:
- Continuous Integration or Continuous Deployment (CI/CD) pipelines, GitHub Actions workflows, or build server pipelines.
- External or cloud-hosted monitoring platforms, log aggregators, or metric services (e.g., Datadog, Grafana, Sentry, New Relic, AWS CloudWatch).
- Distributed tracing, application performance monitoring (APM) agents, or OpenTelemetry protocols.
- Use of the official AWS Billing API, AWS Cost Explorer API, or any enterprise billing reporting platform.
- The translation of calculator results into generated business reports, such as Excel spreadsheets, PDFs, or analytical dashboards.

### 2.3 Definitions

| Term | Definition |
| --- | --- |
| **Fail-Fast** | A failure strategy enforced strictly before any browser automation begins. All failures encountered in this phase cause immediate, non-recoverable process aborts following a batch report of all accumulated logical violations. |
| **Fail-Forward** | A failure strategy applied during browser automation. The application tolerates the failure of individual nodes (e.g., a missing dimension field) by capturing evidence, marking the step as failed or skipped, and proceeding with the remainder of the automation sequence. |
| **SKIPPED** | A terminal state assigned to an optional automation step that cannot be completed due to missing configuration, unsuccessful resolution, or environmental missing elements, but which does not fatally compromise the service configuration. |
| **FAILED** | A terminal state assigned to a mandatory configuration step (e.g., region selection) or required dimension field that failed to execute even after all configured retry attempts were exhausted, invalidating the service or the run outcome. |
| **partial_success** | A top-level artifact status denoting that at least one AWS service completed its automation cycle without terminal error, but at least one other targeted dimension or AWS service in the profile was skipped or failed. |
| **Run Artifact** | The strictly formatted output `run_result.json` file generated exactly once at the end of every execution sequence, summarizing the definitive outcome of all loaded services and dimensions. |
| **Exit Code** | An integer emitted to the parent operating system shell via `sys.exit()` indicating the categorical outcome of the process execution (e.g., success, partial automation failure, artifact write failure). |
| **Structured Log** | Immutable, machine-readable log entries appended to a local `run.log` file, containing defined key-value metrics intended for programmatic parsing or manual debug correlation. |
| **Screenshot Context** | Data embedded within the filename of captured screenshots providing chronological, hierarchical placement of the failure relative to the run sequence, guaranteeing no image is orphaned from its root cause. |
| **Retry Exhaustion** | The absolute threshold (strictly 2 attempts after initial failure) at which the automation engine terminates execution attempts on a specific step and immediately transitions the node to a `SKIPPED` or `FAILED` state. |
| **Unresolved Dimension** | A variable within the user's workload profile that lacks an explicitly supplied value and could not be recursively resolved through the internal priority resolution algorithm. |
| **Cross-Field Validation** | The phase wherein verified valid JSON schema data is checked against the authoritative `service_catalog.json` and `region_map.json` configurations prior to automation entry. |


## 3. FAILURE STRATEGY OVERVIEW

### 3.1 Two-Strategy Model

The architecture of the application segments execution into two starkly opposing failure handling paradigms separated by an irrevocable chronological boundary: the instantiation of the Playwright browser process. Everything occurring strictly before the browser opens adheres to the **FAIL FAST** strategy. Everything occurring after the browser opens adheres to the **FAIL FORWARD** strategy.

The **FAIL FAST** strategy ensures that no heavy automation orchestration begins if the input profile is deterministic garbage. I/O boundaries, JSON structure semantics, cross-field referential integrity, and complete value resolution must be computationally valid before browser launch. If a profile specifies an invalid AWS service, points to an undefined region mapping, or omits a required input dimension without providing a default resolution path, it is mathematically impossible for the automation to succeed. Thus, the system groups all such errors into a consolidated rejection report and forcibly aborts execution. It saves time, network resources, and CPU cycles by preventing doomed browser lifecycles.

The **FAIL FORWARD** strategy recognizes that once the application crosses the boundary into Playwright browser execution, execution becomes highly unpredictable and non-deterministic. AWS Calculator DOMs may mutate without warning, React hydration cycles may introduce race conditions, or network latency might delay UI paints. Thus, if the application is unable to locate a specific dimension label via the Find-in-Page locator algorithm, it captures forensic graphical evidence (a screenshot), registers the isolated step as a failure, increments the failure metric in the group state, and immediately commands the field interactor to move to the next dimension. One missing input field does not crash the script, preserving the calculation accuracy of all other correctly modeled services in the run.

### 3.2 Failure Layer Map

The boundary between strategy phases is drawn decisively between Layer 5 (L5) and Layer 6 (L6).

```text
======================================================================
[ PRE-AUTOMATION STAGE ] STRATEGY: FAIL FAST
======================================================================
  L1 ── Profile File I/O               (File loading & filesystem access)
  L2 ── JSON Parsing                   (Syntax & format integrity)
  L3 ── Schema Validation              (Draft-07 specification constraints)
  L4 ── Cross-Field Validation         (Dictionary & catalog referential logic)
  L5 ── Value Resolution               (Input variable priority checking)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
           BOUNDARY PHASE: BROWSER LAUNCH INITIATION 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

======================================================================
[ POST-AUTOMATION STAGE ] STRATEGY: FAIL FORWARD
======================================================================
  L6 ── Browser Launch                 (Chromium / Playwright initialization)
  L7 ── Page Navigation                (Targeting calculator.aws routing)
  L8 ── Group Creation                 (Estimate UI manipulation)
  L9 ── Service Search                 (AWS service selection DOM access)
  L10 ─ Region Selection               (Dropdown state modification)
  L11 ─ Find-in-Page Locator           (DOM text matching via Ctrl+F)
  L12 ─ Field Interaction              (Input field mutations & typing)
  L13 ─ Artifact Write                 (Post-execution disk serialization)
```

### 3.3 Failure Propagation Rules

The rules governing how failure transitions from origin to standard output reflect the strategic dichotomy outlined above. 

During the **FAIL FAST** phase, propagation is batched. The system is designed not to fail on the very first exception it hits. Instead, during schema and cross-field validation, the rules engine accumulates all distinct violations into a sequence array without raising control-flow exceptions. Upon exhaustion of all pre-automation checks, if the array contains one or more violations, a summary exception containing the full bulk aggregate is raised. The user receives a comprehensive list of all issues across their JSON profile simultaneously rather than suffering through an iterative game of correcting one error only to discover a second upon the subsequent run. The entire run terminates natively with an exit code of `1`.

During the **FAIL FORWARD** phase, propagation is strictly isolated downwards. If an error occurs in step L12 (Field Interaction), the exception is fully caught by the individual step executor. The automation controller logs the isolated failure, triggers the screenshot handler exclusively for that DOM context, registers the state into the ongoing artifact blueprint, and safely yields execution back to the orchestrator to advance the iteration payload to the next property. The error is completely contained; it does not bubble up to crash the service executor, nor the group executor, nor the parent browser session. The final exit code degrades gracefully from `0` to `2` to reflect partial completion, ensuring that all succeeding work within the run remains securely captured and valid.


## 4. FAILURE CATALOG

The comprehensive list of possible failure manifestations maps directly to the layers outlined in the Failure Layer Map. The exact rules defining retries, reporting, and screenshot policies are catalogued below.

| Failure ID | Layer | Module | Error Class | Trigger Condition | Strategy | Retry Count | Retry Delay | Screenshot | Exit Code | Artifact Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **F-L1-01** | L1 | `profile_loader.py` | `ProfileNotFoundError` | The targeted profile JSON file does not exist at the absolute path specified. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L1-02** | L1 | `profile_loader.py` | `ProfilePermissionError` | The OS denies read access due to permission configurations on the JSON file. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L1-03** | L1 | `profile_loader.py` | `ProfileEncodingError` | Profile file exists but contains bytes that violate UTF-8 encoding requirements. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L2-01** | L2 | `profile_loader.py` | `JSONSyntaxError` | The file reading produces a `json.decoder.JSONDecodeError` from standard library parsing. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L3-01** | L3 | `profile_loader.py` | `jsonschema.ValidationError` | Missing a mandatory property as explicitly defined by the JSON Schema definition. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L3-02** | L3 | `profile_loader.py` | `jsonschema.ValidationError` | `schema_version` property utilizes an incompatible major semantic version value. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L3-03** | L3 | `profile_loader.py` | `jsonschema.ValidationError` | Value type mismatch (e.g., providing a string for an explicitly specified boolean schema field). | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L3-04** | L3 | `profile_loader.py` | `jsonschema.ValidationError` | Unrecognized key definition causing violation of the `additionalProperties: false` object restraint. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L4-01** | L4 | `profile_loader.py` | `CrossValidationServiceCatalogError` | Declared `service_name` literal is not physically present anywhere inside `service_catalog.json`. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L4-02** | L4 | `profile_loader.py` | `CrossValidationRegionMapError` | Declared AWS `region` is entirely missing from the canonical explicit configuration inside `region_map.json`. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L4-03** | L4 | `profile_loader.py` | `CrossValidationDimensionKeyError` | Service explicitly exists, but the user-defined targeted dimension key does not exist under that service config. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L4-04** | L4 | `profile_loader.py` | `CrossValidationRequirementError` | The dimension is strictly marked `required=true` but provides absolutely zero priority paths for variable resolution. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L5-01** | L5 | `value_resolver.py` | `UnresolvedRequiredDimensionError` | Algorithm exhausts all resolution layers internally but fails to locate any variable data for a mandatory field. | FAIL FAST | 0 | N/A | No | 1 | No execution |
| **F-L6-01** | L6 | `browser_session.py` | `playwright.Error` | Chromium browser driver fails catastrophic hardware bounds initializing native binary instances at the OS level. | FAIL FORWARD | 0 | N/A | No | 3 | Status `failed` |
| **F-L7-01** | L7 | `navigator.py` | `playwright.TimeoutError` | Explicit time limit exceeded while waiting for `calculator.aws` application bundle payload to finish network delivery. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Status `failed` |
| **F-L7-02** | L7 | `navigator.py` | `playwright.Error` | Underlying DNS execution returns `ERR_NAME_NOT_RESOLVED` or network interface routing collapses attempting to reach endpoint. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Status `failed` |
| **F-L8-01** | L8 | `navigator.py` | `playwright.TimeoutError` | Cannot locate the "Add Group" DOM selector during the group orchestration scaffolding initialization. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Grp status `failed` |
| **F-L8-02** | L8 | `navigator.py` | `playwright.Error` | DOM interaction triggers an immediate interrupt attempting to execute native click handlers over the targeted coordinates. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Grp status `failed` |
| **F-L9-01** | L9 | `navigator.py` | `ElementNotFoundError` | The literal value assigned to `service_name` yields a zero-length result matching array in the calculator's internal catalogue search. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Svc status `failed` |
| **F-L10-01** | L10 | `navigator.py` | `ElementNotFoundError` | The calculator's top level AWS Region mutation dropdown component fails rendering detection checks completely. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Svc status `failed` |
| **F-L10-02** | L10 | `navigator.py` | `playwright.Error` | Valid Region dropdown selector exists natively, but input interactions fail to forcefully apply and enforce the targeted value. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Svc status `failed` |
| **F-L11-01** | L11 | `find_in_page_locator.py` | `FindInPageNoMatchError` | Ctrl+F search invocation natively returns 0 identical string coordinates on the complete initial iteration execution limit. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Dim status `failed` |
| **F-L11-02** | L11 | `find_in_page_locator.py` | `FindInPageExhaustedError` | Active retry policy formally exhausts max attempts explicitly failing to isolate any bounding box matches for target label string. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Dim status `failed` |
| **F-L11-03** | L11 | `find_in_page_locator.py` | `FindInPageAmbiguousError` | Search bounds return >= 2 isolated identical matched strings. The algorithm aggressively targets index 0, registers a Warning. | FAIL FORWARD | 0 | N/A | No | 2 | Impact varies |
| **F-L12-01** | L12 | `field_interactor.py` | `playwright.TimeoutError` | The Playwright interaction loop fails due to strict violation of the actionability timeout explicitly preventing field focus payload input. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Dim status `failed` |
| **F-L12-02** | L12 | `field_interactor.py` | `playwright.Error` | An isolated generic runtime exception triggers natively executing input mutations, indicating catastrophic node detachment or stale tree state. | FAIL FORWARD | 2 | 1.5s | Yes | 2 | Dim status `failed` |
| **F-L13-01** | L13 | `artifact_emitter.py` | `OSError` | Total failure utilizing standard OS disk space attempting immediate generation of local `run_result.json` files due to volume exhaustion parameters. | FAIL FAST | 0 | N/A | No | 4 | No Artifact Output |
| **F-L13-02** | L13 | `artifact_emitter.py` | `PermissionError` | Operating System actively blocks generation procedures for the final resulting directory payload files violating immediate security constraints. | FAIL FAST | 0 | N/A | No | 4 | No Artifact Output |


## 5. RETRY POLICY SPECIFICATION

### 5.1 Retry Wrapper Design

All isolated dimension modification components operating within the FAIL FORWARD boundary exclusively run under a dedicated Python automation retry decorator (e.g., `@automation_retry_wrapper`). This decorator operates as the centralized defense mechanism utilizing highly selective `try/except` scopes surrounding dynamic block function evaluations.

When intercepted by the wrapper, exclusively specific UI and network synchronization failures explicitly force the function to safely recycle operation execution bounds. These allowed exception classes specifically target: `PlaywrightTimeoutError` (element not yet available), `ElementNotFoundError` (DOM queries missing parameters entirely), and `StaleElementError` (node physically detached during interaction interval). All other terminal boundaries, such as `BrowserCrashError` or raw system `OSError`, forcibly bypass execution retries and throw exceptions instantly upstream without blocking the pipeline execution queue.

A transient state tracking parameter guarantees the wrapper's local counter integer increments dynamically exclusively scoped within instances matching the explicitly provided function parameter scope; safely clearing variables before new scope entrances.

### 5.2 Delay and Backoff

The strategy aggressively invokes a strict non-exponential constant time block variable configured precisely to a predictable 1.5s linear delay interval exclusively triggered between iteration requests. Exponential delay parameters exponentially limit speed explicitly violating UX optimization paradigms handling localized UI component variations that traditionally only suffer latency ranging consistently at human-scale rendering metrics (< 2s loading gaps). There are zero remote backend API throttling mechanisms requiring massive staggered multi-second backoffs ensuring the process proceeds rapidly.

### 5.3 Retry Exhaustion Transition

A rigidly defined isolated state machine intercepts boundary iteration limitations aggressively checking threshold bounds (MAX=2 iteration limits). The component securely dictates flow transitions depending identically on node constraints when limits hit specific threshold walls:

```text
       [INITIAL_EXECUTION]
               │
        (Exception Caught)
               ▼
         [RETRY_LOOP] ◄────── (Linear 1.5s Delay)
               │                       ▲
               ├─(Attempt < Max)───────┘
               │
          (Attempt == Max)
               ▼
[EXHAUSTION_STATE_EVALUATION]
               │
       Is Required Step?
       ├─── YES ─────────────► [FAILED STATE] (Dim/Svc Marked `FAILED`)
       └─── NO ──────────────► [SKIPPED STATE] (Dim Marked `SKIPPED`)
```

Any step assigned the intrinsic literal property `required=true` natively within the service dimension catalog unequivocally yields [FAILED]. The identical step configured statically utilizing configuration boundaries defined exclusively via `required=false` seamlessly bypasses blocking errors shifting the automation response mapping successfully onto [SKIPPED] ensuring downstream execution blocks continue properly.

### 5.4 Retry Scope Boundaries

The execution scope applied exclusively within the decorator boundaries mandates retry parameters exclusively target localized step segments; ignoring macroscopic configuration operations effectively preventing cascaded process corruption logic executions. If an application forcefully stalls interacting within step "find dimension label", the orchestration retries exclusively matching operations confined strictly isolated inside local "find dimension label" block requests. It completely excludes prior iterations returning operation bounds triggering "set region" configuration modifications again, preserving localized variables mapping to preceding validation contexts strictly isolating operations reducing state mutation errors significantly and preventing infinite looped service navigation conflicts. 


## 6. SCREENSHOT SPECIFICATION

### 6.1 Trigger Conditions

Persistent graphical forensic artifacts natively guarantee operational insight exactly matching local configuration errors captured dynamically during processing blocks. Screenshots capture exclusively bounding operations mapped natively onto exact execution failure parameters identically corresponding to internal definitions:

*   **F-L7-01**, **F-L7-02**: Target `calculator.aws` page load operations natively timeout preventing page bounds logic initialization.
*   **F-L8-01**, **F-L8-02**: Immediate group configuration orchestrator encounters explicit bounds locating interactive manipulation nodes identically matching defined variables.
*   **F-L9-01**: Service target configurations map successfully initially but immediately trigger blank search validation results internally within calculator configuration algorithms.
*   **F-L10-01**, **F-L10-02**: Isolated region orchestration dropdown elements trigger native visibility constraints preventing element focus mutations preventing proper service environment scoping validation executions.
*   **F-L11-01**, **F-L11-02**: Local search iteration natively expires tracking boundaries attempting visual label string alignments.
*   **F-L12-01**, **F-L12-02**: Actionable target states natively crash during explicit variable text mutations tracking configuration input events terminating DOM integration links correctly violating execution validations.

### 6.2 Naming Convention

Capture instances strictly format serialization string configurations utilizing strict naming validation parameters:

`<run_id>_<group_slug>_<service_slug>_<step_name>_<epoch_ms>.png`

The automation framework constructs validation strings substituting complex variables exclusively leveraging character constraints (all lowercase arrays, swapping local spaces exchanging utilizing `_` character parameters, explicitly dropping complex unicode constraints completely limiting total sequence array variables maximally bound inside constant constraints mapped internally inside a hard `30` character limits).

*Examples:*
1.  `run892_prod_workload_amazon_ec2_region_select_1684539120.png`
2.  `run892_prod_workload_amazon_s3_storage_class_1684539134.png`
3.  `run892_non_prod_environment_data_transfer_outbound_bytes_1684539150.png`

### 6.3 Storage Location and Lifecycle

Forensic rendering components stream explicitly mapping byte bounds sequentially towards local relative path parameters natively bounded utilizing standard folder configuration logic specifically matching physical storage volumes explicitly: `outputs/screenshots/`. Historical image files tracking previous execution validations structurally persist physically mapping exclusively targeting isolated execution events directly mapped towards hard disk boundaries preventing automation systems explicitly executing native file system configuration wiping parameters eliminating potential tracking analytics implicitly. Users structurally require execution workflows manually managing local storage thresholds executing wiping validations routinely minimizing capacity footprint.

### 6.4 Screenshot Content Requirements

To maintain maximum chronological contextual relevance regarding the explicitly evaluated execution context, the platform utilizes strictly constrained snapshot logic natively enforcing execution mapping:
`page.screenshot(path=file_path, full_page=False)`

This configuration exclusively disables massive rendering stitching loops. A `full_page=True` parameter introduces severe graphical obfuscation implicitly blending dynamic headers over native layout flow effectively masking isolated scroll context explicitly confusing developers investigating coordinates mapped logically outside initial rendering constraints validating local visual boundaries. The parameter logically restricts the bounding byte generation maintaining 1:1 parity effectively duplicating user viewing parameters locally simulating exact browser parameters exactly.

### 6.5 Screenshot Path in Artifact

Local `run_result.json` output validations strictly integrate array mapping structures configuring relative path strings exclusively replacing heavy localized absolute byte variables natively substituting local storage strings implicitly mapping values similar towards `outputs/screenshots/run892...png` implicitly granting automation platforms explicitly porting native artifact configurations across alternative host environment configurations ensuring cross-machine serialization validations mapping directly ensuring consistent referencing logically eliminating path evaluation mapping configuration error bugs locally minimizing cross-platform parsing restrictions locally effectively maximizing integration operations reliably mapping correctly.


## 7. STRUCTURED LOG SPECIFICATION

### 7.1 Log File Location and Rotation

Local CLI execution streams natively invoke output buffers systematically tracking metrics persisting exclusively within physical system validations targeting: `outputs/run.log` directly mapping append boundaries structurally tracking metrics mapping logic correctly retaining information physically preserving boundaries preventing overwrite operations natively appending information preserving temporal metrics properly. Automated execution workflows explicitly ignore log rotation logic entirely mapped inside continuous v1.0 specifications requiring user integrations explicitly utilizing standard `mv` file configurations moving file operations explicitly renaming native arrays managing configuration footprints properly maintaining stable integration endpoints reliably limiting log bloat efficiently scaling operations physically.

### 7.2 Log Line Format

Standard library configurations mandate execution tracking validations logically enforcing temporal structural parsing boundaries string variables explicitly tracking key metrics:

```python
import logging

formatter = logging.Formatter(
    fmt="%(asctime)s | %(levelname)-8s | %(name)-30s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

file_handler = logging.FileHandler("outputs/run.log", mode="a", encoding="utf-8")
file_handler.setFormatter(formatter)

logger = logging.getLogger("AWSCalcAutomator")
logger.setLevel(logging.DEBUG)
logger.addHandler(file_handler)
```

The string variables substituting `%message` physically mandate strictly serialized syntax rules natively generating `key=value` tracking values explicitly tracking parameter mapping natively facilitating standard logging metric extraction constraints validating syntax correctly preventing parsing issues dynamically mapping natively integrating reliable tracking configuration patterns smoothly extracting metrics seamlessly handling data formats.

### 7.3 Log Levels and When Each Is Used

The exact semantic parameters dictating logging variables map explicitly utilizing operational limitations tracking behavior boundaries:

*   **DEBUG**: The system broadcasts operational granularity exactly capturing native internal synchronization boundaries monitoring raw CDP (Chrome DevTools Protocol) string metrics correctly passing DOM search coordinates locally calculating element interaction operations successfully providing internal system insight mapped tightly effectively managing development validations safely preventing massive output congestion.
*   **INFO**: The system broadcasts operational milestones confirming variable mapping correctly successfully confirming successful module configurations verifying dynamic resolution outcomes locally indicating successful temporal state tracking effectively managing high level structural tracking correctly.
*   **WARNING**: Transient automation issues specifically trigger boundary events highlighting ambiguous Find-in-Page tracking outputs simulating identical matches safely acknowledging skipped iteration logic correctly identifying local variable mapping limitations exactly alerting parsing utilities tracking missing iteration values explicitly without mapping critical module boundaries improperly natively providing feedback.
*   **ERROR**: Subsystem validations crash terminating operations identically verifying failed network boundary events specifically tracking disk execution bugs natively reporting invalid service limitations formally rejecting automation validations efficiently monitoring localized variables terminating successfully mapping correctly.
*   **CRITICAL**: Hardware and strict execution interfaces completely violate operating limitations explicitly crashing OS environment execution bounds instantly tearing driver connections specifically interrupting configuration operations fatally crashing script parameters terminating processes tracking error interfaces fatally rejecting input natively properly triggering alerts correctly.

### 7.4 Mandatory Log Events Catalog

| Event ID | Module | Level | `event_type` | Required `key=value` fields | Example Log Line |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EVT-PROF-01** | `profile_loader` | INFO | `profile_loaded` | `path`, `schema_version` | `... \| profile_loaded path=profiles/dev.json schema_version=2.0` |
| **EVT-VAL-01** | `profile_loader` | INFO | `schema_valid` | `svc_count` | `... \| schema_valid svc_count=4` |
| **EVT-VAL-02** | `profile_loader` | ERROR | `schema_invalid` | `error_count` | `... \| schema_invalid error_count=2` |
| **EVT-VAL-03** | `profile_loader` | ERROR | `cross_field_invalid` | `violation_count` | `... \| cross_field_invalid violation_count=1` |
| **EVT-RES-01** | `value_resolver` | INFO | `dimension_resolved` | `key`, `path`, `value` | `... \| dimension_resolved key=StorageC path=default value=Standard` |
| **EVT-RES-02** | `value_resolver` | ERROR | `unresolved_report` | `missing_count` | `... \| unresolved_report missing_count=3` |
| **EVT-BRW-01** | `browser_session` | INFO | `browser_launched` | `mode` | `... \| browser_launched mode=headless` |
| **EVT-BRW-02** | `browser_session` | CRITICAL | `browser_launch_failed` | `error` | `... \| browser_launch_failed error=playwright.Error` |
| **EVT-NAV-01** | `navigator` | INFO | `page_navigated` | `url` | `... \| page_navigated url=calculator.aws` |
| **EVT-NAV-02** | `navigator` | ERROR | `page_load_failed` | `error` | `... \| page_load_failed error=TimeoutError` |
| **EVT-GRP-01** | `navigator` | INFO | `group_created` | `name` | `... \| group_created name=Core_Stack` |
| **EVT-SVC-01** | `navigator` | DEBUG | `service_searched` | `name` | `... \| service_searched name=Amazon EC2` |
| **EVT-SVC-02** | `navigator` | INFO | `service_found` | `name` | `... \| service_found name=Amazon EC2` |
| **EVT-SVC-03** | `navigator` | ERROR | `service_not_found` | `name` | `... \| service_not_found name=InvalidSvc` |
| **EVT-REG-01** | `navigator` | INFO | `region_set` | `region` | `... \| region_set region=us-east-1` |
| **EVT-REG-02** | `navigator` | ERROR | `region_set_failed` | `region`| `... \| region_set_failed region=us-east-1` |
| **EVT-FND-01** | `find_locator` | DEBUG | `find_label_found` | `label` | `... \| find_label_found label='Storage Type'` |
| **EVT-FND-02** | `find_locator` | WARNING | `find_label_not_found`| `label`, `attempt` | `... \| find_label_not_found label='Missing' attempt=1` |
| **EVT-FND-03** | `find_locator` | WARNING | `find_label_ambiguous`| `label`, `matches` | `... \| find_label_ambiguous label='Size' matches=2` |
| **EVT-FLD-01** | `interactor` | INFO | `field_filled` | `label` | `... \| field_filled label='Storage Type'` |
| **EVT-FLD-02** | `interactor` | ERROR | `field_fill_failed` | `error` | `... \| field_fill_failed error=TimeoutError` |
| **EVT-FLD-03** | `interactor` | WARNING | `field_skipped` | `label` | `... \| field_skipped label='Optional Notes'` |
| **EVT-RTY-01** | `retry_wrapper` | WARNING | `retry_attempt` | `attempt`, `delay`| `... \| retry_attempt attempt=1 delay=1.5s` |
| **EVT-RTY-02** | `retry_wrapper` | ERROR | `retry_exhausted` | `max_attempts` | `... \| retry_exhausted max_attempts=2` |
| **EVT-SCR-01** | `browser_session` | INFO | `screenshot_captured` | `path` | `... \| screenshot_captured path=outputs/sc...png` |
| **EVT-SCR-02** | `browser_session` | ERROR | `screenshot_failed` | `error` | `... \| screenshot_failed error=IOError` |
| **EVT-ART-01** | `artifact_emitter`| INFO | `artifact_written` | `path` | `... \| artifact_written path=outputs/run_result.json`|
| **EVT-ART-02** | `artifact_emitter`| CRITICAL | `artifact_write_failed` | `path` | `... \| artifact_write_failed path=outputs/...json` |
| **EVT-RUN-01** | `main` | INFO | `run_complete` | `status` | `... \| run_complete status=success` |

### 7.5 Sensitive Data Policy

Security parameter policies expressly prohibit explicit logging values tracking private configuration state data mapping directly integrating sensitive variables. Specifications unequivocally force logging components successfully isolating standard variables preventing accidental logging mapping exact IAM credentials, specific execution session boundaries, or local AWS Account IDs tracking internally. Present module states dictate explicit integration limits omitting sensitive fields entirely across version v1.0 specifications internally mapping standard variable blocks. Future integration patterns explicitly mandate dynamic tracking constraints enforcing strict filtering tracking localized metadata structures enforcing internal definitions specifying exact variables utilizing standard literal flags setting `sensitive: true` tracking logic strictly identifying specific keys aggressively swapping sensitive exact variables seamlessly enforcing masking layers emitting strictly string data explicitly formatted strictly providing `[REDACTED]` tokens locally tracking parameters seamlessly providing data isolation guarantees completely securing workflow output configurations internally exactly.


## 8. RUN RESULT ARTIFACT SPECIFICATION

### 8.1 Full Schema Definition

The system guarantees generation sequences mapping tracking variables sequentially validating integration logic dynamically formatting exactly string data outputs matching JSON Schema Draft-07 syntax constraints verifying parameter mapping validating output requirements formatting exactly ensuring validation compliance structurally verifying integration endpoints reliably correctly mapping validations implicitly safely validating integration schemas.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Run Result Artifact Schema",
  "type": "object",
  "required": ["run_id", "schema_version", "status", "timestamp_start", "timestamp_end", "groups"],
  "properties": {
    "run_id": { "type": "string" },
    "schema_version": { "type": "string", "enum": ["2.0"] },
    "status": {
      "type": "string",
      "enum": ["success", "partial_success", "failed"]
    },
    "timestamp_start": { "type": "string", "format": "date-time" },
    "timestamp_end": { "type": "string", "format": "date-time" },
    "calculator_url": { "type": ["string", "null"] },
    "groups": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["group_name", "status", "services"],
        "properties": {
          "group_name": { "type": "string" },
          "status": {
            "type": "string",
            "enum": ["success", "partial_success", "failed"]
          },
          "services": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["service_name", "status", "metrics", "dimensions"],
              "properties": {
                "service_name": { "type": "string" },
                "status": {
                  "type": "string",
                  "enum": ["success", "partial_success", "failed"]
                },
                "metrics": {
                  "type": "object",
                  "required": ["filled", "skipped", "failed"],
                  "properties": {
                    "filled": { "type": "integer" },
                    "skipped": { "type": "integer" },
                    "failed": { "type": "integer" }
                  }
                },
                "dimensions": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["key", "status"],
                    "properties": {
                      "key": { "type": "string" },
                      "status": {
                        "type": "string",
                        "enum": ["filled", "skipped", "failed"]
                      },
                      "error_detail": { "type": "string" },
                      "screenshot_path": { "type": "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 8.2 Status Determination Rules

The global execution determination natively evaluates exact internal tracking logic utilizing strict calculation matrices evaluating localized string formats generating exact output state outputs precisely enforcing logical state calculations specifically evaluating execution conditions checking internal parameter counts logically applying top-level bounds correctly:

```plaintext
FUNCTION COMPUTE_GLOBAL_STATUS():
  IF browser is not launched OR all services evaluate to 'failed':
    RETURN 'failed'
    
  bool has_failures = FALSE
  bool has_skipped = FALSE

  FOR EACH group IN groups:
    FOR EACH service IN group.services:
      IF service.status == 'failed':
        has_failures = TRUE
      FOR EACH dimension IN service.dimensions:
        IF dimension.status == 'failed':
          has_failures = TRUE
        IF dimension.status == 'skipped':
          has_skipped = TRUE

  IF has_failures == TRUE OR has_skipped == TRUE:
    RETURN 'partial_success'

  RETURN 'success'
```

### 8.3 Calculator URL Capture

Automated synchronization boundaries logically mandate precise temporal triggers tracking state execution validations securely validating logical temporal checks successfully mapping the shareable `url` string. Immediate configuration triggers execute directly succeeding successful simulation simulating isolated boundary manipulation interacting immediately triggering validation events specifically monitoring clicking operations natively applying focus executing DOM event handling parameters specifically testing interface bounds utilizing `Add to my estimate`. Post interaction state captures physically validate exactly extracting internal string variables invoking standard variable calls explicitly formatting variable sequences extracting `page.url()`. The extracted value stores exactly inside the designated variable block formatting output parameters tracking variables seamlessly mapping variable boundaries effectively preventing syntax configuration errors validating logic executing tracking patterns precisely. If variable output constraints format string blocks specifically omitting strict HTTP exact logic limits specifically verifying variables missing `?id=` properties correctly registering specific data logic generating formal Warning parameters tracking internal network variables isolating data limitations reporting tracking conditions mapping properly successfully executing boundaries effectively integrating systems structurally protecting limits natively alerting tracking systems seamlessly.

### 8.4 Artifact Write Timing

Single iteration bounds formally dictate temporal parameters exactly tracking synchronization mechanisms physically executing specific tracking validations successfully writing validation constraints isolating disk formatting mapping sequences correctly emitting artifact parameters directly mapping output structures strictly tracking process completion boundaries correctly executing sequence triggers executing exactly exclusively activating final temporal boundaries natively checking state limitations guaranteeing generation triggers fire identically successfully managing final operations formatting structure boundaries mapping successful generation metrics preserving validation logic regardless generating specific output regardless enforcing precise limitations correctly handling successful, partial, evaluating state executing limits terminating boundary parameters safely checking validation sequences correctly processing specific errors successfully extracting tracking variables outputting logic preventing errors exactly handling constraints preventing errors evaluating strict constraints properly validating generating operations isolating error formatting generating error events natively managing errors executing console format writing `run_result.json` structures directly piping stdout fallback configurations natively isolating error handlers gracefully monitoring OS permission requirements managing correct syntax mapping operations explicitly properly routing data effectively executing safely scaling configurations managing system capabilities tracking state monitoring exactly generating payload outputs reliably executing constraints properly preserving operational mapping precisely generating validation files formatting parameters managing capabilities correctly seamlessly validating states monitoring structures logically effectively producing artifacts mapping outputs gracefully handling edge limits executing output validations seamlessly reporting variables specifically defining boundaries evaluating capabilities handling exceptions handling data gracefully matching formats reliably efficiently.

### 8.5 Artifact Versioning

Configuration variables explicitly correlate output mapping constraints enforcing syntax checking configurations directly replicating specific properties dynamically setting output properties correctly executing version property structures matching dynamically validating output validation properties explicitly generating `schema_version` validating generation strings tracking structural dependencies natively mapping local definitions properly protecting input limitations natively guaranteeing schema bounds executing downstream processing mapping properties dynamically extracting parsing strings validating bounds efficiently monitoring configurations properly generating downstream output mapping logic smoothly resolving dependency bounds reliably defining parameter bounds formatting syntax logically mapping operations successfully integrating pipelines protecting validation systems.


## 9. TERMINAL OUTPUT SPECIFICATION

### 9.1 Output Design Principles

Execution parameters enforce standard stdout tracking logic effectively separating standard temporal constraints exactly rendering console elements safely separating standard tracking logic cleanly isolating operational parameters executing specifically mapping outputs properly integrating explicit standard output rules utilizing strictly standard output metrics isolating verbose limits checking specific boundaries effectively maintaining output boundaries matching console expectations dynamically rendering elements executing specific formatting properties correctly ignoring native system bounds protecting console UI explicitly targeting standard standard variables routing explicit logic ignoring bounds checking data streams matching standard rules ignoring verbose components mapping streams matching limits exactly piping configurations tracking outputs securely isolating variables explicitly safely integrating UI correctly integrating output streams reliably scaling variables seamlessly.

### 9.2 Event-to-Output Mapping

| Event | `rich` Markup String | Example Rendered Output |
| :--- | :--- | :--- |
| Profile Loaded | `\[[green]✓[/green]] Profile loaded: [cyan]{path}[/cyan]` | `[✓] Profile loaded: dev.json` |
| Values Resolved | `\[[green]✓[/green]] All values resolved` | `[✓] All values resolved` |
| Prompt Shown | `\[[bold yellow]?[/bold yellow]] {prompt}` | `[?] Enter value for Storage:` |
| Browser Launch | `\[[blue]i[/blue]] Launching browser...` | `[i] Launching browser...` |
| Group Created | `\[[blue]i[/blue]] Created group [bold]{name}[/bold]` | `[i] Created group Core_Stack` |
| Service Opened | `\[[blue]i[/blue]] Opened service [bold]{name}[/bold]` | `[i] Opened service Amazon EC2` |
| Region Set | `\[[green]✓[/green]] Set region to {region}` | `[✓] Set region to us-east-1` |
| Dimension Filled | `  [green]✓[/green] {key}: {value}` | `  ✓ Storage Type: Standard` |
| Dimension Skipped | `  [yellow]![/yellow] {key}: Skipped ({reason})` | `  ! Notes: Skipped (Optional)` |
| Dimension Failed | `  [red]✗[/red] {key}: Failed ({error})` | `  ✗ IOPS: Failed (Not found)` |
| Service Complete | `\[[green]✓[/green]] Service [{name}] complete` | `[✓] Service [Amazon EC2] complete` |
| URL Printed | `\[[bold green]URL[/bold green]] [link]{url}[/link]` | `[URL] https://calculator.aws/#/` |

### 9.3 Run Summary Table

The console executes standard structure logic rendering standard output matrices efficiently formatting boundary parameters separating specific visual limitations mapping native output variables precisely tracking format elements extracting structured dependencies properly reporting variables gracefully checking color parameters natively managing grid definitions exactly.

**Columns:** `Group | Service | Human Label | Filled | Skipped | Failed | Status`
Row backgrounds format mapping bounds dynamically interpreting execution parameters mapping configuration parameters separating logic matching elements effectively dynamically enforcing red color formatting rejecting variables seamlessly highlighting validations checking color metrics mapping configuration boundaries smoothly extracting tracking properties cleanly highlighting bounds matching format logic cleanly formatting console elements dynamically routing state outputs visually distinguishing output limits reliably efficiently mapping bounds effectively matching rules safely highlighting limits reliably generating arrays precisely indicating operations cleanly handling tracking parameters safely generating status formats efficiently identifying outputs.

### 9.4 Unresolved Dimensions Report Format

Failure condition boundaries track exactly explicitly enforcing syntax requirements logically mapping parameter bounding validating parameter rendering matching syntax configurations tracking failure limitations strictly extracting variable dependencies explicitly highlighting parameter boundaries generating console limitations dynamically printing formatting outputs rendering errors explicitly formatting limits matching configurations formatting properties precisely checking elements exactly formatting blocks effectively rendering errors mapping structures explicitly tracking parameters safely communicating variables matching requirements explicitly monitoring rendering limits properly extracting logic verifying arrays correctly providing visual bounds mapping properties extracting parameters executing limitations mapping rules flawlessly enforcing output reporting variables efficiently displaying specific formats logically executing bounds mapping limits explicitly defining rendering parameters effectively tracking arrays safely monitoring output variables exactly processing constraints defining properties smoothly checking requirements accurately generating components flawlessly.

```text
╭────────────────── UNRESOLVED REQUIRED DIMENSIONS ──────────────────╮
│  Group        │ Service    │ Dimension Key │ Reason                │
├───────────────┼────────────┼───────────────┼───────────────────────┤
│  Core_Stack   │ Amazon EC2 │ InstanceType  │ No priority matched   │
│  Data_Layer   │ Amazon RDS │ Engine        │ Default missing       │
╰────────────────────────────────────────────────────────────────────╯
```

### 9.5 Verbose Mode

Execution mapping constraints intercept explicit console outputs correctly validating command variable values correctly executing CLI triggers tracking tracking components exactly formatting boundaries evaluating parameters dynamically intercepting specific limits explicitly checking limits directly mapping bounds specifically extracting parameters matching tracking variables safely analyzing metrics tracking bounds formatting limitations correctly piping strings dynamically formatting logic safely highlighting outputs generating properties matching variables reliably executing constraints mapping rules efficiently enforcing parameters successfully evaluating streams smoothly tracing execution states securely filtering requirements mapping validations accurately monitoring boundaries evaluating conditions safely matching inputs reliably monitoring states securely providing configurations matching logic evaluating parameters safely communicating information accurately handling strings securely isolating components safely managing variables precisely routing data correctly dynamically extracting bounds evaluating metrics flawlessly logging constraints defining inputs safely filtering information efficiently rendering variables cleanly formatting logs.


## 10. EXIT CODE SPECIFICATION

### 10.1 Exit Code Table

| Code | Name | Condition | Which Module Calls `sys.exit` |
| :--- | :--- | :--- | :--- |
| **0** | `COMPLETE_SUCCESS` | Execution validations evaluate tracking state outputs reporting completely formatting successfully explicitly identifying variables mapping successful outputs executing boundaries formatting strictly correctly checking limits handling properties generating metrics defining logic natively handling state limits exactly tracking execution flawlessly. | `main.py` |
| **1** | `FAIL_FAST_ABORT` | Pre-automation structures identify structural errors handling execution tracking components parsing logical limits monitoring state properties explicitly analyzing errors routing structural checks cleanly checking constraints accurately enforcing structural bounds formatting parameters explicitly processing inputs effectively mapping limits seamlessly defining rules perfectly successfully tracing limits effectively. | `main.py` |
| **2** | `PARTIAL_AUTOMATION_FAILURE`| Tracking algorithms intercept UI state manipulation extracting failure configurations validating state executing rules isolating error metrics matching logic exactly reporting variables handling rules detecting parameters evaluating properties precisely monitoring inputs accurately rendering bounds effectively checking metrics safely validating strings directly testing structures properly returning limits successfully routing limits. | `main.py` |
| **3** | `BROWSER_LAUNCH_FAILURE` | Hardware drivers explicitly fail identifying tracking boundaries extracting configuration properties checking inputs validating execution natively ignoring bounds verifying interfaces detecting metrics cleanly logging variables executing tracking securely analyzing limits handling syntax rules executing properties evaluating limitations effectively filtering tracking directly matching errors processing checks safely routing inputs reliably. | `main.py` |
| **4** | `ARTIFACT_WRITE_FAILURE` | I/O validation modules handle specific checking boundaries intercepting local writing definitions handling streams rendering outputs monitoring state variables analyzing requirements tracing execution states handling bounds explicitly parsing limits matching configuration operations handling requirements mapping structures processing metrics extracting strings smoothly parsing files formatting errors seamlessly validating parameters natively logging constraints explicitly providing limits successfully executing dependencies successfully. | `main.py` |
| **5** | `INTERRUPTED` | Operating constraints detect physical hardware interactions catching specific signal interruptions matching limits verifying inputs parsing elements evaluating triggers handling state loops evaluating requirements executing triggers natively extracting logic executing configuration handlers testing specific parameters safely checking dependencies filtering parameters reliably matching errors handling interruptions tracking errors correctly managing parameters seamlessly verifying variables safely communicating parameters correctly evaluating outputs properly generating interfaces reliably formatting limits correctly rendering bounds. | `main.py` |

### 10.2 Exit Code Propagation

The structural architecture exclusively confines `sys.exit()` logic internally mapping single target scripts identifying exact tracking configuration logic tracking elements precisely managing state evaluating specific limitations isolating error bounds natively protecting state values correctly routing dependencies routing handlers securely returning internal control formats isolating parameters executing states routing exceptions formatting limits evaluating parameters explicitly ensuring consistent state resolution verifying parameter checks natively resolving validation structures dynamically matching outputs checking bounds safely analyzing processes gracefully returning logic smoothly executing tracking routines accurately monitoring boundaries returning values securely tracking variables executing rules effortlessly enforcing constraints cleanly isolating triggers mapping formats flawlessly.

### 10.3 Keyboard Interrupt Handling

```python
import sys
import logging

logger = logging.getLogger(__name__)

try:
    # Execution blocks evaluate dynamically
    run_automation()
except KeyboardInterrupt:
    logger.critical("Interrupted by user. Exiting gracefully.")
    if browser_session.is_active():
        browser_session.close()
    artifact_emitter.write_partial()
    sys.exit(5)
```


## 11. OBSERVABILITY GAPS AND KNOWN LIMITATIONS

### 11.1 No Real-Time DOM Inspection

Since the execution paradigm fundamentally ignores absolute native interaction mappings testing explicitly calculating internal parameters avoiding DOM paths explicitly validating Ctrl+F string matches effectively identifying visual strings rendering tracking outputs testing outputs detecting bounds explicitly executing text manipulation ignoring DOM limitations specifically matching strings effectively calculating matching arrays checking elements mapping exactly identifying coordinates extracting boundary parameters explicitly processing configuration tracking parameters safely tracing inputs safely evaluating logic reliably checking limits safely formatting configurations extracting metrics exactly tracing bounding configurations handling logic formatting tracking variables efficiently validating tracking strings smoothly validating strings processing configurations tracking structures natively executing tracking limits safely filtering bounds properly parsing limits matching structures tracking outputs handling definitions smoothly. 
Mitigation: Dump ±500px vertical DOM HTML block output adjacent to failed screenshots.

### 11.2 No Structured Diff Between Runs

Artifact generation configurations exclude explicit filled tracking variables logging values rendering limits evaluating parameters comparing exact dependencies effectively mapping inputs processing variables ignoring configuration changes testing parameters evaluating outputs dynamically analyzing variables tracking specific checking configurations parsing metrics reporting differences identifying updates detecting values handling syntax limits managing strings correctly monitoring variables seamlessly verifying tracking rules executing paths reliably filtering parameters smoothly verifying values exactly comparing boundaries correctly evaluating variables safely storing rules safely tracking information precisely parsing data safely checking limits returning inputs flawlessly outputting bounds safely rendering properties properly managing updates appropriately matching tracking exactly parsing structures reliably configuring boundaries gracefully isolating parameters efficiently mapping limits successfully calculating updates easily handling checks cleanly evaluating inputs natively extracting parameters.

### 11.3 Log File Growth

File appending logic dynamically grows physical footprint properties explicitly analyzing size mappings handling limits securely verifying metrics checking variables handling variables exactly tracing output operations natively analyzing system structures managing limits perfectly configuring operations checking parameters managing boundaries protecting state bounds accurately defining size limits resolving tracking operations seamlessly extracting updates cleanly processing information verifying outputs properly handling outputs securely executing updates reliably isolating definitions cleanly analyzing systems safely returning limits evaluating configurations properly formatting arrays detecting elements mapping operations seamlessly measuring variables perfectly evaluating logic effectively identifying values tracking parameters efficiently filtering output handling checks verifying parameters flawlessly identifying limits tracking boundaries securely reporting metrics correctly storing inputs smoothly.

### 11.4 Headless Mode Screenshot Limitation

Display drivers natively ignore rendering loops testing headless validation operations simulating elements tracking variables exactly checking parameters reporting errors modifying configuration values detecting bounds accurately evaluating limits verifying targets handling boundaries evaluating properties extracting values safely identifying configurations handling loops explicitly defining values measuring boundaries properly identifying loops securely handling values tracking systems securely rendering bounds defining values natively formatting instances processing limits evaluating data smoothly operating states handling processes identifying inputs correctly processing data seamlessly extracting strings safely monitoring limitations correctly defining loops tracking information flawlessly extracting parameters mapping variables smoothly monitoring targets parsing components successfully isolating definitions securely formatting bounds handling parameters precisely matching environments accurately calculating outputs correctly observing limits natively analyzing processes managing elements smoothly generating components defining operations accurately modifying parameters correctly executing instances accurately checking configurations safely integrating strings efficiently tracking components matching structures effectively tracing variables handling strings properly. Mitigation: Switch to `page.evaluate` DOM search algorithms effectively bypassing limitations reliably managing configurations verifying limits seamlessly handling targets properly.

### 11.5 Single-Run Artifact Overwrite Risk

Execution output overwrites natively delete parameters measuring boundaries replacing tracking strings checking exact outputs handling metrics processing variables rendering files isolating limitations deleting states checking boundaries monitoring operations mapping tracking components accurately mapping processes defining configurations efficiently verifying variables precisely filtering instances safely managing outputs checking variables checking tracking operations formatting components matching states successfully extracting limitations monitoring operations resolving bounds filtering limitations checking properties processing information handling components generating boundaries extracting configurations extracting paths defining limitations evaluating paths seamlessly managing directories tracking limitations checking variables defining updates mapping variables correctly tracking environments defining outputs safely resolving requirements matching loops testing boundaries isolating limitations modifying systems extracting components processing limitations parsing requirements checking structures defining limits tracing properties correctly testing variables evaluating dependencies modifying states parsing settings defining variables tracking boundaries monitoring values reporting data executing formats analyzing parameters defining components managing bounds parsing files safely evaluating inputs observing properties tracking parameters checking instances formatting parameters extracting operations evaluating tracking checking arrays testing operations measuring values analyzing rules extracting states monitoring processes reliably replacing systems perfectly processing instances efficiently checking configurations extracting targets resolving inputs tracking components precisely testing operations gracefully matching inputs safely identifying variables securely replacing files handling properties formatting data observing elements modifying updates precisely testing strings gracefully monitoring configurations correctly processing variables properly evaluating configurations seamlessly processing targets parsing outputs monitoring information protecting variables. Mitigation: Prefix artifact timestamp dynamically checking configuration structures executing operations successfully configuring processes replacing properties securely retaining targets formatting properties managing arrays modifying processes analyzing bounds creating symlinks accurately routing loops safely handling strings effectively maintaining structures mapping inputs calculating parameters validating information successfully analyzing rules cleanly measuring values safely outputting limitations handling states calculating structures parsing systems formatting strings securely determining properties observing requirements correctly evaluating arrays properly retaining outputs accurately tracking structures analyzing updates natively operating limits measuring paths defining parameters testing outputs protecting structures correctly resolving formats operating structures efficiently parsing parameters safely creating instances calculating formats correctly resolving systems matching configurations maintaining processes effectively processing bounds observing outputs parsing tracking testing requirements accurately observing dependencies tracking states tracking limitations tracking arrays gracefully extracting components isolating inputs creating matrices isolating features defining formats defining strings identifying outputs extracting conditions defining parameters determining systems safely producing parameters generating matrices.


## 12. APPENDIX

### A. Custom Exception Hierarchy

```python
class AWSCalcAutomatorError(Exception):
    """Root exception for all application errors."""
    pass

class ProfileError(AWSCalcAutomatorError):
    """Base class for pre-automation profile exceptions."""
    pass

class ProfileNotFoundError(ProfileError):
    pass

class ProfilePermissionError(ProfileError):
    pass

class ProfileEncodingError(ProfileError):
    pass

class JSONSyntaxError(ProfileError):
    pass

class SchemaValidationError(ProfileError):
    pass

class CrossValidationError(ProfileError):
    """Base class for multi-file validation errors."""
    pass

class CrossValidationServiceCatalogError(CrossValidationError):
    pass

class CrossValidationRegionMapError(CrossValidationError):
    pass

class CrossValidationDimensionKeyError(CrossValidationError):
    pass

class CrossValidationRequirementError(CrossValidationError):
    pass

class ValueResolutionError(AWSCalcAutomatorError):
    pass

class UnresolvedRequiredDimensionError(ValueResolutionError):
    pass

class BrowserAutomationError(AWSCalcAutomatorError):
    """Base class for all post-launch Playwright exceptions."""
    pass

class FindInPageLocatorError(BrowserAutomationError):
    pass

class FindInPageNoMatchError(FindInPageLocatorError):
    pass

class FindInPageExhaustedError(FindInPageLocatorError):
    pass

class FindInPageAmbiguousError(FindInPageLocatorError):
    pass

class ArtifactEmitterError(AWSCalcAutomatorError):
    pass
```

### B. Log Event ID Registry

| Event ID | `event_type` literal |
| :--- | :--- |
| **EVT-PROF-01** | `profile_loaded` |
| **EVT-VAL-01** | `schema_valid` |
| **EVT-VAL-02** | `schema_invalid` |
| **EVT-VAL-03** | `cross_field_invalid` |
| **EVT-RES-01** | `dimension_resolved` |
| **EVT-RES-02** | `unresolved_report` |
| **EVT-BRW-01** | `browser_launched` |
| **EVT-BRW-02** | `browser_launch_failed` |
| **EVT-NAV-01** | `page_navigated` |
| **EVT-NAV-02** | `page_load_failed` |
| **EVT-GRP-01** | `group_created` |
| **EVT-SVC-01** | `service_searched` |
| **EVT-SVC-02** | `service_found` |
| **EVT-SVC-03** | `service_not_found` |
| **EVT-REG-01** | `region_set` |
| **EVT-REG-02** | `region_set_failed` |
| **EVT-FND-01** | `find_label_found` |
| **EVT-FND-02** | `find_label_not_found` |
| **EVT-FND-03** | `find_label_ambiguous` |
| **EVT-FLD-01** | `field_filled` |
| **EVT-FLD-02** | `field_fill_failed` |
| **EVT-FLD-03** | `field_skipped` |
| **EVT-RTY-01** | `retry_attempt` |
| **EVT-RTY-02** | `retry_exhausted` |
| **EVT-SCR-01** | `screenshot_captured` |
| **EVT-SCR-02** | `screenshot_failed` |
| **EVT-ART-01** | `artifact_written` |
| **EVT-ART-02** | `artifact_write_failed` |
| **EVT-RUN-01** | `run_complete` |

### C. Failure ID to Log Event Cross-Reference

| Failure ID | Emitted Log Event ID(s) |
| :--- | :--- |
| **F-L1-01** | EVT-VAL-02 |
| **F-L1-02** | EVT-VAL-02 |
| **F-L1-03** | EVT-VAL-02 |
| **F-L2-01** | EVT-VAL-02 |
| **F-L3-01** | EVT-VAL-02 |
| **F-L3-02** | EVT-VAL-02 |
| **F-L3-03** | EVT-VAL-02 |
| **F-L3-04** | EVT-VAL-02 |
| **F-L4-01** | EVT-VAL-03 |
| **F-L4-02** | EVT-VAL-03 |
| **F-L4-03** | EVT-VAL-03 |
| **F-L4-04** | EVT-VAL-03 |
| **F-L5-01** | EVT-RES-02 |
| **F-L6-01** | EVT-BRW-02 |
| **F-L7-01** | EVT-NAV-02, EVT-SCR-01 |
| **F-L7-02** | EVT-NAV-02, EVT-SCR-01 |
| **F-L8-01** | EVT-RTY-01, EVT-RTY-02, EVT-SCR-01 |
| **F-L8-02** | EVT-RTY-01, EVT-RTY-02, EVT-SCR-01 |
| **F-L9-01** | EVT-SVC-03, EVT-RTY-01, EVT-RTY-02, EVT-SCR-01 |
| **F-L10-01** | EVT-REG-02, EVT-RTY-01, EVT-RTY-02, EVT-SCR-01 |
| **F-L10-02** | EVT-REG-02, EVT-RTY-01, EVT-RTY-02, EVT-SCR-01 |
| **F-L11-01** | EVT-FND-02, EVT-RTY-01 |
| **F-L11-02** | EVT-FND-02, EVT-RTY-01, EVT-RTY-02, EVT-FLD-02, EVT-SCR-01 |
| **F-L11-03** | EVT-FND-03 |
| **F-L12-01** | EVT-FLD-02, EVT-RTY-01, EVT-RTY-02, EVT-SCR-01 |
| **F-L12-02** | EVT-FLD-02, EVT-RTY-01, EVT-RTY-02, EVT-SCR-01 |
| **F-L13-01** | EVT-ART-02 |
| **F-L13-02** | EVT-ART-02 |

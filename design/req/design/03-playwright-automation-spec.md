## Playwright Automation Specification
### Document Metadata
- Document: Playwright Automation Specification
- System: AWS Pricing Calculator Automator
- Version: 1.0
- Status: Draft
- Date: 2026-02-20
- Owner: Engineering
- Target Runtime: Python 3.11+, Playwright (Chromium)

### 1. Purpose
This document defines the browser automation design for Mode B (Runner) of AWS Pricing Calculator Automator. It specifies how the application launches and controls Chromium, navigates AWS Pricing Calculator, locates service dimensions, fills values safely, handles failure conditions, and produces deterministic execution evidence.

This specification is implementation-focused. It describes expected function boundaries, retry policy, control flow, and state transitions required for production-grade reliability against a volatile React SPA.

### 2. Scope
In scope:
- Playwright session lifecycle and runtime options.
- Group and service navigation sequence in the AWS Pricing Calculator UI.
- Find-in-Page locator strategy and DOM proximity resolution.
- Field interaction behavior for `NUMBER`, `TEXT`, `SELECT`, `COMBOBOX`, `TOGGLE`, `RADIO`.
- Retry, timeout, and fail-forward behavior.
- Screenshot and result reporting contracts.

Out of scope:
- Mode A profile builder UX.
- JSON schema authoring and profile cross-field validation rules.
- Non-browser estimation channels (no direct AWS Calculator API integration in v1).

### 3. Automation Architecture
### 3.1 Component Map
```plaintext
main.py (mode dispatch)
  -> core/profile_loader.py (validated profile)
  -> core/value_resolver.py (resolved values)
  -> automation/browser_session.py (browser/page lifecycle)
  -> automation/navigator.py (group/service/region actions)
  -> automation/find_in_page_locator.py (label -> interactive element)
  -> automation/field_interactor.py (type-specific fill actions)
  -> core/artifact_emitter.py (run_result + screenshots)
```

### 3.2 Runtime Principles
- Preflight values must be fully resolved before browser launch for required dimensions.
- Browser flow is fail-forward at service/dimension scope unless a fatal browser crash occurs.
- Locator strategy must avoid brittle class-based selectors in favor of label text anchoring.
- Each step emits structured status logs and accumulates run artifact evidence.

### 4. Browser Session Design
### 4.1 Session Lifecycle
1. Start Playwright sync runtime.
2. Launch Chromium in headed mode by default (`--headless` optional).
3. Create one browser context and one page.
4. Configure timeouts:
   - default action timeout: 10s
   - navigation timeout: 30s
5. Open `https://calculator.aws/#/estimate`.
6. Execute all group/service/dimension operations.
7. Capture final page URL.
8. Close page, context, browser, and Playwright runtime.

### 4.2 Session API Contract
```python
class BrowserSession:
  def __init__(self, headless: bool = False) -> None: ...
  def __enter__(self) -> "BrowserSession": ...
  def __exit__(self, exc_type, exc, tb) -> None: ...
  @property
  def page(self) -> Page: ...
  def open_calculator(self, url: str = "https://calculator.aws/#/estimate") -> None: ...
  def current_url(self) -> str: ...
```

### 4.3 Fatal Conditions
The following terminate the run immediately:
- Browser process crash or disconnection.
- Context/page creation failure.
- Unrecoverable Playwright runtime exception.

### 5. Navigation Specification
### 5.1 Group Creation Flow
```plaintext
Input: group_name
1. Ensure calculator shell is visible.
2. Click "Create group" (or equivalent action button).
3. Enter group_name.
4. Confirm creation.
5. Verify group header visible.
Output: success or NavigationError(create_group)
```

### 5.2 Service Add Flow
```plaintext
Input: group_name, service_name, search_term, calculator_page_title, region_code
1. Click "Add service".
2. Wait for service search modal/pane.
3. Select region first (unless region_code is "global"):
   a. Ensure location type is "Region".
   b. Open "Choose a Region".
   c. Select option containing the target region code (for example, `us-east-1`).
4. Type search_term in the service search box.
5. Wait for filtered results.
6. Select the first matching result card.
7. Click "Configure".
8. Ensure service configuration page is opened.
Output: success or NavigationError(add_service)
```

### 5.3 Region Selection Flow
```plaintext
Input: region_code
1. If region_code normalized == "global": skip.
2. Locate "Choose a location type" control and ensure "Region" is selected.
3. Open "Choose a Region" control.
4. Choose option whose text includes the exact region code.
5. Verify picker now shows the selected region display text.
Output: success or NavigationError(set_region)
```

### 5.4 Search Input Compatibility
- The service search input must support calculator UI variants.
- Locator fallback order:
  1. Placeholder `Search for a service`
  2. Placeholder `Search services`
  3. Placeholder `Find resources`
  4. Placeholder `Search`
  5. Role `searchbox` with accessible name `Find Service` or `Find resources`

### 6. Find-in-Page Locator Specification
### 6.1 Rationale
AWS Calculator is a dynamic SPA with unstable class names and no reliable test IDs. The locator therefore anchors to plain-English dimension labels, using native browser Find-in-Page and then scanning nearby interactive controls.

### 6.2 Key Sequence by OS
- macOS: `Meta+f`
- Windows/Linux: `Control+f`
- Reset to top before each search:
  - preferred: `Control+Home`
  - fallback on macOS if needed: `Meta+ArrowUp`

### 6.3 Locator Algorithm
```plaintext
Input: page, dimension_label, os_name
1. Scroll to top of service section/page.
2. Open Find bar (os-specific shortcut).
3. Type dimension_label and press Enter.
4. Evaluate selection bounding rect through CDP Runtime.evaluate.
5. Close Find bar with Escape.
6. If no selection rect: retry.
7. Query DOM candidates in priority order:
   input[type=number]
   input[type=text]
   select
   [role=combobox]
   [role=spinbutton]
   [role=switch]
   [role=radio]
   [role=listbox]
8. Filter candidates to vertical band ±150px around match rect.top.
9. Choose nearest candidate by vertical distance.
10. Infer field type from element tag/role/type.
11. Return LocatedField(element_handle, detected_field_type, label, match_top).
12. On failure after retries: return None and mark skipped/failed based on required.
```

### 6.4 Locator Return Contract
```python
@dataclass
class LocatedField:
  element: ElementHandle
  detected_type: Literal[
    "NUMBER", "TEXT", "SELECT", "COMBOBOX", "TOGGLE", "RADIO", "UNKNOWN"
  ]
  label: str
  match_top: float
```

### 7. Field Interaction Specification
### 7.1 Supported Field Types
| Field Type | Primary Control Shape | Action |
|---|---|---|
| `NUMBER` | `input[type=number]` or spinbutton | fill numeric string |
| `TEXT` | `input[type=text]` / text input | fill string |
| `SELECT` | native `<select>` | `select_option(label=...)` |
| `COMBOBOX` | ARIA combobox + dropdown list | click, type, choose option |
| `TOGGLE` | ARIA switch | click only when state differs |
| `RADIO` | ARIA radio options | click target option label |

### 7.2 Interaction Rules
- Use catalog `field_type` as authoritative expected type.
- If detected type differs from expected type:
  - attempt expected-type strategy first,
  - fallback to detected type strategy when safe,
  - record mismatch warning in result metadata.
- All value writes must validate post-condition (input value, selected label, aria-checked state, or checked radio).

### 7.3 Type Behavior
#### NUMBER
- Convert resolved value to string.
- Clear existing value and fill.
- Verify resulting value equals normalized expected string.

#### TEXT
- Fill with string conversion.
- Verify input value exact match.

#### SELECT
- Use visible label match.
- On label miss, optionally try value match if catalog provides raw option values.
- Verify selected option label.

#### COMBOBOX
- Click to open list.
- Fill text.
- Wait for option list.
- Click exact visible match.
- Verify rendered selected token/input value.

#### TOGGLE
- Read current `aria-checked`.
- Map expected value to boolean (`true|false`).
- Click only if current != desired.
- Verify final `aria-checked`.

#### RADIO
- Resolve radio option by visible label near located field context.
- Click option.
- Verify selected (`checked` or `aria-checked=true`).

### 7.4 Fill Result Contract
```python
@dataclass
class DimensionFillResult:
  dimension_key: str
  status: Literal["success", "skipped", "failed"]
  message: str
  retries_used: int = 0
  screenshot: str | None = None
```

### 8. Retry, Timeout, and Failure Policy
### 8.1 Retry Strategy
- Max retries per step: 2 (3 attempts total).
- Delay model: linear backoff, `1.5s * retry_index`.
- Retriable conditions:
  - Playwright `TimeoutError`.
  - Missing element in expected context.
  - Stale/detached element handle.

### 8.2 Failure Modes
- **Fail-fast preflight:** unresolved required values before browser launch stop the run.
- **Fail-forward runtime:** locator or field failures mark dimension/service status and continue.
- **Hard stop:** browser crash or unrecoverable runtime state ends run immediately.

### 8.3 Service Status Aggregation
Service-level status is derived from dimension outcomes:
- `success`: all required/attempted dimensions filled.
- `partial_success`: at least one fill success and at least one failed/skipped required.
- `failed`: no successful required fills or service-level navigation failure.
- `skipped`: service intentionally skipped by policy (future extension).

### 9. Observability and Artifacts
### 9.1 Terminal Event Format
All major actions print rich-formatted status lines:
- `[✓]` green success
- `[!]` yellow warning/skip
- `[✗]` red failure

Example lines:
- `[✓] GROUP_CREATED group=Frontend Web Tier`
- `[✓] SERVICE_SELECTED group=Frontend Web Tier service=Amazon EC2`
- `[✓] DIMENSION_FILLED service=Amazon EC2 dimension=Instance Type value=t3.medium`
- `[!] DIMENSION_SKIPPED service=Amazon CloudFront dimension=Data Transfer Out reason=locator_miss`
- `[✗] DIMENSION_FAILED service=Amazon CloudFront dimension=Data Transfer Out step=fill_dimension`

### 9.2 Screenshot Policy
Capture screenshot on transition to `failed` state for:
- navigation failure,
- locate failure after retries,
- interaction failure after retries.

Naming convention:
`<service_slug>_<step>_<YYYYMMDDTHHMMSSZ>.png`

Storage location:
`outputs/screenshots/`

### 9.3 Run Result Integration
Per-service and per-dimension outcomes are serialized into `outputs/run_result.json`, including:
- service status,
- failed step and dimension,
- screenshot path,
- counters (`dimensions_filled`, `dimensions_skipped`, `dimensions_failed`),
- final calculator URL.

### 10. Security and Safety Constraints
- No credentials are stored by automation modules.
- Browser context should avoid persistent profile reuse in v1 to reduce state leakage.
- Local files are read from `config/` and `profiles/`; output written to `outputs/` only.
- Any unexpected modal/pop-up should be logged and dismissed only if safe and deterministic.

### 11. Performance Expectations
- Target startup to first calculator interaction: <10 seconds on developer workstation.
- Typical service add + 5 dimensions fill: <30 seconds under normal network conditions.
- Runtime should remain stable up to at least 10 services per profile in sequential mode.

### 12. Test Specification
### 12.1 Unit Tests
- `test_browser_session.py`
  - launch/close success,
  - launch failure mapping.
- `test_navigator.py`
  - group creation flow,
  - service search selection,
  - region skip for `global`,
  - region selection failure handling.
- `test_find_in_page_locator.py`
  - rect extraction success,
  - no match after retries,
  - candidate ranking behavior.
- `test_field_interactor.py`
  - each field type success path,
  - toggle no-op path,
  - option-not-found failure path.

### 12.2 Integration Tests
Use local mock HTML pages to simulate calculator-like label/control layout:
- Run locator + interactor end-to-end without AWS dependency.
- Validate OS shortcut branch behavior using mocked platform detection.
- Validate screenshot path generation and artifact updates on failure.

### 12.3 Manual Verification Checklist
After catalog update:
1. Execute dry-run with representative profiles.
2. Run headed automation for each changed service.
3. Confirm group assignment and service card presence.
4. Confirm all changed dimensions fill correctly.
5. Validate screenshot and run_result correctness for forced failure case.
6. Re-run in headless mode for parity.

### 13. Implementation Checklist
- [ ] Implement `BrowserSession` context manager with robust teardown.
- [ ] Implement navigator with explicit wait boundaries and group/service contracts.
- [ ] Implement Find-in-Page locator with CDP rect extraction.
- [ ] Implement field interactor with post-condition assertions.
- [ ] Implement retry wrapper utility and classify retriable errors.
- [ ] Integrate screenshot capture + run artifact mapping.
- [ ] Add/refresh unit and integration tests.
- [ ] Validate behavior on macOS, Windows, Linux.

### 14. Future Extensions
- Replace Find-in-Page approach with stable selectors if AWS exposes test IDs.
- Add optional multi-tab or multi-context parallel service execution.
- Add heuristics for split-label matching and fuzzy label fallback.
- Add HAR/tracing capture toggles for deep troubleshooting.
- Introduce automation health scoring and flaky-step telemetry aggregation.

## 1. DOCUMENT METADATA
### 1.1 Document Control
**Document Title:** Software Design Document (SDD) — AWS Pricing Calculator Automator  
**Document Version:** 1.0  
**Document Status:** Draft  
**Author:** `<Author Name Placeholder>`  
**Date:** 2026-02-20  
**Reviewers:** `<Reviewer Placeholder 1>`, `<Reviewer Placeholder 2>`  
**Related Documents:** Product Requirements Document (PRD) for AWS Pricing Calculator Automator, Version TBD

### 1.2 Revision Policy
This document defines the baseline technical design for v1.0 of the AWS Pricing Calculator Automator and is intended to be revision-controlled in Git alongside the application source. Any change that affects data contracts, algorithms, CLI behavior, or artifact schemas requires an SDD update in the same pull request as the code change. Minor wording clarifications that do not affect implementation semantics may be applied without version increments, but any behavior change requires incrementing at least the minor revision of this SDD.

## 2. INTRODUCTION
### 2.1 Purpose of this Document
This SDD specifies the architecture, module interfaces, data contracts, algorithm behavior, error strategy, and verification plan for AWS Pricing Calculator Automator, a local Python CLI application that automates AWS cost estimate input into the AWS Pricing Calculator web interface. The document is written for software engineers and maintainers who will implement, extend, test, and operate the system across macOS, Windows, and Linux.

The primary objective is implementation precision. Every described component includes ownership boundaries, typed interface expectations, runtime behavior, and failure handling semantics so that maintainers can change code confidently without introducing hidden contract drift between Mode A (Builder) and Mode B (Runner).

### 2.2 Scope
This SDD fully specifies the following implementation areas:
- CLI orchestration and mode routing in `main.py`.
- Profile JSON loading and schema validation against Draft-07 schema.
- Cross-field domain validation that cannot be represented purely in JSON Schema.
- Value resolution priority chain, including runtime overrides and unresolved batching.
- Browser lifecycle and AWS Calculator navigation strategy using Playwright.
- Dimension location and interaction behavior, including retry and screenshot capture.
- Output artifact generation and storage behavior.
- Configuration management for service catalog, region map, and schema versioning.
- Unit, integration, and end-to-end testing strategy.

The following are explicitly out of scope for v1.0 and therefore deferred:
- Distributed execution, daemon mode, or remote API service deployment.
- Parallel browser automation for multiple profiles in one run.
- Automatic synchronization with AWS public APIs for catalog updates.
- OCR/computer-vision fallback for UI element detection.
- External secrets management integration.

### 2.3 Definitions and Abbreviations
| Term | Definition |
|---|---|
| SDD | Software Design Document. The technical implementation specification that maps requirements to architecture, interfaces, and behavior. |
| PRD | Product Requirements Document. The product-level source describing goals and expected outcomes that this SDD implements. |
| SPA | Single Page Application. The AWS Pricing Calculator front-end architecture where page changes occur through client-side rendering without full page reload. |
| CDP | Chrome DevTools Protocol. Low-level browser protocol used by Playwright for operations such as evaluating DOM selection geometry. |
| Profile | Input JSON artifact produced by Mode A and consumed by Mode B. Defines project groups, services, regions, and dimensions. |
| Group | Logical cost grouping in profile and AWS calculator (for example, “Frontend Web Tier”). |
| Service | AWS offering to add to an estimate group (for example, Amazon EC2, Amazon CloudFront). |
| Dimension | One configurable pricing input field within a service page, identified by a plain-English label. |
| field_type | Interaction mode for a dimension: `NUMBER`, `TEXT`, `SELECT`, `COMBOBOX`, `TOGGLE`, `RADIO`. |
| Value Resolution | Deterministic process that decides a final dimension value using user value, default value, prompt, required flag, and runtime overrides. |
| Fail-Fast | Stop execution before launching browser when unresolved required dimensions exist. |
| Fail-Forward | Continue run after per-step failures during automation; mark failures in artifact and proceed to remaining work. |
| Service Catalog | Static JSON metadata source that defines supported services, dimensions, field types, defaults, options, and valid regions. |
| Region Map | JSON mapping from AWS region code to calculator display string used by UI selection. |
| Run Artifact | `run_result.json` output emitted after each run with statuses, counts, timestamps, URL, and screenshot references. |
| Builder Mode | Mode A: interactive terminal wizard that generates valid profile documents. |
| Runner Mode | Mode B: automation mode that consumes profile and fills AWS calculator via browser automation. |
| Dry Run | Execution path that validates and resolves values without opening browser automation. |
| Override | CLI `--set` runtime mutation of one dimension value before resolution chain. |
| Locator | Component that identifies the DOM element corresponding to a dimension label using Find-in-Page plus proximity search. |
| Artifact Emitter | Component that writes run results and manages screenshot path conventions. |

## 3. SYSTEM OVERVIEW
### 3.1 High-Level Architecture
AWS Pricing Calculator Automator is organized as a local, file-driven CLI system with two modes sharing common core modules. Mode A creates profile files from interactive prompts using static metadata in modular service catalogs (`config/services/*.json`, loaded by `config/service_catalog_loader.py`) and `region_map.json`. Mode B loads a profile, validates and resolves all dimension values, then executes browser automation against AWS Pricing Calculator. The architecture enforces a strict preflight phase that resolves all required values before any browser is launched, reducing expensive and noisy runtime failures.

The system relies on configuration files as the source of deterministic behavior: the catalog determines which services and dimensions exist, the region map determines region label translation, and the schema enforces structural profile correctness. During automation, a locator/interactor split isolates UI element discovery from value application. This separation reduces coupling and allows targeted testing of find logic independent of field action code.

```plaintext
+--------------------+         +---------------------------+
|      main.py       |         |        config/*           |
| CLI parse + mode   |-------->| json-schema.json          |
| dispatch           |         | services/*.json           |
|                    |         | service_catalog_loader.py |
+---------+----------+         | region_map.json           |
          |                    +------------+--------------+
          |                                 |
          v                                 v
+--------------------+         +---------------------------+
|  core/profile_     |         | builder/service_picker.py |
|  loader.py         |<------->| service selection metadata|
| schema + cross-val |         +---------------------------+
+---------+----------+
          |
          v
+--------------------+        Mode A (Builder)
| core/value_        |<-------------------------------+
| resolver.py        |                                |
| priority chain     |                                |
+---------+----------+                                |
          |                                           |
          | resolved profile                          |
          v                                           |
+--------------------------+                          |
| automation/browser_      |                          |
| session.py               |                          |
+------------+-------------+                          |
             |                                        |
             v                                        |
+--------------------------+                          |
| automation/navigator.py  |--------------------------+
| group/service/region nav |
+------------+-------------+
             |
             v
+--------------------------+         +--------------------------+
| automation/find_in_page_ |-------->| automation/field_        |
| locator.py               | handle  | interactor.py            |
+------------+-------------+ + type  +------------+-------------+
             |                                        |
             +--------------------+-------------------+
                                  v
                       +---------------------------+
                       | core/artifact_emitter.py  |
                       | run_result + screenshots  |
                       +---------------------------+
```

### 3.2 Operating Modes
#### 3.2.1 Mode A (Builder)
Builder mode is a guided terminal wizard that creates a profile document conforming to schema v2.0 and catalog constraints. The wizard walks the user through project metadata, group creation, service selection from catalog, region assignment constrained by `supported_regions`, and dimension value capture. Prompt visibility can be service-specific (for example, EC2 workload/EBS dependencies) through modular prompt policies. The output is a JSON profile file in `profiles/` that is readable, version-controllable, and reusable.

```plaintext
[CLI] python main.py --build
  -> initialize rich console and questionary session
  -> load service catalogs via service_catalog_loader and region map
  -> prompt: project_name, description
  -> loop groups:
       prompt group_name
       invoke service_picker for service selection
       for each selected service:
         prompt region (filtered by supported_regions)
         for each selected catalog dimension:
           apply service prompt policy to decide visibility
           capture user_value/default_value/required
  -> assemble ProfileDocument object
  -> validate against json-schema.json
  -> write profiles/<normalized_project>.json
  -> print summary table (groups/services/dimensions)
```

#### 3.2.2 Mode B (Runner)
Runner mode executes profile-driven browser automation against AWS Pricing Calculator. It performs strict preflight validation and value resolution before browser startup. If unresolved required dimensions exist, execution stops with a consolidated unresolved report. If preflight passes, browser automation creates groups, adds services, selects region in the Add Service panel before searching services, locates each dimension field via Find-in-Page strategy, and interacts based on field type. Failures during automation are captured as per-service/per-dimension statuses, with screenshots and continuation behavior.

```plaintext
[CLI] python main.py --run --profile <path> [--set ...] [--headless]
  -> load + schema validate profile
  -> apply --set runtime overrides
  -> resolve all dimensions (user/default/prompt/required)
  -> launch playwright browser
  -> iterate group/service/dimension tree applying values
  -> emit outputs/run_result.json
```

#### 3.2.3 Mode C (Explore / Promoter)
Explore mode (`python main.py explore`) connects to a live AWS Calculator service page in a headless browser, discovers available dimensions, toggles, and dropdown options, and writes a draft catalog JSON to `config/services/generated/`. It then automatically chains into the Promoter flow (`python main.py promote`), an interactive wizard that allows operators to trim unwanted dimensions, correct names, and save the final mapped JSON to `config/services/`, making it instantly available to Builder mode.
  -> if unresolved required exists: report and exit code 1
  -> launch Playwright Chromium session
  -> open AWS calculator estimate URL
  -> for each group:
       create group in calculator
       for each service:
         open add service panel
         choose region (unless global)
         search and select service by search_term
         for each dimension:
           locate field by find_in_page_locator
           interact by field_interactor
           record fill/skip/fail result
  -> collect final calculator URL
  -> emit outputs/run_result.json and screenshots
  -> optionally open artifact if --open-result
```

### 3.3 Design Principles
1. **Plain-English dimension keys as locator anchor.** The calculator lacks stable selectors, so label text from catalog/profile is the durable anchor. This reduces fragility against CSS class renaming.
2. **Fail-fast before browser launch.** All required values are resolved first; unresolved required dimensions cause immediate termination. This prevents partial browser sessions with known invalid inputs.
3. **Fail-forward during automation.** Runtime UI failures for individual dimensions or services should not cancel the entire estimate build. The system captures evidence and continues.
4. **Static service catalog as single source of truth.** Supported services, dimension types, and options are centrally managed in `config/services/*.json`, avoiding scattered hardcoded behavior.
5. **JSON profiles as version-controllable artifacts.** Profiles can be reviewed, diffed, shared, and changed in Git; they are deterministic inputs to runs.
6. **Playwright over Selenium.** Playwright provides robust auto-waiting, modern CDP access, richer API ergonomics, and reliable cross-platform behavior for SPA automation.
7. **Explicit inter-module contracts.** Typed models and structured result objects reduce hidden coupling and make test boundaries clear.
8. **Observability-first output.** Every meaningful action emits structured terminal messages and artifact updates for reproducibility and troubleshooting.

## 4. MODULE DESIGN
### 4.1 `main.py`
#### Responsibility
`main.py` owns CLI parsing, mode dispatch, lifecycle orchestration, and process exit codes. It does not own detailed validation logic, value resolution internals, browser operations, or artifact serialization format rules.

#### Public interface
```python
from pathlib import Path
from typing import Sequence


def build_parser() -> "argparse.ArgumentParser":
    ...


def parse_set_overrides(values: list[str]) -> dict[tuple[str, str, str], str]:
    ...


def run_build_mode() -> int:
    ...


def run_runner_mode(
    profile_path: Path,
    dry_run: bool,
    headless: bool,
    overrides: dict[tuple[str, str, str], str],
    open_result: bool,
) -> int:
    ...


def main(argv: Sequence[str] | None = None) -> int:
    ...
```

#### Internal logic description
`main.py` parses flags and enforces mutually exclusive mode behavior (`--build` versus `--run`/`--dry-run`). It normalizes and validates `--set` override syntax into a deterministic tuple-key map `(group_name, service_name, dimension_key) -> value`. For runner mode, it sequentially invokes loader, resolver, and optional browser automation based on dry-run status. It maps exceptions to exit codes and ensures terminal error formatting remains consistent across layers.

#### Dependencies
- Internal: `builder.interactive_builder`, `core.profile_loader`, `core.value_resolver`, `automation.browser_session`, `automation.navigator`, `core.artifact_emitter`.
- External: `argparse`, `pathlib`, `sys`, `rich`.

#### Error conditions handled
- Invalid CLI flag combinations.
- Missing required profile path for run or dry-run modes.
- Malformed override expression.
- Any raised `ProfileValidationError`, `ResolutionError`, `AutomationFatalError`, `ArtifactWriteError` mapped to non-zero exit.

### 4.2 `core/profile_loader.py`
#### Responsibility
Loads profile JSON, validates against Draft-07 schema, performs cross-field validations against catalog and region map, and returns typed `ProfileDocument`. It does not resolve values or mutate profile contents beyond normalization.

#### Public interface
```python
from pathlib import Path
from typing import Any

from pydantic import BaseModel


class ProfileValidationError(Exception):
    ...


def load_json(path: Path) -> dict[str, Any]:
    ...


def validate_schema(profile_data: dict[str, Any], schema_data: dict[str, Any]) -> None:
    ...


def validate_cross_fields(
    profile_data: dict[str, Any],
    service_catalog: dict[str, Any],
    region_map: dict[str, str],
) -> None:
    ...


def load_profile(
    profile_path: Path,
    schema_path: Path,
    service_catalog_path: Path,
    region_map_path: Path,
) -> "ProfileDocument":
    ...
```

#### Internal logic description
The module reads profile and config JSON files, validates structure via `jsonschema.validate`, then executes semantic cross-checks: each service name must exist in catalog, region must be supported and mappable, each dimension key must be defined by the service, and select/combo constraints must match known options where required. Validation errors are accumulated with precise paths and raised together to support deterministic debugging. On success, data is parsed into Pydantic models.

#### Dependencies
- Internal: `core.models` (Pydantic data models).
- External: `json`, `pathlib`, `jsonschema`, `pydantic`.

#### Error conditions raised or handled
- `FileNotFoundError`, `JSONDecodeError` for malformed/missing files.
- `jsonschema.ValidationError` wrapped into `ProfileValidationError`.
- Domain validation failures raised as `ProfileValidationError` with multiple entries.

### 4.3 `core/value_resolver.py`
#### Responsibility
Resolves all dimension values using priority chain and optional runtime overrides, producing a resolved execution map. It does not perform browser interactions or write artifacts.

#### Public interface
```python
from dataclasses import dataclass
from typing import Any


class ResolutionError(Exception):
    ...


@dataclass(frozen=True)
class UnresolvedDimension:
    group_name: str
    service_name: str
    dimension_key: str
    reason: str


def apply_overrides(
    profile: "ProfileDocument",
    overrides: dict[tuple[str, str, str], str],
) -> "ProfileDocument":
    ...


def resolve_dimensions(
    profile: "ProfileDocument",
    prompt_enabled: bool = True,
) -> tuple["ProfileDocument", list[UnresolvedDimension]]:
    ...


def assert_no_unresolved(unresolved: list[UnresolvedDimension]) -> None:
    ...
```

#### Internal logic description
The resolver first applies override values to targeted dimensions, then iterates groups, services, and dimensions in stable order. For each dimension it chooses the first available source in chain: `user_value`, `default_value`, prompt response when `prompt_message` exists, unresolved if required, skipped if not required. It returns a transformed profile where each dimension has an explicit `resolved_value`, `resolution_source`, and `resolution_status`. If unresolved required dimensions are found, it creates a consolidated report and raises `ResolutionError` before browser launch.

#### Dependencies
- Internal: `core.models`.
- External: `questionary` (optional prompts), `rich` (report output).

#### Error conditions raised or handled
- Invalid override targets (group/service/dimension not found).
- Empty prompt responses for required dimensions.
- `ResolutionError` containing batched unresolved details.

### 4.4 `core/artifact_emitter.py`
#### Responsibility
Creates `outputs/run_result.json`, manages screenshot file naming and directories, and serializes terminal run outcomes into artifact schema. It does not control browser logic.

#### Public interface
```python
from pathlib import Path
from datetime import datetime


class ArtifactWriteError(Exception):
    ...


def ensure_output_dirs(base_dir: Path) -> tuple[Path, Path]:
    ...


def build_run_id(now: datetime | None = None) -> str:
    ...


def build_screenshot_path(
    screenshots_dir: Path,
    service_id: str,
    step_name: str,
    now: datetime | None = None,
) -> Path:
    ...


def write_run_result(result: "RunResult", output_file: Path) -> None:
    ...
```

#### Internal logic description
This module ensures `outputs/` and `outputs/screenshots/` exist, constructs deterministic run IDs, and writes JSON using UTF-8, pretty indentation, and stable key ordering for diff-friendly outputs. Screenshot paths are generated using sanitized service identifiers, step names, and UTC timestamps to avoid collisions. Write errors are caught and re-raised as `ArtifactWriteError` with absolute path context.

#### Dependencies
- Internal: `core.models`.
- External: `json`, `pathlib`, `datetime`, `re`.

#### Error conditions raised or handled
- Permission errors during directory creation.
- File write failures.
- Serialization failures for malformed run structures.

### 4.5 `builder/interactive_builder.py`
#### Responsibility
Implements Mode A wizard flow, collecting project/group/service/dimension data and outputting valid profile JSON. It does not execute browser automation.

#### Public interface
```python
from pathlib import Path


def run_builder(
    region_map_path: Path,
    schema_path: Path,
    output_dir: Path,
) -> Path:
    ...


def prompt_project_metadata() -> tuple[str, str]:
    ...


def prompt_group_definitions(
    service_catalog: list["ServiceCatalogEntry"],
    region_map: dict[str, str],
) -> list["Group"]:
    ...
```

#### Internal logic description
The builder opens with project-level prompts, then repeatedly collects groups until user finishes. For each group it invokes service picker and prompts region and per-dimension values based on catalog metadata and service `builder_mode` (`flat_selective`, `flat_all`, `toggle_two_step`, `auto`). Prompt visibility rules are delegated to `builder/service_prompt_policies.py`, allowing service-specific dependencies without hardcoding logic into the main wizard flow. It then validates resulting profile against schema and cross-field rules by reusing loader validators. The final profile file is named from project slug and written to `profiles/`.

#### Dependencies
- Internal: `builder.service_picker`, `builder.service_prompt_policies`, `config.service_catalog_loader`, `core.profile_loader`, `core.models`.
- External: `questionary`, `rich`, `pathlib`.

#### Error conditions raised or handled
- User cancellation (Ctrl+C/EOF).
- Invalid dimension type input (reprompt).
- Write failure to profile output path.

### 4.5.1 `builder/service_prompt_policies.py`
#### Responsibility
Defines modular per-service prompt visibility rules for builder dimension prompting. This module decouples service-specific dependencies (such as EC2 workload/EBS conditional fields) from `interactive_builder.py`.

#### Public interface
```python
from core.models import Dimension


class ServicePromptPolicy(Protocol):
    def should_prompt(self, dim_key: str, dimensions: dict[str, Dimension]) -> bool:
        ...


def get_prompt_policy(service_name: str) -> ServicePromptPolicy:
    ...


def register_prompt_policy(service_name: str, policy: ServicePromptPolicy) -> None:
    ...
```

#### Internal logic description
Policies are resolved by normalized service name from a registry. Unknown services use a default policy that always prompts selected dimensions. EC2 uses `Ec2PromptPolicy` to gate workload- and storage-dependent dimensions.

#### Dependencies
- Internal: `core.models`.
- External: Python stdlib typing protocol support.

#### Error conditions raised or handled
- None in normal flow (policy lookup falls back to default policy).

### 4.6 `builder/service_picker.py`
#### Responsibility
Presents a searchable list of supported services and returns selected catalog entries. It does not gather dimension values.

#### Public interface
```python
from typing import Sequence


def list_services(service_catalog: dict) -> list[str]:
    ...


def select_services(
    service_catalog: dict,
    preselected: Sequence[str] | None = None,
) -> list["ServiceCatalogEntry"]:
    ...
```

#### Internal logic description
The picker converts catalog entries into display strings including `service_name` and optional short hint text, supports multi-select via questionary checkbox, and returns selected entries in catalog order. It can enforce at least one selection when group creation requires services.

#### Dependencies
- Internal: `core.models`.
- External: `questionary`.

#### Error conditions raised or handled
- Empty selection when disallowed.
- Catalog with duplicate `service_name` values.

### 4.7 `automation/browser_session.py`
#### Responsibility
Owns Playwright startup/shutdown, browser context creation, page object lifecycle, and crash detection. It does not implement business navigation flows.

#### Public interface
```python
from contextlib import AbstractContextManager


class AutomationFatalError(Exception):
    ...


class BrowserSession(AbstractContextManager["BrowserSession"]):
    def __init__(self, headless: bool = False) -> None:
        ...

    def __enter__(self) -> "BrowserSession":
        ...

    def __exit__(self, exc_type, exc, tb) -> None:
        ...

    @property
    def page(self) -> "playwright.sync_api.Page":
        ...

    def open_calculator(self, url: str = "https://calculator.aws/#/estimate") -> None:
        ...

    def current_url(self) -> str:
        ...
```

#### Internal logic description
The session starts Playwright synchronously, launches Chromium in headed mode by default, configures sane timeouts, and keeps one primary page instance. It validates page availability before each operation and converts fatal browser disconnections into `AutomationFatalError`, signaling immediate run termination.

#### Dependencies
- Internal: none.
- External: `playwright.sync_api`.

#### Error conditions raised or handled
- Browser launch failure.
- Page creation timeout.
- Browser process crash/disconnect.

### 4.8 `automation/navigator.py`
#### Responsibility
Navigates AWS calculator structure: ensure estimate groups exist, add services, select region first in the Add Service panel, expand hidden optional sections, and orchestrate dimension filling with catalog metadata.

#### Public interface
```python

class NavigationError(Exception):
    ...


def ensure_group_exists(page: "Page", group_name: str) -> None:
    ...


def click_add_service(page: "Page") -> None:
    ...


def select_region(page: "Page", region_code: str, ui_mapping: "ServiceUiMapping") -> None:
    ...


def search_and_select_service(
    page: "Page",
    search_terms: list[str],
    expected_titles: list[str],
    ui_mapping: "ServiceUiMapping",
) -> None:
    ...


def build_service_search_terms(catalog_entry: "ServiceCatalogEntry") -> list[str]:
    ...


def click_configure(page: "Page", label: str = "Configure") -> None:
    ...


def click_save(page: "Page", label: str = "Save and add service") -> None:
    ...


def navigate_service(
    page: "Page",
    catalog_entry: "ServiceCatalogEntry",
    resolved_dimensions: dict[str, "Dimension"],
    screenshot_dir: "Path",
    service_label: str,
    target_region: str,
    save_to_summary: bool = False,
) -> tuple[bool, str | None, str | None]:
    ...
```

#### Internal logic description
Navigator uses a deterministic but adaptive UI exploration flow:
1. Ensure target estimate group exists; if `Create group` is unavailable (for example stuck on `#/createCalculator/...`), it recovers by navigating back to estimate route and retrying group creation.
2. Open Add Service panel and select region before service search, using service-level `ui_mapping` labels.
3. Build search keyword candidates from catalog fields (`search_term`, `service_name`, `calculator_page_title`, `search_keywords`) and DB fallback keywords, then select the best-matching service card.
4. Open Configure page and proactively expand hidden optional sections using multi-strategy heuristics:
   - optional accordion button by name
   - OS-aware Find-in-Page keyboard path
   - nearby heading/text/checkbox/button fallback clicks
5. Fill dimensions via `field_interactor.fill_dimension`, passing per-dimension `field_type`, `css_selector`, `fallback_label`, and `options`.
6. Apply service-specific skip guards (for example EC2 workload/EBS conditional dimensions) and skip optional hidden fields when value is effectively zero/false.
7. Save service using `Save and add service`, or `Save and view summary` for the final service in run order.

#### Dependencies
- Internal: `automation.browser_session`, `automation.field_interactor`, `automation.find_in_page_locator`, `core.models`.
- External: `playwright.sync_api`.

#### Error conditions raised or handled
- `E-NAV-001`: Add Service control not found/click failed.
- `E-NAV-002`: Service search input/result resolution failure.
- `E-NAV-003`: Configure action failure.
- `E-NAV-004`: Save action failure.
- `E-NAV-005`: Region controls missing or option unavailable.
- `E-NAV-006`: Group creation/focus failure.

### 4.9 `automation/find_in_page_locator.py`
#### Responsibility
Resolves logical dimension names to actionable Playwright locators using a tiered fallback strategy. It does not set values.

#### Public interface
```python
from dataclasses import dataclass


@dataclass(frozen=True)
class LocatorResult:
    locator: "Locator"
    strategy: str
    selector: str


class LocatorNotFoundError(Exception):
    ...


def find_element(
    page: "Page",
    dimension_key: str,
    *,
    primary_css: str | None = None,
    fallback_label: str | None = None,
) -> LocatorResult:
    ...


def find_button(page: "Page", label: str) -> LocatorResult:
    ...
```

#### Internal logic description
Locator resolution order is:
1. Service-specific special-case handler for known ambiguous fields (for example Data Transfer amount inputs) using heading-relative XPath matching.
2. Explicit catalog CSS selector (`css_selector`) when provided.
3. Label-based fallbacks, in order, for `fallback_label` then `dimension_key`:
   - aria-label contains (case-insensitive)
   - `get_by_label(...)`
   - role+name matching across checkbox/switch/radio/spinbutton/combobox/textbox/button
   - visible text matching
4. If all strategies fail, raise `LocatorNotFoundError` with diagnostic context.

#### Dependencies
- Internal: none.
- External: `playwright.sync_api`, `dataclasses`.

#### Error conditions raised or handled
- `E-LOCATOR-001`: Dimension element not found after all strategies.
- `E-LOCATOR-002`: Button not found after role/text strategies.

### 4.10 `automation/field_interactor.py`
#### Responsibility
Applies resolved dimension values according to catalog field type. It requests element handles from `find_in_page_locator` and performs robust UI interaction/verification.

#### Public interface
```python
class FieldInteractionError(Exception):
    ...


def fill_dimension(
    page: "Page",
    dimension_key: str,
    dimension: "Dimension",
    field_type: str,
    *,
    primary_css: str | None = None,
    fallback_label: str | None = None,
    options: list[str] | None = None,
) -> None:
    ...
```

#### Internal logic description
The interactor dispatches behavior by `field_type`:
1. `TEXT`/`NUMBER`: click+fill on resolved input.
2. `SELECT`: try native `<select>` first, then Cloudscape/custom dropdown strategies with visible option matching (`role=option`, substring, normalized text/data-value).
3. `COMBOBOX`: type value, choose option when present, or submit with Enter; verify resulting input contains requested value.
4. `TOGGLE`: resolve actionable switch/checkbox/button target, infer current state (`is_checked` or ARIA attributes), and click only when state change is needed.
5. `RADIO`: click explicit radio input by value, fallback to locator search by option label.
6. `INSTANCE_SEARCH`: EC2-specific instance table flow (search then row-radio click).
7. Unknown type falls back to generic text fill.

`fill_dimension` skips dimensions with `user_value=None`, propagates locator failures, and wraps interaction failures as `FieldInteractionError` with `E-FIELD-*` codes.

#### Dependencies
- Internal: `automation.find_in_page_locator`.
- External: `playwright.sync_api`, `re`.

#### Error conditions raised or handled
- `E-FIELD-001`: Generic field interaction failure wrapper.
- `E-FIELD-002`: SELECT option not found in visible dropdown.
- `E-FIELD-003`: RADIO option not found.
- `E-FIELD-004`: COMBOBOX value not applied/verified.
- `E-FIELD-005`: INSTANCE_SEARCH table-row radio selection failure.

## 5. DATA DESIGN
### 5.1 Profile Document Schema
The profile schema is Draft-07 and constrains structure, data types, and required blocks while preserving enough flexibility for services with different dimension patterns.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local.aws-cost/config/json-schema.json",
  "title": "AWS Pricing Calculator Automator Profile",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "project_name", "groups"],
  "properties": {
    "schema_version": {
      "type": "string",
      "const": "2.0",
      "description": "Profile schema version enforced by loader."
    },
    "project_name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120,
      "description": "Human-readable estimate project name."
    },
    "description": {
      "type": "string",
      "maxLength": 1000,
      "description": "Optional long-form purpose or scope notes for the estimate."
    },
    "groups": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/group" },
      "description": "Ordered list of estimate groups to create in calculator."
    }
  },
  "definitions": {
    "group": {
      "type": "object",
      "additionalProperties": false,
      "required": ["group_name", "services"],
      "properties": {
        "group_name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "Display name for AWS calculator group."
        },
        "services": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/definitions/service" },
          "description": "Services included in this group in execution order."
        }
      }
    },
    "service": {
      "type": "object",
      "additionalProperties": false,
      "required": ["service_name", "human_label", "region", "dimensions"],
      "properties": {
        "service_name": {
          "type": "string",
          "minLength": 1,
          "description": "Canonical AWS service name that must match service catalog entry."
        },
        "human_label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "User-facing label for artifact and terminal output."
        },
        "region": {
          "type": "string",
          "minLength": 1,
          "description": "AWS region code (for example us-east-1) or global pseudo-region."
        },
        "dimensions": {
          "type": "object",
          "minProperties": 1,
          "additionalProperties": { "$ref": "#/definitions/dimension" },
          "description": "Map of dimension key to value-resolution metadata."
        }
      }
    },
    "dimension": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "user_value": {
          "description": "Explicit value entered at build time. May be null.",
          "oneOf": [
            { "type": "string" },
            { "type": "number" },
            { "type": "integer" },
            { "type": "boolean" },
            { "type": "null" }
          ]
        },
        "default_value": {
          "description": "Fallback value when user_value is null.",
          "oneOf": [
            { "type": "string" },
            { "type": "number" },
            { "type": "integer" },
            { "type": "boolean" },
            { "type": "null" }
          ]
        },
        "unit": {
          "type": "string",
          "description": "Optional unit label shown for human context (GB, requests, ms)."
        },
        "prompt_message": {
          "type": "string",
          "minLength": 1,
          "description": "Prompt shown at runtime if user/default values are unavailable."
        },
        "required": {
          "type": "boolean",
          "default": true,
          "description": "If false and unresolved, dimension is skipped."
        }
      }
    }
  }
}
```

Cross-field validation rules enforced in `profile_loader.py` beyond schema:
1. `service_name` in each service object must exist in modular service catalog files under `config/services/*.json`.
2. `region` must be a valid key in `region_map.json` or equal to `global` (case-insensitive normalization allowed).
3. Every dimension key under a service must match a defined catalog dimension key for that service.
4. If `required=true` and both `user_value` and `default_value` are null, then `prompt_message` is optional only when resolver will still receive runtime override; otherwise unresolved is an error preflight unless prompt is provided.
5. For dimensions mapped to `SELECT` in catalog, provided `user_value`/`default_value` must match one of catalog options exactly (case-sensitive by default, optional normalizer may be applied).

### 5.2 Run Result Artifact Schema
The run artifact records execution evidence and per-service outcomes with structured counters for observability.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local.aws-cost/config/run-result-schema.json",
  "title": "AWS Pricing Calculator Automator Run Result",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "run_id",
    "profile_name",
    "status",
    "started_at",
    "completed_at",
    "calculator_url",
    "groups"
  ],
  "properties": {
    "schema_version": {
      "type": "string",
      "const": "2.0",
      "description": "Artifact schema version aligned with profile schema major/minor for v1.0."
    },
    "run_id": {
      "type": "string",
      "pattern": "^run_[0-9]{8}_[0-9]{6}$",
      "description": "Unique run identifier in UTC timestamp format."
    },
    "profile_name": {
      "type": "string",
      "minLength": 1
    },
    "status": {
      "type": "string",
      "enum": ["success", "partial_success", "failed", "dry_run_success", "preflight_failed"],
      "description": "Overall run status category."
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "completed_at": {
      "type": "string",
      "format": "date-time"
    },
    "calculator_url": {
      "type": "string",
      "minLength": 1,
      "description": "Final calculator URL; in dry-run may be 'N/A'."
    },
    "groups": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/group_result" }
    }
  },
  "definitions": {
    "group_result": {
      "type": "object",
      "additionalProperties": false,
      "required": ["group_name", "services"],
      "properties": {
        "group_name": { "type": "string" },
        "services": {
          "type": "array",
          "items": { "$ref": "#/definitions/service_result" }
        }
      }
    },
    "service_result": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "service_name",
        "human_label",
        "status",
        "dimensions_filled",
        "dimensions_skipped",
        "dimensions_failed"
      ],
      "properties": {
        "service_name": { "type": "string" },
        "human_label": { "type": "string" },
        "status": {
          "type": "string",
          "enum": ["success", "partial_success", "failed", "skipped"]
        },
        "failed_step": {
          "type": "string",
          "enum": [
            "none",
            "create_group",
            "add_service",
            "set_region",
            "find_dimension",
            "fill_dimension",
            "unknown"
          ]
        },
        "failed_dimension": {
          "type": ["string", "null"]
        },
        "screenshot": {
          "type": ["string", "null"],
          "description": "Relative path to screenshot when captured."
        },
        "dimensions_filled": { "type": "integer", "minimum": 0 },
        "dimensions_skipped": { "type": "integer", "minimum": 0 },
        "dimensions_failed": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

### 5.3 Service Catalog Schema
Service catalog defines all automation-supported services and dimensions. It is static configuration treated as versioned code.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local.aws-cost/config/service-catalog-schema.json",
  "title": "AWS Service Catalog",
  "type": "array",
  "minItems": 1,
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "service_name",
      "search_term",
      "calculator_page_title",
      "supported_regions",
      "dimensions"
    ],
    "properties": {
      "service_name": {
        "type": "string",
        "minLength": 1,
        "description": "Canonical service name used in profile documents."
      },
      "search_term": {
        "type": "string",
        "minLength": 1,
        "description": "Term typed into calculator Add Service search box."
      },
      "calculator_page_title": {
        "type": "string",
        "minLength": 1,
        "description": "Title expected in service page context after selection."
      },
      "supported_regions": {
        "type": "array",
        "minItems": 1,
        "items": { "type": "string" },
        "description": "Region codes where this service interaction is validated."
      },
      "dimensions": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["key", "field_type", "required"],
          "properties": {
            "key": {
              "type": "string",
              "minLength": 1,
              "description": "Plain-English dimension label used for find-in-page."
            },
            "field_type": {
              "type": "string",
              "enum": ["NUMBER", "TEXT", "SELECT", "COMBOBOX", "TOGGLE", "RADIO"],
              "description": "Interaction strategy used by field_interactor."
            },
            "options": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Allowed options for SELECT or RADIO when known."
            },
            "unit": {
              "type": ["string", "null"],
              "description": "Optional unit metadata for human context and validation prompts."
            },
            "default_value": {
              "oneOf": [
                { "type": "string" },
                { "type": "number" },
                { "type": "integer" },
                { "type": "boolean" },
                { "type": "null" }
              ],
              "description": "Catalog-level default used by builder or fallback."
            },
            "required": {
              "type": "boolean",
              "description": "Whether unresolved value should block execution."
            }
          }
        }
      }
    }
  }
}
```

### 5.4 Region Map Schema
`region_map.json` is a JSON object mapping canonical AWS region codes to exact calculator dropdown labels.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local.aws-cost/config/region-map-schema.json",
  "title": "AWS Region Display Map",
  "type": "object",
  "additionalProperties": {
    "type": "string",
    "minLength": 1
  },
  "propertyNames": {
    "pattern": "^(global|[a-z]{2}-[a-z]+-[0-9]+)$"
  },
  "description": "Keys are normalized lowercase region codes; values are exact UI display strings."
}
```

Example `region_map.json`:

```json
{
  "us-east-1": "US East (N. Virginia)",
  "us-west-2": "US West (Oregon)",
  "eu-central-1": "Europe (Frankfurt)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "global": ""
}
```

### 5.5 Internal Pydantic Models
```python
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


FieldType = Literal["NUMBER", "TEXT", "SELECT", "COMBOBOX", "TOGGLE", "RADIO"]
ResolutionStatus = Literal["RESOLVED", "SKIPPED", "UNRESOLVED"]
ResolutionSource = Literal["override", "user_value", "default_value", "prompt", "none"]
ServiceRunStatus = Literal["success", "partial_success", "failed", "skipped"]
RunStatus = Literal["success", "partial_success", "failed", "dry_run_success", "preflight_failed"]


class Dimension(BaseModel):
  user_value: Any | None = None
  default_value: Any | None = None
  unit: str | None = None
  prompt_message: str | None = None
  required: bool = True


class ResolvedDimension(BaseModel):
  key: str
  resolved_value: Any | None = None
  status: ResolutionStatus
  source: ResolutionSource = "none"
  message: str | None = None


class Service(BaseModel):
  service_name: str
  human_label: str
  region: str
  dimensions: dict[str, Dimension]


class Group(BaseModel):
  group_name: str
  services: list[Service]


class ProfileDocument(BaseModel):
  schema_version: Literal["2.0"] = "2.0"
  project_name: str
  description: str | None = None
  groups: list[Group]


class CatalogDimension(BaseModel):
  key: str
  field_type: FieldType
  options: list[str] = Field(default_factory=list)
  unit: str | None = None
  default_value: Any | None = None
  required: bool = True


class SectionExpansionTrigger(BaseModel):
  """Declares how to expand a specific collapsible UI section for a service."""
  label: str           # UI section label, matched case-insensitively
  trigger: str         # strategy ID — key in SECTION_STRATEGY_FUNCS
  required: bool = False  # if True, log warning when trigger fails (expansion still non-fatal)


class ServiceCatalogEntry(BaseModel):
  service_name: str
  search_term: str
  calculator_page_title: str
  supported_regions: list[str]
  dimensions: list[CatalogDimension]
  section_expansion_triggers: list[SectionExpansionTrigger] = Field(default_factory=list)


class ServiceResult(BaseModel):
  service_name: str
  human_label: str
  status: ServiceRunStatus
  failed_step: str | None = None
  failed_dimension: str | None = None
  screenshot: str | None = None
  dimensions_filled: int = 0
  dimensions_skipped: int = 0
  dimensions_failed: int = 0


class GroupResult(BaseModel):
  group_name: str
  services: list[ServiceResult]


class RunResult(BaseModel):
  schema_version: Literal["2.0"] = "2.0"
  run_id: str
  profile_name: str
  status: RunStatus
  started_at: datetime
  completed_at: datetime
  calculator_url: str
  groups: list[GroupResult]
```

## 6. ALGORITHM SPECIFICATIONS
### 6.1 Value Resolution Algorithm
The value resolution algorithm guarantees deterministic final inputs before browser launch and centralizes unresolved detection.

```plaintext
function resolve_profile(profile, overrides, prompt_enabled):
  apply_overrides(profile, overrides)

  unresolved = []
  resolved_map = {}

  for group in profile.groups:
    if group.group_name not in resolved_map:
      resolved_map[group.group_name] = {}

    for service in group.services:
      service_key = service.human_label
      resolved_map[group.group_name][service_key] = {}

      for dim_key, dim in service.dimensions.items():
        required = dim.required if dim.required is not None else true

        if dim.user_value is not null:
          resolved_map[group.group_name][service_key][dim_key] = {
            value: dim.user_value,
            source: "user_value",
            status: "RESOLVED"
          }
          continue

        if dim.default_value is not null:
          resolved_map[group.group_name][service_key][dim_key] = {
            value: dim.default_value,
            source: "default_value",
            status: "RESOLVED"
          }
          continue

        if dim.prompt_message is not null and prompt_enabled is true:
          answer = prompt_user(dim.prompt_message)
          if answer is not null and answer != "":
            resolved_map[group.group_name][service_key][dim_key] = {
              value: answer,
              source: "prompt",
              status: "RESOLVED"
            }
            continue

        if required is true:
          unresolved.append({
            group_name: group.group_name,
            service_name: service.service_name,
            dimension_key: dim_key,
            reason: "No user_value/default_value/prompt answer"
          })
          resolved_map[group.group_name][service_key][dim_key] = {
            value: null,
            source: "none",
            status: "UNRESOLVED"
          }
        else:
          resolved_map[group.group_name][service_key][dim_key] = {
            value: null,
            source: "none",
            status: "SKIPPED"
          }

  if unresolved length > 0:
    print_unresolved_report(unresolved)
    raise ResolutionError("Unresolved required dimensions; browser launch blocked")

  return resolved_map


function apply_overrides(profile, overrides):
  for (group_name, service_name, dim_key), override_value in overrides:
    target = find_dimension(profile, group_name, service_name, dim_key)
    if target not found:
      raise ResolutionError("Override target not found")
    target.user_value = override_value
```

### 6.2 Find-in-Page Locator Algorithm
```plaintext
function locate_field(page, label, os_name, max_retries=2):
  retry = 0

  while retry <= max_retries:
    try:
      page.keyboard.press("Control+Home")

      if os_name == "darwin":
        page.keyboard.press("Meta+f")
      else:
        page.keyboard.press("Control+f")

      page.keyboard.type(label)
      page.keyboard.press("Enter")
      wait 150ms

      rect = cdp_runtime_evaluate(
        "(() => { const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return null; " +
        "const r = sel.getRangeAt(0).getBoundingClientRect(); return {top:r.top,left:r.left,width:r.width,height:r.height}; })()"
      )

      page.keyboard.press("Escape")

      if rect is null:
        raise LocatorError("find_in_page_no_match")

      top_min = rect.top - 150
      top_max = rect.top + 150

      candidates = query_dom_candidates_in_priority_order(page, [
        "input[type='number']",
        "input[type='text']",
        "select",
        "[role='combobox']",
        "[role='spinbutton']",
        "[role='switch']",
        "[role='radio']",
        "[role='listbox']"
      ])

      banded = []
      for c in candidates:
        box = c.bounding_box()
        if box is null:
          continue
        if box.y >= top_min and box.y <= top_max:
          banded.append((c, box.y))

      if banded length == 0:
        raise LocatorError("interactive_element_not_found_near_match")

      sort banded by y ascending
      element = banded[0].element
      detected_type = detect_field_type(element)

      return { element: element, detected_type: detected_type, label: label, match_top: rect.top }

    except (TimeoutError, LocatorError, StaleElementReferenceError):
      retry = retry + 1
      if retry > max_retries:
        capture_warning_screenshot("find_dimension", label)
        return null
      sleep(1.5 * retry)
```

### 6.3 Field Interaction Algorithm
Decision table:

| field_type | Target selector characteristics | Action sequence | Confirmation |
|---|---|---|---|
| `NUMBER` | `input[type=number]` or role spinbutton | clear existing value, fill string-cast number | element value equals expected string/normalized number |
| `TEXT` | `input[type=text]` or textarea | fill string value | value property equals expected string |
| `SELECT` | native `select` element | `select_option(label=...)` | selected option label equals expected |
| `COMBOBOX` | `[role=combobox]` or input with list popup | click, fill text, choose dropdown option | chosen option appears in input/selected token |
| `TOGGLE` | `[role=switch]` with `aria-checked` | read current state; click only if mismatch | final `aria-checked` equals expected boolean |
| `RADIO` | `role=radio` options under same group | click option matching visible label | selected option has checked/aria-checked true |

```plaintext
function fill_dimension(page, located_field, value, expected_type, max_retries=2):
  retry = 0

  while retry <= max_retries:
    try:
      t = expected_type if expected_type is not null else located_field.detected_type

      if t == "NUMBER":
        located_field.element.fill(str(value))
        assert normalize_numeric(located_field.element.input_value()) == normalize_numeric(str(value))

      else if t == "TEXT":
        located_field.element.fill(str(value))
        assert located_field.element.input_value() == str(value)

      else if t == "SELECT":
        located_field.element.select_option(label=str(value))
        assert selected_option_label(located_field.element) == str(value)

      else if t == "COMBOBOX":
        located_field.element.click()
        located_field.element.fill(str(value))
        option = find_dropdown_option(page, str(value))
        if option is null:
          raise FieldInteractionError("combobox_option_not_found")
        option.click()
        assert combobox_reflects_value(located_field.element, str(value))

      else if t == "TOGGLE":
        current = located_field.element.get_attribute("aria-checked")
        desired = "true" if to_bool(value) else "false"
        if current != desired:
          located_field.element.click()
        final = located_field.element.get_attribute("aria-checked")
        assert final == desired

      else if t == "RADIO":
        radio = find_radio_option_nearby(page, located_field.element, str(value))
        if radio is null:
          raise FieldInteractionError("radio_option_not_found")
        radio.click()
        assert radio_checked(radio)

      else:
        raise FieldInteractionError("unsupported_field_type")

      return result(status="success", message="filled", retries_used=retry)

    except (TimeoutError, FieldInteractionError, AssertionError):
      retry = retry + 1
      if retry > max_retries:
        return result(status="failed", message="interaction_failed_after_retries", retries_used=retry - 1)
      sleep(1.5 * retry)
```

### 6.4 Group and Service Navigation Algorithm
```plaintext
function navigate_group_and_service(page, group_name, service_entry, region_code):
  ensure_calculator_loaded(page)

  click_button("Create group")
  fill_input("Group name", group_name)
  click_button("Create")
  wait_for_text_visible(group_name)

  click_button("Add service")
  wait_for_modal("Add service")

  if lower(region_code) != "global":
    ensure_location_type("Region")
    open_region_selector(page)
    select_region_option_by_code(page, lower(region_code))
    verify_region_selected(page)

  search_input = find_first_visible_input([
    "Search for a service",
    "Search services",
    "Find resources",
    "Search"
  ], role_searchbox_names=["Find Service", "Find resources"])
  fill_input(search_input, service_entry.search_term)
  wait_for_search_results()

  candidate = find_service_result_by_title(service_entry.calculator_page_title)
  if candidate is null:
    raise NavigationError("service_not_found")
  candidate.click()

  click_button("Add to my estimate")
  assign_to_group_if_prompted(group_name)
  wait_for_service_panel_visible(service_entry.calculator_page_title)

  return success
```

## 7. INTERFACE DESIGN
### 7.1 CLI Interface Specification
| Flag | Type | Required | Default | Description | Validation Rule | Example |
|---|---|---|---|---|---|---|
| `--build` | boolean | Optional (mode) | `False` | Launch Mode A interactive builder wizard. | Mutually exclusive with `--run` and `--dry-run`. | `python main.py --build` |
| `--run` | boolean | Optional (mode) | `False` | Launch Mode B automation runner. | Requires `--profile`; mutually exclusive with `--build` and `--explore`. | `python main.py --run --profile profiles/ecommerce.json` |
| `--dry-run` | boolean | Optional | `False` | Validate profile and resolve values without browser launch. | Requires `--profile`; cannot be used with `--build`; may be used with `--set`. | `python main.py --dry-run --profile profiles/ecommerce.json` |
| `--explore` | boolean | Optional (mode) | `False` | Launch Mode C exploration scanner. | Requires `--service`; mutually exclusive with `--build` and `--run`. | `python main.py explore --service "Amazon EC2"` |
| `--promote` | boolean | Optional (mode) | `False` | Launch Mode D draft promotion wizard. | Mutually exclusive with target modes; optionally accepts `--draft`. | `python main.py promote` |
| `--profile` | path | Required for run/dry-run | None | Path to profile JSON input. | File must exist, readable, and valid JSON. | `--profile /Users/mac/Git/aws-cost/profiles/example.json` |
| `--headless` | boolean | Optional | `False` | Launch Playwright browser in headless mode. | Applies to `--run` and `--explore`. | `python main.py --run --profile profiles/ecommerce.json --headless` |
| `--set` | repeatable string | Optional | `[]` | Override dimension value at runtime in format `<group>.<service>.<dim>=<value>`. | Must parse into exactly one assignment, target must exist in profile. | `--set "Frontend Web Tier.Amazon EC2.Number of Instances=4"` |
| `--open-result` | boolean | Optional | `False` | Open `run_result.json` after completion. | Applicable to `--run` and `--dry-run` where artifact exists. | `python main.py --run --profile profiles/ecommerce.json --open-result` |

### 7.2 Terminal Output Design
Terminal output uses `rich` with consistent severity glyph and color policy. Message format is `[SYMBOL] [event_code] message | context_key=value`. Symbols are:
- `[✓]` green for success events.
- `[!]` yellow for warnings and skip behavior.
- `[✗]` red for failure and preflight stop events.

Event line templates:
- Profile loaded: `[✓] PROFILE_LOADED path=<path> schema_version=2.0 groups=<n>`
- Value resolved: `[✓] VALUE_RESOLVED group=<g> service=<s> dimension=<d> source=<source> value=<v>`
- Prompt shown: `[!] VALUE_PROMPT dimension=<d> message="<prompt_message>"`
- Browser launched: `[✓] BROWSER_LAUNCHED engine=chromium headless=<true|false>`
- Group created: `[✓] GROUP_CREATED group=<g>`
- Service found: `[✓] SERVICE_SELECTED group=<g> service=<service_name> search_term=<term>`
- Dimension filled: `[✓] DIMENSION_FILLED service=<s> dimension=<d> field_type=<t> value=<v>`
- Dimension skipped: `[!] DIMENSION_SKIPPED service=<s> dimension=<d> reason=<reason>`
- Dimension failed: `[✗] DIMENSION_FAILED service=<s> dimension=<d> step=<step> screenshot=<path>`
- Run complete: `[✓] RUN_COMPLETE run_id=<id> status=<status> artifact=outputs/run_result.json`

### 7.3 Inter-Module Data Contracts
#### 7.3.1 `value_resolver -> browser_session` (resolved dimension map)
The resolver produces a deterministic map keyed by group and service label with per-dimension status/source/value that runner consumes directly.

```json
{
  "Frontend Web Tier": {
    "Web Servers": {
      "Operating System": {
        "value": "Linux",
        "status": "RESOLVED",
        "source": "default_value"
      },
      "Instance Type": {
        "value": "t3.medium",
        "status": "RESOLVED",
        "source": "user_value"
      },
      "Number of Instances": {
        "value": "4",
        "status": "RESOLVED",
        "source": "override"
      }
    }
  }
}
```

#### 7.3.2 `find_in_page_locator -> field_interactor` (element handle + field type)
Contract object:

```python
@dataclass
class LocatedField:
  element: ElementHandle
  detected_type: Literal["NUMBER", "TEXT", "SELECT", "COMBOBOX", "TOGGLE", "RADIO", "UNKNOWN"]
  label: str
  match_top: float
```

`element` must be attached and visible at handoff time. `detected_type` may differ from catalog type and interactor should prefer catalog expected type while logging mismatch.

#### 7.3.3 `field_interactor -> artifact_emitter` (per-dimension fill result)
Contract object:

```json
{
  "dimension_key": "Data Transfer Out",
  "status": "failed",
  "message": "combobox_option_not_found",
  "retries_used": 2,
  "step": "fill_dimension",
  "screenshot": "outputs/screenshots/cloudfront_fill_dimension_20260301T142211Z.png"
}
```

Aggregator transforms per-dimension results into service counters (`dimensions_filled`, `dimensions_skipped`, `dimensions_failed`) and service-level status.

## 8. ERROR HANDLING DESIGN
### 8.1 Error Taxonomy Table
| Error ID | Layer | Error Class Name | Trigger Condition | Fail Strategy | Retry Count | Screenshot Captured | Artifact Impact | Terminal Message Format |
|---|---|---|---|---|---|---|---|---|
| `E-PROFILE-001` | Profile Load | `FileNotFoundError` | Profile path missing | FAST | 0 | No | `status=preflight_failed`; no groups executed | `[✗] PROFILE_FILE_MISSING path=<path>` |
| `E-PROFILE-002` | Profile Load | `JSONDecodeError` | Invalid JSON syntax | FAST | 0 | No | `status=preflight_failed` | `[✗] PROFILE_JSON_INVALID path=<path> line=<n>` |
| `E-SCHEMA-001` | Schema Validation | `ProfileValidationError` | Missing required field | FAST | 0 | No | `status=preflight_failed` | `[✗] PROFILE_SCHEMA_ERROR field=<json_path> message=<msg>` |
| `E-SCHEMA-002` | Schema Validation | `ProfileValidationError` | Wrong `schema_version` const | FAST | 0 | No | `status=preflight_failed` | `[✗] PROFILE_VERSION_UNSUPPORTED expected=2.0 actual=<v>` |
| `E-CROSS-001` | Cross-field Validation | `ProfileValidationError` | Unknown `service_name` not in catalog | FAST | 0 | No | `status=preflight_failed` | `[✗] CATALOG_SERVICE_UNKNOWN service=<name>` |
| `E-CROSS-002` | Cross-field Validation | `ProfileValidationError` | Region not in map | FAST | 0 | No | `status=preflight_failed` | `[✗] REGION_INVALID service=<s> region=<r>` |
| `E-CROSS-003` | Cross-field Validation | `ProfileValidationError` | Dimension key not in catalog | FAST | 0 | No | `status=preflight_failed` | `[✗] DIMENSION_UNKNOWN service=<s> dimension=<d>` |
| `E-CROSS-004` | Cross-field Validation | `ProfileValidationError` | SELECT value not in options | FAST | 0 | No | `status=preflight_failed` | `[✗] SELECT_OPTION_INVALID service=<s> dimension=<d> value=<v>` |
| `E-RESOLVE-001` | Value Resolution | `ResolutionError` | Required dimension unresolved after chain | FAST | 0 | No | `status=preflight_failed` with unresolved list | `[✗] VALUE_UNRESOLVED group=<g> service=<s> dimension=<d>` |
| `E-RESOLVE-002` | Value Resolution | `ResolutionError` | `--set` target not found | FAST | 0 | No | `status=preflight_failed` | `[✗] OVERRIDE_TARGET_NOT_FOUND key=<group.service.dim>` |
| `E-BROWSER-001` | Browser Launch | `AutomationFatalError` | Playwright launch failure | FAST | 0 | Optional | `status=failed` no service progress | `[✗] BROWSER_LAUNCH_FAILED reason=<msg>` |
| `E-BROWSER-002` | Browser Runtime | `AutomationFatalError` | Browser process crash/disconnect | FAST | 0 | Yes if page available | `status=failed` stop run immediately | `[✗] BROWSER_CRASHED reason=<msg>` |
| `E-NAV-001` | Navigation | `NavigationError` | Group creation controls unavailable | FORWARD | 2 | Yes | Affected group services marked failed | `[✗] GROUP_CREATE_FAILED group=<g> screenshot=<p>` |
| `E-NAV-002` | Navigation | `NavigationError` | Service search no match | FORWARD | 2 | Yes | Service status failed | `[✗] SERVICE_ADD_FAILED service=<s> step=search screenshot=<p>` |
| `E-NAV-003` | Navigation | `NavigationError` | Region option unavailable | FORWARD | 2 | Yes | Service status partial/failed | `[✗] REGION_SET_FAILED service=<s> region=<r> screenshot=<p>` |
| `E-LOC-001` | Find-in-Page Locator | `LocatorError` | No match in find bar | FORWARD | 2 | Yes | Dimension skipped or failed based on required | `[!] DIMENSION_LOCATE_MISS service=<s> dimension=<d> screenshot=<p>` |
| `E-LOC-002` | Find-in-Page Locator | `TimeoutError` | Find/DOM query timeout | FORWARD | 2 | Yes | Dimension failed/skipped | `[✗] DIMENSION_LOCATE_TIMEOUT service=<s> dimension=<d>` |
| `E-FILL-001` | Field Interaction | `FieldInteractionError` | Type mismatch or unsupported type | FORWARD | 2 | Yes | Dimension failed | `[✗] DIMENSION_TYPE_MISMATCH service=<s> dimension=<d> expected=<e> detected=<d>` |
| `E-FILL-002` | Field Interaction | `FieldInteractionError` | Option not found (SELECT/COMBOBOX/RADIO) | FORWARD | 2 | Yes | Dimension failed | `[✗] DIMENSION_OPTION_NOT_FOUND service=<s> dimension=<d> value=<v>` |
| `E-FILL-003` | Field Interaction | `TimeoutError` | Fill/click timeout | FORWARD | 2 | Yes | Dimension failed | `[✗] DIMENSION_FILL_TIMEOUT service=<s> dimension=<d>` |
| `E-ART-001` | Artifact Write | `ArtifactWriteError` | Unable to create outputs directory | FORWARD (end-of-run) | 0 | No | Run may complete without artifact file | `[✗] ARTIFACT_DIR_CREATE_FAILED path=<p>` |
| `E-ART-002` | Artifact Write | `ArtifactWriteError` | JSON write failure | FORWARD (end-of-run) | 0 | No | `run_result.json` absent; terminal summary only | `[✗] ARTIFACT_WRITE_FAILED path=<p> reason=<msg>` |

### 8.2 Retry Policy Implementation
Retries are implemented by a reusable wrapper around navigation, locate, and fill steps. The wrapper catches `TimeoutError`, element lookup misses, and stale element handle errors where retrying is meaningful. Each wrapped operation receives `max_retries=2`, creating up to three total attempts (initial attempt + two retries).

Delay is linear and deterministic: `delay_seconds = 1.5 * retry_index`, where `retry_index` starts at 1 for the first retry. This yields waits of 1.5 seconds before attempt two and 3.0 seconds before attempt three. Retry counters are attached to result structures and terminal messages for post-run diagnosis.

When retries are exhausted:
- For locator failures on optional dimensions (`required=false`), status becomes `SKIPPED` with warning severity.
- For locator or fill failures on required dimensions, status becomes `FAILED` at dimension level and contributes to service `partial_success` or `failed` depending on remaining dimension outcomes.
- For hard-stop classes (browser crash, unrecoverable OS errors), wrapper is bypassed and run terminates immediately.

### 8.3 Screenshot Capture Design
Screenshots are captured when a service or dimension enters a `FAILED` state and when important warning states need visual evidence (for example repeated locator miss). File naming format is:

`<service_id>_<step_name>_<UTC timestamp>.png`

Where:
- `service_id` is a sanitized slug from `service_name` or `human_label`.
- `step_name` is one of `create_group`, `add_service`, `set_region`, `find_dimension`, `fill_dimension`.
- Timestamp format is `YYYYMMDDTHHMMSSZ`.

Screenshots are stored under `outputs/screenshots/`. The relative path is persisted into service-level or dimension-level result objects and then copied into `run_result.json` to preserve portability of artifacts within repository root.

## 9. CONFIGURATION DESIGN
### 9.1 Modular Service Catalog Maintenance (`config/services/*.json`)
Adding a new AWS service requires creating or updating a dedicated service catalog file under `config/services/` (for example `config/services/rds_postgresql.json`) with a complete service object containing `service_name`, `search_term`, `calculator_page_title`, `supported_regions`, and `dimensions`. Every dimension must include `key`, `field_type`, and `required`. For `SELECT` and `RADIO`, `options` should be captured exactly as displayed in calculator UI to avoid normalization ambiguity.

Field type determination process:
1. Open target service in calculator manually.
2. Inspect interaction behavior rather than HTML classes.
3. Map controls to canonical field types:
   - dropdown -> `SELECT`
   - searchable dropdown -> `COMBOBOX`
   - numeric textbox -> `NUMBER`
   - switch -> `TOGGLE`
   - single-choice cards -> `RADIO`
4. Record default values where stable and useful.

Catalog files are loaded by `config/service_catalog_loader.py` and validated against `ServiceCatalogEntry`. Any catalog change requires:
- Updating relevant tests.
- Manual validation checklist execution for modified service.
- Change note in release log referencing changed dimensions.

#### Section Expansion Triggers
Catalog files may optionally include a `section_expansion_triggers` array to declare the correct expansion strategy for each collapsible section:

```json
"section_expansion_triggers": [
  { "label": "Amazon Elastic Block Store", "trigger": "accordion_optional_button" },
  { "label": "Data Transfer",              "trigger": "find_in_page_text_click" }
]
```

- `label` is matched case-insensitively against section names discovered at runtime; catalog authors do not need to reproduce exact UI capitalisation.
- `trigger` must be one of the five strategy IDs documented in `automation/navigator.py`: `accordion_optional_button`, `find_in_page_text_click`, `heading_click`, `associated_checkbox`, `named_button`. Unrecognized values are handled gracefully — a warning is logged and the heuristic waterfall runs as fallback.
- The field defaults to `[]` for services that omit it; existing waterfall behaviour is completely unchanged.
- When a catalog trigger succeeds, all five waterfall strategies are bypassed, reducing noise and latency in section expansion.

Onboarding workflow and evidence capture steps are standardized in:
- `design/UI_EXPLORATION_CHECKLIST.md`

### 9.2 `region_map.json` Maintenance
To add regions, maintain lowercase canonical region codes using AWS format `<partition>-<geography>-<digit>` (for example `me-central-1`). The mapped display value must match AWS calculator text exactly, including punctuation and spacing. Values are discovered by opening region selector in calculator and copying the visible label.

The `global` pseudo-region is included as a special key. Its value is empty string or sentinel text because no region selection interaction occurs. Runner logic checks `region_code.lower() == "global"` and skips region-setting step entirely.

### 9.3 `json-schema.json` Versioning
Schema versioning uses a strict `const` on `schema_version` (`"2.0"`) to reject incompatible documents deterministically. For a future `v3.0`:
- Introduce `config/json-schema-v3.json` with `const: "3.0"`.
- Keep v2 schema available for backward compatibility.
- Add version dispatch in `profile_loader.py` that inspects raw `schema_version` before full validation and chooses matching schema file.
- Maintain migration tooling or explicit upgrade docs if profile shape changes.

`profile_loader.py` behavior for version detection:
1. Parse JSON raw.
2. Read `schema_version` value.
3. Select matching schema validator.
4. If unknown version, raise `ProfileValidationError` with supported versions list.

## 10. TESTING STRATEGY
### 10.1 Unit Tests
Unit tests isolate module behavior with mocks for external dependencies and deterministic fixtures.

`test_profile_loader.py` coverage:
- **Valid profile:** load canonical fixture; assert parsed `ProfileDocument` with expected group/service counts.
- **Missing required field:** omit `groups`; assert schema validation error path.
- **Wrong schema_version:** set `1.0`; assert unsupported version error.
- **Unknown service_name:** include non-catalog service; assert cross-field failure.
- **Invalid region code:** use unsupported code; assert region map validation failure.
- Mocking: filesystem reads can use temporary files; no browser mocks needed.

`test_value_resolver.py` coverage:
- **Resolution outcomes:** per dimension test all statuses (`RESOLVED` via user/default/prompt, `UNRESOLVED`, `SKIPPED`).
- **Batch unresolved report:** multiple unresolved required dimensions produce single exception containing all entries.
- **Override applied:** `--set` changes target value before chain; assert source is `override` and value propagated.
- **Prompt fallback:** mock questionary response for prompt path.
- Mocking: patch prompt API and console output for deterministic assertions.

`test_field_interactor.py` coverage:
- **Each field type interaction:** `NUMBER`, `TEXT`, `SELECT`, `COMBOBOX`, `TOGGLE`, `RADIO` with fake `ElementHandle` behavior.
- **Toggle no-op:** when current state equals desired, assert click not called.
- **Combobox option missing:** assert `FieldInteractionError` path and failed result after retries.
- **Retry behavior:** transient timeout then success on retry increments retry counter.

`test_navigator.py` and `test_find_in_page_locator.py` coverage:
- `navigator`: group creation, service search success, region set success, service-not-found failure.
- `find_in_page_locator`:
  - match found and correct element returned,
  - no match after 2 retries returns `None`,
  - multiple matches uses first in top-to-bottom order,
  - Escape key always issued to close find bar.
- Mocking: mock `Page` keyboard, locator queries, and CDP evaluate responses.

### 10.2 Integration Tests
Integration tests run Playwright headless against a local static or lightweight served mock page that mimics key calculator DOM patterns. The mock page includes:
- Dimension labels as plain text anchors.
- Inputs/selects/combobox-like controls near labels.
- Group/service containers and region selector controls.

Test flow:
1. Start local HTTP server for fixture HTML.
2. Open with Playwright page.
3. Execute `find_in_page_locator` with known labels.
4. Pass returned handles into `field_interactor`.
5. Assert final DOM values and aria states.

This strategy validates locator + interactor end-to-end without reliance on live AWS UI volatility and avoids external network dependence in CI.

### 10.3 End-to-End Test Considerations
Live AWS calculator E2E testing is inherently brittle because there is no dedicated test mode, no stable selector contract, and the UI can change without notice. Network latency, auth-adjacent prompts, and gradual rollout variants can create non-deterministic outcomes.

Recommended manual verification checklist after every catalog update:
1. Run `--dry-run` on representative profiles for each modified service.
2. Execute headed `--run` for each modified service in at least one region.
3. Confirm group creation and service assignment correctness.
4. Validate each modified dimension is located and filled with expected values.
5. Verify run artifact counters and screenshot references.
6. Re-run in headless mode to detect shortcut or rendering differences.
7. Record any changed UI labels and update catalog immediately.

## 11. DEPLOYMENT AND INSTALLATION DESIGN
### 11.1 Installation Steps
1. Verify Python version is 3.11 or newer.
2. Clone repository locally.
3. Install dependencies with pinned requirements.
4. Install Playwright Chromium runtime.
5. Execute dry-run smoke test against example profile.

Command sequence:

```bash
python --version
# expect Python 3.11+

git clone <repo-url> /Users/mac/Git/aws-cost
cd /Users/mac/Git/aws-cost

pip install -r requirements.txt
python -m playwright install chromium

python main.py --dry-run --profile profiles/example.json
```

Expected smoke result: preflight succeeds, resolved dimensions printed, no browser launched, and run artifact generated with `status=dry_run_success`.

### 11.2 Platform-Specific Considerations
Find-in-page shortcut differs by OS:
- macOS uses `Meta+f` (Command+F).
- Windows and Linux use `Control+f`.

Locator must detect OS using `platform.system().lower()` and choose key modifier accordingly. The `Control+Home` scroll reset may behave differently on macOS depending on keyboard mapping; fallback strategy is `Meta+ArrowUp` when `Control+Home` is ineffective. The design should probe for effective top scroll by checking `window.scrollY` after command and apply fallback if still non-zero.

Playwright behavior notes:
- macOS headed mode may require accessibility permissions for consistent keyboard event delivery.
- Windows focus handling can cause find bar to miss keystrokes if page body does not hold focus; locator should click page body before opening find.
- Linux headless in containerized CI may require additional dependencies (`libnss3`, `libatk`, fonts) and sandbox flags handled by Playwright defaults.

### 11.3 Dependency Pinning Strategy
Dependencies are pinned to exact versions in `requirements.txt` to stabilize behavior across environments and time. This is critical because:
- Playwright updates can change input timing, selector behavior, or bundled browser versions.
- AWS calculator UI drift can compound with automation library drift, making diagnosis difficult if both move simultaneously.
- `jsonschema` and `pydantic` changes may alter validation error structures, breaking tests and user-facing diagnostics.

Pinning policy:
- Use exact `==` versions for runtime packages.
- Upgrade via controlled dependency update PR with full regression suite and live-service manual checklist.
- Keep Playwright Python package and installed Chromium version aligned by reinstalling browser binaries after package upgrades.

## 12. KNOWN LIMITATIONS AND FUTURE CONSIDERATIONS
### 12.1 Current Limitations
1. **Multi-page service wizards are not supported in v1.0.** Some AWS services expose multi-step estimate flows where dimensions are split across tabs or wizard pages. Current navigator/interactor assumes a single visible service panel and does not orchestrate page-to-page transitions.
2. **Find-in-Page can fail when labels are split across DOM nodes or hidden text wrappers.** The algorithm depends on contiguous visible text selection. When React renders segmented label fragments with inaccessible text boundaries, `window.getSelection()` may not yield usable geometry.
3. **No parallel service processing.** Services are automated sequentially in one browser tab to preserve deterministic order and simplify state transitions. This increases runtime for large profiles.
4. **Catalog updates are manual and reactive.** If AWS changes field labels, options, or region names, automation may degrade until maintainers manually update affected files under `config/services/*.json` and `region_map.json`.
5. **Windows keyboard focus and Ctrl+F behavior can be inconsistent.** In some environments, global browser accelerators or focus capture can suppress the page-level find interaction, requiring additional focus-click workarounds.
6. **Headless mode may alter Find-in-Page reliability.** Depending on Chromium/headless implementation, find highlighting and selection geometry may differ from headed mode, reducing locator confidence.
7. **No built-in profile migration utility.** Profiles are version-locked by schema const; users with older schema versions must manually adapt files or use external migration scripts.
8. **Limited semantic validation for free-form numeric text units.** Unit fields are metadata only and do not currently enforce conversion or dimensional consistency (for example MiB vs MB).

### 12.2 Extensibility Points
1. **Add new `field_type` in `automation/field_interactor.py`.** Introduce enum expansion in catalog schema and implement dedicated interaction branch with unit tests. This is the primary extension path for new UI control patterns.
2. **Add new service in `config/services/<service_id>.json`.** Extend catalog entries with dimensions, supported regions, and options. Validation and builder flows automatically pick up catalog additions with no code changes if existing field types are sufficient.
3. **Add a new CLI mode in `main.py`.** The mode dispatcher is centralized and can add functions like `--lint-profile`, `--batch-run`, or `--migrate-profile` while reusing loader/resolver modules.
4. **Replace Find-in-Page with official AWS Calculator API integration when available.** Locator abstraction isolates discovery strategy; if AWS exposes stable APIs or selectors, maintainers can substitute `find_in_page_locator` without rewriting field interaction or artifact pipelines.

### 12.3 Recent Reliability Enhancements (2026-02-21)
The current implementation includes five reliability upgrades focused on locator accuracy and preflight confidence:

1. **Section expansion strategy hints**
   - Section expansion uses stable strategy IDs and persists winning strategy by `service_name + section_name` in `config/services/section_strategy_hints.json`.
   - On subsequent runs, hinted strategy executes first and exits early on success; waterfall executes only when hint fails.
   - Hint writes are atomic via temp-file replace.

2. **Catalog-level shared-label disambiguation**
   - `CatalogDimension` supports optional `disambiguation_index` (default `0`).
   - Locator waterfall applies this index after match-set discovery for every strategy.
   - Shared-label hardcoded XPath special-case logic was removed in favor of catalog-driven disambiguation.

3. **Centralized keyboard shortcuts**
   - Platform detection and action shortcut mapping are centralized in `core/keyboard_shortcuts.py`.
   - Logical actions include `FIND_IN_PAGE`, `SELECT_ALL`, and `COPY`.
   - Navigator imports the centralized constants instead of performing local platform checks.

4. **Unknown field-type runtime probe**
   - `FieldType` includes `UNKNOWN`.
   - Interactor performs read-only DOM probe with priority `NUMBER -> SELECT -> COMBOBOX -> TOGGLE -> TEXT`.
   - Inferred type is logged at `WARNING` level for catalog follow-up.
   - Unresolvable probe results in `skipped` dimension outcome with screenshot capture (not hard failure).

5. **Verify mode (`--verify`)**
   - New run mode performs locator-only checks per service/dimension without filling calculator values.
   - Per-dimension status emitted as `FOUND`, `NOT_FOUND`, or `AMBIGUOUS` with matched strategy.
   - Verify exits non-zero if any required catalog dimension is `NOT_FOUND`.
   - `run_result` schema includes `run_mode` and verify statuses (`verify_success`, `verify_failed`).

6. **Group hierarchy control (`parent_group`)**
   - `Group` supports optional `parent_group` (null/omitted means top-level under `My Estimate`).
   - Builder prompts placement for additional groups: top-level or nested under an existing group.
   - Navigator anchors top-level creation to `My Estimate` before clicking `Create group`, preventing accidental nested-group creation from residual selection state.

7. **Catalog-declared section expansion triggers** (2026-02-21)
   - Service catalog JSON files can now declare an explicit `section_expansion_triggers` list per service, each entry carrying `label`, `trigger` (strategy ID), and optional `required` flag.
   - The navigator checks this list before running the heuristic waterfall for each section; if a match is found, the declared strategy is used directly and the waterfall is skipped on success.
   - Failure modes: unrecognised trigger string → `logger.warning` + waterfall fallback; recognised trigger fails → `logger.warning` + waterfall fallback. Section expansion remains non-fatal in all cases.
   - Every expansion outcome (catalog trigger used, hinted strategy used, waterfall strategy, or all exhausted) is logged via `logging.getLogger(__name__)` for operator auditability without additional instrumentation.
   - `ec2.json` demonstrates the field with entries for `Amazon Elastic Block Store`, `Detailed Monitoring`, and `Data Transfer`. All other service files are unchanged, proving backward compatibility.

8. **Automated Explore and Promote Modes** (2026-02-22)
   - Introduced `main.py explore` and `main.py promote` to automate catalog onboarding.
   - Explorer runs a headless 5-phase extraction on the live Calculator UI (Search -> Region parse -> Expand sections -> Exhaust Dropdowns/Toggles -> Generate).
   - Capable of resolving custom AWS `combobox` widgets (via `aria-haspopup` rules) and scraping inner `<option>` values safely.
   - Promoter acts as a structured interactive filter, permitting dimensions cleanup and type verification.

9. **Modular Explorer Core** (2026-02-22)
   - Fully refactored monolithic `explorer/explorer.py` into `explorer/core/` package containing decoupled phases (`phase1_search.py`, `phase4_dimensions.py`, etc.).
   - Exposed standard `explorer.py` facade to maintain original public API.
   - Replaced fragile shell operations with `explorer/file_ops.py` for guarded read/write/unlink paths protecting against `OSError` exceptions across `shutil` operations.

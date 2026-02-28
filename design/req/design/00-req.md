## 1. Purpose

This application has one primary job: eliminate the manual, error-prone process of building AWS cost estimates by combining an interactive profile builder with a browser automator that fills the AWS Pricing Calculator as if a human were doing it by hand.

It does this in two distinct operating modes:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TWO OPERATING MODES                              │
│                                                                         │
│  MODE A — INTERACTIVE BUILDER          MODE B — AUTOMATION RUN          │
│  ─────────────────────────────         ──────────────────────────────   │
│                                                                         │
│  User selects services         ──►     Load existing profile.json       │
│  User enters dimension values  ──►     Resolve all dimension values     │
│  App generates profile.json    ──►     Open AWS Calculator in browser   │
│                                        Fill every field automatically   │
│                                        Emit run-result artifact         │
│                                                                         │
│  Output: profile.json                  Output: run_result.json          │
│          (reusable, versionable)               + screenshots on fail    │
└─────────────────────────────────────────────────────────────────────────┘
```

The two modes are designed to chain: a profile created in Mode A is immediately runnable in Mode B, with no manual editing required. Profiles are plain JSON, human-readable, and version-control friendly — meaning they can be shared across a team, reviewed in pull requests, and re-run on demand.

---

## 2. Scope

### In Scope

**Profile Management**
- Define and enforce a JSON cost profile schema at version `2.0`
- Validate any loaded profile against `json-schema.json` before any work begins
- Support a two-level hierarchy: `groups` containing `services`, matching the AWS Calculator's own grouping model
- Each service carries human-readable labels (`human_label`, per-dimension keys as plain English strings like `"Data Transfer Out"`) alongside automation metadata

**Interactive Profile Builder (Mode A)**
```
┌─────────────────────────────────────────────────────────────┐
│  INTERACTIVE BUILDER FLOW                                   │
│                                                             │
│  Start                                                      │
│    │                                                        │
│    ├─► Name your project / group                           │
│    │                                                        │
│    ├─► Select AWS service from supported list              │
│    │     └─► Enter human label (e.g. "Web Servers")        │
│    │                                                        │
│    ├─► For each dimension of that service:                 │
│    │     ├─► Accept default value                          │
│    │     ├─► Enter a user_value                            │
│    │     └─► Mark as "prompt at run time" (user_value:null)│
│    │                                                        │
│    ├─► Add another service?  ──► Yes (loop) / No           │
│    │                                                        │
│    └─► Write profile.json to disk                          │
└─────────────────────────────────────────────────────────────┘
```

**Value Resolution (shared by both modes)**
- Resolve each dimension at run time using a strict priority chain:
```
  user_value set?       ──► use it
       │ no
       ▼
  default_value set?    ──► use it
       │ no
       ▼
  prompt_message set?   ──► ask user in CLI
       │ no answer / empty
       ▼
  required field?       ──► ABORT before browser opens
  optional field?       ──► skip this dimension silently
```
- All unresolved required dimensions must be caught and reported **before** any browser is launched

**Browser Automation (Mode B)**
- Launch a local browser (headed or headless) and navigate to `https://calculator.aws/#/estimate`
- For each group: create a named service group in the calculator
- For each service within a group:
```
┌──────────────────────────────────────────────────────────────┐
│  PER-SERVICE AUTOMATION SEQUENCE                             │
│                                                              │
│  1. Click "Add Service"                                      │
│  2. Search by service_name  ──► select exact match          │
│  3. Set region from profile                                  │
│  4. For each dimension (in declaration order):              │
│       ├─► Use browser FIND IN PAGE on the dimension key     │
│       │   (e.g. "Data Transfer Out") to locate the field    │
│       ├─► Interact with located field                       │
│       │   (type value / select dropdown / toggle boolean)   │
│       └─► Apply unit if specified (GB, requests, ms…)       │
│  5. Click "Add to my estimate"                              │
│  6. Move service into its group                             │
└──────────────────────────────────────────────────────────────┘
```
- **Find in Page as the field location strategy:** rather than relying on brittle CSS selectors or XPath, the automator triggers the browser's native Find in Page (`Ctrl+F` / `Cmd+F`) using the dimension's plain-English key as the search term, then resolves the nearest interactive input relative to the highlighted match. This makes the automator resilient to AWS UI restructuring as long as the label text remains the same.

```
  FIND IN PAGE STRATEGY
  ─────────────────────────────────────────────────────────
  dimension key: "Data Transfer Out"
       │
       ▼
  Browser Find: locate text "Data Transfer Out" on page
       │
       ▼
  Resolve nearest sibling / parent input element
       │
       ├─► input[type=number]  ──► type the value
       ├─► select / listbox    ──► choose the option
       └─► toggle / checkbox   ──► click to set state
  ─────────────────────────────────────────────────────────
```

**Artifact Emission**
- Write `run_result.json` on every run (success or failure) containing: timestamp, profile name, per-service status, any captured calculator URL
- Capture PNG screenshots automatically on any step failure, saved to `/screenshots/`

---

### Out of Scope

- AWS Billing API, Cost Explorer, or any live account data queries
- Discovering or validating unit pricing rates (the calculator itself handles pricing)
- Cost optimization recommendations or right-sizing suggestions
- Output report generation (Excel, PDF, dashboards)
- Historical cost trend analytics
- Automating services whose calculator configuration requires more than one page/wizard step (flagged as unsupported in the current version; the automator will skip and warn)
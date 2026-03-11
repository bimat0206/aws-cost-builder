# AWS Cost Profile Builder

Chrome Extension + CLI runner for the [AWS Pricing Calculator](https://calculator.aws/).

Capture live AWS Calculator pages with the Chrome Extension, build nested cost profiles, export them as HCL files, and replay them against the calculator with Playwright-powered browser automation — no more manual clicking through dozens of service dimensions.

## Features

- **Chrome Extension (MV3)** — capture live AWS Calculator pages, build profiles with a nested group tree, export `.hcl` files or `.tar.gz` archives
- **HCL DSL format** — declarative, readable, Git-friendly profile files with full nested group support
- **Runner (Mode B)** — headless or headed browser automation that fills the AWS Calculator from a saved profile
- **Dry Run (Mode C)** — validate and resolve a profile without opening a browser
- **Promoter (Mode D)** — promote draft catalog entries into the validated service catalog
- **Export Archive (Mode E)** — package all profiles into a gzip-compressed `.tar.gz`

## Requirements

- Node.js ≥ 18
- Playwright browsers: `npx playwright install chromium`
- Chrome (for the extension)

## Installation

```bash
git clone https://github.com/bimat0206/aws-cost-builder.git
cd aws-cost-builder
npm install
npx playwright install chromium
```

## Chrome Extension Setup

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` directory
4. Navigate to `https://calculator.aws/#/estimate`
5. Configure any service in the calculator
6. Click the extension icon → **Capture Current Page** to import the service into your profile
7. Organize services into nested groups in the popup UI
8. Click **Export .hcl** to download the profile, or **Export Archive** for a `.tar.gz`

## Quick Start (CLI)

Launch the interactive mode picker:

```bash
npm start
```

Or specify a mode directly:

```bash
# Run automation against a saved profile
node main.js --run --profile profiles/my_project.hcl

# Run headless (no browser window)
node main.js --run --profile profiles/my_project.hcl --headless

# Validate a profile without launching a browser
node main.js --dry-run --profile profiles/my_project.hcl

# Promote a draft catalog entry
node main.js --promote

# Export all profiles as a gzip archive
node main.js --export-archive profiles.tar.gz
```

## CLI Options

| Flag | Description |
|---|---|
| `--run` | Run browser automation (Mode B) |
| `--dry-run` | Validate/resolve only (Mode C) |
| `--promote` | Promote a draft catalog (Mode D) |
| `--export-archive [path]` | Export profiles as `.tar.gz` (Mode E) |
| `--profile <path>` | Path to profile `.hcl` or `.json` (required for `--run` and `--dry-run`) |
| `--headless` | Run browser without a visible window (only with `--run`) |
| `--set <expr>` | Override a dimension: `"group.service.dimension=value"` |

## HCL Profile Format

Profiles are written in a readable HCL-like DSL. Groups can be nested to any depth.

```hcl
schema_version = "4.0"
project_name   = "Production Stack"
description    = "Multi-tier AWS infrastructure estimate"

group "web_tier" {
  label = "Web Tier"

  group "compute" {
    label = "Compute Layer"

    service "ec2" "frontend_servers" {
      region      = "us-east-1"
      human_label = "Frontend Servers"

      config_group "Compute" {
        field "Operating System"             = "Linux"
        field "Number of instances"          = 3
        field "Instance type"                = "t3.medium"
        field "Utilization (On-Demand only)" = 100
      }
    }
  }

  service "s3" "static_assets" {
    region      = "us-east-1"
    human_label = "Static Assets Bucket"

    config_group "Storage" {
      field "S3 Standard storage"      = 500
      field "S3 Standard storage Unit" = "GB"
    }
  }
}
```

JSON profiles (schema v2.0, v3.0, and v4.0) are also supported. The loader auto-detects the format by file extension.

### Nested Groups

Groups support arbitrary nesting — a `group` block can contain both `service` blocks and nested `group` blocks:

```hcl
group "tier1" {
  label = "Top Level"

  group "tier2" {
    label = "Nested"

    group "tier3" {
      label = "Deep Nested"

      service "lambda" "processor" {
        region      = "us-east-1"
        human_label = "Event Processor"
        config_group "General" {
          field "Architecture" = "x86_64"
        }
      }
    }
  }
}
```

## Project Structure

```
aws-cost-builder/
├── main.js                  # CLI entry point & mode dispatch
├── automation/              # Playwright browser automation
│   ├── session/             #   Browser session lifecycle
│   ├── navigation/          #   Service page navigation
│   ├── locator/             #   DOM element location (CDP + find-in-page)
│   └── interactor/          #   Form field interaction
├── builder/                 # Layout components & prompts (CLI UI)
│   ├── prompts/             #   Input prompts (select)
│   └── layout/              #   Terminal UI components & colors
├── config/                  # Service catalogs & schemas
│   ├── data/services/       #   Per-service catalog JSON (ec2, s3, lambda…)
│   ├── schemas/             #   JSON Schema definitions
│   └── loader/              #   Catalog loading & validation
├── core/                    # Shared domain logic
│   ├── models/              #   Profile, Catalog, RunResult models
│   ├── profile/             #   Profile loading, serialization, validation
│   ├── resolver/            #   Dimension resolution & override priority chain
│   ├── emitter/             #   Artifact writing, archive writer, screenshots
│   └── retry/               #   Retry wrapper for flaky operations
├── drafts/                  # Draft catalog generation & promotion
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json        #   MV3 manifest
│   ├── popup/               #   Popup UI (HTML + JS + CSS)
│   ├── content/             #   Content script for calculator.aws
│   └── background/          #   Service worker
├── hcl/                     # HCL DSL parser & serializer
│   ├── parser.js            #   Recursive descent parser → ProfileDocument
│   ├── serializer.js        #   ProfileDocument → HCL string
│   └── index.js             #   Exports { parseHCL, serializeHCL } (supports nested groups & config groups)
├── profiles/                # User-created cost profiles (gitignored)
├── artifacts/               # Exploration artifacts & screenshots
├── outputs/                 # Run results (gitignored)
├── tests/                   # Vitest test suites
└── design/                  # UI design guidelines & mocks
```

## Service Catalogs

Each supported AWS service has a catalog file in `config/data/services/` that describes its dimensions, field types, and valid options. Use **Promoter** (Mode D) to move validated draft catalogs into the main service catalog.

Currently supported: **EC2**, **S3**, **Lambda**.

## Archive Export

Export all profiles in `profiles/` as a single gzip-compressed tar archive:

```bash
node main.js --export-archive                  # writes profiles.tar.gz
node main.js --export-archive my-backup.tar.gz # custom path
```

The archive contains one `.hcl` file per profile. Extract with any standard tar tool:

```bash
tar -xzf profiles.tar.gz -C ./restored-profiles/
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Preflight failure (validation, resolution, file not found) |
| `2` | Partial success (some dimensions/services failed) |
| `3` | Browser launch failure |
| `4` | Artifact write failure |
| `5` | Interrupted (Ctrl+C) |

## Testing

```bash
npm test
```

Tests use [Vitest](https://vitest.dev/) and include unit tests, integration tests, and property-based tests (via [fast-check](https://github.com/dubzzz/fast-check)).

## License

Private — not currently published under an open-source license.

# AWS Cost Profile Builder

## Overview

A Chrome Extension + CLI runner for the [AWS Pricing Calculator](https://calculator.aws/).

Use the Chrome Extension to capture live AWS Calculator pages and build cost profiles with nested groups and structured service config groups. Export profiles as HCL files or a gzip-compressed archive. Run the CLI to replay profiles against the live calculator with Playwright-powered browser automation.

## Architecture

- **Runtime**: Node.js 18+ (ESM modules)
- **Entry point**: `main.js`
- **Package manager**: npm
- **Test framework**: Vitest + fast-check (property-based testing)
- **Browser automation**: Playwright (Chromium)
- **Profile format**: HCL DSL (`.hcl`) or JSON (`.json`), schema v7.0 (backwards-compatible with v5.0, v4.0, v3.0, v2.0)

## Project Structure

```
aws-cost-builder/
├── main.js                  # CLI entry point & mode dispatch
├── automation/              # Playwright browser automation
├── builder/                 # Layout components, prompts (used by CLI UI)
├── config/                  # Service catalogs & schemas
├── core/                    # Shared domain logic
├── drafts/                  # Draft catalog generation & promotion
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── popup/               # Extension popup UI
│   ├── content/             # Content script for calculator.aws
│   └── background/          # Service worker
├── hcl/                     # HCL DSL parser & serializer
├── profiles/                # User-created cost profiles (gitignored)
├── artifacts/               # Exploration artifacts & screenshots
├── outputs/                 # Run results (gitignored)
└── tests/                   # Vitest test suites
```

## Modes

- **Mode B (Runner)** — Browser automation against a saved profile
- **Mode C (Dry Run)** — Validate and resolve profile without a browser
- **Mode D (Promoter)** — Promote draft catalog entries to the service catalog
- **Mode E (Export Archive)** — Export `profiles/` directory as a gzip-compressed `.tar.gz`

## Running

```bash
npm start                                              # Interactive mode picker
node main.js --run --profile profiles/my_project.hcl  # Mode B
node main.js --dry-run --profile profiles/my_project.hcl  # Mode C
node main.js --promote                                 # Mode D
node main.js --export-archive profiles.tar.gz          # Mode E
```

## HCL Profile Format

Profiles can be written in HCL DSL (`.hcl`) or JSON (`.json`). HCL is preferred for readability:

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
        field "Operating System"    = "Linux"
        field "Number of instances" = 3
        field "Instance type"       = "t3.medium"
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

Groups can be nested to any depth. Services live inside groups.

## Chrome Extension

Load `extension/` as an unpacked extension in Chrome (Developer Mode). Navigate to `https://calculator.aws/#/estimate`, configure a service, then click "Capture Current Page" in the extension popup. Build your profile with nested groups in the popup UI, then export as `.hcl` or `.tar.gz`.

## Workflow

- **Start application**: `node main.js` (console output type — TUI application)

## Dependencies

- `ajv` — JSON Schema validation
- `js-yaml` — YAML parsing
- `playwright` — Browser automation
- `yargs` — CLI argument parsing

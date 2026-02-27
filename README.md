# AWS Cost Profile Builder

Interactive TUI wizard and browser automation runner for the [AWS Pricing Calculator](https://calculator.aws/).

Define reusable, Git-friendly **cost profiles** as JSON, then replay them against the live calculator with Playwright-powered browser automation — no more manual clicking through dozens of service dimensions.

## Features

- **Builder (Mode A)** — interactive TUI wizard to create cost profiles step-by-step
- **Runner (Mode B)** — headless or headed browser automation that fills the AWS Calculator from a saved profile
- **Dry Run (Mode C)** — validate and resolve a profile without opening a browser
- **Explorer (Mode D)** — discover service dimensions from a live AWS Calculator page and generate draft catalog entries
- **Promoter (Mode E)** — promote draft catalog entries into the validated service catalog

## Requirements

- Node.js ≥ 18
- Playwright browsers (installed automatically via `npx playwright install chromium`)

## Installation

```bash
git clone https://github.com/bimat0206/aws-cost-builder.git
cd aws-cost-builder
npm install
npx playwright install chromium
```

## Quick Start

Launch the interactive mode picker:

```bash
npm start
```

Or specify a mode directly:

```bash
# Build a new cost profile interactively
node main.js --build

# Run automation against a saved profile
node main.js --run --profile profiles/my_project.json

# Run headless (no browser window)
node main.js --run --profile profiles/my_project.json --headless

# Validate a profile without launching a browser
node main.js --dry-run --profile profiles/my_project.json

# Explore a new AWS service and generate a draft catalog
node main.js --explore

# Promote a draft catalog entry
node main.js --promote
```

## CLI Options

| Flag | Description |
|---|---|
| `--build` | Launch the TUI wizard (Mode A) |
| `--run` | Run browser automation (Mode B) |
| `--dry-run` | Validate/resolve only (Mode C) |
| `--explore` | Discover service dimensions (Mode D) |
| `--promote` | Promote a draft catalog (Mode E) |
| `--profile <path>` | Path to profile JSON (required for `--run` and `--dry-run`) |
| `--headless` | Run browser without a visible window (only with `--run`) |
| `--set <expr>` | Override a dimension: `"group.service.dimension=value"` |

## Project Structure

```
aws-cost-builder/
├── main.js                  # CLI entry point & mode dispatch
├── automation/              # Playwright browser automation
│   ├── session/             #   Browser session lifecycle
│   ├── navigation/          #   Service page navigation
│   ├── locator/             #   DOM element location (CDP + find-in-page)
│   └── interactor/          #   Form field interaction
├── builder/                 # Interactive TUI wizard
│   ├── wizard/              #   Multi-step builder flow
│   ├── prompts/             #   Input prompts (select, toggle, field)
│   ├── layout/              #   Terminal UI components & colors
│   ├── preview/             #   YAML preview & syntax highlighting
│   └── policies/            #   Service-specific prompt policies
├── config/                  # Service catalogs & schemas
│   ├── data/services/       #   Per-service catalog JSON (ec2, s3, lambda…)
│   ├── schemas/             #   JSON Schema definitions
│   └── loader/              #   Catalog loading & validation
├── core/                    # Shared domain logic
│   ├── models/              #   Profile, Catalog, RunResult models
│   ├── profile/             #   Profile loading, serialization, validation
│   ├── resolver/            #   Dimension resolution & override priority chain
│   ├── emitter/             #   Artifact writing & screenshot management
│   └── retry/               #   Retry wrapper for flaky operations
├── explorer/                # Service dimension discovery
│   ├── core/                #   Multi-phase exploration pipeline
│   ├── scanner/             #   DOM scanning & option extraction
│   ├── confidence/          #   Confidence scoring for discovered fields
│   ├── draft/               #   Draft catalog generation & promotion
│   └── wizard/              #   Interactive explorer TUI
├── profiles/                # User-created cost profiles (gitignored)
├── artifacts/               # Exploration artifacts & screenshots
├── outputs/                 # Run results (gitignored)
├── tests/                   # Vitest test suites
└── design/                  # UI design guidelines & mocks
```

## Profiles

A profile is a JSON file describing one or more AWS services and their configuration dimensions:

```json
{
  "project_name": "my-web-app",
  "groups": [
    {
      "group_name": "compute",
      "services": [
        {
          "service_name": "ec2",
          "region": "US East (N. Virginia)",
          "dimensions": [
            { "key": "Operating system", "value": "Linux" },
            { "key": "Number of instances", "value": "3" }
          ]
        }
      ]
    }
  ]
}
```

Profiles live in `profiles/` and are gitignored by default (they may contain project-specific AWS config). Use `--build` to create one interactively.

## Service Catalogs

Each supported AWS service has a catalog file in `config/data/services/` that describes its dimensions, field types, and valid options. Use the **Explorer** (Mode D) to discover dimensions for new services, then **Promote** (Mode E) to add them to the catalog.

Currently supported: **EC2**, **S3**, **Lambda** (+ any services you explore and promote).

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

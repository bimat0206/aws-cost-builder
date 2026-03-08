# AWS Cost Profile Builder

## Overview

An interactive TUI (terminal UI) wizard and browser automation runner for the [AWS Pricing Calculator](https://calculator.aws/).

Define reusable, Git-friendly cost profiles as JSON, then replay them against the live calculator with Playwright-powered browser automation.

## Architecture

- **Runtime**: Node.js 18+ (ESM modules)
- **Entry point**: `main.js`
- **Package manager**: npm
- **Test framework**: Vitest + fast-check (property-based testing)
- **Browser automation**: Playwright (Chromium)

## Project Structure

```
aws-cost-builder/
├── main.js                  # CLI entry point & mode dispatch
├── automation/              # Playwright browser automation
├── builder/                 # Interactive TUI wizard
├── config/                  # Service catalogs & schemas
├── core/                    # Shared domain logic
├── explorer/                # Service dimension discovery
├── profiles/                # User-created cost profiles (gitignored)
├── artifacts/               # Exploration artifacts & screenshots
├── outputs/                 # Run results (gitignored)
└── tests/                   # Vitest test suites
```

## Modes

- **Mode A (Builder)** — Interactive TUI wizard to create cost profiles
- **Mode B (Runner)** — Browser automation against a saved profile
- **Mode C (Dry Run)** — Validate and resolve profile without a browser
- **Mode D (Explorer)** — Discover service dimensions from the live AWS Calculator
- **Mode E (Promoter)** — Promote draft catalog entries to the service catalog

## Running

```bash
npm start           # Interactive mode picker
node main.js --build        # Mode A
node main.js --run --profile profiles/my_project.json   # Mode B
node main.js --dry-run --profile profiles/my_project.json  # Mode C
node main.js --explore      # Mode D
node main.js --promote      # Mode E
```

## Workflow

- **Start application**: `node main.js` (console output type — TUI application)

## Dependencies

- `ajv` — JSON Schema validation
- `js-yaml` — YAML parsing
- `playwright` — Browser automation
- `yargs` — CLI argument parsing

# ADR 0004: Command Catalog

Status: Accepted (Implemented)
Date: 2026-05-29

## Context

Hephaestus currently accepts structured plans with command strings and enforces
an allowlist at runtime. This protects the machine, but it still creates
planner/runtime mismatch. The metrics history includes command allowlist
denials and platform-specific command shape issues.

On Windows, `npm.cmd` is the reliable executable shape, while direct PowerShell
resolution of `npm.ps1` can hit script execution policy. The model should not
need to learn that detail.

## Decision

Introduce a declarative command catalog. The model should normally emit command
IDs, not free-form shell strings.

Example model action:

```json
{
  "name": "command.run",
  "arguments": {
    "commandId": "test_runtime",
    "scope": "runtime"
  }
}
```

The command catalog maps command IDs to platform-specific argv:

- Windows: `["npm.cmd", "test", "--", "test/runtime.test.ts"]`
- POSIX: `["npm", "test", "--", "test/runtime.test.ts"]`

The same catalog should drive prompt instructions, plan validation, runtime
enforcement, UI explanations, CLI repair hints, and tests.

## Consequences

- Planner/runtime mismatch moves from shell strings to explicit policy.
- Free-form commands become a higher-risk or approval-required path.
- Verification command evidence can store stable command IDs.
- The command catalog becomes part of the policy snapshot for every attempt.
- Attempts record command ID usage and allowlist-denial telemetry so catalog
  adoption is measurable.

## Follow-Up

- Initial command IDs are defined for build, lint, tests, model diagnostics,
  and metrics commands.
- Plan prompt generation exposes command IDs from the catalog.
- Runtime rejects unknown command IDs before execution.

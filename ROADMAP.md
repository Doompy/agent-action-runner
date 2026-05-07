# Roadmap

This project is focused on a safety boundary between agents and TypeScript backends. It should not grow into a general workflow engine before the action, policy, approval, and audit contracts are solid.

## v0.2.x

- `v0.2.1` added the first Express operational example.
- `v0.2.2` added the NestJS operational example and shared admin ops example package.
- `v0.2.3` added the Fastify operational example using the shared admin ops package.

## v0.3.0

- Added `@agent-action-runner/mcp`.
- Export registered actions as MCP tools.
- Export read, draft, and dryRun actions by default.
- Keep mutate export disabled unless explicitly configured.
- Move Next.js adapter to later, after demand is clearer.

## v0.3.1

- Added runnable MCP stdio examples.
- Added an MCP admin ops example that reuses the shared operational domain.
- Kept `mutate` actions hidden by default in the MCP examples.

## v0.3.2

- Added MCP exporter diagnostics for skipped actions.
- Preserved the exported catalog API while adding a report API for debugging.

## v0.4.0

- Added a type-safe workflow builder.
- Added typed action catalog helpers.
- Improved input/output inference for registered actions.
- Kept the builder as JSON Workflow generation, not arbitrary TypeScript execution.

## v0.4.1

- Add the first CLI package for manifest-based local inspection.
- Validate workflow JSON before execution.
- Generate action docs and preview MCP exports from an action manifest.
- Keep CLI config JSON-only and avoid framework auto-discovery.

## v0.4.2

- Added CLI runner module loading for local workflow smoke-runs.
- Added CLI `mcp:serve` for stdio MCP export from a compiled runner module.
- Kept mutate blocked by default and requiring explicit local opt-in.

## v0.4.3

- Added runner-based action manifest export.
- Added runner-based docs and doctor commands.
- Reduced the need to maintain `.agent-runner/actions.json` manually.

## v0.4.4

- Added runner-backed workflow validation.
- Added CLI smoke checks to CI.
- Polished CLI output flags and local loop docs.

## v0.4.6

- Expanded package-level README documentation for npm package pages.
- Kept the release docs-only with no runtime API changes.

## v0.5.0

- Added a persistent admin ops example with file-backed approval records and append-only audit JSONL.
- Added a delivery ops example for failed job retry workflows.
- Added delivery ops CLI artifacts for manifest inspection, workflow validation, workflow smoke-runs, and MCP preview.
- Added core helpers for stable input hashing and audit store wiring.
- Kept Redis, Prisma, and production approval service packages out of scope until the example pattern is validated.

## v0.6.0

- Added action metadata for API reuse documentation, CLI output, HTTP action summaries, and MCP tool descriptions.
- Added workflow reliability controls: timeout, fixed retry, and continue-on-error.
- Added API reuse documentation that clarifies agents call registered actions and do not execute generated TypeScript.
- Kept visual builder, Next.js adapter, Redis/Prisma integrations, loop/parallel/rollback DSL, and arbitrary code execution out of scope.

## v0.6.1

- Redacted raw approval tokens from audit events and exposed only `approvalTokenHash`.
- Added runtime workflow validation inside `executeWorkflow()`.
- Added HTTP workflow caps for externally exposed workflow endpoints.
- Clarified Zod 4 requirements for MCP/CLI JSON Schema serialization.

## v0.6.2

- Added audit data minimization controls for action input, output, and error payloads.
- Added runner-level `auditDefaults` and action-level `auditPolicy`.
- Added exact JSON Pointer `redactPaths` support.
- Added security, MCP security, NestJS production, audit redaction, and release checklist docs.
- Kept persistence packages, idempotency, OpenTelemetry, and policy helpers out of scope.

## v0.7.0 Candidates

- First-class `idempotencyKey` propagation through action execution context.
- Approval single-use consumption, audit append, execution attempt tracking, and idempotency key examples.
- Prisma or generic SQL production pattern documentation before adding a package.
- Consider a NestJS + Prisma operational example before extracting a persistence package.
- Optional package extraction later: `@agent-action-runner/prisma` or `@agent-action-runner/sql-audit` after demand is clearer.
- Workflow DSL extensions after reliability basics are validated: condition, parallel execution, and rollback hooks.

## v0.8.0 Candidates

- OpenTelemetry integration, likely as a separate package and runner wrapper.
- Small policy composition helpers.
- Testing utilities for action execution, approval, audit, redaction, and idempotency assertions.
- OpenAPI export and workflow explain/graph tooling if schema serialization remains stable.

## Later

- Next.js adapter, after demand is clearer.
- Read-only TypeScript analyzer experiments, if they help generate action docs without executing code.
- No arbitrary TypeScript runner unless the safety model changes substantially.
- Visual builder only after action metadata, workflow execution, and operational examples prove demand.

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

## v0.6.3

- Hardened audit `output: 'summary'` fallback so it reports payload shape instead of serializing full output.
- Added runtime validation for audit `redactPaths`.
- Split audit policy behavior into dedicated unit tests.
- Added release consistency tooling to reduce version, changelog, lockfile, and internal peer range drift.
- Improved README/API reuse positioning around avoiding repeated MCP, HTTP, workflow, docs, and test wrappers.

## v0.7.0

- Added first-class `idempotencyKey` propagation through action execution context.
- Added workflow step idempotency keys and builder support.
- Added audit `idempotencyKeyHash` fingerprints without storing raw keys.
- Added HTTP server-side idempotency key resolvers for direct actions and workflow steps.
- Expanded Prisma production pattern documentation for approval single-use consume, idempotency reserve/replay, audit append, and retry race conditions.
- Kept MCP idempotency hooks, Prisma packages, and NestJS + Prisma operational examples out of scope until the production pattern is validated.

## v0.7.1

- Added MCP idempotency key resolver hooks.
- Fixed MCP default server version drift by reading the package manifest.
- Added workflow validation for step allowed mode mismatches.
- Added Express body parser control for production body limit ownership.
- Improved NestJS duplicate action discovery errors.
- Documented stable hash `undefined` normalization.

## v0.8.0

- Added cooperative `AbortSignal` support for cancellable handlers. Timeout remains cooperative, not forced cancellation.
- Added small policy composition helpers in core.
- Added `@agent-action-runner/testing` for framework-neutral action, approval, policy, and audit test harnesses.
- Added `@agent-action-runner/opentelemetry` as a wrapper-based instrumentation package.
- Added CLI `actions:openapi`, `workflow:explain`, and `workflow:graph`.
- Polished MCP idempotency callback typing and documentation around raw MCP input.

## v0.8.1

- Made OpenTelemetry defaults safer by excluding high-cardinality `userId`, `workflowId`, and `stepId` attributes unless explicitly opted in.
- Added workflow-level signal propagation and abort-aware retry delays.
- Aligned CLI OpenAPI paths with URL-encoded original action names.
- Hardened Mermaid graph node id generation and testing audit text helpers.

## v0.8.2

- Added product positioning docs for MCP, agent framework integration, and production readiness.
- Added a NestJS + Prisma approval/idempotency/audit production-pattern example.
- Improved CLI OpenAPI output with action response schemas and common error responses.

## v0.8.x Candidates

- Consider safer audit defaults during a pre-1.0 breaking window. Until then, production docs continue to recommend explicit `auditDefaults`.
- Consider MCP/CLI OpenAPI schema diagnostics if Zod serialization edge cases become common.
- Consider Jest/Vitest matchers in `@agent-action-runner/testing` after the framework-neutral helper API stabilizes.
- Validate the NestJS + Prisma approval/idempotency example against a few real backend shapes before extracting a Prisma package.

## v0.9.0 Candidates

- Optional package extraction later: `@agent-action-runner/prisma` or `@agent-action-runner/sql-audit` after demand is clearer.
- Workflow DSL extensions after reliability basics are validated: condition, parallel execution, and rollback hooks.

## Later

- Next.js adapter, after demand is clearer.
- Read-only TypeScript analyzer experiments, if they help generate action docs without executing code.
- No arbitrary TypeScript runner unless the safety model changes substantially.
- Visual builder only after action metadata, workflow execution, and operational examples prove demand.

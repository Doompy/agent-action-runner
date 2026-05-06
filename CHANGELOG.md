# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning before 1.0 with the usual pre-1.0 caveat: public APIs may change between minor versions while the core contracts settle.

## [0.2.3] - 2026-05-06

### Added

- Added `examples/fastify-admin-ops`, a Fastify operational example showing `read -> dryRun -> approve -> mutate -> audit`.

### Changed

- Updated the operational example docs to cover Express, NestJS, and Fastify.

### Notes

- No public package APIs changed.
- Public package versions remain `0.2.0`; this is an example and documentation update.
- This completes the initial `v0.2.x` operational example line.

## [0.2.2] - 2026-05-06

### Added

- Added `examples/shared-admin-ops`, a private shared example package for admin users, approval helpers, audit helpers, and action handlers.
- Added `examples/nestjs-admin-ops`, a NestJS operational example showing `read -> dryRun -> approve -> mutate -> audit` with `@AgentAction()` and NestJS DI.

### Changed

- Refactored `examples/express-admin-ops` to use the shared admin ops example package.
- Updated the operational example docs to cover both Express and NestJS.

### Notes

- No public package APIs changed.
- Public package versions remain `0.2.0`; this is an example and documentation update.
- Fastify operational example remains planned for `v0.2.3`.

## [0.2.1] - 2026-05-06

### Added

- Added `examples/express-admin-ops`, an operational Express example showing `read -> dryRun -> approve -> mutate -> audit`.
- Added an HMAC-bound approval token demo that binds approval to `userId`, `actionName`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`.
- Added an in-memory audit trail example for action execution events.

### Notes

- No public package APIs changed.
- Public package versions remain `0.2.0`; this is an example and documentation update.

## [0.2.0] - 2026-05-06

### Added

- Added `@agent-action-runner/http` with shared HTTP response shapes, action/workflow execution helpers, server-side request context handling, and error mapping.
- Added `@agent-action-runner/express` with `createExpressAdapter()`.
- Added `@agent-action-runner/fastify` with `agentRunnerFastifyPlugin`.
- Added `ROADMAP.md` with the planned Next.js adapter, workflow builder, audit/approval examples, and MCP exporter direction.

### Changed

- Bumped public package versions to `0.2.0`.
- Updated package dry-run checks to cover `core`, `nestjs`, `http`, `express`, and `fastify`.

### Notes

- HTTP adapters require server-side `getUserId` resolver configuration.
- Client-supplied execution options are ignored by default. Enable `allowClientExecutionOptions` only for trusted/internal use cases.

## [0.1.0] - 2026-05-06

### Added

- Added `@agent-action-runner/core` with action registration, sequential workflow execution, Zod input/output validation, mode enforcement, policy hooks, approval hooks, audit hooks, and restricted step output references.
- Added `@agent-action-runner/nestjs` with `@AgentAction()`, `AgentRunnerModule.forRoot()`, provider discovery, and `InjectAgentRunner()`.
- Added mutate approval contract fields, including deterministic `inputHash`, optional `resourceIds`, optional `dryRunHash`, optional `expiresAt`, `workflowId`, and `stepId`.
- Added a basic executable workflow example.
- Added GitHub Actions CI for build, typecheck, tests, and package dry-run checks.

### Changed

- Prepared package metadata for public npm publishing under the `@agent-action-runner` scope.
- Moved Zod to peer dependency for public package consumers.

### Notes

- The packages are experimental / pre-1.0.
- Core does not issue or sign approval tokens. Applications must validate approval tokens against the approval context.
- Actual npm publishing is manual and requires access to the `@agent-action-runner` npm scope.

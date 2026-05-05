# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning before 1.0 with the usual pre-1.0 caveat: public APIs may change between minor versions while the core contracts settle.

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

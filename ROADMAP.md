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

- Add persistent audit examples.
- Add approval token binding examples.
- The first in-memory approval/audit examples were added in v0.2.1 and v0.2.2; v0.5.0 should focus on persistence and production integration patterns.
- Start with examples before publishing Redis or Prisma integration packages.

## Later

- Next.js adapter, after demand is clearer.
- Workflow DSL extensions: condition, retry, timeout, and parallel execution.
- Read-only TypeScript analyzer experiments.
- Sandboxed TypeScript runner only after the safety model is mature.

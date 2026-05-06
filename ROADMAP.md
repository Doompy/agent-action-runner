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

## v0.4.0

- Add a type-safe workflow builder.
- Add typed action catalog helpers.
- Improve input/output inference for registered actions.
- Keep the builder as JSON Workflow generation, not arbitrary TypeScript execution.

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

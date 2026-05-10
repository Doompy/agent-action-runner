# Agent Framework Integration

Agent Action Runner is not an agent reasoning framework.

Use LangChain, Vercel AI SDK, OpenAI Agents SDK, Mastra, or another framework for planning, model calls, memory, routing, and agent behavior. Use Agent Action Runner to expose your TypeScript backend actions safely.

## Boundary

```txt
agent framework
  -> chooses a tool/action
  -> calls HTTP or MCP
  -> Agent Action Runner validates, checks policy, approval, audit, idempotency
  -> existing backend service method runs
```

The framework decides what to do. The backend decides what is allowed.

## Integration Options

### HTTP

Use `@agent-action-runner/express`, `@agent-action-runner/fastify`, or `@agent-action-runner/http` helpers when your agent framework can call HTTP endpoints.

The HTTP adapters keep execution context server controlled:

- `getUserId(request)`
- `getAllowedModes(request)`
- `getApprovalToken(request)`
- `getApprovalContext(request)`
- `getIdempotencyKey(request)`
- `getMetadata(request)`

Client request bodies are not trusted for these values by default.

### MCP

Use `@agent-action-runner/mcp` when your agent framework or client can consume MCP tools.

The MCP exporter hides `mutate` actions by default. If you opt into mutation export, the action still goes through core mode checks, policy, approval, audit, and idempotency hooks.

### CLI

Use `@agent-action-runner/cli` for local development:

- inspect actions
- validate workflow JSON
- run read/dryRun smoke workflows
- preview MCP tools
- export OpenAPI docs
- graph workflow dependencies

## What The Framework Should Not Own

Keep these in the backend:

- authorization rules
- tenant and resource scoping
- approval lifecycle
- mutation transactions
- idempotency reserve/replay
- audit redaction
- durable audit storage

Agent prompts can request work, but backend services should remain the authority for side effects.

## Example Mental Model

```txt
OpenAI Agents SDK plans: "disable inactive user after review"
  -> calls admin.dryRunDisableUser
  -> operator approves dry-run
  -> calls admin.disableUser
  -> Agent Action Runner enforces mutate mode, approval, audit, idempotency
  -> NestJS service performs Prisma transaction
```

The agent framework creates the plan. Agent Action Runner protects the backend boundary.

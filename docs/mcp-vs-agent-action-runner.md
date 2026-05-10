# MCP vs Agent Action Runner

MCP and Agent Action Runner solve different parts of the tool-calling problem.

MCP tells clients how to call tools.

Agent Action Runner helps your backend decide what tools exist, who may call them, which modes are allowed, when approval is required, how calls are audited, and how retries stay idempotent.

## Use MCP For Transport

MCP is useful when you want a standard interface that AI clients can discover and call:

- expose tools to MCP-compatible clients
- share tools across local clients and agent environments
- use stdio or HTTP transports
- describe tool input and output contracts

Agent Action Runner can export registered actions as MCP tools through `@agent-action-runner/mcp`.

## Use Agent Action Runner For The Backend Boundary

Backend systems need decisions that MCP itself should not own:

- Which existing service methods are safe to expose?
- Is this action `read`, `draft`, `dryRun`, or `mutate`?
- Which user is calling it?
- Which role, scope, tenant, or resource policy applies?
- Is human approval required?
- Has a dry-run already produced the current approval context?
- What should be written to audit logs?
- How should retry-safe mutations receive idempotency keys?

Agent Action Runner keeps those decisions in your application boundary.

## Typical Stack

```txt
LangChain / Vercel AI SDK / OpenAI Agents / Mastra / MCP client
  -> MCP or HTTP tool call
  -> Agent Action Runner action boundary
  -> application service or use-case method
  -> database / queue / external API
```

MCP is the client-facing tool protocol. Agent Action Runner is the server-side action governance layer.

## Why Not Register MCP Tools Directly?

Direct MCP tools are fine for small or standalone integrations.

They become harder to maintain when the same service method also needs:

- HTTP execution
- workflow execution
- CLI smoke-runs
- generated docs and manifests
- approval and audit hooks
- policy checks
- idempotency handling
- OpenTelemetry instrumentation
- test harness support

Agent Action Runner centralizes that wrapper once as a registered action, then reuses it across surfaces.

## Recommended Rule

Use MCP SDK directly when the tool is a small standalone integration.

Use Agent Action Runner when the tool calls your application backend and must share auth, policy, transaction, approval, audit, idempotency, and observability patterns with the rest of the system.

# API Reuse Guide

Agent Action Runner is an API reuse layer for TypeScript backends.

It does not execute agent-generated code. Agents can only call actions that the application has registered, validated, and guarded.

## Core Idea

```txt
existing service method
  -> registered Agent Action
  -> JSON Workflow
  -> policy / approval / audit
  -> HTTP, CLI, or MCP exposure
```

The application stays in charge of authentication, authorization, transactions, persistence, and side effects. The runner provides a narrow execution boundary for agents.

## Wrapping Existing Services

```ts
runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  description: 'Search delivery jobs by status, campaign, and retryability.',
  tags: ['delivery', 'operations'],
  resourceType: 'deliveryJob',
  riskLevel: 'low',
  inputSchema: SearchJobsInputSchema,
  outputSchema: SearchJobsOutputSchema,
  handler: (input, ctx) => {
    return deliveryService.searchJobs({
      ...input,
      operatorId: ctx.userId,
    });
  },
});
```

The handler should call your existing service or use-case layer. It should not duplicate business rules in a separate agent-only path.

## Why Not Just Write Tools Directly?

Without a shared action layer, the same backend service often gets wrapped repeatedly:

- one wrapper for MCP
- one wrapper for HTTP
- one wrapper for local tests
- one wrapper for workflow execution
- one wrapper for docs and manifests

Agent Action Runner centralizes that wrapper into a registered action. The same action registry can then feed HTTP adapters, MCP tools, CLI smoke-runs, workflow execution, manifests, and generated docs.

## Mutation Pattern

Use narrow mutation actions and keep broad read actions filter-based.

```txt
delivery.searchJobs      read
delivery.dryRunRetry     dryRun
delivery.executeRetry    mutate approvalRequired
```

Mutations should be:

- explicit and narrow
- schema validated
- policy checked
- dry-run driven when possible
- approval gated
- audited

Audit events expose `approvalTokenHash` only as a redacted fingerprint for correlation. Do not treat it as a secure approval token store; use a secret-backed HMAC or sufficiently random approval token in the approval service.

For production, configure audit minimization before adding durable audit storage:

```ts
createRunner({
  auditDefaults: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: ['/password', '/token', '/secret'],
  },
});
```

Use action-level `auditPolicy` for high-risk actions that need stricter handling than the runner default.

## Workflow Reliability

Workflow steps can define local reliability controls:

```json
{
  "id": "jobs",
  "action": "delivery.searchJobs",
  "input": {
    "status": ["FAILED"]
  },
  "timeoutMs": 1000,
  "retry": {
    "maxAttempts": 2,
    "delayMs": 50
  }
}
```

`timeoutMs` marks an action attempt as failed after the configured duration. It does not cancel underlying Node.js work that has already started.

Avoid retrying non-idempotent mutations unless the service method is designed for it. A production mutation should usually combine an idempotency key, approval single-use consumption, the business side effect, and audit append in the same transaction boundary.

Use `continueOnError: true` only when a failed step is expected and downstream steps can safely consume the failure result.

## Exposure Options

- HTTP adapters expose actions to your own application endpoints.
- MCP exporter exposes eligible actions as MCP tools.
- CLI validates and smoke-runs workflows locally.

All three reuse the same registered action boundary.

## What This Is Not

- not an arbitrary TypeScript runner
- not a sandbox for agent-generated code
- not a replacement for application auth
- not a general n8n-style visual workflow platform
- not a database access layer

The intended model is controlled API reuse, not code execution.

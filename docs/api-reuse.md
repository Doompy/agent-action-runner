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

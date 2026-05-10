# Production Checklist

Use this checklist before exposing a backend action to an agent, MCP client, HTTP endpoint, workflow, or local smoke-run.

## Action Definition

- Does the action wrap an existing service or use-case method?
- Is the action name stable and scoped, such as `delivery.searchJobs`?
- Is `mode` correct: `read`, `draft`, `dryRun`, or `mutate`?
- Does it declare `description`, `tags`, `resourceType`, and `riskLevel`?
- Does it have `inputSchema`?
- Does it have `outputSchema`?
- Is the mutation action narrow rather than a broad arbitrary update?

## Read / Dry-Run / Mutate Flow

- Is there a read action to identify target resources?
- Is there a dry-run action for operational changes?
- Does dry-run return resource ids and a stable dry-run hash?
- Does the mutate action require the dry-run context?
- Is the mutate action blocked by default unless `mutate` mode is explicitly allowed?

## Authorization And Policy

- Is `userId` resolved server-side?
- Are roles/scopes/tenant/resource metadata resolved server-side?
- Are policy hooks or helper policies configured?
- Are object-level permissions enforced in the application service?
- Are deprecated or high-risk actions blocked where appropriate?

## Approval

- Does every `mutate` action require approval?
- Is the approval token bound to `userId`, `actionName`, `mode`, `inputHash`, `resourceIds`, and `dryRunHash`?
- Does approval expire?
- Is approval consumed exactly once inside the mutation transaction?
- Are raw approval tokens excluded from audit logs?

## Audit

- Are audit hooks configured?
- Are raw approval tokens and raw idempotency keys excluded?
- Are production `auditDefaults` configured?

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

- Are action-specific `auditPolicy` settings stricter for high-risk actions?
- Does durable audit storage avoid sensitive input/output/error payloads?

## Idempotency And Retry

- Does each retryable mutation receive an application-defined `idempotencyKey`?
- Is the key reserved before side effects?
- Can successful results be replayed?
- Are in-progress duplicates rejected or handled safely?
- Are timeout and retry settings safe for the underlying operation?
- Does the handler pass `ctx.signal` to cancellable clients where possible?

## HTTP / MCP Exposure

- Are HTTP execution options resolved server-side?
- Are workflow caps configured for public endpoints?
- Is request body size limited by the host framework?
- Are MCP `mutate` tools hidden by default?
- If mutation tools are exported, are they approval-gated and idempotent?

## Observability

- Is OpenTelemetry instrumentation configured?
- Are high-cardinality attributes such as user id and workflow id opt-in only?
- Are action failures, timeouts, policy rejections, and approval failures visible?

## Testing

- Do action tests cover policy, approval, audit, and idempotency behavior?
- Does the audit test assert that raw tokens/secrets are absent?
- Are workflow JSON files validated in CI?
- Are CLI smoke-runs limited to read/dryRun unless mutation is intentional?

# Security Model

Agent Action Runner is an agent-safe backend boundary. It is not an arbitrary code runner.

## Core Principles

- Agents can only call registered actions.
- Registered actions should wrap existing service or use-case methods.
- The application owns authentication, authorization, transactions, persistence, and side effects.
- `mutate` actions should be narrow, approval-gated, policy-checked, audited, and idempotent.
- Audit stores should keep the minimum data needed for investigation.

## No Agent-Generated Code Execution

The runner does not evaluate TypeScript, JavaScript, SQL, shell commands, or model-generated code. TypeScript support is limited to typed authoring helpers that emit JSON workflow definitions.

## Mutation Safety

For production mutation actions:

```txt
validate input
  -> policy check
  -> dry-run where possible
  -> approval verification
  -> idempotency/transaction boundary
  -> side effect
  -> audit append
```

`timeoutMs` is not forced cancellation. It marks an attempt as failed from the runner's perspective and aborts `ctx.signal`, but the handler's underlying Node.js work may still complete unless the handler passes that signal into cancellable APIs. Avoid retrying non-idempotent mutations unless the service method is designed around an idempotency key, transaction, and single-use approval consume.

Core passes `idempotencyKey` to the handler context when the application provides one. The runner does not generate, reserve, lock, persist, or replay idempotency keys. Treat the key as an application-level transaction input:

```ts
handler: async (input, ctx) => {
  ctx.requireApproval();

  return prisma.$transaction(async (tx) => {
    await consumeApprovalOnce(tx, ctx.approvalContext);
    await reserveIdempotencyKey(tx, {
      key: ctx.idempotencyKey,
      actionName: ctx.actionName,
      userId: ctx.userId,
    });

    return retryJob(tx, input.jobId);
  });
}
```

Audit events include `idempotencyKeyHash` instead of the raw key. The hash is for correlation, not a lock or replay store.

## Approval Tokens

Core audit events never include raw approval tokens. They include `approvalTokenHash` only as a redacted correlation fingerprint.

Approval services should own:

- token generation entropy
- token signing or HMAC strategy
- expiry
- binding to `userId`, `actionName`, `inputHash`, `resourceIds`, and `dryRunHash`
- single-use consume for mutations
- operator identity and review metadata

## Audit Data

By default, audit payload behavior remains compatible with earlier releases. For production, configure `auditDefaults` and action-level `auditPolicy` to minimize input, output, and error data.

See [Audit Redaction](./audit-redaction.md).

## HTTP Exposure

HTTP adapters resolve execution context through server-side hooks. Do not trust request body fields for user identity, allowed modes, approval tokens, approval context, or metadata unless an internal endpoint explicitly opts into that behavior.

Workflow endpoints apply default caps for max steps, timeout, retry attempts, and retry delay. Request payload byte limits remain the host framework body parser's responsibility.

## MCP Exposure

MCP export defaults to `read`, `draft`, and `dryRun` actions. `mutate` tools are hidden unless explicitly opted in and approval-gated.

See [MCP Security](./mcp-security.md).

## Runtime Versions

Contributor tooling in this repository expects Node.js `>=20`. Published packages target consumer runtimes on Node.js `>=18.18`.

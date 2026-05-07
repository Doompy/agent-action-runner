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

`timeoutMs` is not cancellation. It marks an attempt as failed from the runner's perspective, but the handler's underlying Node.js work may still complete. Avoid retrying non-idempotent mutations unless the service method is designed around an idempotency key, transaction, and single-use approval consume.

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

By default, `v0.6.2` keeps audit payload behavior compatible with earlier releases. For production, configure `auditDefaults` and action-level `auditPolicy` to minimize input, output, and error data.

See [Audit Redaction](./audit-redaction.md).

## HTTP Exposure

HTTP adapters resolve execution context through server-side hooks. Do not trust request body fields for user identity, allowed modes, approval tokens, approval context, or metadata unless an internal endpoint explicitly opts into that behavior.

Workflow endpoints apply default caps for max steps, timeout, retry attempts, and retry delay. Request payload byte limits remain the host framework body parser's responsibility.

## MCP Exposure

MCP export defaults to `read`, `draft`, and `dryRun` actions. `mutate` tools are hidden unless explicitly opted in and approval-gated.

See [MCP Security](./mcp-security.md).

## Runtime Versions

Contributor tooling in this repository expects Node.js `>=20`. Published packages target consumer runtimes on Node.js `>=18.18`.

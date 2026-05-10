# NestJS Prisma Approval Ops Example

This example shows the production pattern for a NestJS backend that exposes existing admin operations as agent-safe actions while keeping approval, idempotency, mutation, and audit persistence inside the application boundary.

It uses:

- `@agent-action-runner/nestjs` for `@AgentAction()` provider discovery.
- `@agent-action-runner/http` helpers for action/workflow HTTP endpoints.
- Prisma Client with SQLite for durable approval, audit, and idempotency records.
- A read -> dryRun -> approve -> mutate -> audit flow.

The example is intentionally still an application example, not a persistence package. Real services should adapt the schema and transaction boundaries to their own auth, tenant, approval, and data models.

## Run

```bash
npm run build --workspace agent-action-runner-nestjs-prisma-approval-ops-example
npm run test --workspace agent-action-runner-nestjs-prisma-approval-ops-example
```

Start the server:

```bash
npm run build --workspace agent-action-runner-nestjs-prisma-approval-ops-example
node examples/nestjs-prisma-approval-ops/dist/index.js
```

Default port: `3004`.

## Endpoints

```txt
GET  /agent-runner/actions
POST /agent-runner/actions/admin.searchUsers/execute
POST /agent-runner/actions/admin.dryRunDisableUser/execute
POST /agent-runner/actions/admin.disableUser/execute
POST /agent-runner/workflows/execute
POST /approvals/disable-user
GET  /audit
GET  /users
```

## Safety Pattern

The mutate action requires:

- `allowedModes` from the server-side HTTP resolver.
- `approvalToken` from `x-approval-token`.
- `approvalContext` bound to user id, action name, input hash, target user id, and dry-run hash.
- `idempotencyKey` from a server-side resolver or `x-idempotency-key`.
- Prisma transaction logic that reserves idempotency, consumes approval once, performs mutation, and stores replay result.

Audit events use `auditDefaults` so raw approval tokens and raw idempotency keys are not persisted.

## Flow

```txt
searchUsers
  -> dryRunDisableUser
  -> createApproval
  -> disableUser with x-approval-token and x-idempotency-key
  -> audit append
  -> idempotency replay for duplicate mutate call
```

## Curl Flow

Search for the target user:

```bash
curl -s http://localhost:3004/agent-runner/actions/admin.searchUsers/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"query":"casey","status":"active"}}'
```

Dry-run the mutation and keep the returned `dryRunHash`:

```bash
curl -s http://localhost:3004/agent-runner/actions/admin.dryRunDisableUser/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"userId":"user_2","reason":"Repeated policy violations."}}'
```

Create an approval bound to the operator, target resource, reason, and dry-run hash:

```bash
curl -s http://localhost:3004/approvals/disable-user \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"targetUserId":"user_2","reason":"Repeated policy violations.","dryRunHash":"<dryRunHash>"}'
```

Execute the mutation with both approval and idempotency:

```bash
curl -s http://localhost:3004/agent-runner/actions/admin.disableUser/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -H "x-approval-token: <approvalToken>" \
  -H "x-idempotency-key: disable-user:user_2:<dryRunHash>" \
  -d '{"input":{"userId":"user_2","reason":"Repeated policy violations.","dryRunHash":"<dryRunHash>"}}'
```

Send the same mutate request again with the same idempotency key to replay the stored result safely:

```bash
curl -s http://localhost:3004/agent-runner/actions/admin.disableUser/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -H "x-approval-token: <approvalToken>" \
  -H "x-idempotency-key: disable-user:user_2:<dryRunHash>" \
  -d '{"input":{"userId":"user_2","reason":"Repeated policy violations.","dryRunHash":"<dryRunHash>"}}'
```

Inspect durable audit records:

```bash
curl -s http://localhost:3004/audit
```

## Prisma Tables

The example creates these tables in SQLite:

- `AdminUser`
- `AgentApproval`
- `AgentAuditEvent`
- `AgentIdempotencyKey`

In production, use migrations instead of runtime table creation. The transaction shape is the important part: reserve idempotency, consume approval once, perform the mutation, store the replay result, and append audit records inside the application boundary.

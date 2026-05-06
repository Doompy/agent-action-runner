# Fastify Admin Ops Example

This example shows the same operational mutation flow as the Express and NestJS examples, but through the Fastify adapter:

```txt
read -> dryRun -> approve -> mutate -> audit
```

It uses in-memory users, HMAC-bound approval tokens, and an in-memory audit trail. The approval implementation is a demo pattern, not a full production approval service.

## Run

```bash
npm install
npm run build --workspace agent-action-runner-fastify-admin-ops-example
node examples/fastify-admin-ops/dist/index.js
```

The server listens on `http://localhost:3002` by default.

## Endpoints

- `GET /users`
- `GET /audit`
- `GET /agent-runner/actions`
- `POST /agent-runner/actions/admin.searchUsers/execute`
- `POST /agent-runner/actions/admin.dryRunDisableUser/execute`
- `POST /agent-runner/actions/admin.disableUser/execute`
- `POST /agent-runner/workflows/execute`
- `POST /approvals/disable-user`

## Flow

Search for a user:

```bash
curl -s http://localhost:3002/agent-runner/actions/admin.searchUsers/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"query":"casey","status":"active"}}'
```

Dry-run the disable operation:

```bash
curl -s http://localhost:3002/agent-runner/actions/admin.dryRunDisableUser/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"userId":"user_2","reason":"Repeated policy violations."}}'
```

Create an approval token from the dry-run hash:

```bash
curl -s http://localhost:3002/approvals/disable-user \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"targetUserId":"user_2","reason":"Repeated policy violations.","dryRunHash":"<dryRunHash>"}'
```

Execute the mutation with the approval token:

```bash
curl -s http://localhost:3002/agent-runner/actions/admin.disableUser/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -H "x-approval-token: <approvalToken>" \
  -d '{"input":{"userId":"user_2","reason":"Repeated policy violations.","dryRunHash":"<dryRunHash>"}}'
```

Inspect the audit trail:

```bash
curl -s http://localhost:3002/audit
```

The approval token is bound to `userId`, `actionName`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`, so changing the mutation input after approval causes the action to fail.

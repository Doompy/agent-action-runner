# Persistent Admin Ops Example

Express operational example with file-backed approval and audit storage.

This example shows the same safety flow as the in-memory admin ops examples, but stores approval records and audit events on disk:

```txt
read -> dryRun -> approve -> mutate -> audit
```

It is still a demo pattern, not a production approval service. Real systems should add their own auth, retention, token rotation, transactional approval consumption, and persistence backend.

## Run

```bash
npm run build --workspace agent-action-runner-persistent-admin-ops-example
npm run test --workspace agent-action-runner-persistent-admin-ops-example
node examples/persistent-admin-ops/dist/index.js
```

The server listens on port `3003` by default.

```bash
PORT=3003 AGENT_RUNNER_DATA_DIR=.agent-runner-data/persistent-admin-ops node examples/persistent-admin-ops/dist/index.js
```

Stored files:

```txt
.agent-runner-data/persistent-admin-ops/
  approvals.json
  audit.jsonl
```

## Endpoints

```txt
GET  /users
GET  /audit
GET  /agent-runner/actions
POST /agent-runner/actions/admin.searchUsers/execute
POST /agent-runner/actions/admin.dryRunDisableUser/execute
POST /agent-runner/actions/admin.disableUser/execute
POST /agent-runner/workflows/execute
POST /approvals/disable-user
```

## Curl Flow

Search users:

```bash
curl -s http://localhost:3003/agent-runner/actions/admin.searchUsers/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"query":"casey","status":"active"}}'
```

Dry-run the mutation:

```bash
curl -s http://localhost:3003/agent-runner/actions/admin.dryRunDisableUser/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"userId":"user_2","reason":"Repeated policy violations."}}'
```

Create an approval using the returned `dryRunHash`:

```bash
curl -s http://localhost:3003/approvals/disable-user \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"targetUserId":"user_2","reason":"Repeated policy violations.","dryRunHash":"<dryRunHash>"}'
```

Execute the approved mutation:

```bash
curl -s http://localhost:3003/agent-runner/actions/admin.disableUser/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -H "x-approval-token: <approvalToken>" \
  -d '{"input":{"userId":"user_2","reason":"Repeated policy violations.","dryRunHash":"<dryRunHash>"}}'
```

Read persisted audit events:

```bash
curl -s http://localhost:3003/audit
```

## Safety Model

- `admin.disableUser` is a `mutate` action, so it needs `mutate` in `allowedModes`.
- The Express adapter gets user id, allowed modes, approval token, approval context, and metadata from server-side resolver hooks.
- Client body fields such as `allowedModes` and `approvalContext` are not trusted by default.
- Approval records store only `tokenHash`, not the raw token.
- Approval verification checks `userId`, `actionName`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`.
- Audit events are appended to JSONL and omit the raw approval token.

## License

Apache-2.0

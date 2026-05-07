# Delivery Ops Example

Express operational example for retrying failed delivery jobs safely.

This example shows the original operational automation story for Agent Action Runner:

```txt
search failed jobs -> dryRun retry -> approve -> execute retry -> audit
```

It uses in-memory data so the retry flow is easy to inspect. See `examples/persistent-admin-ops` for file-backed approval and audit storage.

## Run

```bash
npm run build --workspace agent-action-runner-delivery-ops-example
npm run test --workspace agent-action-runner-delivery-ops-example
node examples/delivery-ops/dist/index.js
```

The server listens on port `3004` by default.

## CLI Workflow

This example includes a CLI config, action manifest, generated-style action docs, and a JSON workflow.

```bash
npm run build --workspace agent-action-runner-delivery-ops-example
node packages/cli/dist/index.js actions:list --config examples/delivery-ops/agent-runner.config.json
node packages/cli/dist/index.js workflow:validate examples/delivery-ops/workflows/retry-failed-delivery.workflow.json --config examples/delivery-ops/agent-runner.config.json
node packages/cli/dist/index.js workflow:validate examples/delivery-ops/workflows/retry-failed-delivery.workflow.json --config examples/delivery-ops/agent-runner.config.json --runner examples/delivery-ops/dist/agent-runner.js --format json
node packages/cli/dist/index.js workflow:run examples/delivery-ops/workflows/retry-failed-delivery.workflow.json --config examples/delivery-ops/agent-runner.config.json --runner examples/delivery-ops/dist/agent-runner.js
node packages/cli/dist/index.js mcp:preview --config examples/delivery-ops/agent-runner.config.json --runner examples/delivery-ops/dist/agent-runner.js --json
```

The workflow runs only `delivery.searchJobs -> delivery.dryRunRetry`. `delivery.executeRetry` remains outside the workflow because it needs an approval token and explicit mutate mode allowance.

## Endpoints

```txt
GET  /jobs
GET  /audit
GET  /agent-runner/actions
POST /agent-runner/actions/delivery.searchJobs/execute
POST /agent-runner/actions/delivery.dryRunRetry/execute
POST /agent-runner/actions/delivery.executeRetry/execute
POST /agent-runner/workflows/execute
POST /approvals/retry-jobs
```

## Curl Flow

Search failed jobs:

```bash
curl -s http://localhost:3004/agent-runner/actions/delivery.searchJobs/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"status":["FAILED","DLQ"],"campaignId":"campaign_spring"}}'
```

Dry-run retry:

```bash
curl -s http://localhost:3004/agent-runner/actions/delivery.dryRunRetry/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"jobIds":["job_1","job_2","job_3"],"reason":"Recover transient CMS failures."}}'
```

Create approval:

```bash
curl -s http://localhost:3004/approvals/retry-jobs \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"jobIds":["job_1","job_2","job_3"],"reason":"Recover transient CMS failures.","dryRunHash":"<dryRunHash>"}'
```

Execute approved retry:

```bash
curl -s http://localhost:3004/agent-runner/actions/delivery.executeRetry/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -H "x-approval-token: <approvalToken>" \
  -d '{"input":{"jobIds":["job_1","job_2","job_3"],"reason":"Recover transient CMS failures.","dryRunHash":"<dryRunHash>"}}'
```

## Safety Model

- `delivery.searchJobs` is a broad read action with filters.
- `delivery.dryRunRetry` calculates retryable and blocked jobs before mutation.
- `delivery.executeRetry` is narrow, mutate-mode, and calls `ctx.requireApproval()`.
- The approval token is bound to `userId`, `actionName`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`.
- The Express adapter gets user id, allowed modes, approval token, approval context, and metadata from server-side resolver hooks.
- Client body fields such as `allowedModes` and `approvalContext` are not trusted by default.

## License

Apache-2.0

# @agent-action-runner/express

Express adapter for Agent Action Runner.

Use this package to expose a core `AgentActionRunner` through HTTP endpoints in an Express application while keeping user identity, allowed modes, approval tokens, approval context, and metadata under server-side control.

Experimental / pre-1.0.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/express express zod
```

`express` and `@agent-action-runner/core` are peer dependencies. `@agent-action-runner/http` contains the shared HTTP contract used by the official HTTP adapters.

## Quickstart

```ts
import express from 'express';
import { createRunner } from '@agent-action-runner/core';
import { createExpressAdapter } from '@agent-action-runner/express';
import { z } from 'zod';

const app = express();
const runner = createRunner();

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  description: 'Search delivery jobs by status.',
  inputSchema: z.object({
    status: z.array(z.string()),
  }),
  handler: async (input) => ({
    jobIds: input.status.includes('FAILED') ? ['job_1'] : [],
  }),
});

app.use('/agent-runner', createExpressAdapter(runner, {
  getUserId: (req) => req.header('x-user-id') ?? 'anonymous',
}));

app.listen(3000);
```

## Endpoints

With the adapter mounted at `/agent-runner`, the routes are:

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent-runner/actions` | Lists registered action metadata. |
| `POST` | `/agent-runner/actions/:name/execute` | Executes one action. |
| `POST` | `/agent-runner/workflows/execute` | Executes a JSON workflow. |

`GET /actions` returns action metadata only. It does not serialize schemas.

```json
{
  "ok": true,
  "actions": [
    {
      "name": "delivery.searchJobs",
      "mode": "read",
      "description": "Search delivery jobs by status.",
      "approvalRequired": false
    }
  ]
}
```

## Execute An Action

```bash
curl -s http://localhost:3000/agent-runner/actions/delivery.searchJobs/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{"input":{"status":["FAILED"]}}'
```

Successful responses use this shape:

```json
{
  "ok": true,
  "result": {
    "executionId": "exec_1",
    "actionName": "delivery.searchJobs",
    "mode": "read",
    "output": {
      "jobIds": ["job_1"]
    }
  }
}
```

## Execute A Workflow

```bash
curl -s http://localhost:3000/agent-runner/workflows/execute \
  -H "content-type: application/json" \
  -H "x-user-id: operator_1" \
  -d '{
    "workflow": {
      "workflowName": "search-failed-jobs",
      "steps": [
        {
          "id": "jobs",
          "action": "delivery.searchJobs",
          "input": {
            "status": ["FAILED"]
          }
        }
      ]
    }
  }'
```

## Server-Side Security Boundary

The adapter requires `getUserId(req)`. Do not take user identity from the request body.

```ts
createExpressAdapter(runner, {
  getUserId: (req) => req.user.id,
  getAllowedModes: (req) => req.user.isOperator
    ? ['read', 'draft', 'dryRun', 'mutate']
    : ['read', 'draft', 'dryRun'],
  getApprovalToken: (req) => req.header('x-approval-token'),
  getApprovalContext: (req) => ({
    resourceIds: req.header('x-resource-ids')?.split(','),
    dryRunHash: req.header('x-dry-run-hash'),
  }),
  getMetadata: (req) => ({
    requestId: req.header('x-request-id'),
    ip: req.ip,
  }),
});
```

By default, the adapter ignores these request body fields:

- `allowedModes`
- `approvalToken`
- `approvalContext`
- `metadata`

Set `allowClientExecutionOptions: true` only for trusted internal tooling.

## Mutate Actions

`mutate` actions remain blocked unless the server allows `mutate` mode and the core approval hook approves the request.

```ts
app.use('/agent-runner', createExpressAdapter(runner, {
  getUserId: (req) => req.user.id,
  getAllowedModes: (req) => req.user.canMutate
    ? ['read', 'draft', 'dryRun', 'mutate']
    : ['read', 'draft', 'dryRun'],
  getApprovalToken: (req) => req.header('x-approval-token'),
}));
```

The Express adapter does not implement authentication, sessions, approval signing, or persistent audit storage. Those stay in your application.

## Error Responses

Errors use a stable JSON shape:

```json
{
  "ok": false,
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "Action \"admin.disableUser\" requires approval."
  }
}
```

Common status mappings:

| Error | Status |
|---|---|
| action not found | `404` |
| schema validation failed | `400` |
| invalid step reference | `400` |
| mode not allowed | `403` |
| approval required | `403` |
| policy rejected | `403` |

## Example

See `examples/express-admin-ops` for a runnable Express app with:

- `admin.searchUsers`
- `admin.dryRunDisableUser`
- `admin.disableUser`
- HMAC-bound approval tokens
- in-memory audit trail

## License

Apache-2.0

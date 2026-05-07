# @agent-action-runner/fastify

Fastify adapter for Agent Action Runner.

Use this package to expose a core `AgentActionRunner` through Fastify routes while resolving user identity, allowed modes, approval tokens, approval context, and metadata on the server.

The plugin exposes registered actions. It does not execute agent-generated code or discover arbitrary Fastify routes.

Experimental / pre-1.0.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/fastify fastify zod
```

`fastify` and `@agent-action-runner/core` are peer dependencies. `@agent-action-runner/http` contains the shared HTTP contract used by the official HTTP adapters.

## Quickstart

```ts
import Fastify from 'fastify';
import { createRunner } from '@agent-action-runner/core';
import { agentRunnerFastifyPlugin } from '@agent-action-runner/fastify';
import { z } from 'zod';

const app = Fastify();
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

await app.register(agentRunnerFastifyPlugin, {
  prefix: '/agent-runner',
  runner,
  getUserId: async (request) => request.headers['x-user-id']?.toString() ?? 'anonymous',
});

await app.listen({ port: 3000 });
```

## Endpoints

With the plugin registered using `prefix: '/agent-runner'`, the routes are:

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent-runner/actions` | Lists registered action metadata. |
| `POST` | `/agent-runner/actions/:name/execute` | Executes one action. |
| `POST` | `/agent-runner/workflows/execute` | Executes a JSON workflow. |

`GET /actions` returns action metadata only. Schemas are not serialized. Metadata can include tags, resource type, risk level, deprecation, and examples.

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

## Plugin Options

```ts
await app.register(agentRunnerFastifyPlugin, {
  prefix: '/agent-runner',
  runner,
  getUserId: (request) => request.user.id,
  getAllowedModes: (request) => request.user.canMutate
    ? ['read', 'draft', 'dryRun', 'mutate']
    : ['read', 'draft', 'dryRun'],
  getApprovalToken: (request) => request.headers['x-approval-token']?.toString(),
  getApprovalContext: (request) => ({
    dryRunHash: request.headers['x-dry-run-hash']?.toString(),
  }),
  getMetadata: (request) => ({
    requestId: request.id,
    ip: request.ip,
  }),
});
```

`getUserId` is required. Identity should come from your server-side auth/session layer, not the request body.

By default, request body execution options are ignored:

- `allowedModes`
- `approvalToken`
- `approvalContext`
- `metadata`

Set `allowClientExecutionOptions: true` only for trusted internal tooling.

## Mutate Actions

`mutate` actions still go through the core runner. They require:

- `mutate` in allowed modes
- approval hook approval
- any policy hook checks your application configures

The Fastify adapter does not implement authentication, sessions, approval signing, or persistent audit storage.

## Error Responses

Errors use a stable JSON shape:

```json
{
  "ok": false,
  "error": {
    "code": "MODE_NOT_ALLOWED",
    "message": "Action \"admin.disableUser\" uses mode \"mutate\", which is not allowed for this execution."
  }
}
```

Common status mappings:

| Error | Status |
|---|---|
| action not found | `404` |
| schema validation failed | `400` |
| action timeout | `408` |
| invalid step reference | `400` |
| mode not allowed | `403` |
| approval required | `403` |
| policy rejected | `403` |

## Example

See `examples/fastify-admin-ops` for a runnable Fastify app with the full `read -> dryRun -> approve -> mutate -> audit` flow.

## License

Apache-2.0

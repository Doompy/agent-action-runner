# @agent-action-runner/http

Shared HTTP adapter utilities for Agent Action Runner.

This package is primarily for framework adapter authors. The official Express and Fastify adapters use it to keep request handling, response shapes, execution option handling, and error mapping consistent.

Experimental / pre-1.0.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/http
```

Most applications should install `@agent-action-runner/express` or `@agent-action-runner/fastify` instead of using this package directly.

## HTTP Contract

Official HTTP adapters expose:

| Method | Path | Description |
|---|---|---|
| `GET` | `/actions` | Lists action metadata. |
| `POST` | `/actions/:name/execute` | Executes one action. |
| `POST` | `/workflows/execute` | Executes a JSON workflow. |

`GET /actions` intentionally omits schemas. It can include action metadata such as tags, resource type, risk level, deprecation, and examples.

```json
{
  "ok": true,
  "actions": [
    {
      "name": "delivery.searchJobs",
      "mode": "read",
      "description": "Search delivery jobs by status.",
      "approvalRequired": false,
      "tags": ["delivery", "operations"],
      "resourceType": "deliveryJob",
      "riskLevel": "low"
    }
  ]
}
```

Action execute request bodies use:

```json
{
  "input": {
    "status": ["FAILED"]
  },
  "idempotencyKey": "optional-client-key-for-trusted-endpoints"
}
```

Workflow execute request bodies use:

```json
{
  "workflowId": "workflow_1",
  "workflow": {
    "workflowName": "search-failed-jobs",
    "steps": []
  }
}
```

## Security Boundary

HTTP adapters should resolve execution context from trusted server-side sources:

```ts
type AgentHttpAdapterOptions<Request> = {
  getUserId: (request: Request) => string | Promise<string>;
  getAllowedModes?: (request: Request) => readonly ActionMode[] | undefined | Promise<readonly ActionMode[] | undefined>;
  getApprovalToken?: (request: Request) => string | undefined | Promise<string | undefined>;
  getApprovalContext?: (request: Request) => ApprovalContextOverrides | undefined | Promise<ApprovalContextOverrides | undefined>;
  getIdempotencyKey?: (request: Request) => string | undefined | Promise<string | undefined>;
  getWorkflowStepIdempotencyKey?: (request: Request, step: WorkflowStep) => string | undefined | Promise<string | undefined>;
  getMetadata?: (request: Request) => Readonly<Record<string, unknown>> | undefined | Promise<Readonly<Record<string, unknown>> | undefined>;
  allowClientExecutionOptions?: boolean;
  workflowLimits?: false | {
    maxSteps?: number;
    maxStepTimeoutMs?: number;
    maxRetryAttempts?: number;
    maxRetryDelayMs?: number;
  };
};
```

By default, client-supplied `allowedModes`, `approvalToken`, `approvalContext`, `idempotencyKey`, workflow step `idempotencyKey`, and `metadata` are ignored. They are passed through only when `allowClientExecutionOptions: true` is set.

For direct action execution, `getIdempotencyKey(req)` takes precedence over body `idempotencyKey`. For workflow execution, `getWorkflowStepIdempotencyKey(req, step)` can provide a server-derived key per step. The helper never auto-generates keys because useful idempotency keys are domain-specific.

Workflow endpoints also apply safety caps before execution. Defaults are `maxSteps: 50`, `maxStepTimeoutMs: 30000`, `maxRetryAttempts: 3`, and `maxRetryDelayMs: 5000`. Set `workflowLimits: false` only for trusted/internal endpoints that intentionally disable these caps. Configure request payload byte limits in your host framework body parser, such as Express `express.json({ limit })` or Fastify body limit options.

## Adapter Author Example

```ts
import {
  createActionListResponse,
  executeHttpAction,
  executeHttpWorkflow,
  mapAgentRunnerError,
  resolveAgentHttpRequestContext,
} from '@agent-action-runner/http';

router.get('/actions', (_req, res) => {
  res.json(createActionListResponse(runner));
});

router.post('/actions/:name/execute', async (req, res) => {
  try {
    const context = await resolveAgentHttpRequestContext(req, options);
    const result = await executeHttpAction(runner, req.params.name, req.body, context);
    res.json(result);
  } catch (error) {
    const mapped = mapAgentRunnerError(error);
    res.status(mapped.statusCode).json(mapped.response);
  }
});

router.post('/workflows/execute', async (req, res) => {
  try {
    const context = await resolveAgentHttpRequestContext(req, options);
    const result = await executeHttpWorkflow(runner, req.body, context);
    res.json(result);
  } catch (error) {
    const mapped = mapAgentRunnerError(error);
    res.status(mapped.statusCode).json(mapped.response);
  }
});
```

## Public Helpers

- `resolveAgentHttpRequestContext(request, options)`
- `createActionListResponse(runner)`
- `executeHttpAction(runner, actionName, body, context)`
- `executeHttpWorkflow(runner, body, context)`
- `mapAgentRunnerError(error)`
- `AgentHttpWorkflowLimits` type

## Response Shapes

Success:

```json
{
  "ok": true,
  "result": {}
}
```

Action list:

```json
{
  "ok": true,
  "actions": []
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "SCHEMA_VALIDATION_FAILED",
    "message": "Action \"delivery.searchJobs\" failed input schema validation."
  }
}
```

Workflow validation errors also include `issues`:

```json
{
  "ok": false,
  "error": {
    "code": "WORKFLOW_VALIDATION_FAILED",
    "message": "Workflow definition failed validation.",
    "issues": [
      {
        "code": "invalidRetry",
        "message": "retry.maxAttempts must be a positive integer.",
        "path": "/steps/0/retry/maxAttempts"
      }
    ]
  }
}
```

## Error Mapping

| Core Error | HTTP Status | Code |
|---|---:|---|
| `ActionNotFoundError` | `404` | `ACTION_NOT_FOUND` |
| `SchemaValidationError` | `400` | `SCHEMA_VALIDATION_FAILED` |
| `ActionTimeoutError` | `408` | `ACTION_TIMEOUT` |
| `InvalidStepReferenceError` | `400` | `INVALID_STEP_REFERENCE` |
| `WorkflowValidationError` | `400` | `WORKFLOW_VALIDATION_FAILED` |
| HTTP workflow cap exceeded | `400` | `WORKFLOW_LIMIT_EXCEEDED` |
| `ModeNotAllowedError` | `403` | `MODE_NOT_ALLOWED` |
| `ApprovalRequiredError` | `403` | `APPROVAL_REQUIRED` |
| `PolicyRejectedError` | `403` | `POLICY_REJECTED` |
| unknown error | `500` | `INTERNAL_ERROR` |

`WorkflowExecutionError` maps from its cause when possible. Otherwise it returns `400` with `WORKFLOW_EXECUTION_FAILED`.

## License

Apache-2.0

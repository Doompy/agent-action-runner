# @agent-action-runner/core

Framework-agnostic action registry and JSON workflow runner for TypeScript backends.

Use this package when you want an agent to call existing service logic through named, schema-validated actions instead of giving the agent direct database access, internal API access, or arbitrary code execution.

Core does not execute agent-generated TypeScript. It only runs handlers that your application registered as actions.

Experimental / pre-1.0. Public APIs may change while the action, workflow, and approval contracts settle.

## Install

```bash
npm install @agent-action-runner/core zod
```

`zod` is a peer dependency because action input and output schemas are part of the public action contract.

## What It Provides

- In-memory action registry.
- Sequential JSON workflow execution.
- Zod input and output validation.
- Action modes: `read`, `draft`, `dryRun`, `mutate`.
- Server-controlled mode enforcement.
- Policy, approval, and audit hooks.
- Audit payload minimization for input, output, and error data.
- Deterministic input hashing for approval checks.
- Public stable hash helper for approval services.
- Audit store helper for persistent audit adapters.
- Restricted step output references.
- Type-safe workflow authoring helpers.
- Static workflow validation helpers.
- Action metadata for API reuse documentation.
- Workflow retry, timeout, and continue-on-error controls.
- Idempotency key propagation for retry-safe mutation handlers.
- Cooperative `AbortSignal` for cancellable handlers.
- Small policy composition helpers.

## Quickstart

```ts
import { createRunner, fromStep } from '@agent-action-runner/core';
import { z } from 'zod';

const runner = createRunner({
  audit: async (event) => {
    console.log(event.actionName, event.status);
  },
});

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  description: 'Search delivery jobs by status.',
  inputSchema: z.object({
    status: z.array(z.string()),
  }),
  outputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  handler: async (input) => {
    return { jobIds: input.status.includes('FAILED') ? ['job_1'] : [] };
  },
});

runner.registerAction({
  name: 'delivery.dryRunRetry',
  mode: 'dryRun',
  description: 'Validate retry candidates before mutation.',
  inputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  outputSchema: z.object({
    retryable: z.array(z.string()),
    blocked: z.array(z.string()),
  }),
  handler: async (input) => {
    return { retryable: input.jobIds, blocked: [] };
  },
});

const result = await runner.executeWorkflow({
  userId: 'operator_1',
  workflow: {
    workflowName: 'retry-failed-delivery-jobs',
    steps: [
      {
        id: 'jobs',
        action: 'delivery.searchJobs',
        input: { status: ['FAILED'] },
      },
      {
        id: 'dryRun',
        action: 'delivery.dryRunRetry',
        input: {
          jobIds: fromStep('jobs', '/jobIds'),
        },
      },
    ],
  },
});

console.log(result.outputByStep.dryRun);
```

## Action Modes

```ts
type ActionMode = 'read' | 'draft' | 'dryRun' | 'mutate';
```

| Mode | Intended Use |
|---|---|
| `read` | Query or inspect existing state. |
| `draft` | Generate a draft without changing production state. |
| `dryRun` | Validate a future mutation and calculate impact. |
| `mutate` | Change production state. Requires explicit mode allowance and approval. |

The default allowed modes are `read`, `draft`, and `dryRun`. `mutate` is blocked unless the execution request includes it in `allowedModes`.

## Registering Actions

```ts
runner.registerAction({
  name: 'report.generateDraft',
  mode: 'draft',
  description: 'Create a report draft for review.',
  tags: ['reports'],
  resourceType: 'report',
  riskLevel: 'low',
  examples: [
    {
      title: 'Create a report draft',
      input: { reportId: 'report_1' },
    },
  ],
  inputSchema: z.object({
    reportId: z.string(),
  }),
  outputSchema: z.object({
    draftId: z.string(),
  }),
  handler: async (input, ctx) => {
    return {
      draftId: `${ctx.userId}:${input.reportId}`,
    };
  },
});
```

Action names must be unique. Handlers receive parsed input and an execution context with user id, action name, mode, workflow id, step id, metadata, approval token, approval context, cooperative `AbortSignal`, and optional idempotency key.

## Executing One Action

```ts
const result = await runner.executeAction({
  userId: 'operator_1',
  action: 'delivery.searchJobs',
  input: {
    status: ['FAILED'],
  },
});
```

Use `metadata` for request-scoped values that are useful to policies, handlers, or audit hooks.

```ts
await runner.executeAction({
  userId: 'operator_1',
  action: 'delivery.searchJobs',
  input: { status: ['FAILED'] },
  metadata: {
    requestId: 'req_123',
    source: 'admin-console',
  },
});
```

Use `idempotencyKey` for `mutate` actions that may be retried or may time out from the runner's perspective while the underlying work continues:

```ts
await runner.executeAction({
  userId: 'operator_1',
  action: 'delivery.executeRetry',
  input: { jobIds: ['job_1'] },
  allowedModes: ['mutate'],
  approvalToken,
  approvalContext,
  idempotencyKey: `retry:job_1:${dryRunHash}`,
});
```

The raw key is available to the handler as `ctx.idempotencyKey`. Audit events only receive `idempotencyKeyHash`, a SHA-256 fingerprint for correlation. Core does not generate keys, reserve keys, lock rows, or replay results; applications own that behavior in their service or transaction layer.

## Cooperative Cancellation

Handlers receive `ctx.signal`, an `AbortSignal` for cooperative cancellation.

```ts
runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  handler: async (input, ctx) => {
    return deliveryService.searchJobs(input, {
      signal: ctx.signal,
    });
  },
});
```

When `timeoutMs` expires, the runner rejects the attempt with `ActionTimeoutError` and aborts `ctx.signal`. This does not forcibly stop work already running in Node.js. Cancellation only happens if your handler passes the signal to APIs that honor it.

## Executing Workflows

Workflows are plain JSON data. They execute sequentially, and each step can reference outputs from earlier steps.

```json
{
  "workflowName": "retry-failed-delivery-jobs",
  "steps": [
    {
      "id": "jobs",
      "action": "delivery.searchJobs",
      "input": {
        "status": ["FAILED"]
      },
      "timeoutMs": 1000,
      "idempotencyKey": "search-failed:2026-05-06",
      "retry": {
        "maxAttempts": 2,
        "delayMs": 50
      }
    },
    {
      "id": "dryRun",
      "action": "delivery.dryRunRetry",
      "input": {
        "jobIds": {
          "$fromStep": "jobs",
          "path": "/jobIds"
        }
      }
    }
  ]
}
```

Use `fromStep(stepId, path)` in TypeScript to create the same reference object:

```ts
fromStep('jobs', '/jobIds');
```

Paths are JSON Pointer strings. References can only resolve against previous step outputs.

`retry.maxAttempts` includes the first attempt. `timeoutMs` marks the attempt as failed after the configured duration; it does not cancel underlying Node.js work that has already started. `idempotencyKey` must be a non-empty string when present and is passed to the step's action context. Use `continueOnError: true` only when downstream steps can safely consume a failed step result.

For `mutate` actions, retries should only be enabled when the underlying service is idempotent or protected by a transaction/idempotency key. A timeout can happen while the original work is still running.

## Workflow Builder

The builder gives TypeScript checks for action inputs and previous step references while still producing the same JSON workflow definition.

```ts
import {
  createRunner,
  defineAction,
  defineActionCatalog,
  defineWorkflow,
  registerActionCatalog,
} from '@agent-action-runner/core';
import { z } from 'zod';

const runner = createRunner();

const actions = defineActionCatalog({
  searchJobs: defineAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    inputSchema: z.object({ status: z.array(z.string()) }),
    outputSchema: z.object({ jobIds: z.array(z.string()) }),
    handler: async () => ({ jobIds: ['job_1'] }),
  }),
  dryRunRetry: defineAction({
    name: 'delivery.dryRunRetry',
    mode: 'dryRun',
    inputSchema: z.object({ jobIds: z.array(z.string()) }),
    outputSchema: z.object({ retryable: z.array(z.string()) }),
    handler: async (input) => ({ retryable: input.jobIds }),
  }),
});

registerActionCatalog(runner, actions);

const workflow = defineWorkflow('retry-failed-jobs')
  .step('jobs', actions.searchJobs, { status: ['FAILED'] })
  .step('dryRun', actions.dryRunRetry, ({ fromStep }) => ({
    jobIds: fromStep('jobs', '/jobIds'),
  }))
  .build();
```

The builder does not execute TypeScript code. It only creates a `WorkflowDefinition` for the existing JSON runner.

## Workflow Validation

Use `validateWorkflowDefinition()` before executing workflow JSON from files, CLI input, or generated agent plans.

`executeWorkflow()` also runs this validation before any step handler starts and throws `WorkflowValidationError` when the workflow is invalid.

```ts
import { validateWorkflowDefinition } from '@agent-action-runner/core';

const result = validateWorkflowDefinition(workflow, {
  actions: runner.listActions().map((action) => ({
    name: action.name,
    mode: action.mode,
  })),
});

if (!result.valid) {
  console.error(result.issues);
}
```

Validation catches:

- missing or invalid workflow names
- missing steps
- duplicate step ids
- unknown actions when an action catalog is supplied
- invalid action modes
- step `allowedModes` that exclude the known action mode
- invalid retry, timeout, or continue-on-error controls
- invalid idempotency keys
- references to missing or future steps
- unsupported input values

## Approval Model

`mutate` actions require both:

- `mutate` in the execution `allowedModes`
- an approval hook result of `{ approved: true }`

```ts
const runner = createRunner({
  approval: async ({ approvalToken, approvalContext }) => {
    return verifyApprovalToken(approvalToken, approvalContext)
      ? { approved: true, approvalId: 'approval_1' }
      : { approved: false, reason: 'Invalid approval token.' };
  },
});
```

The approval hook receives a normalized context:

```ts
type ApprovalContext = {
  userId: string;
  actionName: string;
  mode: 'read' | 'draft' | 'dryRun' | 'mutate';
  inputHash: string;
  resourceIds?: readonly string[];
  dryRunHash?: string;
  expiresAt?: string;
  workflowId?: string;
  stepId?: string;
};
```

Core does not issue or sign approval tokens. Applications should bind approval tokens to the approval context fields they care about, especially `userId`, `actionName`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`.

Use `createStableHash()` when an approval service needs to calculate the same deterministic input hash as the runner:

```ts
import { createStableHash } from '@agent-action-runner/core';

const inputHash = createStableHash({
  userId: 'user_2',
  reason: 'Repeated policy violations.',
  dryRunHash: 'dry_run_hash',
});
```

The stable hash is based on normalized JSON-compatible input. Object properties with `undefined` values are treated as absent, so `{}` and `{ optional: undefined }` hash the same. In arrays, `undefined` is normalized like `null` to preserve array positions.

Inside a handler, call `ctx.requireApproval()` before performing a sensitive mutation when you want an explicit guard at the mutation point. This is a defense-in-depth check for actions that were already approved through `mutate` mode or `approvalRequired`; it does not start an interactive approval flow by itself.

```ts
handler: async (input, ctx) => {
  ctx.requireApproval();
  return deliveryService.executeRetry(input.jobIds);
}
```

## Policy Hook

Use the policy hook for application-specific allow/deny checks before the handler runs.

```ts
const runner = createRunner({
  policy: async ({ action, context }) => {
    if (action.mode === 'mutate' && context.metadata.environment !== 'staging') {
      return { allowed: false, reason: 'Mutations are disabled outside staging.' };
    }

    return { allowed: true };
  },
});
```

Small policy helpers are available when role/scope checks can be read from `context.metadata`.

```ts
import {
  allowModes,
  composePolicies,
  requireRole,
  requireScope,
} from '@agent-action-runner/core';

const runner = createRunner({
  policy: composePolicies(
    allowModes(['read', 'draft', 'dryRun']),
    requireRole('admin', { actions: ['admin.disableUser'] }),
    requireScope('delivery:write', { actions: ['delivery.executeRetry'] }),
  ),
});
```

`requireRole()` reads `metadata.roles` by default and `requireScope()` reads `metadata.scopes` by default. Both accept either a string or string array, and both support `metadataKey` when your application uses different metadata fields.

## Audit Hook

The audit hook receives `started`, `succeeded`, and `failed` events.

Workflow retries add `attempt` and `maxAttempts` to audit events.

Audit events do not include the raw `approvalToken` or raw `idempotencyKey`. When present, the event includes `approvalTokenHash` and `idempotencyKeyHash` instead.

`approvalTokenHash` is a redacted fingerprint for audit correlation, not a secure approval token store. Approval services should use secret-backed HMACs or sufficiently random approval tokens for verification.

By default, audit payload behavior remains compatible with previous releases:

```ts
const runner = createRunner({
  auditDefaults: {
    input: 'full',
    output: 'full',
    error: 'full',
  },
});
```

For production systems, minimize stored payloads:

```ts
const runner = createRunner({
  auditDefaults: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: ['/password', '/token', '/secret'],
  },
  audit: createAuditHook(auditStore),
});
```

Actions can override runner defaults with `auditPolicy`:

```ts
runner.registerAction({
  name: 'admin.disableUser',
  mode: 'mutate',
  approvalRequired: true,
  auditPolicy: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: ['/reason', '/profile/email'],
  },
  handler: async (input, ctx) => {
    ctx.requireApproval();
    return adminService.disableUser(input.userId, input.reason);
  },
});
```

`redactPaths` uses exact JSON Pointer paths, such as `/password`, `/profile/email`, or `/items/0/token`. Missing paths are ignored. Wildcards, globs, and regex paths are not currently supported.

Payload modes:

| Field | Modes |
|---|---|
| `input` | `full`, `redacted`, `hash`, `omit` |
| `output` | `full`, `redacted`, `summary`, `hash`, `omit` |
| `error` | `full`, `redacted`, `summary`, `omit` |

`hash` stores `{ hash }` after redaction using `createStableHash()`. `output: 'summary'` stores only `outputSummary`. `error: 'summary'` stores `{ name, message }` and omits stack/cause fields.

When no custom `summarizeOutput` hook is configured, `output: 'summary'` falls back to a safe shape summary such as `object`, `array(length=3)`, or `string`; it does not JSON-stringify the full output payload. If you keep `error: 'full'` while using `redactPaths`, `Error` objects may be cloned into serializable objects containing `name`, `message`, and `stack`. Production systems should prefer `error: 'summary'`.

```ts
import { createAuditHook, createRunner, type AuditStore } from '@agent-action-runner/core';

const auditStore: AuditStore = {
  async write(event) {
    await persistentAuditStore.append({
      executionId: event.executionId,
      workflowId: event.workflowId,
      stepId: event.stepId,
      userId: event.userId,
      actionName: event.actionName,
      mode: event.mode,
      status: event.status,
      approvalTokenHash: event.approvalTokenHash,
      createdAt: event.createdAt.toISOString(),
    });
  },
};

const runner = createRunner({
  audit: createAuditHook(auditStore),
});
```

Use `summarizeOutput` when you want compact audit summaries instead of storing full output payloads.

## Errors

The core package exports typed errors for common failure paths:

- `ActionAlreadyRegisteredError`
- `ActionNotFoundError`
- `ActionTimeoutError`
- `ModeNotAllowedError`
- `PolicyRejectedError`
- `ApprovalRequiredError`
- `SchemaValidationError`
- `InvalidStepReferenceError`
- `DuplicateWorkflowStepError`
- `InvalidAuditPolicyError`
- `WorkflowExecutionError`
- `WorkflowValidationError`

## Public API

Common exports:

- `createRunner`
- `AgentActionRunner`
- `fromStep`
- `defineAction`
- `defineActionCatalog`
- `registerActionCatalog`
- `defineWorkflow`
- `validateWorkflowDefinition`
- `createStableHash`
- `createAuditHook`
- `composePolicies`
- `allowModes`
- `requireRole`
- `requireScope`
- core types such as `ActionDefinition`, `ActionExample`, `ActionRiskLevel`, `AuditPayloadPolicy`, `AuditPayloadMode`, `WorkflowDefinition`, `ActionMode`, `AgentExecutionContext`, `ApprovalContext`, `AuditStore`

## Examples

- `examples/basic`
- `examples/cli-basic`
- `examples/delivery-ops`
- `examples/express-admin-ops`
- `examples/nestjs-admin-ops`
- `examples/fastify-admin-ops`
- `examples/persistent-admin-ops`

## License

Apache-2.0

# @agent-action-runner/core

Framework-agnostic action registry and JSON workflow runner for TypeScript backends.

Use this package when you want an agent to call existing service logic through named, schema-validated actions instead of giving the agent direct database access, internal API access, or arbitrary code execution.

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
- Deterministic input hashing for approval checks.
- Public stable hash helper for approval services.
- Audit store helper for persistent audit adapters.
- Restricted step output references.
- Type-safe workflow authoring helpers.
- Static workflow validation helpers.

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

Action names must be unique. Handlers receive parsed input and an execution context with user id, action name, mode, workflow id, step id, metadata, approval token, and approval context.

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

Inside a handler, call `ctx.requireApproval()` before performing a sensitive mutation when you want an explicit guard at the mutation point.

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

## Audit Hook

The audit hook receives `started`, `succeeded`, and `failed` events.

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
- `ModeNotAllowedError`
- `PolicyRejectedError`
- `ApprovalRequiredError`
- `SchemaValidationError`
- `InvalidStepReferenceError`
- `DuplicateWorkflowStepError`
- `WorkflowExecutionError`

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
- core types such as `ActionDefinition`, `WorkflowDefinition`, `ActionMode`, `AgentExecutionContext`, `ApprovalContext`, `AuditStore`

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

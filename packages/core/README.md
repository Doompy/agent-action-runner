# @agent-action-runner/core

Framework-agnostic core for Agent Action Runner.

Experimental / pre-1.0. Public APIs may change while the action, workflow, and approval contracts settle.

## Install

```bash
npm install @agent-action-runner/core zod
```

## Quickstart

```ts
import { createRunner, fromStep } from '@agent-action-runner/core';
import { z } from 'zod';

const runner = createRunner({
  approval: ({ approvalToken, approvalContext }) => (
    approvalToken === 'approved'
    && approvalContext.mode === 'mutate'
      ? { approved: true }
      : { approved: false }
  ),
});

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  inputSchema: z.object({ status: z.array(z.string()) }),
  handler: () => ({ jobIds: ['job_1'] }),
});

runner.registerAction({
  name: 'delivery.executeRetry',
  mode: 'mutate',
  inputSchema: z.object({ jobIds: z.array(z.string()) }),
  handler: (input) => ({ retried: input.jobIds.length }),
});

await runner.executeWorkflow({
  userId: 'user_1',
  allowedModes: ['read', 'mutate'],
  workflow: {
    workflowName: 'retry-delivery-jobs',
    steps: [
      {
        id: 'jobs',
        action: 'delivery.searchJobs',
        input: { status: ['FAILED'] },
      },
      {
        id: 'retry',
        action: 'delivery.executeRetry',
        input: { jobIds: fromStep('jobs', '/jobIds') },
        approvalToken: 'approved',
        approvalContext: {
          resourceIds: ['job_1'],
        },
      },
    ],
  },
});
```

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
    handler: () => ({ jobIds: ['job_1'] }),
  }),
  dryRunRetry: defineAction({
    name: 'delivery.dryRunRetry',
    mode: 'dryRun',
    inputSchema: z.object({ jobIds: z.array(z.string()) }),
    handler: (input) => ({ retryable: input.jobIds }),
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

The generated workflow is ordinary JSON workflow data:

```json
{
  "workflowName": "retry-failed-jobs",
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

## Workflow Validation

Use `validateWorkflowDefinition()` when you want to check workflow JSON before handing it to the runner.

```ts
import { validateWorkflowDefinition } from '@agent-action-runner/core';

const result = validateWorkflowDefinition(workflow, {
  actions: [
    { name: 'delivery.searchJobs', mode: 'read' },
    { name: 'delivery.dryRunRetry', mode: 'dryRun' },
  ],
});

if (!result.valid) {
  console.log(result.issues);
}
```

Validation catches duplicate step ids, unknown actions, invalid modes, references to future or missing steps, and unsupported input values.

## Approval

`mutate` actions require explicit mode allowance and approval hook approval. The approval hook receives an `approvalContext` with `userId`, `actionName`, `mode`, deterministic `inputHash`, and optional `resourceIds`, `dryRunHash`, `expiresAt`, `workflowId`, and `stepId`.

Core does not issue or sign approval tokens. Applications should validate the token against the approval context.

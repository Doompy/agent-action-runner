# Agent Action Runner

A safe, application-native action and workflow runner for TypeScript backends.

Expose existing service logic as agent-callable actions with schema validation, policy guards, dry-run, human approval, and audit logging without giving agents direct database, internal API, or arbitrary code execution access.

## Status

This repository starts with a framework-agnostic core package and a NestJS adapter:

- Action registry
- Sequential JSON workflow runner
- Zod input and output validation
- Action mode enforcement
- Policy, approval, and audit hooks
- Restricted step output references
- NestJS `@AgentAction()` provider discovery

## Packages

```txt
@agent-action-runner/core
@agent-action-runner/nestjs
```

## Install

```bash
npm install @agent-action-runner/core zod
```

## Example

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
  description: 'Search delivery jobs by filters.',
  inputSchema: z.object({
    status: z.array(z.string()).optional(),
    campaignId: z.string().optional(),
    from: z.string(),
    to: z.string(),
  }),
  outputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  handler: async (input) => {
    return { jobIds: ['job_1', 'job_2'] };
  },
});

runner.registerAction({
  name: 'delivery.dryRunRetry',
  mode: 'dryRun',
  inputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  handler: async (input) => {
    return { retryable: input.jobIds, blocked: [] };
  },
});

const result = await runner.executeWorkflow({
  userId: 'user_1',
  workflow: {
    workflowName: 'retry-failed-delivery-jobs',
    steps: [
      {
        id: 'jobs',
        action: 'delivery.searchJobs',
        input: {
          status: ['FAILED'],
          from: '2026-05-01',
          to: '2026-05-06',
        },
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
```

## NestJS Adapter

```bash
npm install @agent-action-runner/core @agent-action-runner/nestjs zod
```

```ts
import { Injectable, Module } from '@nestjs/common';
import { AgentAction, AgentRunnerModule } from '@agent-action-runner/nestjs';
import { z } from 'zod';

@Injectable()
class DeliveryAgentActions {
  @AgentAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    inputSchema: z.object({
      status: z.array(z.string()),
    }),
  })
  searchJobs(input: { status: string[] }) {
    return { jobIds: ['job_1', 'job_2'] };
  }
}

@Module({
  imports: [
    AgentRunnerModule.forRoot({
      audit: async (event) => {
        console.log(event.actionName, event.status);
      },
    }),
  ],
  providers: [DeliveryAgentActions],
})
export class AppModule {}
```

Decorated provider methods are registered into the shared core runner during NestJS module initialization. Use `InjectAgentRunner()` or the `AGENT_RUNNER` token when you need to execute actions or workflows from another NestJS provider.

## License

Licensed under the Apache License, Version 2.0.

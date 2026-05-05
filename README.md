# Agent Action Runner

A safe, application-native action and workflow runner for TypeScript backends.

Expose existing service logic as agent-callable actions with schema validation, policy guards, dry-run, human approval, and audit logging without giving agents direct database, internal API, or arbitrary code execution access.

## Status

Experimental / pre-1.0. Public APIs may change while the action, workflow, and approval contracts settle.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

This repository starts with a framework-agnostic core package and first-party framework adapters:

- Action registry
- Sequential JSON workflow runner
- Zod input and output validation
- Action mode enforcement
- Policy, approval, and audit hooks
- Restricted step output references
- NestJS `@AgentAction()` provider discovery
- Express and Fastify HTTP adapters

## Packages

```txt
@agent-action-runner/core
@agent-action-runner/nestjs
@agent-action-runner/http
@agent-action-runner/express
@agent-action-runner/fastify
```

Before publishing these packages, the `@agent-action-runner` npm organization/scope must exist and the publisher must have access to it.

## Core Quickstart

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

## NestJS Quickstart

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

## Express Quickstart

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/express express zod
```

```ts
import express from 'express';
import { createRunner } from '@agent-action-runner/core';
import { createExpressAdapter } from '@agent-action-runner/express';

const app = express();
const runner = createRunner();

app.use('/agent-runner', createExpressAdapter(runner, {
  getUserId: (req) => req.header('x-user-id') ?? 'user_1',
}));
```

## Fastify Quickstart

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/fastify fastify zod
```

```ts
import Fastify from 'fastify';
import { createRunner } from '@agent-action-runner/core';
import { agentRunnerFastifyPlugin } from '@agent-action-runner/fastify';

const app = Fastify();
const runner = createRunner();

await app.register(agentRunnerFastifyPlugin, {
  prefix: '/agent-runner',
  runner,
  getUserId: async (request) => request.headers['x-user-id']?.toString() ?? 'user_1',
});
```

The HTTP adapters expose `GET /actions`, `POST /actions/:name/execute`, and `POST /workflows/execute`. Server-side resolver hooks control user identity, allowed modes, approval tokens, approval context, and metadata.

## Mutate Approval Model

`mutate` actions are blocked by default unless the execution explicitly allows `mutate` mode and the configured approval hook approves the request.

The approval hook receives:

```ts
{
  approvalToken?: string;
  approvalContext: {
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
}
```

Core does not issue or sign approval tokens. Applications should bind approval tokens to the approval context fields they care about, especially `userId`, `actionName`, `mode`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`.

## Publish Checklist

This repository is configured for public scoped packages:

```bash
npm run build
npm run typecheck
npm test
npm run pack:check
```

Actual publishing is intentionally manual:

```bash
npm publish --workspace @agent-action-runner/core --access public
npm publish --workspace @agent-action-runner/nestjs --access public
npm publish --workspace @agent-action-runner/http --access public
npm publish --workspace @agent-action-runner/express --access public
npm publish --workspace @agent-action-runner/fastify --access public
```

## License

Licensed under the Apache License, Version 2.0.

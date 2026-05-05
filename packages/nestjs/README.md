# @agent-action-runner/nestjs

NestJS adapter for Agent Action Runner.

Experimental / pre-1.0. Public APIs may change while the action, workflow, and approval contracts settle.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/nestjs zod
```

## Quickstart

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
      approval: ({ approvalToken, approvalContext }) => (
        approvalToken === 'approved'
        && approvalContext.mode === 'mutate'
          ? { approved: true }
          : { approved: false }
      ),
    }),
  ],
  providers: [DeliveryAgentActions],
})
export class AppModule {}
```

Use `InjectAgentRunner()` to inject the shared runner into another provider:

```ts
import { Injectable } from '@nestjs/common';
import type { AgentActionRunner } from '@agent-action-runner/core';
import { InjectAgentRunner } from '@agent-action-runner/nestjs';

@Injectable()
class AgentWorkflowService {
  constructor(
    @InjectAgentRunner()
    private readonly runner: AgentActionRunner,
  ) {}
}
```

Decorated provider methods are registered into the shared core runner during NestJS module initialization. `mutate` actions follow the same approval model as `@agent-action-runner/core`.

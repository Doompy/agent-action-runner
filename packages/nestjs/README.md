# @agent-action-runner/nestjs

NestJS adapter for Agent Action Runner.

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
  imports: [AgentRunnerModule.forRoot()],
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

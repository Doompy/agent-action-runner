# @agent-action-runner/nestjs

NestJS adapter for Agent Action Runner.

Use this package when your existing business logic already lives in NestJS services and you want to expose selected methods as agent-callable actions through the shared core runner.

The adapter registers selected provider methods as actions. It does not execute agent-generated code or auto-expose arbitrary providers.

Experimental / pre-1.0. Public APIs may change while the action, workflow, and approval contracts settle.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/nestjs zod
```

NestJS packages, `reflect-metadata`, and `rxjs` are peer dependencies through your NestJS application.

## What It Provides

- `@AgentAction()` method decorator.
- `AgentRunnerModule.forRoot()` dynamic module.
- NestJS provider discovery for decorated methods.
- `InjectAgentRunner()` helper for injecting the shared core runner.
- Access to the same policy, approval, audit, schema validation, and workflow execution behavior as `@agent-action-runner/core`.

## Quickstart

```ts
import { Injectable, Module } from '@nestjs/common';
import { AgentAction, AgentRunnerModule } from '@agent-action-runner/nestjs';
import { z } from 'zod';

const SearchJobsInput = z.object({
  status: z.array(z.string()),
});

@Injectable()
class DeliveryAgentActions {
  constructor(private readonly deliveryService: DeliveryService) {}

  @AgentAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    description: 'Search delivery jobs by status.',
    tags: ['delivery', 'operations'],
    resourceType: 'deliveryJob',
    riskLevel: 'low',
    inputSchema: SearchJobsInput,
    outputSchema: z.object({
      jobIds: z.array(z.string()),
    }),
  })
  async searchJobs(input: z.infer<typeof SearchJobsInput>) {
    return this.deliveryService.searchJobs(input);
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
  providers: [DeliveryAgentActions, DeliveryService],
})
export class AppModule {}
```

Decorated provider methods are registered into the shared core runner during NestJS module initialization.

## Mutate Action Example

```ts
import type { AgentExecutionContext } from '@agent-action-runner/core';

@Injectable()
class DeliveryAgentActions {
  constructor(private readonly deliveryService: DeliveryService) {}

  @AgentAction({
    name: 'delivery.executeRetry',
    mode: 'mutate',
    description: 'Retry approved delivery jobs.',
    tags: ['delivery', 'retry'],
    resourceType: 'deliveryJob',
    riskLevel: 'high',
    approvalRequired: true,
    inputSchema: z.object({
      jobIds: z.array(z.string()),
    }),
    outputSchema: z.object({
      retried: z.number(),
    }),
  })
  async executeRetry(input: { jobIds: string[] }, ctx: AgentExecutionContext) {
    ctx.requireApproval();
    return this.deliveryService.executeRetry(input.jobIds);
  }
}
```

`mutate` actions still require explicit mode allowance and approval hook approval. The NestJS adapter does not bypass core safety checks.

## Configure Hooks

`AgentRunnerModule.forRoot()` accepts the same options as `createRunner()`.

```ts
AgentRunnerModule.forRoot({
  global: true,
  defaultAllowedModes: ['read', 'draft', 'dryRun'],
  policy: async ({ action, context }) => {
    return context.userId.startsWith('operator_')
      ? { allowed: true }
      : { allowed: false, reason: `User cannot run ${action.name}.` };
  },
  approval: async ({ approvalToken, approvalContext }) => {
    return verifyApprovalToken(approvalToken, approvalContext)
      ? { approved: true, approvalId: 'approval_1' }
      : { approved: false };
  },
  audit: async (event) => {
    await auditStore.write(event);
  },
});
```

Set `global: true` if you want to inject the runner from modules that do not import `AgentRunnerModule` directly.

## Inject The Runner

```ts
import { Injectable } from '@nestjs/common';
import type { AgentActionRunner, WorkflowDefinition } from '@agent-action-runner/core';
import { InjectAgentRunner } from '@agent-action-runner/nestjs';

@Injectable()
class AgentWorkflowService {
  constructor(
    @InjectAgentRunner()
    private readonly runner: AgentActionRunner,
  ) {}

  execute(workflow: WorkflowDefinition) {
    return this.runner.executeWorkflow({
      userId: 'operator_1',
      workflow,
    });
  }
}
```

You can also inject the `AGENT_RUNNER` token directly.

## Expose HTTP Endpoints

This package only discovers and registers actions. To expose HTTP endpoints in NestJS, use the shared `@agent-action-runner/http` helpers from a controller.

```ts
import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AgentActionRunner } from '@agent-action-runner/core';
import {
  createActionListResponse,
  executeHttpAction,
  executeHttpWorkflow,
  mapAgentRunnerError,
} from '@agent-action-runner/http';
import { InjectAgentRunner } from '@agent-action-runner/nestjs';

@Controller('/agent-runner')
class AgentRunnerController {
  constructor(
    @InjectAgentRunner()
    private readonly runner: AgentActionRunner,
  ) {}

  @Get('/actions')
  listActions() {
    return createActionListResponse(this.runner);
  }

  @Post('/actions/:name/execute')
  async executeAction(
    @Param('name') name: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    try {
      const result = await executeHttpAction(this.runner, name, body, {
        userId: request.header('x-user-id') ?? 'anonymous',
        approvalToken: request.header('x-approval-token'),
      });
      response.json(result);
    } catch (error) {
      const mapped = mapAgentRunnerError(error);
      response.status(mapped.statusCode).json(mapped.response);
    }
  }

  @Post('/workflows/execute')
  async executeWorkflow(@Body() body: unknown, @Req() request: Request) {
    return executeHttpWorkflow(this.runner, body, {
      userId: request.header('x-user-id') ?? 'anonymous',
    });
  }
}
```

In production, resolve `userId`, allowed modes, approval token, approval context, and metadata from your NestJS auth/session layer.

## Public API

- `AgentRunnerModule`
- `AgentAction`
- `InjectAgentRunner`
- `AGENT_RUNNER`
- `AGENT_RUNNER_OPTIONS`
- `AGENT_ACTION_METADATA`

## Example

See `examples/nestjs-admin-ops` for a runnable NestJS app with:

- decorated `admin.*` actions
- HTTP endpoints backed by `@agent-action-runner/http`
- HMAC-bound approval tokens
- in-memory audit trail

## License

Apache-2.0

import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AgentActionRunner, AgentExecutionContext } from '@agent-action-runner/core';
import { fromStep } from '@agent-action-runner/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AGENT_RUNNER,
  AgentAction,
  AgentRunnerModule,
  InjectAgentRunner,
} from './index.js';

@Injectable()
class DeliveryAgentActions {
  @AgentAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    inputSchema: z.object({
      status: z.array(z.string()),
    }),
    outputSchema: z.object({
      jobIds: z.array(z.string()),
    }),
  })
  searchJobs(input: { status: string[] }, context: AgentExecutionContext) {
    return {
      jobIds: input.status.includes('FAILED')
        ? [`job_for_${context.userId}`]
        : [],
    };
  }

  @AgentAction({
    name: 'delivery.dryRunRetry',
    mode: 'dryRun',
    inputSchema: z.object({
      jobIds: z.array(z.string()),
    }),
  })
  dryRunRetry(input: { jobIds: string[] }) {
    return {
      retryable: input.jobIds,
      blocked: [],
    };
  }

  @AgentAction({
    name: 'delivery.executeRetry',
    mode: 'mutate',
    inputSchema: z.object({
      jobIds: z.array(z.string()),
    }),
  })
  executeRetry(input: { jobIds: string[] }) {
    return {
      retried: input.jobIds.length,
    };
  }
}

@Injectable()
class RunnerConsumer {
  constructor(
    @InjectAgentRunner()
    readonly runner: AgentActionRunner,
  ) {}
}

describe('AgentRunnerModule', () => {
  it('discovers decorated provider methods and registers core actions', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AgentRunnerModule.forRoot()],
      providers: [DeliveryAgentActions],
    }).compile();

    await moduleRef.init();

    const runner = moduleRef.get<AgentActionRunner>(AGENT_RUNNER);

    expect(runner.listActions().map((action) => action.name).sort()).toEqual([
      'delivery.dryRunRetry',
      'delivery.executeRetry',
      'delivery.searchJobs',
    ]);

    const result = await runner.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'retry-failed-jobs',
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

    expect(result.outputByStep.dryRun).toEqual({
      retryable: ['job_for_user_1'],
      blocked: [],
    });

    await moduleRef.close();
  });

  it('injects the shared runner with InjectAgentRunner', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AgentRunnerModule.forRoot()],
      providers: [RunnerConsumer],
    }).compile();

    const runner = moduleRef.get<AgentActionRunner>(AGENT_RUNNER);
    const consumer = moduleRef.get(RunnerConsumer);

    expect(consumer.runner).toBe(runner);

    await moduleRef.close();
  });

  it('uses the module approval hook for mutate actions', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AgentRunnerModule.forRoot({
          approval: ({ approvalToken, approvalContext }) => (
            approvalToken === 'token_1'
            && approvalContext.actionName === 'delivery.executeRetry'
            && approvalContext.resourceIds?.[0] === 'job_1'
              ? { approved: true, approvalId: 'approval_1' }
              : { approved: false }
          ),
        }),
      ],
      providers: [DeliveryAgentActions],
    }).compile();

    await moduleRef.init();

    const runner = moduleRef.get<AgentActionRunner>(AGENT_RUNNER);
    const result = await runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: { jobIds: ['job_1'] },
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
      approvalContext: {
        resourceIds: ['job_1'],
      },
    });

    expect(result).toMatchObject({
      actionName: 'delivery.executeRetry',
      mode: 'mutate',
      output: { retried: 1 },
      approvalId: 'approval_1',
    });

    await moduleRef.close();
  });
});

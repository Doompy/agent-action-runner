import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createRunner,
  defineAction,
  defineActionCatalog,
  defineWorkflow,
  registerActionCatalog,
  DuplicateWorkflowStepError,
} from './index.js';

const actions = defineActionCatalog({
  searchJobs: defineAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    inputSchema: z.object({
      status: z.array(z.string()),
    }),
    outputSchema: z.object({
      jobIds: z.array(z.string()),
    }),
    handler: () => ({
      jobIds: ['job_1', 'job_2'],
    }),
  }),
  dryRunRetry: defineAction({
    name: 'delivery.dryRunRetry',
    mode: 'dryRun',
    inputSchema: z.object({
      jobIds: z.array(z.string()),
    }),
    outputSchema: z.object({
      retryable: z.array(z.string()),
      blocked: z.array(z.string()),
    }),
    handler: (input) => ({
      retryable: input.jobIds,
      blocked: [],
    }),
  }),
});

describe('workflow builder', () => {
  it('builds a JSON workflow definition', () => {
    const workflow = defineWorkflow('retry-failed-jobs')
      .step('jobs', actions.searchJobs, {
        status: ['FAILED'],
      })
      .step('dryRun', actions.dryRunRetry, ({ fromStep }) => ({
        jobIds: fromStep('jobs', '/jobIds'),
      }), {
        idempotencyKey: 'retry:job_1:dry_run_hash',
        timeoutMs: 1000,
        retry: {
          maxAttempts: 2,
          delayMs: 5,
        },
        continueOnError: true,
      })
      .build();

    expect(workflow).toEqual({
      workflowName: 'retry-failed-jobs',
      steps: [
        {
          id: 'jobs',
          action: 'delivery.searchJobs',
          input: {
            status: ['FAILED'],
          },
        },
        {
          id: 'dryRun',
          action: 'delivery.dryRunRetry',
          input: {
            jobIds: {
              $fromStep: 'jobs',
              path: '/jobIds',
            },
          },
          idempotencyKey: 'retry:job_1:dry_run_hash',
          timeoutMs: 1000,
          retry: {
            maxAttempts: 2,
            delayMs: 5,
          },
          continueOnError: true,
        },
      ],
    });
  });

  it('executes a workflow built from an action catalog', async () => {
    const runner = createRunner({
      createExecutionId: () => 'exec_1',
    });
    registerActionCatalog(runner, actions);

    const workflow = defineWorkflow('retry-failed-jobs')
      .step('jobs', actions.searchJobs, {
        status: ['FAILED'],
      })
      .step('dryRun', actions.dryRunRetry, ({ fromStep }) => ({
        jobIds: fromStep('jobs', '/jobIds'),
      }))
      .build();

    const result = await runner.executeWorkflow({
      userId: 'user_1',
      workflow,
    });

    expect(result.outputByStep.dryRun).toEqual({
      retryable: ['job_1', 'job_2'],
      blocked: [],
    });
  });

  it('throws when a duplicate step id is added at runtime', () => {
    const builder = defineWorkflow('duplicate-steps')
      .step('jobs', actions.searchJobs, {
        status: ['FAILED'],
      });

    expect(() => (builder as any)
      .step('jobs', actions.searchJobs, {
        status: ['FAILED'],
      })).toThrow(DuplicateWorkflowStepError);
  });
});

function assertWorkflowBuilderTypes() {
  const workflow = defineWorkflow('types')
    .step('jobs', actions.searchJobs, {
      status: ['FAILED'],
    });

  workflow.step('dryRun', actions.dryRunRetry, ({ fromStep }) => ({
    jobIds: fromStep('jobs', '/jobIds'),
  }));

  defineWorkflow('invalid-input').step('jobs', actions.searchJobs, {
    status: [
      // @ts-expect-error action input follows the action input schema type
      123,
    ],
  });

  workflow.step('dryRun', actions.dryRunRetry, ({ fromStep }) => ({
    jobIds: fromStep(
      // @ts-expect-error fromStep can only reference previous step ids
      'missing',
      '/jobIds',
    ),
  }));

  // @ts-expect-error duplicate step ids are rejected by the builder type
  workflow.step('jobs', actions.dryRunRetry, {
    jobIds: [],
  });
}

void assertWorkflowBuilderTypes;

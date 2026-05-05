import { createRunner, fromStep } from '@agent-action-runner/core';
import { z } from 'zod';

const runner = createRunner({
  audit: (event) => {
    console.log(`[audit] ${event.actionName} ${event.status}`);
  },
});

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  description: 'Search delivery jobs by status.',
  inputSchema: z.object({
    status: z.array(z.string()),
    from: z.string(),
    to: z.string(),
  }),
  outputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  handler: async (input) => {
    console.log(`Searching jobs from ${input.from} to ${input.to}: ${input.status.join(', ')}`);
    return { jobIds: ['job_1', 'job_2'] };
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
    return {
      retryable: input.jobIds,
      blocked: [],
    };
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
        id: 'retryCheck',
        action: 'delivery.dryRunRetry',
        input: {
          jobIds: fromStep('jobs', '/jobIds'),
        },
      },
    ],
  },
});

console.log(JSON.stringify(result.outputByStep.retryCheck, null, 2));

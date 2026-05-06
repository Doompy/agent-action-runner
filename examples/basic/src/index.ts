import {
  createRunner,
  defineAction,
  defineActionCatalog,
  defineWorkflow,
  registerActionCatalog,
} from '@agent-action-runner/core';
import { z } from 'zod';

const runner = createRunner({
  audit: (event) => {
    console.log(`[audit] ${event.actionName} ${event.status}`);
  },
});

const actions = defineActionCatalog({
  searchJobs: defineAction({
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
  }),
  dryRunRetry: defineAction({
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
  }),
});

registerActionCatalog(runner, actions);

const workflow = defineWorkflow('retry-failed-delivery-jobs')
  .step('jobs', actions.searchJobs, {
    status: ['FAILED'],
    from: '2026-05-01',
    to: '2026-05-06',
  })
  .step('retryCheck', actions.dryRunRetry, ({ fromStep }) => ({
    jobIds: fromStep('jobs', '/jobIds'),
  }))
  .build();

const result = await runner.executeWorkflow({
  userId: 'user_1',
  workflow,
});

console.log(JSON.stringify(result.outputByStep.retryCheck, null, 2));

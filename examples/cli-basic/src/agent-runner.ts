import { createRunner } from '@agent-action-runner/core';
import { z } from 'zod';

export const runner = createRunner();

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  description: 'Search delivery jobs by status.',
  inputSchema: z.object({
    status: z.array(z.string()),
  }),
  outputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  handler: (input) => ({
    jobIds: input.status.includes('FAILED') ? ['job_1', 'job_2'] : [],
  }),
});

runner.registerAction({
  name: 'delivery.dryRunRetry',
  mode: 'dryRun',
  description: 'Validate delivery jobs before retrying.',
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
});

export default runner;

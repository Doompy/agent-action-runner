import {
  createStableHash,
  type AgentActionRunner,
  type AgentExecutionContext,
} from '@agent-action-runner/core';
import { z } from 'zod';
import type { DeliveryJob, DeliveryJobStatus } from './data.js';

const RetryableFailureCodes = new Set(['CMS_TIMEOUT', 'NETWORK_ERROR']);

export const DeliveryJobSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  mediaId: z.string(),
  status: z.enum(['PENDING', 'FAILED', 'DLQ', 'RETRY_QUEUED', 'COMPLETED']),
  failureCode: z.string().optional(),
  attempts: z.number(),
  maxAttempts: z.number(),
  createdAt: z.string(),
});

export const SearchJobsInputSchema = z.object({
  status: z.array(z.enum(['PENDING', 'FAILED', 'DLQ', 'RETRY_QUEUED', 'COMPLETED'])).optional(),
  campaignId: z.string().optional(),
  retryable: z.boolean().optional(),
});

export const SearchJobsOutputSchema = z.object({
  jobs: z.array(DeliveryJobSchema),
  jobIds: z.array(z.string()),
});

export const DryRunRetryInputSchema = z.object({
  jobIds: z.array(z.string()).min(1),
  reason: z.string().min(1),
});

export const DryRunRetryOutputSchema = z.object({
  resourceIds: z.array(z.string()),
  retryableJobIds: z.array(z.string()),
  blockedJobIds: z.array(z.string()),
  dryRunHash: z.string(),
  impactSummary: z.string(),
});

export const ExecuteRetryInputSchema = z.object({
  jobIds: z.array(z.string()).min(1),
  reason: z.string().min(1),
  dryRunHash: z.string(),
});

export const ExecuteRetryOutputSchema = z.object({
  retriedJobIds: z.array(z.string()),
  skippedJobIds: z.array(z.string()),
});

export const RetryJobsApprovalRequestSchema = z.object({
  jobIds: z.array(z.string()).min(1),
  reason: z.string().min(1),
  dryRunHash: z.string(),
});

export type SearchJobsInput = z.infer<typeof SearchJobsInputSchema>;
export type SearchJobsOutput = z.infer<typeof SearchJobsOutputSchema>;
export type DryRunRetryInput = z.infer<typeof DryRunRetryInputSchema>;
export type DryRunRetryOutput = z.infer<typeof DryRunRetryOutputSchema>;
export type ExecuteRetryInput = z.infer<typeof ExecuteRetryInputSchema>;
export type ExecuteRetryOutput = z.infer<typeof ExecuteRetryOutputSchema>;
export type RetryJobsApprovalRequest = z.infer<typeof RetryJobsApprovalRequestSchema>;

export function registerDeliveryActions(
  runner: AgentActionRunner,
  jobs: DeliveryJob[],
): void {
  runner.registerAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    description: 'Search delivery jobs by status, campaign, and retryability.',
    tags: ['delivery', 'operations'],
    resourceType: 'deliveryJob',
    riskLevel: 'low',
    examples: [
      {
        title: 'Search failed spring campaign jobs',
        input: { status: ['FAILED', 'DLQ'], campaignId: 'campaign_spring' },
      },
    ],
    inputSchema: SearchJobsInputSchema,
    outputSchema: SearchJobsOutputSchema,
    handler: (input) => searchDeliveryJobs(jobs, input),
  });

  runner.registerAction({
    name: 'delivery.dryRunRetry',
    mode: 'dryRun',
    description: 'Preview retry eligibility and impact for delivery jobs.',
    tags: ['delivery', 'retry', 'approval'],
    resourceType: 'deliveryJob',
    riskLevel: 'medium',
    inputSchema: DryRunRetryInputSchema,
    outputSchema: DryRunRetryOutputSchema,
    handler: (input) => dryRunRetryDeliveryJobs(jobs, input),
  });

  runner.registerAction({
    name: 'delivery.executeRetry',
    mode: 'mutate',
    description: 'Queue approved retryable delivery jobs for retry.',
    tags: ['delivery', 'retry'],
    resourceType: 'deliveryJob',
    riskLevel: 'high',
    approvalRequired: true,
    inputSchema: ExecuteRetryInputSchema,
    outputSchema: ExecuteRetryOutputSchema,
    handler: (input, context) => executeRetryDeliveryJobs(jobs, input, context),
  });
}

export function searchDeliveryJobs(
  jobs: readonly DeliveryJob[],
  input: SearchJobsInput,
): SearchJobsOutput {
  const filtered = jobs.filter((job) => {
    const matchesStatus = !input.status || input.status.includes(job.status);
    const matchesCampaign = !input.campaignId || job.campaignId === input.campaignId;
    const matchesRetryable = input.retryable === undefined || isRetryable(job) === input.retryable;
    return matchesStatus && matchesCampaign && matchesRetryable;
  });

  return {
    jobs: filtered.map((job) => ({ ...job })),
    jobIds: filtered.map((job) => job.id),
  };
}

export function dryRunRetryDeliveryJobs(
  jobs: readonly DeliveryJob[],
  input: DryRunRetryInput,
): DryRunRetryOutput {
  const selectedJobs = input.jobIds.map((jobId) => findJob(jobs, jobId));
  const retryableJobIds = selectedJobs.filter(isRetryable).map((job) => job.id);
  const blockedJobIds = selectedJobs.filter((job) => !isRetryable(job)).map((job) => job.id);
  const dryRunInput = {
    actionName: 'delivery.dryRunRetry',
    input,
    retryableJobIds,
    blockedJobIds,
  };

  return {
    resourceIds: input.jobIds,
    retryableJobIds,
    blockedJobIds,
    dryRunHash: createStableHash(dryRunInput),
    impactSummary: `${retryableJobIds.length} jobs retryable, ${blockedJobIds.length} jobs blocked.`,
  };
}

export function executeRetryDeliveryJobs(
  jobs: DeliveryJob[],
  input: ExecuteRetryInput,
  context: AgentExecutionContext,
): ExecuteRetryOutput {
  context.requireApproval();

  const retriedJobIds: string[] = [];
  const skippedJobIds: string[] = [];

  for (const jobId of input.jobIds) {
    const job = findJob(jobs, jobId);
    if (!isRetryable(job)) {
      skippedJobIds.push(job.id);
      continue;
    }

    const index = jobs.findIndex((candidate) => candidate.id === job.id);
    jobs[index] = {
      ...job,
      status: 'RETRY_QUEUED',
      attempts: job.attempts + 1,
    };
    retriedJobIds.push(job.id);
  }

  return {
    retriedJobIds,
    skippedJobIds,
  };
}

function findJob(jobs: readonly DeliveryJob[], jobId: string): DeliveryJob {
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    throw new Error(`Delivery job "${jobId}" was not found.`);
  }

  return job;
}

function isRetryable(job: DeliveryJob): boolean {
  return isRetryableStatus(job.status)
    && typeof job.failureCode === 'string'
    && RetryableFailureCodes.has(job.failureCode)
    && job.attempts < job.maxAttempts;
}

function isRetryableStatus(status: DeliveryJobStatus): boolean {
  return status === 'FAILED' || status === 'DLQ';
}

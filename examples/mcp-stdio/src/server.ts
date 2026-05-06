import { createRunner } from '@agent-action-runner/core';
import { createMcpExporter } from '@agent-action-runner/mcp';
import { z } from 'zod';

export function createMcpStdioExampleRunner() {
  const runner = createRunner();

  runner.registerAction({
    name: 'math.double',
    mode: 'read',
    description: 'Double a number.',
    inputSchema: z.object({
      value: z.number(),
    }),
    outputSchema: z.object({
      value: z.number(),
      userId: z.string(),
    }),
    handler: (input, context) => ({
      value: input.value * 2,
      userId: context.userId,
    }),
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
    handler: (input) => ({
      jobIds: input.status.includes('FAILED') ? ['job_1', 'job_2'] : [],
    }),
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
    handler: (input) => ({
      retryable: input.jobIds,
      blocked: [],
    }),
  });

  return runner;
}

export function createMcpStdioExampleServer() {
  return createMcpExporter(createMcpStdioExampleRunner(), {
    getUserId: () => process.env.AGENT_RUNNER_USER_ID ?? 'demo_user',
  });
}

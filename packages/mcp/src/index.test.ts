import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunner } from '@agent-action-runner/core';
import {
  createMcpToolCatalog,
  registerMcpTools,
} from './index.js';
import type { McpToolRequestContext } from './index.js';

describe('@agent-action-runner/mcp', () => {
  it('lists only read, draft, and dryRun actions by default', () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      description: 'Double a number.',
      inputSchema: z.object({ value: z.number() }),
      handler: (input) => ({ value: input.value * 2 }),
    });
    runner.registerAction({
      name: 'delivery.retry',
      mode: 'mutate',
      inputSchema: z.object({ jobId: z.string() }),
      handler: () => ({ retried: true }),
    });

    expect(createMcpToolCatalog(runner)).toEqual([
      expect.objectContaining({
        name: 'math_double',
        actionName: 'math.double',
        mode: 'read',
        approvalRequired: false,
      }),
    ]);
  });

  it('exports mutate actions only with explicit opt-in', () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'delivery.retry',
      mode: 'mutate',
      inputSchema: z.object({ jobId: z.string() }),
      handler: () => ({ retried: true }),
    });

    expect(createMcpToolCatalog(runner)).toHaveLength(0);
    expect(createMcpToolCatalog(runner, { exposeMutations: true })).toEqual([
      expect.objectContaining({
        name: 'delivery_retry',
        actionName: 'delivery.retry',
        mode: 'mutate',
        approvalRequired: true,
      }),
    ]);
  });

  it('skips schema-less actions by default', () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'system.ping',
      mode: 'read',
      handler: () => ({ ok: true }),
    });

    expect(createMcpToolCatalog(runner)).toHaveLength(0);
  });

  it('executes registered tools with server-derived user id', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      inputSchema: z.object({ value: z.number() }),
      handler: (input, context) => ({
        value: input.value * 2,
        userId: context.userId,
      }),
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerMcpTools(server, runner, {
      getUserId: () => 'user_1',
    });

    const result = await callRegisteredTool(server, 'math_double', { value: 21 });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      actionName: 'math.double',
      mode: 'read',
      output: {
        value: 42,
        userId: 'user_1',
      },
    });
  });

  it('does not trust client-supplied approval options in tool arguments', async () => {
    const runner = createRunner({
      approval: ({ approvalContext, approvalToken }) => (
        approvalToken === 'approved' && approvalContext.resourceIds?.[0] === 'job_1'
          ? { approved: true, approvalId: 'approval_1' }
          : { approved: false }
      ),
    });
    runner.registerAction({
      name: 'delivery.retry',
      mode: 'mutate',
      inputSchema: z.object({ jobId: z.string() }),
      handler: (input) => ({ retried: input.jobId }),
    });

    const rejectedServer = new McpServer({ name: 'test', version: '0.0.0' });
    registerMcpTools(rejectedServer, runner, {
      exposeMutations: true,
      getUserId: () => 'user_1',
      getApprovalToken: () => 'approved',
    });

    const rejected = await callRegisteredTool(rejectedServer, 'delivery_retry', {
      jobId: 'job_1',
      approvalToken: 'approved',
      approvalContext: {
        resourceIds: ['job_1'],
      },
    });
    expect(rejected.isError).toBe(true);

    const approvedServer = new McpServer({ name: 'test', version: '0.0.0' });
    registerMcpTools(approvedServer, runner, {
      exposeMutations: true,
      getUserId: () => 'user_1',
      getApprovalToken: () => 'approved',
      getApprovalContext: () => ({ resourceIds: ['job_1'] }),
    });

    const approved = await callRegisteredTool(approvedServer, 'delivery_retry', {
      jobId: 'job_1',
      approvalToken: 'ignored',
    });
    expect(approved.isError).toBe(false);
    expect(approved.structuredContent).toMatchObject({
      approvalId: 'approval_1',
      output: {
        retried: 'job_1',
      },
    });
  });

  it('does not trust client-supplied allowed modes in tool arguments', async () => {
    const runner = createRunner({
      approval: () => ({ approved: true, approvalId: 'approval_1' }),
    });
    runner.registerAction({
      name: 'delivery.retry',
      mode: 'mutate',
      inputSchema: z.object({ jobId: z.string() }),
      handler: (input) => ({ retried: input.jobId }),
    });

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerMcpTools(server, runner, {
      exposeMutations: true,
      allowedModes: ['read'],
      getUserId: () => 'user_1',
      getApprovalToken: () => 'approved',
    });

    const result = await callRegisteredTool(server, 'delivery_retry', {
      jobId: 'job_1',
      allowedModes: ['mutate'],
    });

    expect(result.isError).toBe(true);
  });
});

async function callRegisteredTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const tools = (server as unknown as {
    readonly _registeredTools: Record<string, {
      readonly handler: (args: Record<string, unknown>, extra: McpToolRequestContext) => Promise<CallToolResult>;
    }>;
  })._registeredTools;
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" was not registered.`);
  }

  return tool.handler(args, createToolContext());
}

function createToolContext(): McpToolRequestContext {
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification: async () => {},
    sendRequest: async () => {
      throw new Error('sendRequest is not used in these tests.');
    },
  } as McpToolRequestContext;
}

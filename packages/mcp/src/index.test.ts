import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunner } from '@agent-action-runner/core';
import {
  createMcpExporter,
  createMcpToolCatalog,
  createMcpToolReport,
  registerMcpTools,
} from './index.js';
import type { McpToolRequestContext } from './index.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { readonly version: string };

describe('@agent-action-runner/mcp', () => {
  it('uses the package version as the default MCP server version', () => {
    const server = createMcpExporter(createRunner());
    expect(getServerInfo(server).version).toBe(packageJson.version);
  });

  it('lists only read, draft, and dryRun actions by default', () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      description: 'Double a number.',
      tags: ['math'],
      resourceType: 'number',
      riskLevel: 'low',
      examples: [
        {
          title: 'Double 21',
          input: { value: 21 },
        },
      ],
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
        tags: ['math'],
        resourceType: 'number',
        riskLevel: 'low',
        examples: [
          {
            title: 'Double 21',
            input: { value: 21 },
          },
        ],
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

  it('reports why actions are skipped without changing the exported catalog shape', () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'system.ping',
      mode: 'read',
      handler: () => ({ ok: true }),
    });
    runner.registerAction({
      name: 'system.echo',
      mode: 'read',
      inputSchema: z.string(),
      handler: (input) => input,
    });
    runner.registerAction({
      name: 'draft.email',
      mode: 'draft',
      inputSchema: z.object({ subject: z.string() }),
      handler: (input) => input,
    });
    runner.registerAction({
      name: 'delivery.retry',
      mode: 'mutate',
      inputSchema: z.object({ jobId: z.string() }),
      handler: () => ({ retried: true }),
    });

    expect(createMcpToolCatalog(runner, { exposeModes: ['read'] })).toEqual([]);
    expect(createMcpToolReport(runner, { exposeModes: ['read'] })).toEqual([
      expect.objectContaining({
        exported: false,
        actionName: 'system.ping',
        skipReason: 'schemaMissing',
      }),
      expect.objectContaining({
        exported: false,
        actionName: 'system.echo',
        skipReason: 'schemaNotSerializable',
      }),
      expect.objectContaining({
        exported: false,
        actionName: 'draft.email',
        skipReason: 'modeNotExposed',
      }),
      expect.objectContaining({
        exported: false,
        actionName: 'delivery.retry',
        skipReason: 'mutationNotExposed',
      }),
    ]);
  });

  it('creates deterministic names for sanitized tool name collisions', () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'admin.searchUsers',
      mode: 'read',
      inputSchema: z.object({ query: z.string().optional() }),
      handler: () => ({ users: [] }),
    });
    runner.registerAction({
      name: 'admin_searchUsers',
      mode: 'read',
      inputSchema: z.object({ query: z.string().optional() }),
      handler: () => ({ users: [] }),
    });

    expect(createMcpToolCatalog(runner).map((tool) => tool.name)).toEqual([
      'admin_searchUsers',
      'admin_searchUsers_2',
    ]);
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
    const tool = getRegisteredTool(server, 'math_double');

    expect(result.isError).toBe(false);
    expect(tool.description).toContain('Mode: read');
    expect(tool.description).toContain('Approval required: no');
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

  it('passes server-derived idempotency keys to action handlers', async () => {
    const runner = createRunner();
    const actionContexts: unknown[] = [];
    const rawInputs: unknown[] = [];
    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      tags: ['delivery'],
      resourceType: 'deliveryJob',
      riskLevel: 'medium',
      inputSchema: z.object({ jobId: z.coerce.string() }),
      handler: (input, context) => ({
        idempotencyKey: context.idempotencyKey ?? null,
        parsedJobIdType: typeof input.jobId,
      }),
    });

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerMcpTools(server, runner, {
      getUserId: () => 'user_1',
      getIdempotencyKey: (_context, action, input) => {
        actionContexts.push(action);
        rawInputs.push(input);
        return action.name === 'delivery.dryRunRetry' && isRecord(input)
          ? `dry-run:${String(input.jobId)}`
          : undefined;
      },
    });

    const result = await callRegisteredTool(server, 'delivery_dryRunRetry', {
      jobId: 1,
      idempotencyKey: 'client-key',
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      output: {
        idempotencyKey: 'dry-run:1',
        parsedJobIdType: 'string',
      },
    });
    expect(actionContexts).toEqual([
      {
        name: 'delivery.dryRunRetry',
        mode: 'dryRun',
        tags: ['delivery'],
        resourceType: 'deliveryJob',
        riskLevel: 'medium',
        deprecated: undefined,
      },
    ]);
    expect(actionContexts[0]).not.toHaveProperty('handler');
    expect(rawInputs).toEqual([
      {
        jobId: 1,
        idempotencyKey: 'client-key',
      },
    ]);
  });
});

async function callRegisteredTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const tool = getRegisteredTool(server, toolName);
  return tool.handler(args, createToolContext());
}

function getRegisteredTool(
  server: McpServer,
  toolName: string,
): {
  readonly description?: string;
  readonly handler: (args: Record<string, unknown>, extra: McpToolRequestContext) => Promise<CallToolResult>;
} {
  const tools = (server as unknown as {
    readonly _registeredTools: Record<string, {
      readonly description?: string;
      readonly handler: (args: Record<string, unknown>, extra: McpToolRequestContext) => Promise<CallToolResult>;
    }>;
  })._registeredTools;
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" was not registered.`);
  }

  return tool;
}

function getServerInfo(server: McpServer): { readonly name: string; readonly version: string } {
  return (server as unknown as {
    readonly server: {
      readonly _serverInfo: {
        readonly name: string;
        readonly version: string;
      };
    };
  }).server._serverInfo;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

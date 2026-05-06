import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import type { McpToolRequestContext } from '@agent-action-runner/mcp';
import { createMcpToolCatalog } from '@agent-action-runner/mcp';
import {
  createMcpStdioExampleRunner,
  createMcpStdioExampleServer,
} from './server.js';

describe('mcp stdio example', () => {
  it('exports read and dryRun tools', () => {
    const catalog = createMcpToolCatalog(createMcpStdioExampleRunner());

    expect(catalog.map((tool) => tool.name)).toEqual([
      'math_double',
      'delivery_searchJobs',
      'delivery_dryRunRetry',
    ]);
  });

  it('executes an exported tool through the MCP handler', async () => {
    const server = createMcpStdioExampleServer();

    const result = await callRegisteredTool(server, 'math_double', {
      value: 21,
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      actionName: 'math.double',
      mode: 'read',
      output: {
        value: 42,
        userId: 'demo_user',
      },
    });
  });
});

async function callRegisteredTool(
  server: unknown,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const tools = (server as {
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
      throw new Error('sendRequest is not used in this test.');
    },
  } as McpToolRequestContext;
}

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import type { McpToolRequestContext } from '@agent-action-runner/mcp';
import { createMcpToolCatalog } from '@agent-action-runner/mcp';
import { createMcpAdminOpsExample } from './server.js';

describe('mcp admin ops example', () => {
  it('exports read and dryRun actions while excluding mutate by default', () => {
    const { runner } = createMcpAdminOpsExample();
    const catalog = createMcpToolCatalog(runner);

    expect(catalog.map((tool) => tool.name)).toEqual([
      'admin_searchUsers',
      'admin_dryRunDisableUser',
    ]);
    expect(catalog.some((tool) => tool.actionName === 'admin.disableUser')).toBe(false);
  });

  it('executes admin search through the MCP handler', async () => {
    const { server } = createMcpAdminOpsExample();

    const result = await callRegisteredTool(server, 'admin_searchUsers', {
      query: 'casey',
      status: 'active',
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      actionName: 'admin.searchUsers',
      mode: 'read',
      output: {
        users: [
          expect.objectContaining({
            id: 'user_2',
            status: 'active',
          }),
        ],
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

# @agent-action-runner/mcp

MCP exporter for Agent Action Runner.

Use this package to expose registered Agent Action Runner actions as MCP tools while keeping the same schema validation, mode checks, approval hooks, and audit hooks from `@agent-action-runner/core`.

By default, only `read`, `draft`, and `dryRun` actions are exported. `mutate` actions require explicit opt-in and approval gating.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/mcp @modelcontextprotocol/sdk zod
```

## Usage

```ts
import { createRunner } from '@agent-action-runner/core';
import { createMcpExporter } from '@agent-action-runner/mcp';
import { z } from 'zod';

const runner = createRunner();

runner.registerAction({
  name: 'math.double',
  mode: 'read',
  inputSchema: z.object({
    value: z.number(),
  }),
  handler: (input) => ({
    value: input.value * 2,
  }),
});

const server = createMcpExporter(runner, {
  getUserId: () => 'user_1',
});
```

Connect the returned MCP server to a transport using the official MCP TypeScript SDK.

## Safety Defaults

- Exports `read`, `draft`, and `dryRun` actions by default.
- Does not export `mutate` actions unless `exposeMutations: true` is set.
- Does not trust approval tokens or allowed modes from tool arguments.
- Executes tools through the core runner, so policy, approval, audit, and schema validation still apply.

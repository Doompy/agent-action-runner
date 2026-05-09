# @agent-action-runner/mcp

MCP exporter for Agent Action Runner.

Use this package to expose registered Agent Action Runner actions as MCP tools while keeping the same schema validation, mode checks, approval hooks, policy hooks, and audit hooks from `@agent-action-runner/core`.

By default, only `read`, `draft`, and `dryRun` actions are exported. `mutate` actions require explicit opt-in and approval gating.

The exporter exposes your registered API boundary as tools. It does not execute agent-generated TypeScript or arbitrary code.

Experimental / pre-1.0.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/mcp @modelcontextprotocol/sdk zod
```

`@modelcontextprotocol/sdk` is a peer dependency. This package returns an MCP SDK `McpServer`; you choose the transport.

Zod 4 is required for MCP JSON Schema serialization. Core actions can still use Zod 3 for execution validation, but actions exported as MCP tools should use Zod 4-compatible schemas.

## Quickstart

```ts
import { createRunner } from '@agent-action-runner/core';
import { createMcpExporter } from '@agent-action-runner/mcp';
import { z } from 'zod';

const runner = createRunner();

runner.registerAction({
  name: 'math.double',
  mode: 'read',
  description: 'Double a number.',
  tags: ['math'],
  resourceType: 'number',
  riskLevel: 'low',
  inputSchema: z.object({
    value: z.number(),
  }),
  outputSchema: z.object({
    value: z.number(),
  }),
  handler: (input) => ({
    value: input.value * 2,
  }),
});

const server = createMcpExporter(runner, {
  getUserId: () => 'local_user',
});
```

## Stdio Server

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpExporter } from '@agent-action-runner/mcp';

const server = createMcpExporter(runner, {
  getUserId: () => process.env.AGENT_RUNNER_USER_ID ?? 'local_user',
});

await server.connect(new StdioServerTransport());
```

Do not write normal logs to stdout in a stdio MCP server. stdout is reserved for the MCP transport.

## Export Rules

Default behavior:

- exports `read`, `draft`, and `dryRun`
- skips `mutate`
- skips actions without an `inputSchema`
- skips actions whose input schema cannot be represented as an object JSON Schema
- sanitizes tool names by replacing unsupported characters with `_`
- resolves name collisions with deterministic numeric suffixes
- includes action metadata in tool descriptions and MCP `_meta`

Example:

```txt
delivery.searchJobs -> delivery_searchJobs
delivery.dryRunRetry -> delivery_dryRunRetry
```

## Mutate Actions

`mutate` actions are hidden by default. To export them, you must explicitly opt in.

```ts
const server = createMcpExporter(runner, {
  exposeMutations: true,
  allowedModes: ['read', 'draft', 'dryRun', 'mutate'],
  getUserId: () => 'operator_1',
  getApprovalToken: async (context) => readApprovalToken(context),
  getApprovalContext: async (context) => readApprovalContext(context),
});
```

Even when exported, mutate tools still run through the core runner. Approval hooks and policies still decide whether execution succeeds.

## Server-Side Context

The exporter does not trust user identity, allowed modes, approval token, approval context, or metadata from tool arguments.

```ts
createMcpExporter(runner, {
  getUserId: async (context) => {
    return context.authInfo?.extra?.userId?.toString() ?? 'local_user';
  },
  allowedModes: ['read', 'draft', 'dryRun'],
  getMetadata: async () => ({
    source: 'mcp',
  }),
});
```

If `getUserId` is omitted, the exporter tries metadata keys such as `agent-action-runner/userId` and `userId`. If no user id is available, tool execution returns an MCP tool error.

For retry-sensitive tools, derive idempotency keys on the server side. Client-supplied tool arguments are still treated as action input, not trusted execution options.

`getIdempotencyKey(context, action, input)` receives raw MCP tool arguments before core input schema parsing, defaulting, coercion, or transforms. If the key depends on normalized input, derive it from a server-side approval context, session, or dry-run store, or reproduce the same normalization explicitly.

```ts
createMcpExporter(runner, {
  getUserId: () => 'operator_1',
  getApprovalContext: async (context) => {
    return readApprovalContextFromSessionOrStore(context);
  },
  getIdempotencyKey: async (context, action) => {
    if (action.name === 'delivery.executeRetry') {
      const approvalContext = await readApprovalContextFromSessionOrStore(context);
      return `retry:${approvalContext.resourceIds?.join(',')}:${approvalContext.dryRunHash}`;
    }

    return undefined;
  },
});
```

## Tool Results

Successful tool calls return both `structuredContent` and a JSON text fallback.

```json
{
  "executionId": "exec_1",
  "actionName": "math.double",
  "mode": "read",
  "output": {
    "value": 4
  }
}
```

Runner errors become MCP tool results with `isError: true`. They do not crash the MCP server.

## Diagnostics

Use `createMcpToolReport()` when an action is not visible as an MCP tool.

```ts
import { createMcpToolReport } from '@agent-action-runner/mcp';

const report = createMcpToolReport(runner);
```

Skipped actions include one of these reasons:

```txt
modeNotExposed
mutationNotExposed
schemaMissing
schemaNotSerializable
```

Use `createMcpToolCatalog()` when you only want exported tools.

```ts
import { createMcpToolCatalog } from '@agent-action-runner/mcp';

const catalog = createMcpToolCatalog(runner);
```

## Public API

- `createMcpExporter(runner, options)`
- `registerMcpTools(server, runner, options)`
- `createMcpToolCatalog(runner, options)`
- `createMcpToolReport(runner, options)`

Key options:

```ts
type McpExporterOptions = {
  serverName?: string;
  serverVersion?: string;
  exposeModes?: readonly ActionMode[];
  exposeMutations?: boolean;
  allowedModes?: readonly ActionMode[];
  getUserId?: (context) => string | Promise<string>;
  getApprovalToken?: (context) => string | undefined | Promise<string | undefined>;
  getApprovalContext?: (context) => ApprovalContextOverrides | undefined | Promise<ApprovalContextOverrides | undefined>;
  getIdempotencyKey?: (context, action: McpIdempotencyActionContext, rawInput) => string | undefined | Promise<string | undefined>;
  getMetadata?: (context) => Readonly<Record<string, unknown>> | undefined | Promise<Readonly<Record<string, unknown>> | undefined>;
};
```

`McpIdempotencyActionContext` contains public action metadata only: `name`, `mode`, `tags`, `resourceType`, `riskLevel`, and `deprecated`.

## Examples

- `examples/mcp-stdio`
- `examples/mcp-admin-ops`
- `examples/cli-basic`

## License

Apache-2.0
